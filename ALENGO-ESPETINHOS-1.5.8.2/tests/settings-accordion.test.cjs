const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = fs.readFileSync(path.join(__dirname, '..', 'src/main.jsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src/style.css'), 'utf8');
test('Windows settings are organized into expandable sections', () => {
  assert.match(ui, /className="settings-accordion"/);
  for (const label of ['Empresa e operação','Módulos disponíveis','Caixa e fundo de troco','Interface e facilidade de uso','Impressoras','Operadores','Balança','Limpeza de dados de teste','Identidade visual']) assert.ok(ui.includes(`<summary>${label}</summary>`), `missing ${label}`);
  assert.match(css, /\.settings-accordion\[open\]>summary/);
});
