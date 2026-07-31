// The log itself, separated from the window that used to be the only thing
// holding it.
//
// It is shown in two places now — the Script Log window, and chart slot 3 on the
// launcher — and both have to be the same log, not two views that drift. Pulling
// the rows, the tail-follow and the expanded set out here is what makes that
// true by construction rather than by remembering to change both.
//
// The layout rationale (logcat columns, folded newlines, no counter or level
// column) lives in ScriptLogPanel.tsx, which is still where this is read from
// most of the time.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScriptLogEntry, ScriptOutcome } from '../hooks/useScriptRunner';

export const OUTCOME_LABEL: Record<ScriptOutcome, string> = {
  idle: 'No run yet',
  running: 'Running',
  completed: 'Completed',
  stopped: 'Stopped',
  error: 'Error',
};

// The tokens the bottom status bar already uses for the same three streams, so a
// line does not change colour on its way from one surface to the other. This is
// not a severity — it is stderr being red, which is what stderr is.
const STREAM_COLOR: Record<ScriptLogEntry['stream'], string> = {
  stdout: 'text-slate-700 dark:text-slate-200',
  stderr: 'text-rose-600 dark:text-rose-400',
  system: 'text-slate-400 dark:text-slate-500',
};

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

/**
 * Rows are keyed by `seq`, and the expanded set is local to each mount. Two
 * copies of this on screen keep their own expansion state on purpose: they are
 * different sizes, and a row opened out in a 240 px chart slot has no business
 * opening in the window somebody is reading a traceback in.
 *
 * Takes entries rather than the runner, so the same rows render for a viewer —
 * which has no runner of its own and is shown the host's log over the feed.
 */
export function ScriptLogBody({
  scriptLog,
  className = '',
  style,
}: {
  scriptLog: ScriptLogEntry[];
  className?: string;
  /** The chart-slot copy pins a height here; the window lets flex do it. */
  style?: React.CSSProperties;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  // The tag column is as wide as the longest name actually in the log, plus its
  // colon — not a fixed width picked for the longest name allowed. `ch` is the
  // advance width of a digit and this is a monospace column, so the arithmetic
  // is exact. Capped, or one long name would push every message off screen.
  const tagWidthCh = useMemo(() => {
    const longest = scriptLog.reduce((max, entry) => Math.max(max, entry.source.length), 0);
    return Math.min(longest, 16) + 1;
  }, [scriptLog]);

  // Follow the tail, but only while the tail is what is being read.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    // Measured after the new row is in the DOM, so a box that was sitting at the
    // bottom is now exactly that row short of it — the slack has to cover a
    // row's height, not zero.
    const distanceFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (distanceFromBottom <= TAIL_SLACK_PX) box.scrollTop = box.scrollHeight;
  }, [scriptLog]);

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
      {scriptLog.length === 0 ? (
        <p className="px-2 py-1 text-slate-400 dark:text-slate-500">
          No output. Printed text goes here, along with errors and tracebacks.
        </p>
      ) : (
        scriptLog.map((entry) => {
          const isExpanded = expanded.has(entry.seq);
          // Worth a click only if there is something the row is not showing.
          const foldable = /\r?\n/.test(entry.text);
          return (
            <div
              key={entry.seq}
              onClick={() => toggleExpanded(entry.seq)}
              className="flex cursor-pointer gap-2 px-2 hover:bg-slate-100 dark:hover:bg-slate-800/60"
              title={isExpanded ? 'Click to collapse' : 'Click to show the whole line'}
            >
              {/* tabular-nums keeps the fixed columns from shivering as the
                  digits change under them. */}
              <span className="shrink-0 tabular-nums text-slate-400 dark:text-slate-500">
                {formatLogTime(entry.t)}
              </span>
              {/* Which script this came out of, `name:` — the tag notation
                  logcat and syslog both use, rather than [brackets]: a bracket
                  that survives while the name inside it is truncated away reads
                  as damage, where a trailing colon still reads as a label. */}
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
                className={`min-w-0 flex-1 ${STREAM_COLOR[entry.stream]} ${
                  isExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'
                }`}
              >
                {isExpanded ? entry.text : foldNewlines(entry.text)}
                {/* Says there is more where the row ends, for the case the
                    truncation is not visible — a folded traceback whose first
                    line happens to fit. */}
                {!isExpanded && foldable && (
                  <span className="ml-1 text-slate-400 dark:text-slate-500">…</span>
                )}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * Copy and Clear, shared by the window's header and the chart slot's.
 *
 * `onClear` is optional: a viewer is shown the host's log and has nothing of
 * its own to clear, and a Clear button there would either do nothing or imply a
 * way to reach back into the host that the feed deliberately does not have.
 */
export function ScriptLogActions({
  scriptLog,
  onClear,
}: {
  scriptLog: ScriptLogEntry[];
  onClear?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // The full text, unfolded and untruncated — what is on screen is a view of it,
  // and a log pasted into a bug report has to be the real thing.
  const copyLog = () => {
    const text = scriptLog
      .map((entry) =>
        [formatLogTime(entry.t), entry.source === '' ? '' : `${entry.source}:`, entry.text]
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
    <>
      <button
        type="button"
        className="button-secondary py-1 text-xs disabled:opacity-50"
        onClick={copyLog}
        disabled={scriptLog.length === 0}
        title="Copy the log to the clipboard, in full"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      {/* No confirmation: unlike the editor's Clear this destroys a record, not
          work — and the next run clears it anyway. */}
      {onClear && (
        <button
          type="button"
          className="button-secondary py-1 text-xs disabled:opacity-50"
          onClick={onClear}
          disabled={scriptLog.length === 0}
          title="Clear the log"
        >
          Clear
        </button>
      )}
    </>
  );
}
