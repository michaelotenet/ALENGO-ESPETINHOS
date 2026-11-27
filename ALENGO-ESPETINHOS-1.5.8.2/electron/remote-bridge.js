'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { createVapidKeys, sendWebPush, isAllowedPushEndpoint } = require('./web-push');

function createRemoteBridge({ db, app, callbacks, safeStorage, log = console }) {
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
    );
    CREATE TABLE IF NOT EXISTS restaurant_push_subscriptions (
      auth_user_id TEXT NOT NULL, operator_id INTEGER NOT NULL, endpoint TEXT NOT NULL,
      subscription_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(auth_user_id,endpoint)
    );
    CREATE INDEX IF NOT EXISTS restaurant_push_subscriptions_operator_idx ON restaurant_push_subscriptions(operator_id);
    CREATE TABLE IF NOT EXISTS restaurant_push_sent (
      auth_user_id TEXT NOT NULL, event_key TEXT NOT NULL, endpoint TEXT NOT NULL,
      sent_at TEXT NOT NULL, PRIMARY KEY(auth_user_id,event_key,endpoint)
    );
    CREATE TABLE IF NOT EXISTS restaurant_push_cursors (
      auth_user_id TEXT PRIMARY KEY, last_notification_id INTEGER NOT NULL DEFAULT 0
    );`);
  }

  function getPushKeys(){
    try{
      const publicKey=db.prepare("SELECT value FROM settings WHERE key='webpush_public_key'").get()?.value||'';
      const encrypted=db.prepare("SELECT value FROM settings WHERE key='webpush_private_key_enc'").get()?.value||'';
      if(publicKey&&!encrypted){db.prepare('DELETE FROM restaurant_push_subscriptions').run();db.prepare('DELETE FROM restaurant_push_sent').run();db.prepare('DELETE FROM restaurant_push_cursors').run();}
      if(publicKey&&encrypted&&safeStorage?.isEncryptionAvailable?.()){
        try{return {publicKey,privateKey:safeStorage.decryptString(Buffer.from(encrypted,'base64'))};}
        catch(error){log.warn('[ALENGO PUSH] A chave protegida não pôde ser recuperada neste Windows. Será criada uma nova inscrição:',error.message);db.prepare('DELETE FROM restaurant_push_subscriptions').run();db.prepare('DELETE FROM restaurant_push_sent').run();db.prepare('DELETE FROM restaurant_push_cursors').run();}
      }
      if(!safeStorage?.isEncryptionAvailable?.())return null;
      const pair=createVapidKeys();
      const put=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
      put.run('webpush_public_key',pair.publicKey);
      put.run('webpush_private_key_enc',safeStorage.encryptString(pair.privateKey).toString('base64'));
      return pair;
    }catch(error){log.warn('[ALENGO PUSH] Não foi possível preparar as chaves protegidas:',error.message);return null;}
  }

  async function pushNewNotifications(authUserId,snapshot,keys){
    if(!keys||!Array.isArray(snapshot?.notifications))return;
    const subs=db.prepare('SELECT endpoint,subscription_json FROM restaurant_push_subscriptions WHERE auth_user_id=?').all(authUserId);
    const maxId=Math.max(0,...snapshot.notifications.map(n=>Number(n.id)||0));
    const cursor=db.prepare('SELECT last_notification_id FROM restaurant_push_cursors WHERE auth_user_id=?').get(authUserId);
    if(!cursor){db.prepare('INSERT OR REPLACE INTO restaurant_push_cursors(auth_user_id,last_notification_id) VALUES(?,?)').run(authUserId,maxId);return;}
    if(!subs.length){if(maxId>Number(cursor.last_notification_id||0))db.prepare('UPDATE restaurant_push_cursors SET last_notification_id=? WHERE auth_user_id=?').run(maxId,authUserId);return;}
    const fresh=snapshot.notifications.filter(n=>Number(n.id)>Number(cursor.last_notification_id||0)&&!n.read_at).sort((a,b)=>Number(a.id)-Number(b.id));
    let failed=false;
    for(const item of fresh){
      for(const row of subs){
        const prior=db.prepare('SELECT 1 FROM restaurant_push_sent WHERE auth_user_id=? AND event_key=? AND endpoint=?').get(authUserId,String(item.event_key||item.id),row.endpoint);if(prior)continue;
        try{const result=await sendWebPush(JSON.parse(row.subscription_json),{title:item.title||'ALENGO ESPETINHOS',body:item.message||'Há uma atualização no atendimento.',tag:String(item.event_key||item.id),eventKey:String(item.event_key||item.id),url:'./?mode=remote',requireInteraction:/ORDER_READY|HELP_REQUEST/.test(String(item.kind||'')),vibrate:/ORDER_READY/.test(String(item.kind||''))?[150,60,150]:[70,40,70]},keys);if(result.expired){db.prepare('DELETE FROM restaurant_push_subscriptions WHERE auth_user_id=? AND endpoint=?').run(authUserId,row.endpoint);continue;}db.prepare('INSERT OR IGNORE INTO restaurant_push_sent(auth_user_id,event_key,endpoint,sent_at) VALUES(?,?,?,?)').run(authUserId,String(item.event_key||item.id),row.endpoint,new Date().toISOString());}
        catch(error){failed=true;log.warn('[ALENGO PUSH] Falha no envio:',error.message);}
      }
    }
    if(!failed&&maxId>Number(cursor.last_notification_id||0))db.prepare('UPDATE restaurant_push_cursors SET last_notification_id=? WHERE auth_user_id=?').run(maxId,authUserId);
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
      let result;
      if(item.request_type==='REGISTER_PUSH'){
        const subscription=item.payload?.subscription||{},endpoint=String(subscription.endpoint||'');
        if(!isAllowedPushEndpoint(endpoint)||String(subscription.keys?.p256dh||'').length>200||String(subscription.keys?.auth||'').length>200||!subscription.keys?.p256dh||!subscription.keys?.auth||JSON.stringify(subscription).length>5000)throw new Error('Inscrição Push inválida ou endpoint não reconhecido.');
        db.prepare(`INSERT INTO restaurant_push_subscriptions(auth_user_id,operator_id,endpoint,subscription_json,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(auth_user_id,endpoint) DO UPDATE SET operator_id=excluded.operator_id,subscription_json=excluded.subscription_json,updated_at=excluded.updated_at`).run(String(item.auth_user_id),actor.id,endpoint,JSON.stringify(subscription),new Date().toISOString(),new Date().toISOString());
        result={ok:true,registered:true};
      }else if(item.request_type==='UNREGISTER_PUSH'){
        const endpoint=String(item.payload?.endpoint||'');db.prepare('DELETE FROM restaurant_push_subscriptions WHERE auth_user_id=? AND endpoint=?').run(String(item.auth_user_id),endpoint);result={ok:true,removed:true};
      }else result=await callbacks.processRequest(item, actor);
      await request(config, `remote_requests?id=eq.${encodeURIComponent(item.id)}`, 'PATCH', { status: 'CONFIRMED', response: result, processed_at: new Date().toISOString(), locked_at: null }, 'return=minimal');
    } catch (error) {
      const response = { error: String(error.message || error), code: error.code || 'REMOTE_PROCESSING' };
      await request(config, `remote_requests?id=eq.${encodeURIComponent(item.id)}`, 'PATCH', { status: 'ERROR', response, processed_at: new Date().toISOString(), locked_at: null }, 'return=minimal');
    }
  }

  async function publishSnapshots(config, links) {
    const rows = [];
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'alengo-remote-operators.json'), JSON.stringify(db.prepare('SELECT id,name,role,active FROM operators ORDER BY name').all(), null, 2), { mode: 0o600 }); } catch {}
    const pushKeys=getPushKeys();
    for (const [authUserId, mapping] of links) {
      const operator = db.prepare('SELECT id,name,role,active,permissions_json FROM operators WHERE id=?').get(Number(mapping.operator_id));
      if (!operator || !operator.active || operator.role === 'admin') continue;
      const snapshot=callbacks.getSnapshot(operator);snapshot.push_public_key=pushKeys?.publicKey||'';
      rows.push({auth_user_id:authUserId,operator_id:operator.id,payload:snapshot,updated_at:new Date().toISOString()});
      try{await pushNewNotifications(authUserId,snapshot,pushKeys);}catch(error){log.warn('[ALENGO PUSH] Não foi possível processar notificações:',error.message);}
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

  async function resetOperationalData(resetLocal) {
    stop();
    const deadline = Date.now() + 15000;
    while (running && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    if (running) { start(); throw new Error('A sincronização remota ainda está em andamento. Aguarde alguns segundos e tente novamente.'); }
    const linkedLocally = Number(db.prepare("SELECT COUNT(*) n FROM operators WHERE COALESCE(remote_auth_user_id,'')<>'' OR remote_enabled=1").get()?.n || 0);
    const config = await readConfig();
    if (!config) { start(); throw new Error(linkedLocally?'Existem operadores vinculados ao acesso remoto, mas a conexão Supabase não está disponível. Configure a conexão antes de limpar os dados.':'A limpeza segura exige a conexão Supabase ativa para invalidar filas e snapshots remotos. Configure a conexão antes de limpar os dados.'); }
    let links = [];
    try {
      if (config) {
        const linksData = await request(config, 'remote_operator_links?active=eq.true&select=auth_user_id,operator_id');
        links = new Map((linksData || []).map(x => [String(x.auth_user_id), x]));
        const pending = await request(config, 'remote_requests?status=in.(PENDING,PROCESSING)&select=id,status,request_type&limit=200');
        if (Array.isArray(pending) && pending.length) throw new Error(`Há ${pending.length} solicitação(ões) remota(s) pendente(s) ou em processamento. Aguarde a sincronização antes de limpar os dados.`);
        await request(config, 'remote_requests?id=not.is.null', 'DELETE', undefined, 'return=minimal');
        await request(config, 'remote_state?auth_user_id=not.is.null', 'DELETE', undefined, 'return=minimal');
      }
    } catch (error) {
      start();
      throw error;
    }
    try {
      const result = await resetLocal();
      let remoteSyncPending = false;
      if (config) {
        try { await publishSnapshots(config, links); }
        catch (error) { remoteSyncPending = true; lastConfigError = error.message; log.warn('[ALENGO REMOTO] Limpeza local concluída; publicação dos novos snapshots será repetida:', error.message); }
      }
      return { result, remoteSyncPending };
    } catch (error) {
      if (config) { try { await publishSnapshots(config, links); } catch (restoreError) { log.error('[ALENGO REMOTO] Não foi possível republicar snapshots após falha na limpeza:', restoreError.message); } }
      throw error;
    } finally { start(); }
  }

  function start() {
    if (timer) return;
    ensureLocalSchema();
    timer = setInterval(cycle, 3000);
    timer.unref?.();
    setTimeout(cycle, 1500).unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { start, stop, configPath, syncOperator, resetOperationalData, getStatus: () => ({ configured: configEnabled, configPath, error: lastConfigError }) };
}

module.exports = { createRemoteBridge };
