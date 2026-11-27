const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const cloudApp = fs.readFileSync(path.join(root, 'cloudflare-pages/app.js'), 'utf8');
const mobileApp = fs.readFileSync(path.join(root, 'mobile-web/app.js'), 'utf8');
const cloudCss = fs.readFileSync(path.join(root, 'cloudflare-pages/styles.css'), 'utf8');
const mobileCss = fs.readFileSync(path.join(root, 'mobile-web/styles.css'), 'utf8');

test('preferências de som são individuais por operador e migram configurações anteriores', () => {
  assert.match(cloudApp, /alengo-notification-prefs-v2:/);
  assert.match(cloudApp, /alengo-notification-prefs-v1:/);
  assert.match(cloudApp, /state\.remoteUid\|\|state\.operator\|\|state\.user/);
  assert.match(cloudApp, /saveNotificationPrefs\(prefs\)/);
});

test('sons possuem assinaturas acústicas distintas para cinco eventos', () => {
  for (const event of ['ready', 'partial', 'newOrder', 'help', 'general']) assert.match(cloudApp, new RegExp(`${event}:\{label:`));
  assert.match(cloudApp, /loadNotificationAudio/);
  assert.match(cloudApp, /decodeAudioData/);
  for (const file of ['ready.wav','partial.wav','new-order.wav','help.wav','general.wav']) assert.ok(fs.existsSync(path.join(root,'cloudflare-pages/sounds',file)));
  assert.match(cloudApp, /notificationKind\(item\)/);
  assert.match(cloudApp, /data-action=\"notification-preview\"/);
});

test('alertas de pedido pronto e demais avisos podem ter sons independentes', () => {
  assert.match(cloudApp, /notification-ready-sound/);
  assert.match(cloudApp, /notification-other-sound/);
  assert.match(cloudApp, /notificationIsReady/);
});

test('volume e vibração são opcionais e dependem do suporte do aparelho', () => {
  assert.match(cloudApp, /id=\"notification-volume\" type=\"range\" min=\"0\" max=\"100\"/);
  assert.match(cloudApp, /notification-vibration/);
  assert.match(cloudApp, /'vibrate'in navigator/);
});

test('versões Cloudflare Pages e mobile-web permanecem sincronizadas', () => {
  assert.equal(mobileApp, cloudApp);
  assert.equal(mobileCss, cloudCss);
});

test('estilos de controles de notificação e painel compacto estão presentes', () => {
  assert.match(cloudCss, /\.notification-settings/);
  assert.match(cloudCss, /\.sound-profile-grid/);
  assert.match(cloudCss, /\.home-action-grid/);
  assert.match(cloudCss, /\.bottom-nav/);
});
