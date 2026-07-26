/**
 * Naming scheme for the OPFS crash-recovery mirror, shared by the TSV writer
 * worker (which creates the mirror) and the main thread (which finds leftovers
 * at startup).
 *
 * Why a mirror exists at all: the file the user picks with showSaveFilePicker()
 * is written through a FileSystemWritableFileStream, which buffers into a swap
 * file and only swings it onto the target on close(). Until Stop Save the
 * target is 0 bytes, so a crash mid-run loses the entire run. OPFS is the one
 * place the page can write durably as it goes — createSyncAccessHandle() exists
 * on OPFS files only, is worker-only, writes without a swap file, and appends
 * without rewriting what came before.
 *
 * A clean close deletes the mirror, so anything still in the recovery directory
 * at startup is by definition a run that never finished.
 *
 * The metadata (original filename, start time) is encoded into the mirror's own
 * filename rather than kept in a sidecar file or localStorage. A crash is
 * precisely the moment two separate writes can disagree, and the one thing this
 * feature cannot afford is a recovered file whose name or timestamp belongs to
 * a different run.
 */

/** Directory under the OPFS root that holds in-progress mirrors. */
export const RECOVERY_DIR = 'tsv-recovery';

/** Metadata recovered from a mirror's filename. */
export interface RecoveryNameParts {
  /** Name of the file the user originally chose in the save picker. */
  originalName: string;
  /** Date.now() when the run started. */
  startedAt: number;
}

/**
 * Build the OPFS filename for a run. encodeURIComponent escapes the separators
 * OPFS rejects (and our own '__' delimiter is safe from the encoded form, which
 * never contains a bare underscore pair it did not start with).
 */
export function buildRecoveryName(originalName: string, startedAt: number): string {
  return `${startedAt}__${encodeURIComponent(originalName)}`;
}

/**
 * Inverse of buildRecoveryName. Returns null for anything that does not look
 * like one of ours, so a stray entry is never presented as a recoverable run.
 */
export function parseRecoveryName(opfsName: string): RecoveryNameParts | null {
  const separator = opfsName.indexOf('__');
  if (separator <= 0) return null;

  const startedAtText = opfsName.slice(0, separator);
  if (!/^\d+$/.test(startedAtText)) return null;
  const startedAt = Number(startedAtText);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null;

  const encoded = opfsName.slice(separator + 2);
  if (encoded === '') return null;

  let originalName: string;
  try {
    originalName = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (originalName === '') return null;

  return { originalName, startedAt };
}
