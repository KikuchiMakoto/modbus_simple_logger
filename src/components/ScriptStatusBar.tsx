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
        <div className={`ml-2 min-w-0 flex-1 truncate font-mono md:ml-3 ${lineColor}`}>
          {line ? (
            <>
              <span className="mr-1 text-slate-400 dark:text-slate-500">›</span>
              {text}
            </>
          ) : (
            text
          )}
        </div>
      </div>
    </>
  );
}