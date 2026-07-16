import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
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
  const startedAt = Date.now();

  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        console.log('SW registered:', registration);

        // A new version left waiting by a previous session (update declined,
        // or the tab was closed): apply it now — we are at startup, so no
        // measurement can be interrupted.
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        // Listen for new SW installations. sw.js does NOT call skipWaiting()
        // during install, so a freshly downloaded version parks in `waiting`
        // while the current version keeps serving with its cache intact. The
        // version switch (activate = old cache deleted + clients claimed)
        // only happens once we post SKIP_WAITING below.
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state !== 'installed' || !navigator.serviceWorker.controller) return;
            // Right after launch no measurement can be running yet, and a
            // blocking confirm() can sit on a still-blank window, so apply
            // silently. Later, ask first: declining leaves the new version
            // waiting (this session keeps running the current version in
            // full, including all cached assets) and it is applied on the
            // next launch via the `registration.waiting` branch above.
            const shouldActivate =
              Date.now() - startedAt < 10_000 ||
              window.confirm(
                'A new version of the app is available. Update and reload now?\n\n' +
                'Warning: Reloading will stop any active measurement.'
              );
            if (shouldActivate) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
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
  // above (or happens silently at startup / on the very first install), so
  // by the time controllerchange fires the reload has already been approved
  // — never prompt here: the old cache is gone at this point, and declining
  // would leave the page running a half-broken version.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
