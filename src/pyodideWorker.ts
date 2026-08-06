// Pyodide runtime self-hosted under <base>/pyodide/ — copied out of the npm
// package by the `pyodide-assets` plugin in vite.config.ts and precached by
// the Service Worker, so ScriptRunner works fully offline. The exact version
// pin of the `pyodide` dependency in package.json is the single source of
// truth for the Pyodide version (AppInfoPanel displays it via
// VITE_PYODIDE_VERSION).
const PYODIDE_BASE_URL = new URL(`${import.meta.env.BASE_URL}pyodide/`, self.location.href).href;

type PyodideLike = {
  setInterruptBuffer: (buffer: Uint8Array) => void;
  setStdout: (options: { batched: (text: string) => void }) => void;
  setStderr: (options: { batched: (text: string) => void }) => void;
  runPython: (code: string) => unknown;
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: {
    set: (name: string, value: unknown) => void;
  };
};

// Helper installed into the Pyodide namespace. It runs the user's script as a
// cancellable asyncio Task. KeyboardInterrupt (via setInterruptBuffer) only
// fires while Python bytecode is executing, so it cannot break an `async` loop
// that is parked in `await asyncio.sleep(...)`. Cancelling the task injects a
// CancelledError directly at the current `await`, stopping async while/for
// loops immediately without requiring any special notation in the script.
const RUNNER_SETUP = `
import asyncio
from pyodide.code import eval_code_async

class _ScriptRunner:
    task = None

async def _runner_run(code):
    _ScriptRunner.task = asyncio.ensure_future(eval_code_async(code, globals=globals()))
    try:
        await _ScriptRunner.task
    except SystemExit:
        # exit() / quit() / sys.exit() — Pyodide 314 ships the full stdlib so
        # these now exist and raise SystemExit. Treat them as a normal end of
        # the script rather than an error.
        pass
    finally:
        _ScriptRunner.task = None

def _runner_stop():
    task = _ScriptRunner.task
    if task is not None and not task.done():
        task.cancel()
        return True
    return False
`;

type WorkerIncomingMessage =
  | { type: 'init'; rawSab: SharedArrayBuffer; phySab: SharedArrayBuffer; aoSab: SharedArrayBuffer; paramSab: SharedArrayBuffer; intSab: SharedArrayBuffer }
  | { type: 'run'; code: string }
  | { type: 'interrupt' };

let pyodide: PyodideLike | null = null;
let initPromise: Promise<void> | null = null;
// Kept so a failed initialization can be retried on the next run: the main
// thread sends `init` only once, when it creates the worker.
let initArgs: Extract<WorkerIncomingMessage, { type: 'init' }> | null = null;
let running = false;
let aiRawShare: Float32Array | null = null;
let aiPhysicalShare: Float32Array | null = null;
let aoShare: Float32Array | null = null;
let paramShare: Float32Array | null = null;
let interruptBuffer: Uint8Array | null = null;
/** Set when a run starts, so Elapsed() measures the script and not the worker. */
let runStartedAt = Date.now();

const postWorkerMessage = (message: Record<string, unknown>) => {
  self.postMessage(message);
};

const readAiValue = (buffer: Float32Array | null, ch: number): number => {
  if (!buffer) return 0;
  if (!Number.isInteger(ch) || ch < 0 || ch >= buffer.length) return 0;
  return buffer[ch] ?? 0;
};

// Everything Python prints is forwarded to the main thread instead of the
// worker console, where the PyScriptRunner panel's Output pane shows it. A
// worker's console output is not visible in the page's devtools by default, so
// without this a print() or a traceback would go nowhere the user can see.
const postOutput = (stream: 'stdout' | 'stderr', text: string) => {
  if (text === '') return;
  postWorkerMessage({ type: 'output', stream, text });
};

// Pyodide raises PythonError whose `message` is the whole formatted traceback.
// That is what a human needs, but the *last* line ("NameError: x is not
// defined") is what a caller wants as a one-line summary, so send both and let
// each consumer pick.
// A traceback from eval_code_async carries four frames of Pyodide plumbing
// (_pyodide/_base.py and the _runner_run wrapper above) around the one frame
// that matters — the user's own line. Drop the plumbing: what is left is
// `File "<exec>", line N`, which is the line number in the submitted script.
const cleanTraceback = (text: string): string => {
  const lines = text.split('\n');
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const isFrameHeader = /^\s{2}File "/.test(line);
    if (isFrameHeader) {
      skipping = line.includes('/_pyodide/') || line.includes(', in _runner_run');
      if (skipping) continue;
    } else if (skipping) {
      // Source / caret lines belonging to a dropped frame are indented further.
      if (/^\s{3,}/.test(line)) continue;
      skipping = false;
    }
    kept.push(line);
  }
  return kept.join('\n');
};

const summarizeError = (text: string): string => {
  const lines = text.split('\n').map((line) => line.trimEnd()).filter((line) => line !== '');
  const last = lines[lines.length - 1];
  return last === undefined || last === '' ? text : last;
};

const writeParamValue = (buffer: Float32Array | null, ch: number, data: number): void => {
  if (!buffer) return;
  if (!Number.isInteger(ch) || ch < 0 || ch >= buffer.length) return;
  buffer[ch] = data;
};

const initializePyodide = async (rawSab: SharedArrayBuffer, phySab: SharedArrayBuffer, aoSab: SharedArrayBuffer, paramSab: SharedArrayBuffer, intSab: SharedArrayBuffer) => {
  postWorkerMessage({ type: 'status', message: 'Initializing Pyodide...' });

  aiRawShare = new Float32Array(rawSab);
  aiPhysicalShare = new Float32Array(phySab);
  aoShare = new Float32Array(aoSab);
  paramShare = new Float32Array(paramSab);
  interruptBuffer = new Uint8Array(intSab);

  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_BASE_URL}pyodide.mjs`);
  pyodide = (await loadPyodide({ indexURL: PYODIDE_BASE_URL })) as PyodideLike;

  pyodide.setStdout({ batched: (text) => postOutput('stdout', text) });
  pyodide.setStderr({ batched: (text) => postOutput('stderr', text) });

  pyodide.runPython(RUNNER_SETUP);

  // PascalCase, not Python's usual snake_case.
  //
  // Deliberate: these are instrument calls rather than Python library calls,
  // named to read the same as calls to the physical rig rather than to match
  // PEP 8. (The spelling also dates from when BASIC and Lua were options too —
  // both are gone now, but the names stayed as they were.)
  const api = pyodide;
  const registerApi = (name: string, fn: unknown): void => {
    api.globals.set(name, fn);
  };

  registerApi('GetAiRaw', (ch: number) => readAiValue(aiRawShare, Number(ch)));
  registerApi('GetAiPhy', (ch: number) => readAiValue(aiPhysicalShare, Number(ch)));
  // AO reads come from a share the main thread mirrors on every AO change, in
  // volts — the same unit SetAo() takes. SetAo() is asynchronous (it posts to
  // the main thread), so a GetAo() immediately after a SetAo() still observes
  // the previous value until the main thread has applied and mirrored it.
  registerApi('GetAo', (ch: number) => readAiValue(aoShare, Number(ch)));
  registerApi('SetAo', (ch: number, data: number) => {
    postWorkerMessage({ type: 'set_ao', ch: Number(ch), data: Number(data) });
  });
  // Tare AI channel `ch`: the main thread adjusts offset c so the current
  // physical reading becomes 0 (a and b unchanged). Applied asynchronously,
  // like SetAo — GetAiPhy() reflects it once the main thread has updated
  // the calibration and the next poll refreshes the share.
  registerApi('SetAiTare', (ch: number) => {
    postWorkerMessage({ type: 'set_ai_tare', ch: Number(ch) });
  });
  registerApi('GetParam', (ch: number) => readAiValue(paramShare, Number(ch)));
  registerApi('SetParam', (ch: number, data: number) => {
    writeParamValue(paramShare, Number(ch), Number(data));
  });
  // The label itself lives in App.tsx state (persisted like any other UI
  // edit), not the SAB, so it goes over the same postMessage path as SetAo /
  // SetAiTare rather than a direct write.
  registerApi('SetParamLabel', (ch: number, text: string) => {
    postWorkerMessage({ type: 'set_param_label', ch: Number(ch), text: String(text) });
  });
  // Monotonic seconds since this worker started, so it has no midnight
  // discontinuity — the one a multi-day consolidation stage would otherwise
  // walk straight into.
  registerApi('Elapsed', () => (Date.now() - runStartedAt) / 1000);

  // Armed last, deliberately. A Stop issued while Pyodide was still loading
  // leaves the interrupt buffer holding 2, and Pyodide checks that buffer inside
  // every runPython() — so arming it before the setup code above would raise
  // KeyboardInterrupt out of initialization itself, failing the init and leaving
  // the worker unusable. The pending stop stays in the buffer for the run branch
  // to honour.
  pyodide.setInterruptBuffer(interruptBuffer);

  postWorkerMessage({ type: 'status', message: 'Ready' });
};

self.onmessage = async (event: MessageEvent<WorkerIncomingMessage>) => {
  const message = event.data;

  if (message.type === 'init') {
    initArgs = message;
    if (!initPromise) {
      initPromise = initializePyodide(message.rawSab, message.phySab, message.aoSab, message.paramSab, message.intSab);
    }
    try {
      await initPromise;
    } catch (err) {
      initPromise = null;
      postWorkerMessage({ type: 'error', message: (err as Error).message });
    }
    return;
  }

  if (message.type === 'interrupt') {
    // The main thread already armed the interrupt buffer (SharedArrayBuffer),
    // which raises KeyboardInterrupt inside synchronous loops even while this
    // event loop is blocked. If this handler runs, Python is idle or parked at
    // an `await`, so cancel the asyncio Task instead. The pending interrupt
    // must be cleared BEFORE calling _runner_stop(): otherwise the
    // KeyboardInterrupt fires inside _runner_stop() itself, is swallowed by
    // the catch below, and the user's async loop keeps running after Stop.
    if (pyodide && running) {
      if (interruptBuffer) interruptBuffer[0] = 0;
      try {
        pyodide.runPython('_runner_stop()');
      } catch {
        // Ignore: the task may have already finished.
      }
    } else if (interruptBuffer) {
      // No script executing yet (e.g. Stop pressed while Pyodide is still
      // initializing): keep the stop request armed so a pending run aborts.
      interruptBuffer[0] = 2;
    }
    return;
  }

  if (message.type === 'run') {
    if (!initPromise) {
      // A previous initialization failed (its promise was cleared so it could be
      // retried). Retry here rather than leaving the worker permanently dead:
      // the main thread has no way to re-send `init` short of recreating it.
      if (!initArgs) {
        postWorkerMessage({ type: 'error', message: 'Worker is not initialized' });
        return;
      }
      initPromise = initializePyodide(
        initArgs.rawSab,
        initArgs.phySab,
        initArgs.aoSab,
        initArgs.paramSab,
        initArgs.intSab,
      );
    }
    if (running) {
      postWorkerMessage({ type: 'error', message: 'Script is already running' });
      return;
    }

    try {
      await initPromise;
      if (!pyodide) {
        throw new Error('Pyodide is not available');
      }
      if (interruptBuffer && interruptBuffer[0] === 2) {
        // Stop was pressed while initialization was still in progress: abort
        // instead of clearing the request and starting anyway.
        postWorkerMessage({ type: 'interrupted', message: 'Stopped' });
        return;
      }

      running = true;
      runStartedAt = Date.now();
      postWorkerMessage({ type: 'status', message: 'Running' });
      pyodide.globals.set('__user_code__', message.code);
      await pyodide.runPythonAsync('await _runner_run(__user_code__)');
      postWorkerMessage({ type: 'done', message: 'Completed' });
    } catch (err) {
      const error = err as Error;
      const text = error.message ?? String(error);
      // Initialization (not the script) failed: clear the rejected promise so
      // the next run retries instead of replaying the same failure forever.
      if (!pyodide) initPromise = null;
      // KeyboardInterrupt: sync loop stopped. CancelledError: async Task
      // cancelled. Both mean the user pressed Stop.
      if (text.includes('KeyboardInterrupt') || text.includes('CancelledError')) {
        postWorkerMessage({ type: 'interrupted', message: 'Stopped' });
      } else if (text.includes('SystemExit')) {
        // Fallback in case exit()/quit()/sys.exit() ever escapes _runner_run:
        // a clean script end, not an error.
        postWorkerMessage({ type: 'done', message: 'Completed' });
      } else {
        // `message` is the one-line summary the status bar shows; `traceback`
        // is the full Python traceback, kept in the run log so the user can see
        // which line failed.
        postWorkerMessage({
          type: 'error',
          message: summarizeError(text),
          traceback: cleanTraceback(text),
        });
      }
    } finally {
      running = false;
      if (interruptBuffer) interruptBuffer[0] = 0;
    }
  }
};
