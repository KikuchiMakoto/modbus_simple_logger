/**
 * Where a recording is written.
 *
 * A file picker on every Start Recording, which is the same thing Start Save
 * does for the TSV. This replaced a remembered folder handle kept in IndexedDB,
 * and the reason is worth writing down because the folder version looked like
 * the more convenient one: a remembered destination can only be reused by
 * writing to the same place again, and for a *file* that means overwriting the
 * previous recording. The folder existed to dodge that — it let a name be
 * generated per recording — at the cost of a destination the user could not see
 * or name. Asking each time costs one dialog and makes every recording an
 * explicit, named, non-destructive act.
 *
 * The picker needs a user gesture, which is why this is only ever called from
 * the Start Recording click and never from an effect.
 */

interface SaveFilePickerOptions {
  suggestedName?: string;
  id?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

/**
 * Open the save dialog for a recording. Returns null when the user cancels,
 * which is an answer rather than a fault.
 */
export async function pickRecordingFile(
  suggestedName: string,
  description: string,
  mimeType: string,
  ext: string,
): Promise<FileSystemFileHandle | null> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  if (!picker) throw new Error('This browser cannot choose a file (File System Access API).');
  try {
    return await picker({
      suggestedName,
      // `id` makes the dialog reopen where it was left last time, so a run that
      // records repeatedly into one folder does not navigate the tree again.
      id: 'msl-recording-output',
      // The bare mime type, not the one carrying `codecs=`: a dialog filter
      // built from the full string is rejected as not a valid MIME type.
      types: [{ description, accept: { [mimeType]: [ext] } }],
    });
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
