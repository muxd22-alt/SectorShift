importScripts('./js/version.js');

const CACHE_NAME = `pwa-cache-${APP_VERSION}`;
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json',
  './js/version.js',
  'https://unpkg.com/preact@10.22.1/dist/preact.min.js',
  'https://unpkg.com/preact@10.22.1/hooks/dist/hooks.min.js',
  'https://unpkg.com/htm@3.1.1/dist/htm.umd.js',
  'https://unpkg.com/@preact/signals-core@1.6.1/dist/signals-core.min.js',
  'https://unpkg.com/@preact/signals@1.3.0/dist/signals.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Return cached version or fetch from network
      return response || fetch(event.request).then((networkResponse) => {
        // Cache new assets on the fly if needed (optional)
        return networkResponse;
      });
    })
  );
});
