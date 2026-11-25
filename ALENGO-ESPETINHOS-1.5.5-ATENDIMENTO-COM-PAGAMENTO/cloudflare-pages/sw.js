const CACHE = 'alengo-remote-shell-v6';
const SHELL = ['./', './index.html', './styles.css', './config.js', './app.js', './manifest.webmanifest', './icon.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!SHELL.some(path => new URL(path, self.registration.scope).pathname === url.pathname)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
