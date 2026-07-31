/**
 * The folder recordings are written into, remembered across sessions.
 *
 * A directory handle cannot be stored in localStorage — it is not JSON, and the
 * whole point of it is that it carries a permission grant the browser tracks.
 * IndexedDB is the only store that keeps one intact, which is why this is the
 * one setting in the app that does not go through utils/cookies.
 *
 * The grant does not survive a restart on its own: a handle read back after the
 * browser has been closed comes back in the 'prompt' state, and asking for it
 * again needs a user gesture. So the request is made from the button that
 * starts a recording, never from an effect — an effect would either throw or,
 * worse, silently fail and leave the recording with nowhere to go.
 */

const DB_NAME = 'modbus_logger_handles';
const STORE = 'handles';
const KEY = 'recording_output_dir';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the handle store.'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Handle store request failed.'));
    });
  } finally {
    db.close();
  }
}

export async function saveOutputDirectory(handle: FileSystemDirectoryHandle): Promise<void> {
  await withStore('readwrite', (store) => store.put(handle, KEY));
}

export async function loadOutputDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await withStore<FileSystemDirectoryHandle | undefined>('readonly', (store) =>
      store.get(KEY),
    );
    return handle ?? null;
  } catch {
    // A profile with IndexedDB blocked, or a store from an older build. Either
    // way the answer is "no folder yet", which the panel already handles.
    return null;
  }
}

export async function clearOutputDirectory(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(KEY)).catch(() => {});
}

type PermissionCapable = FileSystemDirectoryHandle & {
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
};

/** Whether the folder can be written to right now, without prompting. */
export async function hasWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const capable = handle as PermissionCapable;
  if (!capable.queryPermission) return true;
  try {
    return (await capable.queryPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Ask for write access, prompting if needed.
 *
 * Must be called from a user gesture. Returns false rather than throwing when
 * the user declines, because declining is an answer and not a fault.
 */
export async function ensureWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (await hasWritePermission(handle)) return true;
  const capable = handle as PermissionCapable;
  if (!capable.requestPermission) return false;
  try {
    return (await capable.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** Open the folder picker. Returns null when the user cancels. */
export async function pickOutputDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (options?: {
        mode?: 'read' | 'readwrite';
        id?: string;
        startIn?: string;
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!picker) throw new Error('This browser cannot choose a folder (File System Access API).');
  try {
    // `id` makes the browser reopen the picker where it was left last time,
    // which for a folder that is chosen once and reused is the difference
    // between one click and navigating the whole tree again.
    return await picker({ mode: 'readwrite', id: 'msl-recording-output' });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return null;
    throw err;
  }
}

/**
 * A name for a recording started now: `YYYYMMDD_HHMMSS`, matching the TSV
 * picker's default so a video and a save started together sort next to each
 * other and read as the same session.
 */
export function timestampBaseName(at: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}_` +
    `${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`
  );
}
