// Pyodide runtime self-hosted under <base>/pyodide/ — copied out of the npm
// package by the `pyodide-assets` plugin in vite.config.ts and precached by
// the Service Worker, so ScriptRunner works fully offline. The exact version
// pin of the `pyodide` dependency in package.json is the single source of
// truth for the Pyodide version (AppInfoPanel displays it via
// VITE_PYODIDE_VERSION).
const PYODIDE_BASE_URL = new URL(`${import.meta.env.BASE_URL}pyodide/`, self.location.href).href;

type PyodideLike = {
  setInterruptBuffer: (buffer: Uint8Array) => void;
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
  | { type: 'init'; rawSab: SharedArrayBuffer; phySab: SharedArrayBuffer; aoSab: SharedArrayBuffer; paramSab: SharedArrayBuffer; intSab: SharedArrayBuffer; verSab: SharedArrayBuffer }
  | { type: 'run'; code: string }
  | { type: 'interrupt' };

let pyodide: PyodideLike | null = null;
let initPromise: Promise<void> | null = null;
let running = false;
let aiRawShare: Float32Array | null = null;
let aiPhysicalShare: Float32Array | null = null;
let aoShare: Float32Array | null = null;
let paramShare: Float32Array | null = null;
let interruptBuffer: Uint8Array | null = null;
let versionBuffer: Int32Array | null = null;

const postWorkerMessage = (message: Record<string, unknown>) => {
  self.postMessage(message);
};

const readAiValue = (buffer: Float32Array | null, ch: number): number => {
  if (!buffer) return 0;
  if (!Number.isInteger(ch) || ch < 0 || ch >= buffer.length) return 0;
  return buffer[ch] ?? 0;
};

const readAiAll = (buffer: Float32Array | null): number[] => {
  if (!buffer) return [];
  if (!versionBuffer) return Array.from(buffer);
  for (let attempt = 0; attempt < 8; attempt++) {
    const v1 = Atomics.load(versionBuffer, 0);
    if (v1 !== 0) continue;
    const result = Array.from(buffer);
    const v2 = Atomics.load(versionBuffer, 0);
    if (v1 === v2) return result;
  }
  return Array.from(buffer);
};

const writeParamValue = (buffer: Float32Array | null, ch: number, data: number): void => {
  if (!buffer) return;
  if (!Number.isInteger(ch) || ch < 0 || ch >= buffer.length) return;
  buffer[ch] = data;
};

const initializePyodide = async (rawSab: SharedArrayBuffer, phySab: SharedArrayBuffer, aoSab: SharedArrayBuffer, paramSab: SharedArrayBuffer, intSab: SharedArrayBuffer, verSab: SharedArrayBuffer) => {
  postWorkerMessage({ type: 'status', message: 'Initializing Pyodide...' });

  aiRawShare = new Float32Array(rawSab);
  aiPhysicalShare = new Float32Array(phySab);
  aoShare = new Float32Array(aoSab);
  paramShare = new Float32Array(paramSab);
  interruptBuffer = new Uint8Array(intSab);
  versionBuffer = new Int32Array(verSab);

  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_BASE_URL}pyodide.mjs`);
  pyodide = (await loadPyodide({ indexURL: PYODIDE_BASE_URL })) as PyodideLike;

  pyodide.setInterruptBuffer(interruptBuffer);
  pyodide.runPython(RUNNER_SETUP);
  pyodide.globals.set('get_ai_raw', (ch: number) => readAiValue(aiRawShare, Number(ch)));
  pyodide.globals.set('get_ai_raw_all', () => readAiAll(aiRawShare));
  pyodide.globals.set('get_ai_phy', (ch: number) => readAiValue(aiPhysicalShare, Number(ch)));
  pyodide.globals.set('get_ai_phy_all', () => readAiAll(aiPhysicalShare));
  // AO reads come from a share the main thread mirrors on every AO change, in
  // volts — the same unit set_ao() takes. set_ao() is asynchronous (it posts to
  // the main thread), so a get_ao() immediately after a set_ao() still observes
  // the previous value until the main thread has applied and mirrored it.
  pyodide.globals.set('get_ao', (ch: number) => readAiValue(aoShare, Number(ch)));
  pyodide.globals.set('get_ao_all', () => readAiAll(aoShare));
  pyodide.globals.set('set_ao', (ch: number, data: number) => {
    postWorkerMessage({ type: 'set_ao', ch: Number(ch), data: Number(data) });
  });
  pyodide.globals.set('set_ao_all', (data: unknown) => {
    if (!Array.isArray(data)) return;
    data.forEach((value, index) => {
      postWorkerMessage({ type: 'set_ao', ch: index, data: Number(value) });
    });
  });
  pyodide.globals.set('get_param', (ch: number) => readAiValue(paramShare, Number(ch)));
  pyodide.globals.set('get_param_all', () => readAiAll(paramShare));
  pyodide.globals.set('set_param', (ch: number, data: number) => {
    writeParamValue(paramShare, Number(ch), Number(data));
  });
  pyodide.globals.set('set_param_all', (data: unknown) => {
    if (!Array.isArray(data)) return;
    data.forEach((value, index) => {
      writeParamValue(paramShare, index, Number(value));
    });
  });

  postWorkerMessage({ type: 'status', message: 'Ready' });
};

self.onmessage = async (event: MessageEvent<WorkerIncomingMessage>) => {
  const message = event.data;

  if (message.type === 'init') {
    if (!initPromise) {
      initPromise = initializePyodide(message.rawSab, message.phySab, message.aoSab, message.paramSab, message.intSab, message.verSab);
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
    // Raise KeyboardInterrupt for synchronous loops (checked while bytecode
    // runs, even when the worker thread is blocked in a busy loop)...
    if (interruptBuffer) interruptBuffer[0] = 2;
    // ...and cancel the running asyncio Task so loops parked in `await`
    // (e.g. asyncio.sleep) stop immediately instead of waiting for the await
    // to resolve. Safe to call while the worker is idle between awaits.
    if (pyodide && running) {
      try {
        pyodide.runPython('_runner_stop()');
      } catch {
        // Ignore: the task may have already finished.
      }
    }
    return;
  }

  if (message.type === 'run') {
    if (!initPromise) {
      postWorkerMessage({ type: 'error', message: 'Worker is not initialized' });
      return;
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
      if (interruptBuffer) interruptBuffer[0] = 0;

      running = true;
      postWorkerMessage({ type: 'status', message: 'Running' });
      pyodide.globals.set('__user_code__', message.code);
      await pyodide.runPythonAsync('await _runner_run(__user_code__)');
      postWorkerMessage({ type: 'done', message: 'Completed' });
    } catch (err) {
      const error = err as Error;
      const text = error.message ?? String(error);
      // KeyboardInterrupt: sync loop stopped. CancelledError: async Task
      // cancelled. Both mean the user pressed Stop.
      if (text.includes('KeyboardInterrupt') || text.includes('CancelledError')) {
        postWorkerMessage({ type: 'interrupted', message: 'Stopped' });
      } else if (text.includes('SystemExit')) {
        // Fallback in case exit()/quit()/sys.exit() ever escapes _runner_run:
        // a clean script end, not an error.
        postWorkerMessage({ type: 'done', message: 'Completed' });
      } else {
        postWorkerMessage({ type: 'error', message: text });
      }
    } finally {
      running = false;
      if (interruptBuffer) interruptBuffer[0] = 0;
    }
  }
};
