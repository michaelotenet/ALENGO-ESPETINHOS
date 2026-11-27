const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
const restaurant = fs.readFileSync(path.join(root, 'electron/restaurant.js'), 'utf8');
const web = fs.readFileSync(path.join(root, 'cloudflare-pages/app.js'), 'utf8');

test('Windows database initializes an operational generation marker', () => {
  assert.match(main, /operational_generation:'1'/);
});

test('remote snapshots publish the active operational generation', () => {
  assert.match(restaurant, /operational_generation:Number\(get\('operational_generation'\)\|\|1\)/);
});

test('Windows rejects remote requests created under an older operational generation', () => {
  const start = restaurant.indexOf('async processRequest(item,operator)');
  const end = restaurant.indexOf('const prior=db.prepare', start);
  const handler = restaurant.slice(start, end);
  assert.match(handler, /payload\._operational_generation/);
  assert.match(handler, /requestGeneration!==currentGeneration/);
  assert.match(handler, /STALE_OPERATION/);
});

test('new remote web queue items capture the generation from the latest Windows snapshot', () => {
  assert.match(web, /state\.remoteSnapshot\?\.operational_generation\|\|1/);
  assert.match(web, /_operational_generation:generation/);
});
