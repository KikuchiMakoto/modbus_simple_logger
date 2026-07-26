import { FloatingWindow } from './FloatingWindow';
import { QrCode } from './QrCode';
import type { ViewerMode, ViewerServerStatus } from '../hooks/useViewerFeed';

type RemoteViewerPanelProps = {
  open: boolean;
  onClose: () => void;
  /** Null until the launcher has answered — "unknown", not "off". */
  status: ViewerServerStatus | null;
  onEnabledChange: (enabled: boolean, mode?: ViewerMode) => void;
};

const MODES: { key: ViewerMode; label: string; blurb: string }[] = [
  {
    key: 'lan',
    label: 'This network',
    blurb: 'Direct, no internet needed. Only PCs on a 192.168.*.* address can reach it.',
  },
  {
    key: 'tunnel',
    label: 'Internet link',
    blurb: 'An HTTPS link anyone can open, including a phone on mobile data. Needs internet.',
  },
];

export function RemoteViewerPanel({ open, onClose, status, onEnabledChange }: RemoteViewerPanelProps) {
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

        {running && urls.length > 0 && (
          <div>
            <h4 className="mb-2 font-semibold text-emerald-600 dark:text-emerald-400">
              Scan to open
            </h4>
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
            No reachable network address was found. This PC may only be on a network outside the
            allowed range.
          </p>
        )}

        <div className="text-xs text-slate-500 dark:text-slate-400">
          <h4 className="mb-1 font-semibold text-slate-600 dark:text-slate-300">What viewers get</h4>
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Nothing at all without the link — not even the page. The first request has to carry
              the token; after that a cookie stands in for it.
            </li>
            <li>
              The feed is one-way. A viewer has no serial port and no channel back to this window,
              so it cannot drive the hardware — that is a property of the connection, not of the
              buttons its page happens to show.
            </li>
            <li>
              Viewers see the most recent samples on the chart, not the whole capture. The complete
              record is the TSV file this PC is writing.
            </li>
            <li>
              <span className="font-semibold">This network</span> is plain HTTP and reaches no
              further than the LAN. <span className="font-semibold">Internet link</span> is HTTPS
              but the address lives on the public internet, so treat the link itself as the secret.
            </li>
            <li>
              The internet link is a Cloudflare Quick Tunnel: free, no account, and with no uptime
              guarantee. For a measurement someone is relying on, prefer this network.
            </li>
          </ul>
        </div>
      </div>
    </FloatingWindow>
  );
}
