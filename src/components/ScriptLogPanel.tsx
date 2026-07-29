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
// Sibling of the Status Log that AppStatusBar opens: same idea (a record worth
// reading after the fact rather than a strip glanced at), different source —
// that one carries the app's own failures, this one carries the script's.
import { useEffect, useRef, useState } from 'react';
import type { useScriptRunner } from '../hooks/useScriptRunner';
import type { ScriptLogEntry, ScriptOutcome } from '../hooks/useScriptRunner';
import { FloatingWindow } from './FloatingWindow';

type ScriptLogPanelProps = {
  open: boolean;
  onClose: () => void;
  scriptRunner: ReturnType<typeof useScriptRunner>;
};

// Same tokens the bottom status bar uses for the same three streams, so a line
// does not change colour on its way from one surface to the other.
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

const formatLogTime = (t: number): string => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

// How close to the bottom still counts as "watching the tail", in pixels. Two
// lines' worth at this line height: enough that the newly added line does not
// itself look like the user has scrolled away, and little enough that a
// deliberate scroll back is left alone.
const TAIL_SLACK_PX = 36;

export function ScriptLogPanel({ open, onClose, scriptRunner }: ScriptLogPanelProps) {
  const { scriptLog, scriptRun, scriptRunning, runningTab } = scriptRunner;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);

  // Follow the tail, but only while the tail is what is being read. The old pane
  // scrolled to the newest line unconditionally, which in a script printing every
  // second meant scrolling back to read an earlier line was undone before it
  // could be read.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    // Measured after the new line is in the DOM, so a box that was sitting at
    // the bottom is now exactly that line short of it — the slack has to cover
    // one line's height, not zero.
    const distanceFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (distanceFromBottom <= TAIL_SLACK_PX) box.scrollTop = box.scrollHeight;
  }, [scriptLog]);

  const copyLog = () => {
    const text = scriptLog.map((entry) => `${formatLogTime(entry.t)} ${entry.text}`).join('\n');
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
      defaultWidth={560}
      defaultHeight={360}
      headerActions={
        <>
          <button
            type="button"
            className="button-secondary py-1 text-xs"
            onClick={copyLog}
            disabled={scriptLog.length === 0}
            title="Copy the whole log to the clipboard"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          {/* No confirmation: unlike the editor's Clear this destroys a record,
              not work — and the next run clears it anyway. */}
          <button
            type="button"
            className="button-secondary py-1 text-xs"
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
        className="min-h-0 flex-1 overflow-auto px-2 py-1 font-mono text-[0.7rem] leading-[1.05rem]"
      >
        {scriptLog.length === 0 ? (
          <p className="text-slate-400 dark:text-slate-500">
            No output. Printed text goes here, along with errors and tracebacks.
          </p>
        ) : (
          scriptLog.map((entry, index) => (
            <div
              key={`${entry.t}-${index}`}
              className={`whitespace-pre-wrap break-words ${STREAM_COLOR[entry.stream]}`}
            >
              <span className="mr-2 text-slate-400 dark:text-slate-600">
                {formatLogTime(entry.t)}
              </span>
              {entry.text}
            </div>
          ))
        )}
      </div>
    </FloatingWindow>
  );
}
