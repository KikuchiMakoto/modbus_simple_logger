import { useEffect, useState } from 'react';
import { FloatingWindow } from './FloatingWindow';
import { probeRenderBackend, reportRenderBackend, useRenderBackend } from '../utils/renderBackend';
import { checkForAppUpdate, isUpdateCheckSupported, type UpdateCheckResult } from '../utils/swUpdate';
import type { NotificationsState } from '../hooks/useNotifications';

const LIBRARIES = [
  { name: 'React', version: '19.2', license: 'MIT' },
  { name: 'React DOM', version: '19.2', license: 'MIT' },
  { name: 'Plotly.js', version: '3.7', license: 'MIT' },
  { name: 'react-plotly.js', version: '4.0', license: 'MIT' },
  { name: 'react-rnd', version: '10.5', license: 'MIT' },
  { name: 'Tailwind CSS', version: '4.3', license: 'MIT' },
  { name: 'Vite', version: '8', license: 'MIT' },
  { name: 'TypeScript', version: '6.0', license: 'Apache-2.0' },
  { name: 'web-serial-polyfill', version: '1.0', license: 'BSD-3-Clause' },
  { name: 'Iosevka', version: '5.3', license: 'OFL-1.1' },
  // Version injected from the exact pin in package.json (see vite.config.ts).
  { name: 'Pyodide', version: import.meta.env.VITE_PYODIDE_VERSION ?? 'unknown', license: 'MPL-2.0' },
];

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'unknown';
const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'modbus_simple_logger';

// The update itself is always confirmed by the window.confirm() prompt that the
// check raises; these lines only report what the check found, since a button
// with no visible outcome reads as broken.
const UPDATE_STATUS: Record<UpdateCheckResult, string> = {
  unsupported: 'Updates are not managed in this build.',
  suspended: 'Disconnect the device to check for updates.',
  prompted: 'A new version is available.',
  downloading: 'Downloading a new version… you will be asked to reload when it is ready.',
  'up-to-date': 'You are running the latest version.',
  failed: 'Update check failed. Check your network connection.',
};

export function AppInfoPanel({
  open,
  onClose,
  connected = false,
  notifications,
}: {
  open: boolean;
  onClose: () => void;
  // Applying an update reloads the page, which would drop the port and stop the
  // measurement — so while a device is connected there is nothing to check for.
  connected?: boolean;
  // Notifications are one switch with no settings of their own, so they live
  // here rather than in a panel of their own (what is notified is documented in
  // the ScriptRunner API list, next to the calls that raise them).
  notifications: NotificationsState;
}) {
  const backend = useRenderBackend();
  const [checking, setChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);

  // Same code path as the startup check (utils/swUpdate.ts): a ready new
  // version raises the identical consent prompt, declining leaves it waiting.
  const handleCheckForUpdates = async () => {
    setChecking(true);
    setUpdateStatus(null);
    try {
      setUpdateStatus(UPDATE_STATUS[await checkForAppUpdate()]);
    } finally {
      setChecking(false);
    }
  };

  // Charts publish the backend once they render, but with no data yet there is
  // no chart to ask — probe the browser directly so the panel is never blank.
  useEffect(() => {
    if (open && !backend) reportRenderBackend(probeRenderBackend());
  }, [open, backend]);

  // Drop the last check's result on connect: it would otherwise reappear as
  // stale text once the device is disconnected again.
  useEffect(() => {
    if (connected) setUpdateStatus(null);
  }, [connected]);

  return (
    <FloatingWindow open={open} onClose={onClose} title="Application Info" defaultWidth={384} defaultHeight={560}>
      <div className="flex flex-col gap-4 p-2 text-sm text-slate-700 dark:text-slate-200">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
          <h3 className="mb-1 text-base font-bold text-emerald-600 dark:text-emerald-400">
            {APP_NAME}
          </h3>
          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Version</dt>
              <dd className="font-mono font-semibold">v{APP_VERSION}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Author</dt>
              <dd>
                <a
                  href="https://github.com/KikuchiMakoto"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  Makoto KUNO
                </a>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">License</dt>
              <dd>MIT</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Repository</dt>
              <dd>
                <a
                  href="https://github.com/KikuchiMakoto/modbus_simple_logger"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  GitHub
                </a>
              </dd>
            </div>
          </dl>

          {isUpdateCheckSupported() && (
            <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
              <button
                type="button"
                onClick={() => void handleCheckForUpdates()}
                disabled={checking || connected}
                title={connected ? 'Disconnect the device first — applying an update reloads the app' : undefined}
                className="w-full rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-emerald-950 shadow hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {checking ? 'Checking…' : 'Check for Updates'}
              </button>
              {(connected || updateStatus) && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {connected ? UPDATE_STATUS.suspended : updateStatus}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Interface scale used to be here. It moved to the Menu panel's header
            (components/UiScaleControl.tsx): it is a display setting you adjust
            while looking at the page, and this panel is the wrong place to have
            to open to do that. */}

        <div>
          <h4 className="mb-2 font-semibold text-slate-800 dark:text-slate-100">Notifications</h4>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span>
                <span className="font-semibold">Desktop notifications</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  ScriptRunner start / stop / completion and errors, plus set_notify() messages
                  from a running script.
                </span>
              </span>
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-emerald-500"
                checked={notifications.enabled}
                disabled={!notifications.supported || notifications.permission === 'denied'}
                onChange={(e) => notifications.setEnabled(e.target.checked)}
              />
            </label>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {!notifications.supported
                ? 'This page has no access to the Notification API (remote monitoring pages served over plain http do not).'
                : notifications.permission === 'denied'
                  ? 'Notifications are blocked for this site in the browser settings. Allow them there, then reload.'
                  : notifications.enabled
                    ? 'On. Repeated alerts replace each other instead of stacking, and everything notified is also written to the ScriptRunner Output log.'
                    : 'Off. Events are still written to the ScriptRunner Output log.'}
            </p>
          </div>
        </div>

        <div>
          <h4 className="mb-2 font-semibold text-slate-800 dark:text-slate-100">Chart Rendering</h4>
          <dl className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Backend</dt>
              <dd className="flex items-center gap-2">
                <span className="font-mono">{backend ? backend.api : 'detecting…'}</span>
                {backend?.accel && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[0.6rem] font-semibold leading-none ${
                      backend.accel === 'GPU'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    }`}
                  >
                    {backend.accel}
                  </span>
                )}
              </dd>
            </div>
            {backend && (
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-slate-500 dark:text-slate-400">Renderer</dt>
                <dd className="break-all text-right text-xs text-slate-600 dark:text-slate-300">
                  {backend.detail}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div>
          <h4 className="mb-2 font-semibold text-slate-800 dark:text-slate-100">Special Thanks</h4>
          <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800">
            <li className="flex items-center justify-between rounded px-2 py-1">
              <span className="font-medium">Ryota MANO</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Bug Reporter</span>
            </li>
            <li className="flex items-center justify-between rounded px-2 py-1">
              <span className="font-medium">Itsuki SATO</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Feature Proposal</span>
            </li>
            <li className="flex items-center justify-between rounded px-2 py-1">
              <span className="font-medium">Ying CUI</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Feature Proposal</span>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="mb-2 font-semibold text-slate-800 dark:text-slate-100">Libraries</h4>
          <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800">
            {LIBRARIES.map((lib) => (
              <li
                key={lib.name}
                className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-700/50"
              >
                <span className="font-medium">{lib.name}</span>
                <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono dark:bg-slate-700">
                    v{lib.version}
                  </span>
                  <span className="rounded border border-slate-300 px-1.5 py-0.5 dark:border-slate-600">
                    {lib.license}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </FloatingWindow>
  );
}
