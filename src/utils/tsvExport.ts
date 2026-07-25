/**
 * TSV (Tab-Separated Values) export — main-thread side.
 *
 * Row formatting, buffering, join() and stream.write() all run in a dedicated
 * Web Worker (src/tsvWriterWorker.ts) so high-sampling-rate saving no longer
 * hitches the main thread at flush time. This module keeps the parts that must
 * stay on the main thread — the showSaveFilePicker() user gesture — and exposes
 * a small proxy (TsvSink) that forwards rows/flush/close to the worker.
 *
 * Pure formatting helpers live in ./tsvFormat and are re-exported here for
 * backward compatibility.
 */
import type { FileSystemFileHandle } from '../types';
import type {
  TsvInitMessage,
  TsvRowMessage,
  TsvWorkerResponse,
} from './tsvWorkerProtocol';

export { formatTimestamp, createTsvHeader, formatTsvRow } from './tsvFormat';

// Safety net for close(): if the worker has died and can never reply 'closed',
// force-terminate after this long so Stop Save / Disconnect never hang on the
// await. A normal drain is ≤ TSV_FLUSH_MAX_ROWS rows (sub-second), so hitting
// this means something is genuinely wrong; the file may lose its final rows,
// which is reported via onError.
const CLOSE_TIMEOUT_MS = 10_000;

/**
 * Streaming TSV sink. Backed by a Web Worker; every method forwards to it.
 * `writeRow` and `flush` are fire-and-forget (failures surface via the
 * `onError` callback passed to `createTsvWriter`), while `close` resolves once
 * the worker has drained its buffer and closed the file.
 */
export interface TsvSink {
  getFileName(): string;
  writeRow(
    timestamp: number,
    aiRaw: Float32Array | number[],
    aiPhysical: Float32Array | number[],
    aoRaw: Float32Array | number[],
    aiVoltage: Float32Array | number[],
    paramValues?: Float32Array | number[],
  ): void;
  flush(): void;
  close(): Promise<void>;
}

class TsvWorkerWriter implements TsvSink {
  private worker: Worker;
  private fileName: string;
  private onError: (message: string) => void;
  private closePromise: Promise<void> | null = null;
  private closeResolve: (() => void) | null = null;
  private closeTimeout: number | undefined;

  constructor(worker: Worker, fileName: string, onError: (message: string) => void) {
    this.worker = worker;
    this.fileName = fileName;
    this.onError = onError;
    worker.addEventListener('message', (event: MessageEvent<TsvWorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'error') {
        onError(msg.message);
      } else if (msg.type === 'closed') {
        window.clearTimeout(this.closeTimeout);
        this.closeResolve?.();
        this.worker.terminate();
      }
    });
    worker.addEventListener('error', (event) => onError(event.message || 'TSV worker error'));
  }

  getFileName(): string {
    return this.fileName;
  }

  writeRow(
    timestamp: number,
    aiRaw: Float32Array | number[],
    aiPhysical: Float32Array | number[],
    aoRaw: Float32Array | number[],
    aiVoltage: Float32Array | number[],
    paramValues: Float32Array | number[] = [],
  ): void {
    const message: TsvRowMessage = {
      type: 'row',
      timestamp,
      aiRaw,
      aiPhysical,
      aoRaw,
      aiVoltage,
      param: paramValues,
    };
    // Structured-clone (no transfer list) so the caller's Float32Arrays — some
    // of which are shared with the chart/display path — are copied, not
    // neutered.
    this.worker.postMessage(message);
  }

  flush(): void {
    this.worker.postMessage({ type: 'flush' });
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closePromise = new Promise<void>((resolve) => {
        this.closeResolve = resolve;
        // Never let the caller's await hang: if the worker cannot reply
        // 'closed' (hard crash), force-terminate and resolve anyway.
        this.closeTimeout = window.setTimeout(() => {
          this.onError('TSV close timed out; the file may be missing its final rows.');
          this.worker.terminate();
          resolve();
        }, CLOSE_TIMEOUT_MS);
      });
      this.worker.postMessage({ type: 'close' });
    }
    return this.closePromise;
  }
}

/**
 * Create a TSV file picker and initialize a worker-backed TsvSink.
 * @param aiChannels - Number of AI channels
 * @param aoChannels - Number of AO channels
 * @param suggestedName - Suggested filename (default: auto-generated with timestamp)
 * @param physicalPrecision - Decimal places for physical values (default: 3)
 * @param paramChannels - Number of Parameter channels (default: 0)
 * @param flushMaxRows - Buffered-row count that triggers a flush (0 disables; default: 0)
 * @param onError - Called with a message when a worker write/flush/close fails
 * @param onPickerSettled - Called as soon as the file picker closes (whether it
 *   returned a handle or the user cancelled), before the worker opens the file.
 *   On Android the picker is a separate system activity that backgrounds — and
 *   may freeze — the page for as long as it is open, so callers use this to
 *   bracket work that must not be in flight meanwhile.
 * @param aiRawAsFloat - When true, AI raw columns use the float formatter
 *   (used in Modbus extended precision mode). Default false (int output).
 * @returns TsvSink instance (header already written)
 * @throws Error if File System Access API is not supported, the user cancels,
 *   or the worker fails to open the file
 */
export async function createTsvWriter(
  aiChannels: number,
  aoChannels: number,
  suggestedName?: string,
  physicalPrecision: number = 3,
  paramChannels: number = 0,
  flushMaxRows: number = 0,
  onError: (message: string) => void = () => {},
  onPickerSettled: () => void = () => {},
  aiRawAsFloat: boolean = false,
): Promise<TsvSink> {
  if (!('showSaveFilePicker' in window)) {
    throw new Error('File System Access API not supported in this browser');
  }

  const now = new Date();
  const defaultName = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.tsv`;
  const filename = suggestedName ?? defaultName;

  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: 'TSV Files',
          accept: { 'text/tab-separated-values': ['.tsv'] },
        },
      ],
    });
  } finally {
    // Runs on cancel/error too, so a caller that paused work for the picker
    // always resumes it.
    onPickerSettled();
  }
  const fileName = fileHandle.name;

  const worker = new Worker(new URL('../tsvWriterWorker.ts', import.meta.url), { type: 'module' });

  const initMessage: TsvInitMessage = {
    type: 'init',
    fileHandle,
    aiChannels,
    aoChannels,
    paramChannels,
    physicalPrecision,
    aiRawAsFloat,
    flushMaxRows,
  };

  // Wait for the worker to open the file and write the header before returning.
  // Reject (and tear the worker down) if init fails, so the caller's try/catch
  // can surface it exactly like the previous synchronous createWritable().
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onErr);
    };
    const onMessage = (event: MessageEvent<TsvWorkerResponse>) => {
      if (event.data.type === 'ready') {
        cleanup();
        resolve();
      } else if (event.data.type === 'error') {
        cleanup();
        worker.terminate();
        reject(new Error(event.data.message));
      }
    };
    const onErr = (event: ErrorEvent) => {
      cleanup();
      worker.terminate();
      reject(new Error(event.message || 'TSV worker failed to start'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onErr);
    worker.postMessage(initMessage);
  });

  return new TsvWorkerWriter(worker, fileName, onError);
}
