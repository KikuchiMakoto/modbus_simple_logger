// Service Worker for Modbus WebUSB Logger PWA
// CACHE_VERSION is replaced at build time with a content hash of the precache
// manifest (see the `precache-manifest` plugin in vite.config.ts), so every
// deploy gets a fresh cache. Stays 'dev' for unbuilt `vite dev`.
const CACHE_VERSION = 'dev';
const CACHE_NAME = `modbus-logger-${CACHE_VERSION}`;
const BASE_PATH = '/modbus_simple_logger/';
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const withIsolationHeaders = (response) => {
  // Opaque / opaque-redirect responses cannot be rebuilt (body is not
  // readable); pass them through untouched like coi-serviceworker does.
  if (response.status === 0 || response.type === 'opaque' || response.type === 'opaqueredirect') {
    return response;
  }
  const headers = new Headers(response.headers);
  Object.entries(ISOLATION_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

// Pre-cache: every build asset (hashed JS/CSS bundles, the Pyodide worker
// chunk, index.html, manifest, icon...) is cached during install so the app
// shell works fully offline after the first successful online visit. The list
// is injected at build time by the `precache-manifest` plugin in vite.config.ts
// (it replaces the empty array below). It stays empty for unbuilt `vite dev`,
// where the Service Worker is inactive anyway (different base path).
const PRECACHE_MANIFEST = [];
const PRECACHE_URLS = [
  // The start_url (`/modbus_simple_logger/`) resolves to index.html but is a
  // distinct cache key, so precache it explicitly for the offline navigation
  // fallback.
  BASE_PATH,
  ...PRECACHE_MANIFEST.map((path) => BASE_PATH + path),
];

// Install: pre-cache the complete app shell, all-or-nothing. A partial cache
// must never activate — a missing JS chunk turns into a blank page on the next
// offline launch. If any fetch fails, install fails, the previous version
// keeps serving, and the browser retries on the next update check.
//
// Deliberately NO skipWaiting() here: after install the new SW parks in
// `waiting` and the previous version keeps serving with its cache intact.
// Activation (which deletes the old cache and claims clients) only happens
// when the page posts SKIP_WAITING — silently at startup, or after the user
// confirms mid-session (see main.tsx). This pins the running version until
// the user consents and prevents an update from breaking a live session.
self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Pre-caching app shell,', PRECACHE_URLS.length, 'entries');
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          const response = await fetch(url, { cache: 'no-store' });
          if (!response.ok) {
            throw new Error(`[SW] Pre-cache failed: ${url} (${response.status})`);
          }
          await cache.put(url, withIsolationHeaders(response));
        })
      );
    })
  );
});

// Activate: clean up old caches and claim clients
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event');
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first for everything under BASE_PATH.
//
// The precache is complete and internally consistent for this CACHE_VERSION
// (index.html always references exactly the hashed bundles cached alongside
// it), so serving from cache is always correct. Freshness comes solely from
// the sw.js update cycle: a deploy changes CACHE_VERSION, the new SW
// precaches the new shell atomically, and the client reloads on
// controllerchange.
//
// Navigations deliberately do NOT go network-first: right after an OS reboot
// the network can sit in a half-up state where fetch() neither succeeds nor
// fails for minutes, which left the PWA window blank until the request timed
// out. Cache-first paints instantly regardless of network state.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // Chromium quirk (see gzuidhof/coi-serviceworker): passing such a request
  // to fetch() throws, so let the browser handle it.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const url = new URL(request.url);

  // Only handle same-origin requests under BASE_PATH
  if (url.origin !== location.origin) return;
  if (!url.pathname.startsWith(BASE_PATH)) return;

  event.respondWith(respond(request, request.mode === 'navigate'));
});

async function respond(request, isNavigation) {
  const cache = await caches.open(CACHE_NAME);

  let cached = await cache.match(request);
  if (!cached && isNavigation) {
    // Any in-scope navigation (start_url with or without query, deep link)
    // falls back to the precached shell.
    cached = (await cache.match(BASE_PATH)) || (await cache.match(BASE_PATH + 'index.html'));
  }
  if (cached) return withIsolationHeaders(cached);

  try {
    const response = await fetch(request, isNavigation ? { cache: 'no-store' } : undefined);
    // Opportunistically cache misses (e.g. assets requested before this SW's
    // install finished). Never store navigations at runtime: index.html must
    // only enter the cache atomically with its hashed bundles during install,
    // otherwise a newer index.html paired with older cached bundles produces
    // a blank page offline.
    if (response.ok && !isNavigation) {
      await cache.put(request, withIsolationHeaders(response.clone()));
    }
    return withIsolationHeaders(response);
  } catch (err) {
    console.warn('[SW] Fetch failed with no cache fallback:', request.url, err);
    if (isNavigation) {
      return withIsolationHeaders(
        new Response(
          '<!DOCTYPE html><html><body><h1>Offline</h1><p>No cached content available. Please connect to the internet and reload.</p></body></html>',
          {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }
        )
      );
    }
    return withIsolationHeaders(
      new Response('Offline - Resource not available', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain' },
      })
    );
  }
}

// Message handler
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
