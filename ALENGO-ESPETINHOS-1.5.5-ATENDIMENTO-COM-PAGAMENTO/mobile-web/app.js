'use strict';
/* ALENGO ESPETINHOS Web — cliente web local, compatível com o contrato REST do app móvel 1.3.4. */
(() => {
  const STORE_KEY = 'alengo-web-session-v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const view = $('#view');
  const state = {
    token: '', user: '', operator: '', deviceId: '', password: '',
    screen: 'login', booting: true, busy: false, connection: '',
    tables: [], catalog: { products: [], kits: [] }, customers: [], myOrders: [], alerts: [], notifications: [], notifiedIds: new Set(),
    orderType: null, table: null, customer: '', customerId: null, search: '', cart: [],
    pendingKey: null, cancelTarget: null, cancelReason: '', alertIds: new Set(),
    serverOrigin: location.origin, mode: ((window.ALENGO_SUPABASE_CONFIG?.remoteOnly || new URLSearchParams(location.search).get('mode') === 'remote') ? 'remote' : 'local'),
    remoteUid: '', remoteRefreshToken: '', remoteExpiresAt: 0, remoteSnapshot: null, remoteOrderPending: false, operatorPermissions:{}, cashOpen:false, paymentTableId:null, paymentMethod:'PIX', paymentFee:'0', paymentInstallments:'1', paymentPrint:true, paymentPendingKey:null, paymentLines:[{method:'PIX',amount:''}]
  };
  const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const normalizeIp = value => String(value || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:[0-9]+$/, '');
  const deviceKey = () => 'web_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const orderKey = () => 'pedido_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  const paymentStorageKey = tableId => `alengo-pending-table-payment-v1:${state.remoteUid||state.operator}:${tableId}`;
  const currentAddress = () => `${location.hostname}${location.port ? ':' + location.port : ''}`;
  let notificationAudioContext = null;
  function playNotificationSound(){try{const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;notificationAudioContext=notificationAudioContext||new Ctx();if(notificationAudioContext.state==='suspended')return;const now=notificationAudioContext.currentTime;for(const [freq,start] of [[880,0],[1175,.13]]){const osc=notificationAudioContext.createOscillator(),gain=notificationAudioContext.createGain();osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(.0001,now+start);gain.gain.exponentialRampToValueAtTime(.12,now+start+.02);gain.gain.exponentialRampToValueAtTime(.0001,now+start+.18);osc.connect(gain);gain.connect(notificationAudioContext.destination);osc.start(now+start);osc.stop(now+start+.2);}}catch{}}
  const notify = (message, duration = 3800) => {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.add('hidden'), duration);
  };
  const saveSession = () => {
    const saved = { serverOrigin: location.origin, user: state.user, operator: state.operator, token: state.token, deviceId: state.deviceId, mode: state.mode, remoteUid: state.remoteUid, remoteRefreshToken: state.remoteRefreshToken, remoteExpiresAt: state.remoteExpiresAt }; 
    try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); }
    catch { notify('Não foi possível salvar a sessão neste navegador.'); }
  };
  const clearSession = () => { try { localStorage.removeItem(STORE_KEY); } catch {} };

  const remoteConfig = window.ALENGO_SUPABASE_CONFIG || {};
  const REMOTE_QUEUE_DB = 'alengo-remote-queue-v1';
  const REMOTE_QUEUE_STORE = 'requests';
  let remoteFlushing = false;
  const remoteApiUrl = (path) => `${String(remoteConfig.projectUrl || '').replace(/\/$/, '')}${path}`;
  function openRemoteQueue() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(REMOTE_QUEUE_DB, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(REMOTE_QUEUE_STORE)) request.result.createObjectStore(REMOTE_QUEUE_STORE, { keyPath: 'id' }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir a fila offline.'));
    });
  }
  async function queueRemoteGetAll() {
    const db = await openRemoteQueue();
    return new Promise((resolve, reject) => { const tx = db.transaction(REMOTE_QUEUE_STORE, 'readonly'); const req = tx.objectStore(REMOTE_QUEUE_STORE).getAll(); req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error); tx.oncomplete = () => db.close(); });
  }
  async function queueRemotePut(item) {
    const db = await openRemoteQueue();
    return new Promise((resolve, reject) => { const tx = db.transaction(REMOTE_QUEUE_STORE, 'readwrite'); tx.objectStore(REMOTE_QUEUE_STORE).put(item); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; });
  }
  async function queueRemoteDelete(id) {
    const db = await openRemoteQueue();
    return new Promise((resolve, reject) => { const tx = db.transaction(REMOTE_QUEUE_STORE, 'readwrite'); tx.objectStore(REMOTE_QUEUE_STORE).delete(id); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; });
  }
  async function supabaseFetch(path, method = 'GET', body = undefined, token = state.token) {
    const headers = { apikey: remoteConfig.publishableKey, Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(remoteApiUrl(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    const raw = await response.text(); let data = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    if (!response.ok) { const error = new Error(data?.msg || data?.message || data?.error_description || data?.error || 'Falha na comunicação remota.'); error.status = response.status; throw error; }
    return data;
  }
  async function remoteUsernameEmail(username) {
    const normalized = String(username || '').trim().toLocaleLowerCase('pt-BR');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    return `op-${hex}@alengo.invalid`;
  }
  async function remoteLogin(username, password) {
    if (!remoteConfig.remoteEnabled || !remoteConfig.projectUrl || !remoteConfig.publishableKey) throw new Error('Acesso remoto ainda não foi configurado.');
    const internalAuthEmail = await remoteUsernameEmail(username);
    const session = await supabaseFetch('/auth/v1/token?grant_type=password', 'POST', { email: internalAuthEmail, password }, '');
    state.token = session.access_token; state.remoteRefreshToken = session.refresh_token; state.remoteUid = session.user?.id || ''; state.remoteExpiresAt = Date.now() + Number(session.expires_in || 3600) * 1000;
    state.user = String(username || '').trim(); state.operator = state.user; state.deviceId = '';
    try { await refreshRemote(); } catch (error) { state.token = ''; state.remoteRefreshToken = ''; state.remoteUid = ''; state.remoteExpiresAt = 0; throw error; }
    state.operator = state.remoteSnapshot?.operator?.name || String(username || '').trim();
    state.screen = 'home'; state.connection = '';
    saveSession();
    await flushRemoteQueue();
  }
  async function refreshRemoteToken() {
    if (!state.remoteRefreshToken) throw new Error('Sessão remota expirada. Entre novamente.');
    const session = await supabaseFetch('/auth/v1/token?grant_type=refresh_token', 'POST', { refresh_token: state.remoteRefreshToken }, '');
    state.token = session.access_token; state.remoteRefreshToken = session.refresh_token; state.remoteUid = session.user?.id || state.remoteUid; state.remoteExpiresAt = Date.now() + Number(session.expires_in || 3600) * 1000; saveSession();
  }
  async function remoteEnsureSession() {
    if (state.remoteExpiresAt && Date.now() > state.remoteExpiresAt - 60000) await refreshRemoteToken();
  }
  async function refreshRemote() {
    if (!navigator.onLine) {
      const cached = JSON.parse(localStorage.getItem('alengo-remote-snapshot-v1') || 'null');
      if (!cached) throw new Error('Sem internet e ainda não há dados remotos salvos neste aparelho.');
      state.remoteSnapshot = cached; state.tables = cached.tables || []; state.catalog = cached.catalog || { products: [], kits: [] }; state.customers = cached.customers || []; state.myOrders = cached.orders || []; state.notifications = cached.notifications || state.notifications; state.operator = cached.operator?.name || state.operator; state.operatorPermissions=cached.permissions||cached.operator?.permissions||{}; state.cashOpen=!!cached.cash_open; state.connection = 'Sem internet. Exibindo os últimos dados sincronizados; novos pedidos ficarão pendentes neste aparelho.'; renderAfterRefresh(); return;
    }
    await remoteEnsureSession();
    const rows = await supabaseFetch(`/rest/v1/remote_state?auth_user_id=eq.${encodeURIComponent(state.remoteUid)}&select=payload`);
    if (!Array.isArray(rows) || !rows.length) { const denied = new Error('Atendente sem vínculo remoto ativo. Solicite ao administrador a liberação deste usuário.'); denied.accessDenied = true; throw denied; }
    const snapshot = rows[0].payload;
    state.remoteSnapshot = snapshot; state.tables = snapshot.tables || []; state.catalog = snapshot.catalog || { products: [], kits: [] }; state.customers = snapshot.customers || []; state.myOrders = snapshot.orders || []; state.operator = snapshot.operator?.name || state.operator; state.operatorPermissions=snapshot.permissions||snapshot.operator?.permissions||{}; state.cashOpen=!!snapshot.cash_open; receiveNotifications(snapshot.notifications || []);
    const snapshotAge = snapshot.generated_at ? Date.now() - Date.parse(snapshot.generated_at) : Infinity;
    state.connection = snapshotAge > 30000 ? 'Windows sem comunicação recente. Os dados podem estar desatualizados; pedidos enviados ficarão pendentes até o caixa voltar a se comunicar.' : '';
    localStorage.setItem('alengo-remote-snapshot-v1', JSON.stringify(snapshot)); renderAfterRefresh();
  }
  async function remoteSendQueued(item) {
    await remoteEnsureSession();
    if (item.auth_user_id && item.auth_user_id !== state.remoteUid) throw new Error('Há uma operação pendente de outra conta neste aparelho. Entre com a conta original para sincronizá-la.');
    const byKey = await supabaseFetch(`/rest/v1/remote_requests?auth_user_id=eq.${encodeURIComponent(state.remoteUid)}&request_key=eq.${encodeURIComponent(item.request_key)}&select=id,status,response`);
    if (byKey.length && byKey[0].id !== item.id) { await queueRemoteDelete(item.id); item.id = byKey[0].id; await queueRemotePut(item); }
    const filter = `id=eq.${encodeURIComponent(item.id)}&select=id,status,response`;
    let rows = await supabaseFetch(`/rest/v1/remote_requests?${filter}`);
    if (!rows.length) {
      try {
        await supabaseFetch('/rest/v1/remote_requests', 'POST', { id: item.id, auth_user_id: state.remoteUid, request_type: item.request_type, request_key: item.request_key, payload: item.payload, status: 'PENDING' });
      } catch (error) {
        if (error.status === 401 || error.status === 403) { await queueRemoteDelete(item.id); throw error; }
        if (error.status !== 409) throw error;
      }
    }
    const until = Date.now() + 25000;
    while (Date.now() < until) {
      rows = await supabaseFetch(`/rest/v1/remote_requests?${filter}`);
      if (rows.length && rows[0].status === 'CONFIRMED') {
        await queueRemoteDelete(item.id);
        const completed = JSON.parse(localStorage.getItem('alengo-remote-completed-v1') || '{}'); completed[`${state.remoteUid}:${item.request_key}`] = rows[0].response; const keys = Object.keys(completed); while (keys.length > 80) delete completed[keys.shift()]; localStorage.setItem('alengo-remote-completed-v1', JSON.stringify(completed));
        return rows[0].response;
      }
      if (rows.length && rows[0].status === 'ERROR') {
        await queueRemoteDelete(item.id);
        const response = rows[0].response || {}; const failure = new Error(response.error || 'O Windows recusou a solicitação remota.'); failure.pending = false; failure.businessError = true; throw failure;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    const pendingError = new Error('Solicitação salva na fila remota, aguardando confirmação do Windows.'); pendingError.pending = true; throw pendingError;
  }
  async function remoteCommand(type, payload, requestKey) {
    const completed = JSON.parse(localStorage.getItem('alengo-remote-completed-v1') || '{}');
    const completedKey = `${state.remoteUid}:${requestKey}`;
    if (completed[completedKey]) return completed[completedKey];
    let queue = await queueRemoteGetAll();
    let item = queue.find(x => x.auth_user_id === state.remoteUid && x.request_key === requestKey);
    if (!item) { item = { id: crypto.randomUUID(), auth_user_id: state.remoteUid, request_type: type, request_key: requestKey, payload, created_at: new Date().toISOString() }; await queueRemotePut(item); }
    if (!navigator.onLine) { const pending = new Error('Sem internet. A operação foi guardada neste aparelho e será enviada quando a conexão voltar. Ainda não foi confirmada pelo caixa.'); pending.pending = true; throw pending; }
    try { return await remoteSendQueued(item); } catch (error) { if (!error.status && !error.pending) error.pending = true; throw error; }
  }
  async function flushRemoteQueue() {
    if (remoteFlushing || state.mode !== 'remote' || !state.token || !navigator.onLine) return;
    remoteFlushing = true;
    const items = (await queueRemoteGetAll()).filter(item => !item.auth_user_id || item.auth_user_id === state.remoteUid);
    try {
      for (const item of items) {
        try {
          await remoteSendQueued(item);
          if(item.request_type==='PAY_TABLE'){try{localStorage.removeItem(paymentStorageKey(item.payload?.table_id))}catch{}if(Number(state.paymentTableId)===Number(item.payload?.table_id)){state.paymentPendingKey=null;state.screen='payment-tables';}notify('Pagamento da mesa processado e registrado no caixa do Windows.',6000);}
          if (item.request_type === 'CREATE_ORDER' && state.pendingKey && item.request_key === `order:${state.pendingKey}`) {
            state.cart = []; state.customer = ''; state.customerId = null; state.pendingKey = null; state.remoteOrderPending = false; state.table = null; state.orderType = null; state.screen = 'home';
            notify('Pedido remoto confirmado pelo Windows.');
          }
          try { await refreshRemote(); } catch (refreshError) { state.connection = `Pedido processado, mas a atualização da tela falhou: ${refreshError.message}`; }
        } catch (error) { if (!navigator.onLine) break; if (!String(error.message).includes('aguardando confirmação')) notify(`Fila remota: ${error.message}`, 5500); }
      }
      renderAfterRefresh();
    } finally { remoteFlushing = false; }
  }

  async function api(path, method = 'GET', body = null, token = state.token) {
    if (state.mode === 'remote') {
      if (path === '/me') return { operator: state.operator || state.user, role: 'operator' };
      if (path === '/tables') return state.tables;
      if (path === '/catalog') return state.catalog;
      if (path === '/customers') return state.customers;
      if (path === '/orders') { if (method === 'GET') return state.myOrders; const key = String(body?.idempotency_key || orderKey()); return remoteCommand('CREATE_ORDER', body, `order:${key}`); }
      if (path === '/orders/item-delivery') { const order = state.myOrders.find(x => Number(x.id) === Number(body.order_id)); const item = order?.items?.find(x => Number(x.id) === Number(body.item_id)); return remoteCommand('ITEM_DELIVERY', body, `delivery:${body.order_id}:${body.item_id}:${body.delta}:${Number(item?.delivered_quantity || 0)}`); }
      if (path === '/orders/cancel') return remoteCommand('CANCEL_ORDER', body, `cancel:${body.order_id}`);
      if (path === '/payments/table') return remoteCommand('PAY_TABLE', body, `pay-table:${body.table_id}:${body.payment_key}`);
      if (path === '/notifications') return state.notifications;
      if (path === '/notifications/ack') return remoteCommand('ACK_NOTIFICATION', body, `ack-notifications:${(body.ids||[]).slice().sort((a,b)=>a-b).join(',')}`);
      if (path === '/alerts') return [];
      if (path === '/logout') { await supabaseFetch('/auth/v1/logout', 'POST', {}, state.token).catch(() => {}); return { ok: true }; }
      throw new Error('Operação indisponível no acesso remoto.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const localPath = path==='/orders' ? '/web/orders' : path==='/orders/cancel' ? '/web/orders/cancel' : path==='/payments/table' ? '/web/payments/table' : path;
      const response = await fetch(`${location.origin}${localPath}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        cache: 'no-store'
      });
      const data = await response.json();
      if (!response.ok) { const error = new Error(data.error || 'Falha na comunicação.'); error.status = response.status; throw error; }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Conexão expirada. Confira o Wi-Fi e se o computador está ligado.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function refresh() {
    if (state.mode === 'remote') return refreshRemote();
    const [tables, catalog, customers, orders, notifications, status] = await Promise.all([api('/tables'), api('/catalog'), api('/customers'), api('/orders'), api('/notifications'), api('/status')]);
    state.tables = tables;
    state.catalog = catalog;
    state.customers = customers || [];
    state.myOrders = orders; state.cashOpen=!!status.cash_open; state.operatorPermissions=status.permissions||state.operatorPermissions;
    receiveNotifications(notifications || []);
    state.connection = '';
    renderAfterRefresh();
  }

  function renderLogin() {
    return `
      <h1 class="title">Acessar o atendimento</h1>
      <div class="row">${remoteConfig.remoteOnly ? '' : `<button class="btn ${state.mode === 'local' ? '' : 'secondary'}" type="button" data-action="mode-local">Rede local</button>`}<button class="btn ${state.mode === 'remote' ? '' : 'secondary'}" type="button" data-action="mode-remote" ${remoteConfig.remoteEnabled ? '' : 'disabled'}>Internet</button></div>
      <p class="subtitle">${state.mode === 'remote' ? 'Entre com o usuário e a senha cadastrados pelo responsável em Configurações → Operadores no ALENGO Windows.' : 'Entre com o usuário e a senha fornecidos pelo responsável. Conecte-se à mesma rede Wi-Fi do computador.'}</p>
      <div class="card"><div class="card-title">${state.mode === 'remote' ? 'Acesso pela internet' : 'Computador do caixa'}</div><div class="help">${state.mode === 'remote' ? 'O Windows da loja precisa estar ligado e conectado à internet.' : `${escapeHtml(currentAddress())} · Conecte o celular à mesma rede Wi-Fi.`}</div></div>
      <form id="login-form" autocomplete="on">
        <label class="field"><span>${state.mode === 'remote' ? 'Usuário do atendente' : 'Usuário do atendente'}</span><input id="login-user" name="username" type="text" autocomplete="username" autocapitalize="none" required value="${escapeHtml(state.user)}" placeholder="Seu usuário cadastrado no Windows"></label>
        <label class="field"><span>Senha</span><input id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="Sua senha"></label>
        <button class="btn" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Conectando...' : 'Entrar e salvar acesso'}</button>
      </form>
      ${state.connection ? `<div class="warning">${escapeHtml(state.connection)}</div>` : ''}
      <div class="install-note"><strong>Instalar no iPhone:</strong> abra este endereço no Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”. No Android, use o menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.</div>
      <p class="footer">Acesso privado dos colaboradores · ALENGO ESPETINHOS</p>`;
  }

  function renderHome() {
    const offline = !!state.connection;
    return `
      ${offline ? `<div class="warning">${escapeHtml(state.connection)}<br>Seu acesso continua salvo neste aparelho.</div>` : ''}
      <div class="badge ${offline ? 'offline' : ''}"><strong>${offline ? '⚠ Sem conexão' : (state.mode === 'remote' ? '✓ Conectado ao serviço remoto' : '✓ Conectado ao PDV Windows')}</strong><span>${state.mode === 'remote' ? 'Acesso pela internet' : `Computador: ${escapeHtml(currentAddress())}`} · Operador: ${escapeHtml(state.operator || state.user)}</span></div>
      ${state.operatorPermissions.send_orders!==false?`<h1 class="title">Novo pedido</h1><p class="subtitle">Selecione como o cliente será atendido.</p><button class="choice" data-action="choose-type" data-type="MESA"><strong>🍽️ Mesa</strong><span class="help">Atendimento no estabelecimento; pedido vinculado a uma mesa.</span></button><button class="choice" data-action="choose-type" data-type="RETIRADA"><strong>🥡 Retirada</strong><span class="help">Cliente vai levar embora; não exige mesa.</span></button>`:`<div class="card">Seu perfil está configurado apenas para acompanhar o atendimento. Não há permissão para enviar novos pedidos.</div>`}
      <section class="alert-card"><div class="row between"><div class="card-title">🔔 Central de notificações ${state.notifications.some(n=>!n.read_at)?`(${state.notifications.filter(n=>!n.read_at).length} não lida(s))`:''}</div><button class="btn secondary small" data-action="notification-permission">Ativar avisos</button></div>${state.notifications.slice(0,30).map(item=>`<div class="alert-item"><strong>${escapeHtml(item.title||'Aviso')}</strong><br>${escapeHtml(item.message)}<small> · ${new Date(item.created_at).toLocaleString('pt-BR')}</small></div>`).join('')||'<div class="help">Nenhuma notificação registrada.</div>'}<button class="btn secondary" data-action="notifications-read" ${state.notifications.some(n=>!n.read_at)?'':'disabled'}>Marcar avisos como lidos</button></section>
      <button class="btn secondary" data-action="my-orders">Meus pedidos · Entregas e cancelamentos</button>
      ${state.operatorPermissions.receive_table_payment ? `<button class="btn" data-action="payment-tables">💳 Mesas e recebimentos</button>` : ''}
      <button class="btn secondary" data-action="refresh">Atualizar produtos e mesas</button>
      <button class="btn secondary" data-action="logout">Sair deste aparelho</button>
      <div class="install-note">O aplicativo atualiza pedidos enquanto estiver aberto. No iPhone, o navegador pode suspender atualizações em segundo plano; mantenha o app aberto durante o atendimento.</div>`;
  }

  function renderTables() {
    return `<h1 class="title">Selecione a mesa</h1><p class="subtitle">Escolha a mesa para vincular a comanda.</p>
      <div class="grid">${state.tables.map(table => `<button class="table" data-action="select-table" data-id="${table.id}"><strong>MESA ${escapeHtml(table.label)}</strong><span class="help">${table.open_orders ? `${table.open_orders} pedidos · ${money(table.pending_cents)}` : 'Livre'}</span>${table.primary_operator_name?`<span class="help">Responsável: ${escapeHtml(table.primary_operator_name)}</span>`:''}${state.operatorPermissions.receive_table_payment&&Number(table.open_orders)>0?`<span class="help">Toque para receber</span>`:''}</button>`).join('')}</div>
      ${!state.tables.length ? '<div class="empty">Não há mesas cadastradas. Cadastre no PDV Windows.</div>' : ''}
      <button class="btn secondary" data-action="home">Voltar</button>`;
  }

  function renderPaymentTables() {
    const open=state.tables.filter(t=>Number(t.open_orders)>0);
    return `<h1 class="title">Recebimentos na mesa</h1><p class="subtitle">Selecione uma conta em aberto. O pagamento será registrado automaticamente no caixa do Windows, desde que exista um caixa aberto e a permissão esteja ativa.</p>${!state.cashOpen?'<div class="warning">O caixa do Windows não está aberto no último estado sincronizado. O recebimento ficará indisponível até a abertura do caixa.</div>':''}<div class="grid">${open.map(t=>`<button class="table" data-action="select-payment-table" data-id="${t.id}"><strong>MESA ${escapeHtml(t.label)}</strong><span class="help">${t.open_orders} pedido(s) · ${money(t.pending_cents)}</span>${t.primary_operator_name?`<span class="help">Responsável: ${escapeHtml(t.primary_operator_name)}</span>`:''}</button>`).join('')||'<div class="empty">Nenhuma mesa possui conta pendente.</div>'}</div><button class="btn secondary" data-action="home">Voltar</button>`;
  }
  function renderPayment() {
    const table=state.tables.find(t=>Number(t.id)===Number(state.paymentTableId));
    const orders=state.myOrders.filter(o=>Number(o.table_id)===Number(state.paymentTableId)&&o.status==='ABERTO');
    const base=orders.reduce((n,o)=>n+Number(o.total_cents||0),0);
    const lines=state.paymentLines?.length?state.paymentLines:[{method:'PIX',amount:(base/100).toFixed(2)}]; const pending=!!state.paymentPendingKey;
    const original=lines.reduce((n,l)=>n+Math.round(Math.max(0,Number(String(l.amount||'0').replace(',','.'))||0)*100),0);
    const fees=lines.reduce((n,l)=>n+(l.method==='Cartão de crédito'?Math.round(Math.round(Math.max(0,Number(String(l.amount||'0').replace(',','.'))||0)*100)*(Number(state.paymentFee)||0)/100):0),0);
    return `<h1 class="title">Receber · Mesa ${escapeHtml(table?.label||'')}</h1><p class="subtitle">${orders.length} pedido(s) em aberto · ${orders.map(o=>`#${o.id} ${escapeHtml(o.customer_name)}`).join(' · ')}</p><div class="total">Conta: ${money(base)}<br>Informado: ${money(original)}<br>Total com taxas: ${money(original+fees)}</div>${lines.map((line,i)=>`<div class="card"><label class="field"><span>Forma ${i+1}</span><select data-field="payment-method-${i}" value="${escapeHtml(line.method)}" ${pending?'disabled':''}>${['Dinheiro','PIX','Cartão de débito','Cartão de crédito'].map(m=>`<option ${line.method===m?'selected':''}>${m}</option>`).join('')}</select></label><label class="field"><span>Valor (R$)</span><input data-field="payment-amount-${i}" ${pending?'disabled':''} type="number" min="0.01" step="0.01" value="${escapeHtml(line.amount)}" placeholder="0,00"></label>${i>0?`<button class="btn danger small" data-action="remove-payment-line" data-index="${i}" ${pending?'disabled':''}>Remover forma</button>`:''}</div>`).join('')}<button class="btn secondary" data-action="add-payment-line" ${lines.length>=4||pending?'disabled':''}>+ Adicionar outra forma de pagamento</button>${lines.some(l=>l.method==='Cartão de crédito')?`<label class="field"><span>Taxa de crédito (%)</span><input data-field="payment-fee" ${pending?'disabled':''} type="number" min="0" max="100" step="0.01" value="${escapeHtml(state.paymentFee)}"></label><label class="field"><span>Parcelas no crédito</span><input data-field="payment-installments" ${pending?'disabled':''} type="number" min="1" max="36" value="${escapeHtml(state.paymentInstallments)}"></label>`:''}<label class="field"><input data-field="payment-print" ${pending?'disabled':''} type="checkbox" ${state.paymentPrint?'checked':''}> Imprimir comprovante no caixa</label><button class="btn" data-action="confirm-table-payment" ${!orders.length||!state.cashOpen||state.busy||original!==base?'disabled':''}>${state.busy?'Registrando...':pending?'Verificar recebimento pendente':'Finalizar recebimento'}</button>${pending?'<div class="warning">Existe uma tentativa de recebimento pendente para esta mesa. Os valores foram bloqueados para evitar uma segunda cobrança.</div>':''}<p class="help">A soma dos valores deve corresponder exatamente à conta. O pagamento será identificado com seu usuário e registrado automaticamente no caixa aberto, sem confirmação manual no Windows. Se a conexão cair, ficará pendente até sincronizar.</p><button class="btn secondary" data-action="payment-tables">Voltar às mesas</button>`;
  }
  function renderCatalog() {
    const label = state.orderType === 'RETIRADA' ? 'RETIRADA' : `MESA ${state.table?.label || ''}`;
    const products = [...(state.catalog.products || []).map(item => ({ ...item, isKit: false })), ...(state.catalog.kits || []).map(item => ({ ...item, isKit: true }))]
      .filter(item => String(item.name || '').toLowerCase().includes(state.search.toLowerCase()));
    return `<h1 class="title">${escapeHtml(label)} · Cardápio</h1>
      <label class="field"><span>Cliente (selecione um cadastro ou digite um nome)</span><input data-field="customer" list="customer-options" value="${escapeHtml(state.customer)}" placeholder="Pesquisar cliente por nome ou telefone..." autocomplete="off"><datalist id="customer-options">${state.customers.map(customer => `<option value="${escapeHtml(customer.name)}" label="${escapeHtml(customer.phone || 'Cliente cadastrado')}"></option>`).join('')}</datalist></label>
      <label class="field"><span>Pesquisar produto</span><input data-field="search" value="${escapeHtml(state.search)}" placeholder="Espeto, bebida, chopp..." autocomplete="off"></label>
      <section class="card">${products.map(product => `<div class="product"><div class="details"><div class="product-name">${product.isKit ? 'Combo · ' : ''}${escapeHtml(product.name)}</div><div class="product-meta">${money(product.price_cents)}${product.isKit ? '' : ` · Estoque: ${escapeHtml(product.stock)}`}</div></div><button class="btn small" data-action="add-product" data-id="${product.id}" data-kit="${product.isKit}" ${!product.isKit && Number(product.stock) < 1 ? 'disabled' : ''}>+ Adicionar</button></div>`).join('') || '<div class="empty">Nenhum produto encontrado.</div>'}</section>
      <button class="btn" data-action="open-cart" ${state.cart.length ? '' : 'disabled'}>Ver carrinho (${state.cart.length})</button>
      <button class="btn secondary" data-action="home">Voltar ao início</button>`;
  }

  function renderCart() {
    const label = state.orderType === 'RETIRADA' ? 'RETIRADA' : `MESA ${state.table?.label || ''}`;
    const total = state.cart.reduce((sum, item) => sum + Number(item.price_cents) * Number(item.quantity), 0);
    return `<h1 class="title">${escapeHtml(label)} · Comanda</h1><p class="subtitle">Cliente: ${escapeHtml(state.customer || 'não informado')}</p>
      ${state.cart.map(item => `<div class="card"><div class="row between"><div class="grow"><div class="card-title">${escapeHtml(item.name)}</div><div class="product-meta">${money(item.price_cents * item.quantity)}</div></div><div class="row"><button class="btn secondary small" data-action="quantity" data-id="${escapeHtml(item.cartId)}" data-delta="-1" ${state.remoteOrderPending ? 'disabled' : ''}>−</button><span class="qty">${item.quantity}</span><button class="btn small" data-action="quantity" data-id="${escapeHtml(item.cartId)}" data-delta="1" ${state.remoteOrderPending ? 'disabled' : ''}>+</button></div></div><label class="field"><span>Observação para preparo</span><textarea data-note="${escapeHtml(item.cartId)}" placeholder="Ex.: bem passado, sem molho" ${state.remoteOrderPending ? 'readonly' : ''}>${escapeHtml(item.notes)}</textarea></label></div>`).join('')}
      <div class="total">Total do pedido: ${money(total)}</div>
      <button class="btn" data-action="send-order" ${state.busy || state.remoteOrderPending || state.customer.trim().length < 2 || !state.cart.length ? 'disabled' : ''}>${state.busy ? 'Enviando...' : state.remoteOrderPending ? 'Aguardando confirmação do Windows' : 'Enviar comanda para cozinha'}</button>
      <button class="btn secondary" data-action="catalog" ${state.remoteOrderPending ? 'disabled' : ''}>Adicionar mais itens</button>
      <p class="help">Se a conexão cair durante o envio, o pedido ficará no carrinho e poderá ser reenviado sem duplicação.</p>`;
  }

  function renderOrders() {
    return `<h1 class="title">Meus pedidos</h1><p class="subtitle">Acompanhe o preparo e marque cada unidade quando estiver pronta e tiver sido levada à mesa ou entregue ao cliente. O andamento também aparece no PDV Windows.</p>
      <button class="btn secondary" data-action="refresh">Atualizar pedidos</button>
      ${state.myOrders.map(order => {
        const total = order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const delivered = order.items.reduce((sum, item) => sum + Number(item.delivered_quantity || 0), 0);
        const place = order.order_type === 'RETIRADA' ? 'RETIRADA' : `MESA ${state.tables.find(table => table.id === order.table_id)?.label || order.table_id || '-'}`;
        return `<article class="card"><div class="card-title">#${order.id} · ${escapeHtml(place)}</div><div class="product-meta">${escapeHtml(order.customer_name)} · ${money(order.total_cents)} · ${order.status === 'PAGO' ? 'Pago' : 'Aguardando pagamento'} · ${delivered}/${total} pronta(s) e entregue(s)</div>
          ${order.items.map(item => `<div class="delivery"><div class="details"><div class="product-name">${escapeHtml(item.name)}</div><div class="product-meta">${Number(item.delivered_quantity || 0)}/${Number(item.quantity || 0)} pronta(s) e entregue(s)${item.notes ? ` · ${escapeHtml(item.notes)}` : ''}</div></div><button class="btn secondary small" data-action="delivery" data-order="${order.id}" data-item="${item.id}" data-delta="-1" ${state.busy || Number(item.delivered_quantity || 0) <= 0 ? 'disabled' : ''}>−</button><button class="btn small" data-action="delivery" data-order="${order.id}" data-item="${item.id}" data-delta="1" ${state.busy || Number(item.delivered_quantity || 0) >= Number(item.quantity || 0) ? 'disabled' : ''}>Pronto + entregue</button></div>`).join('')}
          ${state.operatorPermissions.cancel_orders && order.status === 'ABERTO' && delivered === 0 ? `<button class="btn danger" data-action="cancel-order" data-id="${order.id}">Cancelar este pedido</button>` : ''}</article>`;
      }).join('') || '<div class="empty">Não há pedidos ativos neste aparelho.</div>'}
      <button class="btn secondary" data-action="home">Voltar ao início</button>`;
  }

  function render() {
    const active = document.activeElement;
    const focusInfo = active && view.contains(active) ? {
      field: active.dataset?.field || '', note: active.dataset?.note || '', name: active.name || '',
      start: typeof active.selectionStart === 'number' ? active.selectionStart : null,
      end: typeof active.selectionEnd === 'number' ? active.selectionEnd : null
    } : null;
    $('#operator-label').textContent = state.token ? (state.operator || state.user) : 'CONECTAR AO CAIXA';
    $('#top-home').classList.toggle('hidden', !state.token || state.screen === 'home');
    if (state.booting) { view.innerHTML = '<div class="loading">Restaurando acesso salvo...</div>'; return; }
    if (!state.token) view.innerHTML = renderLogin();
    else if (state.screen === 'home') view.innerHTML = renderHome();
    else if (state.screen === 'tables') view.innerHTML = renderTables();
    else if (state.screen === 'payment-tables') view.innerHTML = renderPaymentTables();
    else if (state.screen === 'payment') view.innerHTML = renderPayment();
    else if (state.screen === 'catalog') view.innerHTML = renderCatalog();
    else if (state.screen === 'cart') view.innerHTML = renderCart();
    else if (state.screen === 'orders') view.innerHTML = renderOrders();
    else view.innerHTML = renderHome();
    if (focusInfo) {
      const target = [...view.querySelectorAll('input,textarea,select')].find(el =>
        (focusInfo.field && el.dataset.field === focusInfo.field) ||
        (focusInfo.note && el.dataset.note === focusInfo.note) ||
        (focusInfo.name && el.name === focusInfo.name));
      if (target) {
        target.focus({ preventScroll: true });
        if (focusInfo.start !== null && typeof target.setSelectionRange === 'function') {
          try { target.setSelectionRange(focusInfo.start, focusInfo.end); } catch {}
        }
      }
    }
  }

  function renderAfterRefresh() {
    const active = document.activeElement;
    if (active && view.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    render();
  }

  async function restore() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!saved?.token) { state.user = saved?.user || ''; return; }
      state.user = saved.user || '';
      state.mode = saved.mode || state.mode;
      state.remoteUid = saved.remoteUid || ''; state.remoteRefreshToken = saved.remoteRefreshToken || ''; state.remoteExpiresAt = Number(saved.remoteExpiresAt || 0);
      state.deviceId = saved.deviceId || '';
      if (state.mode === 'remote') { state.token = saved.token; state.operator = saved.operator || saved.user || ''; state.screen = 'home'; try { await refreshRemote(); await flushRemoteQueue(); } catch (error) { if (error.accessDenied || error.status === 401) { clearSession(); state.token = ''; state.remoteRefreshToken = ''; state.remoteUid = ''; state.connection = error.message; state.screen = 'login'; } else { const cached = JSON.parse(localStorage.getItem('alengo-remote-snapshot-v1') || 'null'); if (cached) { state.remoteSnapshot = cached; state.tables = cached.tables || []; state.catalog = cached.catalog || { products: [], kits: [] }; state.customers = cached.customers || []; state.myOrders = cached.orders || []; state.connection = `Sem internet: ${error.message}`; } else { state.connection = error.message; } } } return; }
      state.token = saved.token;
      state.operator = saved.operator || saved.user || '';
      const info = await api('/me');
      state.operator = info.operator; state.operatorPermissions=info.permissions||{};
      state.screen = 'home';
      saveSession();
      await refresh().catch(error => { state.connection = `Sem conexão com o PDV. Confira o Wi-Fi ou o endereço do computador. ${error.message}`; });
    } catch (error) {
      if (error.status === 401) { clearSession(); state.token = ''; state.connection = 'Sessão expirada. Entre novamente.'; }
      else if (saved?.token) {
        state.token = saved.token; state.operator = saved.operator || saved.user || '';
        state.screen = 'home';
        state.connection = 'Sem conexão com o PDV. Seu acesso continua salvo; confira o Wi-Fi ou se o computador está ligado.';
      }
    } finally { state.booting = false; render(); }
  }

  async function login(form) {
    const data = new FormData(form);
    const username = String(data.get('username') || '').trim();
    const password = String(data.get('password') || '');
    if (!username || !password) return notify('Informe usuário e senha.');
    state.busy = true; render();
    try {
      if (state.mode === 'remote') { await remoteLogin(username, password); notify(`Acesso remoto liberado. Olá, ${state.operator}!`); return; }
      const did = state.deviceId || deviceKey();
      const result = await api('/login', 'POST', { username, password, device_id: did }, '');
      state.user = username; state.operator = result.operator; state.operatorPermissions=result.permissions||{}; state.token = result.token; state.deviceId = did;
      state.screen = 'home'; state.connection = ''; state.password = '';
      saveSession();
      await refresh().catch(error => { state.connection = error.message; });
      notify(`Acesso liberado. Olá, ${state.operator}!`);
    } catch (error) { state.connection = error.message; notify(`Falha no acesso: ${error.message}`, 5200); }
    finally { state.busy = false; render(); }
  }

  async function logout() {
    if (!confirm('Encerrar o acesso deste aparelho? Será necessário entrar novamente com a senha.')) return;
    await api('/logout', 'POST', {}).catch(() => {});
    clearSession();
    if (state.mode === 'remote') { state.remoteUid = ''; state.remoteRefreshToken = ''; state.remoteExpiresAt = 0; }
    Object.assign(state, { token: '', operator: '', password: '', cart: [], table: null, orderType: null, alerts: [], screen: 'login', connection: '' });
    render();
  }

  function receiveNotifications(rows){
    const incoming=Array.isArray(rows)?rows:[];
    const fresh=incoming.filter(n=>!state.notifiedIds.has(String(n.id||n.event_key))&&!n.read_at);
    state.notifications=incoming;
    for(const n of incoming)state.notifiedIds.add(String(n.id||n.event_key));
    if(fresh.length){
      const latest=fresh[0];
      notify(`${latest.title||'ALENGO'}: ${latest.message}`,6500);
      playNotificationSound();
      if('Notification' in window && Notification.permission==='granted' && document.visibilityState!=='visible')new Notification(latest.title||'ALENGO ESPETINHOS',{body:latest.message,icon:'./icon.png',tag:String(latest.event_key||latest.id)});
    }
  }
  async function acknowledgeNotifications(){
    const ids=state.notifications.filter(n=>!n.read_at&&Number.isInteger(Number(n.id))).map(n=>Number(n.id)).slice(0,100);
    if(!ids.length)return;
    try{await api('/notifications/ack','POST',{ids});await refresh();notify('Notificações marcadas como lidas.');}catch(error){notify(`Não foi possível atualizar as notificações: ${error.message}`);}
  }

  async function pollAlerts() {
    if (state.mode === 'remote') return;
    if (!state.token || document.visibilityState !== 'visible') return;
    try {
      const received = await api('/alerts');
      const fresh = received.filter(item => !state.alertIds.has(String(item.id)));
      if (!fresh.length) return;
      fresh.forEach(item => state.alertIds.add(String(item.id)));
      state.alerts = [...fresh, ...state.alerts].slice(0, 30);
      await api('/alerts/ack', 'POST', { ids: fresh.map(item => item.id) });
      notify(fresh.map(item => item.message).join(' · '), 6000);
      renderAfterRefresh();
    } catch (error) {
      if (error.status === 401) { clearSession(); state.token = ''; state.connection = 'Acesso revogado ou sessão expirada. Entre novamente.'; render(); }
    }
  }

  async function sendOrder() {
    if (state.orderType === 'MESA' && !state.table) return notify('Selecione uma mesa.');
    if (state.customer.trim().length < 2) return notify('Informe o nome do cliente.');
    if (!state.cart.length) return;
    const key = state.pendingKey || orderKey();
    state.pendingKey = key; state.busy = true; render();
    try {
      const result = await api('/orders', 'POST', {
        order_type: state.orderType,
        ...(state.orderType === 'MESA' ? { table_id: state.table.id } : {}),
        customer_name: state.customer.trim(),
        ...(state.customerId ? { customer_id: state.customerId } : {}),
        items: state.cart.map(({ product_id, kit_id, quantity, notes }) => ({ product_id, kit_id, quantity, notes })),
        idempotency_key: key
      });
      state.cart = []; state.customer = ''; state.customerId = null; state.pendingKey = null; state.table = null; state.orderType = null; state.screen = 'home';
      await refresh().catch(error => { state.connection = error.message; });
      notify(`Pedido #${result.id} registrado e enviado ao PDV.`, 5000);
    } catch (error) { if (state.mode === 'remote' && error.pending) state.remoteOrderPending = true; if (state.mode === 'remote' && !error.pending) { state.pendingKey = null; state.remoteOrderPending = false; } notify(`Envio não confirmado: ${error.message}. ${error.pending ? 'A operação permanece na fila para sincronização.' : 'Confira os dados e tente novamente.'}`, 6500); }
    finally { state.busy = false; render(); }
  }

  async function cancelOrder(id) {
    const order = state.myOrders.find(item => String(item.id) === String(id));
    if (!order) return;
    const reason = prompt(`Motivo do cancelamento do pedido #${order.id} (mínimo 5 caracteres):`, '');
    if (reason === null) return;
    if (reason.trim().length < 5) return notify('Informe um motivo com pelo menos 5 caracteres.');
    state.busy = true; render();
    try {
      const result = await api('/orders/cancel', 'POST', { order_id: order.id, reason: reason.trim() });
      await refresh(); state.screen = 'home';
      notify(`Pedido #${result.id} cancelado e comunicado ao caixa.`, 5000);
    } catch (error) { notify(error.pending ? `Cancelamento guardado na fila offline. Ainda não foi aplicado pelo Windows: ${error.message}` : `Cancelamento não confirmado: ${error.message}`, 6500); }
    finally { state.busy = false; render(); }
  }

  async function updateDelivery(orderId, itemId, delta) {
    if (state.busy) return;
    state.busy = true; render();
    try {
      const result = await api('/orders/item-delivery', 'POST', { order_id: Number(orderId), item_id: Number(itemId), delta: Number(delta) });
      await refresh();
      if (result.complete) notify('Todos os itens deste pedido foram marcados como entregues.');
    } catch (error) { notify(error.pending ? `Atualização guardada na fila offline. Ainda não foi aplicada pelo Windows: ${error.message}` : `Entrega não atualizada: ${error.message}`); }
    finally { state.busy = false; render(); }
  }

  function chooseType(type) {
    state.orderType = type; state.cart = []; state.customer = ''; state.customerId = null; state.table = null; state.pendingKey = null; state.search = '';
    if (type === 'RETIRADA') state.screen = 'catalog';
    else { state.screen = 'tables'; refresh().catch(error => { state.connection = error.message; renderAfterRefresh(); }); }
    render();
  }

  view.addEventListener('change', event => { if(String(event.target.dataset.field||'').startsWith('payment-')) render(); });

  view.addEventListener('submit', event => {
    if (event.target.id === 'login-form') { event.preventDefault(); login(event.target); }
  });

  view.addEventListener('input', event => {
    const field = event.target.dataset.field;
    if (field?.startsWith('payment-method-')) {const i=Number(field.split('-').pop());state.paymentLines=state.paymentLines.map((x,j)=>j===i?{...x,method:event.target.value}:x);}
    if (field?.startsWith('payment-amount-')) {const i=Number(field.split('-').pop());state.paymentLines=state.paymentLines.map((x,j)=>j===i?{...x,amount:event.target.value}:x);}
    if (field === 'payment-method') state.paymentMethod=event.target.value;
    if (field === 'payment-fee') state.paymentFee=event.target.value;
    if (field === 'payment-installments') state.paymentInstallments=event.target.value;
    if (field === 'payment-print') state.paymentPrint=event.target.checked;
    if (field === 'customer') { state.customer = event.target.value; const match = state.customers.find(customer => String(customer.name || '').trim().toLocaleLowerCase('pt-BR') === state.customer.trim().toLocaleLowerCase('pt-BR')); state.customerId = match ? Number(match.id) : null; }
    if (field === 'search') {
      const cursor = event.target.selectionStart;
      state.search = event.target.value;
      const old = event.target.value;
      const products = [...(state.catalog.products || []).map(item => ({ ...item, isKit: false })), ...(state.catalog.kits || []).map(item => ({ ...item, isKit: true }))]
        .filter(item => String(item.name || '').toLowerCase().includes(state.search.toLowerCase()));
      const section = view.querySelector('.card');
      if (section) section.innerHTML = products.map(product => `<div class="product"><div class="details"><div class="product-name">${product.isKit ? 'Combo · ' : ''}${escapeHtml(product.name)}</div><div class="product-meta">${money(product.price_cents)}${product.isKit ? '' : ` · Estoque: ${escapeHtml(product.stock)}`}</div></div><button class="btn small" data-action="add-product" data-id="${product.id}" data-kit="${product.isKit}" ${!product.isKit && Number(product.stock) < 1 ? 'disabled' : ''}>+ Adicionar</button></div>`).join('') || '<div class="empty">Nenhum produto encontrado.</div>';
      event.target.value = old; event.target.setSelectionRange(cursor, cursor);
    }
    if (event.target.dataset.note) {
      const item = state.cart.find(entry => entry.cartId === event.target.dataset.note);
      if (item) item.notes = event.target.value;
    }
  });

  view.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'mode-local' && !remoteConfig.remoteOnly) { state.mode = 'local'; state.connection = ''; render(); }
    else if (action === 'mode-remote') { state.mode = 'remote'; state.connection = ''; render(); }
    else if (action === 'choose-type') chooseType(button.dataset.type);
    else if (action === 'select-table') {
      state.table = state.tables.find(table => String(table.id) === button.dataset.id) || null;
      state.screen = 'catalog'; render();
    } else if (action === 'add-product') {
      const isKit = button.dataset.kit === 'true';
      const source = isKit ? state.catalog.kits : state.catalog.products;
      const product = source.find(item => String(item.id) === button.dataset.id);
      if (!product) return;
      const id = (isKit ? 'kit_' : 'p_') + product.id;
      const existing = state.cart.find(item => item.cartId === id);
      if (existing) existing.quantity += 1;
      else state.cart.push({ cartId: id, quantity: 1, notes: '', name: product.name, price_cents: product.price_cents, ...(isKit ? { kit_id: product.id } : { product_id: product.id }) });
      state.pendingKey = null; render();
    } else if (action === 'open-cart') { state.screen = 'cart'; render(); }
    else if (action === 'quantity') {
      const item = state.cart.find(entry => entry.cartId === button.dataset.id);
      if (item) { item.quantity += Number(button.dataset.delta); if (item.quantity <= 0) state.cart = state.cart.filter(entry => entry !== item); state.pendingKey = null; }
      render();
    } else if (action === 'send-order') await sendOrder();
    else if (action === 'catalog') { state.screen = 'catalog'; render(); }
    else if (action === 'payment-tables') { state.screen='payment-tables'; await refresh().catch(error=>{state.connection=error.message}); render(); }
    else if (action === 'select-payment-table') { state.paymentTableId=Number(button.dataset.id); const due=state.myOrders.filter(o=>Number(o.table_id)===state.paymentTableId&&o.status==='ABERTO').reduce((n,o)=>n+Number(o.total_cents||0),0);let pending=null;try{pending=JSON.parse(localStorage.getItem(paymentStorageKey(state.paymentTableId))||'null')}catch{}state.paymentPendingKey=pending?.key||null;state.paymentLines=pending?.lines||[{method:'PIX',amount:(due/100).toFixed(2)}];if(pending){state.paymentFee=pending.fee||'0';state.paymentInstallments=pending.installments||'1';state.paymentPrint=pending.print!==false;}state.screen='payment'; render(); }
    else if (action === 'add-payment-line') { if(state.paymentLines.length<4)state.paymentLines=[...state.paymentLines,{method:'Dinheiro',amount:''}];render(); }
    else if (action === 'remove-payment-line') { state.paymentLines=state.paymentLines.filter((_,i)=>i!==Number(button.dataset.index));render(); }
    else if (action === 'confirm-table-payment') { const key=state.paymentPendingKey||orderKey(); state.paymentPendingKey=key;try{localStorage.setItem(paymentStorageKey(state.paymentTableId),JSON.stringify({key,lines:state.paymentLines,fee:state.paymentFee,installments:state.paymentInstallments,print:state.paymentPrint}))}catch{} state.busy=true; render(); try { const result=await api('/payments/table','POST',{table_id:state.paymentTableId,payments:state.paymentLines.map(l=>({method:l.method,original_cents:Math.round(Number(String(l.amount||'0').replace(',','.'))*100),fee_percent:l.method==='Cartão de crédito'?(Number(state.paymentFee)||0):0,installments:l.method==='Cartão de crédito'?(Number(state.paymentInstallments)||1):1})),method:state.paymentMethod,fee_percent:Number(state.paymentFee)||0,installments:Number(state.paymentInstallments)||1,print_receipt:state.paymentPrint,payment_key:key}); state.paymentPendingKey=null;try{localStorage.removeItem(paymentStorageKey(state.paymentTableId))}catch{} notify(`Pagamento registrado · Venda #${result.saleId} · ${money(result.total_cents)}`); state.screen='payment-tables'; await refresh(); } catch(error) { if(error.pending||!error.status){state.paymentPendingKey=key;try{localStorage.setItem(paymentStorageKey(state.paymentTableId),JSON.stringify({key,lines:state.paymentLines,fee:state.paymentFee,installments:state.paymentInstallments,print:state.paymentPrint}))}catch{}} else {state.paymentPendingKey=null;try{localStorage.removeItem(paymentStorageKey(state.paymentTableId))}catch{}} notify(error.pending?`Pagamento aguardando sincronização: ${error.message}`:`Pagamento não realizado: ${error.message}`,6500); } finally {state.busy=false;render();} }
    else if (action === 'my-orders') { state.screen = 'orders'; await refresh().catch(error => { state.connection = error.message; }); render(); }
    else if (action === 'refresh') { try { await refresh(); await pollAlerts(); notify('Dados atualizados.'); } catch (error) { state.connection = error.message; renderAfterRefresh(); notify(error.message); } }
    else if (action === 'delivery') await updateDelivery(button.dataset.order, button.dataset.item, button.dataset.delta);
    else if (action === 'cancel-order') await cancelOrder(button.dataset.id);
    else if (action === 'logout') await logout();
    else if (action === 'home') { state.screen = 'home'; state.orderType = null; state.table = null; state.customer = ''; state.customerId = null; state.cart = []; state.search = ''; state.pendingKey = null; render(); }
    else if (action === 'clear-alerts') { state.alerts = []; render(); }
    else if (action === 'notifications-read') await acknowledgeNotifications();
    else if (action === 'notification-permission') { if(!('Notification' in window))notify('Este navegador não oferece notificações.'); else { try{const Ctx=window.AudioContext||window.webkitAudioContext;if(Ctx){notificationAudioContext=notificationAudioContext||new Ctx();await notificationAudioContext.resume();}}catch{} const permission=await Notification.requestPermission(); notify(permission==='granted'?'Avisos do navegador ativados.':'Permissão de notificações não concedida.'); } }
  });

  $('#top-home').addEventListener('click', () => {
    if (state.remoteOrderPending) return notify('Há um pedido pendente de confirmação. Aguarde a sincronização para evitar enviar outro pedido.');
    if (state.cart.length && state.screen !== 'home' && !confirm('Voltar ao início? O pedido ainda não enviado será descartado.')) return;
    state.screen = 'home'; state.orderType = null; state.table = null; state.customer = ''; state.customerId = null; state.cart = []; state.search = ''; state.pendingKey = null; render();
  });

  window.addEventListener('online', () => { if (state.token) { if (state.mode === 'remote') flushRemoteQueue().then(() => refresh()).catch(error => { state.connection = error.message; renderAfterRefresh(); }); else refresh().catch(error => { state.connection = error.message; renderAfterRefresh(); }); } });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.token) { refresh().catch(error => { state.connection = error.message; renderAfterRefresh(); }); pollAlerts(); }
  });
  setInterval(() => { if (state.token && document.visibilityState === 'visible') refresh().catch(error => { state.connection = error.message; renderAfterRefresh(); }); }, 15000);
  setInterval(() => { if(!state.token)return; if(state.mode==='remote')refreshRemote().catch(()=>{}); else api('/notifications').then(receiveNotifications).catch(()=>{}); }, 12000);
  setInterval(() => { if (state.mode === 'remote') flushRemoteQueue().catch(() => {}); else pollAlerts(); }, 4500);

  // Service Worker só é ativado em HTTPS/localhost. O acesso por IP local HTTP não é contexto seguro.
  if ('serviceWorker' in navigator && window.isSecureContext) { const swPath = remoteConfig.remoteOnly ? './sw.js' : '/mobile/sw.js'; navigator.serviceWorker.register(swPath).catch(error => console.warn('Cache PWA indisponível:', error)); }
  restore();
})();
