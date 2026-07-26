import { useState } from 'react';
import { FloatingWindow } from './FloatingWindow';
import type { ViewerServerStatus } from '../hooks/useViewerFeed';

type RemoteViewerPanelProps = {
  open: boolean;
  onClose: () => void;
  /** Null until the launcher has answered — "unknown", not "off". */
  status: ViewerServerStatus | null;
  onEnabledChange: (enabled: boolean) => void;
};

export function RemoteViewerPanel({ open, onClose, status, onEnabledChange }: RemoteViewerPanelProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      window.setTimeout(() => setCopied(null), 1500);
    });
  };

  const running = status?.running ?? false;
  const urls = status?.urls ?? [];

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Remote Monitoring"
      subtitle="Desktop app only"
      defaultWidth={460}
      defaultHeight={520}
    >
      <div className="flex flex-col gap-4 p-3 text-sm text-slate-700 dark:text-slate-200">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="font-semibold">Share this screen on the LAN</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Lets other PCs watch the channels and charts live in a browser. They cannot connect,
                save, or change anything.
              </span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-emerald-500"
              checked={running}
              disabled={status === null}
              onChange={(e) => onEnabledChange(e.target.checked)}
            />
          </label>
          {status?.error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{status.error}</p>
          )}
          {running && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {status?.viewers === 0
                ? 'No one is watching yet.'
                : `${status?.viewers} viewer${status?.viewers === 1 ? '' : 's'} connected.`}
            </p>
          )}
        </div>

        {running && (
          <div>
            <h4 className="mb-1 font-semibold text-emerald-600 dark:text-emerald-400">
              Open this on the other PC
            </h4>
            {urls.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No reachable network address was found. This PC may only be on a network outside the
                allowed range (see below).
              </p>
            ) : (
              <ul className="space-y-1.5">
                {urls.map((url) => (
                  <li key={url} className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-slate-200 px-1 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                      {url}
                    </code>
                    <button
                      type="button"
                      className="button-secondary shrink-0 px-2 py-0.5 text-xs"
                      onClick={() => copy(url)}
                    >
                      {copied === url ? 'Copied!' : 'Copy'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              The <code className="font-mono">?k=</code> part of the link is what lets the viewer
              receive data. It changes every time the app restarts, so an old link stops working on
              its own.
            </p>
          </div>
        )}

        <div className="text-xs text-slate-500 dark:text-slate-400">
          <h4 className="mb-1 font-semibold text-slate-600 dark:text-slate-300">What viewers get</h4>
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Only PCs on a <span className="font-mono">192.168.*.*</span> address can reach the
              page at all; anything else is refused before a single file is served.
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
              Plain HTTP on the LAN, so treat it as "anyone on this network may look", not as a
              secured channel.
            </li>
          </ul>
        </div>
      </div>
    </FloatingWindow>
  );
}
