// Service Worker for Modbus WebUSB Logger PWA
const CACHE_NAME = 'modbus-logger-v2';
const BASE_PATH = '/modbus_simple_logger/';

// リソースを動的にキャッシュ（初回アクセス時）
const CACHE_URLS = [
  BASE_PATH,
  BASE_PATH + 'index.html',
];

// インストール時の処理
self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Caching initial resources');
      try {
        await Promise.all(
          CACHE_URLS.map(async (url) => {
            const response = await fetch(url, { cache: 'no-store' });
            if (response.ok) {
              await cache.put(url, response);
            }
          })
        );
      } catch (error) {
        console.warn('[SW] Failed to cache some resources during install:', error);
        // インストール失敗を防ぐため、エラーは無視
      }
    })
  );
  // 即座にアクティベート
  self.skipWaiting();
});

// アクティベート時の処理（古いキャッシュを削除）
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // すべてのクライアントを即座に制御下に置く
  return self.clients.claim();
});

// フェッチ時の処理（キャッシュファースト戦略）
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 同一オリジンのリクエストのみ処理
  if (url.origin !== location.origin) {
    return;
  }

  // base path配下のリソースのみ処理
  if (!url.pathname.startsWith(BASE_PATH)) {
    return;
  }

  const isNavigation = request.mode === 'navigate';

  event.respondWith(
    (async () => {
      if (isNavigation) {
        try {
          const response = await fetch(request, { cache: 'no-store' });
          if (response && response.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
          }
          return response;
        } catch (error) {
          console.error('[SW] Navigation fetch failed:', error);
          return caches.match(BASE_PATH + 'index.html');
        }
      }

      const cachedResponse = await caches.match(request);
      const networkPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseClone = response.clone(); // Clone immediately before body is consumed
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch((error) => {
          console.error('[SW] Fetch failed:', error);
          return cachedResponse;
        });

      return cachedResponse || networkPromise;
    })()
  );
});

// メッセージ受信時の処理（将来の拡張用）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
