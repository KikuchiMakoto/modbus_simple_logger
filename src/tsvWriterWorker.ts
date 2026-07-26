// TSV writer Web Worker. Owns the FileSystemWritableFileStream and performs all
// row formatting, buffering, join() and stream.write() off the main thread, so
// high-sampling-rate saving no longer produces periodic main-thread hitches at
// flush time. The main thread (createTsvWriter in utils/tsvExport.ts) keeps the
// showSaveFilePicker() user gesture and hands the resulting FileSystemFileHandle
// here; this worker calls createWritable() and owns everything after that.
import { createTsvHeader, formatTsvRow } from './utils/tsvFormat';
import { RECOVERY_DIR, buildRecoveryName } from './utils/opfsRecoveryShared';
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
let aiRawAsFloat = false;
let flushMaxRows = 0;
let aiChannels = 0;
let aoChannels = 0;
let paramChannels = 0;

// OPFS crash-recovery mirror. Everything that reaches the picked file's stream
// is also appended here, synchronously and without a swap file, so a crash
// mid-run leaves a complete file behind instead of the 0-byte target. See
// utils/opfsRecoveryShared.ts for the full rationale.
let mirror: FileSystemSyncAccessHandle | null = null;
let mirrorDir: FileSystemDirectoryHandle | null = null;
let mirrorName = '';
let mirrorOffset = 0;
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
  } catch (err) {
    mirror = null;
    mirrorDir = null;
    mirrorName = '';
    post({ type: 'error', message: `Crash recovery unavailable: ${errorMessage(err)}` });
  }
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
    mirror = null;
    post({ type: 'error', message: `Crash recovery stopped: ${errorMessage(err)}` });
  }
}

/** Close the mirror handle, releasing the OPFS lock on it. */
function closeMirror(): void {
  if (!mirror) return;
  try {
    mirror.close();
  } catch {
    // Nothing useful to do; the handle dies with the worker either way.
  }
  mirror = null;
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
  if (!stream || writeBuffer.length === 0) return;
  const data = writeBuffer.join('');
  writeBuffer = [];
  // Mirror first: it is the copy that survives a crash, and it is synchronous,
  // so it cannot be the thing left half-done by one.
  mirrorWrite(data);
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
        aiRawAsFloat = msg.aiRawAsFloat;
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
        writeBuffer.push(
          formatTsvRow(msg.timestamp, msg.aiRaw, msg.aiPhysical, msg.aoRaw, msg.aiVoltage, msg.param, physicalPrecision, aiRawAsFloat),
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
