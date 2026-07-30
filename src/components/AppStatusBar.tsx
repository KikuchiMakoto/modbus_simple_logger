// The app's error surface: a fixed strip along the bottom, above the PyScript
// bar. See utils/appStatus.ts for why this exists at all.
//
// Failures only. It is silent — absent, not empty — during a healthy run, which
// is what keeps it worth looking at when it does appear.
//
// Sibling of ScriptStatusBar, with three deliberate differences:
//
//  - Rendered on a viewer too, where ScriptStatusBar is not: a viewer can still
//    lose its feed, and nothing else on that window would say so.
//  - No spacer. ScriptStatusBar reserves an `h-8` because it is always present.
//    This renders null when there is nothing to say, so it must be a pure
//    overlay — a conditional spacer would reflow the whole page every time a
//    message arrives, which is during a measurement.
//  - Dismissable, with history. Errors are sticky by design, so there has to be
//    a way to put them away.
import { useEffect, useState } from 'react';
import {
  appStatusSnapshot,
  dismissAllStatus,
  dismissStatus,
  onAppStatusChange,
  type AppStatusEntry,
  type AppStatusLevel,
} from '../utils/appStatus';
import { isViewerMode } from '../utils/appMode';
import { FloatingWindow } from './FloatingWindow';

// Red for errors is an exception to the emerald/slate rule, scoped to the
// bottom-bar family: ScriptStatusBar already uses these exact tokens for its
// `error` outcome and its stderr stream, so this is sharing an established
// semantic colour within one pattern rather than introducing a new one. Amber
// for dataLoss falls under the rule's existing "unrecoverable data" carve-out.
const LEVEL_STYLE: Record<AppStatusLevel, { dot: string; text: string; label: string }> = {
  error: {
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    label: 'Error',
  },
  dataLoss: {
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    label: 'Data loss',
  },
};

const SOURCE_LABEL: Record<AppStatusEntry['source'], string> = {
  link: 'Link',
  save: 'Save',
  recording: 'Recording',
  calibration: 'Calibration',
  storage: 'Storage',
  app: 'App',
};

const formatTime = (ms: number): string => new Date(ms).toLocaleTimeString();

function EntryRow({ entry }: { entry: AppStatusEntry }) {
  const style = LEVEL_STYLE[entry.level];
  return (
    <div className="flex items-start gap-2 border-b border-slate-100 py-1.5 text-xs last:border-b-0 dark:border-slate-800">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
      <span className="shrink-0 font-mono text-slate-400 dark:text-slate-500">
        {formatTime(entry.lastAt)}
      </span>
      <span className="shrink-0 font-semibold text-slate-500 dark:text-slate-400">
        {SOURCE_LABEL[entry.source]}
      </span>
      <span className={`min-w-0 flex-1 break-words ${style.text}`}>
        {entry.message}
        {entry.repeats > 1 && (
          <span className="ml-1 text-slate-400 dark:text-slate-500">(×{entry.repeats})</span>
        )}
      </span>
    </div>
  );
}

export function AppStatusBar() {
  const [entries, setEntries] = useState<AppStatusEntry[]>(appStatusSnapshot);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => onAppStatusChange(setEntries), []);

  // Nothing to say: render nothing at all, and close a history window that has
  // gone empty underneath the user.
  useEffect(() => {
    if (entries.length === 0 && historyOpen) setHistoryOpen(false);
  }, [entries.length, historyOpen]);

  if (entries.length === 0) return null;

  const head = entries[0];
  const style = LEVEL_STYLE[head.level];
  const older = entries.length - 1;

  return (
    <>
      {/* Sits on top of the script bar, so the offset tracks that bar's two
          heights (h-6, then h-8 at md) — and drops to the floor on a viewer,
          which does not render that bar at all. */}
      <div
        className={`fixed left-0 right-0 z-30 flex min-h-8 items-center gap-2 border-t border-slate-200 bg-slate-50/90 px-3 py-1 text-xs backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 ${
          isViewerMode ? 'bottom-0' : 'bottom-6 md:bottom-8'
        }`}
      >
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
        <span className="shrink-0 font-semibold text-slate-800 dark:text-slate-100">
          {style.label}
        </span>
        <span className="shrink-0 rounded bg-slate-200 px-1 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-700 dark:text-slate-400">
          {SOURCE_LABEL[head.source]}
        </span>
        <span className={`min-w-0 flex-1 truncate ${style.text}`}>
          {head.message}
          {head.repeats > 1 && (
            <span className="ml-1 text-slate-400 dark:text-slate-500">(×{head.repeats})</span>
          )}
        </span>
        {older > 0 && (
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[0.65rem] font-semibold text-slate-600 hover:border-emerald-400 dark:border-slate-600 dark:text-slate-300"
          >
            +{older}
          </button>
        )}
        <button
          type="button"
          onClick={() => dismissStatus(head.id)}
          aria-label="Dismiss"
          title="Dismiss"
          className="shrink-0 rounded px-1 text-sm leading-none text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          ×
        </button>
      </div>

      {/* The panel's own children area already scrolls and carries no padding,
          so this supplies the padding and lets that scroller do its job. */}
      <FloatingWindow
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Status Log"
        subtitle={`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}, newest first`}
        defaultWidth={640}
        defaultHeight={360}
        headerActions={
          <button
            type="button"
            onClick={dismissAllStatus}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300"
          >
            Clear all
          </button>
        }
      >
        <div className="px-2 py-1">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      </FloatingWindow>
    </>
  );
}
