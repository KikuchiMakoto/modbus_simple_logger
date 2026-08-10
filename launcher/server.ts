// Static file server for the launcher: serves the embedded (built) web app with
// cross-origin isolation and a hard no-cache policy, on 127.0.0.1 only.
import { ASSETS, BASE_PATH, COMPRESSED } from './embedded.generated';
import { KEEP_AWAKE_PATH_SUFFIX, keepAwakeFeed } from './keepAwakeFeed';

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
// WebSocket endpoint the host page uses to ask the launcher to suppress OS
// sleep (see keepAwakeFeed.ts). Loopback-only — it must never be reachable
// from another machine.
export const HOST_FEED_PATH = `${BASE_PATH}${KEEP_AWAKE_PATH_SUFFIX}`;

// The page tells launcher mode apart from a plain web deployment by this marker
// and nothing else (see src/utils/appMode.ts). It has to be stamped by whoever
// serves the page, because the client-side signal it replaced — hostname ===
// '127.0.0.1' — stops being true the moment the page is reached any other way.
const RUNTIME_MARKER = `<meta name="msl-runtime" content="launcher">`;

// A class stamped onto <html> in addition to the meta. The meta is read by
// JS (utils/appMode.ts); the class is read by CSS, which cannot select on a
// meta tag's content. index.css targets this to apply desktop-only rules —
// currently the body min-width that keeps the exe window's content from
// collapsing past a readable threshold when the user drags it narrow.
const RUNTIME_HTML_CLASS = ' class="msl-launcher"';

// Stamp the marker into the <head> of the served index.html. dist/ on disk
// stays untouched: only the in-memory copy carries it, so `bun run build`
// output is still byte-for-byte what GitHub Pages gets.
const stampRuntimeMarker = (html: Uint8Array): Uint8Array => {
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
    stamped = `${stamped.slice(0, idx)}${RUNTIME_HTML_CLASS}${stamped.slice(idx)}`;
  }
  const at = stamped.indexOf('<head>') + '<head>'.length;
  return new TextEncoder().encode(`${stamped.slice(0, at)}${RUNTIME_MARKER}${stamped.slice(at)}`);
};

export type Assets = {
  /** The launcher-stamped index.html, held as bytes because it is rewritten. */
  index: Uint8Array;
};

/**
 * Prepare the one asset that cannot be served straight from its embedded copy.
 *
 * Everything else is handed to Bun.file() at request time. Reading all of dist
 * into a Map here instead — which is what this used to do — cost ~19MB of
 * resident memory and, worse, spent it before launchBrowser() was reached, so
 * every launch paid for decoding the Pyodide wasm and the fonts up front on the
 * chance that the user would open ScriptRunner.
 *
 * The eager pass did double as a sanity check that the embed was complete, so
 * the one thing worth failing early on — a build with no index.html to serve —
 * is still checked here.
 */
export const loadAssets = async (): Promise<Assets> => {
  const ref = ASSETS[INDEX];
  if (!ref) throw new Error('Launcher build is incomplete: no index.html was embedded.');
  return { index: stampRuntimeMarker(await Bun.file(ref).bytes()) };
};

/**
 * Serve an embedded asset for `path`, or a 404 when the path is not a static
 * request this server should answer (the caller has already had its chance to
 * claim WebSocket endpoints).
 */
const serveStatic = (
  assets: Assets,
  path: string,
  req: Request,
): Response | Promise<Response> => {
  const notFound = (): Response =>
    new Response('Not Found', { status: 404, headers: baseHeaders('text/plain; charset=utf-8') });

  const send = (urlPath: string): Response | Promise<Response> => {
    const headers = baseHeaders(contentType(urlPath));
    // index.html is the rewritten copy, never the embedded bytes.
    if (urlPath === INDEX) return new Response(assets.index, { headers });

    const body = Bun.file(ASSETS[urlPath]!);
    if (!COMPRESSED.has(urlPath)) return new Response(body, { headers });

    // The embedded copy is gzip. Every browser this launcher will ever talk to
    // (it refuses to start without Edge or Chrome) sends `Accept-Encoding:
    // gzip`, but a client that does not would be handed binary and render it —
    // so decompress for that case rather than trust the invariant.
    if ((req.headers.get('accept-encoding') ?? '').includes('gzip')) {
      return new Response(body, { headers: { ...headers, 'Content-Encoding': 'gzip' } });
    }
    return body.bytes().then((gz) => new Response(Bun.gunzipSync(gz), { headers }));
  };

  // Built by hand rather than with Response.redirect(): that returns a response
  // with immutable headers, and it would drop the query string.
  if (path === '/') {
    const location = `${BASE_PATH}${new URL(req.url).search}`;
    return new Response(null, { status: 302, headers: { Location: location } });
  }
  if (!path.startsWith(BASE_PATH)) return notFound();

  const key = path === BASE_PATH ? INDEX : path;
  if (key in ASSETS) return send(key);

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
  // One type argument: Bun.serve's second generic is the `routes` path type
  // (`R extends string`), not a second data type. `Bun.serve<SocketRole, {}>`
  // only ever compiled because launcher/ was outside every tsconfig.
  return Bun.serve<SocketRole>({
    // 127.0.0.1 only — never bind a public interface.
    hostname: '127.0.0.1',
    port: 0,
    // The keep-awake socket is idle whenever nothing is measuring; without
    // this Bun would close it after 120s.
    idleTimeout: 0,
    fetch(req, srv) {
      const path = decodeURIComponent(new URL(req.url).pathname);

      // Keep-awake uplink from the host page. First page wins: a second window
      // (or a stray tab on the same origin) is refused rather than displacing
      // the live connection, because exactly one page owns the hardware.
      if (path === HOST_FEED_PATH) {
        if (keepAwakeFeed.connected) return new Response('Feed already connected', { status: 409 });
        if (srv.upgrade(req, { data: { role: 'feed' } })) return undefined;
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      }

      return serveStatic(assets, path, req);
    },
    websocket: {
      open(ws) {
        keepAwakeFeed.attach(ws);
      },
      message(_ws, message) {
        if (typeof message === 'string') {
          keepAwakeFeed.handleMessage(message);
        }
      },
      close(ws) {
        keepAwakeFeed.detach(ws);
      },
    },
  });
};
