const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');

test('Painel de Operações é opcional e preserva sidebar como padrão', () => {
  assert.match(main, /ux_home_layout:'sidebar'/);
  assert.match(ui, /value="sidebar">Interface atual — menu lateral/);
  assert.match(ui, /value="operations">Painel de Operações — cartões por categoria/);
  assert.match(ui, /OperationsDashboard items=\{visibleNav\}/);
  assert.match(ui, /operations-home-mode/);
});

test('cartões usam acentos alternados sem substituir as cores do tema', () => {
  for (let i = 0; i < 6; i++) assert.match(css, new RegExp(`operations-tone-${i}`));
  assert.match(css, /background:var\(--panel\)/);
  assert.match(css, /color:var\(--text\)/);
});

test('janela Sobre não exibe menu e usa texto de rodapé solicitado', () => {
  assert.match(main, /w\.setMenu\(null\)/);
  assert.match(main, /w\.setMenuBarVisibility\(false\)/);
  assert.match(main, /Uni-Softwares 2026/);
  assert.doesNotMatch(main, /Desenvolvido em 2026/);
  assert.match(main, /themeColors\[activeTheme\]/);
});
