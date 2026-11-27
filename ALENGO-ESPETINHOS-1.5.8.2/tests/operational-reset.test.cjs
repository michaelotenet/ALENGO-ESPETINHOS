const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
const restaurant = fs.readFileSync(path.join(root, 'electron/restaurant.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'electron/remote-bridge.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8');

test('operational reset is administrator-only and requires explicit confirmation', () => {
  assert.match(main, /ipcMain\.handle\('operational:reset'/);
  assert.match(main, /actor\.role!=='admin'/);
  assert.match(main, /confirmation\)!=='RESETAR DADOS'/);
  assert.match(main, /operationalResetInProgress=true/);
  assert.match(main, /finally\{operationalResetInProgress=false/);
  assert.match(ui, /digite exatamente: RESETAR DADOS/);
});

test('operational reset blocks open cash, unfinished orders, pending printing and fiscal documents', () => {
  assert.match(main, /closing_status='ABERTO'/);
  assert.match(main, /status='ABERTO' OR \(status='PAGO' AND COALESCE\(ready_at,''\)=''/);
  assert.match(main, /restaurant_print_jobs WHERE status IN \('PENDING','PROCESSING','FAILED'\)/);
  assert.match(main, /SELECT COUNT\(\*\) n FROM fiscal_documents/);
});

test('operational reset backs up and verifies SQLite before transactional deletion', () => {
  assert.match(main, /await db\.backup\(backupPath\)/);
  assert.match(main, /pragma\('quick_check'/);
  assert.match(main, /db\.transaction\(\(\)=>\{/);
  assert.match(main, /operational_generation/);
});

test('operational reset preserves master data and clears operational records', () => {
  assert.match(main, /UPDATE customers SET balance_cents=0/);
  assert.match(main, /restaurant_orders/);
  assert.match(main, /restaurant_notifications/);
  assert.match(main, /cash_registers/);
  assert.match(main, /activity_log/);
  const resetHandler=main.slice(main.indexOf("ipcMain.handle('operational:reset'"),main.indexOf("ipcMain.handle('backup:schedule'"));
  assert.doesNotMatch(resetHandler, /DELETE FROM (products|categories|operators|restaurant_tables|internal_items)/);
});

test('remote reset pauses synchronization, blocks pending requests, and preserves operator links', () => {
  assert.match(bridge, /async function resetOperationalData\(resetLocal\)/);
  assert.match(bridge, /if \(!config\) \{ start\(\); throw new Error/);
  assert.match(bridge, /remote_requests\?status=in\.\(PENDING,PROCESSING\)/);
  assert.match(bridge, /remote_requests\?id=not\.is\.null/);
  assert.match(bridge, /remote_state\?auth_user_id=not\.is\.null/);
  assert.match(bridge, /remote_operator_links\?active=eq\.true/);
  assert.match(bridge, /publishSnapshots\(config, links\)/);
  assert.match(restaurant, /resetRemoteOperationalData:callback=>remoteBridge\.resetOperationalData\(callback\)/);
  assert.match(restaurant, /if\(isOperationalResetting\(\)\)return send\(res,503/);
  assert.match(restaurant, /if\(isOperationalResetting\(\)\)throw err\('A limpeza de dados está em andamento/);
});

test('reset action is exposed to the administrator but is not run on startup', () => {
  assert.match(preload, /operational:\{reset:confirmation=>call\('operational:reset',confirmation\)\}/);
  assert.match(ui, /function OperationalResetPanel/);
  assert.match(ui, /<OperationalResetPanel notify=\{notify\}\/>/);
  assert.match(ui, /Saldos de clientes serão zerados/);
});
