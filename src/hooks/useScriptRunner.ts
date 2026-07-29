import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_CHANNELS, AO_CHANNELS, PARAM_CHANNELS } from '../constants';
import { clearBackgroundTimer, setBackgroundTimeout } from '../utils/backgroundTimer';
import { readJsonStorage, writeJsonStorage } from '../utils/cookies';
import { notify, NOTIFY_TAG } from '../utils/notifications';
import {
  DEFAULT_SCRIPT_LANGUAGE,
  SCRIPT_LANGUAGES,
  isScriptLanguageId,
  type ScriptLanguageId,
} from '../utils/scriptLanguages';

const SCRIPT_LANGUAGE_STORAGE_KEY = 'scriptRunnerLanguage';

// How many log lines are kept. A `while True:` loop that prints every iteration
// would grow without bound otherwise; the log is a tail, not a transcript.
//
// 100, not the 300 this started at. The cost that matters is not the bytes —
// it is that every printed line re-renders the panel and re-maps the whole
// array, on the same main thread the Modbus polling loop runs on, so the tail
// length is paid per line rather than once. The Output pane shows about five
// lines at a time and the last one is echoed in the status bar; anything a
// script needs to keep beyond that belongs in Parameter channels or the TSV,
// both of which are recorded rather than scrolled past.
const SCRIPT_LOG_MAX = 100;

// Longest single line kept, in characters. The line count above bounds how many
// entries there are but not how big one can be: `print(huge_list)` is one entry
// holding the whole thing, and in a loop that is the unbounded case the line cap
// was supposed to close. Cut well above anything the pane can show, so this only
// ever fires on output that was never readable there anyway.
const SCRIPT_LOG_LINE_MAX = 2000;

export type ScriptLogEntry = {
  /** Epoch ms. */
  t: number;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
};

export type ScriptOutcome = 'idle' | 'running' | 'completed' | 'stopped' | 'error';

/**
 * Result of the current (or most recent) run. The runner hands the script to a
 * worker and returns immediately, so without a record of how the run ended a
 * failing script would look exactly like a successful one. `runId` lets a
 * consumer tell one run from the next.
 */
export type ScriptRunInfo = {
  runId: number;
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
  const [scriptLanguage, setScriptLanguageState] = useState<ScriptLanguageId>(() => {
    const stored = readJsonStorage<string>(SCRIPT_LANGUAGE_STORAGE_KEY);
    return isScriptLanguageId(stored) ? stored : DEFAULT_SCRIPT_LANGUAGE;
  });
  // Each language keeps its own editor contents under its own key. Switching
  // languages to look at an example must not destroy the script someone has
  // been writing in the other one.
  const [scriptCode, setScriptCode] = useState(() => loadCode(scriptLanguage));
  const [scriptRunning, setScriptRunning] = useState(false);
  const [scriptRunnerStatus, setScriptRunnerStatus] = useState(
    scriptRunnerSupported
      ? 'Idle'
      : 'Unavailable: requires cross-origin isolation (COOP/COEP headers). Reload once after Service Worker installation.',
  );
  const [scriptLog, setScriptLog] = useState<ScriptLogEntry[]>([]);
  const [scriptRun, setScriptRun] = useState<ScriptRunInfo>(IDLE_RUN);
  const scriptExecutingRef = useRef(false);
  // Mirrored in refs because worker message handlers run outside React's render
  // cycle and must never observe a stale render's copy.
  const scriptLogRef = useRef<ScriptLogEntry[]>([]);
  const scriptRunRef = useRef<ScriptRunInfo>(IDLE_RUN);
  const runIdRef = useRef(0);
  // One worker per language, kept alive once created. Pyodide costs seconds to
  // boot; terminating it because someone glanced at the BASIC example would
  // make switching back feel broken. The BASIC and Lua workers are cheap enough
  // that the same policy costs nothing.
  const workersRef = useRef(new Map<ScriptLanguageId, Worker>());
  /** Which language's worker is executing, so Stop reaches the right one. */
  const runningLanguageRef = useRef<ScriptLanguageId | null>(null);
  const interruptBufferRef = useRef<Uint8Array | null>(null);
  const aiRawShareRef = useRef<Float32Array | null>(null);
  const aiPhysicalShareRef = useRef<Float32Array | null>(null);
  const aoShareRef = useRef<Float32Array | null>(null);
  const paramShareRef = useRef<Float32Array | null>(null);
  const scriptCodeRef = useRef(scriptCode);
  scriptCodeRef.current = scriptCode;
  const scriptLanguageRef = useRef(scriptLanguage);
  scriptLanguageRef.current = scriptLanguage;

  const appendLog = useCallback((stream: ScriptLogEntry['stream'], text: string) => {
    const trimmed = text.replace(/\s+$/, '');
    if (trimmed === '') return;
    // Say so rather than silently dropping the tail: a line that ends mid-value
    // otherwise reads as the script having produced garbage.
    const capped =
      trimmed.length > SCRIPT_LOG_LINE_MAX
        ? `${trimmed.slice(0, SCRIPT_LOG_LINE_MAX)}… (${trimmed.length - SCRIPT_LOG_LINE_MAX} more characters)`
        : trimmed;
    const next = [...scriptLogRef.current, { t: Date.now(), stream, text: capped }];
    if (next.length > SCRIPT_LOG_MAX) next.splice(0, next.length - SCRIPT_LOG_MAX);
    scriptLogRef.current = next;
    setScriptLog(next);
  }, []);

  const clearScriptLog = useCallback(() => {
    scriptLogRef.current = [];
    setScriptLog([]);
  }, []);

  // A run ends exactly once.
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
    },
    [],
  );

  const beginRun = useCallback((): ScriptRunInfo => {
    runIdRef.current += 1;
    const info: ScriptRunInfo = {
      runId: runIdRef.current,
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

  // Allocate the shared buffers up front, independently of the Pyodide worker.
  //
  // These are not only the worker's data channel: the polling loop publishes AI
  // values into them every cycle, and the worker reads and
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

  const ensureWorkerReady = useCallback((language: ScriptLanguageId): Worker => {
    const existing = workersRef.current.get(language);
    if (existing) return existing;
    if (!ensureShares()) {
      throw new Error(
        'Script Runner requires cross-origin isolation (COOP/COEP headers). Reload once after Service Worker installation.',
      );
    }

    const rawSab = aiRawShareRef.current!.buffer as SharedArrayBuffer;
    const phySab = aiPhysicalShareRef.current!.buffer as SharedArrayBuffer;
    const aoSab = aoShareRef.current!.buffer as SharedArrayBuffer;
    const paramSab = paramShareRef.current!.buffer as SharedArrayBuffer;
    const intSab = interruptBufferRef.current!.buffer as SharedArrayBuffer;

    // Static `new URL(...)` literals: this is how the bundler finds a worker
    // entry point and emits it, so the path cannot come from the table in
    // scriptLanguages.ts.
    const worker =
      language === 'basic'
        ? new Worker(new URL('../basicWorker.ts', import.meta.url), { type: 'module' })
        : language === 'lua'
          ? new Worker(new URL('../luaWorker.ts', import.meta.url), { type: 'module' })
          : new Worker(new URL('../pyodideWorker.ts', import.meta.url), { type: 'module' });
    const runnerName = SCRIPT_LANGUAGES[language].label;
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
        notify(`${runnerName} Runner`, message.message, { tag: NOTIFY_TAG.scriptMessage });
      } else if (message.type === 'done') {
        scriptExecutingRef.current = false;
        runningLanguageRef.current = null;
        setScriptRunning(false);
        setScriptRunnerStatus(message.message ?? 'Completed');
        appendLog('system', message.message ?? 'Completed');
        notify(`${runnerName} Runner`, 'Script completed.', { tag: NOTIFY_TAG.scriptRun });
        settleRun('completed');
      } else if (message.type === 'interrupted') {
        // This is the worker CONFIRMING a Stop that stopScriptRunner already
        // reported the moment it was requested — so the end of the run has
        // normally been recorded once already, and recording it again wrote
        // "Stopped" into the log twice for one press. (The notification did not
        // double up only because both carry the same tag and the second
        // replaced the first.)
        //
        // Still guarded on the flag rather than dropped outright: a worker that
        // stops on its own, with no local Stop ahead of it, is the case this
        // branch has to keep reporting.
        const wasRunning = scriptExecutingRef.current;
        scriptExecutingRef.current = false;
        runningLanguageRef.current = null;
        setScriptRunning(false);
        setScriptRunnerStatus(message.message ?? 'Stopped');
        if (wasRunning) {
          appendLog('system', message.message ?? 'Stopped');
          notify(`${runnerName} Runner`, 'Script stopped.', { tag: NOTIFY_TAG.scriptRun });
          settleRun('stopped');
        }
      } else if (message.type === 'error') {
        scriptExecutingRef.current = false;
        runningLanguageRef.current = null;
        setScriptRunning(false);
        setScriptRunnerStatus(`Error: ${message.message}`);
        appendLog('stderr', message.traceback ?? message.message);
        // Sticky: a run that died is the one event worth leaving on screen
        // until someone actually looks at it.
        notify(`${runnerName} Runner error`, message.message, { tag: NOTIFY_TAG.scriptRun, sticky: true });
        settleRun('error', message.message, message.traceback ?? null);
      }
    };
    worker.onerror = (event) => {
      scriptExecutingRef.current = false;
      runningLanguageRef.current = null;
      setScriptRunning(false);
      setScriptRunnerStatus(`Error: ${event.message}`);
      appendLog('stderr', event.message);
      notify(`${runnerName} Runner error`, event.message, { tag: NOTIFY_TAG.scriptRun, sticky: true });
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

    workersRef.current.set(language, worker);
    return worker;
  }, [ensureShares, setAo, onAiCalibTare, appendLog, settleRun]);

  const stopScriptRunner = useCallback((nextStatus = 'Stopped') => {
    if (interruptBufferRef.current) {
      interruptBufferRef.current[0] = 2;
      // Only the worker that is actually executing. Every runtime reads the
      // shared byte directly, but the message is what covers the case where the
      // runtime has not started yet (Pyodide still booting), and sending it to
      // an idle worker would arm a Stop for that worker's next run.
      const language = runningLanguageRef.current;
      if (language) workersRef.current.get(language)?.postMessage({ type: 'interrupt' });
    }
    const wasRunning = scriptExecutingRef.current;
    scriptExecutingRef.current = false;
    runningLanguageRef.current = null;
    setScriptRunning(false);
    setScriptRunnerStatus(nextStatus);
    if (wasRunning) {
      appendLog('system', nextStatus);
      // Reporting the stop from here, rather than waiting for the worker's
      // 'interrupted' answer, is what covers the case where no answer comes
      // back at all (Pyodide was still booting). The answer that does arrive
      // sees scriptExecutingRef already false and stays quiet, so one press
      // writes one line.
      notify('Script Runner', 'Script stopped.', { tag: NOTIFY_TAG.scriptRun });
      settleRun('stopped');
    }
  }, [appendLog, settleRun]);

  // `codeOverride` exists because a caller that has just set new code cannot
  // rely on the `scriptCode` state having been applied yet.
  const startScriptRunner = useCallback((codeOverride?: string): ScriptRunInfo => {
    if (scriptExecutingRef.current) return scriptRunRef.current;
    // Each run starts from a clean log: mixing the output of two runs is how a
    // caller ends up reading a stale error as if it were its own.
    clearScriptLog();
    const info = beginRun();
    const language = scriptLanguageRef.current;
    try {
      const worker = ensureWorkerReady(language);
      if (interruptBufferRef.current) interruptBufferRef.current[0] = 0;
      scriptExecutingRef.current = true;
      runningLanguageRef.current = language;
      setScriptRunning(true);
      setScriptRunnerStatus('Running');
      worker.postMessage({ type: 'run', code: codeOverride ?? scriptCodeRef.current });
      notify(`${SCRIPT_LANGUAGES[language].label} Runner`, 'Script started.', { tag: NOTIFY_TAG.scriptRun });
      return info;
    } catch (err) {
      const text = (err as Error).message;
      scriptExecutingRef.current = false;
      runningLanguageRef.current = null;
      setScriptRunning(false);
      setScriptRunnerStatus(`Error: ${text}`);
      appendLog('stderr', text);
      notify('Script Runner error', text, { tag: NOTIFY_TAG.scriptRun, sticky: true });
      settleRun('error', text);
      return scriptRunRef.current;
    }
  }, [ensureWorkerReady, beginRun, clearScriptLog, appendLog, settleRun]);

  const toggleScriptRunner = useCallback(() => {
    if (scriptRunning) {
      stopScriptRunner('Stopped');
      return;
    }
    startScriptRunner();
  }, [scriptRunning, startScriptRunner, stopScriptRunner]);

  const clearScriptCode = useCallback(() => {
    setScriptCode(SCRIPT_LANGUAGES[scriptLanguageRef.current].defaultScript);
  }, []);

  /**
   * Switch language, saving the outgoing editor contents and loading the
   * incoming ones.
   *
   * Refused mid-run: the running worker belongs to the old language, and
   * swapping the editor and the Run button out from under it would leave Stop
   * pointing at a script the user can no longer see.
   */
  const setScriptLanguage = useCallback((next: ScriptLanguageId) => {
    const current = scriptLanguageRef.current;
    if (next === current || scriptExecutingRef.current) return;
    writeJsonStorage(SCRIPT_LANGUAGES[current].storageKey, scriptCodeRef.current);
    scriptLanguageRef.current = next;
    setScriptLanguageState(next);
    setScriptCode(loadCode(next));
    writeJsonStorage(SCRIPT_LANGUAGE_STORAGE_KEY, next);
  }, []);

  useEffect(() => {
    writeJsonStorage(SCRIPT_LANGUAGES[scriptLanguage].storageKey, scriptCode);
  }, [scriptCode, scriptLanguage]);

  useEffect(() => {
    const workers = workersRef.current;
    return () => {
      for (const worker of workers.values()) worker.terminate();
      workers.clear();
    };
  }, []);

  return {
    scriptRunnerSupported,
    scriptLanguage,
    setScriptLanguage,
    scriptCode,
    setScriptCode,
    scriptRunning,
    scriptRunnerStatus,
    scriptLog,
    clearScriptLog,
    scriptRun,
    toggleScriptRunner,
    stopScriptRunner,
    clearScriptCode,
    aiRawShareRef,
    aiPhysicalShareRef,
    aoShareRef,
    paramShareRef,
  };
}

/** Stored contents for `language`, or its example script on first use. */
function loadCode(language: ScriptLanguageId): string {
  const stored = readJsonStorage<string>(SCRIPT_LANGUAGES[language].storageKey);
  return stored ?? SCRIPT_LANGUAGES[language].defaultScript;
}
