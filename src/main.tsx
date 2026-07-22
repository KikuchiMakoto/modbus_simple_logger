import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Self-hosted variable font: bundled by Vite (hashed woff2 under dist/, so the
// precache-manifest plugin caches it for full offline use) and rendered
// identically across Windows/Linux/ChromeOS/Android instead of each OS's own
// monospace. Only the Latin subset is fetched at runtime; CJK falls through to
// the system stack in index.css.
import '@fontsource-variable/jetbrains-mono';
import './index.css';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
          <h1 className="text-2xl font-bold text-red-600 dark:text-red-400">Something went wrong</h1>
          <p className="max-w-md text-center text-sm text-slate-600 dark:text-slate-400">
            The application encountered an unexpected error. Please reload the page to continue.
          </p>
          {this.state.error && (
            <pre className="max-w-md overflow-auto rounded bg-slate-100 p-3 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {this.state.error.message}
            </pre>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-emerald-950 shadow hover:bg-emerald-400"
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

// Service Worker registration (PWA)
if ('serviceWorker' in navigator) {
  const currentVersion: string | undefined = import.meta.env.VITE_APP_VERSION;

  // Ask a (waiting) Service Worker which app version it was built from.
  // sw.js answers GET_VERSION on the transferred MessageChannel port; SWs
  // built before that handler existed never reply, so time out and fall
  // back to a version-less prompt rather than hanging.
  const queryWorkerVersion = (worker: ServiceWorker): Promise<string | null> =>
    new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 500);
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timer);
        resolve(typeof event.data?.appVersion === 'string' ? event.data.appVersion : null);
      };
      worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    });

  // Every version switch requires explicit user consent — including updates
  // detected right at startup. sw.js deliberately does NOT call
  // skipWaiting() during install, so a new version parks in `waiting` while
  // the current version keeps serving with its cache intact; activation
  // (old cache deleted + clients claimed) only happens once we post
  // SKIP_WAITING here. Declining leaves the worker waiting: this session
  // keeps running the current version in full, and the prompt reappears on
  // the next launch via the `registration.waiting` branch below.
  const promptAndActivate = async (worker: ServiceWorker) => {
    const newVersion = await queryWorkerVersion(worker);
    const versionInfo =
      newVersion && currentVersion ? ` (v${currentVersion} → v${newVersion})` : '';
    const shouldActivate = window.confirm(
      `A new version of the app is available${versionInfo}. Update and reload now?\n\n` +
      'Warning: Reloading will stop any active measurement.'
    );
    if (shouldActivate) {
      worker.postMessage({ type: 'SKIP_WAITING' });
    }
  };

  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        console.log('SW registered:', registration);

        // Prompt once per worker: the `waiting` branch below and the
        // `updatefound` statechange can both fire for the same worker.
        let promptedWorker: ServiceWorker | null = null;
        const promptOnce = (worker: ServiceWorker) => {
          if (promptedWorker === worker) return;
          promptedWorker = worker;
          void promptAndActivate(worker);
        };

        // A new version left waiting by a previous session (update
        // declined): ask again now. Only relevant when this page is
        // SW-controlled — with no controller the waiting worker activates
        // on its own (first-install path, nothing to lose).
        if (registration.waiting && navigator.serviceWorker.controller) {
          promptOnce(registration.waiting);
        }

        // Listen for new SW installations (found by the update checks
        // below). The version switch only happens via promptOnce above.
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state !== 'installed' || !navigator.serviceWorker.controller) return;
            promptOnce(newWorker);
          });
        });

        // Check for updates immediately on load
        registration.update();

        // Periodically check for SW updates (every 60 seconds)
        const updateInterval = window.setInterval(() => {
          registration.update().catch((err) => {
            console.warn('SW update check failed:', err);
          });
        }, 60_000);

        // Cleanup interval on pagehide
        window.addEventListener('pagehide', () => {
          window.clearInterval(updateInterval);
        }, { once: true });
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  });

  // Reload the page when a new SW takes over. Activation is consent-gated
  // above (or happens on the very first install, where nothing can be
  // interrupted), so by the time controllerchange fires the reload has
  // already been approved — never prompt here: the old cache is gone at
  // this point, and declining would leave the page running a half-broken
  // version.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
