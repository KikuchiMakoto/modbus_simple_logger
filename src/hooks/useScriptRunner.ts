import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_CHANNELS, AO_CHANNELS, PARAM_CHANNELS } from '../constants';
import { logSystem, SOURCE, type SystemLogLevel } from '../utils/systemLog';
import {
  SCRIPT_LANGUAGES,
  type ScriptLanguageId,
} from '../utils/scriptLanguages';
import {
  SCRIPT_TABS_MAX,
  createTab,
  loadScriptTabs,
  newTabId,
  sanitizeTabName,
  saveScriptTabs,
  tabsOfLanguage,
  uniqueTabName,
  type ScriptTab,
} from '../utils/scriptTabs';
import {
  INTERRUPT_NONE,
  INTERRUPT_PENDING,
  type ScriptWorkerRequest,
  type ScriptWorkerResponse,
} from '../utils/scriptWorkerProtocol';

/**
 * What a worker's output stream means in log terms.
 *
 * A script has no way to state a severity — it prints, or it fails — so the
 * stream it printed on is the only signal there is, and it maps onto exactly two
 * levels. INFO for output is the point of the default threshold: `print()` is
 * the run's story, which is what INFO is for. stderr carries the tracebacks.
 */
const STREAM_LEVEL: Record<'stdout' | 'stderr' | 'system', SystemLogLevel> = {
  stdout: 'INFO',
  stderr: 'ERROR',
  /** The runner's own start/stop lines, not the script's. */
  system: 'INFO',
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
  setParamLabel: (ch: number, text: string) => void,
) {
  const scriptRunnerSupported = typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated;
  // Open documents, and which one is in front. One state object rather than two:
  // closing a tab changes both, and a render that saw the new list against the
  // old active id would be pointing at a tab that no longer exists.
  const [tabState, setTabState] = useState<TabState>(() => loadScriptTabs());
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
  const [scriptRun, setScriptRun] = useState<ScriptRunInfo>(IDLE_RUN);
  const scriptExecutingRef = useRef(false);
  /**
   * The tag new lines are filed under — the name of the script that is running.
   * Held from the moment Run is pressed until the next Run, so the lines that
   * arrive after a script ends ("Stopped", a traceback) still name the script
   * they are about. Before anything has ever been run it is the runner itself,
   * which is what the "requires cross-origin isolation" line comes out as.
   */
  const logSourceRef = useRef<string>(SOURCE.runner);
  const scriptRunRef = useRef<ScriptRunInfo>(IDLE_RUN);
  const runIdRef = useRef(0);
  // One worker per language, kept alive once created. Pyodide costs seconds to
  // boot, so it is worth not tearing down between runs. The map is keyed by
  // language for historical reasons (it used to hold BASIC and Lua workers
  // too); with only Python left it holds at most one entry.
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

  // Everything a script or the runner says goes into the app's one log, tagged
  // with the script's name. The trimming, the line cap and the collapsing of
  // identical consecutive lines all live there now — a `while True:` printing
  // one unchanging line is the case that used to fill the whole tail with it.
  const appendLog = useCallback((stream: 'stdout' | 'stderr' | 'system', text: string) => {
    logSystem(STREAM_LEVEL[stream], logSourceRef.current, text);
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

    // Static `new URL(...)` literal: this is how the bundler finds a worker
    // entry point and emits it, so the path cannot come from the table in
    // scriptLanguages.ts.
    const worker = new Worker(new URL('../pyodideWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ScriptWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'set_ao') {
        setAo(message.ch, message.data);
      } else if (message.type === 'set_ai_tare') {
        onAiCalibTare(message.ch);
      } else if (message.type === 'set_param_label') {
        setParamLabel(message.ch, message.text);
      } else if (message.type === 'status') {
        setScriptRunnerStatus(message.message);
      } else if (message.type === 'output') {
        appendLog(message.stream, message.text);
      } else if (message.type === 'done') {
        markRunFinished();
        setScriptRunnerStatus(message.message ?? 'Completed');
        appendLog('system', message.message ?? 'Completed');
        settleRun('completed');
      } else if (message.type === 'interrupted') {
        // This is the worker CONFIRMING a Stop that stopScriptRunner already
        // reported the moment it was requested — so the end of the run has
        // normally been recorded once already, and recording it again wrote
        // "Stopped" into the log twice for one press.
        //
        // Still guarded on the flag rather than dropped outright: a worker that
        // stops on its own, with no local Stop ahead of it, is the case this
        // branch has to keep reporting.
        const wasRunning = scriptExecutingRef.current;
        markRunFinished();
        setScriptRunnerStatus(message.message ?? 'Stopped');
        if (wasRunning) {
          appendLog('system', message.message ?? 'Stopped');
          settleRun('stopped');
        }
      } else if (message.type === 'error') {
        markRunFinished();
        setScriptRunnerStatus(`Error: ${message.message}`);
        appendLog('stderr', message.traceback ?? message.message);
        settleRun('error', message.message, message.traceback ?? null);
      }
    };
    worker.onerror = (event) => {
      markRunFinished();
      setScriptRunnerStatus(`Error: ${event.message}`);
      appendLog('stderr', event.message);
      settleRun('error', event.message);
    };

    const init: ScriptWorkerRequest = {
      type: 'init',
      rawSab,
      phySab,
      aoSab,
      paramSab,
      intSab,
    };
    worker.postMessage(init);

    workersRef.current.set(language, worker);
    return worker;
  }, [ensureShares, setAo, onAiCalibTare, setParamLabel, appendLog, settleRun, markRunFinished]);

  const stopScriptRunner = useCallback((nextStatus = 'Stopped') => {
    if (interruptBufferRef.current) {
      interruptBufferRef.current[0] = INTERRUPT_PENDING;
      // Only the worker that is actually executing. Every runtime reads the
      // shared byte directly, but the message is what covers the case where the
      // runtime has not started yet (Pyodide still booting), and sending it to
      // an idle worker would arm a Stop for that worker's next run.
      const language = runningLanguageRef.current;
      const interrupt: ScriptWorkerRequest = { type: 'interrupt' };
      if (language) workersRef.current.get(language)?.postMessage(interrupt);
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
      settleRun('stopped');
    }
  }, [appendLog, settleRun, markRunFinished]);

  // `codeOverride` exists because a caller that has just set new code cannot
  // rely on the `scriptCode` state having been applied yet.
  const startScriptRunner = useCallback((codeOverride?: string): ScriptRunInfo => {
    if (scriptExecutingRef.current) return scriptRunRef.current;
    const info = beginRun();
    // The tab in front is the one that runs, and it stays the running tab for
    // the whole run even if the user pages over to another one.
    const tab = activeTabOf(tabStateRef.current);
    const language = tab.language;
    // Stamped on every line from here on, including the ones that arrive after
    // the run ends. Not cleared when it does — see logSourceRef.
    logSourceRef.current = tab.name;
    try {
      const worker = ensureWorkerReady(language);
      if (interruptBufferRef.current) interruptBufferRef.current[0] = INTERRUPT_NONE;
      scriptExecutingRef.current = true;
      runningLanguageRef.current = language;
      runningTabIdRef.current = tab.id;
      setRunningTabId(tab.id);
      setScriptRunning(true);
      setScriptRunnerStatus('Running');
      // The log is no longer cleared at the start of a run — it holds the link
      // and save events either side of it, which a Run has no business
      // destroying — so this line is what separates one run's output from the
      // last one's.
      appendLog('system', `Run started (${SCRIPT_LANGUAGES[language].label})`);
      const run: ScriptWorkerRequest = { type: 'run', code: codeOverride ?? tab.code };
      worker.postMessage(run);
      return info;
    } catch (err) {
      const text = (err as Error).message;
      markRunFinished();
      setScriptRunnerStatus(`Error: ${text}`);
      appendLog('stderr', text);
      settleRun('error', text);
      return scriptRunRef.current;
    }
  }, [ensureWorkerReady, beginRun, appendLog, settleRun, markRunFinished]);

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
   * A script from disk, as a new tab in front.
   *
   * Always a NEW tab, never the one on screen: an import that overwrote the
   * open script would be the one destructive operation in this panel with no
   * gesture in front of it. `desired` is a suggestion — it is deduplicated
   * against the strip, since importing the same file twice is normal.
   *
   * Returns the name the tab actually got, or null when it was refused (the
   * strip is full, or a script is running — see the panel's disabled state; the
   * check is repeated here because the file picker is asynchronous and a run
   * can start while it is open).
   */
  const importTab = useCallback((desired: string, code: string): string | null => {
    const state = tabStateRef.current;
    const language = activeTabOf(state).language;
    if (scriptExecutingRef.current) return null;
    if (tabsOfLanguage(state.tabs, language).length >= SCRIPT_TABS_MAX) return null;
    // Minted out here for the same reason addTab does it: an updater has to be
    // pure, and StrictMode runs it twice.
    const tab: ScriptTab = {
      id: newTabId(),
      name: uniqueTabName(sanitizeTabName(desired), state.tabs, language),
      language,
      code,
    };
    setTabState((prev) =>
      tabsOfLanguage(prev.tabs, language).length >= SCRIPT_TABS_MAX
        ? prev
        : { ...prev, tabs: [...prev.tabs, tab], activeId: tab.id },
    );
    return tab.name;
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
        tab.id === id ? { ...tab, name: sanitizeTabName(name) } : tab,
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
    importTab,
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
    /**
     * Which script the status bar should name — the running one when there is
     * one, for the same reason as the language above: paging to another tab
     * mid-run must not make the bar report a script that is not executing.
     */
    statusTabName: tabs.find((tab) => tab.id === runningTabId)?.name ?? activeTab.name,
    scriptLanguage,
    scriptCode,
    setScriptCode,
    scriptRunning,
    scriptRunnerStatus,
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
  /** Every open script. */
  tabs: ScriptTab[];
  activeId: string;
};

/** The tab in front. Total: `tabs` is never empty (see closeTab). */
const activeTabOf = (state: TabState): ScriptTab =>
  state.tabs.find((tab) => tab.id === state.activeId) ?? state.tabs[0];
