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
  | 'launcher';

const RUNTIME_META = 'msl-runtime';

const readRuntime = (): AppRuntime => {
  if (typeof document === 'undefined') return 'web';
  const marker = document.querySelector(`meta[name="${RUNTIME_META}"]`)?.getAttribute('content');
  return marker === 'launcher' ? 'launcher' : 'web';
};

export const APP_RUNTIME: AppRuntime = readRuntime();

/** True when the desktop launcher is serving this page. */
export const isLauncherMode = APP_RUNTIME === 'launcher';
