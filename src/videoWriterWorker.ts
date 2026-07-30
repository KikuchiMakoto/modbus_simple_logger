// Video writer Web Worker. Owns an OPFS sync access handle and appends every
// MediaRecorder chunk to it as it arrives.
//
// Same machinery as the TSV worker's crash-recovery mirror (see
// tsvWriterWorker.ts and utils/opfsRecoveryShared.ts), for the same reason:
// createSyncAccessHandle() exists on OPFS files only, is worker-only, writes
// without a swap file, and appends without rewriting what came before.
//
// The difference is what the file *is*. For TSV the OPFS copy is a mirror of a
// stream the user picked; here there is no picked file at all — a second save
// picker cannot be opened on the same click as the TSV one — so this entry is
// the recording. It is read back and handed over as a download at Stop Save.
import { VIDEO_DIR, buildRecoveryName } from './utils/opfsRecoveryShared';
import type { FileSystemSyncAccessHandle } from './types';
import type { VideoWorkerRequest, VideoWorkerResponse } from './utils/videoWorkerProtocol';

let handle: FileSystemSyncAccessHandle | null = null;
let dir: FileSystemDirectoryHandle | null = null;
let opfsName = '';
let offset = 0;

function post(message: VideoWorkerResponse): void {
  self.postMessage(message);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function open(fileName: string, startedAt: number): Promise<void> {
  const root = await navigator.storage.getDirectory();
  dir = await root.getDirectoryHandle(VIDEO_DIR, { create: true });
  opfsName = buildRecoveryName(fileName, startedAt);
  const fileHandle = await dir.getFileHandle(opfsName, { create: true });
  handle = await fileHandle.createSyncAccessHandle();
  handle.truncate(0);
  offset = 0;
}

/**
 * Append one chunk. Synchronous and flushed, which is what makes the bytes
 * survive a crash — the whole reason this runs in a worker at all.
 */
function write(data: ArrayBuffer): void {
  if (!handle) return;
  try {
    const bytes = new Uint8Array(data);
    handle.write(bytes, { at: offset });
    offset += bytes.byteLength;
    handle.flush();
  } catch (err) {
    // Disable rather than retry: a handle that fails once (quota, revoked) will
    // keep failing, and one message beats one per chunk. What is already on disk
    // stays there and is still offered back — a truncated recording is worth
    // more than none.
    try {
      handle.close();
    } catch {
      // Already unusable.
    }
    handle = null;
    post({ type: 'error', message: `Recording write failed: ${errorMessage(err)}` });
  }
}

async function close(discard: boolean): Promise<void> {
  if (handle) {
    try {
      handle.flush();
      handle.close();
    } catch {
      // The handle dies with the worker either way.
    }
    handle = null;
  }

  if (discard && dir && opfsName) {
    await dir.removeEntry(opfsName).catch(() => {});
    opfsName = '';
  }
}

self.onmessage = async (event: MessageEvent<VideoWorkerRequest>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init': {
        await open(msg.fileName, msg.startedAt);
        post({ type: 'ready' });
        break;
      }
      case 'chunk': {
        write(msg.data);
        break;
      }
      case 'close': {
        const bytes = offset;
        await close(msg.discard);
        // Always reply, even after a failed write, so the main thread's await
        // never hangs. A zero-byte result is a valid answer: it means the run
        // captured nothing and there is no file to offer.
        post({ type: 'closed', opfsName: msg.discard ? '' : opfsName, bytes });
        break;
      }
    }
  } catch (err) {
    post({ type: 'error', message: errorMessage(err) });
  }
};
