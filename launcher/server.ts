// Static file server for the launcher: serves the embedded (built) web app with
// cross-origin isolation and a hard no-cache policy.
//
// Two servers are built from the same assets:
//   - the app server, on 127.0.0.1, where the hardware-owning host page runs;
//   - the viewer server (viewerServer.ts), optional and bound to every
//     interface, where read-only remote monitors connect.
// They differ only in the runtime marker stamped into index.html and in which
// WebSocket endpoints they expose, so the static handling below is shared.
import { ASSETS, BASE_PATH } from './embedded.generated';
import { HOST_FEED_PATH_SUFFIX } from './viewerHub';
import { hostFeed } from './hostFeed';

export { BASE_PATH };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const contentType = (path: string): string => {
  const dot = path.lastIndexOf('.');
  return (dot >= 0 && MIME[path.slice(dot).toLowerCase()]) || 'application/octet-stream';
};

// Cross-origin isolation (required for the Pyodide worker's SharedArrayBuffer)
// plus a hard no-cache policy on EVERY response: no Cache-Control caching, and
// no ETag/Last-Modified (we build responses from owned buffers, so no framework
// adds them), so browsers never issue conditional requests and never get a 304.
// Combined with skipping the Service Worker (see main.tsx) this removes every
// cache layer, so a rebuilt exe can never serve stale assets.
const baseHeaders = (type: string): Record<string, string> => ({
  'Content-Type': type,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cache-Control': 'no-store',
  // The UI is English. Chromium guesses a page's language from the content when
  // nothing states it, and on a Japanese-locale machine it lands on Japanese
  // often enough to raise a translate prompt over an English page. <html
  // lang="en"> already says so, but the header is the stronger signal and is
  // what a served page (as opposed to a file:// one) is expected to carry.
  ...(type.startsWith('text/html') ? { 'Content-Language': 'en' } : {}),
});

export const INDEX = `${BASE_PATH}index.html`;
// WebSocket endpoint the host page pushes remote-monitoring frames up. Only
// exposed on the loopback app server: it is the *source* of the viewer feed and
// carries the control frames that switch remote monitoring on and off, so it
// must never be reachable from another machine.
export const HOST_FEED_PATH = `${BASE_PATH}${HOST_FEED_PATH_SUFFIX}`;

/** Which of the two pages an index.html copy identifies itself as. */
export type ServedRuntime = 'launcher' | 'viewer';

// The page tells launcher mode apart from a plain web deployment by this marker
// and nothing else (see src/utils/appMode.ts). It has to be stamped by whoever
// serves the page, because the client-side signal it replaced — hostname ===
// '127.0.0.1' — stops being true the moment a second PC opens the same app over
// the network.
//
// The same marker carries the role: a page served by the viewer server is told
// it is a viewer, so the role is decided by which port the request arrived on
// and cannot be changed by editing the URL.
const runtimeMarker = (runtime: ServedRuntime) => `<meta name="msl-runtime" content="${runtime}">`;

// A class stamped onto <html> in addition to the meta. The meta is read by
// JS (utils/appMode.ts); the class is read by CSS, which cannot select on a
// meta tag's content. index.css targets this to apply desktop-only rules —
// currently the body min-width that keeps the exe window's content from
// collapsing past a readable threshold when the user drags it narrow.
const runtimeHtmlClass = (runtime: ServedRuntime) => ` class="msl-${runtime}"`;

// Stamp the marker into the <head> of a served index.html. dist/ on disk stays
// untouched: only the in-memory copies carry it, so `bun run build` output is
// still byte-for-byte what GitHub Pages gets.
const stampRuntimeMarker = (html: Uint8Array, runtime: ServedRuntime): Uint8Array => {
  const text = new TextDecoder().decode(html);
  const head = text.indexOf('<head>');
  if (head < 0) throw new Error('Launcher build is incomplete: index.html has no <head>.');
  // Also stamp a class onto <html>. The static index.html ships <html lang="en">
  // with no class attribute, so we splice it into the opening tag. Done before
  // locating <head> because the splice shifts every later index.
  let stamped = text;
  const htmlOpen = stamped.match(/<html\b[^>]*>/);
  if (htmlOpen && !/class=/.test(htmlOpen[0])) {
    const idx = htmlOpen.index! + htmlOpen[0].length - 1; // position of the closing '>'
    stamped = `${stamped.slice(0, idx)}${runtimeHtmlClass(runtime)}${stamped.slice(idx)}`;
  }
  const at = stamped.indexOf('<head>') + '<head>'.length;
  return new TextEncoder().encode(`${stamped.slice(0, at)}${runtimeMarker(runtime)}${stamped.slice(at)}`);
};

export type Assets = {
  /** Every embedded file. index.html here is the launcher-stamped copy. */
  bodies: Map<string, Uint8Array>;
  /** The viewer-stamped index.html — the only asset that differs by role. */
  viewerIndex: Uint8Array;
};

// Preload every embedded asset into memory once so responses come from an owned
// Uint8Array with fully controlled headers. Only index.html is held twice (it is
// a couple of kB); Pyodide and the fonts are shared between both servers.
export const loadAssets = async (): Promise<Assets> => {
  const bodies = new Map<string, Uint8Array>();
  let viewerIndex: Uint8Array | null = null;
  for (const [urlPath, ref] of Object.entries(ASSETS)) {
    const bytes = await Bun.file(ref).bytes();
    if (urlPath === INDEX) {
      bodies.set(urlPath, stampRuntimeMarker(bytes, 'launcher'));
      viewerIndex = stampRuntimeMarker(bytes, 'viewer');
    } else {
      bodies.set(urlPath, bytes);
    }
  }
  if (!viewerIndex) throw new Error('Launcher build is incomplete: index.html was not embedded.');
  return { bodies, viewerIndex };
};

/**
 * Serve an embedded asset for `path`, or null when the path is not a static
 * request this server should answer (the caller has already had its chance to
 * claim WebSocket endpoints).
 */
export const serveStatic = (assets: Assets, path: string, req: Request, runtime: ServedRuntime): Response => {
  const notFound = (): Response =>
    new Response('Not Found', { status: 404, headers: baseHeaders('text/plain; charset=utf-8') });

  const send = (urlPath: string): Response => {
    const body = urlPath === INDEX && runtime === 'viewer' ? assets.viewerIndex : assets.bodies.get(urlPath)!;
    return new Response(body, { headers: baseHeaders(contentType(urlPath)) });
  };

  // Built by hand rather than with Response.redirect(): that returns a response
  // with immutable headers (the viewer server appends Set-Cookie), and it would
  // drop the query string, which is where the viewer's token lives.
  if (path === '/') {
    const location = `${BASE_PATH}${new URL(req.url).search}`;
    return new Response(null, { status: 302, headers: { Location: location } });
  }
  if (!path.startsWith(BASE_PATH)) return notFound();

  const key = path === BASE_PATH ? INDEX : path;
  if (assets.bodies.has(key)) return send(key);

  // SPA fallback: unknown paths under the app sub-path resolve to index.html,
  // but only for navigations (Accept: text/html) or extensionless paths — a
  // missing .js/.wasm stays a 404 rather than being masked as HTML.
  const accept = req.headers.get('accept') ?? '';
  const hasExtension = /\.[a-z0-9]+$/i.test(path);
  if (accept.includes('text/html') || !hasExtension) return send(INDEX);
  return notFound();
};

/** Role of an upgraded socket. Only one kind remains, but the tag is kept so
 * adding a second endpoint does not mean reshaping the handlers again. */
type SocketRole = { role: 'feed' };

export const createServer = async (assets: Assets) => {
  return Bun.serve<SocketRole, {}>({
    // 127.0.0.1 only — never bind a public interface. Remote monitoring is
    // served by a separate server (viewerServer.ts) that exposes strictly less.
    hostname: '127.0.0.1',
    port: 0,
    // The monitoring uplink is idle whenever nothing is being plotted; without
    // this Bun would close it after 120s.
    idleTimeout: 0,
    fetch(req, srv) {
      const path = decodeURIComponent(new URL(req.url).pathname);

      // Remote-monitoring uplink from the host page. First page wins: a second
      // window (or a stray tab on the same origin) is refused rather than
      // displacing the live connection, because exactly one page owns the
      // hardware.
      if (path === HOST_FEED_PATH) {
        if (hostFeed.connected) return new Response('Feed already connected', { status: 409 });
        if (srv.upgrade(req, { data: { role: 'feed' } })) return undefined;
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      }

      return serveStatic(assets, path, req, 'launcher');
    },
    websocket: {
      open(ws) {
        hostFeed.attach(ws);
      },
      message(_ws, message) {
        // Text is the control and measurement protocol; binary is a media
        // fragment on its way to the viewers. Splitting on the type rather than
        // on a field is what let video join this socket without touching the
        // existing `{type: ...}` frames at all.
        if (typeof message === 'string') {
          hostFeed.handleMessage(message);
          return;
        }
        // Bun hands binary frames over as a Buffer/Uint8Array view. Slice to a
        // standalone ArrayBuffer: the view may point into a pooled buffer that
        // is reused before the fragment has been written to every viewer.
        hostFeed.handleBinaryMessage(
          message.buffer.slice(
            message.byteOffset,
            message.byteOffset + message.byteLength,
          ) as ArrayBuffer,
        );
      },
      close(ws) {
        hostFeed.detach(ws);
      },
    },
  });
};
