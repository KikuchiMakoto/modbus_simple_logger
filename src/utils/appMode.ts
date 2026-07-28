// How this page is being served — the single source of truth for "am I running
// inside the desktop launcher?".
//
// This used to be `location.hostname === '127.0.0.1'`, which was true only
// because the launcher bound the loopback interface and nothing else did. That
// invariant does not survive remote monitoring: a second PC reaches the same
// launcher over a LAN address or a tunnel hostname, and a hostname test would
// classify that page as a plain web deployment — registering the Service Worker
// and reintroducing exactly the cache layer the launcher's no-store headers
// exist to eliminate (see launcher/server.ts).
//
// So the server states the mode instead of the client guessing it: the launcher
// injects a <meta name="msl-runtime"> marker into the index.html it serves, and
// nothing else does. Static deployments (GitHub Pages, `vite dev`, `vite
// preview`) ship the repo's index.html unmodified and so have no marker.
export type AppRuntime =
  /** Plain web deployment: GitHub Pages, PWA install, `vite dev`. */
  | 'web'
  /** Served by the desktop launcher exe, with the hardware attached to this page. */
  | 'launcher'
  /** Served by the launcher's viewer server to another PC: read-only monitoring. */
  | 'viewer';

const RUNTIME_META = 'msl-runtime';

const readRuntime = (): AppRuntime => {
  if (typeof document === 'undefined') return 'web';
  const marker = document.querySelector(`meta[name="${RUNTIME_META}"]`)?.getAttribute('content');
  return marker === 'launcher' || marker === 'viewer' ? marker : 'web';
};

export const APP_RUNTIME: AppRuntime = readRuntime();

/**
 * True when the desktop launcher is serving this page and the hardware is
 * attached to it — i.e. the host window, not a remote viewer. Everything that
 * talks to the launcher as a peer (the monitoring uplink) keys
 * on this.
 */
export const isLauncherMode = APP_RUNTIME === 'launcher';

/**
 * True on a read-only remote monitor. Such a page has no serial port, no bridge
 * and no way to send anything to the host (the viewer socket is push-only, see
 * launcher/viewerHub.ts) — this flag exists so the UI can stop *offering*
 * actions that could not work, not to enforce the restriction.
 */
export const isViewerMode = APP_RUNTIME === 'viewer';

/**
 * True wherever the launcher is serving the page, host or viewer. This is the
 * Service Worker / caching question: the launcher's no-store headers make the
 * SW unwanted on both.
 */
export const isLauncherServed = isLauncherMode || isViewerMode;

/**
 * The `?k=` token from the viewer URL, replayed on the viewer WebSocket. Null
 * outside viewer mode, and never persisted: a viewer that loses the token
 * simply needs the link again.
 */
export const viewerToken = (): string | null => {
  if (!isViewerMode || typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('k');
};

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
 *
 * Viewer pages are exempt: they only consume a push-only WebSocket feed and
 * never touch any of these APIs.
 */
export const isSupportedBrowser = (): boolean => {
  if (isViewerMode) return true;
  if (typeof window === 'undefined') return true; // SSR guard, never happens here
  if ('serial' in navigator && typeof window.showSaveFilePicker === 'function') return true;
  return 'usb' in navigator;
};
