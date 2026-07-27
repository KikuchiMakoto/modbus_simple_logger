import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_CHANNELS, AO_CHANNELS, PARAM_CHANNELS } from '../constants';
import { clearBackgroundTimer, setBackgroundTimeout } from '../utils/backgroundTimer';
import { readJsonStorage, writeJsonStorage } from '../utils/cookies';
import { notify, NOTIFY_TAG } from '../utils/notifications';

const SCRIPT_RUNNER_STORAGE_KEY = 'scriptRunnerCode';
const SCRIPT_RUNNER_BACKUP_KEY = 'scriptRunnerCodeBackup';

// Who started the current (or most recent) run. The MCP bridge overwrites the
// editor contents when it runs a script, so the UI needs to say so.
export type ScriptSource = 'user' | 'mcp';

// How many log lines are kept. A `while True:` loop that prints every iteration
// would grow without bound otherwise; the log is a tail, not a transcript.
const SCRIPT_LOG_MAX = 300;

export type ScriptLogEntry = {
  /** Epoch ms. */
  t: number;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
};

export type ScriptOutcome = 'idle' | 'running' | 'completed' | 'stopped' | 'error';

/**
 * Result of the current (or most recent) run. This exists mainly for the MCP
 * bridge: run_script hands the script to a worker and returns immediately, so
 * without a record of how the run ended, a failing script looked exactly like a
 * successful one to the caller. `runId` lets a caller tell its own run from a
 * later one started by someone else.
 */
export type ScriptRunInfo = {
  runId: number;
  source: ScriptSource;
  outcome: ScriptOutcome;
  startedAt: number | null;
  endedAt: number | null;
  /** One-line summary, e.g. "NameError: foo is not defined". */
  error: string | null;
  /** Full Python traceback when the failure came from the script itself. */
  traceback: string | null;
};

const IDLE_RUN: ScriptRunInfo = {
  runId: 0,
  source: 'user',
  outcome: 'idle',
  startedAt: null,
  endedAt: null,
  error: null,
  traceback: null,
};

export function useScriptRunner(
  setAo: (ch: number, data: number) => void,
  onAiCalibTare: (ch: number) => void,
) {
  const scriptRunnerSupported = typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated;
  const [scriptCode, setScriptCode] = useState(() => {
    const stored = readJsonStorage<string>(SCRIPT_RUNNER_STORAGE_KEY);
    return stored ?? getDefaultScript();
  });
  const [scriptRunning, setScriptRunning] = useState(false);
  const [scriptSource, setScriptSource] = useState<ScriptSource>('user');
  const [hasScriptBackup, setHasScriptBackup] = useState(
    () => readJsonStorage<string>(SCRIPT_RUNNER_BACKUP_KEY) !== null,
  );
  const [scriptRunnerStatus, setScriptRunnerStatus] = useState(
    scriptRunnerSupported
      ? 'Idle'
      : 'Unavailable: requires cross-origin isolation (COOP/COEP headers). Reload once after Service Worker installation.',
  );
  const [scriptLog, setScriptLog] = useState<ScriptLogEntry[]>([]);
  const [scriptRun, setScriptRun] = useState<ScriptRunInfo>(IDLE_RUN);
  const scriptExecutingRef = useRef(false);
  // Mirrored in refs because the MCP bridge reads them from a WebSocket handler,
  // outside React's render cycle, and must never see a stale render's copy.
  const scriptLogRef = useRef<ScriptLogEntry[]>([]);
  const scriptRunRef = useRef<ScriptRunInfo>(IDLE_RUN);
  const runIdRef = useRef(0);
  const runWaitersRef = useRef<{ resolve: (info: ScriptRunInfo) => void; timer: number }[]>([]);
  const pyWorkerRef = useRef<Worker | null>(null);
  const interruptBufferRef = useRef<Uint8Array | null>(null);
  const aiRawShareRef = useRef<Float32Array | null>(null);
  const aiPhysicalShareRef = useRef<Float32Array | null>(null);
  const aoShareRef = useRef<Float32Array | null>(null);
  const paramShareRef = useRef<Float32Array | null>(null);
  const scriptCodeRef = useRef(scriptCode);
  scriptCodeRef.current = scriptCode;

  const appendLog = useCallback((stream: ScriptLogEntry['stream'], text: string) => {
    const trimmed = text.replace(/\s+$/, '');
    if (trimmed === '') return;
    const next = [...scriptLogRef.current, { t: Date.now(), stream, text: trimmed }];
    if (next.length > SCRIPT_LOG_MAX) next.splice(0, next.length - SCRIPT_LOG_MAX);
    scriptLogRef.current = next;
    setScriptLog(next);
  }, []);

  const clearScriptLog = useCallback(() => {
    scriptLogRef.current = [];
    setScriptLog([]);
  }, []);

  // A run ends exactly once. Every waiter (an MCP run_script asked to wait for
  // the outcome) is released here, so a script that crashes one millisecond in
  // reports the crash instead of timing out.
  const settleRun = useCallback(
    (outcome: Exclude<ScriptOutcome, 'idle' | 'running'>, error: string | null = null, traceback: string | null = null) => {
      const info: ScriptRunInfo = {
        ...scriptRunRef.current,
        outcome,
        endedAt: Date.now(),
        error,
        traceback,
      };
      scriptRunRef.current = info;
      setScriptRun(info);
      const waiters = runWaitersRef.current;
      runWaitersRef.current = [];
      for (const waiter of waiters) {
        clearBackgroundTimer(waiter.timer);
        waiter.resolve(info);
      }
    },
    [],
  );

  const beginRun = useCallback((source: ScriptSource): ScriptRunInfo => {
    runIdRef.current += 1;
    const info: ScriptRunInfo = {
      runId: runIdRef.current,
      source,
      outcome: 'running',
      startedAt: Date.now(),
      endedAt: null,
      error: null,
      traceback: null,
    };
    scriptRunRef.current = info;
    setScriptRun(info);
    return info;
  }, []);

  /**
   * Resolve when the current run finishes, or after `timeoutMs` with the run
   * still marked 'running' (a control loop is supposed to keep going — that is
   * an answer, not a failure).
   *
   * Background timer: the caller is the MCP bridge, i.e. an agent driving this
   * window from outside it, and the window it is driving is very often
   * minimised. A throttled timeout would turn `wait_for_script(5s)` into a
   * one-minute stall with nothing to indicate why.
   */
  const waitForScriptRun = useCallback((timeoutMs: number): Promise<ScriptRunInfo> => {
    if (scriptRunRef.current.outcome !== 'running') return Promise.resolve(scriptRunRef.current);
    return new Promise<ScriptRunInfo>((resolve) => {
      const entry = {
        resolve,
        timer: setBackgroundTimeout(() => {
          runWaitersRef.current = runWaitersRef.current.filter((w) => w !== entry);
          resolve(scriptRunRef.current);
        }, timeoutMs),
      };
      runWaitersRef.current.push(entry);
    });
  }, []);

  // Allocate the shared buffers up front, independently of the Pyodide worker.
  //
  // These are not only the worker's data channel: the polling loop publishes AI
  // values into them every cycle and the MCP bridge (desktop launcher) reads and
  // writes the very same memory. Allocating them lazily with the worker would
  // mean AI/AO/Parameter values are invisible to anything but ScriptRunner until
  // a script is run once. Allocation is a few hundred bytes and the worker (the
  // expensive part) stays lazy.
  const ensureShares = useCallback((): boolean => {
    if (aiRawShareRef.current) return true;
    if (!scriptRunnerSupported) return false;

    aiRawShareRef.current = new Float32Array(
      new SharedArrayBuffer(AI_CHANNELS * Float32Array.BYTES_PER_ELEMENT),
    );
    aiPhysicalShareRef.current = new Float32Array(
      new SharedArrayBuffer(AI_CHANNELS * Float32Array.BYTES_PER_ELEMENT),
    );
    aoShareRef.current = new Float32Array(
      new SharedArrayBuffer(AO_CHANNELS * Float32Array.BYTES_PER_ELEMENT),
    );
    paramShareRef.current = new Float32Array(
      new SharedArrayBuffer(PARAM_CHANNELS * Float32Array.BYTES_PER_ELEMENT),
    );
    interruptBufferRef.current = new Uint8Array(new SharedArrayBuffer(1));
    return true;
  }, [scriptRunnerSupported]);

  useEffect(() => {
    ensureShares();
  }, [ensureShares]);

  const ensureWorkerReady = useCallback((): Worker => {
    if (pyWorkerRef.current) return pyWorkerRef.current;
    if (!ensureShares()) {
      throw new Error(
        'ScriptRunner requires cross-origin isolation (COOP/COEP headers). Reload once after Service Worker installation.',
      );
    }

    const rawSab = aiRawShareRef.current!.buffer as SharedArrayBuffer;
    const phySab = aiPhysicalShareRef.current!.buffer as SharedArrayBuffer;
    const aoSab = aoShareRef.current!.buffer as SharedArrayBuffer;
    const paramSab = paramShareRef.current!.buffer as SharedArrayBuffer;
    const intSab = interruptBufferRef.current!.buffer as SharedArrayBuffer;

    const worker = new Worker(new URL('../pyodideWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as
        | { type: 'set_ao'; ch: number; data: number }
        | { type: 'set_ai_tare'; ch: number }
        | { type: 'status'; message: string }
        | { type: 'output'; stream: 'stdout' | 'stderr'; text: string }
        | { type: 'notify'; message: string }
        | { type: 'done'; message?: string }
        | { type: 'interrupted'; message?: string }
        | { type: 'error'; message: string; traceback?: string };
      if (message.type === 'set_ao') {
        setAo(message.ch, message.data);
      } else if (message.type === 'set_ai_tare') {
        onAiCalibTare(message.ch);
      } else if (message.type === 'status') {
        setScriptRunnerStatus(message.message);
      } else if (message.type === 'output') {
        appendLog(message.stream, message.text);
      } else if (message.type === 'notify') {
        // set_notify(msg). Logged first: the log is the record, the toast is
        // only the interruption, and the user may have turned it off.
        appendLog('system', `notify: ${message.message}`);
        notify('ScriptRunner', message.message, { tag: NOTIFY_TAG.scriptMessage });
      } else if (message.type === 'done') {
        scriptExecutingRef.current = false;
        setScriptRunning(false);
        setScriptRunnerStatus(message.message ?? 'Completed');
        appendLog('system', message.message ?? 'Completed');
        notify('ScriptRunner', 'Script completed.', { tag: NOTIFY_TAG.scriptRun });
        settleRun('completed');
      } else if (message.type === 'interrupted') {
        scriptExecutingRef.current = false;
        setScriptRunning(false);
        setScriptRunnerStatus(message.message ?? 'Stopped');
        appendLog('system', message.message ?? 'Stopped');
        notify('ScriptRunner', 'Script stopped.', { tag: NOTIFY_TAG.scriptRun });
        settleRun('stopped');
      } else if (message.type === 'error') {
        scriptExecutingRef.current = false;
        setScriptRunning(false);
        setScriptRunnerStatus(`Error: ${message.message}`);
        appendLog('stderr', message.traceback ?? message.message);
        // Sticky: a run that died is the one event worth leaving on screen
        // until someone actually looks at it.
        notify('ScriptRunner error', message.message, { tag: NOTIFY_TAG.scriptRun, sticky: true });
        settleRun('error', message.message, message.traceback ?? null);
      }
    };
    worker.onerror = (event) => {
      scriptExecutingRef.current = false;
      setScriptRunning(false);
      setScriptRunnerStatus(`Error: ${event.message}`);
      appendLog('stderr', event.message);
      notify('ScriptRunner error', event.message, { tag: NOTIFY_TAG.scriptRun, sticky: true });
      settleRun('error', event.message);
    };

    worker.postMessage({
      type: 'init',
      rawSab,
      phySab,
      aoSab,
      paramSab,
      intSab,
    });

    pyWorkerRef.current = worker;
    return worker;
  }, [scriptRunnerSupported, setAo, onAiCalibTare, appendLog, settleRun]);

  const stopScriptRunner = useCallback((nextStatus = 'Stopped') => {
    if (interruptBufferRef.current) {
      interruptBufferRef.current[0] = 2;
      pyWorkerRef.current?.postMessage({ type: 'interrupt' });
    }
    const wasRunning = scriptExecutingRef.current;
    scriptExecutingRef.current = false;
    setScriptRunning(false);
    setScriptRunnerStatus(nextStatus);
    if (wasRunning) {
      appendLog('system', nextStatus);
      // The worker answers this Stop with an 'interrupted' message of its own a
      // moment later; both carry the same tag, so the second replaces the first
      // rather than stacking. Notifying here too is what covers the case where
      // no answer comes back at all (Pyodide was still booting).
      notify('ScriptRunner', 'Script stopped.', { tag: NOTIFY_TAG.scriptRun });
      settleRun('stopped');
    }
  }, [appendLog, settleRun]);

  // `codeOverride` exists because a caller that has just set new code cannot
  // rely on the `scriptCode` state having been applied yet (see runScriptFromMcp).
  const startScriptRunner = useCallback((source: ScriptSource, codeOverride?: string): ScriptRunInfo => {
    if (scriptExecutingRef.current) return scriptRunRef.current;
    // Each run starts from a clean log: mixing the output of two runs is how a
    // caller ends up reading a stale error as if it were its own.
    clearScriptLog();
    const info = beginRun(source);
    try {
      const worker = ensureWorkerReady();
      if (interruptBufferRef.current) interruptBufferRef.current[0] = 0;
      scriptExecutingRef.current = true;
      setScriptRunning(true);
      setScriptRunnerStatus('Running');
      worker.postMessage({ type: 'run', code: codeOverride ?? scriptCodeRef.current });
      notify(
        'ScriptRunner',
        source === 'mcp' ? 'Script started from MCP.' : 'Script started.',
        { tag: NOTIFY_TAG.scriptRun },
      );
      return info;
    } catch (err) {
      const text = (err as Error).message;
      scriptExecutingRef.current = false;
      setScriptRunning(false);
      setScriptRunnerStatus(`Error: ${text}`);
      appendLog('stderr', text);
      notify('ScriptRunner error', text, { tag: NOTIFY_TAG.scriptRun, sticky: true });
      settleRun('error', text);
      return scriptRunRef.current;
    }
  }, [ensureWorkerReady, beginRun, clearScriptLog, appendLog, settleRun]);

  const toggleScriptRunner = useCallback(() => {
    if (scriptRunning) {
      stopScriptRunner('Stopped');
      return;
    }
    setScriptSource('user');
    startScriptRunner('user');
  }, [scriptRunning, startScriptRunner, stopScriptRunner]);

  // Run code submitted over the MCP bridge. The editor is a single shared
  // buffer, so the user's code is saved to a backup slot first and can be
  // restored from the ScriptRunner panel.
  const runScriptFromMcp = useCallback((code: string): ScriptRunInfo => {
    if (scriptExecutingRef.current) {
      throw new Error('A script is already running. Call stop_script first.');
    }
    writeJsonStorage(SCRIPT_RUNNER_BACKUP_KEY, scriptCodeRef.current);
    setHasScriptBackup(true);
    scriptCodeRef.current = code;
    setScriptCode(code);
    setScriptSource('mcp');
    return startScriptRunner('mcp', code);
  }, [startScriptRunner]);

  const restoreScriptBackup = useCallback(() => {
    const backup = readJsonStorage<string>(SCRIPT_RUNNER_BACKUP_KEY);
    if (backup === null) return;
    scriptCodeRef.current = backup;
    setScriptCode(backup);
  }, []);

  const clearScriptCode = useCallback(() => {
    setScriptCode(getDefaultScript());
  }, []);

  useEffect(() => {
    writeJsonStorage(SCRIPT_RUNNER_STORAGE_KEY, scriptCode);
  }, [scriptCode]);

  useEffect(() => {
    return () => {
      if (pyWorkerRef.current) {
        pyWorkerRef.current.terminate();
        pyWorkerRef.current = null;
      }
    };
  }, []);

  return {
    scriptRunnerSupported,
    scriptCode,
    setScriptCode,
    scriptRunning,
    scriptSource,
    scriptRunnerStatus,
    scriptLog,
    scriptLogRef,
    clearScriptLog,
    scriptRun,
    scriptRunRef,
    waitForScriptRun,
    toggleScriptRunner,
    stopScriptRunner,
    clearScriptCode,
    runScriptFromMcp,
    restoreScriptBackup,
    hasScriptBackup,
    aiRawShareRef,
    aiPhysicalShareRef,
    aoShareRef,
    paramShareRef,
  };
}

function getDefaultScript(): string {
  return `# get_ai_raw(ch) / get_ai_phy(ch): AI value. ch: 0-15.
# set_ai_tare(ch): tare AI ch so current phy reads 0 (offset c only). ch: 0-15.
# get_ao(ch) / set_ao(ch, vlt): AO voltage [V], clamped to 0-10, applied async. ch: 0-7.
# get_param(ch) / set_param(ch, val): scratch value, shown in Parameter panel + TSV. ch: 0-15.
# set_notify(msg): OS notification + Output log line. Enable Notifications in the menu first.
#
# Wait ONLY with \`await asyncio.sleep(s)\` - NEVER time.sleep() (freezes the browser).
# Loop with a plain while/for. Press Stop to halt at any time.

import asyncio
import math

t = 0.0
while True:
    set_param(0, math.sin(t))  # example: slow sine wave on Parameter ch0
    t += 0.1
    await asyncio.sleep(1)`;
}
