// The one strip along the bottom: what the runner is doing, and the newest line
// of the System Log.
//
// It used to be two strips. This one carried the script runner and its output;
// AppStatusBar sat on top of it whenever the app had a failure to report, which
// meant the footer grew a second row — during a measurement, reflowing the page
// — and the two rows then disagreed about which clock and which colour meant
// what. There is one row now, always the same height, and the app's failures
// arrive on it the same way a script's output does: as System Log lines, at
// ERROR, in red, with the subsystem as their tag.
//
// Nothing is dismissable here any more, because nothing is sticky: the line
// rolls, and the record it rolled off is in the System Log window rather than
// behind a × that threw it away.
import { useState } from 'react';
import { useSystemLogEntries, useVisibleSystemLog } from '../hooks/useSystemLog';
import { levelTextClass } from './SystemLogBody';
import type { ScriptOutcome } from '../hooks/useScriptRunner';
import type { SystemLogEntry } from '../utils/systemLog';

const OUTCOME_BADGE: Record<ScriptOutcome, { label: string; dot: string }> = {
  idle: { label: 'Idle', dot: 'bg-slate-400' },
  running: {
    label: 'Running',
    dot: 'bg-red-500 animate-pulse shadow-[0_0_6px_2px_rgba(239,68,68,0.7)]',
  },
  completed: { label: 'Completed', dot: 'bg-emerald-500' },
  stopped: { label: 'Stopped', dot: 'bg-slate-400' },
  error: { label: 'Error', dot: 'bg-red-500' },
};

const pad2 = (n: number) => String(n).padStart(2, '0');

// Seconds, no milliseconds — where the System Log window shows HH:MM:SS.mmm. The
// difference is deliberate: this bar holds one line at a time and is glanced at,
// so the clock answers "is this fresh or from ten minutes ago", which seconds
// settle. Sub-second precision is for reading lines against each other, which
// needs the window. Local time, like every other clock in this app.
const clockOf = (t: number): string => {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

/** One rendered state of the bar's single line, and what makes it that one. */
type Rung = {
  /** Changes exactly when the line should roll. See `rungOf`. */
  id: string;
  text: string;
  color: string;
  /** Drives the `›` marker, which lives outside the roll — see the bar below. */
  isLog: boolean;
  /** Both empty for a status message. Inside the roll — see LogLine. */
  time: string;
  source: string;
};

// `seq` is the entry's identity for the life of the session, and survives the
// ring trimming the front of the array — which is why it is preferred to an
// index. `t` is folded in so that a line repeating (which updates the entry in
// place, bumping its count) still rolls the bar rather than leaving it sitting
// still. The `s:` case is the no-log fallback, keyed by its own text.
const rungOf = (line: SystemLogEntry | null, text: string, color: string): Rung => ({
  id: line ? `l:${line.seq}:${line.t}` : `s:${text}`,
  text,
  color,
  isLog: line !== null,
  time: line ? clockOf(line.t) : '',
  source: line?.source ?? '',
});

function LogLine({ rung, animation }: { rung: Rung; animation: string }) {
  return (
    // inset-0 over a self-stretch track, so translateY(±100%) is the full height
    // of the bar: the line enters from below its bottom edge rather than from
    // one text-height up, which is what makes it read as arriving from off-bar.
    <div
      className={`absolute inset-0 flex items-center gap-1.5 font-mono ${rung.color} ${animation}`}
    >
      {/* Time and source roll WITH the message, unlike the `›` gutter mark: they
          describe this particular line, and left fixed they would sit stating
          the wrong time next to a message that had already changed. Both drop
          below `md`, where the bar is 24px tall and already gives up the runtime
          chip — the message is what the bar is for, and these two would take
          ~40% of the room it has on a phone. */}
      {rung.time && (
        <span className="hidden shrink-0 text-slate-400 dark:text-slate-500 md:inline">
          {rung.time}
        </span>
      )}
      {rung.source && (
        <span className="hidden max-w-[8rem] shrink-0 truncate font-semibold text-slate-500 dark:text-slate-400 md:inline">
          {rung.source}
        </span>
      )}
      {/* Last, and the only thing allowed to shrink: truncate needs min-w-0 to
          go below its content width inside a flex row. */}
      <span className="min-w-0 truncate">{rung.text}</span>
    </div>
  );
}

export function FooterBar({
  pollIntervalMs,
  runner,
}: {
  /** Measured poll interval in ms, or 0 when nothing is polling. */
  pollIntervalMs: number;
  runner: {
    running: boolean;
    outcome: ScriptOutcome;
    status: string;
    languageLabel: string;
    /** The script the runner is pointed at — the running one, or the tab in front. */
    scriptName: string;
  };
}) {
  const visible = useVisibleSystemLog(useSystemLogEntries());
  const line = visible[visible.length - 1] ?? null;
  const badge = runner ? (runner.running ? OUTCOME_BADGE.running : OUTCOME_BADGE[runner.outcome]) : null;
  const lineColor = line ? levelTextClass(line.level) : 'text-slate-500 dark:text-slate-400';
  // The runner's own status text is the fallback, and only while it says
  // something the badge beside it does not.
  const fallback = runner && badge && badge.label !== runner.status ? runner.status : '';
  const incoming = rungOf(line, line ? line.text : fallback, lineColor);

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
      {/* Spacer, so the fixed bar never covers the bottom of the page. It is in
          the flow *inside* #root, which carries the UI-scale `zoom` — a padding
          on <body> would stay unscaled and come up short of the bar's visual
          height at any scale above 100%. Same heights as the bar. */}
      <div aria-hidden className="h-6 md:h-8" />
      {/* Narrow screens get a shorter bar, not no bar. It used to hide itself
          below `md`, which is exactly where a phone on the WebUSB path sits —
          the one setup with no room for a Script Runner window either, so the
          bar was the only thing that could have said a script was running at
          all. Two steps of h/text/gap instead, and only the script-name chip
          drops out: the log line beside it already names the script it came
          from, and the chip is the widest fixed thing here. */}
      <div className="fixed bottom-0 left-0 right-0 z-20 flex h-6 items-center gap-2 border-t border-slate-200 bg-slate-50/70 px-2 text-[0.65rem] backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 md:h-8 md:gap-3 md:px-3 md:text-xs">
        {runner && badge && (
          <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full md:h-2.5 md:w-2.5 ${badge.dot}`} />
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              {runner.languageLabel}
            </span>
            {/* The script's name, where the runtime version used to be. The
                version was a constant — it said "Pyodide 314.0.3" for the life
                of the install, next to a language name that already implied it
                — while the one thing this bar could not answer was WHICH script
                Run/Stop is about, which changes with every tab. It is in the
                Script Runner's subtitle for anyone who wants it.

                Not uppercased, unlike the chip it replaces: this is a name the
                user typed, and case is part of it. Still dropped below `md`,
                where the bar is 24px tall — the message is what the bar is for,
                and a name is the widest thing here. */}
            <span className="hidden max-w-[10rem] truncate rounded bg-slate-200 px-1 py-0.5 text-[0.6rem] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300 md:inline">
              {runner.scriptName}
            </span>
            <span className="text-slate-500 dark:text-slate-400">{badge.label}</span>
          </div>
        )}
        {/* The gap between the bar's groups is the parent's now, not a margin
            here: the runner group is optional, and a margin on it would open
            next to nothing when it is absent. `gap` is only drawn between
            siblings that exist. */}
        <div className="flex min-w-0 flex-1 items-center self-stretch">
          {/* Outside the roll on purpose. The marker is not part of the message
              — it is a gutter mark saying "what follows is a log line rather
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
              <LogLine key={`out-${roll.gen}`} rung={roll.outgoing} animation="script-log-roll-out" />
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
        {/* The measured poll interval, last on the bar and out of the header
            entirely. It answers one question — is the link keeping up — and it
            is a question almost nobody running a measurement asks, while it sat
            in a sticky header where its width came out of the channel grid for
            the whole session. Here it costs nothing anybody else was using: the
            log line beside it is `flex-1` and simply gets that much narrower.

            Right-hand end rather than beside the other chips, because it is a
            number that ticks. Sitting still at the edge, it can be checked when
            it is wanted and ignored when it is not; between REC and the log
            line it would be movement in the middle of the bar.

            No breakpoint gate at all, unlike the script-name chip beside it.
            That chip can go because the log line already names the script it
            came from; this is stated nowhere else in the app, and a phone on
            the WebUSB path — no room for a Script Runner window, no room for
            Connection Config either — is exactly the setup with nothing else
            that could answer "is the link keeping up". It costs about 52px,
            all of it out of a log line that was already truncating. */}
        <span className="shrink-0 tabular-nums text-slate-400 dark:text-slate-500">
          Polling: {pollIntervalMs > 0 ? `${pollIntervalMs} ms` : '-'}
        </span>
      </div>
    </>
  );
}
