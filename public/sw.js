// Service Worker for Modbus WebUSB Logger PWA
const CACHE_NAME = 'modbus-logger-v3';
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
      // ナビゲーションリクエスト（HTMLページ）: ネットワークファースト
      if (isNavigation) {
        try {
          const response = await fetch(request, { cache: 'no-store' });
          if (response && response.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
          }
          return response;
        } catch (error) {
          console.error('[SW] Navigation fetch failed, using cache:', error);
          const cachedResponse = await caches.match(BASE_PATH + 'index.html');
          if (cachedResponse) {
            return cachedResponse;
          }
          return new Response('Offline - No cached content available', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        }
      }

      // 非ナビゲーションリクエスト（JS/CSS/画像など）: キャッシュファースト
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        console.log('[SW] Serving from cache:', request.url);
        return cachedResponse;
      }

      // キャッシュになければネットワークから取得
      try {
        const response = await fetch(request);
        if (response && response.status === 200) {
          const responseClone = response.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, responseClone);
          console.log('[SW] Cached new resource:', request.url);
        }
        return response;
      } catch (error) {
        console.error('[SW] Fetch failed, no cache available:', error);
        return new Response('Offline - Resource not available', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    })()
  );
});

// メッセージ受信時の処理（将来の拡張用）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
