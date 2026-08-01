// The app's one log.
//
// This began as two separate things that were never really different: the
// Script Log (what a script printed, plus the runner's start/stop lines) and
// the app status bar (connect failures, TSV write errors, storage failures).
// Reading a run meant reading both — a script that stopped producing output
// because the serial link had dropped told that story across two surfaces, in
// two orders, with two clocks. One stream, one clock, one place to look.
//
// Module-level state rather than React state, for the reason the status bar
// already needed it: the posters include the TSV worker's onError callback,
// dataStorage.init()'s catch and the polling loop, none of which has a
// component to read a prop from. It also keeps the posting functions stable
// (`useCallback([])`), which several App callbacks depend on.
//
// Levels are log4j's, and the reader picks a threshold — so the same log serves
// "what is the rig doing" (INFO) and "why did that fail" (DEBUG/TRACE) without
// two different logs or a Clear button. Nothing is persisted: a stale error
// from a previous session shown at startup is worse than no error, and the
// durable record already exists in the console and in the TSV.
import { readJsonStorage, writeLocalPreference } from './cookies';
import { notify } from './notifications';

/**
 * log4j's ladder, and used with log4j's meanings:
 *
 *  TRACE  wire-level detail — individual frames, retries.
 *  DEBUG  internals worth seeing when something is wrong, not otherwise.
 *  INFO   the run's story: connected, saving started, what a script printed.
 *         This is the default threshold, so anything at INFO must be worth
 *         reading at 3 a.m. on a log that has been running for six hours.
 *  WARN   recovered or tolerated trouble — a retry that worked, a dropped frame.
 *  ERROR  something failed and the user has to know.
 *  FATAL  data that existed and is now gone. Reserved for that: it is the one
 *         class of event in this app that a later success cannot undo.
 */
export type SystemLogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

/** Quiet to loud. The order the threshold dropdown lists, and the rank below. */
export const SYSTEM_LOG_LEVELS: readonly SystemLogLevel[] = [
  'TRACE',
  'DEBUG',
  'INFO',
  'WARN',
  'ERROR',
  'FATAL',
];

const LEVEL_RANK: Record<SystemLogLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5,
};

/** Would a reader at `threshold` see a line at `level`? */
export const passesLevel = (level: SystemLogLevel, threshold: SystemLogLevel): boolean =>
  LEVEL_RANK[level] >= LEVEL_RANK[threshold];

/**
 * Which subsystem is speaking — the log's tag column.
 *
 * A free string rather than a union, because a script's lines are tagged with
 * the script's own name (the tab it ran from). The constants below are the
 * fixed ones, so a subsystem cannot end up filed under two spellings.
 */
export type SystemLogSource = string;

export const SOURCE = {
  link: 'Link',
  save: 'Save',
  calibration: 'Calibration',
  storage: 'Storage',
  app: 'App',
  runner: 'Runner',
} as const;

/** The subsystem keys the old status bar took, kept so call sites read the same. */
export type AppStatusSource = keyof typeof SOURCE;

export type SystemLogEntry = {
  /**
   * Identity, from 1, for the life of the session. Not displayed — the log is
   * in order and timestamped to the millisecond, so a counter column only says
   * where the reader already is. It is what React's keys and the expanded-row
   * set need, and unlike an array index it survives the ring trimming the front.
   */
  seq: number;
  /** Epoch ms. */
  t: number;
  level: SystemLogLevel;
  source: SystemLogSource;
  text: string;
  /** How many identical consecutive posts collapsed here (1 = said once). */
  repeats: number;
};

/**
 * How many lines are kept.
 *
 * The old Script Log kept 100, which was sized for the cost of the old design:
 * every line re-rendered the panel synchronously on the thread the Modbus
 * polling loop runs on, so the tail length was paid per line. That cost is gone
 * — emits are coalesced (see FLUSH_MS) and the rows are memoised — and this log
 * now has to cover a whole session rather than one run, including the hour
 * before the failure somebody is trying to explain.
 */
const MAX_ENTRIES = 2000;

/**
 * Longest single line kept, in characters. The entry count above bounds how
 * many lines there are but not how big one can be: `print(huge_list)` is one
 * entry holding the whole thing, and in a loop that is the unbounded case the
 * entry cap was supposed to close.
 */
const LINE_MAX = 2000;

/**
 * How often subscribers are told, at most.
 *
 * Load-bearing, not a nicety. `pollOnce` reports link state once per poll —
 * 10-40 Hz — and a script in a `while True:` loop prints as fast as the worker
 * can post. Emitting per line re-rendered every subscriber at that rate on the
 * thread that must not miss a Modbus deadline. The first line after a quiet
 * spell still emits immediately (leading edge), so a single event is never
 * delayed; only bursts are collapsed into 10 Hz.
 */
const FLUSH_MS = 100;

/** Collapses with the 'msl-script-*' tags in notifications.ts's NOTIFY_TAG family. */
const NOTIFY_TAG_APP_ERROR = 'msl-app-error';

const LEVEL_STORAGE_KEY = 'systemLogLevel';

/** Oldest first: this is read top to bottom, and the tail is what is followed. */
let entries: SystemLogEntry[] = [];
let nextSeq = 1;
const listeners = new Set<() => void>();

// Sources with an unrecovered failure, so `clearStatusSource` can log the
// recovery once instead of on every successful poll. See that function.
const failing = new Set<SystemLogSource>();

let flushTimer: ReturnType<typeof setTimeout> | undefined;
let pending = false;

const emitNow = () => {
  for (const listener of listeners) listener();
};

const scheduleEmit = () => {
  if (flushTimer !== undefined) {
    pending = true;
    return;
  }
  emitNow();
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    if (pending) {
      pending = false;
      scheduleEmit();
    }
  }, FLUSH_MS);
};

/** Stable identity — replaced, never mutated, so useSyncExternalStore sees it. */
export const systemLogSnapshot = (): SystemLogEntry[] => entries;

export const onSystemLogChange = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// ---------------------------------------------------------------- threshold

const storedLevel = ((): SystemLogLevel => {
  const raw = readJsonStorage<string>(LEVEL_STORAGE_KEY);
  return SYSTEM_LOG_LEVELS.includes(raw as SystemLogLevel) ? (raw as SystemLogLevel) : 'INFO';
})();

let threshold: SystemLogLevel = storedLevel;

export const systemLogLevel = (): SystemLogLevel => threshold;

/**
 * One threshold for the whole app, not one per window. The log window, the
 * launcher's chart-slot copy and the footer line are three views of one log;
 * a filter that applied to one of them would make the footer report a run as
 * quiet while the window beside it showed the errors.
 */
export const setSystemLogLevel = (level: SystemLogLevel): void => {
  if (level === threshold) return;
  threshold = level;
  // A "how this screen reads" preference, like theme and UI scale — so a viewer
  // keeps its own choice rather than having it discarded by the host-feed guard.
  writeLocalPreference(LEVEL_STORAGE_KEY, level);
  emitNow();
};

// ------------------------------------------------------------------ posting

/**
 * Write one line.
 *
 * Identical consecutive lines from the same source collapse into one row with
 * a repeat count — the same reason the status bar did it, now covering script
 * output too (a loop printing one unchanging line is the common case).
 */
export const logSystem = (
  level: SystemLogLevel,
  source: SystemLogSource,
  text: string,
): void => {
  // Trailing whitespace only: a print() arrives with its newline attached, and
  // leading indentation is often the whole point of the line.
  const trimmed = text.replace(/\s+$/, '');
  if (trimmed === '') return;
  // Say so rather than silently dropping the tail: a line that ends mid-value
  // otherwise reads as the writer having produced garbage.
  const capped =
    trimmed.length > LINE_MAX
      ? `${trimmed.slice(0, LINE_MAX)}… (${trimmed.length - LINE_MAX} more characters)`
      : trimmed;

  const now = Date.now();
  const last = entries[entries.length - 1];
  if (last && last.level === level && last.source === source && last.text === capped) {
    // A new array either way: a memoised consumer would miss a mutation.
    entries = [...entries.slice(0, -1), { ...last, t: now, repeats: last.repeats + 1 }];
    scheduleEmit();
    return;
  }

  entries = [...entries, { seq: nextSeq++, t: now, level, source, text: capped, repeats: 1 }];
  if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
  scheduleEmit();
};

export const logTrace = (source: SystemLogSource, text: string): void =>
  logSystem('TRACE', source, text);
export const logDebug = (source: SystemLogSource, text: string): void =>
  logSystem('DEBUG', source, text);
export const logInfo = (source: SystemLogSource, text: string): void =>
  logSystem('INFO', source, text);
export const logWarn = (source: SystemLogSource, text: string): void =>
  logSystem('WARN', source, text);

/**
 * Report a failure at ERROR, and remember that this source is failing so its
 * recovery can be logged. Notifies, since this is the only channel that reaches
 * a user who walked away from a run that is now failing — but only on a new
 * line, not on every repeat of one already said.
 */
export const postFailure = (
  level: 'ERROR' | 'FATAL',
  source: AppStatusSource,
  message: string,
): void => {
  const tag = SOURCE[source];
  const before = entries[entries.length - 1];
  logSystem(level, tag, message);
  const after = entries[entries.length - 1];
  // ERROR is a state a later success can clear; FATAL (data loss) is not, so it
  // never marks the source as merely "failing".
  if (level === 'ERROR') failing.add(tag);
  // Unchanged head means the post collapsed into a repeat — already announced.
  if (after === before || after?.repeats !== 1) return;
  notify(level === 'FATAL' ? 'Data loss' : 'Logger error', after.text, {
    tag: NOTIFY_TAG_APP_ERROR,
    sticky: true,
  });
};

/**
 * Report a failure. Accepts whatever a catch block caught, so call sites do not
 * each have to normalise it.
 */
export const reportError = (source: AppStatusSource, err: unknown, prefix?: string): void => {
  const detail = err instanceof Error ? err.message : String(err);
  postFailure('ERROR', source, prefix ? `${prefix}: ${detail}` : detail);
};

/** Report rows that existed and are now unrecoverable. See FATAL above. */
export const reportDataLoss = (source: AppStatusSource, message: string): void => {
  postFailure('FATAL', source, message);
};

/**
 * A subsystem is working again.
 *
 * Called on every successful poll rather than on the recovery transition, so
 * the guard is here: without it this would either do nothing at all or write a
 * "recovered" line 40 times a second. A log cannot un-say an error the way the
 * old status bar could dismiss one, so what a recovery produces now is a line
 * of its own — which is the more useful record anyway: how long the link was
 * down is a question the dismissed bar could never answer.
 */
export const clearStatusSource = (source: AppStatusSource): void => {
  const tag = SOURCE[source];
  if (!failing.delete(tag)) return;
  logSystem('INFO', tag, 'Recovered');
};
