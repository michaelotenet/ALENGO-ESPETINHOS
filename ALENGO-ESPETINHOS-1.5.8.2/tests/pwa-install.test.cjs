const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'cloudflare-pages/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'cloudflare-pages/app.js'), 'utf8');

test('PWA exposes an installation action without changing the login flow', () => {
  assert.match(html, /id="pwa-install"/);
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /prompt\.prompt\(\)/);
  assert.match(app, /appinstalled/);
});

test('PWA provides iPhone and Android home-screen installation instructions', () => {
  assert.match(app, /isIosDevice/);
  assert.match(app, /Compartilhar/);
  assert.match(app, /Adicionar à Tela de Início/);
  assert.match(app, /isAndroidDevice/);
  assert.match(app, /Instalar app/);
});

test('PWA install action is hidden when already running standalone', () => {
  assert.match(app, /display-mode: standalone/);
  assert.match(app, /navigator\.standalone === true/);
  assert.match(app, /if \(installButton && !isStandalone\(\)\)/);
});

test('service worker cache versions are advanced for both web entry points', () => {
  const remoteSw = fs.readFileSync(path.join(root, 'cloudflare-pages/sw.js'), 'utf8');
  const localSw = fs.readFileSync(path.join(root, 'mobile-web/sw.js'), 'utf8');
  assert.match(remoteSw, /alengo-remote-shell-v9/);
  assert.match(localSw, /alengo-web-shell-v6/);
});
