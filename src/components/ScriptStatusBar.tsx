import { useState } from 'react';
import type { ScriptLogEntry, ScriptOutcome } from '../hooks/useScriptRunner';

const OUTCOME_BADGE: Record<ScriptOutcome, { label: string; dot: string }> = {
  idle: { label: 'Idle', dot: 'bg-slate-400' },
  running: { label: 'Running', dot: 'bg-red-500 animate-pulse shadow-[0_0_6px_2px_rgba(239,68,68,0.7)]' },
  completed: { label: 'Completed', dot: 'bg-emerald-500' },
  stopped: { label: 'Stopped', dot: 'bg-slate-400' },
  error: { label: 'Error', dot: 'bg-red-500' },
};

const STREAM_COLOR: Record<ScriptLogEntry['stream'], string> = {
  stdout: 'text-slate-700 dark:text-slate-200',
  stderr: 'text-red-600 dark:text-red-400',
  system: 'text-emerald-600 dark:text-emerald-400',
};

/** One rendered state of the bar's single line, and what makes it that one. */
type Rung = {
  /** Changes exactly when the line should roll. See `rungOf`. */
  id: string;
  text: string;
  color: string;
  /** Drives the `›` marker, which lives outside the roll — see the bar below. */
  isLog: boolean;
};

// `seq` is the log entry's identity for the life of a run and survives the tail
// trimming the front of the array, which is why it is preferred to an index. It
// restarts at 1 per run though, so `t` is folded in: without it, clearing the log
// and printing one line would produce seq 1 again and the bar would sit still.
// The `s:` case is the no-log fallback (a status message), keyed by its own text.
const rungOf = (line: ScriptLogEntry | null, text: string, color: string): Rung => ({
  id: line ? `l:${line.seq}:${line.t}` : `s:${text}`,
  text,
  color,
  isLog: line !== null,
});

function LogLine({ rung, animation }: { rung: Rung; animation: string }) {
  return (
    // inset-0 over a self-stretch track, so translateY(±100%) is the full height
    // of the bar: the line enters from below its bottom edge rather than from
    // one text-height up, which is what makes it read as arriving from off-bar.
    <div className={`absolute inset-0 flex items-center font-mono ${rung.color} ${animation}`}>
      {/* truncate needs min-w-0 to shrink below its content inside a flex row. */}
      <span className="min-w-0 truncate">{rung.text}</span>
    </div>
  );
}

export function ScriptStatusBar({
  running,
  outcome,
  status,
  lastLogLine,
  languageLabel,
  runtimeBadge,
}: {
  running: boolean;
  outcome: ScriptOutcome;
  status: string;
  lastLogLine: ScriptLogEntry | null;
  /** Which language the runner is set to — the bar used to be Python-only. */
  languageLabel: string;
  runtimeBadge: string;
}) {
  const badge = running ? OUTCOME_BADGE.running : OUTCOME_BADGE[outcome];
  const line = lastLogLine ?? null;
  const lineColor = line ? STREAM_COLOR[line.stream] : 'text-slate-500 dark:text-slate-400';
  const text = line ? line.text : (badge.label === status ? '' : status);
  const incoming = rungOf(line, text, lineColor);

  // The line currently on the bar and the one being pushed off it. `gen` only
  // exists to be a React key: remounting both nodes is what restarts the CSS
  // animations, which would otherwise run once and never again.
  //
  // Adjusted during render rather than in an effect. React re-runs this
  // component immediately, before the browser paints, so the roll starts on the
  // same frame the line arrives — an effect would paint the new text in place
  // first and then animate it in from below, which flickers.
  const [roll, setRoll] = useState({ current: incoming, outgoing: null as Rung | null, gen: 0 });
  if (roll.current.id !== incoming.id) {
    setRoll({ current: incoming, outgoing: roll.current, gen: roll.gen + 1 });
  }

  return (
    <>
      {/* Spacer, so the fixed bar never covers the bottom of the page. It is
          in the flow *inside* #root, which carries the UI-scale `zoom` — a
          padding on <body> would stay unscaled and come up short of the bar's
          visual height at any scale above 100%. Same heights as the bar. */}
      <div aria-hidden className="h-6 md:h-8" />
      {/* Narrow screens get a shorter bar, not no bar. It used to hide itself
          below `md`, which is exactly where a phone on the WebUSB path sits —
          the one setup with no room for a Script Runner window either, so the
          bar was the only thing that could have said a script was running at
          all. Two steps of h/text/gap instead, and only the runtime chip drops
          out: it repeats what the language name already implies, and it is the
          widest thing here. */}
      <div className="fixed bottom-0 left-0 right-0 z-20 flex h-6 items-center border-t border-slate-200 bg-slate-50/70 px-2 text-[0.65rem] backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 md:h-8 md:px-3 md:text-xs">
        <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full md:h-2.5 md:w-2.5 ${badge.dot}`} />
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            {languageLabel}
          </span>
          <span className="hidden rounded bg-slate-200 px-1 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-700 dark:text-slate-400 md:inline">
            {runtimeBadge}
          </span>
          <span className="text-slate-500 dark:text-slate-400">{badge.label}</span>
        </div>
        <div className="ml-2 flex min-w-0 flex-1 items-center self-stretch md:ml-3">
          {/* Outside the roll on purpose. The marker is not part of the message
              — it is a gutter mark saying "what follows is script output rather
              than a status line" — and a fixed frame with the text rolling
              behind it is what makes this read as one bar being updated, rather
              than two whole rows sliding past each other. It is also the same
              mark on every line, so animating it only ever showed it replacing
              itself. */}
          {roll.current.isLog && (
            <span className="mr-1 shrink-0 text-slate-400 dark:text-slate-500">›</span>
          )}
          {/* The track the lines roll through: full bar height (self-stretch)
              and clipped, so a line above or below its resting position is
              simply not there. `relative` anchors the two absolute lines. */}
          <div className="relative min-w-0 flex-1 self-stretch overflow-hidden">
            {roll.outgoing && (
              <LogLine
                key={`out-${roll.gen}`}
                rung={roll.outgoing}
                animation="script-log-roll-out"
              />
            )}
            <LogLine
              key={`in-${roll.gen}`}
              rung={roll.current}
              // gen 0 is the state the bar mounted with — nothing was displaced,
              // so there is nothing to announce. Rolling it in would animate the
              // bar on every page load.
              animation={roll.gen === 0 ? '' : 'script-log-roll-in'}
            />
          </div>
        </div>
      </div>
    </>
  );
}