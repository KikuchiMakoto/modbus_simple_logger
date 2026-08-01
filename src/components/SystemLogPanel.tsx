// What the app reported: connection events, save and recording failures,
// storage trouble, and whatever a script printed — one stream, one clock.
//
// This was the Script Log, five lines tall, inside the Script Runner. Five lines
// is enough to notice an error and not enough to read one — a traceback scrolled
// past inside a box that small, in the window whose whole purpose is the editor
// above it. A window of its own can be opened next to the runner, made as tall
// as the failure needs, and left open across runs.
//
// It absorbed the old app status bar with the rename. A script that stopped
// printing because the serial link had dropped used to tell that story across
// two surfaces with two clocks; there is one place to look now, and the reader
// picks how much of it to see with the level control in the header.
//
// The rows themselves live in SystemLogBody, because chart slot 3 shows the same
// log on the launcher and the two must not be able to drift apart.
import { FloatingWindow } from './FloatingWindow';
import { SystemLogBody, SystemLogCopyButton, SystemLogLevelSelect } from './SystemLogBody';

export function SystemLogPanel({
  open,
  onClose,
  subtitle,
}: {
  open: boolean;
  onClose: () => void;
  /** What the runner is doing, so a tail left open still says which run it is of. */
  subtitle: string;
}) {
  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="System Log"
      subtitle={subtitle}
      // Emerald (FloatingWindow's default), not the blue the config/tester
      // panels use: this window is the other half of Script Runner — opened
      // beside it, showing that window's run among everything else — and a title
      // bar in a different colour read as a different kind of thing.
      defaultWidth={640}
      defaultHeight={380}
      headerActions={
        <>
          <SystemLogLevelSelect />
          <SystemLogCopyButton />
        </>
      }
    >
      {/* min-h-0 flex-1 is what makes the scroll box fill the window and stop
          there; the chart-slot copy gives it a fixed height instead. */}
      <SystemLogBody className="min-h-0 flex-1" />
    </FloatingWindow>
  );
}
