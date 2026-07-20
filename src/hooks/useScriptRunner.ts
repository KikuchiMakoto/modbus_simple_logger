import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_CHANNELS, AO_CHANNELS, PARAM_CHANNELS } from '../constants';
import { readJsonStorage, writeJsonStorage } from '../utils/cookies';

const SCRIPT_RUNNER_STORAGE_KEY = 'scriptRunnerCode';

export function useScriptRunner(setAo: (ch: number, data: number) => void) {
  const scriptRunnerSupported = typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated;
  const [scriptCode, setScriptCode] = useState(() => {
    const stored = readJsonStorage<string>(SCRIPT_RUNNER_STORAGE_KEY);
    return stored ?? getDefaultScript();
  });
  const [scriptRunning, setScriptRunning] = useState(false);
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

  const ensureWorkerReady = useCallback((): Worker => {
    if (pyWorkerRef.current) return pyWorkerRef.current;
    if (!scriptRunnerSupported) {
      throw new Error(
        'ScriptRunner requires cross-origin isolation (COOP/COEP headers). Reload once after Service Worker installation.',
      );
    }

    const rawSab = new SharedArrayBuffer(AI_CHANNELS * Float32Array.BYTES_PER_ELEMENT);
    const phySab = new SharedArrayBuffer(AI_CHANNELS * Float32Array.BYTES_PER_ELEMENT);
    const aoSab = new SharedArrayBuffer(AO_CHANNELS * Float32Array.BYTES_PER_ELEMENT);
    const paramSab = new SharedArrayBuffer(PARAM_CHANNELS * Float32Array.BYTES_PER_ELEMENT);
    const intSab = new SharedArrayBuffer(1);

    aiRawShareRef.current = new Float32Array(rawSab);
    aiPhysicalShareRef.current = new Float32Array(phySab);
    aoShareRef.current = new Float32Array(aoSab);
    paramShareRef.current = new Float32Array(paramSab);
    interruptBufferRef.current = new Uint8Array(intSab);

    const worker = new Worker(new URL('../pyodideWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as
        | { type: 'set_ao'; ch: number; data: number }
        | { type: 'status'; message: string }
        | { type: 'done'; message?: string }
        | { type: 'interrupted'; message?: string }
        | { type: 'error'; message: string };
      if (message.type === 'set_ao') {
        setAo(message.ch, message.data);
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
  }, [scriptRunnerSupported, setAo]);

  const stopScriptRunner = useCallback((nextStatus = 'Stopped') => {
    if (interruptBufferRef.current) {
      interruptBufferRef.current[0] = 2;
      pyWorkerRef.current?.postMessage({ type: 'interrupt' });
    }
    scriptExecutingRef.current = false;
    setScriptRunning(false);
    setScriptRunnerStatus(nextStatus);
  }, []);

  const startScriptRunner = useCallback(async () => {
    if (scriptExecutingRef.current) return;
    try {
      const worker = ensureWorkerReady();
      if (interruptBufferRef.current) interruptBufferRef.current[0] = 0;
      scriptExecutingRef.current = true;
      setScriptRunning(true);
      setScriptRunnerStatus('Running');
      worker.postMessage({ type: 'run', code: scriptCode });
    } catch (err) {
      scriptExecutingRef.current = false;
      setScriptRunning(false);
      stopScriptRunner(`Error: ${(err as Error).message}`);
    }
  }, [ensureWorkerReady, scriptCode, stopScriptRunner]);

  const toggleScriptRunner = useCallback(() => {
    if (scriptRunning) {
      stopScriptRunner('Stopped');
      return;
    }
    void startScriptRunner();
  }, [scriptRunning, startScriptRunner, stopScriptRunner]);

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
    scriptRunnerStatus,
    toggleScriptRunner,
    stopScriptRunner,
    clearScriptCode,
    aiRawShareRef,
    aiPhysicalShareRef,
    aoShareRef,
    paramShareRef,
  };
}

function getDefaultScript(): string {
  return `# get_ai_raw(ch): Read raw AI value for a channel.
# get_ai_phy(ch): Read calibrated AI value for a channel.
# set_ao(ch, data): Write AO voltage in V (internally clamped to 0-10V).
# get_ao(ch): Read back AO voltage in V. set_ao() is applied asynchronously,
#   so get_ao() right after a set_ao() still sees the previous value.
# get_param(ch) / set_param(ch, data): Read/write a scratch Parameter value (0-7).
#   Parameters are always 0 at app startup and are not persisted; they exist
#   only to pass values from the script into the Parameter display and TSV log.
#
# To use wait/sleep, do NOT use time.sleep() as it freezes the browser.
# This runner executes scripts in an async context (top-level await supported).
# Use asyncio instead:
# import asyncio
# await asyncio.sleep(1)
#
# Press Stop to halt execution at any time. Plain async while/for loops are
# stopped immediately - no special stop checks are needed in your script.`;
}
