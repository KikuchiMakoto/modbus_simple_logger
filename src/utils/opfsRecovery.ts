/**
 * Crash recovery for TSV saving — main-thread side.
 *
 * The TSV writer worker mirrors every flush into OPFS (see opfsRecoveryShared
 * for why). This module is what runs at startup: it finds mirrors that no clean
 * Stop Save ever deleted, offers them to the user, and removes them once the
 * user says the download arrived.
 *
 * Nothing here deletes a non-empty mirror on its own. The user confirms the
 * download landed before the copy goes away, because the alternative — a failed
 * or blocked download plus an automatic cleanup — destroys the very data this
 * feature exists to protect. A mirror the user does not resolve is simply
 * offered again at the next startup.
 */
import {
  RECOVERY_DIR,
  buildRecoveryName,
  parseRecoveryName,
} from './opfsRecoveryShared';

/** A finished-but-unsaved run found in OPFS. */
export interface RecoverableRun {
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

async function getRecoveryDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (!opfsAvailable()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(RECOVERY_DIR, { create });
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
 * List runs that can be recovered, newest first.
 *
 * Empty and unrecognised entries are swept here rather than offered: the worker
 * writes the header lazily, so a mirror is 0 bytes exactly when the run
 * captured no rows and there is nothing to restore.
 */
export async function listRecoverableRuns(): Promise<RecoverableRun[]> {
  const dir = await getRecoveryDir(false);
  if (!dir) return [];

  const runs: RecoverableRun[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file') continue;

    const parts = parseRecoveryName(name);
    let size: number;
    try {
      size = (await handle.getFile()).size;
    } catch {
      // A worker in another tab still holds the sync access handle, so this run
      // is live, not abandoned. Leave it alone.
      continue;
    }

    if (!parts || size === 0) {
      await dir.removeEntry(name).catch(() => {});
      continue;
    }
    runs.push({ opfsName: name, size, ...parts });
  }

  return runs.sort((a, b) => b.startedAt - a.startedAt);
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
  const dir = await getRecoveryDir(false);
  if (!dir) throw new Error('Recovery storage is unavailable.');

  const file = await (await dir.getFileHandle(run.opfsName)).getFile();
  const url = URL.createObjectURL(file);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = run.originalName;
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

/** Delete a mirror. Only ever called after the user confirms the download. */
export async function discardRecoveredRun(run: RecoverableRun): Promise<void> {
  const dir = await getRecoveryDir(false);
  if (!dir) return;
  await dir.removeEntry(run.opfsName).catch(() => {});
}

export function formatRunSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Re-exported so the worker and the main thread agree on one implementation. */
export { RECOVERY_DIR, buildRecoveryName, parseRecoveryName };
