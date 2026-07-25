import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_CHANNELS, AO_CHANNELS, PARAM_CHANNELS } from '../constants';
import { readJsonStorage, writeJsonStorage } from '../utils/cookies';

const SCRIPT_RUNNER_STORAGE_KEY = 'scriptRunnerCode';
const SCRIPT_RUNNER_BACKUP_KEY = 'scriptRunnerCodeBackup';

// Who started the current (or most recent) run. The MCP bridge overwrites the
// editor contents when it runs a script, so the UI needs to say so.
export type ScriptSource = 'user' | 'mcp';

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
  const scriptExecutingRef = useRef(false);
  const pyWorkerRef = useRef<Worker | null>(null);
  const interruptBufferRef = useRef<Uint8Array | null>(null);
  const aiRawShareRef = useRef<Float32Array | null>(null);
  const aiPhysicalShareRef = useRef<Float32Array | null>(null);
  const aoShareRef = useRef<Float32Array | null>(null);
  const paramShareRef = useRef<Float32Array | null>(null);
  const scriptCodeRef = useRef(scriptCode);
  scriptCodeRef.current = scriptCode;

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
        | { type: 'done'; message?: string }
        | { type: 'interrupted'; message?: string }
        | { type: 'error'; message: string };
      if (message.type === 'set_ao') {
        setAo(message.ch, message.data);
      } else if (message.type === 'set_ai_tare') {
        onAiCalibTare(message.ch);
      } else if (message.type === 'status') {
        setScriptRunnerStatus(message.message);
      } else if (message.type === 'done') {
        scriptExecutingRef.current = false;
        setScriptRunning(false);
        setScriptRunnerStatus(message.message ?? 'Completed');
      } else if (message.type === 'interrupted') {
        scriptExecutingRef.current = false;
        setScriptRunning(false);
        setScriptRunnerStatus(message.message ?? 'Stopped');
      } else if (message.type === 'error') {
        scriptExecutingRef.current = false;
        setScriptRunning(false);
        setScriptRunnerStatus(`Error: ${message.message}`);
      }
    };
    worker.onerror = (event) => {
      scriptExecutingRef.current = false;
      setScriptRunning(false);
      setScriptRunnerStatus(`Error: ${event.message}`);
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
  }, [scriptRunnerSupported, setAo, onAiCalibTare]);

  const stopScriptRunner = useCallback((nextStatus = 'Stopped') => {
    if (interruptBufferRef.current) {
      interruptBufferRef.current[0] = 2;
      pyWorkerRef.current?.postMessage({ type: 'interrupt' });
    }
    scriptExecutingRef.current = false;
    setScriptRunning(false);
    setScriptRunnerStatus(nextStatus);
  }, []);

  // `codeOverride` exists because a caller that has just set new code cannot
  // rely on the `scriptCode` state having been applied yet (see runScriptFromMcp).
  const startScriptRunner = useCallback(async (codeOverride?: string) => {
    if (scriptExecutingRef.current) return;
    try {
      const worker = ensureWorkerReady();
      if (interruptBufferRef.current) interruptBufferRef.current[0] = 0;
      scriptExecutingRef.current = true;
      setScriptRunning(true);
      setScriptRunnerStatus('Running');
      worker.postMessage({ type: 'run', code: codeOverride ?? scriptCodeRef.current });
    } catch (err) {
      scriptExecutingRef.current = false;
      setScriptRunning(false);
      stopScriptRunner(`Error: ${(err as Error).message}`);
    }
  }, [ensureWorkerReady, stopScriptRunner]);

  const toggleScriptRunner = useCallback(() => {
    if (scriptRunning) {
      stopScriptRunner('Stopped');
      return;
    }
    setScriptSource('user');
    void startScriptRunner();
  }, [scriptRunning, startScriptRunner, stopScriptRunner]);

  // Run code submitted over the MCP bridge. The editor is a single shared
  // buffer, so the user's code is saved to a backup slot first and can be
  // restored from the ScriptRunner panel.
  const runScriptFromMcp = useCallback((code: string) => {
    if (scriptExecutingRef.current) {
      throw new Error('A script is already running. Call stop_script first.');
    }
    writeJsonStorage(SCRIPT_RUNNER_BACKUP_KEY, scriptCodeRef.current);
    setHasScriptBackup(true);
    scriptCodeRef.current = code;
    setScriptCode(code);
    setScriptSource('mcp');
    void startScriptRunner(code);
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
# get_param(ch) / set_param(ch, val): scratch value, shown in Parameter panel + TSV. ch: 0-7.
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
