const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const restaurant = fs.readFileSync(path.join(root, 'electron/restaurant.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
for (const file of ['cloudflare-pages/app.js','mobile-web/app.js']) {
  const app = fs.readFileSync(path.join(root, file), 'utf8');
  test(`${file} saves drafts, supports repeat orders and calls the Windows responsible operator`, () => {
    assert.match(app, /persistCartDraft/);
    assert.match(app, /restoreCartDraft/);
    assert.match(app, /alengo-cart-draft-v1/);
    assert.match(app, /data-action=\\?"repeat-order/);
    assert.match(app, /data-action=\\?"call-responsible/);
    assert.match(app, /remoteCommand\('CALL_RESPONSIBLE'/);
    assert.match(app, /resume-cart/);
  });
  test(`${file} provides category filters and popular products`, () => {
    assert.match(app, /categorystrip/);
    assert.match(app, /category-filter/);
    assert.match(app, /Mais pedidos · últimos 30 dias/);
  });
}
test('Windows catalog supplies categories and best sellers from recent sales', () => {
  assert.match(restaurant, /const categories=db\.prepare\('SELECT id,name,icon FROM categories/);
  assert.match(restaurant, /datetime\('now','-30 days'\)/);
  assert.match(restaurant, /return \{products,kits,categories,popular\}/);
});
test('responsible-call requests create a Windows notification in both local and remote modes', () => {
  assert.match(restaurant, /request_type==='CALL_RESPONSIBLE'/);
  assert.match(restaurant, /path==='\/web\/call-responsible'/);
  assert.match(restaurant, /kind:'HELP_REQUEST'/);
  assert.match(main, /n\.kind==='HELP_REQUEST'\?'warning'/);
});
