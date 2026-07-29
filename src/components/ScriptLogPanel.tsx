// What a script reported: print() output, errors and tracebacks, and the
// runner's own start/stop lines.
//
// This used to be a pane inside the Script Runner, about five lines tall,
// sitting under the editor. Five lines is enough to notice an error and not
// enough to read one — a traceback scrolled past inside a box that small, in the
// window whose whole purpose is the editor above it. A window of its own can be
// opened next to the runner, made as tall as the failure needs, and left open
// across runs.
//
// Laid out like logcat, for the reason logcat is laid out that way: one entry
// per row, fixed columns, so the eye runs down a column instead of re-parsing
// each line. Time, script, message — and nothing is allowed to break that grid,
// so a message with newlines in it is folded onto its single row and truncated.
// The row expands on click, which is where a traceback is read.
//
// No counter column either. Numbering the rows of a log that is already in
// order, timestamped to the millisecond, tells the reader where they are in a
// list they can already see — while taking width from the only column with
// something to say. `seq` is still on the entry, as the identity the expanded
// set and React's keys need.
//
// No level column and no level filter. logcat has V/D/I/W/E because Android
// logs carry a severity the writer chose; nothing here does — a script prints,
// or it fails, and "failed" is already said in red. A letter that only ever took
// three values, one of them per row, would be a column of decoration.
//
// Sibling of the Status Log that AppStatusBar opens: same idea (a record worth
// reading after the fact rather than a strip glanced at), different source —
// that one carries the app's own failures, this one carries the script's.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { useScriptRunner } from '../hooks/useScriptRunner';
import type { ScriptLogEntry, ScriptOutcome } from '../hooks/useScriptRunner';
import { FloatingWindow } from './FloatingWindow';

type ScriptLogPanelProps = {
  open: boolean;
  onClose: () => void;
  scriptRunner: ReturnType<typeof useScriptRunner>;
};

// The tokens the bottom status bar already uses for the same three streams, so a
// line does not change colour on its way from one surface to the other. This is
// not a severity — it is stderr being red, which is what stderr is.
const STREAM_COLOR: Record<ScriptLogEntry['stream'], string> = {
  stdout: 'text-slate-700 dark:text-slate-200',
  stderr: 'text-rose-600 dark:text-rose-400',
  system: 'text-slate-400 dark:text-slate-500',
};

const OUTCOME_LABEL: Record<ScriptOutcome, string> = {
  idle: 'No run yet',
  running: 'Running',
  completed: 'Completed',
  stopped: 'Stopped',
  error: 'Error',
};

/** `14:22:31.482` — with milliseconds, which is what makes a burst readable. */
const formatLogTime = (t: number): string => {
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

export function ScriptLogPanel({ open, onClose, scriptRunner }: ScriptLogPanelProps) {
  const { scriptLog, scriptRun, scriptRunning, runningTab } = scriptRunner;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  // Rows opened out to their full text. Keyed by seq, which is stable for the
  // life of a run even as the tail trims the front of the array.
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  // The tag column is as wide as the longest name actually in the log, plus its
  // colon — not a fixed width picked for the longest name allowed. A run
  // normally has one script in it, so `main:` gets exactly `main:` worth
  // of column and the message starts right after it, while rows still line up
  // with each other (which is the only alignment that matters here). `ch` is the
  // advance width of a digit, and this is a monospace column, so the arithmetic
  // is exact. Capped, or one long name would push every message off screen.
  const tagWidthCh = useMemo(() => {
    const longest = scriptLog.reduce((max, entry) => Math.max(max, entry.source.length), 0);
    return Math.min(longest, 16) + 1;
  }, [scriptLog]);

  // Follow the tail, but only while the tail is what is being read. The old pane
  // scrolled to the newest line unconditionally, which in a script printing every
  // second meant scrolling back to read an earlier line was undone before it
  // could be read.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    // Measured after the new row is in the DOM, so a box that was sitting at the
    // bottom is now exactly that row short of it — the slack has to cover a row's
    // height, not zero.
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

  const outcome = scriptRunning ? 'running' : scriptRun.outcome;

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Script Log"
      // Which run this is the log of. The log is cleared at the start of every
      // run, so without the script's name a tail left open across runs reads as
      // belonging to whichever tab happens to be in front.
      subtitle={
        runningTab
          ? `${runningTab.name} — ${OUTCOME_LABEL[outcome]}`
          : `${OUTCOME_LABEL[outcome]} · ${scriptLog.length} ${scriptLog.length === 1 ? 'line' : 'lines'}`
      }
      accent="blue"
      defaultWidth={600}
      defaultHeight={380}
      headerActions={
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
          {/* No confirmation: unlike the editor's Clear this destroys a record,
              not work — and the next run clears it anyway. */}
          <button
            type="button"
            className="button-secondary py-1 text-xs disabled:opacity-50"
            onClick={scriptRunner.clearScriptLog}
            disabled={scriptLog.length === 0}
            title="Clear the log"
          >
            Clear
          </button>
        </>
      }
    >
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto font-mono text-[0.7rem] leading-[1.15rem]"
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
                    that survives while the name inside it is truncated away
                    reads as damage, where a trailing colon still reads as a
                    label. Width comes from the log's own longest name (see
                    tagWidthCh), so the rows align without the message column
                    being pushed off by slack nobody is using. */}
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
    </FloatingWindow>
  );
}
