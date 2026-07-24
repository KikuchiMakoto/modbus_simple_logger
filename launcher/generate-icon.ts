// Build-time, best-effort generation of a Windows .ico from public/icon.svg.
//
// Rasterizing an SVG normally needs a native image library; to avoid any such
// dependency we reuse the very browser the launcher already requires: render
// the SVG to a 256x256 PNG via Chromium headless `--screenshot`, then wrap that
// PNG in a minimal ICO container (Windows Vista+ accepts a PNG-encoded icon
// image directly). If any step fails, we skip silently — the exe still builds,
// just without a custom icon.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findBrowser } from './browser';

const ROOT = resolve(import.meta.dir, '..');
const SVG = resolve(ROOT, 'public/icon.svg');
const OUT = resolve(import.meta.dir, 'icon.ico');

// Wrap a single 256x256 PNG in an ICO container. Width/height bytes are 0,
// which the ICO format defines as 256.
const buildIco = (png: Uint8Array): Uint8Array => {
  const head = new Uint8Array(22);
  const view = new DataView(head.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, 1, true); // image count
  head[6] = 0; // width  (0 => 256)
  head[7] = 0; // height (0 => 256)
  head[8] = 0; // palette colors
  head[9] = 0; // reserved
  view.setUint16(10, 1, true); // color planes
  view.setUint16(12, 32, true); // bits per pixel
  view.setUint32(14, png.length, true); // image byte size
  view.setUint32(18, 22, true); // image byte offset (6 + 16)
  const out = new Uint8Array(22 + png.length);
  out.set(head, 0);
  out.set(png, 22);
  return out;
};

const skip = (reason: string) => {
  console.warn(`[generate-icon] Skipping icon generation: ${reason}`);
  process.exit(0);
};

if (!existsSync(SVG)) skip('public/icon.svg not found');

const browser = findBrowser();
if (!browser) skip('no Chromium browser found to rasterize the SVG');

const work = join(tmpdir(), `msl-icon-${process.pid}`);
mkdirSync(work, { recursive: true });
const png = join(work, 'icon.png');
const svgUrl = `file:///${SVG.replace(/\\/g, '/')}`;

const proc = Bun.spawnSync(
  [
    browser.path,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    '--window-size=256,256',
    `--user-data-dir=${join(work, 'profile')}`,
    `--screenshot=${png}`,
    svgUrl,
  ],
  { stdout: 'ignore', stderr: 'ignore' },
);

try {
  if (!existsSync(png)) skip(`headless screenshot produced no output (exit ${proc.exitCode})`);
  const pngBytes = readFileSync(png);
  writeFileSync(OUT, buildIco(pngBytes));
  console.log(`[generate-icon] Wrote ${OUT} (${pngBytes.length} byte PNG)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
