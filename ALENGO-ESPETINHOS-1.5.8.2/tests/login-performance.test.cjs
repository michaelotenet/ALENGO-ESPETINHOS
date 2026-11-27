const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('Windows login fields do not trigger React state updates for each typed character', () => {
  const source = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8');
  const start = source.indexOf('function Login({onLogin})');
  const end = source.indexOf('function App()', start);
  assert.ok(start >= 0 && end > start, 'Login component exists');
  const login = source.slice(start, end);
  assert.match(login, /usernameRef=useRef\(null\)/);
  assert.match(login, /passwordRef=useRef\(null\)/);
  assert.match(login, /ref={usernameRef}/);
  assert.match(login, /ref={passwordRef}/);
  assert.doesNotMatch(login, /setU\(|setP\(|onChange=/);
  assert.match(login, /window\.api\.auth\.login\(\{username,password\}\)/);
});

test('remote bridge decrypts DPAPI key asynchronously and never blocks Electron with execFileSync', () => {
  const source = fs.readFileSync(path.join(root, 'electron/remote-bridge.js'), 'utf8');
  assert.match(source, /const \{ execFile \} = require\('node:child_process'\)/);
  assert.match(source, /await execFileAsync\('powershell\.exe'/);
  assert.match(source, /async function readConfig\(/);
  assert.match(source, /const config = await readConfig\(\)/);
  assert.doesNotMatch(source, /execFileSync/);
});
