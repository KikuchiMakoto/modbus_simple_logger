/**
 * Crash recovery for TSV saving — main-thread side.
 *
 * The TSV writer worker mirrors every flush into OPFS (see opfsRecoveryShared
 * for why). This module is what runs at startup: it finds mirrors that no clean
 * Stop Save ever deleted, offers them to the user, and removes them once the
 * user says the download arrived.
 *
 * Nothing here deletes a non-empty mirror on its own, and nothing deletes one
 * on the strength of having started a download: an <a download> reports neither
 * completion nor failure, so the only evidence that the data arrived is the user
 * saying so. A mirror the user does not resolve is simply offered again at the
 * next startup — the alternative, a failed or blocked download plus an automatic
 * cleanup, destroys the very data this feature exists to protect.
 */
import {
  RECOVERY_DIR,
  VIDEO_DIR,
  buildRecoveryName,
  parseRecoveryName,
  recoveredDownloadName,
} from './opfsRecoveryShared';

/**
 * Both directories are swept, and the difference between them matters when
 * deciding what a leftover is worth. A `tsv` entry is a mirror of a file the
 * user picked, so a crash leaves two partial copies and this one is the better
 * of them. A `video` entry is the recording itself — there was never a second
 * copy — so it is the only thing standing between a crash and no video at all.
 */
export type RecoveryKind = 'tsv' | 'video';

const DIR_OF: Record<RecoveryKind, string> = {
  tsv: RECOVERY_DIR,
  video: VIDEO_DIR,
};

/** A finished-but-unsaved run found in OPFS. */
export interface RecoverableRun {
  /** Which directory it came from; needed to read or delete it again. */
  kind: RecoveryKind;
  /** Entry name inside the recovery directory. */
  opfsName: string;
  /** Name of the file the user originally chose in the save picker. */
  originalName: string;
  /** Date.now() when the run started. */
  startedAt: number;
  /** Mirror size in bytes. */
  size: number;
}

function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

async function getRecoveryDir(
  kind: RecoveryKind,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  if (!opfsAvailable()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIR_OF[kind], { create });
  } catch {
    // NotFoundError when the directory was never created (the common case on a
    // clean profile) — and anything else here means recovery is simply
    // unavailable, which must not break app startup.
    return null;
  }
}

/**
 * Ask the browser to mark this origin's storage as persistent, so the recovery
 * mirror is not evicted under storage pressure while a long run is recording.
 * Best-effort: a refusal changes nothing about how saving works.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * How long to keep retrying getFile() on a locked mirror before concluding the
 * run is genuinely live in another tab.
 *
 * A reload is the common case this feature serves, and it is also the case
 * where the lock is most likely to still be held: the previous document's
 * worker is torn down asynchronously, and the sync access handle is released
 * somewhere after the new page has already started running. Treating that first
 * failed read as "another tab owns it" skipped the run silently and left the
 * user with no prompt at all.
 */
const LOCK_RETRY_MS = 3_000;
const LOCK_RETRY_INTERVAL_MS = 150;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read a mirror's size, waiting out a lock the dead worker has not dropped yet. */
async function readSizeWaitingForLock(handle: FileSystemFileHandle): Promise<number | null> {
  const deadline = Date.now() + LOCK_RETRY_MS;
  for (;;) {
    try {
      return (await handle.getFile()).size;
    } catch (err) {
      if (Date.now() >= deadline) {
        // Still locked after the grace period: a worker in another tab is
        // recording into it right now. Live, not abandoned — leave it alone.
        console.warn('TSV recovery: mirror is still locked, skipping.', err);
        return null;
      }
      await delay(LOCK_RETRY_INTERVAL_MS);
    }
  }
}

/**
 * List runs that can be recovered, newest first.
 *
 * Empty and unrecognised entries are swept here rather than offered: the worker
 * writes the header lazily, so a mirror is 0 bytes exactly when the run
 * captured no rows and there is nothing to restore.
 */
export async function listRecoverableRuns(): Promise<RecoverableRun[]> {
  const runs: RecoverableRun[] = [];
  for (const kind of Object.keys(DIR_OF) as RecoveryKind[]) {
    runs.push(...(await listRunsIn(kind)));
  }
  return runs.sort((a, b) => b.startedAt - a.startedAt);
}

async function listRunsIn(kind: RecoveryKind): Promise<RecoverableRun[]> {
  const dir = await getRecoveryDir(kind, false);
  if (!dir) return [];

  // Collect first, then act: removeEntry() while the async iterator is still
  // walking the directory can make it skip the following entry.
  const entries: [string, FileSystemFileHandle][] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') entries.push([name, handle as FileSystemFileHandle]);
  }

  const runs: RecoverableRun[] = [];
  for (const [name, handle] of entries) {
    const parts = parseRecoveryName(name);
    const size = await readSizeWaitingForLock(handle);
    if (size === null) continue;

    if (!parts || size === 0) {
      await dir.removeEntry(name).catch(() => {});
      continue;
    }
    runs.push({ kind, opfsName: name, size, ...parts });
  }

  return runs;
}

/**
 * Save a recovered run to the user's Downloads folder.
 *
 * A download, not showSaveFilePicker(): this runs at startup with no transient
 * user activation (dismissing a confirm() dialog does not grant one), so the
 * picker would throw. The object URL wraps the OPFS File directly, so the blob
 * stays backed by the on-disk entry and a multi-hundred-megabyte run is never
 * read into memory.
 */
export async function downloadRecoveredRun(run: RecoverableRun): Promise<void> {
  const dir = await getRecoveryDir(run.kind, false);
  if (!dir) throw new Error('Recovery storage is unavailable.');

  const file = await (await dir.getFileHandle(run.opfsName)).getFile();
  const url = URL.createObjectURL(file);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = recoveredDownloadName(run.originalName);
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoking synchronously cancels the download in Chromium; the URL is dead
    // weight until then, so err long.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/**
 * Delete a mirror. Called when the user confirms the download arrived, and when
 * they decline the offer outright — declining is an answer about the data, and
 * re-offering the same dead run at every startup until they give in is not
 * keeping it safe, it is nagging.
 */
export async function discardRecoveredRun(run: RecoverableRun): Promise<void> {
  const dir = await getRecoveryDir(run.kind, false);
  if (!dir) return;
  await dir.removeEntry(run.opfsName).catch(() => {});
}

export function formatRunSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Re-exported so the worker and the main thread agree on one implementation. */
export { RECOVERY_DIR, VIDEO_DIR, buildRecoveryName, parseRecoveryName, recoveredDownloadName };
