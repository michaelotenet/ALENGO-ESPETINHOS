/* Cache somente da interface estática. Requisições /login, /orders etc. nunca são armazenadas. */
const CACHE = 'alengo-web-shell-v3';
const SHELL = ['/mobile/', '/mobile/styles.css', '/mobile/app.js', '/mobile/config.js', '/mobile/manifest.webmanifest', '/mobile/icon.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/mobile/')) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
