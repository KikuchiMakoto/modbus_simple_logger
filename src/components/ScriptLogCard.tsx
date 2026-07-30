// The Script Log, in chart slot 3 on the launcher.
//
// Why here rather than only in its window: on the desktop build a script is
// usually what is driving the run, and its output is the other half of what the
// charts are showing. Four plots and a log the user has to remember to open is
// four views of the numbers and none of the reason they are moving.
//
// It is the same log as the window's, not a copy — both render ScriptLogBody
// over the same runner — so opening the window while this is on screen shows the
// same lines, and Clear in either place clears both.
import type { useScriptRunner } from '../hooks/useScriptRunner';
import { PLOT_HEIGHT } from './ChartPanel';
import { OUTCOME_LABEL, ScriptLogActions, ScriptLogBody } from './ScriptLogBody';

export function ScriptLogCard({
  scriptRunner,
}: {
  scriptRunner: ReturnType<typeof useScriptRunner>;
}) {
  const { scriptRun, scriptRunning, runningTab } = scriptRunner;
  const outcome = scriptRunning ? 'running' : scriptRun.outcome;

  return (
    // Same card and same header row as ChartPanel: this sits in the grid with
    // three plots and should not read as a different kind of object.
    <section className="card card-tight space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[0.7rem] font-semibold leading-none text-slate-600 dark:text-slate-300">
          Script Log
        </span>
        <span className="truncate text-[0.7rem] leading-none text-slate-400 dark:text-slate-500">
          {runningTab ? `${runningTab.name} — ${OUTCOME_LABEL[outcome]}` : OUTCOME_LABEL[outcome]}
        </span>
        {/* A running script is the one state worth a colour here: it is what
            explains a chart moving on its own. */}
        {scriptRunning && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        )}
        <span className="ml-auto flex shrink-0 gap-1">
          <ScriptLogActions scriptRunner={scriptRunner} />
        </span>
      </div>
      {/* Fixed height rather than flex-1: in the window the box grows to fill
          the frame, but here it has to match the plots beside it exactly. */}
      <ScriptLogBody scriptRunner={scriptRunner} style={{ height: PLOT_HEIGHT }} />
    </section>
  );
}
