const CACHE = 'alengo-remote-shell-v13';
const SHELL = ['./', './index.html', './styles.css', './config.js', './app.js', './manifest.webmanifest', './icon.png', './sounds/ready.wav', './sounds/partial.wav', './sounds/new-order.wav', './sounds/help.wav', './sounds/general.wav'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!SHELL.some(path => new URL(path, self.registration.scope).pathname === url.pathname)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text?.() || 'Há uma atualização no atendimento.' }; }
  event.waitUntil((async()=>{const openClients=await clients.matchAll({type:'window',includeUncontrolled:true});if(openClients.some(client=>client.visibilityState==='visible')){for(const client of openClients)client.postMessage({type:'ALENGO_PUSH',payload:data});return;}const title=String(data.title||'ALENGO ESPETINHOS');const options={body:String(data.body||'Você recebeu uma atualização.'),icon:'./icon.png',badge:'./icon.png',tag:String(data.tag||`alengo-${Date.now()}`),renotify:true,requireInteraction:!!data.requireInteraction,data:{url:data.url||'./?mode=remote',eventKey:data.eventKey||''},vibrate:data.vibrate||[120,50,120]};await self.registration.showNotification(title,options);})());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './?mode=remote', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) { if ('focus' in client) { await client.focus(); client.postMessage({ type: 'ALENGO_PUSH_OPEN', eventKey: event.notification.data?.eventKey || '' }); return; } }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});
