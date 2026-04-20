import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.mjs';

type PyodideLike = {
  setInterruptBuffer: (buffer: Uint8Array) => void;
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: {
    set: (name: string, value: unknown) => void;
  };
};

type WorkerIncomingMessage =
  | { type: 'init'; rawSab: SharedArrayBuffer; phySab: SharedArrayBuffer; intSab: SharedArrayBuffer; verSab: SharedArrayBuffer }
  | { type: 'run'; code: string }
  | { type: 'interrupt' };

let pyodide: PyodideLike | null = null;
let initPromise: Promise<void> | null = null;
let running = false;
let aiRawShare: Float64Array | null = null;
let aiPhysicalShare: Float64Array | null = null;
let interruptBuffer: Uint8Array | null = null;
let versionBuffer: Int32Array | null = null;

const postWorkerMessage = (message: Record<string, unknown>) => {
  self.postMessage(message);
};

const readAiValue = (buffer: Float64Array | null, ch: number): number => {
  if (!buffer) return 0;
  if (!Number.isInteger(ch) || ch < 0 || ch >= buffer.length) return 0;
  return buffer[ch] ?? 0;
};

const readAiAll = (buffer: Float64Array | null): number[] => {
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

const initializePyodide = async (rawSab: SharedArrayBuffer, phySab: SharedArrayBuffer, intSab: SharedArrayBuffer, verSab: SharedArrayBuffer) => {
  postWorkerMessage({ type: 'status', message: 'Initializing Pyodide...' });

  aiRawShare = new Float64Array(rawSab);
  aiPhysicalShare = new Float64Array(phySab);
  interruptBuffer = new Uint8Array(intSab);
  versionBuffer = new Int32Array(verSab);

  pyodide = await loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/',
  }) as PyodideLike;

  pyodide.setInterruptBuffer(interruptBuffer);
  pyodide.globals.set('get_ai_raw', (ch: number) => readAiValue(aiRawShare, Number(ch)));
  pyodide.globals.set('get_ai_raw_all', () => readAiAll(aiRawShare));
  pyodide.globals.set('get_ai_phy', (ch: number) => readAiValue(aiPhysicalShare, Number(ch)));
  pyodide.globals.set('get_ai_phy_all', () => readAiAll(aiPhysicalShare));
  pyodide.globals.set('set_ao', (ch: number, data: number) => {
    postWorkerMessage({ type: 'set_ao', ch: Number(ch), data: Number(data) });
  });
  pyodide.globals.set('set_ao_all', (data: unknown) => {
    if (!Array.isArray(data)) return;
    data.forEach((value, index) => {
      postWorkerMessage({ type: 'set_ao', ch: index, data: Number(value) });
    });
  });

  postWorkerMessage({ type: 'status', message: 'Ready' });
};

self.onmessage = async (event: MessageEvent<WorkerIncomingMessage>) => {
  const message = event.data;

  if (message.type === 'init') {
    if (!initPromise) {
      initPromise = initializePyodide(message.rawSab, message.phySab, message.intSab, message.verSab);
    }
    try {
      await initPromise;
    } catch (err) {
      postWorkerMessage({ type: 'error', message: (err as Error).message });
    }
    return;
  }

  if (message.type === 'interrupt') {
    if (interruptBuffer) interruptBuffer[0] = 2;
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
      await pyodide.runPythonAsync(message.code);
      postWorkerMessage({ type: 'done', message: 'Completed' });
    } catch (err) {
      const error = err as Error;
      const text = error.message ?? String(error);
      if (text.includes('KeyboardInterrupt')) {
        postWorkerMessage({ type: 'interrupted', message: 'Stopped' });
      } else {
        postWorkerMessage({ type: 'error', message: text });
      }
    } finally {
      running = false;
      if (interruptBuffer) interruptBuffer[0] = 0;
    }
  }
};
