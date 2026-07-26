// Desktop launcher entry point.
//
// Serves the embedded (built) web app from 127.0.0.1 and opens it in an
// installed Edge/Chrome `--app` window. Everything is served out of the exe;
// there is no network dependency and no caching layer (see server.ts headers),
// so an exe rebuilt with new dist/ content always shows the new content on the
// next launch.
import { createServer, loadAssets, BASE_PATH } from './server';
import { findBrowser, launchBrowser, type BrowserInfo } from './browser';
import { startMcpServer, MCP_PORT, MCP_PATH, type McpHandle } from './mcp';
import { bridge } from './bridge';
import { hostFeed, OFF_STATUS } from './hostFeed';
import { startViewerServer, lanViewerUrls, viewerUrl, type ViewerServerHandle } from './viewerServer';
import { startTunnel, type TunnelHandle } from './tunnel';
import { viewerHub } from './viewerHub';
import { acquireInstanceLock, type InstanceLock } from './singleInstance';
import { setKeepAwake } from './keepAwake';

const isWindows = process.platform === 'win32';

// Tell the user something. On Windows the console is hidden
// (--windows-hide-console), so route through a GUI message box; elsewhere
// stderr is fine (the process is normally started from a terminal).
const notice = (message: string): void => {
  if (isWindows) {
    Bun.spawnSync(
      [
        'powershell',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -AssemblyName PresentationFramework;' +
          `[System.Windows.MessageBox]::Show(${JSON.stringify(message)}, 'Modbus Simple Logger') | Out-Null`,
      ],
      // Same reason as the tunnel: a GUI-subsystem parent spawning a console
      // program gets a console window for free. Here it would flash up behind
      // the dialog.
      { windowsHide: true },
    );
  } else {
    console.error(message);
  }
};

/** Show a fatal error and give up. */
const fatal = (message: string): never => {
  notice(message);
  process.exit(1);
};

// Single instance. A second copy would open a second window onto the same one
// serial port, lose the race for the MCP endpoint and fight over the browser
// profile — and it is nearly always an accidental double-click of the exe or of
// a taskbar icon. Claimed before anything else is started so the loser exits
// without having bound a port or spawned a browser.
const lock = await acquireInstanceLock();
if (!lock.held) {
  notice(
    'Modbus Simple Logger is already running.\n\n' +
      'Switch to the window that is already open. If you cannot find it, close it from ' +
      'Task Manager and start again.',
  );
  // Not a failure: the app the user wanted is running, it just is not this
  // process.
  process.exit(0);
}
const instanceLock: InstanceLock | null = lock.lock;

const assets = await loadAssets().catch((err: Error) =>
  fatal(`${err.message}\nRun \`bun run launcher:build\` again.`),
);

const server = await createServer(assets).catch((err: Error) =>
  fatal(`${err.message}\nRun \`bun run launcher:build\` again.`),
);

// Read-only remote monitoring, off until the host page asks for it. The switch
// is in the page because the packaged exe has no console to put it in, and the
// `__feed` socket carrying the request is loopback-only — so "the page" is
// always the local window, never a viewer.
let viewer: ViewerServerHandle | null = null;
let tunnel: TunnelHandle | null = null;

const stopSharing = () => {
  tunnel?.stop();
  tunnel = null;
  viewer?.stop();
  viewer = null;
};

// cloudflared died on its own (network dropped, Cloudflare closed the quick
// tunnel, the process was killed from Task Manager). The published URL and the
// QR code are dead at that point, so tear the rest down and tell the page —
// leaving a panel that still shows a working-looking link is worse than saying
// it stopped.
const onTunnelLost = () => {
  stopSharing();
  hostFeed.pushStatus({
    ...OFF_STATUS,
    error: 'The internet link stopped unexpectedly. Turn it back on to get a new one.',
  });
};

hostFeed.setControlHandler(async (action) => {
  // Always start from a clean stop, including on enable: the two modes bind
  // differently, so switching between them has to tear the old server down
  // rather than reuse it.
  stopSharing();
  if (action.type === 'disable') return OFF_STATUS;

  viewer = startViewerServer(assets, action.mode);
  try {
    const urls =
      action.mode === 'tunnel'
        ? [viewerUrl((tunnel = await startTunnel(viewer.port, onTunnelLost)).url)]
        : lanViewerUrls(viewer.port);
    return {
      ...OFF_STATUS,
      running: true,
      mode: action.mode,
      urls,
      viewers: viewerHub.viewerCount,
    };
  } catch (err) {
    // A tunnel that never came up leaves a loopback-only server listening for
    // nobody; don't leave that behind just because the URL failed.
    stopSharing();
    throw err;
  }
});

const appUrl = `http://127.0.0.1:${server.port}${BASE_PATH}`;

// MCP endpoint for generative-AI clients. Unlike the app server this uses a
// fixed port so clients can be configured once; if another instance already
// owns it we simply run without MCP (first instance wins) instead of failing to
// start or stealing the endpoint from the instance the AI is already talking to.
const mcp: McpHandle | null = await startMcpServer();
// The console is hidden in the packaged exe, so the page is the only place this
// can be surfaced: tell it over the bridge and let the UI show the state.
bridge.setEndpointInfo(
  mcp ? { enabled: true, url: `http://127.0.0.1:${mcp.port}${MCP_PATH}` } : { enabled: false, url: null },
);
if (!mcp) {
  console.error(
    `MCP disabled: 127.0.0.1:${MCP_PORT} is already in use (another instance owns ${MCP_PATH}).`,
  );
}

const browser: BrowserInfo | null = findBrowser();
if (!browser) {
  mcp?.stop();
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
    mcp?.stop();
  } catch {
    // already stopped
  }
  try {
    stopSharing();
  } catch {
    // already stopped
  }
  try {
    server.stop(true);
  } catch {
    // already stopped
  }
  // The execution state dies with the process anyway; clearing it explicitly
  // keeps the "who is keeping this PC awake" answer honest during the moments
  // between the window closing and the process exiting.
  try {
    setKeepAwake(false);
  } catch {
    // never armed
  }
  try {
    instanceLock?.release();
  } catch {
    // already released
  }
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

await child.exited;
shutdown(0);
