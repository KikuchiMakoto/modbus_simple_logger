// Static file server for the launcher: serves the embedded (built) web app on
// 127.0.0.1 with cross-origin isolation and a hard no-cache policy.
import { ASSETS, BASE_PATH } from './embedded.generated';

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
});

export const INDEX = `${BASE_PATH}index.html`;

// Preload every embedded asset into memory once so responses come from an owned
// Uint8Array with fully controlled headers.
const loadBodies = async (): Promise<Map<string, Uint8Array>> => {
  const bodies = new Map<string, Uint8Array>();
  for (const [urlPath, ref] of Object.entries(ASSETS)) {
    bodies.set(urlPath, await Bun.file(ref).bytes());
  }
  return bodies;
};

export const createServer = async () => {
  const bodies = await loadBodies();
  if (!bodies.has(INDEX)) {
    throw new Error('Launcher build is incomplete: index.html was not embedded.');
  }

  const notFound = (): Response =>
    new Response('Not Found', { status: 404, headers: baseHeaders('text/plain; charset=utf-8') });

  const send = (urlPath: string): Response =>
    new Response(bodies.get(urlPath)!, { headers: baseHeaders(contentType(urlPath)) });

  return Bun.serve({
    // 127.0.0.1 only — never bind a public interface. main.tsx keys launcher
    // mode (skip Service Worker) on exactly this hostname.
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);

      if (path === '/') return Response.redirect(BASE_PATH, 302);
      if (!path.startsWith(BASE_PATH)) return notFound();

      const key = path === BASE_PATH ? INDEX : path;
      if (bodies.has(key)) return send(key);

      // SPA fallback: unknown paths under the app sub-path resolve to
      // index.html, but only for navigations (Accept: text/html) or
      // extensionless paths — a missing .js/.wasm stays a 404 rather than being
      // masked as HTML.
      const accept = req.headers.get('accept') ?? '';
      const hasExtension = /\.[a-z0-9]+$/i.test(path);
      if (accept.includes('text/html') || !hasExtension) return send(INDEX);
      return notFound();
    },
  });
};
