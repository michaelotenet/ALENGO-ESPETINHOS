'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

function createRemoteBridge({ db, app, callbacks, log = console }) {
  const configPath = path.join(app.getPath('userData'), 'alengo-remote.json');
  let timer = null;
  let running = false;
  let lastSnapshotAt = 0;
  let lastConfigError = '';
  let cachedConfig = null;
  let cachedConfigMtime = -1;
  let configEnabled = false;
  let configLoadPromise = null;

  async function readConfig() {
    if (configLoadPromise) return configLoadPromise;
    configLoadPromise = (async () => {
    try {
      const stat = await fs.promises.stat(configPath);
      if (cachedConfig && cachedConfigMtime === stat.mtimeMs) return cachedConfig;
      const raw = JSON.parse(await fs.promises.readFile(configPath, 'utf8'));
      if (!raw.enabled) { cachedConfig = null; cachedConfigMtime = stat.mtimeMs; configEnabled = false; return null; }
      const projectUrl = String(raw.projectUrl || '').replace(/\/$/, '');
      let secretKey = String(raw.secretKey || '');
      if (!secretKey && raw.secretKeyProtected) {
        const encrypted = String(raw.secretKeyProtected).replace(/'/g, "''");
        const ps = `$s=ConvertTo-SecureString '${encrypted}';$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}`;
        const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 });
        secretKey = String(result.stdout || '').trim();
      }
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(projectUrl)) throw new Error('Project URL inválida em alengo-remote.json.');
      if (!secretKey.startsWith('sb_secret_')) throw new Error('Configure a Secret Key sb_secret_ pelo script CONFIGURAR-ALENGO-REMOTO.ps1.');
      cachedConfig = { projectUrl, secretKey, pollIntervalMs: Math.max(2000, Math.min(15000, Number(raw.pollIntervalMs) || 3000)), snapshotIntervalMs: Math.max(5000, Math.min(60000, Number(raw.snapshotIntervalMs) || 10000)) };
      cachedConfigMtime = stat.mtimeMs;
      configEnabled = true;
      return cachedConfig;
    } catch (error) {
      if (error.code === 'ENOENT') { configEnabled = false; cachedConfig = null; return null; }
      configEnabled = false;
      cachedConfig = null;
      lastConfigError = error.message;
      log.error('[ALENGO REMOTO]', error.message);
      return null;
    }
    })();
    try { return await configLoadPromise; }
    finally { configLoadPromise = null; }
  }

  async function request(config, endpoint, method = 'GET', body = undefined, prefer = '') {
    const headers = { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(`${config.projectUrl}/rest/v1/${endpoint}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000) });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${data?.message || data?.hint || text || response.statusText}`);
    return data;
  }

  function ensureLocalSchema() {
    db.exec(`CREATE TABLE IF NOT EXISTS restaurant_remote_processed (
      request_id TEXT PRIMARY KEY, response_json TEXT NOT NULL, processed_at TEXT NOT NULL
    );`);
  }

  async function processOne(config, item, links) {
    const mapping = links.get(String(item.auth_user_id));
    if (!mapping) {
      await request(config, `remote_requests?id=eq.${encodeURIComponent(item.id)}`, 'PATCH', { status: 'ERROR', response: { error: 'Atendente sem vínculo ativo com um operador do Windows.' }, processed_at: new Date().toISOString(), locked_at: null }, 'return=minimal');
      return;
    }
    const actor = db.prepare('SELECT id,name,role,active,permissions_json FROM operators WHERE id=?').get(Number(mapping.operator_id));
    if(actor){try{actor.permissions=JSON.parse(actor.permissions_json||'{}')}catch{actor.permissions={}}}
    if (!actor || !actor.active || actor.role === 'admin') {
      await request(config, `remote_requests?id=eq.${encodeURIComponent(item.id)}`, 'PATCH', { status: 'ERROR', response: { error: 'Operador inexistente, inativo ou sem permissão para atendimento remoto.' }, processed_at: new Date().toISOString(), locked_at: null }, 'return=minimal');
      return;
    }
    const prior = db.prepare('SELECT response_json FROM restaurant_remote_processed WHERE request_id=?').get(item.id);
    if (prior) {
      await request(config, `remote_requests?id=eq.${encodeURIComponent(item.id)}`, 'PATCH', { status: 'CONFIRMED', response: JSON.parse(prior.response_json), processed_at: new Date().toISOString(), locked_at: null }, 'return=minimal');
      return;
    }
    try {
      const result = await callbacks.processRequest(item, actor);
      await request(config, `remote_requests?id=eq.${encodeURIComponent(item.id)}`, 'PATCH', { status: 'CONFIRMED', response: result, processed_at: new Date().toISOString(), locked_at: null }, 'return=minimal');
    } catch (error) {
      const response = { error: String(error.message || error), code: error.code || 'REMOTE_PROCESSING' };
      await request(config, `remote_requests?id=eq.${encodeURIComponent(item.id)}`, 'PATCH', { status: 'ERROR', response, processed_at: new Date().toISOString(), locked_at: null }, 'return=minimal');
    }
  }

  async function publishSnapshots(config, links) {
    const rows = [];
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'alengo-remote-operators.json'), JSON.stringify(db.prepare('SELECT id,name,role,active FROM operators ORDER BY name').all(), null, 2), { mode: 0o600 }); } catch {}
    for (const [authUserId, mapping] of links) {
      const operator = db.prepare('SELECT id,name,role,active,permissions_json FROM operators WHERE id=?').get(Number(mapping.operator_id));
      if (!operator || !operator.active || operator.role === 'admin') continue;
      rows.push({
        auth_user_id: authUserId,
        operator_id: operator.id,
        payload: callbacks.getSnapshot(operator),
        updated_at: new Date().toISOString()
      });
    }
    if (rows.length) await request(config, 'remote_state?on_conflict=auth_user_id', 'POST', rows, 'resolution=merge-duplicates,return=minimal');
    const existing = await request(config, 'remote_state?select=auth_user_id');
    const allowed = new Set(rows.map(x => String(x.auth_user_id)));
    for (const row of existing || []) if (!allowed.has(String(row.auth_user_id))) await request(config, `remote_state?auth_user_id=eq.${encodeURIComponent(row.auth_user_id)}`, 'DELETE');
  }


  function usernameEmail(name) {
    const normalized = String(name || '').trim().toLocaleLowerCase('pt-BR');
    const digest = require('node:crypto').createHash('sha256').update(normalized).digest('hex').slice(0, 32);
    return `op-${digest}@alengo.invalid`;
  }

  async function authAdmin(config, method, endpoint, body) {
    const response = await fetch(`${config.projectUrl}/auth/v1/admin/${endpoint}`, {
      method,
      headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    const raw = await response.text();
    let data = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    if (!response.ok) throw new Error(`Supabase Auth ${response.status}: ${data?.msg || data?.message || data?.error_description || raw || response.statusText}`);
    return data;
  }

  async function syncOperator(operator, password = '', enabled = true) {
    const config = await readConfig();
    if (!config) throw new Error('Configure a conexão remota do ALENGO no Windows antes de habilitar operadores remotos.');
    const current = db.prepare('SELECT id,name,role,active,remote_auth_user_id FROM operators WHERE id=?').get(Number(operator.id));
    if (!current) throw new Error('Operador não encontrado para sincronização remota.');
    if (!enabled || !current.active || current.role === 'admin') {
      if (current.remote_auth_user_id) {
        await authAdmin(config, 'PUT', `users/${encodeURIComponent(current.remote_auth_user_id)}`, { email: `disabled-${current.id}-${Date.now()}@alengo.invalid`, email_confirm: true, ban_duration: '876000h' });
        await request(config, `remote_operator_links?auth_user_id=eq.${encodeURIComponent(current.remote_auth_user_id)}`, 'PATCH', { active: false }, 'return=minimal');
      }
      return { enabled: false };
    }
    const email = usernameEmail(current.name);
    let authId = current.remote_auth_user_id || '';
    if (authId) {
      const patch = { email, email_confirm: true, user_metadata: { alengo_operator_id: current.id, alengo_operator_name: current.name } };
      if (password) patch.password = password;
      patch.ban_duration = 'none';
      await authAdmin(config, 'PUT', `users/${encodeURIComponent(authId)}`, patch);
    } else {
      if (!password || password.length < 6) throw new Error('Para habilitar o acesso remoto, informe uma senha com pelo menos 6 caracteres.');
      const created = await authAdmin(config, 'POST', 'users', { email, password, email_confirm: true, user_metadata: { alengo_operator_id: current.id, alengo_operator_name: current.name } });
      authId = String(created?.id || created?.user?.id || '');
      if (!authId) throw new Error('Supabase não retornou o identificador do operador remoto.');
      db.prepare('UPDATE operators SET remote_auth_user_id=? WHERE id=?').run(authId, current.id);
    }
    await request(config, 'remote_operator_links?on_conflict=auth_user_id', 'POST', {
      auth_user_id: authId, operator_id: current.id, active: true
    }, 'resolution=merge-duplicates,return=minimal');
    return { enabled: true, auth_user_id: authId };
  }

  async function cycle() {
    if (running) return;
    const config = await readConfig();
    if (!config) return;
    running = true;
    try {
      const linksData = await request(config, 'remote_operator_links?active=eq.true&select=auth_user_id,operator_id');
      const links = new Map((linksData || []).map(x => [String(x.auth_user_id), x]));
      const pending = await request(config, 'remote_requests?status=in.(PENDING,PROCESSING)&select=id,auth_user_id,request_type,payload,request_key,status,locked_at&order=created_at.asc&limit=30');
      const now = Date.now();
      for (const item of pending || []) {
        const stale = item.status === 'PROCESSING' && (!item.locked_at || now - Date.parse(item.locked_at) > 120000);
        if (item.status !== 'PENDING' && !stale) continue;
        const claimFilter = item.status === 'PENDING'
          ? `remote_requests?id=eq.${encodeURIComponent(item.id)}&status=eq.PENDING`
          : `remote_requests?id=eq.${encodeURIComponent(item.id)}&status=eq.PROCESSING&or=(locked_at.is.null,locked_at.lt.${encodeURIComponent(new Date(now - 120000).toISOString())})`;
        const claimed = await request(config, claimFilter, 'PATCH', { status: 'PROCESSING', locked_at: new Date().toISOString() }, 'return=representation');
        if (!Array.isArray(claimed) || !claimed.length) continue;
        await processOne(config, item, links);
      }
      if (now - lastSnapshotAt >= config.snapshotIntervalMs) {
        await publishSnapshots(config, links);
        lastSnapshotAt = now;
      }
      lastConfigError = '';
    } catch (error) {
      log.warn('[ALENGO REMOTO] Sincronização temporariamente indisponível:', error.message);
    } finally { running = false; }
  }

  function start() {
    if (timer) return;
    ensureLocalSchema();
    timer = setInterval(cycle, 3000);
    timer.unref?.();
    setTimeout(cycle, 1500).unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { start, stop, configPath, syncOperator, getStatus: () => ({ configured: configEnabled, configPath, error: lastConfigError }) };
}

module.exports = { createRemoteBridge };
