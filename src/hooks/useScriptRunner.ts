import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_CHANNELS, AO_CHANNELS, PARAM_CHANNELS } from '../constants';
import { clearBackgroundTimer, setBackgroundTimeout } from '../utils/backgroundTimer';
import { notify, NOTIFY_TAG } from '../utils/notifications';
import {
  SCRIPT_LANGUAGES,
  type ScriptLanguageId,
} from '../utils/scriptLanguages';
import {
  SCRIPT_TABS_MAX,
  createTab,
  loadScriptTabs,
  sanitizeTabName,
  saveScriptTabs,
  tabsOfLanguage,
  type ScriptTab,
} from '../utils/scriptTabs';

// How many log lines are kept. A `while True:` loop that prints every iteration
// would grow without bound otherwise; the log is a tail, not a transcript.
//
// 100, not the 300 this started at. The cost that matters is not the bytes —
// it is that every printed line re-renders the panel and re-maps the whole
// array, on the same main thread the Modbus polling loop runs on, so the tail
// length is paid per line rather than once. A pane showing this can hold a few
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

/**
 * One line of what a script reported.
 *
 * Read in the Script Log window (components/ScriptLogPanel), which replaced the
 * pane inside the Script Runner when the editor took that height back, and in
 * the bottom status bar, which shows the newest line. The recording side is
 * independent of both: every stream is captured, capped and kept here whether or
 * not anything is displaying it.
 */
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
  // Open documents, and which one is in front. One state object rather than two:
  // closing a tab changes both, and a render that saw the new list against the
  // old active id would be pointing at a tab that no longer exists.
  const [tabState, setTabState] = useState<TabState>(() => ({ ...loadScriptTabs(), lastActive: {} }));
  const { tabs, activeId: activeTabId } = tabState;
  // The list is never empty (closeTab refuses the last one in a language), so
  // the fallback is only there to keep this total.
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  // The language of the tab in front IS the selected language: every operation
  // keeps the active tab inside the chosen language, so there is nothing to keep
  // a second copy of this in sync with.
  const scriptLanguage = activeTab.language;
  const scriptCode = activeTab.code;
  /** The strip on screen: the scripts written in the selected language. */
  const languageTabs = tabs.filter((tab) => tab.language === scriptLanguage);
  /** The tab whose code the worker is executing, or null when idle. */
  const [runningTabId, setRunningTabId] = useState<string | null>(null);
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
  const tabStateRef = useRef(tabState);
  tabStateRef.current = tabState;
  // Read by the edit guards, which run outside render (and by startScriptRunner,
  // which must not see the previous render's copy after a tab switch).
  const runningTabIdRef = useRef<string | null>(null);

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

  // Everything that says "nothing is executing any more". Collected because it
  // is done from six places (three worker messages, the worker's onerror, Stop,
  // and a failed start) and one of them forgetting the running tab would leave
  // that tab's editor read-only with no run behind it.
  const markRunFinished = useCallback(() => {
    scriptExecutingRef.current = false;
    runningLanguageRef.current = null;
    runningTabIdRef.current = null;
    setRunningTabId(null);
    setScriptRunning(false);
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
        markRunFinished();
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
        markRunFinished();
        setScriptRunnerStatus(message.message ?? 'Stopped');
        if (wasRunning) {
          appendLog('system', message.message ?? 'Stopped');
          notify(`${runnerName} Runner`, 'Script stopped.', { tag: NOTIFY_TAG.scriptRun });
          settleRun('stopped');
        }
      } else if (message.type === 'error') {
        markRunFinished();
        setScriptRunnerStatus(`Error: ${message.message}`);
        appendLog('stderr', message.traceback ?? message.message);
        // Sticky: a run that died is the one event worth leaving on screen
        // until someone actually looks at it.
        notify(`${runnerName} Runner error`, message.message, { tag: NOTIFY_TAG.scriptRun, sticky: true });
        settleRun('error', message.message, message.traceback ?? null);
      }
    };
    worker.onerror = (event) => {
      markRunFinished();
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
  }, [ensureShares, setAo, onAiCalibTare, appendLog, settleRun, markRunFinished]);

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
    markRunFinished();
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
  }, [appendLog, settleRun, markRunFinished]);

  // `codeOverride` exists because a caller that has just set new code cannot
  // rely on the `scriptCode` state having been applied yet.
  const startScriptRunner = useCallback((codeOverride?: string): ScriptRunInfo => {
    if (scriptExecutingRef.current) return scriptRunRef.current;
    // Each run starts from a clean log: mixing the output of two runs is how a
    // caller ends up reading a stale error as if it were its own.
    clearScriptLog();
    const info = beginRun();
    // The tab in front is the one that runs, and it stays the running tab for
    // the whole run even if the user pages over to another one.
    const tab = activeTabOf(tabStateRef.current);
    const language = tab.language;
    try {
      const worker = ensureWorkerReady(language);
      if (interruptBufferRef.current) interruptBufferRef.current[0] = 0;
      scriptExecutingRef.current = true;
      runningLanguageRef.current = language;
      runningTabIdRef.current = tab.id;
      setRunningTabId(tab.id);
      setScriptRunning(true);
      setScriptRunnerStatus('Running');
      worker.postMessage({ type: 'run', code: codeOverride ?? tab.code });
      notify(`${SCRIPT_LANGUAGES[language].label} Runner`, 'Script started.', { tag: NOTIFY_TAG.scriptRun });
      return info;
    } catch (err) {
      const text = (err as Error).message;
      markRunFinished();
      setScriptRunnerStatus(`Error: ${text}`);
      appendLog('stderr', text);
      notify('Script Runner error', text, { tag: NOTIFY_TAG.scriptRun, sticky: true });
      settleRun('error', text);
      return scriptRunRef.current;
    }
  }, [ensureWorkerReady, beginRun, clearScriptLog, appendLog, settleRun, markRunFinished]);

  const toggleScriptRunner = useCallback(() => {
    if (scriptRunning) {
      stopScriptRunner('Stopped');
      return;
    }
    startScriptRunner();
  }, [scriptRunning, startScriptRunner, stopScriptRunner]);

  /**
   * Edit the tab in front.
   *
   * Refused while that tab is the one executing. The worker was handed a copy of
   * the code at Run, so an edit made mid-run changes nothing about what is
   * actually running — but it changes what the error line numbers point at, and
   * it is the version that gets saved. An editor that quietly stops describing
   * the process controlling the rig is the failure worth preventing here, so the
   * running tab is frozen until it finishes or is stopped.
   */
  const setScriptCode = useCallback((code: string) => {
    setTabState((prev) => {
      if (prev.activeId === runningTabIdRef.current) return prev;
      return {
        ...prev,
        tabs: prev.tabs.map((tab) => (tab.id === prev.activeId ? { ...tab, code } : tab)),
      };
    });
  }, []);

  const clearScriptCode = useCallback(() => {
    setTabState((prev) => {
      if (prev.activeId === runningTabIdRef.current) return prev;
      return {
        ...prev,
        tabs: prev.tabs.map((tab) =>
          tab.id === prev.activeId
            ? { ...tab, code: SCRIPT_LANGUAGES[tab.language].defaultScript }
            : tab,
        ),
      };
    });
  }, []);

  /**
   * Switch which language's scripts are on screen.
   *
   * Not a change to any tab: a tab belongs to its language for life, and this
   * swaps the whole strip for that language's own. A language reached for the
   * first time gets one tab holding its example script.
   *
   * Refused for the length of a run. Since tabs can only be paged within one
   * language, holding the selector still is what guarantees the executing script
   * stays on screen — Run/Stop always means the tab with the marker on it, and
   * no part of the window has to explain in words where the run went.
   */
  const setScriptLanguage = useCallback((next: ScriptLanguageId) => {
    if (scriptExecutingRef.current) return;
    const state = tabStateRef.current;
    if (activeTabOf(state).language === next) return;
    const existing = tabsOfLanguage(state.tabs, next);
    // Minted out here rather than in the updater, which has to stay pure.
    const created = existing.length === 0 ? createTab(next, state.tabs) : null;
    setTabState((prev) => {
      const current = activeTabOf(prev);
      if (current.language === next) return prev;
      const lastActive = { ...prev.lastActive, [current.language]: current.id };
      if (created) return { tabs: [...prev.tabs, created], activeId: created.id, lastActive };
      // Back to whichever of that language's scripts was last in front, so
      // flipping between languages returns to where each was left.
      const remembered = prev.lastActive[next];
      const target = tabsOfLanguage(prev.tabs, next);
      const activeId = target.some((tab) => tab.id === remembered) ? remembered! : target[0].id;
      return { ...prev, activeId, lastActive };
    });
  }, []);

  const selectTab = useCallback((id: string) => {
    setTabState((prev) => (prev.tabs.some((tab) => tab.id === id) ? { ...prev, activeId: id } : prev));
  }, []);

  /** New tab in the selected language, and switch to it. */
  const addTab = useCallback(() => {
    const state = tabStateRef.current;
    const language = activeTabOf(state).language;
    if (tabsOfLanguage(state.tabs, language).length >= SCRIPT_TABS_MAX) return;
    // Built out here, not inside the updater: createTab() mints an id, and an
    // updater has to be pure — StrictMode runs it twice.
    const tab = createTab(language, state.tabs);
    setTabState((prev) =>
      tabsOfLanguage(prev.tabs, language).length >= SCRIPT_TABS_MAX
        ? prev
        : { ...prev, tabs: [...prev.tabs, tab], activeId: tab.id },
    );
  }, []);

  /**
   * Close a tab. Refused for the running one — closing it would leave a script
   * executing with no editor to read it in and no tab to stop it from — and for
   * the last one in its language, since selecting that language has to land
   * somewhere.
   *
   * The caller confirms first: the code in a tab exists nowhere else.
   */
  const closeTab = useCallback((id: string) => {
    setTabState((prev) => {
      if (id === runningTabIdRef.current) return prev;
      const target = prev.tabs.find((tab) => tab.id === id);
      if (!target || tabsOfLanguage(prev.tabs, target.language).length <= 1) return prev;
      const siblings = tabsOfLanguage(prev.tabs, target.language);
      const index = siblings.findIndex((tab) => tab.id === id);
      const tabs = prev.tabs.filter((tab) => tab.id !== id);
      // Closing the front tab lands on its right-hand neighbour *within the same
      // language*, or on the new last one when it was the rightmost — never on
      // some other language's script.
      const remaining = siblings.filter((tab) => tab.id !== id);
      const activeId =
        prev.activeId === id ? remaining[Math.min(index, remaining.length - 1)].id : prev.activeId;
      return { ...prev, tabs, activeId };
    });
  }, []);

  const renameTab = useCallback((id: string, name: string) => {
    setTabState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) =>
        tab.id === id ? { ...tab, name: sanitizeTabName(name, tab.language) } : tab,
      ),
    }));
  }, []);

  useEffect(() => {
    saveScriptTabs(tabs, activeTabId);
  }, [tabs, activeTabId]);

  useEffect(() => {
    const workers = workersRef.current;
    return () => {
      for (const worker of workers.values()) worker.terminate();
      workers.clear();
    };
  }, []);

  return {
    scriptRunnerSupported,
    /** Only the selected language's scripts — the strip the panel draws. */
    tabs: languageTabs,
    activeTabId,
    activeTab,
    runningTabId,
    /**
     * The executing script, whichever language it belongs to — the panel's
     * `tabs` above cannot answer this, since the strip on screen may be a
     * different language's.
     */
    runningTab: tabs.find((tab) => tab.id === runningTabId) ?? null,
    canAddTab: languageTabs.length < SCRIPT_TABS_MAX,
    canCloseTab: languageTabs.length > 1,
    selectTab,
    addTab,
    closeTab,
    renameTab,
    /** False while the tab in front is the one executing: its editor is frozen. */
    scriptEditable: runningTabId !== activeTabId,
    /**
     * Which language the status bar should name. The running one, when there is
     * one: paging to another tab mid-run must not make the bar report a runtime
     * that is not the one executing.
     */
    statusLanguage: tabs.find((tab) => tab.id === runningTabId)?.language ?? scriptLanguage,
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

type TabState = {
  /** Every open script, of every language. */
  tabs: ScriptTab[];
  activeId: string;
  /**
   * The tab each language was last left on, so switching language twice comes
   * back to the same script rather than to the first in the strip. Not
   * persisted: it is a within-session convenience, and on reload the stored
   * activeId already points at the one script that matters.
   */
  lastActive: Partial<Record<ScriptLanguageId, string>>;
};

/** The tab in front. Total: `tabs` is never empty (see closeTab). */
const activeTabOf = (state: TabState): ScriptTab =>
  state.tabs.find((tab) => tab.id === state.activeId) ?? state.tabs[0];
