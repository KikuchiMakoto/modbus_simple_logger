// Desktop launcher entry point.
//
// Serves the embedded (built) web app from 127.0.0.1 and opens it in an
// installed Edge/Chrome `--app` window. Everything is served out of the exe;
// there is no network dependency and no caching layer (see server.ts headers),
// so an exe rebuilt with new dist/ content always shows the new content on the
// next launch.
import { createServer, BASE_PATH } from './server';
import { findBrowser, launchBrowser, type BrowserInfo } from './browser';

const isWindows = process.platform === 'win32';

// Show a fatal error to the user. On Windows the console is hidden
// (--windows-hide-console), so route through a GUI message box; elsewhere
// stderr is fine (the process is normally started from a terminal).
const fatal = (message: string): never => {
  if (isWindows) {
    Bun.spawnSync([
      'powershell',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -AssemblyName PresentationFramework;' +
        `[System.Windows.MessageBox]::Show(${JSON.stringify(message)}, 'Modbus Simple Logger') | Out-Null`,
    ]);
  } else {
    console.error(message);
  }
  process.exit(1);
};

const server = await createServer().catch((err: Error) =>
  fatal(`${err.message}\nRun \`bun run launcher:build\` again.`),
);

const appUrl = `http://127.0.0.1:${server.port}${BASE_PATH}`;

const browser: BrowserInfo | null = findBrowser();
if (!browser) {
  server.stop(true);
  fatal(
    'No compatible browser found.\n\n' +
      'Microsoft Edge or Google Chrome must be installed to run the desktop version.\n' +
      'Please install one and try again.',
  );
}

const child = launchBrowser(browser, appUrl);

// Tear down cleanly on the browser closing or on a termination signal, leaving
// no server or browser process behind.
let shuttingDown = false;
const shutdown = (code: number) => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    child.kill();
  } catch {
    // already gone
  }
  try {
    server.stop(true);
  } catch {
    // already stopped
  }
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

await child.exited;
shutdown(0);
