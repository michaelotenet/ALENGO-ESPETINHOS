const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8');

test('activity history stores operator identity and backfills older entries safely', () => {
  assert.match(main, /addColumn\('activity_log','operator_id','INTEGER'\)/);
  assert.match(main, /UPDATE activity_log SET operator_id=\(SELECT id FROM operators/);
  assert.match(main, /INSERT INTO activity_log\([^)]*operator_id\) VALUES\([^)]*\)/);
  assert.match(main, /SELECT id FROM operators WHERE lower\(name\)=lower\(\?\)/);
});

test('activity history enforces operator scope in the Windows IPC handler', () => {
  const handler = main.slice(main.indexOf("ipcMain.handle('activity:list'"), main.indexOf("ipcMain.handle('settings:get'"));
  assert.match(handler, /const actor=requireLogin\(\)/);
  assert.match(handler, /actor\.role!=='admin'/);
  assert.match(handler, /operator_id=\?/);
  assert.match(handler, /opts\?\.operator_id/);
});

test('activity history supports local daily, weekly and monthly date ranges', () => {
  const handler = main.slice(main.indexOf("ipcMain.handle('activity:list'"), main.indexOf("ipcMain.handle('settings:get'"));
  assert.match(handler, /\['weekly','monthly'\]/);
  assert.match(handler, /start\.setDate\(start\.getDate\(\)-weekday\)/);
  assert.match(handler, /start\.toISOString\(\)/);
  assert.match(ui, /setMode\('weekly'\)/);
  assert.match(ui, /localDate=\(\)=>/);
});

test('operators can open only their own activity history and administrators can filter operators', () => {
  assert.match(ui, /'atividades'\]\)/);
  assert.match(ui, /isAdmin&&<select value=\{operatorId\}/);
  assert.match(ui, /window\.api\.operators\.list\(\)/);
  assert.match(ui, /window\.api\.activity\.list\(\{mode,date,month,group,operator_id:operatorId/);
});

test('activity history supports CSV export', () => {
  assert.match(ui, /Exportar CSV/);
  assert.match(ui, /Exportar Excel/);
  assert.match(ui, /alengo-atividades-/);
  assert.match(ui, /text\/csv;charset=utf-8/);
  assert.match(ui, /\^\[\\s\]\*\[=\+@-\]/);
});

test('activity history exports XLSX using the existing workbook writer and enforces operator scope', () => {
  assert.match(main, /ipcMain\.handle\('activity:operators'/);
  assert.match(main, /SELECT id,name,role,active FROM operators ORDER BY name/);
  assert.match(main, /ipcMain\.handle\('activity:export'/);
  assert.match(main, /makeXlsx\(\[\{name:'Atividades'/);
  assert.match(main, /actor\.role!=='admin'/);
  assert.match(main, /dialog\.showSaveDialog\(\{title:'Exportar histórico de atividades para Excel'/);
  assert.match(ui, /window\.api\.activity\.export/);
});
