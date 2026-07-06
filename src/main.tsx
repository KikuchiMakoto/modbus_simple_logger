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
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        console.log('SW registered:', registration);

        // If a new SW is already waiting, activate it immediately
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        // Listen for new SW installations
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
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

  // Reload the page when a new SW takes over
  let refreshing = false;
  const startedAt = Date.now();
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    // Right after launch no measurement can be running yet, and a blocking
    // confirm() at that point can sit on a still-blank window (startup
    // updates often land before first paint). Reload silently instead.
    if (Date.now() - startedAt < 10_000) {
      window.location.reload();
      return;
    }
    // Prompt before reload to avoid interrupting active measurements
    const shouldReload = window.confirm(
      'A new version of the app is available. Reload now to update?\n\n' +
      'Warning: Reloading will stop any active measurement.'
    );
    if (shouldReload) {
      window.location.reload();
    } else {
      refreshing = false;
    }
  });
}
