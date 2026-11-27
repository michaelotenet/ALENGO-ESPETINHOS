const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('Supabase migration creates remote queue and enables RLS', () => {
  const sql = read('supabase/migrations/20261120000100_alengo_remote_access.sql');
  for (const table of ['remote_operator_links', 'remote_state', 'remote_requests']) assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /auth_user_id\s*=\s*auth\.uid\(\)/i);
  assert.match(sql, /for insert to authenticated/i);
});

test('public Web config contains only the publishable key', () => {
  for (const file of ['mobile-web/config.js', 'cloudflare-pages/config.js']) {
    const config = read(file);
    assert.match(config, /sb_publishable_/);
    assert.doesNotMatch(config, /sb_secret_/);
    assert.match(config, /remoteEnabled:\s*true/);
  }
});

test('Windows bridge reads a DPAPI-protected key and calls only the Supabase REST API', () => {
  const bridge = read('electron/remote-bridge.js');
  assert.match(bridge, /secretKeyProtected/);
  assert.match(bridge, /ConvertTo-SecureString/);
  assert.match(bridge, /\/rest\/v1\//);
  assert.match(bridge, /remote_operator_links/);
});

test('remote Web queues commands persistently and distinguishes Windows confirmation', () => {
  const web = read('mobile-web/app.js');
  assert.match(web, /indexedDB\.open\(REMOTE_QUEUE_DB/);
  assert.match(web, /status === 'CONFIRMED'/);
  assert.match(web, /A operação foi guardada neste aparelho/);
  assert.match(web, /remote_requests/);
});

test('remote requests are processed through existing SQLite order functions', () => {
  const restaurant = read('electron/restaurant.js');
  assert.match(restaurant, /saveOrder\(payload,actor,'Aplicativo Web Remoto'\)/);
  assert.match(restaurant, /updateItemDelivery\(payload,actor,false,'WEB REMOTO'\)/);
  assert.match(restaurant, /cancelOrder\(payload\.order_id,payload\.reason,actor,false,'REMOTE'\)/);
  assert.match(restaurant, /restaurant_remote_processed/);
});


test('remote login uses operator username without requesting email', () => {
  const web = fs.readFileSync(path.join(root, 'cloudflare-pages/app.js'), 'utf8');
  assert.match(web, /async function remoteUsernameEmail\(username\)/);
  assert.match(web, /Usuário do atendente/);
  assert.match(web, /@alengo\.invalid/);
  assert.doesNotMatch(web, /E-mail do atendente/);
});

test('Windows operator manager provisions and revokes Supabase Auth users', () => {
  const bridge = fs.readFileSync(path.join(root, 'electron/remote-bridge.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  assert.match(bridge, /async function syncOperator/);
  assert.match(bridge, /auth\/v1\/admin/);
  assert.match(bridge, /remote_operator_links\?on_conflict=auth_user_id/);
  assert.match(main, /remote_enabled/);
  assert.match(main, /syncRemoteOperator/);
  assert.match(main, /remote_auth_user_id/);
});

test('new migration disables old manually linked email accounts', () => {
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261120000200_operator_managed_auth.sql'), 'utf8');
  assert.match(migration, /delete from public\.remote_operator_links/i);
});


test('Web refresh preserves active field and text cursor', () => {
  const web = read('cloudflare-pages/app.js');
  assert.match(web, /const focusInfo = active && view\.contains\(active\)/);
  assert.match(web, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(web, /target\.setSelectionRange\(focusInfo\.start, focusInfo\.end\)/);
});

test('Windows customer records are included in remote snapshot and selectable in Web', () => {
  const restaurant = read('electron/restaurant.js');
  const web = read('cloudflare-pages/app.js');
  assert.match(restaurant, /SELECT id,name,phone FROM customers ORDER BY name/);
  assert.match(restaurant, /customer_id INTEGER/);
  assert.match(restaurant, /payload\.customer_id/);
  assert.match(web, /state\.customers\.map\(customer/);
  assert.match(web, /customer_id: state\.customerId/);
});


test('remote table payments require Windows-granted operator permission and are processed automatically through the existing payment function', () => {
  const restaurant = read('electron/restaurant.js');
  const main = read('src/main.jsx');
  const web = read('cloudflare-pages/app.js');
  assert.match(restaurant, /requirePermission\(actor,'receive_table_payment'/);
  assert.match(restaurant, /item\.request_type==='PAY_TABLE'/);
  assert.match(restaurant, /payTable\(payload,actor\)/);
  assert.match(restaurant, /restaurant_web_payment_keys/);
  assert.match(restaurant, /cash_registers WHERE closing_status='ABERTO'/);
  assert.match(main, /Receber e finalizar pagamentos diretamente na mesa/);
  assert.match(web, /PAY_TABLE/);
  assert.match(web, /Finalizar recebimento/);
});

test('operator permissions and table responsibility are persisted in Windows and included in remote snapshots', () => {
  const restaurant = read('electron/restaurant.js');
  const main = read('electron/main.js');
  assert.match(restaurant, /permissions_json/);
  assert.match(restaurant, /primary_operator_id/);
  assert.match(restaurant, /shared_tables/);
  assert.match(restaurant, /view_all_tables/);
  assert.match(main, /permissions_json/);
});


test('local Web sessions use a distinct device namespace so new operator permissions do not alter Android 1.3.4', () => {
  const web = read('cloudflare-pages/app.js');
  const restaurant = read('electron/restaurant.js');
  assert.match(web, /const deviceKey = \(\) => 'web_'/);
  assert.match(restaurant, /path==='\/web\/orders'/);
  assert.match(restaurant, /Aplicativo Web Local/);
});
