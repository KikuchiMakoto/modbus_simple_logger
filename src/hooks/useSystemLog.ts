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

/** The threshold the reader has chosen. Set it with setSystemLogLevel. */
export const useSystemLogLevel = (): SystemLogLevel =>
  useSyncExternalStore(onSystemLogChange, systemLogLevel, systemLogLevel);

/**
 * Apply the current threshold to a list of lines.
 */
export const useVisibleSystemLog = (entries: SystemLogEntry[]): SystemLogEntry[] => {
  const level = useSystemLogLevel();
  return useMemo(
    () => (level === 'TRACE' ? entries : entries.filter((entry) => passesLevel(entry.level, level))),
    [entries, level],
  );
};
