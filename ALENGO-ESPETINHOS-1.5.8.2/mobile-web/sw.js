/* Cache somente da interface estática. Requisições de negócio nunca são armazenadas. */
const CACHE = 'alengo-web-shell-v6';
const SHELL = ['/mobile/', '/mobile/styles.css', '/mobile/app.js', '/mobile/config.js', '/mobile/manifest.webmanifest', '/mobile/icon.png', '/mobile/sounds/ready.wav', '/mobile/sounds/partial.wav', '/mobile/sounds/new-order.wav', '/mobile/sounds/help.wav', '/mobile/sounds/general.wav'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/mobile/')) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text?.() || 'Há uma atualização no atendimento.' }; }
  event.waitUntil((async()=>{const openClients=await clients.matchAll({type:'window',includeUncontrolled:true});if(openClients.some(client=>client.visibilityState==='visible')){for(const client of openClients)client.postMessage({type:'ALENGO_PUSH',payload:data});return;}await self.registration.showNotification(String(data.title||'ALENGO ESPETINHOS'),{body:String(data.body||'Você recebeu uma atualização.'),icon:'/mobile/icon.png',badge:'/mobile/icon.png',tag:String(data.tag||`alengo-${Date.now()}`),renotify:true,requireInteraction:!!data.requireInteraction,data:{url:data.url||'/mobile/?mode=remote',eventKey:data.eventKey||''},vibrate:data.vibrate||[120,50,120]});})());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/mobile/?mode=remote', self.registration.scope).href;
  event.waitUntil((async () => { const windows = await clients.matchAll({type:'window',includeUncontrolled:true}); for (const client of windows) { if ('focus' in client) { await client.focus(); client.postMessage({type:'ALENGO_PUSH_OPEN',eventKey:event.notification.data?.eventKey||''}); return; } } if (clients.openWindow) await clients.openWindow(target); })());
});
