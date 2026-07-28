import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Iosevka woff2 (Latin subset) is registered as @font-face in index.css using
// Vite `?url` imports, which fingerprints and bundles the font files. woff is
// skipped because every target browser (Web Serial / SharedArrayBuffer /
// File System Access API) already supports woff2, and Iosevka is ~1MB per
// weight in either format — the woff fallback would double the precache. The
// app uses font-medium / semibold / bold (Tailwind 500/600/700) plus the
// default 400, so only those four weights are imported.
import './index.css';
import { setupServiceWorker } from './utils/swUpdate';
import { initUiScale } from './utils/uiScale';
import { isSupportedBrowser } from './utils/appMode';

// Before the first render, not from inside a component: restoring the stored UI
// scale after mount would paint one frame at 100% and reflow the entire page.
initUiScale();

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

class UnsupportedBrowserBanner extends React.Component {
  render() {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <h1 className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
          Unsupported browser
        </h1>
        <p className="max-w-md text-center text-sm text-slate-600 dark:text-slate-400">
          ModbusSimpleLogger needs the Web Serial and File System Access APIs,
          which only the Chromium engine ships. Please open this page in the
          latest Google Chrome or Microsoft Edge (desktop, or Android Chrome
          for mobile).
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href="https://www.google.com/chrome/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-emerald-950 shadow hover:bg-emerald-400"
          >
            Download Google Chrome
          </a>
          <a
            href="https://www.microsoft.com/edge"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-50"
          >
            Download Microsoft Edge
          </a>
        </div>
        <p className="max-w-md text-center text-xs text-slate-500 dark:text-slate-400">
          Safari and Firefox are not supported.
        </p>
      </div>
    );
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        {isSupportedBrowser() ? <App /> : <UnsupportedBrowserBanner />}
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

// Service Worker registration + the consent-gated update flow (and, in launcher
// mode, the unregistration of any leftover SW) live in utils/swUpdate.ts, which
// App Info's "Check for Updates" button reuses for its check.
setupServiceWorker();
