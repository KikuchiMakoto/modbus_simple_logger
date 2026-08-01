// React's view of the module-level log in utils/systemLog.ts.
//
// `useSyncExternalStore` rather than a `useState` + subscribe effect: the store
// is written from worker callbacks and from the polling loop, outside React's
// render cycle, and this is the subscription form that cannot tear — every
// consumer of the log renders the same snapshot in the same commit.
import { useMemo, useSyncExternalStore } from 'react';
import {
  onSystemLogChange,
  passesLevel,
  systemLogLevel,
  systemLogSnapshot,
  type SystemLogEntry,
  type SystemLogLevel,
} from '../utils/systemLog';

/** Every line this window has recorded, unfiltered. */
export const useSystemLogEntries = (): SystemLogEntry[] =>
  useSyncExternalStore(onSystemLogChange, systemLogSnapshot, systemLogSnapshot);

/**
 * The log a surface should show: this window's own, or the host's when one was
 * handed in.
 *
 * Subscribing here — in the three components that display the log — rather than
 * in App is deliberate. App renders the charts; a script printing ten lines a
 * second would otherwise re-render the whole page at that rate to update a
 * 200 px box. Anything in App that needs the entries without displaying them
 * (the viewer snapshot, built once a second) reads systemLogSnapshot() directly.
 */
export const useSystemLogSource = (remote?: SystemLogEntry[]): SystemLogEntry[] => {
  const local = useSystemLogEntries();
  return remote ?? local;
};

/** The threshold the reader has chosen. Set it with setSystemLogLevel. */
export const useSystemLogLevel = (): SystemLogLevel =>
  useSyncExternalStore(onSystemLogChange, systemLogLevel, systemLogLevel);

/**
 * Apply the current threshold to a list of lines.
 *
 * Takes the entries rather than reading the store, because a viewer shows the
 * host's log — arrived over the feed, held in App's state — and it has to
 * filter exactly the way the host's own window does.
 */
export const useVisibleSystemLog = (entries: SystemLogEntry[]): SystemLogEntry[] => {
  const level = useSystemLogLevel();
  return useMemo(
    () => (level === 'TRACE' ? entries : entries.filter((entry) => passesLevel(entry.level, level))),
    [entries, level],
  );
};
