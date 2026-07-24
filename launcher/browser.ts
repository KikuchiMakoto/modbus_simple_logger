// Chromium-family browser discovery and launch for the desktop launcher.
//
// The launcher does not bundle a browser (unlike Electron); it drives an
// already-installed Edge or Chrome in `--app` mode. A dedicated
// `--user-data-dir` isolates the launcher from the user's normal browser
// profile — separate settings, and (relevant here) a separate on-disk browser
// cache that never mixes with the normal profile.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type BrowserInfo = { path: string; name: string };

const isWindows = process.platform === 'win32';

// Query an "App Paths" registry entry for a browser exe. Parsing is
// locale-independent: the default value line always contains the `REG_SZ`
// token followed by the path (the literal "(Default)"/"(既定)" label differs
// by Windows display language, so we never match on it).
const regQuery = (root: 'HKCU' | 'HKLM', exe: string): string | null => {
  const key = `${root}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`;
  const proc = Bun.spawnSync(['reg', 'query', key, '/ve'], { stdout: 'pipe', stderr: 'ignore' });
  if (proc.exitCode !== 0) return null;
  const out = new TextDecoder().decode(proc.stdout);
  const line = out.split(/\r?\n/).find((l) => l.includes('REG_SZ'));
  const path = line?.split('REG_SZ')[1]?.trim();
  return path && existsSync(path) ? path : null;
};

const firstExisting = (paths: string[]): string | null => {
  for (const p of paths) if (p && existsSync(p)) return p;
  return null;
};

// Windows: Edge first (App Paths registry → default install locations), then
// Chrome the same way.
const findWindows = (): BrowserInfo | null => {
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] ?? '';

  const edge =
    regQuery('HKCU', 'msedge.exe') ??
    regQuery('HKLM', 'msedge.exe') ??
    firstExisting([
      `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${local}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ]);
  if (edge) return { path: edge, name: 'Microsoft Edge' };

  const chrome =
    regQuery('HKCU', 'chrome.exe') ??
    regQuery('HKLM', 'chrome.exe') ??
    firstExisting([
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${local}\\Google\\Chrome\\Application\\chrome.exe`,
    ]);
  if (chrome) return { path: chrome, name: 'Google Chrome' };

  return null;
};

// Linux: microsoft-edge → google-chrome → chromium (spec order), each with the
// common stable/binary name variants, resolved against PATH.
const findLinux = (): BrowserInfo | null => {
  const candidates: [string, string][] = [
    ['microsoft-edge', 'Microsoft Edge'],
    ['microsoft-edge-stable', 'Microsoft Edge'],
    ['google-chrome', 'Google Chrome'],
    ['google-chrome-stable', 'Google Chrome'],
    ['chromium', 'Chromium'],
    ['chromium-browser', 'Chromium'],
  ];
  for (const [bin, name] of candidates) {
    const path = Bun.which(bin);
    if (path) return { path, name };
  }
  return null;
};

export const findBrowser = (): BrowserInfo | null => (isWindows ? findWindows() : findLinux());

// Dedicated per-app profile directory (created if missing). Kept under the OS
// per-user application data so it persists across launches yet stays out of the
// normal browser profile.
export const profileDir = (): string => {
  if (isWindows) {
    const base =
      process.env['LOCALAPPDATA'] ??
      join(process.env['USERPROFILE'] ?? '.', 'AppData', 'Local');
    return join(base, 'modbus_simple_logger', 'launcher-profile');
  }
  const base = process.env['XDG_DATA_HOME'] ?? join(process.env['HOME'] ?? '.', '.local', 'share');
  return join(base, 'modbus_simple_logger', 'launcher-profile');
};

// Launch the browser as a standalone app window. Because the dedicated profile
// is used by nothing else, the spawned process is that profile's main browser
// process and stays alive until the window is closed — so awaiting its exit is
// how the launcher knows to shut the server down.
export const launchBrowser = (browser: BrowserInfo, url: string) => {
  const dir = profileDir();
  mkdirSync(dir, { recursive: true });
  return Bun.spawn(
    [
      browser.path,
      `--app=${url}`,
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' },
  );
};
