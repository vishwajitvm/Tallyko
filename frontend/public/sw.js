/*
 * Tallyko service worker: keeps the app shell available offline so billing opens without internet.
 * - Navigations: network first, fall back to the cached index.html.
 * - Hashed static bundles (/_expo/static/*) and icons: cache first (they never change once built).
 * - API calls (/api/*, /health) are never cached — offline bills go through the app's own outbox.
 */
const CACHE = 'tallyko-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.json', '/logo192.png', '/logo512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  if (url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/') || /\.(png|ico|ttf|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
  }
});
