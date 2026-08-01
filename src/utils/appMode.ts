// How this page is being served — the single source of truth for "am I running
// inside the desktop launcher?".
//
// This used to be `location.hostname === '127.0.0.1'`, which was true only
// because the launcher bound the loopback interface and nothing else did. The
// server states the mode instead of the client guessing it: the launcher
// injects a <meta name="msl-runtime"> marker into the index.html it serves, and
// nothing else does. Static deployments (GitHub Pages, `vite dev`, `vite
// preview`) ship the repo's index.html unmodified and so have no marker.
export type AppRuntime =
  /** Plain web deployment: GitHub Pages, PWA install, `vite dev`. */
  | 'web'
  /** Served by the desktop launcher exe. */
  | 'launcher';

const RUNTIME_META = 'msl-runtime';

const readRuntime = (): AppRuntime => {
  if (typeof document === 'undefined') return 'web';
  const marker = document.querySelector(`meta[name="${RUNTIME_META}"]`)?.getAttribute('content');
  return marker === 'launcher' ? marker : 'web';
};

export const APP_RUNTIME: AppRuntime = readRuntime();

/** True when the desktop launcher is serving this page. */
export const isLauncherMode = APP_RUNTIME === 'launcher';

/**
 * True wherever the launcher is serving the page. This is the Service Worker /
 * caching question: the launcher's no-store headers make the SW unwanted.
 */
export const isLauncherServed = isLauncherMode;

/**
 * Whether this browser can run the app at all. Two transports are accepted,
 * matching what the app actually drives:
 *
 * - Desktop: Web Serial (`navigator.serial`) *and* the File System Access
 *   picker (`showSaveFilePicker`). Both are required together. Firefox 151+
 *   gained Web Serial but not the picker, so its users could connect and then
 *   not save — the app refuses to render rather than offer that half-working
 *   surface.
 * - Mobile: WebUSB (`navigator.usb`), which is what `web-serial-polyfill`
 *   drives on Android Chrome. That platform has neither Web Serial nor the
 *   picker, so the desktop test above rejects it; it is a supported target
 *   (see the polyfill wiring in App.tsx and webserialClient.ts) and gets its
 *   own branch. WebUSB is also absent from Firefox and Safari, so accepting
 *   it does not reopen the door to them.
 */
export const isSupportedBrowser = (): boolean => {
  if (typeof window === 'undefined') return true; // SSR guard, never happens here
  if ('serial' in navigator && typeof window.showSaveFilePicker === 'function') return true;
  return 'usb' in navigator;
};
