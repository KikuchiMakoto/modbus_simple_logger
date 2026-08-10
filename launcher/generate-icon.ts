// Build-time, best-effort generation of a Windows .ico from public/icon.png.
//
// The source is a 512x512 PNG and the ICO wants 256x256, so it still has to be
// resampled. Rather than take on a native image library we reuse the very
// browser the launcher already requires: draw the PNG into a 256x256 frame and
// capture it via Chromium headless `--screenshot`, then wrap the result in a
// minimal ICO container (Windows Vista+ accepts a PNG-encoded icon image
// directly). If any step fails, we skip silently — the exe still builds, just
// without a custom icon.
//
// The image goes into a zero-margin HTML wrapper before screenshotting.
// Screenshotting the file directly lets the browser apply its default 8px body
// margin, which shifts the artwork and clips one edge.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findBrowser } from './browser';

const ROOT = resolve(import.meta.dir, '..');
const SOURCE = resolve(ROOT, 'public/icon.png');
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

// Annotated on the CONST, not just as the arrow's return type: TypeScript only
// treats a call as terminating (and narrows what follows it) when the callee is
// a const with an explicit function-type annotation. Without this every `if
// (!x) skip(...)` below leaves x possibly-null for the rest of the file.
const skip: (reason: string) => never = (reason) => {
  console.warn(`[generate-icon] Skipping icon generation: ${reason}`);
  process.exit(0);
};

if (!existsSync(SOURCE)) skip('public/icon.png not found');

const browser = findBrowser();
if (!browser) skip('no Chromium browser found to rasterize the SVG');

const work = join(tmpdir(), `msl-icon-${process.pid}`);
mkdirSync(work, { recursive: true });
const png = join(work, 'icon.png');

// Embed the PNG as a data: URI in a zero-margin page sized to exactly 256x256
// so the artwork fills the frame with no offset or clipping. Inline rather than
// a file:// <img src>, so the page has no subresource to load and the
// screenshot can never race an unresolved request.
const dataUri = `data:image/png;base64,${readFileSync(SOURCE).toString('base64')}`;
const html =
  '<!doctype html><meta charset="utf-8">' +
  '<style>html,body{margin:0;padding:0;background:transparent}' +
  '#w{width:256px;height:256px}#w img{display:block;width:256px;height:256px}</style>' +
  `<div id="w"><img src="${dataUri}"></div>`;
const htmlPath = join(work, 'icon.html');
writeFileSync(htmlPath, html);
const htmlUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;

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
    htmlUrl,
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
