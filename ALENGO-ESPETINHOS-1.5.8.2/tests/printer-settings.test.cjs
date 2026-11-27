const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8');
const restaurantUi = fs.readFileSync(path.join(root, 'src/restaurant.jsx'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');

test('printer configuration is available in Windows settings', () => {
  assert.match(ui, /function PrinterSettingsPanel/);
  assert.match(ui, /<PrinterSettingsPanel notify=\{notify\}\/>/);
  assert.match(ui, /Impressora de comandas — cozinha\/churrasqueira/);
  assert.match(ui, /Impressora de comprovantes — caixa/);
});

test('printer choices remain distinct and refresh from the Windows printer list', () => {
  assert.match(ui, /value===other/);
  assert.match(ui, /disabled=\{p\.name===config\?\.receipt_printer\}/);
  assert.match(ui, /disabled=\{p\.name===config\?\.printer\}/);
  assert.match(ui, /window\.api\.restaurant\.printers\(\)/);
  assert.match(preload, /setPrinter:x=>call\('restaurant:printer-set',x\)/);
  assert.match(preload, /setReceiptPrinter:x=>call\('restaurant:receipt-printer-set',x\)/);
});

test('mobile integration panel no longer duplicates printer configuration', () => {
  assert.doesNotMatch(restaurantUi, /alengo-printer-config/);
  assert.match(restaurantUi, /Integração com celulares/);
});
