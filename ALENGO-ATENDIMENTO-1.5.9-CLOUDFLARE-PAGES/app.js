'use strict';
/* ALENGO ESPETINHOS Web — cliente web local, compatível com o contrato REST do app móvel 1.3.4. */
(() => {
  const STORE_KEY = 'alengo-web-session-v1';
  const localDateKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const $ = (selector, root = document) => root.querySelector(selector);
  const view = $('#view');
  // Histórico interno de telas: permite que Voltar do navegador/aparelho
  // percorra as telas do atendimento sem recarregar o aplicativo.
  let navigationHistoryReady = false;
  let navigationHistoryDepth = 0;
  let lastHistoryScreen = null;
  let resetNavigationOnRender = false;
  const validScreens = new Set(['login','home','tables','payment-tables','payment','catalog','cart','orders','notifications']);
  function syncNavigationHistory() {
    const screen = validScreens.has(state.screen) ? state.screen : 'home';
    if (!navigationHistoryReady) {
      history.replaceState({ alengoApp: true, screen }, '', location.href);
      navigationHistoryReady = true;
      lastHistoryScreen = screen;
      navigationHistoryDepth = 0;
      return;
    }
    if (screen === lastHistoryScreen) return;
    // Login, logout e operações concluídas iniciam uma nova raiz de navegação.
    if (resetNavigationOnRender || !state.token || lastHistoryScreen === 'login') {
      history.replaceState({ alengoApp: true, screen }, '', location.href);
      navigationHistoryDepth = 0;
      resetNavigationOnRender = false;
    } else {
      history.pushState({ alengoApp: true, screen }, '', location.href);
      navigationHistoryDepth += 1;
    }
    lastHistoryScreen = screen;
  }
  function resetNavigationHistory() { resetNavigationOnRender = true; }
  function goBack() {
    if (navigationHistoryDepth > 0) { history.back(); return; }
    const parents = { tables:'home', 'payment-tables':'home', payment:'payment-tables', cart:'catalog', catalog:state.orderType === 'RETIRADA' ? 'home' : 'tables', orders:'home', notifications:'home' };
    const parent = parents[state.screen];
    if (!parent) return;
    state.screen = parent;
    history.replaceState({ alengoApp: true, screen: parent }, '', location.href);
    lastHistoryScreen = parent;
    render();
  }
  window.addEventListener('popstate', event => {
    if (!event.state?.alengoApp || !validScreens.has(event.state.screen)) return;
    state.screen = event.state.screen;
    lastHistoryScreen = state.screen;
    navigationHistoryDepth = Math.max(0, navigationHistoryDepth - 1);
    render();
  });

  const state = {
    token: '', user: '', operator: '', deviceId: '', password: '', historyDate: localDateKey(), historyOrders: [], historyLoading: false,
    screen: 'login', booting: true, busy: false, confirmingOrder:false, connection: '',
    tables: [], catalog: { products: [], kits: [] }, customers: [], myOrders: [], alerts: [], notifications: [], notifiedIds: new Set(),
    orderType: null, table: null, customer: '', customerId: null, search: '', tableSearch: '', categoryFilter:'all', cart: [],
    pendingKey: null, cancelTarget: null, cancelReason: '', alertIds: new Set(),
    serverOrigin: location.origin, mode: ((window.ALENGO_SUPABASE_CONFIG?.remoteOnly || new URLSearchParams(location.search).get('mode') === 'remote') ? 'remote' : 'local'),
    remoteUid: '', remoteRefreshToken: '', remoteExpiresAt: 0, remoteSnapshot: null, remoteOrderPending: false, operatorPermissions:{}, cashOpen:false, paymentTableId:null, paymentMethod:'PIX', paymentFee:'0', paymentInstallments:'1', paymentPrint:true, paymentPendingKey:null, paymentLines:[{method:'PIX',amount:''}]
  };
  const ACCESSIBILITY_KEY = 'alengo-accessibility-v1';
  const accessibilityDefaults = { fontScale: '100', contrast: 'normal', touch: 'normal' };
  function accessibilityPrefs() { try { return { ...accessibilityDefaults, ...JSON.parse(localStorage.getItem(ACCESSIBILITY_KEY) || '{}') }; } catch { return { ...accessibilityDefaults }; } }
  function applyAccessibilityPrefs() {
    const prefs = accessibilityPrefs();
    document.documentElement.dataset.fontScale = prefs.fontScale;
    document.documentElement.dataset.contrast = prefs.contrast;
    document.documentElement.dataset.touch = prefs.touch;
  }
  applyAccessibilityPrefs();
  const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const normalizeIp = value => String(value || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:[0-9]+$/, '');
  const deviceKey = () => 'web_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const orderKey = () => 'pedido_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  const paymentStorageKey = tableId => `alengo-pending-table-payment-v1:${state.remoteUid||state.operator}:${tableId}`;
  const cartStorageKey = () => `alengo-cart-draft-v1:${state.mode}:${state.remoteUid||state.operator||state.user}:${state.deviceId||'web'}`;
  const currentAddress = () => `${location.hostname}${location.port ? ':' + location.port : ''}`;
  let notificationAudioContext = null;
  const notificationDefaults = { volume:78, readySound:true, otherSound:true, vibration:true, pushEnabled:false };
  const notificationProfiles = {
    ready:{label:'Pedido pronto',file:'ready.wav',vibrate:[55,35,75]},
    partial:{label:'Parcialmente pronto',file:'partial.wav',vibrate:[35,45,35,45,65]},
    newOrder:{label:'Novo pedido',file:'new-order.wav',vibrate:[95,45,95]},
    help:{label:'Chamado do responsável',file:'help.wav',vibrate:[130,55,130,55,190]},
    general:{label:'Aviso geral',file:'general.wav',vibrate:[35,35,35]}
  };
  const notificationAudioBuffers = new Map();
  function notificationPrefs(){try{const key=`alengo-notification-prefs-v2:${state.remoteUid||state.operator||state.user||state.deviceId||'device'}`;const oldKey=`alengo-notification-prefs-v1:${state.remoteUid||state.operator||state.user||state.deviceId||'device'}`;return {...notificationDefaults,...JSON.parse(localStorage.getItem(key)||localStorage.getItem(oldKey)||'{}')}}catch{return {...notificationDefaults}}}
  function saveNotificationPrefs(prefs){try{localStorage.setItem(`alengo-notification-prefs-v2:${state.remoteUid||state.operator||state.user||state.deviceId||'device'}`,JSON.stringify({...notificationDefaults,...prefs}))}catch{notify('Não foi possível salvar as preferências de som neste aparelho.')}}
  async function unlockNotificationAudio(){const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return false;notificationAudioContext=notificationAudioContext||new Ctx();if(notificationAudioContext.state==='suspended')await notificationAudioContext.resume();return notificationAudioContext.state==='running'}
  function notificationKind(item){const kind=String(item?.kind||'').toUpperCase(),text=`${item?.title||''} ${item?.message||''}`.toLocaleLowerCase('pt-BR');if(kind==='ORDER_READY_PARTIAL'||/parcialmente pronto/.test(text))return 'partial';if(kind==='ORDER_READY_COMPLETE'||/^ORDER_READY/.test(kind)||/pedido .*pronto|todos os itens.*prontos/.test(text))return 'ready';if(kind==='HELP_REQUEST'||/solicitou apoio|chamou o respons.vel/.test(text))return 'help';if(kind==='ORDER_RECEIVED'||/novo pedido/.test(text))return 'newOrder';return 'general'}
  async function loadNotificationAudio(eventType){
    const profile=notificationProfiles[eventType]||notificationProfiles.general;
    if(notificationAudioBuffers.has(eventType))return notificationAudioBuffers.get(eventType);
    const response=await fetch(`./sounds/${profile.file}`,{cache:'force-cache'});
    if(!response.ok)throw new Error('Arquivo de áudio indisponível.');
    const decoded=await notificationAudioContext.decodeAudioData(await response.arrayBuffer());
    notificationAudioBuffers.set(eventType,decoded);return decoded;
  }
  async function playNotificationSound(eventType='ready',preview=false){
    try{
      const prefs=notificationPrefs(),profile=notificationProfiles[eventType]||notificationProfiles.general;
      if(prefs.vibration&&'vibrate'in navigator)navigator.vibrate(profile.vibrate);
      const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return false;
      notificationAudioContext=notificationAudioContext||new Ctx();
      if(notificationAudioContext.state==='suspended')await notificationAudioContext.resume();
      if(notificationAudioContext.state!=='running')return false;
      const buffer=await loadNotificationAudio(eventType),source=notificationAudioContext.createBufferSource(),master=notificationAudioContext.createGain();
      master.gain.value=(Math.max(0,Math.min(100,Number(prefs.volume)||0))/100)*.92;
      source.buffer=buffer;source.connect(master);master.connect(notificationAudioContext.destination);source.start();
      return Number(prefs.volume)>0;
    }catch{return false;}
  }
  function notificationIsReady(item){return ['ready','partial'].includes(notificationKind(item))}
  const notify = (message, duration = 3800) => {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.add('hidden'), duration);
  };
  function askConfirmation({title='Confirmar ação',message='Deseja continuar?',confirmLabel='Confirmar',danger=false}={}) {
    return new Promise(resolve => {
      let modal=$('#alengo-confirm');
      if(!modal){
        modal=document.createElement('div');modal.id='alengo-confirm';modal.className='confirm-backdrop hidden';modal.innerHTML=`<section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title"></h2><p id="confirm-message"></p><div class="confirm-actions"><button type="button" class="btn secondary" data-confirm="no">Voltar</button><button type="button" class="btn" data-confirm="yes">Confirmar</button></div></section>`;document.body.appendChild(modal);
      }
      $('#confirm-title',modal).textContent=title;$('#confirm-message',modal).textContent=message;
      const yes=$('[data-confirm="yes"]',modal);yes.textContent=confirmLabel;yes.classList.toggle('danger',!!danger);
      modal.classList.remove('hidden');
      const finish=value=>{modal.classList.add('hidden');modal.removeEventListener('click',onClick);document.removeEventListener('keydown',onKey);resolve(value)};
      const onClick=e=>{const action=e.target.closest('[data-confirm]')?.dataset.confirm;if(action)finish(action==='yes');else if(e.target===modal)finish(false)};
      const onKey=e=>{if(e.key==='Escape'){e.preventDefault();finish(false)}};
      modal.addEventListener('click',onClick);document.addEventListener('keydown',onKey);$('[data-confirm="no"]',modal).focus();
    });
  }
  const saveSession = () => {
    const saved = { serverOrigin: location.origin, user: state.user, operator: state.operator, token: state.token, deviceId: state.deviceId, mode: state.mode, remoteUid: state.remoteUid, remoteRefreshToken: state.remoteRefreshToken, remoteExpiresAt: state.remoteExpiresAt }; 
    try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); }
    catch { notify('Não foi possível salvar a sessão neste navegador.'); }
  };
  const clearSession = () => { try { localStorage.removeItem(STORE_KEY); } catch {} };
  function persistCartDraft() {
    if (!state.token) return;
    const key=cartStorageKey();
    if (!state.cart.length && !state.customer && !state.orderType) { try { localStorage.removeItem(key); } catch {} return; }
    try { localStorage.setItem(key,JSON.stringify({cart:state.cart,customer:state.customer,customerId:state.customerId,orderType:state.orderType,tableId:state.table?.id||null,search:state.search,pendingKey:state.pendingKey,remoteOrderPending:state.remoteOrderPending,updated_at:new Date().toISOString()})); } catch { notify('Não foi possível salvar o rascunho do pedido neste aparelho.'); }
  }
  function restoreCartDraft() {
    try {
      const draft=JSON.parse(localStorage.getItem(cartStorageKey())||'null');
      if(!draft||!Array.isArray(draft.cart))return false;
      state.cart=draft.cart.slice(0,70);state.customer=String(draft.customer||'');state.customerId=draft.customerId||null;state.orderType=draft.orderType==='RETIRADA'?'RETIRADA':draft.orderType==='MESA'?'MESA':null;state.table=state.orderType==='MESA'?(state.tables||[]).find(t=>Number(t.id)===Number(draft.tableId))||null:null;state.search=String(draft.search||'');state.pendingKey=draft.pendingKey||null;state.remoteOrderPending=!!draft.remoteOrderPending;
      if(state.remoteOrderPending)state.screen='cart';else if(state.orderType==='RETIRADA')state.screen='catalog';else if(state.orderType==='MESA')state.screen=state.table?'catalog':'tables';
      return true;
    } catch { return false; }
  }
  function clearCartDraft(){try{localStorage.removeItem(cartStorageKey())}catch{}}

  const remoteConfig = window.ALENGO_SUPABASE_CONFIG || {};
  const REMOTE_QUEUE_DB = 'alengo-remote-queue-v1';
  const REMOTE_QUEUE_STORE = 'requests';
  let remoteFlushing = false;
  let installPromptEvent = null;
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
    restoreCartDraft();
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
    const previousGeneration=Number(state.remoteSnapshot?.operational_generation||1),nextGeneration=Number(snapshot.operational_generation||1);
    if(previousGeneration!==nextGeneration){
      const queued=await queueRemoteGetAll();let discarded=0;
      for(const item of queued){const itemGeneration=Number(item.operational_generation||item.payload?._operational_generation||1);if(item.auth_user_id===state.remoteUid&&itemGeneration!==nextGeneration){await queueRemoteDelete(item.id);discarded++;}}
      const completed=JSON.parse(localStorage.getItem('alengo-remote-completed-v1')||'{}');for(const key of Object.keys(completed))if(key.startsWith(`${state.remoteUid}:`)&&!key.startsWith(`${state.remoteUid}:${nextGeneration}:`))delete completed[key];localStorage.setItem('alengo-remote-completed-v1',JSON.stringify(completed));
      state.pendingKey=null;state.remoteOrderPending=false;state.paymentPendingKey=null;
      for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key&&key.startsWith(`alengo-pending-table-payment-v1:${state.remoteUid}:`))localStorage.removeItem(key);}
      if(discarded)notify(`O PDV iniciou uma nova geração de dados. ${discarded} operação(ões) offline antiga(s) foram descartadas; confira o rascunho antes de reenviar.`,7000);
    }
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
    let confirmationDelay = 700;
    while (Date.now() < until) {
      rows = await supabaseFetch(`/rest/v1/remote_requests?${filter}`);
      if (rows.length && rows[0].status === 'CONFIRMED') {
        await queueRemoteDelete(item.id);
        const completed = JSON.parse(localStorage.getItem('alengo-remote-completed-v1') || '{}'); const generation=Number(item.operational_generation||item.payload?._operational_generation||1); completed[`${state.remoteUid}:${generation}:${item.request_key}`] = rows[0].response; const keys = Object.keys(completed); while (keys.length > 80) delete completed[keys.shift()]; localStorage.setItem('alengo-remote-completed-v1', JSON.stringify(completed));
        return rows[0].response;
      }
      if (rows.length && rows[0].status === 'ERROR') {
        await queueRemoteDelete(item.id);
        const response = rows[0].response || {}; const failure = new Error(response.error || 'O Windows recusou a solicitação remota.'); failure.pending = false; failure.businessError = true; throw failure;
      }
      await new Promise(resolve => setTimeout(resolve, confirmationDelay));
      confirmationDelay = Math.min(1400, Math.round(confirmationDelay * 1.25));
    }
    const pendingError = new Error('Solicitação salva na fila remota, aguardando confirmação do Windows.'); pendingError.pending = true; throw pendingError;
  }
  async function remoteCommand(type, payload, requestKey) {
    if(state.remoteSnapshot?.generated_at&&Date.now()-Date.parse(state.remoteSnapshot.generated_at)>10000&&navigator.onLine)await refreshRemote();
    const completed = JSON.parse(localStorage.getItem('alengo-remote-completed-v1') || '{}');
    const generation=Number(state.remoteSnapshot?.operational_generation||1);
    const completedKey = `${state.remoteUid}:${generation}:${requestKey}`;
    if (completed[completedKey]) return completed[completedKey];
    let queue = await queueRemoteGetAll();
    let item = queue.find(x => x.auth_user_id === state.remoteUid && x.request_key === requestKey);
    if (!item) { item = { id: crypto.randomUUID(), auth_user_id: state.remoteUid, request_type: type, request_key: requestKey, payload:{...(payload||{}),_operational_generation:generation}, operational_generation:generation, created_at: new Date().toISOString() }; await queueRemotePut(item); }
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
          if (item.request_type === 'CREATE_ORDER' && item.request_key === `order:${state.pendingKey}`) {
            state.cart = []; state.customer = ''; state.customerId = null; state.pendingKey = null; state.remoteOrderPending = false; state.table = null; state.orderType = null; state.screen = 'home'; clearCartDraft(); resetNavigationHistory();
            notify('Pedido remoto confirmado e registrado pelo Windows.');
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
      if (path.startsWith('/orders/history')) { if (!navigator.onLine) throw new Error('Conecte-se à internet para consultar o histórico remoto.'); const date = new URLSearchParams(path.split('?')[1]||'').get('date')||state.historyDate; return remoteCommand('LIST_ORDERS_BY_DAY', {date}, `history:${date}:${orderKey()}`); }
      if (path === '/call-responsible') return remoteCommand('CALL_RESPONSIBLE', body||{}, `help:${orderKey()}`);
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
      const localPath = path==='/orders' ? '/web/orders' : path.startsWith('/orders/history') ? `/web/orders/history?${path.split('?')[1]||''}` : path==='/call-responsible' ? '/web/call-responsible' : path==='/orders/cancel' ? '/web/orders/cancel' : path==='/payments/table' ? '/web/payments/table' : path;
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
    const offline = !navigator.onLine || !!state.connection;
    const unread=state.notifications.filter(n=>!n.read_at).length;
    const activeOrders=state.myOrders.filter(o=>o.status==='ABERTO');
    const orderProgress=activeOrders.map(order=>{
      const total=(order.items||[]).reduce((n,item)=>n+Number(item.quantity||0),0);
      const done=(order.items||[]).reduce((n,item)=>n+Number(item.delivered_quantity||0),0);
      return total>0&&done>=total?'ready':done>0?'partial':'working';
    });
    const working=orderProgress.filter(x=>x==='working').length;
    const partial=orderProgress.filter(x=>x==='partial').length;
    const ready=orderProgress.filter(x=>x==='ready').length;
    const prefs=accessibilityPrefs();
    const connectionLabel=!navigator.onLine?'Sem internet':state.connection?(state.connection.toLowerCase().includes('windows')?'Aguardando o Windows':'Conexão instável'):'Conectado';
    const connectionDetail=state.remoteOrderPending?'Há operação aguardando confirmação':state.mode==='remote'?'Atendimento pela internet':`PDV · ${escapeHtml(currentAddress())}`;
    return `
      <section class="home-welcome"><div class="home-kicker">PAINEL DE ATENDIMENTO</div><div class="home-welcome-row"><div><h1>Olá, ${escapeHtml((state.operator||state.user||'operador').split(' ')[0])}.</h1><p>Vamos organizar o próximo atendimento?</p></div><span class="home-avatar">${escapeHtml((state.operator||state.user||'A').trim().slice(0,1).toUpperCase())}</span></div><div class="connection-pill ${offline?'is-offline':''}"><i></i><span>${connectionLabel}</span><small>${connectionDetail}</small></div></section>
      ${state.connection?`<div class="warning connection-warning">${escapeHtml(state.connection)}${state.remoteOrderPending?'<br>O pedido permanece salvo até a confirmação do Windows.':''}</div>`:''}
      ${(state.cart.length||state.orderType)?`<button class="resume-card" data-action="resume-cart"><span class="resume-icon">↻</span><span><strong>Continuar pedido em andamento</strong><small>Rascunho salvo neste aparelho</small></span><b>›</b></button>`:''}
      <section class="home-section order-status-panel"><div class="section-heading"><div><h2>Resumo dos pedidos</h2><p>${activeOrders.length?`${activeOrders.length} pedido(s) em aberto`:'Nenhum pedido em aberto'}</p></div><button class="text-action" data-action="my-orders">Ver pedidos ›</button></div><div class="status-metrics"><div><strong>${working}</strong><small>Em andamento</small></div><div><strong>${partial}</strong><small>Parciais</small></div><div><strong>${ready}</strong><small>Concluídos</small></div></div></section>
      ${state.operatorPermissions.send_orders!==false?`<section class="home-section"><div class="section-heading"><div><h2>Iniciar atendimento</h2><p>Escolha o tipo de pedido</p></div></div><div class="home-action-grid"><button class="home-action" data-action="choose-type" data-type="MESA"><span class="home-action-icon mesa">▦</span><span class="home-action-copy"><strong>Mesa</strong><small>Atendimento no salão</small></span><span class="home-action-arrow">›</span></button><button class="home-action" data-action="choose-type" data-type="RETIRADA"><span class="home-action-icon retirada">↗</span><span class="home-action-copy"><strong>Retirada</strong><small>Cliente leva o pedido</small></span><span class="home-action-arrow">›</span></button></div></section>`:`<section class="card">Seu perfil está configurado apenas para acompanhar o atendimento. Não há permissão para enviar novos pedidos.</section>`}
      <section class="home-section"><div class="section-heading"><div><h2>Acesso rápido</h2><p>Atalhos essenciais</p></div></div><div class="home-shortcuts"><button class="shortcut-card" data-action="my-orders"><span class="shortcut-icon orders">≡</span><span><strong>Meus pedidos</strong><small>${activeOrders.length?`${activeOrders.length} em aberto`:'Acompanhamento'}</small></span>${activeOrders.length?`<em>${activeOrders.length}</em>`:'<b>›</b>'}</button><button class="shortcut-card" data-action="notifications"><span class="shortcut-icon notices">♢</span><span><strong>Avisos</strong><small>${unread?`${unread} não lido(s)`:'Cozinha e caixa'}</small></span>${unread?`<em>${unread}</em>`:'<b>›</b>'}</button>${state.operatorPermissions.receive_table_payment?`<button class="shortcut-card" data-action="payment-tables"><span class="shortcut-icon payments">$</span><span><strong>Recebimentos</strong><small>Contas em aberto</small></span><b>›</b></button>`:''}<button class="shortcut-card" data-action="refresh"><span class="shortcut-icon refresh">↻</span><span><strong>Atualizar dados</strong><small>Sincronizar com o PDV</small></span><b>›</b></button></div></section>
      <details class="card accessibility-panel"><summary class="compact-disclosure"><span><strong>Acessibilidade e visual</strong><small>Ajustes discretos deste aparelho</small></span><span class="disclosure-count">Ajustar</span></summary><div class="accessibility-controls"><label class="field"><span>Tamanho do texto</span><select data-field="access-font"><option value="100" ${prefs.fontScale==='100'?'selected':''}>Padrão</option><option value="110" ${prefs.fontScale==='110'?'selected':''}>Um pouco maior</option><option value="120" ${prefs.fontScale==='120'?'selected':''}>Maior</option></select></label><label class="field"><span>Contraste</span><select data-field="access-contrast"><option value="normal" ${prefs.contrast==='normal'?'selected':''}>Padrão</option><option value="high" ${prefs.contrast==='high'?'selected':''}>Alto contraste</option></select></label><label class="field"><span>Área de toque</span><select data-field="access-touch"><option value="normal" ${prefs.touch==='normal'?'selected':''}>Padrão</option><option value="large" ${prefs.touch==='large'?'selected':''}>Botões maiores</option></select></label></div></details>
      <div class="home-footer-actions"><button class="text-action" data-action="logout">Sair deste aparelho</button><span>ALENGO ESPETINHOS · Atendimento</span></div>`;
  }

  function renderTables() {
    const filteredTables=state.tables.filter(table=>`${table.label||''} ${table.primary_operator_name||''}`.toLocaleLowerCase('pt-BR').includes(state.tableSearch.toLocaleLowerCase('pt-BR')));
    return `<h1 class="title">Selecione a mesa</h1><p class="subtitle">Escolha a mesa para vincular a comanda.</p><div class="table-legend"><span><i class="free"></i>Livre</span><span><i class="busy"></i>Em atendimento</span><span><i class="partial"></i>Parcial</span><span><i class="ready"></i>Entregue</span></div><label class="field table-search"><span>Buscar mesa</span><input data-field="table-search" value="${escapeHtml(state.tableSearch)}" placeholder="Número da mesa ou responsável..." autocomplete="off"></label>
      <div class="grid">${filteredTables.map(table => {const orders=state.myOrders.filter(o=>Number(o.table_id)===Number(table.id)&&o.status==='ABERTO');const total=orders.reduce((n,o)=>n+(o.items||[]).reduce((a,i)=>a+Number(i.quantity||0),0),0);const delivered=orders.reduce((n,o)=>n+(o.items||[]).reduce((a,i)=>a+Number(i.delivered_quantity||0),0),0);const status=!Number(table.open_orders)?'free':total>0&&orders.length>=Number(table.open_orders)&&delivered>=total?'ready':delivered>0?'partial':'busy';const statusText={free:'Livre',busy:'Em atendimento',partial:'Parcialmente entregue',ready:'Itens entregues'}[status];return `<button class="table table-${status}" data-action="select-table" data-id="${table.id}"><span class="table-state"><i></i>${statusText}</span><strong>MESA ${escapeHtml(table.label)}</strong><span class="help">${table.open_orders ? `${table.open_orders} pedidos · ${money(table.pending_cents)}` : 'Disponível'}</span>${table.primary_operator_name?`<span class="help">Responsável: ${escapeHtml(table.primary_operator_name)}</span>`:''}${state.operatorPermissions.receive_table_payment&&Number(table.open_orders)>0?`<span class="help">Toque para receber</span>`:''}</button>`}).join('')}</div>
      ${!state.tables.length ? '<div class="empty">Não há mesas cadastradas. Cadastre no PDV Windows.</div>' : !filteredTables.length ? '<div class="empty">Nenhuma mesa corresponde à busca.</div>' : ''}
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
    const allProducts=[...(state.catalog.products||[]).map(item=>({...item,isKit:false})),...(state.catalog.kits||[]).map(item=>({...item,isKit:true}))];
    const products=allProducts.filter(item=>String(item.name||'').toLowerCase().includes(state.search.toLowerCase())&&(state.categoryFilter==='all'||Number(item.category_id||0)===Number(state.categoryFilter)));
    const popular=(state.catalog.popular||[]).filter(item=>state.categoryFilter==='all'||Number(item.category_id||0)===Number(state.categoryFilter));
    const categories=state.catalog.categories||[];
    const productButton=item=>`<div class="product"><div class="details"><div class="product-name">${item.isKit?'Combo · ':''}${escapeHtml(item.name)}</div><div class="product-meta">${money(item.price_cents)}${item.isKit?'':` · Estoque: ${escapeHtml(item.stock)}`}</div></div><button class="btn small" data-action="add-product" data-id="${item.id}" data-kit="${item.isKit}" ${!item.isKit&&Number(item.stock)<1?'disabled':''}>+ Adicionar</button></div>`;
    return `<h1 class="title">${escapeHtml(label)} · Cardápio</h1>
      <label class="field"><span>Cliente (selecione um cadastro ou digite um nome)</span><input data-field="customer" list="customer-options" value="${escapeHtml(state.customer)}" placeholder="Pesquisar cliente por nome ou telefone..." autocomplete="off"><datalist id="customer-options">${state.customers.map(customer=>`<option value="${escapeHtml(customer.name)}" label="${escapeHtml(customer.phone||'Cliente cadastrado')}"></option>`).join('')}</datalist></label>
      <label class="field"><span>Pesquisar produto</span><input data-field="search" value="${escapeHtml(state.search)}" placeholder="Espeto, bebida, chopp..." autocomplete="off"></label>
      <button class="btn secondary" data-action="call-responsible">Chamar responsável</button>
      ${categories.length?`<div class="categorystrip"><button class="cat ${state.categoryFilter==='all'?'active':''}" data-action="category-filter" data-id="all">Todos</button>${categories.map(c=>`<button class="cat ${String(state.categoryFilter)===String(c.id)?'active':''}" data-action="category-filter" data-id="${c.id}">${escapeHtml(c.name)}</button>`).join('')}</div>`:''}
      ${popular.length&&!state.search&&state.categoryFilter==='all'?`<section class="card"><div class="card-title">Mais pedidos · últimos 30 dias</div>${popular.map(productButton).join('')}</section>`:''}
      <section class="card">${products.map(productButton).join('')||'<div class="empty">Nenhum produto encontrado nesta categoria.</div>'}</section>
      <button class="btn" data-action="open-cart" ${state.cart.length?'':'disabled'}>Ver carrinho (${state.cart.length})</button>
      <button class="btn secondary" data-action="home">Voltar ao início</button>`;
  }

  function renderCart() {
    const label = state.orderType === 'RETIRADA' ? 'RETIRADA' : `MESA ${state.table?.label || ''}`;
    const total = state.cart.reduce((sum, item) => sum + Number(item.price_cents) * Number(item.quantity), 0);
    const units=state.cart.reduce((sum,item)=>sum+Number(item.quantity||0),0);
    return `<h1 class="title">${escapeHtml(label)} · Comanda</h1><p class="subtitle">Cliente: ${escapeHtml(state.customer || 'não informado')} · ${state.cart.length} item(ns) · ${units} unidade(s)</p>
      ${state.remoteOrderPending?'<div class="warning pending-order-warning">Este pedido já foi enviado e aguarda confirmação do Windows. Não envie novamente nem altere os itens enquanto a confirmação estiver pendente.</div>':''}
      ${state.cart.map(item => `<div class="card cart-line"><div class="row between"><div class="grow"><div class="card-title">${escapeHtml(item.name)}</div><div class="product-meta">${money(item.price_cents)} cada · <strong>${money(item.price_cents * item.quantity)}</strong></div></div><div class="cart-quantity"><button class="btn secondary small" aria-label="Diminuir ${escapeHtml(item.name)}" data-action="quantity" data-id="${escapeHtml(item.cartId)}" data-delta="-1" ${state.remoteOrderPending ? 'disabled' : ''}>−</button><span class="qty">${item.quantity}</span><button class="btn small" aria-label="Aumentar ${escapeHtml(item.name)}" data-action="quantity" data-id="${escapeHtml(item.cartId)}" data-delta="1" ${state.remoteOrderPending ? 'disabled' : ''}>+</button></div></div><label class="field cart-note"><span>Observação para preparo</span><textarea data-note="${escapeHtml(item.cartId)}" placeholder="Ex.: bem passado, sem molho" ${state.remoteOrderPending ? 'readonly' : ''}>${escapeHtml(item.notes)}</textarea></label><button class="text-action cart-remove" data-action="remove-cart-item" data-id="${escapeHtml(item.cartId)}" ${state.remoteOrderPending?'disabled':''}>Remover item</button></div>`).join('')}
      <div class="total">Total do pedido: ${money(total)}</div>
      <button class="btn" data-action="send-order" ${state.busy || state.confirmingOrder || state.remoteOrderPending || state.customer.trim().length < 2 || !state.cart.length ? 'disabled' : ''}>${state.busy ? 'Enviando...' : state.confirmingOrder ? 'Aguardando confirmação...' : state.remoteOrderPending ? 'Aguardando confirmação do Windows' : 'Enviar comanda para cozinha'}</button>
      <button class="btn secondary" data-action="catalog" ${state.remoteOrderPending ? 'disabled' : ''}>Adicionar mais itens</button>
      <button class="btn secondary" data-action="call-responsible">Chamar responsável</button>
      <p class="help">O envio usa uma chave única para evitar duplicidade. Se houver falha de conexão, a mesma operação será retomada sem criar outra comanda.</p>`;
  }

  function renderNotifications() {
    const items = [...state.notifications].sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0));
    const prefs=notificationPrefs();
    const pushActive=!!prefs.pushEnabled;
    const iosPushNote=/iphone|ipad|ipod/i.test(navigator.userAgent)?'No iPhone/iPad, primeiro instale o atendimento pela opção Compartilhar → Adicionar à Tela de Início. Depois abra pelo ícone e ative o Push.':'No Android, permita as notificações quando o navegador solicitar. O aparelho também precisa permitir notificações para este aplicativo.';
    return `<div class="screen-heading page-head"><div><span class="eyebrow">CENTRAL DE AVISOS</span><h1 class="title">Notificações</h1><p class="subtitle">Acompanhe pedidos liberados pela cozinha e comunicados do caixa.</p></div><span class="unread-count">${items.filter(n=>!n.read_at).length} não lidas</span></div>
      <details class="card notification-settings notification-settings-collapsible"><summary class="compact-disclosure"><span><strong>Som, alertas e notificações Push</strong><small>Personalize os avisos deste aparelho</small></span><span class="disclosure-count">${pushActive?'Push ativo':'Configurações'}</span></summary>
        <div class="notification-settings-content"><div class="settings-heading"><span class="settings-icon">♫</span><div><div class="card-title">Som e alertas</div><p class="help">Toques diferentes para cada situação. Ajustes salvos neste aparelho.</p></div></div>
        <div class="sound-profile-grid">${Object.entries(notificationProfiles).map(([key,profile])=>`<div class="sound-profile"><span class="sound-dot ${key}"></span><div><strong>${profile.label}</strong><small>${key==='ready'?'Liberação completa':key==='partial'?'Liberação de alguns itens':key==='newOrder'?'Pedido recebido':key==='help'?'Solicitação de apoio':'Outros comunicados'}</small></div><button type="button" class="sound-preview" data-action="notification-preview" data-sound="${key}" aria-label="Testar ${profile.label}">▶</button></div>`).join('')}</div>
        <label class="volume-control"><span><strong>Volume do toque</strong><b id="notification-volume-value">${Number(prefs.volume)}%</b></span><input id="notification-volume" type="range" min="0" max="100" step="5" value="${Number(prefs.volume)}" aria-label="Volume do toque"><small>O volume do site é independente do volume geral do aparelho.</small></label>
        <div class="notification-pref-row"><label><input id="notification-ready-sound" type="checkbox" ${prefs.readySound?'checked':''}> Som para pedidos prontos</label></div><div class="notification-pref-row"><label><input id="notification-other-sound" type="checkbox" ${prefs.otherSound?'checked':''}> Som para os demais avisos</label></div><div class="notification-pref-row"><label><input id="notification-vibration" type="checkbox" ${prefs.vibration?'checked':''}> Vibração, quando suportada</label></div>
        <div class="push-panel"><div><strong>Notificações em segundo plano</strong><p>Receba avisos do sistema mesmo quando o atendimento não estiver aberto na tela.</p><small>${pushActive?'Este aparelho está marcado como ativado.':'Ative neste aparelho e permita as notificações do navegador.'}</small><small class="push-instructions">${iosPushNote}</small></div><button class="btn ${pushActive?'secondary':'push-enable'} small" data-action="notification-push">${pushActive?'Reconfigurar Push':'Ativar Push'}</button>${pushActive?`<button class="text-action push-disable" data-action="notification-push-disable">Desativar</button>`:''}</div></div>
      </details>
      <div class="history-toolbar"><span class="help">${items.length} aviso(s) no histórico</span><button class="btn secondary small" data-action="notifications-read" ${items.some(n=>!n.read_at)?'':'disabled'}>Marcar como lidas</button></div>
      <section class="notification-history">${items.map(item=>`<details class="notification-entry ${item.read_at?'read':'unread'}"><summary class="notification-entry-summary"><span class="notification-mark">${item.read_at?'✓':'●'}</span><span class="notification-summary-copy"><strong>${escapeHtml(item.title||'Aviso')}</strong><span class="notification-preview">${escapeHtml(item.message||'')}</span><small>${item.created_at?new Date(item.created_at).toLocaleString('pt-BR'):'Agora'}</small></span><span class="notification-chevron">⌄</span></summary><div class="notification-entry-full">${escapeHtml(item.message||'')}</div></details>`).join('')||'<div class="empty">Nenhuma notificação registrada.</div>'}</section>`;
  }

  function renderOrders() {
    const activeOrders = [...state.myOrders];
    return `<div class="screen-heading page-head"><div><span class="eyebrow">ACOMPANHAMENTO</span><h1 class="title">Meus pedidos</h1><p class="subtitle">Confira o andamento e expanda somente os pedidos que precisar atualizar.</p></div><span class="unread-count">${activeOrders.length} ativos</span></div>
      <button class="btn secondary orders-refresh" data-action="refresh">↻ Atualizar pedidos</button>
      <section class="orders-compact-list">${activeOrders.map(order => {
        const total = order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const delivered = order.items.reduce((sum, item) => sum + Number(item.delivered_quantity || 0), 0);
        const place = order.order_type === 'RETIRADA' ? 'RETIRADA' : `MESA ${state.tables.find(table => table.id === order.table_id)?.label || order.table_id || '-'}`;
        const paymentLabel = order.status === 'PAGO' ? 'Pago' : 'Aguardando pagamento';
        return `<details class="card order-compact-card"><summary class="order-compact-summary"><span class="order-summary-main"><strong>#${order.id} · ${escapeHtml(place)}</strong><small>${escapeHtml(order.customer_name||'Cliente não informado')} · ${money(order.total_cents)}</small><small>${delivered}/${total} unidades prontas e entregues · ${paymentLabel}</small></span><span class="order-summary-side"><span class="order-status ${delivered>=total&&total>0?'is-ready':delivered>0?'is-partial':'is-waiting'}">${delivered>=total&&total>0?'Concluído':delivered>0?'Parcial':'Em andamento'}</span><span class="order-chevron">⌄</span></span></summary>
          <div class="order-compact-content">${order.items.map(item => `<div class="delivery"><div class="details"><div class="product-name">${escapeHtml(item.name)}</div><div class="product-meta">${Number(item.delivered_quantity || 0)}/${Number(item.quantity || 0)} pronta(s) e entregue(s)${item.notes ? ` · ${escapeHtml(item.notes)}` : ''}</div></div><button class="btn secondary small" data-action="delivery" data-order="${order.id}" data-item="${item.id}" data-delta="-1" ${state.busy || Number(item.delivered_quantity || 0) <= 0 ? 'disabled' : ''}>−</button><button class="btn small" data-action="delivery" data-order="${order.id}" data-item="${item.id}" data-delta="1" ${state.busy || Number(item.delivered_quantity || 0) >= Number(item.quantity || 0) ? 'disabled' : ''}>Pronto + entregue</button></div>`).join('')}
          ${state.operatorPermissions.cancel_orders && order.status === 'ABERTO' && delivered === 0 ? `<button class="btn danger" data-action="cancel-order" data-id="${order.id}">Cancelar este pedido</button>` : ''}</div></details>`;
      }).join('') || '<div class="empty">Não há pedidos ativos neste aparelho.</div>'}</section>
      <details class="card order-history-panel order-history-collapsible"><summary class="compact-disclosure"><span><strong>Histórico de pedidos</strong><small>Consulte pedidos de dias anteriores, pagos ou cancelados</small></span><span class="disclosure-count">${state.historyOrders.length?'Resultados: '+state.historyOrders.length:'Consultar'}</span></summary><div class="order-history-content"><label class="field"><span>Dia de operação</span><input type="date" data-field="orders-history-date" value="${escapeHtml(state.historyDate)}"></label><button class="btn secondary" data-action="orders-history" ${state.historyLoading?'disabled':''}>${state.historyLoading?'Consultando...':'Consultar dia'}</button>${state.historyOrders.length?state.historyOrders.map(order=>`<article class="card"><strong>#${order.id} · ${order.order_type==='RETIRADA'?'Retirada':`Mesa ${state.tables.find(t=>t.id===order.table_id)?.label||order.table_id||'-'}`} · ${escapeHtml(order.customer_name||'')}</strong><div class="product-meta">${new Date(order.created_at).toLocaleString('pt-BR')} · ${escapeHtml(order.operator_name||'')} · ${money(order.total_cents)} · ${escapeHtml(order.status)}</div>${order.status==='CANCELADO'?`<p class="help">Cancelado por ${escapeHtml(order.cancelled_by||'-')} · Motivo: ${escapeHtml(order.cancel_reason||'Não informado')}</p>`:''}<small>${(order.items||[]).map(item=>`${Number(item.quantity||0)}× ${escapeHtml(item.name)}`).join(' · ')}</small><button class="btn secondary small" data-action="repeat-order" data-id="${order.id}">Repetir pedido</button></article>`).join(''):'<p class="help">Nenhum histórico carregado para esta data.</p>'}</div></details>
      <button class="btn secondary" data-action="home">Voltar ao início</button>`;
  }

  function renderBottomNav(){const active=state.screen,orders=state.myOrders.filter(o=>o.status==='ABERTO').length,unread=state.notifications.filter(n=>!n.read_at).length;return `<nav class="bottom-nav" aria-label="Navegação principal"><button data-action="home" class="${active==='home'?'active':''}"><span>⌂</span><small>Início</small></button><button data-action="my-orders" class="${active==='orders'?'active':''}"><span>≡</span><small>Pedidos</small>${orders?`<i class="nav-count">${orders>99?'99+':orders}</i>`:''}</button><button data-action="notifications" class="${active==='notifications'?'active':''}"><span>♢</span><small>Avisos</small>${unread?`<i class="nav-count">${unread>99?'99+':unread}</i>`:''}</button></nav>`;}

  function render() {
    syncNavigationHistory();
    persistCartDraft();
    const active = document.activeElement;
    const focusInfo = active && view.contains(active) ? {
      field: active.dataset?.field || '', note: active.dataset?.note || '', name: active.name || '',
      start: typeof active.selectionStart === 'number' ? active.selectionStart : null,
      end: typeof active.selectionEnd === 'number' ? active.selectionEnd : null
    } : null;
    $('#operator-label').textContent = state.token ? (state.operator || state.user) : 'CONECTAR AO CAIXA';
    $('#top-home').classList.toggle('hidden', !state.token || state.screen === 'home');
    $('#top-home').textContent = '← Voltar';
    if (state.booting) { view.innerHTML = '<div class="loading">Restaurando acesso salvo...</div>'; return; }
    if (!state.token) view.innerHTML = renderLogin();
    else if (state.screen === 'home') view.innerHTML = renderHome();
    else if (state.screen === 'tables') view.innerHTML = renderTables();
    else if (state.screen === 'payment-tables') view.innerHTML = renderPaymentTables();
    else if (state.screen === 'payment') view.innerHTML = renderPayment();
    else if (state.screen === 'catalog') view.innerHTML = renderCatalog();
    else if (state.screen === 'cart') view.innerHTML = renderCart();
    else if (state.screen === 'orders') view.innerHTML = renderOrders();
    else if (state.screen === 'notifications') view.innerHTML = renderNotifications();
    else view.innerHTML = renderHome();
    if(state.token)view.insertAdjacentHTML('beforeend',renderBottomNav());
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
      if (state.mode === 'remote') { state.token = saved.token; state.operator = saved.operator || saved.user || ''; state.screen = 'home'; try { await refreshRemote(); restoreCartDraft(); await flushRemoteQueue(); } catch (error) { if (error.accessDenied || error.status === 401) { clearSession(); state.token = ''; state.remoteRefreshToken = ''; state.remoteUid = ''; state.connection = error.message; state.screen = 'login'; } else { const cached = JSON.parse(localStorage.getItem('alengo-remote-snapshot-v1') || 'null'); if (cached) { state.remoteSnapshot = cached; state.tables = cached.tables || []; state.catalog = cached.catalog || { products: [], kits: [] }; state.customers = cached.customers || []; state.myOrders = cached.orders || []; restoreCartDraft(); state.connection = `Sem internet: ${error.message}`; } else { state.connection = error.message; } } } return; }
      state.token = saved.token;
      state.operator = saved.operator || saved.user || '';
      const info = await api('/me');
      state.operator = info.operator; state.operatorPermissions=info.permissions||{};
      state.screen = 'home';
      saveSession();
      await refresh().catch(error => { state.connection = `Sem conexão com o PDV. Confira o Wi-Fi ou o endereço do computador. ${error.message}`; });
      restoreCartDraft();
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
      restoreCartDraft();
      notify(`Acesso liberado. Olá, ${state.operator}!`);
    } catch (error) { state.connection = error.message; notify(`Falha no acesso: ${error.message}`, 5200); }
    finally { state.busy = false; render(); }
  }

  async function logout() {
    if (!await askConfirmation({title:'Encerrar acesso?',message:'Será necessário entrar novamente com a senha neste aparelho. Deseja sair?',confirmLabel:'Encerrar acesso',danger:true})) return;
    if(state.mode==='remote'&&'serviceWorker'in navigator){try{const registration=await navigator.serviceWorker.ready,subscription=await registration.pushManager.getSubscription();if(subscription){if(navigator.onLine)await remoteCommand('UNREGISTER_PUSH',{endpoint:subscription.endpoint},await pushRequestKey('push-logout',subscription.endpoint)).catch(()=>{});await subscription.unsubscribe();}}catch{}}
    await api('/logout', 'POST', {}).catch(() => {});
    clearSession();
    clearCartDraft();
    if (state.mode === 'remote') { state.remoteUid = ''; state.remoteRefreshToken = ''; state.remoteExpiresAt = 0; }
    Object.assign(state, { token: '', operator: '', password: '', cart: [], table: null, orderType: null, alerts: [], screen: 'login', connection: '' });
    resetNavigationHistory();
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
      const prefs=notificationPrefs();
      const selected=fresh.find(item=>notificationIsReady(item)?prefs.readySound:prefs.otherSound);
      if(selected){const eventType=notificationKind(selected);playNotificationSound(eventType);}
      if('Notification' in window && Notification.permission==='granted' && document.visibilityState!=='visible')new Notification(latest.title||'ALENGO ESPETINHOS',{body:latest.message,icon:'./icon.png',tag:String(latest.event_key||latest.id)});
    }
  }
  function base64UrlToBytes(value){const normalized=String(value||'').replace(/-/g,'+').replace(/_/g,'/');const raw=atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,'='));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
  async function pushRequestKey(prefix,value){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value)));return `${prefix}:${[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,40)}`;}
  async function enableWebPush(){
    if(state.mode!=='remote'){notify('Notificações Push estão disponíveis no acesso pela internet.');return;}
    const iosDevice=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const standalone=window.matchMedia?.('(display-mode: standalone)')?.matches||window.navigator.standalone===true;
    if(iosDevice&&!standalone){notify('No iPhone/iPad, primeiro adicione o ALENGO à Tela de Início e abra pelo ícone. Depois volte aqui para ativar o Push.',8000);return;}
    if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){notify('Este navegador não oferece suporte completo a notificações Push.');return;}
    if(!navigator.onLine){notify('Conecte-se à internet para ativar as notificações Push.');return;}
    try{await unlockNotificationAudio();const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();if(permission!=='granted'){notify('Permita as notificações nas configurações do navegador.');return;}await refreshRemote();const publicKey=state.remoteSnapshot?.push_public_key;if(!publicKey){notify('O PDV Windows ainda não disponibilizou a chave Push. Atualize o ALENGO Windows e tente novamente.',6500);return;}const registration=await navigator.serviceWorker.ready;let subscription=await registration.pushManager.getSubscription();if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64UrlToBytes(publicKey)});const json=subscription.toJSON();await remoteCommand('REGISTER_PUSH',{subscription:json},await pushRequestKey('push-register',json.endpoint));const prefs=notificationPrefs();prefs.pushEnabled=true;saveNotificationPrefs(prefs);notify('Notificações Push ativadas neste aparelho. Faça um teste com a tela bloqueada.');render();}catch(error){notify(`Não foi possível ativar o Push: ${error.message}`,6500);}}
  async function disableWebPush(){try{const registration=await navigator.serviceWorker.ready,subscription=await registration.pushManager.getSubscription();if(subscription){await remoteCommand('UNREGISTER_PUSH',{endpoint:subscription.endpoint},await pushRequestKey('push-remove',subscription.endpoint));await subscription.unsubscribe();}const prefs=notificationPrefs();prefs.pushEnabled=false;saveNotificationPrefs(prefs);notify('Notificações Push desativadas neste aparelho.');render();}catch(error){notify(`Não foi possível desativar o Push: ${error.message}`,6000);}}

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
    if (state.busy || state.confirmingOrder || state.remoteOrderPending) return;
    if (state.orderType === 'MESA' && !state.table) return notify('Selecione uma mesa.');
    if (state.customer.trim().length < 2) return notify('Informe o nome do cliente.');
    if (!state.cart.length) return;
    const total=state.cart.reduce((sum,item)=>sum+Number(item.price_cents||0)*Number(item.quantity||0),0);
    const itemCount=state.cart.reduce((sum,item)=>sum+Number(item.quantity||0),0);
    state.confirmingOrder=true;render();
    const confirmed=await askConfirmation({title:'Enviar comanda?',message:`${state.orderType==='RETIRADA'?'Retirada':`Mesa ${state.table?.label||''}`} · ${state.customer.trim()} · ${itemCount} unidade(s) · ${money(total)}. Depois de confirmado pelo caixa, o pedido será encaminhado para preparo.`,confirmLabel:'Confirmar envio'});
    state.confirmingOrder=false;
    if(!confirmed){render();return;}
    const key = state.pendingKey || orderKey();
    state.pendingKey = key; persistCartDraft(); state.busy = true; render();
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
      resetNavigationHistory();
      await refresh().catch(error => { state.connection = error.message; });
      notify(`Pedido #${result.id} registrado e enviado ao PDV.`, 5000);
    } catch (error) { if (state.mode === 'remote') { if(error.pending || (!error.businessError && (!error.status || Number(error.status)>=500))) state.remoteOrderPending=true; else if(error.businessError){state.pendingKey=null;state.remoteOrderPending=false;} } notify(`Envio não confirmado: ${error.message}. ${error.pending || state.remoteOrderPending ? 'A mesma operação será retomada automaticamente; não crie outro pedido.' : 'Confira os dados e tente novamente.'}`, 6500); }
    finally { state.busy = false; render(); }
  }

  function repeatOrder(id){
    const order=state.historyOrders.find(x=>Number(x.id)===Number(id));if(!order)return;
    const cart=[];let skipped=0;
    for(const item of order.items||[]){
      const kit=item.kit_id?state.catalog.kits.find(x=>Number(x.id)===Number(item.kit_id)):null;
      const product=item.product_id?state.catalog.products.find(x=>Number(x.id)===Number(item.product_id)):null;
      const source=kit||product;if(!source){skipped++;continue;}
      cart.push({cartId:(kit?'kit_':'p_')+source.id,quantity:Math.max(1,Number(item.quantity||1)),notes:String(item.notes||''),name:source.name,price_cents:source.price_cents,...(kit?{kit_id:source.id}:{product_id:source.id})});
    }
    if(!cart.length)return notify('Os itens deste pedido não estão mais disponíveis no cardápio atual.');
    state.cart=cart;state.customer=String(order.customer_name||'');state.customerId=order.customer_id||null;state.orderType=order.order_type==='RETIRADA'?'RETIRADA':'MESA';state.table=state.orderType==='MESA'?(state.tables||[]).find(t=>Number(t.id)===Number(order.table_id))||null:null;state.pendingKey=null;state.remoteOrderPending=false;state.screen=state.orderType==='MESA'&&!state.table?'tables':'cart';
    if(skipped)notify(`${skipped} item(ns) não estão mais disponíveis e foram ignorados. Confira a comanda antes de enviar.`,6000);else notify('Pedido copiado para o carrinho. Confira os itens e valores antes de enviar.');render();
  }
  async function callResponsible(){
    const cooldownKey=`alengo-help-cooldown:${state.remoteUid||state.operator}:${state.deviceId||'web'}`;const last=Number(localStorage.getItem(cooldownKey)||0);if(Date.now()-last<30000)return notify('Aguarde alguns segundos antes de solicitar apoio novamente.');
    state.busy=true;render();try{await api('/call-responsible','POST',{table_id:state.table?.id||null,order_type:state.orderType||'',context:state.screen==='cart'?'Comanda em edição':'Cardápio'});localStorage.setItem(cooldownKey,String(Date.now()));notify('Solicitação de apoio confirmada pelo PDV Windows.');}
    catch(error){notify(error.pending?`Solicitação aguardando confirmação do Windows: ${error.message}`:`Não foi possível chamar o responsável: ${error.message}`,6500);}
    finally{state.busy=false;render();}
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
      await refresh(); state.screen = 'home'; resetNavigationHistory();
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

  async function chooseType(type) {
    if(state.remoteOrderPending)return notify('Existe um pedido aguardando confirmação do Windows. Aguarde a sincronização antes de iniciar outro.');
    if(state.cart.length&&!await askConfirmation({title:'Iniciar outro pedido?',message:'O rascunho atual será descartado deste aparelho. Deseja continuar?',confirmLabel:'Descartar e continuar',danger:true}))return;
    state.orderType = type; state.cart = []; state.customer = ''; state.customerId = null; state.table = null; state.pendingKey = null; state.remoteOrderPending=false; state.search = ''; state.categoryFilter='all'; clearCartDraft();
    if (type === 'RETIRADA') state.screen = 'catalog';
    else { state.screen = 'tables'; refresh().catch(error => { state.connection = error.message; renderAfterRefresh(); }); }
    render();
  }

  view.addEventListener('change', event => {
    const field=event.target.dataset.field;
    if(String(field||'').startsWith('payment-')) render();
    if(field==='orders-history-date')state.historyDate=event.target.value;
    if(['access-font','access-contrast','access-touch'].includes(field)){
      const prefs=accessibilityPrefs();
      if(field==='access-font')prefs.fontScale=event.target.value;
      if(field==='access-contrast')prefs.contrast=event.target.value;
      if(field==='access-touch')prefs.touch=event.target.value;
      try{localStorage.setItem(ACCESSIBILITY_KEY,JSON.stringify(prefs))}catch{}
      applyAccessibilityPrefs();
    }
  });

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
    if (field === 'customer') { state.customer = event.target.value; const match = state.customers.find(customer => String(customer.name || '').trim().toLocaleLowerCase('pt-BR') === state.customer.trim().toLocaleLowerCase('pt-BR')); state.customerId = match ? Number(match.id) : null; persistCartDraft(); }
    if (field === 'table-search') { state.tableSearch = event.target.value; const pos=event.target.selectionStart; render(); const next=view.querySelector('[data-field="table-search"]'); if(next){next.focus();try{next.setSelectionRange(pos,pos)}catch{}} return; }
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
      persistCartDraft();
    }
  });

  view.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'mode-local' && !remoteConfig.remoteOnly) { state.mode = 'local'; state.connection = ''; render(); }
    else if (action === 'mode-remote') { state.mode = 'remote'; state.connection = ''; render(); }
    else if (action === 'choose-type') chooseType(button.dataset.type);
    else if (action === 'category-filter') { state.categoryFilter=button.dataset.id||'all'; render(); }
    else if (action === 'resume-cart') { state.screen=state.orderType==='MESA'&&!state.table?'tables':state.cart.length?'cart':'catalog'; render(); }
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
      if (item) { if(Number(button.dataset.delta)<0&&item.quantity<=1){const ok=await askConfirmation({title:'Remover produto?',message:`Deseja retirar ${item.name} da comanda?`,confirmLabel:'Remover',danger:true});if(!ok)return;state.cart=state.cart.filter(entry=>entry!==item);}else item.quantity += Number(button.dataset.delta); state.pendingKey = null; persistCartDraft(); }
      render();
    } else if(action==='remove-cart-item') {const item=state.cart.find(entry=>entry.cartId===button.dataset.id);if(item){const ok=await askConfirmation({title:'Remover produto?',message:`Remover ${item.name} (${item.quantity} unidade(s)) desta comanda?`,confirmLabel:'Remover',danger:true});if(ok){state.cart=state.cart.filter(entry=>entry!==item);state.pendingKey=null;persistCartDraft();render();}}}
    else if (action === 'send-order') await sendOrder();
    else if (action === 'catalog') { state.screen = 'catalog'; render(); }
    else if (action === 'payment-tables') { state.screen='payment-tables'; await refresh().catch(error=>{state.connection=error.message}); render(); }
    else if (action === 'select-payment-table') { state.paymentTableId=Number(button.dataset.id); const due=state.myOrders.filter(o=>Number(o.table_id)===state.paymentTableId&&o.status==='ABERTO').reduce((n,o)=>n+Number(o.total_cents||0),0);let pending=null;try{pending=JSON.parse(localStorage.getItem(paymentStorageKey(state.paymentTableId))||'null')}catch{}state.paymentPendingKey=pending?.key||null;state.paymentLines=pending?.lines||[{method:'PIX',amount:(due/100).toFixed(2)}];if(pending){state.paymentFee=pending.fee||'0';state.paymentInstallments=pending.installments||'1';state.paymentPrint=pending.print!==false;}state.screen='payment'; render(); }
    else if (action === 'add-payment-line') { if(state.paymentLines.length<4)state.paymentLines=[...state.paymentLines,{method:'Dinheiro',amount:''}];render(); }
    else if (action === 'remove-payment-line') { state.paymentLines=state.paymentLines.filter((_,i)=>i!==Number(button.dataset.index));render(); }
    else if (action === 'confirm-table-payment') { const key=state.paymentPendingKey||orderKey(); state.paymentPendingKey=key;try{localStorage.setItem(paymentStorageKey(state.paymentTableId),JSON.stringify({key,lines:state.paymentLines,fee:state.paymentFee,installments:state.paymentInstallments,print:state.paymentPrint}))}catch{} state.busy=true; render(); try { const result=await api('/payments/table','POST',{table_id:state.paymentTableId,payments:state.paymentLines.map(l=>({method:l.method,original_cents:Math.round(Number(String(l.amount||'0').replace(',','.'))*100),fee_percent:l.method==='Cartão de crédito'?(Number(state.paymentFee)||0):0,installments:l.method==='Cartão de crédito'?(Number(state.paymentInstallments)||1):1})),method:state.paymentMethod,fee_percent:Number(state.paymentFee)||0,installments:Number(state.paymentInstallments)||1,print_receipt:state.paymentPrint,payment_key:key}); state.paymentPendingKey=null;try{localStorage.removeItem(paymentStorageKey(state.paymentTableId))}catch{} notify(`Pagamento registrado · Venda #${result.saleId} · ${money(result.total_cents)}`); state.screen='payment-tables'; await refresh(); } catch(error) { if(error.pending||!error.status){state.paymentPendingKey=key;try{localStorage.setItem(paymentStorageKey(state.paymentTableId),JSON.stringify({key,lines:state.paymentLines,fee:state.paymentFee,installments:state.paymentInstallments,print:state.paymentPrint}))}catch{}} else {state.paymentPendingKey=null;try{localStorage.removeItem(paymentStorageKey(state.paymentTableId))}catch{}} notify(error.pending?`Pagamento aguardando sincronização: ${error.message}`:`Pagamento não realizado: ${error.message}`,6500); } finally {state.busy=false;render();} }
    else if (action === 'notifications') { state.screen = 'notifications'; render(); }
    else if (action === 'my-orders') { state.screen = 'orders'; await refresh().catch(error => { state.connection = error.message; }); render(); }
    else if (action === 'orders-history') { state.historyLoading=true;render();try{state.historyOrders=await api(`/orders/history?date=${encodeURIComponent(state.historyDate)}`); }catch(error){notify(`Não foi possível consultar o histórico: ${error.message}`,6500);}finally{state.historyLoading=false;render();} }
    else if (action === 'repeat-order') repeatOrder(button.dataset.id);
    else if (action === 'call-responsible') await callResponsible();
    else if (action === 'refresh') { try { await refresh(); await pollAlerts(); notify('Dados atualizados.'); } catch (error) { state.connection = error.message; renderAfterRefresh(); notify(error.message); } }
    else if (action === 'delivery') await updateDelivery(button.dataset.order, button.dataset.item, button.dataset.delta);
    else if (action === 'cancel-order') await cancelOrder(button.dataset.id);
    else if (action === 'logout') await logout();
    else if (action === 'home') { if(state.cart.length&&!state.remoteOrderPending&&!await askConfirmation({title:'Voltar ao início?',message:'O pedido ainda não enviado será descartado. Deseja realmente sair da comanda?',confirmLabel:'Descartar pedido',danger:true}))return; if(state.remoteOrderPending)return notify('Há um pedido aguardando confirmação do Windows. Aguarde a sincronização antes de iniciar outro.'); state.screen = 'home'; state.orderType = null; state.table = null; state.customer = ''; state.customerId = null; state.cart = []; state.search = ''; state.pendingKey = null; clearCartDraft(); resetNavigationHistory(); render(); }
    else if (action === 'clear-alerts') { state.alerts = []; render(); }
    else if (action === 'notifications-read') await acknowledgeNotifications();
    else if (action === 'notification-permission') { await unlockNotificationAudio().catch(()=>false); if(!('Notification' in window))notify('Este navegador não oferece notificações do sistema; mantenha o site aberto para receber os avisos.'); else { const permission=await Notification.requestPermission(); notify(permission==='granted'?'Avisos do navegador ativados.':'Permissão de notificações não concedida.'); } }
    else if (action === 'notification-test') { const ok=await playNotificationSound('ready',true); if(!ok)notify('Não foi possível tocar o som. Toque novamente após liberar o áudio no navegador.'); }
    else if (action === 'notification-preview') { await unlockNotificationAudio(); const type=button.dataset.sound||'ready';const ok=await playNotificationSound(type,true);if(!ok)notify('Toque na tela e permita o áudio do navegador para ouvir a prévia.'); }
    else if (action === 'notification-push') await enableWebPush();
    else if (action === 'notification-push-disable') await disableWebPush();
  });

  view.addEventListener('input', event => {
    if(event.target?.id!=='notification-volume')return;
    const prefs=notificationPrefs();prefs.volume=Number(event.target.value);saveNotificationPrefs(prefs);
    const output=$('#notification-volume-value');if(output)output.textContent=`${prefs.volume}%`;
  });
  view.addEventListener('change', event => {
    const target=event.target;if(!target?.id)return;
    const fields={'notification-ready-sound':'readySound','notification-other-sound':'otherSound','notification-vibration':'vibration'};
    const field=fields[target.id];if(!field)return;
    const prefs=notificationPrefs();prefs[field]=target.type==='checkbox'?target.checked:target.value;saveNotificationPrefs(prefs);
  });

  $('#top-home').addEventListener('click', goBack);

  window.addEventListener('online', () => { if (state.token) { if (state.mode === 'remote') flushRemoteQueue().then(() => refresh()).catch(error => { state.connection = error.message; renderAfterRefresh(); }); else refresh().catch(error => { state.connection = error.message; renderAfterRefresh(); }); } });
  window.addEventListener('offline', () => { if(state.token){state.connection='Sem conexão com a internet. Os dados salvos neste aparelho continuam disponíveis; operações remotas aguardam sincronização.';renderAfterRefresh();} });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.token) { refresh().catch(error => { state.connection = error.message; renderAfterRefresh(); }); pollAlerts(); }
  });
  setInterval(() => {
    if (!state.token || document.visibilityState !== 'visible') return;
    if (state.mode === 'remote') refreshRemote().catch(error => { state.connection = error.message; renderAfterRefresh(); });
    else refresh().catch(error => { state.connection = error.message; renderAfterRefresh(); });
  }, 9000);
  setInterval(() => {
    if (!state.token) return;
    if (state.mode === 'remote') flushRemoteQueue().catch(() => {});
    else pollAlerts();
  }, 2500);

  // Service Worker só é ativado em HTTPS/localhost. O acesso por IP local HTTP não é contexto seguro.

  const installButton = $('#pwa-install');
  const isStandalone = () => window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  const isIosDevice = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroidDevice = () => /android/i.test(navigator.userAgent);
  if (installButton && !isStandalone()) {
    if (isIosDevice() || isAndroidDevice()) installButton.classList.remove('hidden');
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault(); installPromptEvent = event;
      installButton.classList.remove('hidden'); installButton.textContent = '＋ Instalar';
    });
    window.addEventListener('appinstalled', () => { installPromptEvent = null; installButton.classList.add('hidden'); notify('ALENGO ESPETINHOS instalado neste aparelho.'); });
    installButton.addEventListener('click', async () => {
      if (isStandalone()) { installButton.classList.add('hidden'); return; }
      if (installPromptEvent) {
        const prompt = installPromptEvent; installPromptEvent = null;
        try { await prompt.prompt(); const choice = await prompt.userChoice; if (choice?.outcome === 'accepted') installButton.classList.add('hidden'); }
        catch (error) { notify(`Não foi possível abrir a instalação: ${error.message}`); }
        return;
      }
      if (isIosDevice()) {
        notify('No Safari: toque em Compartilhar e escolha “Adicionar à Tela de Início”. Depois toque em Adicionar.', 8000);
      } else if (isAndroidDevice()) {
        notify('No Chrome: abra o menu ⋮ e escolha “Instalar app” ou “Adicionar à tela inicial”.', 8000);
      } else {
        notify('Use o menu do navegador e procure “Instalar aplicativo” ou “Adicionar à tela inicial”.', 8000);
      }
    });
  }

  if ('serviceWorker' in navigator && window.isSecureContext) { const swPath = remoteConfig.remoteOnly ? './sw.js' : '/mobile/sw.js'; navigator.serviceWorker.register(swPath).catch(error => console.warn('Cache PWA indisponível:', error)); }
  document.addEventListener('pointerdown',()=>{unlockNotificationAudio().catch(()=>{});},{once:true,passive:true});
  if('serviceWorker'in navigator)navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='ALENGO_PUSH'&&state.token&&state.mode==='remote')refreshRemote().catch(()=>{});});
  restore();
})();
