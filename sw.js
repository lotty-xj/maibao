// Service Worker for 麦宝的成长日记
const CACHE_NAME = 'maibao-v6';
// Force activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
  );
  self.clients.claim();
});
// Network-first for HTML, cache nothing else
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  // Always go to network, don't cache
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
