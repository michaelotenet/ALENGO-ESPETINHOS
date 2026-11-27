const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('SQLite notification center stores unique events and separates Windows/operator targets', () => {
  const source = read('electron/restaurant.js');
  assert.match(source, /CREATE TABLE IF NOT EXISTS restaurant_notifications/);
  assert.match(source, /event_key TEXT NOT NULL UNIQUE/);
  assert.match(source, /target TEXT NOT NULL/);
  assert.match(source, /target='OPERATOR' AND operator_id=\?/);
  assert.match(source, /target='WINDOWS'/);
});

test('incoming orders create a Windows toast and persistent history event', () => {
  const source = read('electron/restaurant.js');
  assert.match(source, /new Notification\(\{title,body:message,silent:false\}\)/);
  assert.match(source, /event_key:`order-received:\$\{result\.orderId\}`/);
  assert.match(source, /notifyWindows\(`Novo pedido/);
});

test('kitchen item-ready changes create operator notifications with partial and complete states', () => {
  const source = read('electron/restaurant.js');
  assert.match(source, /ORDER_READY_PARTIAL/);
  assert.match(source, /ORDER_READY_COMPLETE/);
  assert.match(source, /operator_id:order\.operator_id/);
  assert.match(source, /ready-complete:/);
});

test('remote snapshot exposes only the authenticated operator notification history', () => {
  const source = read('electron/restaurant.js');
  assert.match(source, /WHERE target='OPERATOR' AND operator_id=\?/);
  assert.match(source, /notifications,cash_open:/);
  assert.match(source, /ACK_NOTIFICATION/);
});

test('local and remote web interfaces show notification history and support read acknowledgement', () => {
  for (const file of ['cloudflare-pages/app.js', 'mobile-web/app.js']) {
    const web = read(file);
    assert.match(web, /Notificações/);
    assert.match(web, /notifications-read/);
    assert.match(web, /Notification\.requestPermission/);
    assert.match(web, /ACK_NOTIFICATION/);
  }
});

test('Supabase migration authorizes only authenticated notification acknowledgements through request queue', () => {
  const sql = read('supabase/migrations/20261120000300_alengo_notification_center.sql');
  assert.match(sql, /ACK_NOTIFICATION/);
  assert.match(sql, /alter table public\.remote_requests/i);
});
