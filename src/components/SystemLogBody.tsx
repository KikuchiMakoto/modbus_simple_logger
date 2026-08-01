// The log's rows, separated from the windows that show them.
//
// It appears in three places — the System Log window, chart slot 3 on the
// launcher, and (one line of it) the footer — and they have to be the same log,
// not views that drift. Pulling the rows, the tail-follow, the threshold filter
// and the expanded set out here is what makes that true by construction.
//
// Laid out like logcat, for the reason logcat is laid out that way: one entry
// per row, fixed columns, so the eye runs down a column instead of re-parsing
// each line. Time, level, source, message — and nothing is allowed to break
// that grid, so a message with newlines in it is folded onto its single row and
// truncated. The row expands on click, which is where a traceback is read.
//
// There is a level column now, where the Script Log deliberately had none. The
// reason that argument held was that nothing writing to it carried a severity
// the writer chose — a script prints, or it fails. This log carries the app's
// own events as well, at six levels, with a threshold the reader can move; a
// row's level is now the thing that explains why it is on screen at all.
//
// No counter column, still. Numbering the rows of a log that is already in
// order and timestamped to the millisecond tells the reader where they are in a
// list they can see, while taking width from the only column with something to
// say.
//
// No Clear button either. The log scrolls on its own and the threshold is the
// control that quiets it; a button that destroys the record of the last hour to
// make the last minute easier to read is the wrong trade in a window whose
// whole job is to still have the line from an hour ago.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useSystemLogEntries, useSystemLogLevel, useVisibleSystemLog } from '../hooks/useSystemLog';
import {
  SYSTEM_LOG_LEVELS,
  setSystemLogLevel,
  type SystemLogEntry,
  type SystemLogLevel,
} from '../utils/systemLog';

// Slate for the two levels below the default threshold — they are detail, and
// detail that shouts is detail nobody can read past. Amber/red/rose climb from
// there. Red for failure is the same exception the bottom bar already made.
const LEVEL_STYLE: Record<SystemLogLevel, { text: string; badge: string }> = {
  TRACE: {
    text: 'text-slate-400 dark:text-slate-500',
    badge: 'text-slate-400 dark:text-slate-600',
  },
  DEBUG: {
    text: 'text-slate-500 dark:text-slate-400',
    badge: 'text-slate-400 dark:text-slate-500',
  },
  INFO: {
    text: 'text-slate-700 dark:text-slate-200',
    badge: 'text-sky-600 dark:text-sky-400',
  },
  WARN: {
    text: 'text-amber-700 dark:text-amber-300',
    badge: 'text-amber-600 dark:text-amber-400',
  },
  ERROR: {
    text: 'text-rose-600 dark:text-rose-400',
    badge: 'text-rose-600 dark:text-rose-400',
  },
  FATAL: {
    text: 'text-red-700 dark:text-red-400',
    badge: 'font-bold text-red-700 dark:text-red-400',
  },
};

/** The colour a level is drawn in, shared with the footer's single line. */
export const levelTextClass = (level: SystemLogLevel): string => LEVEL_STYLE[level].text;

/** `14:22:31.482` — with milliseconds, which is what makes a burst readable. */
export const formatLogTime = (t: number): string => {
  const d = new Date(t);
  return (
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:` +
    `${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
  );
};

// Newlines folded to a visible arrow rather than a space: a traceback collapsed
// onto one row should read as several lines standing in for themselves, not as
// one sentence that happens to be strangely worded.
const foldNewlines = (text: string): string => text.replace(/\r?\n/g, ' ⏎ ');

// How close to the bottom still counts as "watching the tail", in pixels. Two
// rows' worth: enough that the newly added row does not itself look like the
// user has scrolled away, and little enough that a deliberate scroll back is
// left alone.
const TAIL_SLACK_PX = 36;

// Memoised because the log now runs to a couple of thousand rows and a busy
// script appends to it ten times a second. Without this, every append
// re-rendered every row on the thread the Modbus loop runs on; with it, React
// walks the child list and stops.
const LogRow = memo(function LogRow({
  entry,
  tagWidthCh,
  expanded,
  onToggle,
}: {
  entry: SystemLogEntry;
  tagWidthCh: number;
  expanded: boolean;
  onToggle: (seq: number) => void;
}) {
  const style = LEVEL_STYLE[entry.level];
  // Worth a click only if there is something the row is not showing.
  const foldable = /\r?\n/.test(entry.text);
  return (
    <div
      onClick={() => onToggle(entry.seq)}
      className="flex cursor-pointer gap-2 px-2 hover:bg-slate-100 dark:hover:bg-slate-800/60"
      title={expanded ? 'Click to collapse' : 'Click to show the whole line'}
    >
      {/* tabular-nums keeps the fixed columns from shivering as the digits
          change under them. */}
      <span className="shrink-0 tabular-nums text-slate-400 dark:text-slate-500">
        {formatLogTime(entry.t)}
      </span>
      {/* One letter, not five: the level is a column the eye scans down for the
          one row that is not I, and a full word would cost four characters of
          message on every row to say what the colour already says. */}
      <span className={`w-[1ch] shrink-0 ${style.badge}`} title={entry.level}>
        {entry.level[0]}
      </span>
      {/* Which subsystem or script this came out of, `name:` — the tag notation
          logcat and syslog both use, rather than [brackets]: a bracket that
          survives while the name inside it is truncated away reads as damage,
          where a trailing colon still reads as a label. */}
      <span
        className="flex shrink-0 text-slate-500 dark:text-slate-400"
        style={{ width: `${tagWidthCh}ch` }}
      >
        <span className="min-w-0 truncate" title={entry.source}>
          {entry.source}
        </span>
        {entry.source !== '' && <span>:</span>}
      </span>
      <span
        className={`min-w-0 flex-1 ${style.text} ${
          expanded ? 'whitespace-pre-wrap break-words' : 'truncate'
        }`}
      >
        {expanded ? entry.text : foldNewlines(entry.text)}
        {/* Says there is more where the row ends, for the case the truncation is
            not visible — a folded traceback whose first line happens to fit. */}
        {!expanded && foldable && <span className="ml-1 text-slate-400 dark:text-slate-500">…</span>}
        {/* A line said twice is one row, not two. Without the count, a link
            failing 400 times and failing once look identical. */}
        {entry.repeats > 1 && (
          <span className="ml-1 text-slate-400 dark:text-slate-500">(×{entry.repeats})</span>
        )}
      </span>
    </div>
  );
});

/**
 * Rows are keyed by `seq`, and the expanded set is local to each mount. Two
 * copies of this on screen keep their own expansion state on purpose: they are
 * different sizes, and a row opened out in a 240 px chart slot has no business
 * opening in the window somebody is reading a traceback in.
 *
 * Subscribing here — in the three components that display the log — rather
 * than in App is deliberate. App renders the charts; a script printing ten
 * lines a second would otherwise re-render the whole page at that rate to
 * update a 200 px box.
 */
export function SystemLogBody({
  className = '',
  style,
}: {
  className?: string;
  /** The chart-slot copy pins a height here; the window lets flex do it. */
  style?: React.CSSProperties;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const entries = useSystemLogEntries();
  const visible = useVisibleSystemLog(entries);
  const level = useSystemLogLevel();

  // The tag column is as wide as the longest name actually on screen, plus its
  // colon — not a fixed width picked for the longest name allowed. `ch` is the
  // advance width of a digit and this is a monospace column, so the arithmetic
  // is exact. Capped, or one long script name would push every message off.
  const tagWidthCh = useMemo(() => {
    const longest = visible.reduce((max, entry) => Math.max(max, entry.source.length), 0);
    return Math.min(longest, 16) + 1;
  }, [visible]);

  // Follow the tail, but only while the tail is what is being read.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    // Measured after the new row is in the DOM, so a box that was sitting at the
    // bottom is now exactly that row short of it — the slack has to cover a
    // row's height, not zero.
    const distanceFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (distanceFromBottom <= TAIL_SLACK_PX) box.scrollTop = box.scrollHeight;
  }, [visible]);

  const toggleExpanded = (seq: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  };

  return (
    <div
      ref={scrollRef}
      style={style}
      className={`overflow-auto font-mono text-[0.7rem] leading-[1.15rem] ${className}`}
    >
      {visible.length === 0 ? (
        <p className="px-2 py-1 text-slate-400 dark:text-slate-500">
          {entries.length === 0
            ? 'Nothing logged yet. Connection events, save and recording failures, and whatever a script prints all arrive here.'
            : // Distinguishing the two silences matters: a log that is empty
              // because the threshold is hiding everything looks exactly like a
              // broken log unless it says so.
              `Nothing at ${level} or above. ${entries.length} quieter ${
                entries.length === 1 ? 'line is' : 'lines are'
              } hidden — lower the level to see them.`}
        </p>
      ) : (
        visible.map((entry) => (
          <LogRow
            key={entry.seq}
            entry={entry}
            tagWidthCh={tagWidthCh}
            expanded={expanded.has(entry.seq)}
            onToggle={toggleExpanded}
          />
        ))
      )}
    </div>
  );
}

/**
 * The threshold control, in the header of whichever surface is showing the log.
 *
 * It replaces the Clear button rather than joining it. Clear answered "this log
 * is too noisy to read" by destroying it; this answers the same question by
 * hiding the noise, and the line that mattered is still there when the
 * threshold comes back down.
 */
export function SystemLogLevelSelect({ className = '' }: { className?: string }) {
  const level = useSystemLogLevel();
  return (
    <select
      value={level}
      onChange={(event) => setSystemLogLevel(event.target.value as SystemLogLevel)}
      className={`rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 ${className}`}
      aria-label="Minimum log level"
      title="Show this level and above. INFO is the run's story; DEBUG and TRACE add the detail behind a failure."
    >
      {SYSTEM_LOG_LEVELS.map((entry) => (
        <option key={entry} value={entry}>
          {entry}
        </option>
      ))}
    </select>
  );
}

/**
 * Copy, shared by the window's header and the chart slot's.
 *
 * The full text — every level, unfolded and untruncated, whatever the threshold
 * is set to. What is on screen is a view of the log, and a log pasted into a
 * bug report has to be the real thing: the DEBUG lines the reader filtered out
 * are exactly the ones whoever reads the report will want.
 */
export function SystemLogCopyButton() {
  const [copied, setCopied] = useState(false);
  const entries = useSystemLogEntries();

  const copyLog = () => {
    const text = entries
      .map((entry) =>
        [
          formatLogTime(entry.t),
          entry.level.padEnd(5),
          entry.source === '' ? '' : `${entry.source}:`,
          entry.repeats > 1 ? `(×${entry.repeats})` : '',
          entry.text,
        ]
          .filter((part) => part !== '')
          .join(' '),
      )
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      className="button-secondary py-1 text-xs disabled:opacity-50"
      onClick={copyLog}
      disabled={entries.length === 0}
      title="Copy the whole log to the clipboard, every level, in full"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}
