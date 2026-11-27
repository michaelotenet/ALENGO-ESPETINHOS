const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('home page uses compact operational cards and bottom navigation', () => {
  const app = read('cloudflare-pages/app.js');
  const css = read('cloudflare-pages/styles.css');
  assert.match(app, /home-welcome/);
  assert.match(app, /home-action-grid/);
  assert.match(app, /home-shortcuts/);
  assert.match(app, /renderBottomNav/);
  assert.match(css, /@media\(max-width:520px\)/);
  assert.match(css, /@media\(orientation:landscape\)/);
});

test('Web Push subscription is created only after explicit permission and authenticated Windows registration', () => {
  const app = read('cloudflare-pages/app.js');
  assert.match(app, /Notification\.requestPermission\(\)/);
  assert.match(app, /pushManager\.subscribe/);
  assert.match(app, /remoteCommand\('REGISTER_PUSH'/);
  assert.match(app, /remoteCommand\('UNREGISTER_PUSH'/);
  assert.match(app, /push_public_key/);
});

test('service workers receive Push events and display system notifications', () => {
  for (const file of ['cloudflare-pages/sw.js','mobile-web/sw.js']) {
    const sw = read(file);
    assert.match(sw, /addEventListener\('push'/);
    assert.match(sw, /showNotification/);
    assert.match(sw, /addEventListener\('notificationclick'/);
  }
});

test('Windows bridge stores encrypted VAPID private key and sends only to operator subscriptions', () => {
  const bridge = read('electron/remote-bridge.js');
  assert.match(bridge, /safeStorage\.encryptString/);
  assert.match(bridge, /safeStorage\.decryptString/);
  assert.match(bridge, /restaurant_push_subscriptions/);
  assert.match(bridge, /require\('\.\/web-push'\)/);
  assert.match(read('electron/web-push.js'), /function sendWebPush/);
  assert.match(bridge, /auth_user_id=\?/);
  assert.match(read('electron/web-push.js'), /'Content-Encoding': 'aes128gcm'/);
});

test('push command migration preserves all existing request types', () => {
  const sql = read('supabase/migrations/20261125000100_alengo_web_push_commands.sql');
  for (const kind of ['CREATE_ORDER','ITEM_DELIVERY','CANCEL_ORDER','ACK_NOTIFICATION','CALL_RESPONSIBLE','LIST_ORDERS_BY_DAY','PAY_TABLE','REGISTER_PUSH','UNREGISTER_PUSH']) assert.ok(sql.includes(kind));
});

test('logout removes device subscription to avoid sending the previous operator alerts on shared phones', () => {
  const app = read('cloudflare-pages/app.js');
  assert.match(app, /push-logout/);
  assert.match(app, /subscription\.unsubscribe\(\)/);
});
