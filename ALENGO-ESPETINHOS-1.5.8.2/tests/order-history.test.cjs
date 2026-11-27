const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const restaurant = fs.readFileSync(path.join(root, 'electron/restaurant.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src/restaurant.jsx'), 'utf8');

test('Windows order history queries all orders within local operating-day boundaries', () => {
  assert.match(restaurant, /const listOrdersByLocalDay = dateText =>/);
  assert.match(restaurant, /new Date\(`\$\{value\}T00:00:00`\)/);
  assert.match(restaurant, /created_at>=\? AND created_at</);
  assert.match(restaurant, /attachOrderDetails\(orders\)/);
});

test('Windows order history is exposed through authenticated IPC', () => {
  assert.match(restaurant, /restaurant:orders-history/);
  assert.match(restaurant, /requireUser\(\);return \{ok:true,data:listOrdersByLocalDay\(date\)\}/);
  assert.match(preload, /history:date=>call\('restaurant:orders-history',date\)/);
});

test('Windows order page offers date-based history including canceled orders', () => {
  assert.match(ui, /Histórico completo de pedidos por dia/);
  assert.match(ui, /type="date" value=\{historyDate\}/);
  assert.match(ui, /window\.api\.restaurant\.history\(historyDate\)/);
  assert.match(ui, /o\.status==='CANCELADO'/);
});


test('local and remote web order history is scoped to the authenticated operator', () => {
  assert.match(restaurant, /listOrdersVisibleToOperatorByLocalDay/);
  assert.match(restaurant, /LIST_ORDERS_BY_DAY/);
  assert.match(restaurant, /path==='\/web\/orders\/history'/);
  assert.match(restaurant, /listOrdersVisibleToOperatorByLocalDay\(requestUrl\.searchParams\.get\('date'\),actor\)/);
});

test('web interface offers date-scoped order history and displays canceled order reasons', () => {
  const web = fs.readFileSync(path.join(root, 'cloudflare-pages/app.js'), 'utf8');
  assert.match(web, /Histórico de pedidos/);
  assert.match(web, /data-field="orders-history-date"/);
  assert.match(web, /data-action="orders-history"/);
  assert.match(web, /LIST_ORDERS_BY_DAY/);
  assert.match(web, /order\.cancel_reason/);
});

test('local mobile web copy receives the order-history feature and install action', () => {
  const mobile = fs.readFileSync(path.join(root, 'mobile-web/app.js'), 'utf8');
  const mobileHtml = fs.readFileSync(path.join(root, 'mobile-web/index.html'), 'utf8');
  assert.match(mobile, /Histórico de pedidos/);
  assert.match(mobile, /LIST_ORDERS_BY_DAY/);
  assert.match(mobile, /beforeinstallprompt/);
  assert.match(mobileHtml, /id="pwa-install"/);
});
