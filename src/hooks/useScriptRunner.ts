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
  return `# get_ai_raw(ch) / get_ai_phy(ch): AI value. ch: 0-15.
# get_ao(ch) / set_ao(ch, v): AO voltage [V], clamped to 0-10, applied async. ch: 0-7.
# get_param(ch) / set_param(ch, v): scratch value, shown in Parameter panel + TSV. ch: 0-7.
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
