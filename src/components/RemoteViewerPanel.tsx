import { FloatingWindow } from './FloatingWindow';
import { QrCode } from './QrCode';
import type { ViewerMode, ViewerServerStatus } from '../hooks/useViewerFeed';

type RemoteViewerPanelProps = {
  open: boolean;
  onClose: () => void;
  /** Null until the launcher has answered — "unknown", not "off". */
  status: ViewerServerStatus | null;
  onEnabledChange: (enabled: boolean, mode?: ViewerMode) => void;
  /** Whether the camera is being streamed to viewers. Reset whenever sharing stops. */
  videoEnabled: boolean;
  onVideoEnabledChange: (enabled: boolean) => void;
  /** False when no camera is bound, which is the only reason the toggle is dead. */
  cameraAvailable: boolean;
};

const MODES: { key: ViewerMode; label: string; blurb: string }[] = [
  {
    key: 'lan',
    label: 'Local Network',
    blurb: 'Direct. No internet. Anything that can route to this PC.',
  },
  {
    key: 'tunnel',
    label: 'SmartPhone Link',
    blurb: 'An HTTPS link. Opens on mobile data. Needs internet.',
  },
];

export function RemoteViewerPanel({
  open,
  onClose,
  status,
  onEnabledChange,
  videoEnabled,
  onVideoEnabledChange,
  cameraAvailable,
}: RemoteViewerPanelProps) {
  const running = status?.running ?? false;
  const starting = status?.starting ?? false;
  const urls = status?.urls ?? [];
  // Before the first status frame nothing is known, so no mode is preselected;
  // once running, the selection is whatever is actually live rather than a
  // separate piece of UI state that could drift from it.
  const activeMode = status?.mode ?? null;

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Remote Monitoring"
      subtitle="Desktop app only"
      defaultWidth={460}
      defaultHeight={640}
    >
      <div className="flex flex-col gap-4 p-3 text-sm text-slate-700 dark:text-slate-200">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
          <p className="font-semibold">Let others watch this screen</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            They see the channels and charts live. They cannot connect, save, or change anything.
          </p>

          <div className="mt-3 space-y-1.5">
            {MODES.map((mode) => {
              const active = running && activeMode === mode.key;
              return (
                <button
                  key={mode.key}
                  type="button"
                  disabled={status === null || starting}
                  onClick={() => onEnabledChange(!active, mode.key)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    active
                      ? 'border-emerald-400 bg-emerald-500 text-emerald-950'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{mode.label}</span>
                    <span className="text-xs font-semibold">
                      {active ? 'ON - tap to stop' : starting ? '' : 'OFF'}
                    </span>
                  </span>
                  <span
                    className={`mt-0.5 block text-xs ${active ? 'text-emerald-900' : 'text-slate-500 dark:text-slate-400'}`}
                  >
                    {mode.blurb}
                  </span>
                </button>
              );
            })}
          </div>

          {starting && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Setting up the link… this takes a few seconds.
            </p>
          )}
          {status?.error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{status.error}</p>}
          {running && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {status?.viewers === 0
                ? 'No one is watching yet.'
                : `${status?.viewers} viewer${status?.viewers === 1 ? '' : 's'} connected.`}
            </p>
          )}
        </div>

        {/* On by default: someone sharing a measurement with a camera bound
            wants the rig visible, and a second switch to find only ever
            produced a black box on the viewer. It stays a switch because the
            tunnel sends it out of the building. */}
        {running && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={videoEnabled}
                disabled={!cameraAvailable}
                onChange={(e) => onVideoEnabledChange(e.target.checked)}
                className="h-4 w-4"
              />
              <span>Send the camera too</span>
            </label>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {cameraAvailable
                ? 'Live picture and sound from the bound camera, with about a second of delay.'
                : 'Bind a camera in Recording Config first.'}
            </p>
            {/* Said plainly rather than hidden behind the toggle: the encoder is
                a second one, and it is skipped entirely while the count is 0. */}
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Encoding only runs while someone is watching, at a fixed 1 Mbps. The saved recording
              keeps its own quality regardless.
            </p>
          </div>
        )}

        {running && urls.length > 0 && (
          <div>
            <h4 className="mb-2 font-semibold text-emerald-600 dark:text-emerald-400">
              Scan to open
            </h4>
            {urls.length > 1 && (
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                One per network adapter on this PC. Use the one the viewer shares a network with —
                the others simply will not load for them.
              </p>
            )}
            <div className="space-y-4">
              {urls.map((url) => (
                <div key={url} className="flex flex-col items-center gap-2">
                  <QrCode value={url} size={200} />
                  <code className="w-full break-all rounded bg-slate-200 px-1.5 py-1 text-center font-mono text-[0.65rem] text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                    {url}
                  </code>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              The <code className="font-mono">?k=</code> part of the link is what unlocks it. It
              changes every time the app restarts, so an old link or an old QR code stops working on
              its own.
            </p>
          </div>
        )}

        {running && urls.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No network address was found. This PC does not appear to be on any network right now.
          </p>
        )}

        <div className="text-xs text-slate-500 dark:text-slate-400">
          <h4 className="mb-1 font-semibold text-slate-600 dark:text-slate-300">What viewers get</h4>
          <ul className="list-disc space-y-1 pl-4">
            <li>No link, no page. Not even the login — the first request must carry the token.</li>
            <li>
              One-way feed. No serial port, no channel back. The hardware is out of reach by
              construction, not by hidden buttons.
            </li>
            <li>Recent samples only. The full record is the TSV file on this PC.</li>
            <li>The link is the key. Hand it out like one.</li>
          </ul>
        </div>

        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <h4 className="mb-1 font-semibold">Before you turn this on</h4>
          <ul className="list-disc space-y-1 pl-4">
            <li>
              <span className="font-semibold">Do not use SmartPhone Link where outbound tunnels
              are not permitted.</span>{' '}
              It is a Cloudflare Quick Tunnel — an outbound hole punched through your NAT and
              firewall. On a university or corporate network that is a policy question, and the
              answer is often no. Ask first.
            </li>
            <li>
              <span className="font-semibold">Local Network is plain HTTP and is not always local.</span>{' '}
              On a campus network with global addresses, "this PC's network" can mean the internet.
            </li>
            <li>
              <span className="font-semibold">Traffic hits the measurement.</span> Every request is
              served by this process. A flood of them — deliberate or a stray scanner — competes
              with the acquisition loop and can disturb the timing of the run.
            </li>
            <li>
              <span className="font-semibold">No uptime guarantee on SmartPhone Link.</span> Quick
              Tunnels are free and unaccounted. For a measurement someone is relying on, prefer
              Local Network.
            </li>
          </ul>
        </div>
      </div>
    </FloatingWindow>
  );
}
