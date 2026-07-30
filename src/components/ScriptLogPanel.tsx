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
//
// The rows themselves live in ScriptLogBody, because chart slot 3 shows the same
// log on the launcher and the two must not be able to drift apart.
import type { useScriptRunner } from '../hooks/useScriptRunner';
import { FloatingWindow } from './FloatingWindow';
import { OUTCOME_LABEL, ScriptLogActions, ScriptLogBody } from './ScriptLogBody';

type ScriptLogPanelProps = {
  open: boolean;
  onClose: () => void;
  scriptRunner: ReturnType<typeof useScriptRunner>;
};

export function ScriptLogPanel({ open, onClose, scriptRunner }: ScriptLogPanelProps) {
  const { scriptLog, scriptRun, scriptRunning, runningTab } = scriptRunner;

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
      // Emerald (FloatingWindow's default), not the blue the config/tester
      // panels use: this window is the other half of Script Runner — opened
      // beside it, showing that window's run — and a title bar in a different
      // colour read as a different kind of thing.
      defaultWidth={600}
      defaultHeight={380}
      headerActions={<ScriptLogActions scriptRunner={scriptRunner} />}
    >
      {/* min-h-0 flex-1 is what makes the scroll box fill the window and stop
          there; the chart-slot copy gives it a fixed height instead. */}
      <ScriptLogBody scriptRunner={scriptRunner} className="min-h-0 flex-1" />
    </FloatingWindow>
  );
}
