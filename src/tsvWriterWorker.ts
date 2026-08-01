// TSV writer Web Worker. Owns the FileSystemWritableFileStream and performs all
// row formatting, buffering, join() and stream.write() off the main thread, so
// high-sampling-rate saving no longer produces periodic main-thread hitches at
// flush time. The main thread (createTsvWriter in utils/tsvExport.ts) keeps the
// showSaveFilePicker() user gesture and hands the resulting FileSystemFileHandle
// here; this worker calls createWritable() and owns everything after that.
import { createTsvHeader, formatTsvRow } from './utils/tsvFormat';
import { RECOVERY_DIR, buildRecoveryName } from './utils/opfsRecoveryShared';
import { TSV_MAX_BUFFERED_ROWS, TSV_MIRROR_FLUSH_INTERVAL_MS, TSV_MIRROR_FLUSH_MAX_ROWS } from './constants';
import type { FileSystemSyncAccessHandle } from './types';
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

// OPFS crash-recovery mirror. Every row is also appended here, synchronously
// and without a swap file, so a crash mid-run leaves a near-complete file
// behind instead of the 0-byte target. See utils/opfsRecoveryShared.ts for the
// full rationale.
//
// The mirror keeps its own buffer and its own timer rather than riding along on
// the stream flush: at TSV_FLUSH_INTERVAL_MS the stream's cadence is a
// performance trade-off, and inheriting it meant the mirror was empty for the
// first minute of every run — exactly the window a crash-recovery feature is
// judged on. See TSV_MIRROR_FLUSH_INTERVAL_MS.
let mirror: FileSystemSyncAccessHandle | null = null;
let mirrorDir: FileSystemDirectoryHandle | null = null;
let mirrorName = '';
let mirrorOffset = 0;
let mirrorBuffer: string[] = [];
let mirrorTimer: number | undefined;
// The header is held back until there is a row to go with it, so a run that
// captured nothing leaves a 0-byte mirror that startup sweeps silently instead
// of offering the user a file with no data in it.
let mirrorPendingHeader: string | null = null;
const encoder = new TextEncoder();

function post(message: TsvWorkerResponse): void {
  self.postMessage(message);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Open the mirror. Failure is reported but never fatal: losing the safety net
 * must not also lose the save the user actually asked for.
 */
async function openMirror(originalName: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    mirrorDir = await root.getDirectoryHandle(RECOVERY_DIR, { create: true });
    mirrorName = buildRecoveryName(originalName, Date.now());
    const handle = await mirrorDir.getFileHandle(mirrorName, { create: true });
    mirror = await handle.createSyncAccessHandle();
    mirror.truncate(0);
    mirrorOffset = 0;
    // Worker timer, deliberately: window timers are throttled to once a minute
    // once the page is hidden, and a minimised logging window is precisely when
    // the machine is left alone long enough to crash.
    mirrorTimer = self.setInterval(mirrorFlush, TSV_MIRROR_FLUSH_INTERVAL_MS);
  } catch (err) {
    mirror = null;
    mirrorDir = null;
    mirrorName = '';
    // 'warning', not 'error': this runs inside the init handshake, and an
    // error there rejects createTsvWriter() and terminates the worker — the
    // picked file, which opened perfectly well, would never be written at all.
    post({ type: 'warning', message: `Crash recovery unavailable: ${errorMessage(err)}` });
  }
}

/**
 * Append everything buffered since the last tick. Called on the mirror's own
 * interval, on every row-count threshold, and once more before close.
 */
function mirrorFlush(): void {
  if (mirrorBuffer.length === 0) return;
  const data = mirrorBuffer.join('');
  // Cleared before the write, unlike drainBuffer() below — deliberately, not by
  // oversight. mirrorWrite() disables the mirror for good on its first failure,
  // so there is no later attempt to hold rows for, and the rows themselves are
  // not at risk: the stream the user asked for still has them.
  mirrorBuffer = [];
  mirrorWrite(data);
}

/** Stop mirroring for good, releasing the timer and dropping buffered rows. */
function disableMirror(): void {
  if (mirrorTimer !== undefined) {
    self.clearInterval(mirrorTimer);
    mirrorTimer = undefined;
  }
  mirrorBuffer = [];
  mirror = null;
}

/**
 * Append to the mirror. Synchronous by design — flush() here is what makes the
 * bytes survive a crash, which is the entire point of the mirror.
 */
function mirrorWrite(data: string): void {
  if (!mirror) return;
  try {
    const payload = mirrorPendingHeader === null ? data : mirrorPendingHeader + data;
    mirrorPendingHeader = null;
    const bytes = encoder.encode(payload);
    mirror.write(bytes, { at: mirrorOffset });
    mirrorOffset += bytes.byteLength;
    mirror.flush();
  } catch (err) {
    // Disable rather than retry: a mirror that fails once (quota, revoked
    // handle) will keep failing, and one error message beats one per flush.
    try {
      mirror.close();
    } catch {
      // Already unusable; nothing to salvage.
    }
    disableMirror();
    // Also a warning: the stream write that the user actually asked for is
    // untouched, and reporting this as "TSV write error" would have them stop a
    // healthy run to investigate a file that is being written correctly.
    post({ type: 'warning', message: `Crash recovery stopped: ${errorMessage(err)}` });
  }
}

/** Close the mirror handle, releasing the OPFS lock on it. */
function closeMirror(): void {
  if (mirror) {
    try {
      mirror.close();
    } catch {
      // Nothing useful to do; the handle dies with the worker either way.
    }
  }
  disableMirror();
}

/** Delete the mirror. Only after the picked file closed successfully. */
async function removeMirror(): Promise<void> {
  if (!mirrorDir || !mirrorName) return;
  try {
    await mirrorDir.removeEntry(mirrorName);
  } catch {
    // A leftover mirror costs the user one startup prompt; a thrown error here
    // would cost them the 'closed' reply. Swallow it.
  }
  mirrorDir = null;
  mirrorName = '';
}

function flush(): Promise<void> {
  const next = flushChain.then(drainBuffer, drainBuffer);
  flushChain = next.catch(() => {});
  return next;
}

async function drainBuffer(): Promise<void> {
  // Mirror first: it is the copy that survives a crash, and it is synchronous,
  // so it cannot be the thing left half-done by one. Unconditional, because a
  // stream flush with nothing new for the stream can still have rows the
  // mirror's own tick has not picked up yet.
  mirrorFlush();
  if (!stream || writeBuffer.length === 0) return;

  // Take the batch, but only drop it once the write has resolved. Clearing
  // first — as this used to — meant one rejected write silently lost the whole
  // batch: at TSV_FLUSH_MAX_ROWS that is 500 rows, 25 s of capture at 20 Hz,
  // gone with no marker in the file while savePointCount kept counting them as
  // saved. flush() is built as flushChain.then(drainBuffer, drainBuffer), so a
  // rejection does not stop later flushes and the run carries on regardless.
  const pending = writeBuffer;
  writeBuffer = [];
  try {
    await stream.write(pending.join(''));
  } catch (err) {
    // Put them back at the front so file order is preserved, then let the next
    // flush try again.
    writeBuffer = pending.concat(writeBuffer);
    if (writeBuffer.length > TSV_MAX_BUFFERED_ROWS) {
      const dropped = writeBuffer.length - TSV_MAX_BUFFERED_ROWS;
      writeBuffer = writeBuffer.slice(dropped);
      post({
        type: 'error',
        message:
          `TSV writes are failing; ${dropped} unwritten row(s) were discarded to bound memory. ` +
          'The file has a gap.',
      });
    }
    throw err;
  }
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
        const header = createTsvHeader(aiChannels, aoChannels, paramChannels);
        await stream.write(header);
        await openMirror(msg.fileHandle.name);
        mirrorPendingHeader = header;
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
        const row = formatTsvRow(msg.timestamp, msg.aiRaw, msg.aiPhysical, msg.aoRaw, msg.aiVoltage, msg.param, physicalPrecision);
        writeBuffer.push(row);
        if (mirror) {
          mirrorBuffer.push(row);
          if (mirrorBuffer.length >= TSV_MIRROR_FLUSH_MAX_ROWS) mirrorFlush();
        }
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
        let picked = true;
        try {
          await flush();
          if (stream) await stream.close();
        } catch (err) {
          picked = false;
          post({ type: 'error', message: errorMessage(err) });
        } finally {
          stream = null;
          closeMirror();
          // Keep the mirror when the picked file did not close cleanly: that is
          // the one case where it holds data the user has nowhere else, and
          // startup will offer it back.
          if (picked) await removeMirror();
          post({ type: 'closed' });
        }
        break;
      }
    }
  } catch (err) {
    post({ type: 'error', message: errorMessage(err) });
  }
};
