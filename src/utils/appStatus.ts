// App-wide error surface. Failures only — see AppStatusLevel.
//
// Until this existed, `App.tsx`'s `setStatus()` was a no-op ("Status display
// removed from header") while remaining the only user-facing error channel in
// the app, across 33 call sites. A connect that failed on a wrong baud rate or
// slave ID left the button reading "Connect" with no explanation; a TSV write
// that failed mid-run said nothing; the AI-read failure limiter suspended reads
// for up to a minute and the only sign was four charts going flat. For a logger
// that is left running unattended, "it silently did nothing" is the worst
// available outcome.
//
// Module-level state rather than React state, for the same reason as
// notifications.ts: the posters include the TSV worker's onError callback and
// dataStorage.init()'s catch, neither of which has a component to read a prop
// from. It also keeps `setStatus` a `useCallback([])` — it is in the dependency
// list of several other callbacks, and making it unstable would re-subscribe
// the serial disconnect listeners on every render.
//
// Nothing here is persisted. A stale error from a previous session shown at
// startup is worse than no error, and the durable record already exists in the
// console and (for script-sourced events) the ScriptRunner log.
import { notify } from './notifications';

/**
 * Only failures. There was an 'info' level for transient progress
 * announcements ("Disconnected", "Saving data to file"); it was removed
 * because every one of those messages restated something the UI already showed
 * — the button captions, the charts, the save indicator — so the bar spent
 * most of its time saying nothing new, and a strip that is usually noise is a
 * strip nobody reads when it finally matters.
 */
export type AppStatusLevel =
  /** Something failed. Sticky until the user or the subsystem clears it. */
  | 'error'
  /**
   * Data that existed and is now gone. Sticky, and — unlike 'error' — a later
   * success does NOT clear it: the rows are still missing regardless of the
   * link recovering, so it must not be able to scroll away on its own.
   */
  | 'dataLoss';

/**
 * Which subsystem is speaking. `clearStatusSource()` works per source so a
 * recovering link cannot wipe a pending save error.
 */
export type AppStatusSource = 'link' | 'save' | 'calibration' | 'storage' | 'app';

export type AppStatusEntry = {
  id: number;
  level: AppStatusLevel;
  message: string;
  source: AppStatusSource;
  firstAt: number;
  lastAt: number;
  /** How many identical consecutive posts collapsed into this row (1 = once). */
  repeats: number;
};

// A logger runs for hours; the list has to be a bounded ring or a flapping
// link would grow it without limit.
const MAX_ENTRIES = 50;

/** Collapses with the 'msl-script-*' tags in notifications.ts's NOTIFY_TAG family. */
const NOTIFY_TAG_APP_ERROR = 'msl-app-error';

let entries: AppStatusEntry[] = [];
let nextId = 1;
const listeners = new Set<(entries: AppStatusEntry[]) => void>();

/** Newest first — the bar shows entries[0] and a "+N" chip for the rest. */
export const appStatusSnapshot = (): AppStatusEntry[] => entries;

export const onAppStatusChange = (
  listener: (entries: AppStatusEntry[]) => void,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const emit = () => {
  for (const listener of listeners) listener(entries);
};

/**
 * Post a failure.
 *
 * Identical consecutive messages from the same source collapse into one row
 * with a repeat count. This is load-bearing, not cosmetic: `pollOnce` reports
 * link state once per poll — 10-40 Hz — and without collapsing, the store
 * would push 40 entries and re-render the bar 40 times a second on the thread
 * that must not miss a Modbus deadline.
 */
export const postStatus = (
  level: AppStatusLevel,
  message: string,
  source: AppStatusSource = 'app',
): void => {
  const trimmed = message.trim();
  if (!trimmed) return;

  const now = Date.now();
  const head = entries[0];
  if (head && head.level === level && head.source === source && head.message === trimmed) {
    // Mutating in place would let a memoised consumer miss the update; the
    // listeners get a new array either way.
    entries = [{ ...head, lastAt: now, repeats: head.repeats + 1 }, ...entries.slice(1)];
    emit();
    return;
  }

  entries = [
    { id: nextId++, level, message: trimmed, source, firstAt: now, lastAt: now, repeats: 1 },
    ...entries,
  ].slice(0, MAX_ENTRIES);

  // The only channel that reaches a user who walked away from a run that is
  // now failing. notifications.ts's own docstring already declares this use
  // case; sticky so it survives until they come back.
  notify(level === 'dataLoss' ? 'Data loss' : 'Logger error', trimmed, {
    tag: NOTIFY_TAG_APP_ERROR,
    sticky: true,
  });

  emit();
};

/**
 * Report a failure. Accepts whatever a catch block caught, so call sites do not
 * each have to normalise it.
 */
export const reportError = (source: AppStatusSource, err: unknown, prefix?: string): void => {
  const detail = err instanceof Error ? err.message : String(err);
  postStatus('error', prefix ? `${prefix}: ${detail}` : detail, source);
};

/** Report rows that existed and are now unrecoverable. See 'dataLoss' above. */
export const reportDataLoss = (source: AppStatusSource, message: string): void => {
  postStatus('dataLoss', message, source);
};

/**
 * A subsystem is working again. Drops its pending errors — but never its
 * dataLoss entries, which describe something a later success cannot undo.
 *
 * Called on the recovery *transition*, not per poll: `pollOnce` calls this on
 * every successful poll, so it must be cheap and must not emit when there was
 * nothing to clear.
 */
export const clearStatusSource = (source: AppStatusSource): void => {
  const before = entries.length;
  entries = entries.filter((entry) => entry.source !== source || entry.level === 'dataLoss');
  if (entries.length !== before) emit();
};

export const dismissStatus = (id: number): void => {
  const before = entries.length;
  entries = entries.filter((entry) => entry.id !== id);
  if (entries.length !== before) emit();
};

export const dismissAllStatus = (): void => {
  if (entries.length === 0) return;
  entries = [];
  emit();
};
