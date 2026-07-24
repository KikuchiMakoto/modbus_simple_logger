// TSV writer Web Worker. Owns the FileSystemWritableFileStream and performs all
// row formatting, buffering, join() and stream.write() off the main thread, so
// high-sampling-rate saving no longer produces periodic main-thread hitches at
// flush time. The main thread (createTsvWriter in utils/tsvExport.ts) keeps the
// showSaveFilePicker() user gesture and hands the resulting FileSystemFileHandle
// here; this worker calls createWritable() and owns everything after that.
import { createTsvHeader, formatTsvRow } from './utils/tsvFormat';
import type { TsvWorkerRequest, TsvWorkerResponse } from './utils/tsvWorkerProtocol';

let stream: FileSystemWritableFileStream | null = null;
let writeBuffer: string[] = [];
// Serializes flushes so the row-count trigger, the periodic 'flush' message, and
// 'close' can never issue overlapping stream.write() calls (which could
// interleave and corrupt the file). Always kept resolved so one failed write
// does not stall every later flush.
let flushChain: Promise<void> = Promise.resolve();
let physicalPrecision = 3;
let flushMaxRows = 0;
let aiChannels = 0;
let aoChannels = 0;
let paramChannels = 0;

function post(message: TsvWorkerResponse): void {
  self.postMessage(message);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function flush(): Promise<void> {
  const next = flushChain.then(drainBuffer, drainBuffer);
  flushChain = next.catch(() => {});
  return next;
}

async function drainBuffer(): Promise<void> {
  if (!stream || writeBuffer.length === 0) return;
  const data = writeBuffer.join('');
  writeBuffer = [];
  await stream.write(data);
}

function assertLength(name: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`Invalid ${name} column count: expected ${expected}, got ${actual}.`);
  }
}

self.onmessage = async (event: MessageEvent<TsvWorkerRequest>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init': {
        physicalPrecision = msg.physicalPrecision;
        flushMaxRows = msg.flushMaxRows;
        aiChannels = msg.aiChannels;
        aoChannels = msg.aoChannels;
        paramChannels = msg.paramChannels;
        stream = await msg.fileHandle.createWritable();
        await stream.write(createTsvHeader(aiChannels, aoChannels, paramChannels));
        post({ type: 'ready' });
        break;
      }
      case 'row': {
        if (!stream) return;
        assertLength('AI raw', msg.aiRaw.length, aiChannels);
        assertLength('AI physical', msg.aiPhysical.length, aiChannels);
        assertLength('AO raw', msg.aoRaw.length, aoChannels);
        assertLength('AI voltage', msg.aiVoltage.length, aiChannels);
        assertLength('Parameter values', msg.param.length, paramChannels);
        writeBuffer.push(
          formatTsvRow(msg.timestamp, msg.aiRaw, msg.aiPhysical, msg.aoRaw, msg.aiVoltage, msg.param, physicalPrecision),
        );
        // Row-count-based flush: cap each flush's join()+write() work regardless
        // of sampling rate (whichever comes first with the periodic 'flush').
        if (flushMaxRows > 0 && writeBuffer.length >= flushMaxRows) {
          flush().catch((err) => post({ type: 'error', message: errorMessage(err) }));
        }
        break;
      }
      case 'flush': {
        flush().catch((err) => post({ type: 'error', message: errorMessage(err) }));
        break;
      }
      case 'close': {
        // Drain and close, then always reply 'closed' so the main thread's
        // await never hangs — even if the final write/close failed (reported
        // separately via 'error').
        try {
          await flush();
          if (stream) await stream.close();
        } catch (err) {
          post({ type: 'error', message: errorMessage(err) });
        } finally {
          stream = null;
          post({ type: 'closed' });
        }
        break;
      }
    }
  } catch (err) {
    post({ type: 'error', message: errorMessage(err) });
  }
};
