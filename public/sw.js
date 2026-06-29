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

// Install: pre-cache essential resources
self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Pre-caching essential resources');
      // Use individual fetches so a single failure doesn't block install
      const results = await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          const response = await fetch(url, { cache: 'no-store' });
            if (response.ok) {
              await cache.put(url, withIsolationHeaders(response));
            }
        })
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        console.warn('[SW] Some pre-cache requests failed:', failed.length);
      }
    })
  );
  self.skipWaiting();
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

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests under BASE_PATH
  if (url.origin !== location.origin) return;
  if (!url.pathname.startsWith(BASE_PATH)) return;

  const isNavigation = request.mode === 'navigate';

  if (isNavigation) {
    // Navigation (HTML): Network-first
    // Always try to get the latest HTML from the network.
    // Fall back to cache when offline.
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, clone);
              cache.put(BASE_PATH + 'index.html', clone.clone());
            });
          }
          return withIsolationHeaders(response);
        })
        .catch(async () => {
          console.warn('[SW] Navigation fetch failed, serving from cache');
          const cached = await caches.match(request) || await caches.match(BASE_PATH + 'index.html');
          if (cached) return withIsolationHeaders(cached.clone());
          return withIsolationHeaders(new Response(
            '<!DOCTYPE html><html><body><h1>Offline</h1><p>No cached content available. Please connect to the internet and reload.</p></body></html>',
            {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            }
          ));
        })
    );
    return;
  }

  // Static assets (JS/CSS/images/fonts): Stale-While-Revalidate
  // Serve cached version immediately for fast response,
  // then fetch fresh version in the background to update cache.
  // This ensures:
  //   - Offline: cached resources are served reliably
  //   - Online: resources are always updated for the NEXT load
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(request);

      // Always start a background fetch to update cache (when online)
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return withIsolationHeaders(networkResponse);
        })
        .catch((err) => {
          console.warn('[SW] Background fetch failed:', request.url, err);
          return null;
        });

      // If we have a cached response, return it immediately
      if (cachedResponse) {
        return withIsolationHeaders(cachedResponse.clone());
      }

      // No cache available: wait for network response
      const networkResponse = await fetchPromise;
      if (networkResponse) {
        return withIsolationHeaders(networkResponse);
      }

      // Both cache and network failed
      return withIsolationHeaders(new Response('Offline - Resource not available', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain' },
      }));
    })
  );
});

// Message handler
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
