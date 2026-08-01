// The System Log, in chart slot 3 on the launcher and on a viewer.
//
// Why here rather than only in its window: on the desktop build a script is
// usually what is driving the run, and its output — together with whatever the
// link and the save path had to say — is the other half of what the charts are
// showing. Four plots and a log the user has to remember to open is four views
// of the numbers and none of the reason they are moving.
//
// On the host it is the same log as the window's, not a copy — both render
// SystemLogBody over the same entries — so opening the window shows the same
// lines. On a viewer the entries arrive over the feed; a viewer runs no script
// and owns no serial port, so without that they would be permanently empty.
import { PLOT_HEIGHT } from './ChartPanel';
import { SystemLogBody, SystemLogCopyButton, SystemLogLevelSelect } from './SystemLogBody';
import type { SystemLogEntry } from '../utils/systemLog';

export function SystemLogCard({
  remoteEntries,
  subtitle,
  running,
}: {
  /** A viewer's copy of the host's log. Omitted on the host, which has its own. */
  remoteEntries?: SystemLogEntry[];
  subtitle: string;
  running: boolean;
}) {
  return (
    // Same card and same header row as ChartPanel: this sits in the grid with
    // plots and should not read as a different kind of object.
    <section className="card card-tight space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[0.7rem] font-semibold leading-none text-slate-600 dark:text-slate-300">
          System Log
        </span>
        <span className="truncate text-[0.7rem] leading-none text-slate-400 dark:text-slate-500">
          {subtitle}
        </span>
        {/* A running script is the one state worth a colour here: it is what
            explains a chart moving on its own. */}
        {running && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {/* The same threshold the window uses — it is one setting for the app,
              so changing it here changes what the window shows too. */}
          <SystemLogLevelSelect className="py-0 text-[0.7rem]" />
          <SystemLogCopyButton remoteEntries={remoteEntries} />
        </span>
      </div>
      {/* Fixed height rather than flex-1: in the window the box grows to fill
          the frame, but here it has to match the plots beside it exactly. */}
      <SystemLogBody remoteEntries={remoteEntries} style={{ height: PLOT_HEIGHT }} />
    </section>
  );
}
