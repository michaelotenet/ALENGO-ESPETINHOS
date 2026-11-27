'use strict';
// ALENGO ESPETINHOS — módulo de mesas, pedidos, sincronização em LAN e impressão.
// Sem dependências externas; usa o mesmo SQLite do PDV, numa instalação isolada.
const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const https = require('node:https');
const fs = require('node:fs');
const pathModule = require('node:path');
const { BrowserWindow, Notification, safeStorage } = require('electron');
const { createRemoteBridge } = require('./remote-bridge');
const asInt = (v) => Number.isSafeInteger(Number(v)) ? Number(v) : NaN;
const utc = () => new Date().toISOString();
const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const rand = (n=24) => crypto.randomBytes(n).toString('hex');
const err = (message, code='VALIDATION') => Object.assign(new Error(message),{code});
const money = (c) => (c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc = (s) => String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

function initializeRestaurant(db) {
  const oldSchema=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='restaurant_orders'").get();
  if(oldSchema){
    const cols=db.prepare('PRAGMA table_info(restaurant_orders)').all();
    if(cols.some(c=>c.name==='table_id' && c.notnull===1)){
      db.exec('PRAGMA foreign_keys=OFF');
      try{
        db.transaction(()=>{
          db.exec(`CREATE TABLE restaurant_orders_upgrade (
            id INTEGER PRIMARY KEY AUTOINCREMENT, table_id INTEGER, customer_name TEXT NOT NULL,
            operator_id INTEGER NOT NULL,operator_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ABERTO',
            total_cents INTEGER NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,
            paid_at TEXT,sale_id INTEGER,order_type TEXT NOT NULL DEFAULT 'MESA',device_id TEXT,
            ready_at TEXT, ready_by TEXT, customer_id INTEGER,
            FOREIGN KEY(table_id) REFERENCES restaurant_tables(id));
            INSERT INTO restaurant_orders_upgrade(id,table_id,customer_name,operator_id,operator_name,status,total_cents,idempotency_key,created_at,paid_at,sale_id)
              SELECT id,table_id,customer_name,operator_id,operator_name,status,total_cents,idempotency_key,created_at,paid_at,sale_id FROM restaurant_orders;
            DROP TABLE restaurant_orders;
            ALTER TABLE restaurant_orders_upgrade RENAME TO restaurant_orders;`);
        })();
      }finally{db.exec('PRAGMA foreign_keys=ON');}
    }else{
      for(const [col,definition] of [['order_type',"TEXT NOT NULL DEFAULT 'MESA'"],['device_id','TEXT'],['ready_at','TEXT'],['ready_by','TEXT']]){
        if(!cols.some(c=>c.name===col))db.exec(`ALTER TABLE restaurant_orders ADD COLUMN ${col} ${definition}`);
      }
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurant_tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL UNIQUE,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS restaurant_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, table_id INTEGER, customer_name TEXT NOT NULL,
      operator_id INTEGER NOT NULL, operator_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ABERTO',
      total_cents INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
      paid_at TEXT, sale_id INTEGER,order_type TEXT NOT NULL DEFAULT 'MESA',device_id TEXT,ready_at TEXT,ready_by TEXT,customer_id INTEGER,
      FOREIGN KEY(table_id) REFERENCES restaurant_tables(id));
    CREATE TABLE IF NOT EXISTS restaurant_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,product_id INTEGER,kit_id INTEGER,
      name TEXT NOT NULL, quantity INTEGER NOT NULL,unit_price_cents INTEGER NOT NULL,total_cents INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '', delivered_quantity INTEGER NOT NULL DEFAULT 0, delivered_at TEXT, delivered_by TEXT, FOREIGN KEY(order_id) REFERENCES restaurant_orders(id));
    CREATE TABLE IF NOT EXISTS restaurant_order_item_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,item_id INTEGER NOT NULL,
      quantity_before INTEGER NOT NULL,quantity_after INTEGER NOT NULL,delta INTEGER NOT NULL,
      operator_id INTEGER NOT NULL,operator_name TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES restaurant_orders(id),FOREIGN KEY(item_id) REFERENCES restaurant_order_items(id));
    CREATE TABLE IF NOT EXISTS restaurant_print_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'PENDING',
      attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT DEFAULT '', printed_at TEXT,created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES restaurant_orders(id));
    CREATE TABLE IF NOT EXISTS restaurant_mobile_sessions (
      token_hash TEXT PRIMARY KEY,operator_id INTEGER NOT NULL,device_id TEXT NOT NULL,
      created_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_mobile_sessions_operator ON restaurant_mobile_sessions(operator_id);
    CREATE TABLE IF NOT EXISTS restaurant_mobile_devices (
      device_id TEXT PRIMARY KEY,operator_id INTEGER NOT NULL,push_token TEXT,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS restaurant_cancel_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,operator_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL,acknowledged_at TEXT,
      UNIQUE(order_id,device_id));
    CREATE INDEX IF NOT EXISTS idx_cancel_alerts_device ON restaurant_cancel_alerts(device_id,operator_id,acknowledged_at);
    CREATE TABLE IF NOT EXISTS restaurant_ready_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL UNIQUE,
      operator_id INTEGER NOT NULL,device_id TEXT NOT NULL,message TEXT NOT NULL,
      created_at TEXT NOT NULL,acknowledged_at TEXT,
      FOREIGN KEY(order_id) REFERENCES restaurant_orders(id));
    CREATE INDEX IF NOT EXISTS idx_ready_alerts_target ON restaurant_ready_alerts(device_id,id);
    CREATE TABLE IF NOT EXISTS restaurant_web_payment_keys (request_key TEXT PRIMARY KEY,response_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS restaurant_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE, target TEXT NOT NULL,
      operator_id INTEGER, order_id INTEGER, kind TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, read_at TEXT,
      FOREIGN KEY(order_id) REFERENCES restaurant_orders(id));
    CREATE INDEX IF NOT EXISTS idx_restaurant_notifications_operator ON restaurant_notifications(target,operator_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_restaurant_orders_table ON restaurant_orders(table_id,status);
    CREATE INDEX IF NOT EXISTS idx_restaurant_orders_type ON restaurant_orders(order_type,status);
  `);
  // Migração aditiva do preparo parcial: pedidos antigos continuam preservados.
  const itemColumns=db.prepare('PRAGMA table_info(restaurant_order_items)').all().map(x=>x.name);
  for(const [column,definition] of [['delivered_quantity','INTEGER NOT NULL DEFAULT 0'],['delivered_at','TEXT'],['delivered_by','TEXT']]){
    if(!itemColumns.includes(column))db.exec(`ALTER TABLE restaurant_order_items ADD COLUMN ${column} ${definition}`);
  }
  const progressMigration=db.prepare("SELECT value FROM settings WHERE key='restaurant_item_delivery_migration_v1'").get();
  if(!progressMigration){
    // Antes desta versão, ready_at significava que a comanda inteira havia sido entregue.
    db.prepare(`UPDATE restaurant_order_items SET delivered_quantity=quantity,delivered_at=COALESCE(delivered_at,(SELECT ready_at FROM restaurant_orders WHERE restaurant_orders.id=restaurant_order_items.order_id)),delivered_by=COALESCE(delivered_by,(SELECT ready_by FROM restaurant_orders WHERE restaurant_orders.id=restaurant_order_items.order_id)) WHERE EXISTS (SELECT 1 FROM restaurant_orders WHERE restaurant_orders.id=restaurant_order_items.order_id AND restaurant_orders.ready_at IS NOT NULL)`).run();
    db.prepare("INSERT INTO settings(key,value) VALUES('restaurant_item_delivery_migration_v1','1')").run();
  }
  // As vendas do PDV também usam o campo table_id; garante compatibilidade
  // em bases anteriores e nos testes isolados do módulo de restaurante.
  const saleCols=db.prepare('PRAGMA table_info(sales)').all().map(x=>x.name);
  if(saleCols.length&&!saleCols.includes('table_id'))db.exec('ALTER TABLE sales ADD COLUMN table_id INTEGER');
  // Migração não destrutiva: mantém os pedidos de instalações anteriores.
  const columns=db.prepare('PRAGMA table_info(restaurant_orders)').all().map(x=>x.name);
  for(const [column,sql] of [['cancelled_at','TEXT'],['cancelled_by','TEXT'],['cancel_reason','TEXT'],['cancel_origin','TEXT'],['customer_id','INTEGER']]){
    if(!columns.includes(column))db.exec(`ALTER TABLE restaurant_orders ADD COLUMN ${column} ${sql}`);
  }
  // Permissões granulares para atendimento Web; defaults conservadores e migração aditiva.
  const operatorColumns=db.prepare('PRAGMA table_info(operators)').all().map(x=>x.name);
  if(operatorColumns.length&&!operatorColumns.includes('permissions_json'))db.exec("ALTER TABLE operators ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '{}'");
  if(operatorColumns.length)db.prepare("UPDATE operators SET permissions_json=? WHERE permissions_json IS NULL OR permissions_json='{}'").run(JSON.stringify({send_orders:true,shared_tables:true,view_all_tables:false,receive_table_payment:false,cancel_orders:true}));
  const tableColumns=db.prepare('PRAGMA table_info(restaurant_tables)').all().map(x=>x.name);
  if(tableColumns.length&&!tableColumns.includes('primary_operator_id'))db.exec('ALTER TABLE restaurant_tables ADD COLUMN primary_operator_id INTEGER');
  const set = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  set.run('restaurant_port','8765');
  set.run('restaurant_printer','');
  set.run('restaurant_receipt_printer','');
  set.run('restaurant_pairing_hash',''); // legado: não é mais necessário para novos acessos
}

function sendExpoPush(to,orderId,message,eventType='ORDER_READY'){
  return new Promise((resolve,reject)=>{
    const payload=JSON.stringify({to,title:eventType==='ORDER_CANCELLED'?'Alengo Espetinhos · Pedido cancelado':'Alengo Espetinhos · Pedido pronto',body:message,sound:'pedido_pronto.wav',channelId:'pedido-pronto',data:{orderId,type:eventType}});
    const req=https.request('https://exp.host/--/api/v2/push/send',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)},timeout:5000},res=>{
      const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{
        if(res.statusCode!==200)return reject(new Error('Push HTTP '+res.statusCode));
        try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(data.data?.status==='error')return reject(new Error(data.data.message||'Push rejeitado'));resolve(data)}catch(e){reject(e)}
      });
    });
    req.on('timeout',()=>req.destroy(new Error('Serviço push indisponível')));
    req.on('error',reject);req.end(payload);
  });
}
function makeRestaurant({db,ipcMain,app,audit=()=>{},isOperationalResetting=()=>false}) {
  initializeRestaurant(db);
  const get = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || '';
  const put = (key,value) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));
  const currentOperator = () => {
    const id = +get('current_operator_id');
    const row=id?db.prepare('SELECT id,name,role,active,permissions_json FROM operators WHERE id=? AND active=1').get(id):null;if(row){try{row.permissions=JSON.parse(row.permissions_json||'{}')}catch{row.permissions={}}}return row;
  };
  const requireUser = () => {if(isOperationalResetting())throw err('A limpeza de dados está em andamento. Aguarde a conclusão.','RESET_IN_PROGRESS');const x=currentOperator();if(!x)throw err('Faça login para continuar.','AUTH');return x;};
  const requireAdmin = () => {const x=requireUser();if(x.role!=='admin')throw err('Acesso exclusivo do administrador.','FORBIDDEN');return x;};
  const hasPermission=(actor,key)=>actor?.role==='admin'||actor?.permissions?.[key]===true;
  const requirePermission=(actor,key,message='Você não possui permissão para esta operação.')=>{if(!hasPermission(actor,key))throw err(message,'FORBIDDEN')};
  const createNotification=(input)=>{
    const row={event_key:String(input.event_key||crypto.randomUUID()),target:input.target||'OPERATOR',operator_id:input.operator_id||null,order_id:input.order_id||null,kind:input.kind||'INFO',title:String(input.title||'ALENGO ESPETINHOS').slice(0,120),message:String(input.message||'').slice(0,1000),details_json:JSON.stringify(input.details||{}),created_at:utc()};
    db.prepare('INSERT OR IGNORE INTO restaurant_notifications(event_key,target,operator_id,order_id,kind,title,message,details_json,created_at) VALUES(@event_key,@target,@operator_id,@order_id,@kind,@title,@message,@details_json,@created_at)').run(row);
    return db.prepare('SELECT * FROM restaurant_notifications WHERE event_key=?').get(row.event_key);
  };
  const notifyWindows=(title,message)=>{try{if(Notification.isSupported()){const n=new Notification({title,body:message,silent:false});n.show();}}catch(e){console.warn('Notificação Windows:',e.message)}};
  const listTables = () => db.prepare(`SELECT t.*,op.name primary_operator_name,
    (SELECT COUNT(*) FROM restaurant_orders o WHERE o.table_id=t.id AND o.status='ABERTO') open_orders,
    (SELECT COALESCE(SUM(total_cents),0) FROM restaurant_orders o WHERE o.table_id=t.id AND o.status='ABERTO') pending_cents
    FROM restaurant_tables t LEFT JOIN operators op ON op.id=t.primary_operator_id WHERE t.active=1 ORDER BY CAST(t.label AS INTEGER),t.label`).all();
  const attachOrderDetails = orders => {
    const query=db.prepare('SELECT * FROM restaurant_order_items WHERE order_id=? ORDER BY id');
    const pj=db.prepare('SELECT status,attempts,last_error,printed_at FROM restaurant_print_jobs WHERE order_id=?');
    return orders.map(o=>({...o,items:query.all(o.id),print:pj.get(o.id)}));
  };
  const listOrders = (tableId=null) => {
    const orders=tableId?db.prepare('SELECT * FROM restaurant_orders WHERE table_id=? AND order_type=\'MESA\' ORDER BY id DESC').all(tableId):db.prepare('SELECT * FROM restaurant_orders ORDER BY id DESC LIMIT 200').all();
    return attachOrderDetails(orders);
  };
  const listOrdersByLocalDay = dateText => {
    const value=String(dateText||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw err('Informe uma data válida para consultar o histórico.');
    const start=new Date(`${value}T00:00:00`);
    if(Number.isNaN(start.getTime()))throw err('Data inválida para consultar o histórico.');
    const end=new Date(start);end.setDate(end.getDate()+1);
    const orders=db.prepare('SELECT * FROM restaurant_orders WHERE created_at>=? AND created_at<? ORDER BY created_at DESC,id DESC').all(start.toISOString(),end.toISOString());
    return attachOrderDetails(orders);
  };
  const listOrdersVisibleToOperatorByLocalDay = (dateText,actor) => {
    const owned=db.prepare('SELECT id FROM restaurant_tables WHERE primary_operator_id=?').all(actor.id).map(x=>Number(x.id));
    return listOrdersByLocalDay(dateText).filter(o=>Number(o.operator_id)===Number(actor.id)||(o.order_type==='MESA'&&(actor.permissions?.shared_tables!==false||owned.includes(Number(o.table_id))))||hasPermission(actor,'view_all_tables'));
  };
  const catalog = () => {
    const products=db.prepare("SELECT id,name,price_cents,stock,unit,category_id FROM products WHERE active=1 AND COALESCE(sale_mode,'UNIT')='UNIT' ORDER BY name").all();
    const kits=db.prepare("SELECT id,name,price_cents,category_id FROM kits WHERE active=1 AND COALESCE(kit_type,'STANDARD')='STANDARD' ORDER BY name").all();
    const categories=db.prepare('SELECT id,name,icon FROM categories WHERE active=1 ORDER BY name').all();
    const recent=db.prepare(`SELECT si.product_id,si.kit_id,SUM(CASE WHEN COALESCE(si.sale_mode,'UNIT') IN ('WEIGHT','MIX_WEIGHT') THEN COALESCE(si.weight_grams,0) ELSE COALESCE(si.quantity,0) END) popularity FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.sold_at>=datetime('now','-30 days') AND COALESCE(s.status,'CONCLUIDA')<>'CANCELADA' GROUP BY si.product_id,si.kit_id ORDER BY popularity DESC LIMIT 8`).all();
    const popular=recent.map(row=>row.kit_id?kits.find(x=>Number(x.id)===Number(row.kit_id)):products.find(x=>Number(x.id)===Number(row.product_id))).filter(Boolean).map(x=>({...x,isKit:kits.some(k=>Number(k.id)===Number(x.id))}));
    return {products,kits,categories,popular};
  };
  const orderTx=db.transaction((payload,actor)=>{
    const key=String(payload.idempotency_key||'').trim();
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(key))throw err('Identificador do pedido inválido.');
    const prior=db.prepare('SELECT * FROM restaurant_orders WHERE idempotency_key=?').get(key);
    if(prior)return {orderId:prior.id,duplicate:true};
    const orderType=payload.order_type==='RETIRADA'?'RETIRADA':'MESA';
    const tableId=orderType==='MESA'?asInt(payload.table_id):null;
    const table=orderType==='MESA'?db.prepare('SELECT * FROM restaurant_tables WHERE id=? AND active=1').get(tableId):null;
    if(orderType==='MESA'&&!table)throw err('Mesa não encontrada.');
    const selectedCustomerId=payload.customer_id?asInt(payload.customer_id):null;
    const selectedCustomer=selectedCustomerId?db.prepare('SELECT id,name FROM customers WHERE id=?').get(selectedCustomerId):null;
    if(selectedCustomerId&&!selectedCustomer)throw err('Cliente selecionado não está mais cadastrado. Atualize a lista e selecione novamente.');
    const name=String(selectedCustomer?.name||payload.customer_name||'').trim().slice(0,90);
    if(name.length<2)throw err('Informe o nome do cliente (mínimo 2 caracteres).');
    if(!Array.isArray(payload.items)||!payload.items.length||payload.items.length>70)throw err('Adicione entre 1 e 70 itens ao pedido.');
    const rows=[],needs=new Map();
    for(const i of payload.items){
      const qty=asInt(i.quantity);
      if(!Number.isInteger(qty)||qty<1||qty>1000)throw err('Quantidade inválida.');
      const note=String(i.notes||'').trim().slice(0,240);
      let id,name,price,kitId=null,productId=null;
      if(i.kit_id){
        id=asInt(i.kit_id);const kit=db.prepare("SELECT * FROM kits WHERE id=? AND active=1 AND COALESCE(kit_type,'STANDARD')='STANDARD'").get(id);
        if(!kit)throw err('Combo indisponível.');
        const parts=db.prepare('SELECT product_id,quantity FROM kit_items WHERE kit_id=?').all(id);
        if(!parts.length)throw err('Combo sem componentes cadastrados.');
        for(const part of parts){const n=qty*asInt(part.quantity);if(!Number.isSafeInteger(n)||n<1)throw err('Quantidade de combo inválida.');needs.set(part.product_id,(needs.get(part.product_id)||0)+n);}
        name=kit.name;price=kit.price_cents;kitId=id;
      }else{
        id=asInt(i.product_id);const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1 AND COALESCE(sale_mode,'UNIT')='UNIT'").get(id);
        if(!p)throw err('Produto indisponível.');
        name=p.name;price=p.price_cents;productId=id;
        needs.set(id,(needs.get(id)||0)+qty);
      }
      const total=price*qty;
      if(!Number.isSafeInteger(total)||total<0)throw err('Valor do item inválido.');
      rows.push({productId,kitId,name,qty,price,total,note});
    }
    for(const [id,qty] of needs){
      const stock=db.prepare('SELECT stock,name FROM products WHERE id=? AND active=1').get(id);
      if(!stock||stock.stock<qty)throw err(`Estoque insuficiente: ${stock?.name||'produto'} (solicitado ${qty}, disponível ${stock?.stock||0}).`,'STOCK');
    }
    const ingredientNeeds=new Map();const hasInternalRecipes=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_recipes'").get();if(hasInternalRecipes){for(const [productId,soldQty] of needs){for(const r of db.prepare('SELECT r.item_id,r.quantity,i.name,i.unit,i.stock FROM product_recipes r JOIN internal_items i ON i.id=r.item_id WHERE r.product_id=? AND i.active=1').all(productId)){ingredientNeeds.set(r.item_id,{...r,required:Number(ingredientNeeds.get(r.item_id)?.required||0)+Number(r.quantity||0)*soldQty})}}for(const r of ingredientNeeds.values()){if(Number(r.stock)<r.required)throw err(`Ingrediente insuficiente: ${r.name}. Necessário ${r.required} ${r.unit}, disponível ${r.stock} ${r.unit}.`,'INTERNAL_STOCK')}}
    const total=rows.reduce((sum,i)=>sum+i.total,0);
    if(!Number.isSafeInteger(total))throw err('Total inválido.');
    const deviceId=actor.deviceId||null;
    const result=db.prepare('INSERT INTO restaurant_orders(table_id,customer_name,operator_id,operator_name,total_cents,idempotency_key,created_at,order_type,device_id,customer_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(tableId,name,actor.id,actor.name,total,key,utc(),orderType,deviceId,selectedCustomerId);
    const orderId=Number(result.lastInsertRowid);
    const insert=db.prepare('INSERT INTO restaurant_order_items(order_id,product_id,kit_id,name,quantity,unit_price_cents,total_cents,notes) VALUES(?,?,?,?,?,?,?,?)');
    for(const i of rows)insert.run(orderId,i.productId,i.kitId,i.name,i.qty,i.price,i.total,i.note);
    for(const [id,qty] of needs){
      db.prepare('UPDATE products SET stock=stock-?,updated_at=? WHERE id=?').run(qty,utc(),id);
      db.prepare('INSERT INTO stock_movements(product_id,kind,quantity,reason,created_at,sale_mode) VALUES(?,?,?,?,?,?)').run(id,'OUT',qty,`Pedido #${orderId} - ${orderType==='RETIRADA'?'RETIRADA':'mesa '+table.label}`,utc(),'UNIT');
    }
    if(hasInternalRecipes)for(const r of ingredientNeeds.values()){const cost=Math.round(r.required*Number(db.prepare('SELECT cost_unit_cents FROM internal_items WHERE id=?').get(r.item_id)?.cost_unit_cents||0));db.prepare('UPDATE internal_items SET stock=stock-?,updated_at=? WHERE id=?').run(r.required,utc(),r.item_id);db.prepare('INSERT INTO internal_item_movements(item_id,kind,quantity,cost_cents,reason,reference_type,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(r.item_id,'OUT',r.required,cost,`Preparo do pedido #${orderId}`,'order',orderId,utc());db.prepare('INSERT INTO recipe_consumptions(item_id,quantity,cost_cents,reference_type,reference_id,created_at) VALUES(?,?,?,?,?,?)').run(r.item_id,r.required,cost,'order',orderId,utc())}
    db.prepare('INSERT INTO restaurant_print_jobs(order_id,status,created_at) VALUES(?,?,?)').run(orderId,'PENDING',utc());
    return {orderId,duplicate:false};
  });
  function receiptHtml(title,lines){
    return `<!doctype html><html lang="pt-br"><head><meta charset="UTF-8"><style>@page{margin:2mm;size:80mm auto}body{font:12px monospace;width:72mm;color:#000;margin:0}h2{text-align:center;font-size:17px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px monospace}hr{border:0;border-top:1px dashed black}</style></head><body><h2>ALENGO ESPETINHOS</h2><h3 style="text-align:center">${esc(title)}</h3><hr/><pre>${esc(lines.join('\n'))}</pre><hr/></body></html>`;
  }
  function orderHtml(orderId){
    const o=db.prepare('SELECT o.*,t.label table_label FROM restaurant_orders o LEFT JOIN restaurant_tables t ON t.id=o.table_id WHERE o.id=?').get(orderId);
    if(!o)throw err('Pedido não localizado.');
    const items=db.prepare('SELECT * FROM restaurant_order_items WHERE order_id=?').all(orderId);
    return receiptHtml('COMANDA DE PREPARO',[`PEDIDO #${o.id}  ${o.order_type==='RETIRADA'?'*** RETIRADA ***':'MESA '+o.table_label}`,`CLIENTE: ${o.customer_name}`,`ATENDENTE: ${o.operator_name}`,new Date(o.created_at).toLocaleString('pt-BR'),'--------------------------------',...items.flatMap(i=>[`${i.quantity}x ${i.name}`,...(i.notes?[`OBS: ${i.notes}`]:[]),...(Number(i.delivered_quantity||0)>0?[`ENTREGUES: ${i.delivered_quantity}/${i.quantity}`]:[])]),'--------------------------------','PREPARAR PEDIDO']);
  }
  async function printHtml(html,kind='kitchen'){
    const win=new BrowserWindow({show:false,width:450,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    try{
      await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
      const printer=get(kind==='receipt'?'restaurant_receipt_printer':'restaurant_printer');
      if(!printer)throw err(`Selecione a impressora de ${kind==='receipt'?'comprovantes no caixa':'comandas na cozinha'} antes de imprimir.`, 'PRINT_CONFIG');
      return await new Promise((resolve,reject)=>win.webContents.print({silent:true,printBackground:true,...(printer?{deviceName:printer}:{})},(success,why)=>success?resolve(true):reject(err(why||'Impressão não concluída.','PRINT'))));
    } finally {if(!win.isDestroyed())win.destroy();}
  }
  const inFlight=new Set();
  async function printOrder(id){
    id=asInt(id);if(inFlight.has(id))return;
    const job=db.prepare('SELECT * FROM restaurant_print_jobs WHERE order_id=?').get(id);
    const oState=db.prepare('SELECT status FROM restaurant_orders WHERE id=?').get(id);
    if(!job||!oState||oState.status==='CANCELADO'||job.status==='PRINTED'||job.status==='CANCELLED')return;
    inFlight.add(id);
    try{
      db.prepare("UPDATE restaurant_print_jobs SET status='PRINTING',attempts=attempts+1,last_error='' WHERE order_id=?").run(id);
      await printHtml(orderHtml(id));
      db.prepare("UPDATE restaurant_print_jobs SET status='PRINTED',printed_at=?,last_error='' WHERE order_id=?").run(utc(),id);
      const o=db.prepare('SELECT operator_name,table_id,order_type FROM restaurant_orders WHERE id=?').get(id);audit(o?.operator_name||'Sistema','Comanda enviada para impressão','restaurant_order',id,`${o?.order_type==='RETIRADA'?'Retirada':'Mesa #'+o?.table_id} · cozinha`,0,'orders');
    }catch(e){db.prepare("UPDATE restaurant_print_jobs SET status='FAILED',last_error=? WHERE order_id=?").run(String(e.message||e).slice(0,300),id);const o=db.prepare('SELECT operator_name FROM restaurant_orders WHERE id=?').get(id);audit(o?.operator_name||'Sistema','Falha na impressão da comanda','restaurant_order',id,String(e.message||e).slice(0,180),0,'orders')}
    finally{inFlight.delete(id)}
  }
  const saveOrder=(payload,actor,source='PDV Windows')=>{
    const result=orderTx(payload,actor);
    if(!result.duplicate){
      const order=db.prepare('SELECT table_id,total_cents,customer_name,order_type FROM restaurant_orders WHERE id=?').get(result.orderId);
      const items=db.prepare('SELECT name,quantity,notes FROM restaurant_order_items WHERE order_id=? ORDER BY id').all(result.orderId);
      const place=order.order_type==='RETIRADA'?'Retirada':`Mesa #${order.table_id}`;
      const details={order_id:result.orderId,place,customer:order.customer_name,operator:actor.name,source,items};
      const message=`${place} · ${order.customer_name} · ${items.map(i=>`${i.quantity}x ${i.name}`).join(', ')}`;
      createNotification({event_key:`order-received:${result.orderId}`,target:'WINDOWS',order_id:result.orderId,kind:'ORDER_RECEIVED',title:`Novo pedido #${result.orderId}`,message,details});
      notifyWindows(`Novo pedido #${result.orderId}`,message);
      audit(actor.name,source==='Aplicativo móvel'?'Pedido recebido pelo aplicativo móvel':source==='Aplicativo Web Remoto'?'Pedido recebido pelo Web remoto':'Pedido registrado no caixa','restaurant_order',result.orderId,`Origem: ${source} · ${place} · Cliente: ${order.customer_name}`,order.total_cents,'orders');
      setImmediate(()=>printOrder(result.orderId));
    }
    return {id:result.orderId,already_received:result.duplicate};
  };
  const itemDeliveryTx=db.transaction((input,actor,viaMobile=false,sourceOverride='')=>{
    const orderId=asInt(input.order_id),itemId=asInt(input.item_id),delta=asInt(input.delta);
    if(!Number.isSafeInteger(orderId)||!Number.isSafeInteger(itemId))throw err('Pedido ou item inválido.');
    if(!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>1000)throw err('Informe uma alteração válida de quantidade.');
    const order=db.prepare('SELECT * FROM restaurant_orders WHERE id=?').get(orderId);
    if(!order)throw err('Pedido não localizado.');
    if(order.status==='CANCELADO')throw err('Não é possível atualizar um pedido cancelado.','CONFLICT');
    if(!['ABERTO','PAGO'].includes(order.status))throw err('Pedido não está disponível para entrega.','CONFLICT');
    if(viaMobile&&(Number(order.operator_id)!==Number(actor.id)||order.device_id!==actor.deviceId))throw err('Somente o aparelho responsável pode atualizar os itens deste pedido.','FORBIDDEN');
    const item=db.prepare('SELECT * FROM restaurant_order_items WHERE id=? AND order_id=?').get(itemId,orderId);
    if(!item)throw err('Item não pertence a este pedido.','NOT_FOUND');
    const before=Number(item.delivered_quantity||0),after=before+delta;
    if(after<0)throw err('A quantidade entregue não pode ficar abaixo de zero.');
    if(after>Number(item.quantity))throw err(`A quantidade entregue não pode ultrapassar ${item.quantity} unidade(s) de ${item.name}.`);
    const now=utc();
    db.prepare('UPDATE restaurant_order_items SET delivered_quantity=?,delivered_at=?,delivered_by=? WHERE id=? AND order_id=?').run(after,after>0?now:null,after>0?actor.name:null,itemId,orderId);
    db.prepare('INSERT INTO restaurant_order_item_events(order_id,item_id,quantity_before,quantity_after,delta,operator_id,operator_name,source,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(orderId,itemId,before,after,delta,actor.id,actor.name,sourceOverride|| (viaMobile?'ANDROID/IOS':'WINDOWS'),now);
    const totals=db.prepare('SELECT COALESCE(SUM(quantity),0) total,COALESCE(SUM(delivered_quantity),0) delivered FROM restaurant_order_items WHERE order_id=?').get(orderId);
    const complete=Number(totals.total)>0&&Number(totals.delivered)===Number(totals.total);
    if(delta>0&&!viaMobile&&sourceOverride!=='WEB REMOTO'){
      const place=order.order_type==='RETIRADA'?'Retirada':`Mesa #${db.prepare('SELECT label FROM restaurant_tables WHERE id=?').get(order.table_id)?.label||order.table_id}`;
      const kind=complete?'ORDER_READY_COMPLETE':'ORDER_READY_PARTIAL';
      const title=complete?`Pedido #${orderId} pronto`:`Pedido #${orderId} parcialmente pronto`;
      const message=`${place} · ${order.customer_name} · ${item.name}: ${after}/${item.quantity} · ${totals.delivered}/${totals.total} unidades prontas`;
      createNotification({event_key:`ready:${orderId}:${itemId}:${after}:${now}`,target:'OPERATOR',operator_id:order.operator_id,order_id:orderId,kind,title,message,details:{order_id:orderId,place,customer:order.customer_name,item:item.name,item_ready:after,item_total:item.quantity,total_ready:totals.delivered,total_items:totals.total,complete,marked_by:actor.name}});
    }
    let alert=null;
    if(complete&&!order.ready_at){
      db.prepare('UPDATE restaurant_orders SET ready_at=?,ready_by=? WHERE id=? AND ready_at IS NULL').run(now,actor.name,orderId);
      if(order.device_id&&!viaMobile){
        const message=`Todos os itens do pedido #${orderId} de ${order.customer_name} foram entregues.`;
        db.prepare('INSERT OR IGNORE INTO restaurant_ready_alerts(order_id,operator_id,device_id,message,created_at) VALUES(?,?,?,?,?)').run(orderId,order.operator_id,order.device_id,message,now);
        alert={device_id:order.device_id,operator_id:order.operator_id,message};
      }
    }else if(!complete&&order.ready_at){
      db.prepare('UPDATE restaurant_orders SET ready_at=NULL,ready_by=NULL WHERE id=?').run(orderId);
      db.prepare('DELETE FROM restaurant_ready_alerts WHERE order_id=? AND acknowledged_at IS NULL').run(orderId);
    }
    const updated=db.prepare('SELECT * FROM restaurant_order_items WHERE id=?').get(itemId);
    return {order,item:updated,total_quantity:Number(totals.total),delivered_quantity:Number(totals.delivered),complete,alert,delta};
  });
  function updateItemDelivery(input,actor,viaMobile=false,sourceOverride=''){
    const result=itemDeliveryTx(input,actor,viaMobile,sourceOverride);
    const i=result.item;
    audit(actor.name,result.delta>0?'Item do pedido marcado como entregue':'Quantidade de item entregue corrigida','restaurant_order_item',i.id,`Pedido #${result.order.id} · ${i.name}: ${i.delivered_quantity}/${i.quantity} entregue(s) · Origem: ${sourceOverride|| (viaMobile?'Aplicativo móvel':'PDV Windows')}`,0,'orders');
    if(result.alert){
      audit(actor.name,'Pedido pronto: alerta enviado ao atendente','restaurant_order',result.order.id,result.alert.message,0,'orders');
      const device=db.prepare('SELECT push_token FROM restaurant_mobile_devices WHERE device_id=? AND operator_id=?').get(result.alert.device_id,result.alert.operator_id);
      if(device?.push_token)sendExpoPush(device.push_token,result.order.id,result.alert.message).catch(e=>console.error('Notificação de entrega:',e.message));
    }
    return {order_id:result.order.id,item:result.item,total_quantity:result.total_quantity,delivered_quantity:result.delivered_quantity,complete:result.complete};
  }
  const markOrderFullyDelivered=db.transaction((orderId,actor)=>{
    const id=asInt(orderId),order=db.prepare("SELECT * FROM restaurant_orders WHERE id=? AND status IN ('ABERTO','PAGO')").get(id);
    if(!order)throw err('Pedido pendente não localizado.');
    if(order.ready_at)throw err('Este pedido já foi marcado como pronto.');
    const now=utc();
    const items=db.prepare('SELECT * FROM restaurant_order_items WHERE order_id=? ORDER BY id').all(id);
    if(!items.length)throw err('Pedido sem itens para entregar.');
    for(const item of items){
      const before=Number(item.delivered_quantity||0),after=Number(item.quantity);
      if(before===after)continue;
      db.prepare('UPDATE restaurant_order_items SET delivered_quantity=?,delivered_at=?,delivered_by=? WHERE id=?').run(after,now,actor.name,item.id);
      db.prepare('INSERT INTO restaurant_order_item_events(order_id,item_id,quantity_before,quantity_after,delta,operator_id,operator_name,source,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,item.id,before,after,after-before,actor.id,actor.name,'WINDOWS',now);
    }
    db.prepare('UPDATE restaurant_orders SET ready_at=COALESCE(ready_at,?),ready_by=COALESCE(ready_by,?) WHERE id=?').run(now,actor.name,id);
    const place=order.order_type==='RETIRADA'?'Retirada':`Mesa #${db.prepare('SELECT label FROM restaurant_tables WHERE id=?').get(order.table_id)?.label||order.table_id}`;
    const detailItems=items.map(i=>({name:i.name,ready:Number(i.quantity),total:Number(i.quantity),notes:i.notes||''}));
    createNotification({event_key:`ready-complete:${id}:${now}`,target:'OPERATOR',operator_id:order.operator_id,order_id:id,kind:'ORDER_READY_COMPLETE',title:`Pedido #${id} completamente pronto`,message:`${place} · ${order.customer_name} · Todos os ${items.length} item(ns) liberados pela cozinha.`,details:{order_id:id,place,customer:order.customer_name,items:detailItems,complete:true,marked_by:actor.name}});
    let alert=null;
    if(order.device_id){
      const message=`Todos os itens do pedido #${id} de ${order.customer_name} foram entregues.`;
      db.prepare('INSERT OR IGNORE INTO restaurant_ready_alerts(order_id,operator_id,device_id,message,created_at) VALUES(?,?,?,?,?)').run(id,order.operator_id,order.device_id,message,now);
      alert={device_id:order.device_id,operator_id:order.operator_id,message};
    }
    return {id,order,alert,message:`Pedido #${id} de ${order.customer_name}: todos os itens foram marcados como entregues.`};
  });
  function markOrderDelivered(orderId,actor){
    const result=markOrderFullyDelivered(orderId,actor);
    audit(actor.name,result.order.device_id?'Pedido pronto: alerta enviado ao atendente':'Pedido marcado como pronto no caixa','restaurant_order',result.id,`${result.message} · ${result.order.device_id?'aparelho de origem':'sem celular vinculado'}`,0,'orders');
    if(result.alert){const device=db.prepare('SELECT push_token FROM restaurant_mobile_devices WHERE device_id=? AND operator_id=?').get(result.alert.device_id,result.alert.operator_id);if(device?.push_token)sendExpoPush(device.push_token,result.id,result.alert.message).catch(e=>console.error('Notificação de entrega:',e.message));}
    return {id:result.id,message:result.message,push_configured:!!result.alert};
  }
  const cancelOrderTx=db.transaction((orderId,reason,actor,viaMobile=false,originOverride='')=>{
    const id=asInt(orderId),order=db.prepare('SELECT * FROM restaurant_orders WHERE id=?').get(id);
    if(!order)throw err('Pedido não localizado.');
    if(order.status==='CANCELADO')throw err('Este pedido já foi cancelado.','CONFLICT');
    if(order.status==='PAGO')throw err('Pedido já pago. Primeiro regularize/cancele a venda e o documento fiscal, se houver; não é possível cancelar a comanda diretamente.','PAID_ORDER');
    if(order.status!=='ABERTO')throw err('O pedido não está disponível para cancelamento.');
    const delivered=db.prepare('SELECT 1 FROM restaurant_order_items WHERE order_id=? AND delivered_quantity>0 LIMIT 1').get(id);
    if(delivered)throw err('Este pedido já possui itens entregues. Regularize os itens entregues antes de cancelar a comanda.','DELIVERED_ORDER');
    if(viaMobile && (Number(order.operator_id)!==Number(actor.id)||order.device_id!==actor.deviceId))throw err('Somente o aparelho responsável pode cancelar este pedido.','FORBIDDEN');
    const why=String(reason||'').trim().slice(0,240);
    if(why.length<5)throw err('Informe o motivo do cancelamento (mínimo 5 caracteres).');
    const moves=new Map();
    for(const i of db.prepare('SELECT * FROM restaurant_order_items WHERE order_id=?').all(id)){
      if(i.product_id)moves.set(i.product_id,(moves.get(i.product_id)||0)+i.quantity);
      if(i.kit_id){for(const part of db.prepare('SELECT product_id,quantity FROM kit_items WHERE kit_id=?').all(i.kit_id)){
        moves.set(part.product_id,(moves.get(part.product_id)||0)+i.quantity*part.quantity);
      }}
    }
    const changed=db.prepare("UPDATE restaurant_orders SET status='CANCELADO',cancelled_at=?,cancelled_by=?,cancel_reason=?,cancel_origin=? WHERE id=? AND status='ABERTO'").run(utc(),actor.name,why,viaMobile?'MOBILE':(originOverride||'WINDOWS'),id);
    if(changed.changes!==1)throw err('Pedido alterado enquanto era cancelado.','CONFLICT');
    for(const [productId,qty] of moves){
      db.prepare('UPDATE products SET stock=stock+?,updated_at=? WHERE id=?').run(qty,utc(),productId);
      db.prepare('INSERT INTO stock_movements(product_id,kind,quantity,reason,created_at,sale_mode) VALUES(?,?,?,?,?,?)').run(productId,'IN',qty,`Cancelamento pedido #${id}: ${why}`,utc(),'UNIT');
    }
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recipe_consumptions'").get()){const ingredientRows=db.prepare("SELECT item_id,quantity,cost_cents FROM recipe_consumptions WHERE reference_type='order' AND reference_id=?").all(id);for(const r of ingredientRows){db.prepare('UPDATE internal_items SET stock=stock+?,updated_at=? WHERE id=?').run(Number(r.quantity||0),utc(),r.item_id);db.prepare('INSERT INTO internal_item_movements(item_id,kind,quantity,cost_cents,reason,reference_type,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(r.item_id,'IN',r.quantity,r.cost_cents,`Estorno do pedido #${id}`,'order_cancel',id,utc())}}
    const job=db.prepare('SELECT status FROM restaurant_print_jobs WHERE order_id=?').get(id);
    db.prepare("UPDATE restaurant_print_jobs SET status='CANCELLED',last_error='Pedido cancelado' WHERE order_id=? AND status IN ('PENDING','FAILED')").run(id);
    const message=`Pedido #${id} de ${order.customer_name} (${order.order_type==='RETIRADA'?'Retirada':'Mesa'}) CANCELADO por ${actor.name}. Motivo: ${why}`;
    if(order.device_id && !viaMobile){
      db.prepare('INSERT OR IGNORE INTO restaurant_cancel_alerts(order_id,operator_id,device_id,message,created_at) VALUES(?,?,?,?,?)').run(id,order.operator_id,order.device_id,message,utc());
    }
    return {id,message,order,already_printed:job?.status==='PRINTED'||job?.status==='PRINTING',reason:why};
  });
  async function cancelOrder(orderId,reason,actor,viaMobile=false,originOverride=''){
    const result=cancelOrderTx(orderId,reason,actor,viaMobile,originOverride);
    audit(actor.name,viaMobile?'Pedido cancelado no celular':(originOverride==='REMOTE'?'Pedido cancelado pelo Web remoto':'Pedido cancelado no Windows'),'restaurant_order',result.id,`${result.message} · estoque estornado`,0,'orders');
    if(result.already_printed){
      setImmediate(()=>printHtml(receiptHtml('CANCELAMENTO DE PEDIDO',[`PEDIDO #${result.id}`,`CLIENTE: ${result.order.customer_name}`,result.order.order_type==='RETIRADA'?'RETIRADA':`MESA #${result.order.table_id}`,`MOTIVO: ${result.reason}`,'*** NÃO PREPARAR / CANCELADO ***']),'kitchen')
        .catch(e=>audit(actor.name,'Falha na impressão do cancelamento','restaurant_order',result.id,String(e.message||e),0,'orders')));
    }
    if(result.order.device_id&&!viaMobile){
      const device=db.prepare('SELECT push_token FROM restaurant_mobile_devices WHERE device_id=? AND operator_id=?').get(result.order.device_id,result.order.operator_id);
      if(device?.push_token)sendExpoPush(device.push_token,result.id,result.message,'ORDER_CANCELLED').catch(e=>console.error('Push cancelamento:',e.message));
    }
    return {id:result.id,message:result.message};
  }
  // Pagar a conta da mesa: registra venda com os itens já baixados do estoque na comanda.
  // O mesmo estoque nunca pode ser descontado novamente no pagamento.
  const payTable=db.transaction((input,actor)=>{
    const isPickup=input.order_id!==undefined&&input.order_id!==null;
    const tableId=isPickup?null:asInt(input.table_id);
    const table=isPickup?null:db.prepare('SELECT * FROM restaurant_tables WHERE id=? AND active=1').get(tableId);
    if(!isPickup&&!table)throw err('Mesa inválida.');
    const cash=db.prepare("SELECT id FROM cash_registers WHERE closing_status='ABERTO' ORDER BY id DESC LIMIT 1").get();
    if(!cash)throw err('Abra o caixa antes de receber o pagamento.','CASH_CLOSED');
    const orders=isPickup?db.prepare("SELECT * FROM restaurant_orders WHERE id=? AND order_type='RETIRADA' AND status='ABERTO'").all(asInt(input.order_id)):db.prepare("SELECT * FROM restaurant_orders WHERE table_id=? AND order_type='MESA' AND status='ABERTO' ORDER BY id").all(tableId);
    if(!orders.length)throw err('Não há pedidos pendentes para este recebimento.');
    const base=orders.reduce((n,o)=>n+o.total_cents,0);
    const allowedMethods=['Dinheiro','PIX','Cartão de débito','Cartão de crédito'];
    const tenders=Array.isArray(input.payments)&&input.payments.length?input.payments:[{method:input.method,original_cents:base,fee_percent:input.fee_percent,installments:input.installments}];
    if(tenders.length>4)throw err('Use no máximo quatro formas de pagamento.');
    const normalized=tenders.map(t=>{const method=String(t.method||'');const original=asInt(t.original_cents??t.amount_cents);const feePct=method==='Cartão de crédito'?Number(t.fee_percent||0):0;const installments=method==='Cartão de crédito'?Math.min(36,Math.max(1,asInt(t.installments)||1)):1;if(!allowedMethods.includes(method))throw err('Selecione uma forma de pagamento válida.');if(!Number.isSafeInteger(original)||original<=0)throw err('Informe um valor válido para cada forma de pagamento.');if(!Number.isFinite(feePct)||feePct<0||feePct>100)throw err('Taxa de crédito inválida.');const fee=Math.round(original*feePct/100);return {method,original_cents:original,fee_percent:feePct,fee_cents:fee,final_cents:original+fee,installments,condition_text:method==='Cartão de crédito'?`Crédito ${installments}x · taxa ${feePct.toFixed(2)}%`:method};});
    if(normalized.reduce((n,t)=>n+t.original_cents,0)!==base)throw err(`A soma das formas de pagamento deve ser exatamente ${money(base)}.`);
    const fee=normalized.reduce((n,t)=>n+t.fee_cents,0),total=base+fee;
    const method=[...new Set(normalized.map(t=>t.method))].join(' + ');
    const linkedCustomerIds=[...new Set(orders.map(x=>Number(x.customer_id||0)).filter(Boolean))];
    const linkedCustomerId=linkedCustomerIds.length===1&&orders.every(x=>Number(x.customer_id||0)===linkedCustomerIds[0])?linkedCustomerIds[0]:null;
    const sale=db.prepare(`INSERT INTO sales(sold_at,total_cents,payment,operator,customer_name,customer_document,customer_id,amount_paid_cents,due_cents,change_cents,delivery_cents,delivery_required,delivery_method,discount_cents,discount_percent,payment_json,cash_register_id,table_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(utc(),total,method,actor.name,orders.map(x=>x.customer_name).filter((v,i,a)=>a.indexOf(v)===i).join(', '),'',linkedCustomerId,total,0,0,0,0,isPickup?'':'MESA',0,0,JSON.stringify(normalized),cash.id,table?.id||null);
    const saleId=Number(sale.lastInsertRowid);
    const addItem=db.prepare('INSERT INTO sale_items(sale_id,product_id,kit_id,name,quantity,unit_price_cents,total_cents,sale_mode,weight_grams,unit_count,linked_unit_product_id) VALUES(?,?,?,?,?,?,?,\'UNIT\',0,0,NULL)');
    for(const order of orders){
      for(const i of db.prepare('SELECT * FROM restaurant_order_items WHERE order_id=?').all(order.id))addItem.run(saleId,i.product_id,i.kit_id,i.name,i.quantity,i.unit_price_cents,i.total_cents);
      db.prepare("UPDATE restaurant_orders SET status='PAGO',paid_at=?,sale_id=? WHERE id=? AND status='ABERTO'").run(utc(),saleId,order.id);
    }
    const addPayment=db.prepare('INSERT INTO sale_payments(sale_id,customer_id,method,original_cents,fee_percent,fee_cents,final_cents,installments,condition_text,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
    for(const tender of normalized)addPayment.run(saleId,linkedCustomerId,tender.method,tender.original_cents,tender.fee_percent,tender.fee_cents,tender.final_cents,tender.installments,tender.condition_text,utc());
    return {saleId,total_cents:total,base_cents:base,fee_cents:fee,method,payments:normalized,orders:orders.map(x=>x.id)};
  });
  const webPayTable=(input,actor)=>{
    const key=String(input.payment_key||'').trim();if(!/^[A-Za-z0-9_-]{8,120}$/.test(key))throw err('Identificador do pagamento inválido.');
    return db.transaction(()=>{const prior=db.prepare('SELECT response_json FROM restaurant_web_payment_keys WHERE request_key=?').get(key);if(prior)return {...JSON.parse(prior.response_json),duplicate:true};const result=payTable(input,actor);db.prepare('INSERT INTO restaurant_web_payment_keys(request_key,response_json,created_at) VALUES(?,?,?)').run(key,JSON.stringify(result),utc());return result;})();
  };
  async function printReceipt(saleId){
    const s=db.prepare('SELECT * FROM sales WHERE id=?').get(asInt(saleId));if(!s)throw err('Venda não localizada.');
    const items=db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(s.id);
    const lines=[`VENDA #${s.id}`,new Date(s.sold_at).toLocaleString('pt-BR'),`CLIENTE: ${s.customer_name||'-'}`,`OPERADOR: ${s.operator||'-'}`,'------------------------------',...items.map(x=>`${x.quantity}x ${x.name}: ${money(x.total_cents)}`),'------------------------------',`TOTAL: ${money(s.total_cents)}`,`PAGO: ${money(s.amount_paid_cents)}`,`MEIO: ${s.payment}`,'RECIBO NÃO FISCAL'];
    await printHtml(receiptHtml('COMPROVANTE DE VENDA',lines),'receipt');audit(s.operator||'Sistema','Comprovante impresso no caixa','sale',s.id,'Impressora de comprovantes',s.total_cents,'sales');return true;
  }
  const localIPs=()=>Object.values(os.networkInterfaces()).flat().filter(x=>x&&!x.internal&&x.family==='IPv4').map(x=>x.address);
  const remoteBridge=createRemoteBridge({db,app,safeStorage,log:console,callbacks:{
    getSnapshot(operator){
      let permissions={};try{permissions=JSON.parse(operator.permissions_json||'{}')}catch{}
      const shared=permissions.shared_tables!==false;
      const tables=listTables().filter(t=>permissions.view_all_tables===true||Number(t.primary_operator_id||0)===Number(operator.id)||shared||Number(t.open_orders||0)===0);
      const allowedTableIds=new Set(tables.map(t=>Number(t.id)));
      const ownedTableIds=new Set(tables.filter(t=>Number(t.primary_operator_id||0)===Number(operator.id)).map(t=>Number(t.id)));
      const orders=listOrders().filter(x=>['ABERTO','PAGO'].includes(x.status)&&(Number(x.operator_id)===Number(operator.id)||(x.order_type==='MESA'&&(shared&&allowedTableIds.has(Number(x.table_id))||ownedTableIds.has(Number(x.table_id))))||permissions.view_all_tables===true)).map(publicOrder);
      const customers=db.prepare('SELECT id,name,phone FROM customers ORDER BY name').all();
      const notifications=db.prepare("SELECT id,event_key,order_id,kind,title,message,details_json,created_at,read_at FROM restaurant_notifications WHERE target='OPERATOR' AND operator_id=? ORDER BY id DESC LIMIT 150").all(operator.id).map(n=>({...n,details:JSON.parse(n.details_json||'{}')}));
      return {operator:{id:operator.id,name:operator.name,permissions},permissions,tables,catalog:catalog(),customers,orders,notifications,cash_open:!!db.prepare("SELECT 1 FROM cash_registers WHERE closing_status='ABERTO' LIMIT 1").get(),operational_generation:Number(get('operational_generation')||1),generated_at:utc()};
    },
    async processRequest(item,operator){
      const requestId=String(item.id||'');
      const payload=item.payload||{};
      const requestGeneration=Number(payload._operational_generation||1);
      const currentGeneration=Number(get('operational_generation')||1);
      if(!Number.isSafeInteger(requestGeneration)||requestGeneration!==currentGeneration)throw err('Esta solicitação pertence a uma sessão de dados anterior. Atualize o atendimento e envie novamente o pedido.','STALE_OPERATION');
      const prior=db.prepare('SELECT response_json FROM restaurant_remote_processed WHERE request_id=?').get(requestId);
      if(prior)return JSON.parse(prior.response_json);
      const actor={id:operator.id,name:operator.name,role:'operator',deviceId:null,permissions:operator.permissions||(()=>{try{return JSON.parse(operator.permissions_json||'{}')}catch{return {}}})()};
      let result;
      if(item.request_type==='CALL_RESPONSIBLE'){
        const table=payload.table_id?db.prepare('SELECT label FROM restaurant_tables WHERE id=? AND active=1').get(asInt(payload.table_id)):null;
        const place=table?` · Mesa ${table.label}`:payload.order_type==='RETIRADA'?' · Retirada':'';
        const context=String(payload.context||'Atendimento').slice(0,100);
        createNotification({event_key:`help:${requestId}`,target:'WINDOWS',operator_id:actor.id,kind:'HELP_REQUEST',title:'Atendente solicitou apoio',message:`${actor.name} solicitou apoio${place} · ${context}`,details:{operator_id:actor.id,operator_name:actor.name,table_id:payload.table_id||null,order_type:payload.order_type||'',context}});
        audit(actor.name,'Solicitou apoio ao responsável','restaurant_help',payload.table_id||null,`${place} · ${context}`,0,'orders');
        result={ok:true,requested:true};
        db.prepare('INSERT OR IGNORE INTO restaurant_remote_processed(request_id,response_json,processed_at) VALUES(?,?,?)').run(requestId,JSON.stringify(result),utc());
      }else if(item.request_type==='LIST_ORDERS_BY_DAY'){
        result=listOrdersVisibleToOperatorByLocalDay(payload.date,actor).map(publicOrder);
        db.prepare('INSERT OR IGNORE INTO restaurant_remote_processed(request_id,response_json,processed_at) VALUES(?,?,?)').run(requestId,JSON.stringify(result),utc());
      }else if(item.request_type==='CREATE_ORDER'){
        requirePermission(actor,'send_orders','Este operador não está autorizado a enviar pedidos pelo site.');
        result=db.transaction(()=>{
          const again=db.prepare('SELECT response_json FROM restaurant_remote_processed WHERE request_id=?').get(requestId);
          if(again)return JSON.parse(again.response_json);
          const value=saveOrder(payload,actor,'Aplicativo Web Remoto');
          db.prepare('INSERT INTO restaurant_remote_processed(request_id,response_json,processed_at) VALUES(?,?,?)').run(requestId,JSON.stringify(value),utc());
          return value;
        })();
      }else if(item.request_type==='ITEM_DELIVERY'){
        result=db.transaction(()=>{
          const again=db.prepare('SELECT response_json FROM restaurant_remote_processed WHERE request_id=?').get(requestId);
          if(again)return JSON.parse(again.response_json);
          const order=db.prepare('SELECT operator_id FROM restaurant_orders WHERE id=?').get(asInt(payload.order_id));
          if(!order||Number(order.operator_id)!==Number(operator.id))throw err('Este pedido não pertence ao atendente autenticado.','FORBIDDEN');
          const value=updateItemDelivery(payload,actor,false,'WEB REMOTO');
          db.prepare('INSERT INTO restaurant_remote_processed(request_id,response_json,processed_at) VALUES(?,?,?)').run(requestId,JSON.stringify(value),utc());
          return value;
        })();
      }else if(item.request_type==='CANCEL_ORDER'){
        requirePermission(actor,'cancel_orders','Este operador não está autorizado a cancelar pedidos.');
        const existing=db.prepare('SELECT * FROM restaurant_orders WHERE id=?').get(asInt(payload.order_id));
        if(!existing||Number(existing.operator_id)!==Number(operator.id))throw err('Este pedido não pertence ao atendente autenticado.','FORBIDDEN');
        if(existing.status==='CANCELADO'&&existing.cancel_origin==='REMOTE'&&existing.cancelled_by===operator.name&&existing.cancel_reason===String(payload.reason||'').trim()){
          result={id:existing.id,message:`Pedido #${existing.id} já estava cancelado.`,already_cancelled:true};
        }else{
          result=await cancelOrder(payload.order_id,payload.reason,actor,false,'REMOTE');
        }
        db.prepare('INSERT OR IGNORE INTO restaurant_remote_processed(request_id,response_json,processed_at) VALUES(?,?,?)').run(requestId,JSON.stringify(result),utc());
      }else if(item.request_type==='PAY_TABLE'){
        requirePermission(actor,'receive_table_payment','Este operador não está autorizado a receber pagamentos na mesa.');
        result=db.transaction(()=>{
          const again=db.prepare('SELECT response_json FROM restaurant_remote_processed WHERE request_id=?').get(requestId);
          if(again)return JSON.parse(again.response_json);
          const value=payTable(payload,actor);
          db.prepare('INSERT INTO restaurant_remote_processed(request_id,response_json,processed_at) VALUES(?,?,?)').run(requestId,JSON.stringify(value),utc());
          return value;
        })();
        audit(actor.name,'Pagamento recebido pelo site','restaurant_order',result.orders?.[0]||null,`Venda #${result.saleId} · Mesa #${payload.table_id} · ${result.method||payload.method}`,result.total_cents,'sales');
        if(payload.print_receipt)try{await printReceipt(result.saleId)}catch(e){result.print_error=e.message;}
      }else if(item.request_type==='ACK_NOTIFICATION'){
        const ids=Array.isArray(payload.ids)?payload.ids.slice(0,100).map(asInt).filter(Number.isInteger):[];
        const stmt=db.prepare("UPDATE restaurant_notifications SET read_at=? WHERE id=? AND target='OPERATOR' AND operator_id=? AND read_at IS NULL");
        for(const id of ids)stmt.run(utc(),id,operator.id);
        result={ok:true,acknowledged:ids.length};
        db.prepare('INSERT OR IGNORE INTO restaurant_remote_processed(request_id,response_json,processed_at) VALUES(?,?,?)').run(requestId,JSON.stringify(result),utc());
      }else throw err('Tipo de solicitação remota não reconhecido.','VALIDATION');
      return result;
    }
  }});
  let server=null;let failedLogins=[];
  const SESSION_TTL=90*24*60*60_000;
  const publicOrder=o=>({...o,device_id:undefined});
  function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
  const mobileWebRoot=pathModule.resolve(__dirname,'..','mobile-web');
  const mobileMime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
  function serveMobileWeb(req,res,pathname){
    if(req.method!=='GET'&&req.method!=='HEAD')return false;
    if(pathname!=='/mobile'&&!pathname.startsWith('/mobile/'))return false;
    let relative=pathname==='/mobile'||pathname==='/mobile/'?'index.html':pathname.slice('/mobile/'.length);
    try{relative=decodeURIComponent(relative);}catch{return send(res,400,{error:'Caminho inválido.'}),true;}
    const target=pathModule.resolve(mobileWebRoot,relative);
    if(target!==mobileWebRoot&&!target.startsWith(mobileWebRoot+pathModule.sep))return send(res,403,{error:'Acesso negado.'}),true;
    let stat;try{stat=fs.statSync(target);}catch{return send(res,404,{error:'Arquivo do aplicativo Web não encontrado.'}),true;}
    if(!stat.isFile())return send(res,404,{error:'Arquivo do aplicativo Web não encontrado.'}),true;
    const ext=pathModule.extname(target).toLowerCase();
    res.writeHead(200,{'Content-Type':mobileMime[ext]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://cqjorvhkiaqbpalizzvf.supabase.co; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"});
    if(req.method==='HEAD')res.end();else fs.createReadStream(target).pipe(res);
    return true;
  }
  async function handleHttp(req,res){
    try{
      const requestUrl=new URL(req.url,'http://localhost');
      const path=requestUrl.pathname;
      if(serveMobileWeb(req,res,path))return;
      if(isOperationalResetting())return send(res,503,{error:'A limpeza de dados está em andamento. Aguarde a conclusão.'});
      if(req.method==='GET'&&path==='/health')return send(res,200,{name:'ALENGO ESPETINHOS',online:true});
      let body={};
      if(req.method==='POST'){
        const chunks=[];let bytes=0;
        for await(const chunk of req){bytes+=chunk.length;if(bytes>40_000)throw err('Pedido excede o tamanho permitido.');chunks.push(chunk);}
        try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw err('JSON inválido.');}
      }
      if(req.method==='POST'&&path==='/login'){
        const nowMs=Date.now();failedLogins=failedLogins.filter(t=>nowMs-t<60_000);
        if(failedLogins.length>=10)throw err('Muitas tentativas. Aguarde um minuto.','RATE_LIMIT');
        const username=String(body.username||'').trim();const deviceId=String(body.device_id||'');
        if(!/^[A-Za-z0-9_-]{8,100}$/.test(deviceId))throw err('Identificação do aparelho inválida.');
        const user=db.prepare('SELECT * FROM operators WHERE lower(name)=lower(?) AND active=1').get(username);
        const suppliedHash=hash(body.password||'');
        if(!user||!crypto.timingSafeEqual(Buffer.from(String(user.password_hash||'').padEnd(64,'0').slice(0,64),'utf8'),Buffer.from(suppliedHash,'utf8'))){
          failedLogins.push(nowMs);throw err('Usuário ou senha inválidos.','AUTH');
        }
        const token=rand(32);const now=utc();
        db.prepare('INSERT INTO restaurant_mobile_sessions(token_hash,operator_id,device_id,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)')
          .run(hash(token),user.id,deviceId,now,now,nowMs+SESSION_TTL);
        db.prepare('INSERT INTO restaurant_mobile_devices(device_id,operator_id,updated_at) VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET operator_id=excluded.operator_id,updated_at=excluded.updated_at')
          .run(deviceId,user.id,now);
        audit(user.name,'Entrada pelo aplicativo móvel','operator',user.id,'Aparelho autenticado na rede local',0,'system');
        let permissions={};try{permissions=JSON.parse(user.permissions_json||'{}')}catch{}return send(res,200,{token,operator:user.name,role:user.role,permissions,expires_at:nowMs+SESSION_TTL});
      }
      const token=String(req.headers.authorization||'').replace(/^Bearer /i,'');
      const session=db.prepare('SELECT * FROM restaurant_mobile_sessions WHERE token_hash=?').get(hash(token));
      if(!token||!session||session.expires_at<Date.now())throw err('Sessão expirada. Entre novamente.','AUTH');
      const actor=db.prepare('SELECT id,name,role,permissions_json FROM operators WHERE id=? AND active=1').get(session.operator_id);if(actor){try{actor.permissions=JSON.parse(actor.permissions_json||'{}')}catch{actor.permissions={}}}
      if(!actor)throw err('Operador desativado.','AUTH');
      actor.deviceId=session.device_id;
      if(Date.now()-(Date.parse(session.last_seen_at)||0)>60000){
        db.prepare('UPDATE restaurant_mobile_sessions SET last_seen_at=?,expires_at=? WHERE token_hash=?').run(utc(),Date.now()+SESSION_TTL,hash(token));
      }
      if(req.method==='GET'&&path==='/me')return send(res,200,{operator:actor.name,role:actor.role,permissions:actor.permissions||{}});
      if(req.method==='POST'&&path==='/logout'){
        db.prepare('DELETE FROM restaurant_mobile_sessions WHERE token_hash=?').run(hash(token));
        audit(actor.name,'Saída do aplicativo móvel','operator',actor.id,'Sessão deste aparelho encerrada',0,'system');
        return send(res,200,{ok:true});
      }
      if(req.method==='POST'&&path==='/devices/push-token'){
        const push=String(body.push_token||'');
        if(push&&!/^Expo(nent)?PushToken\[[^\]]{10,255}\]$/.test(push))throw err('Token de notificação inválido.');
        db.prepare('UPDATE restaurant_mobile_devices SET operator_id=?,push_token=?,updated_at=? WHERE device_id=?').run(actor.id,push||null,utc(),session.device_id);
        return send(res,200,{ok:true});
      }
      if(req.method==='GET'&&path==='/alerts'){
        const ready=db.prepare('SELECT id,order_id,message,created_at FROM restaurant_ready_alerts WHERE device_id=? AND operator_id=? AND acknowledged_at IS NULL ORDER BY id LIMIT 100').all(session.device_id,actor.id)
          .map(x=>({...x,type:'ORDER_READY'}));
        const cancelled=db.prepare('SELECT id,order_id,message,created_at FROM restaurant_cancel_alerts WHERE device_id=? AND operator_id=? AND acknowledged_at IS NULL ORDER BY id LIMIT 100').all(session.device_id,actor.id)
          .map(x=>({...x,id:'c'+x.id,type:'ORDER_CANCELLED'}));
        return send(res,200,[...ready,...cancelled].sort((a,b)=>a.created_at.localeCompare(b.created_at)).slice(0,100));
      }
      if(req.method==='POST'&&path==='/alerts/ack'){
        const ids=Array.isArray(body.ids)?body.ids.slice(0,100).map(asInt).filter(Number.isInteger):[];
        const stmt=db.prepare('UPDATE restaurant_ready_alerts SET acknowledged_at=? WHERE id=? AND device_id=? AND operator_id=? AND acknowledged_at IS NULL');
        for(const id of ids)stmt.run(utc(),id,session.device_id,actor.id);
        const cancelled=Array.isArray(body.ids)?body.ids.slice(0,100).map(x=>String(x)).filter(x=>/^c[1-9]\d*$/.test(x)):[];
        const stmtCancel=db.prepare('UPDATE restaurant_cancel_alerts SET acknowledged_at=? WHERE id=? AND device_id=? AND operator_id=? AND acknowledged_at IS NULL');
        for(const key of cancelled)stmtCancel.run(utc(),Number(key.slice(1)),session.device_id,actor.id);
        return send(res,200,{ok:true});
      }
      if(req.method==='GET'&&path==='/notifications'){
        const rows=db.prepare("SELECT id,event_key,order_id,kind,title,message,details_json,created_at,read_at FROM restaurant_notifications WHERE target='OPERATOR' AND operator_id=? ORDER BY id DESC LIMIT 150").all(actor.id).map(n=>({...n,details:JSON.parse(n.details_json||'{}')}));
        return send(res,200,rows);
      }
      if(req.method==='POST'&&path==='/notifications/ack'){
        const ids=Array.isArray(body.ids)?body.ids.slice(0,100).map(asInt).filter(Number.isInteger):[];
        const stmt=db.prepare("UPDATE restaurant_notifications SET read_at=? WHERE id=? AND target='OPERATOR' AND operator_id=? AND read_at IS NULL");
        for(const id of ids)stmt.run(utc(),id,actor.id);
        return send(res,200,{ok:true,acknowledged:ids.length});
      }
      if(req.method==='POST'&&path==='/web/payments/table'){
        requirePermission(actor,'receive_table_payment','Este operador não está autorizado a receber pagamentos na mesa.');
        const result=webPayTable(body,actor);if(!result.duplicate){audit(actor.name,'Pagamento recebido pelo site','restaurant_order',result.orders?.[0]||null,`Venda #${result.saleId} · Mesa #${body.table_id} · ${result.method||body.method||'formas combinadas'}`,result.total_cents,'sales');if(body.print_receipt)try{await printReceipt(result.saleId)}catch(e){result.print_error=e.message;}}
        return send(res,200,result);
      }
      if(req.method==='GET'&&path==='/web/orders'){const owned=db.prepare('SELECT id FROM restaurant_tables WHERE primary_operator_id=?').all(actor.id).map(x=>Number(x.id));return send(res,200,listOrders().filter(x=>['ABERTO','PAGO'].includes(x.status)&&(Number(x.operator_id)===actor.id||(x.order_type==='MESA'&&(actor.permissions?.shared_tables!==false||owned.includes(Number(x.table_id))))||hasPermission(actor,'view_all_tables'))).map(publicOrder));}
      if(req.method==='GET'&&path==='/web/orders/history')return send(res,200,listOrdersVisibleToOperatorByLocalDay(requestUrl.searchParams.get('date'),actor).map(publicOrder));
      if(req.method==='POST'&&path==='/web/call-responsible'){const table=body.table_id?db.prepare('SELECT label FROM restaurant_tables WHERE id=? AND active=1').get(asInt(body.table_id)):null;const place=table?` · Mesa ${table.label}`:body.order_type==='RETIRADA'?' · Retirada':'';const context=String(body.context||'Atendimento').slice(0,100);createNotification({event_key:`help:${crypto.randomUUID()}`,target:'WINDOWS',operator_id:actor.id,kind:'HELP_REQUEST',title:'Atendente solicitou apoio',message:`${actor.name} solicitou apoio${place} · ${context}`,details:{operator_id:actor.id,operator_name:actor.name,table_id:body.table_id||null,order_type:body.order_type||'',context}});audit(actor.name,'Solicitou apoio ao responsável','restaurant_help',body.table_id||null,`${place} · ${context}`,0,'orders');return send(res,200,{ok:true,requested:true});}
      if(req.method==='POST'&&path==='/web/orders'){requirePermission(actor,'send_orders','Este operador não está autorizado a enviar pedidos pelo site.');return send(res,201,saveOrder(body,actor,'Aplicativo Web Local'));}
      if(req.method==='POST'&&path==='/web/orders/cancel'){requirePermission(actor,'cancel_orders','Este operador não está autorizado a cancelar pedidos.');return send(res,200,await cancelOrder(body.order_id,body.reason,actor,true));}
      if(req.method==='GET'&&path==='/catalog')return send(res,200,catalog());
      if(req.method==='GET'&&path==='/customers')return send(res,200,db.prepare('SELECT id,name,phone FROM customers ORDER BY name').all());
      if(req.method==='GET'&&path==='/tables'){const all=listTables();return send(res,200,hasPermission(actor,'view_all_tables')?all:all.filter(t=>Number(t.primary_operator_id||0)===actor.id||actor.permissions?.shared_tables!==false||Number(t.open_orders||0)===0));}
      if(req.method==='GET'&&path==='/status')return send(res,200,{cash_open:!!db.prepare("SELECT 1 FROM cash_registers WHERE closing_status='ABERTO' LIMIT 1").get(),permissions:actor.permissions||{}});
      if(req.method==='GET'&&path==='/orders')return send(res,200,listOrders().filter(x=>['ABERTO','PAGO'].includes(x.status)&&x.device_id===session.device_id).map(publicOrder));
      if(req.method==='POST'&&path==='/orders')return send(res,201,saveOrder(body,actor,'Aplicativo móvel'));
      if(req.method==='POST'&&path==='/orders/item-delivery')return send(res,200,await updateItemDelivery(body,actor,true));
      if(req.method==='POST'&&path==='/orders/cancel')return send(res,200,await cancelOrder(body.order_id,body.reason,actor,true));
      return send(res,404,{error:'Rota inexistente.'});
    }catch(e){return send(res,e.code==='AUTH'?401:e.code==='RATE_LIMIT'?429:e.code==='FORBIDDEN'?403:e.code==='NOT_FOUND'?404:['STOCK','CONFLICT','PAID_ORDER','DELIVERED_ORDER'].includes(e.code)?409:400,{error:e.message,code:e.code||'ERROR'});}
  }
  function startServer(){
    if(server)return;
    server=http.createServer((req,res)=>{handleHttp(req,res).catch(e=>send(res,500,{error:e.message}));});
    server.on('error',e=>{console.error('ALENGO LAN:',e.message);server=null;remoteBridge.stop();});
    server.once('listening',()=>remoteBridge.start());
    server.listen(Number(get('restaurant_port')||8765),'0.0.0.0');
    // Tarefas que nunca começaram a imprimir podem ser retomadas após reiniciar.
    setImmediate(()=>{try{for(const j of db.prepare("SELECT order_id FROM restaurant_print_jobs WHERE status='PENDING' ORDER BY id").all())printOrder(j.order_id);}catch(e){console.error('Impressão pendente:',e.message);}});
  }
  function shutdown(){server?.close();server=null;remoteBridge.stop();}
  function register(){
    ipcMain.handle('restaurant:remote-status',()=>remoteBridge.getStatus());
    ipcMain.handle('restaurant:notifications',()=>{requireUser();return {ok:true,data:db.prepare("SELECT id,order_id,kind,title,message,details_json,created_at,read_at FROM restaurant_notifications WHERE target='WINDOWS' ORDER BY id DESC LIMIT 200").all().map(n=>({...n,details:JSON.parse(n.details_json||'{}')}))}});
    ipcMain.handle('restaurant:notifications-ack',(_,ids=[])=>{requireUser();const stmt=db.prepare("UPDATE restaurant_notifications SET read_at=? WHERE id=? AND target='WINDOWS' AND read_at IS NULL");const values=Array.isArray(ids)?ids.slice(0,100).map(asInt).filter(Number.isInteger):[];for(const id of values)stmt.run(utc(),id);return {ok:true,data:{acknowledged:values.length}}});
    ipcMain.handle('restaurant:tables',()=>{requireUser();return {ok:true,data:listTables()}});
    ipcMain.handle('restaurant:orders',(_,tableId)=>{requireUser();return {ok:true,data:listOrders(tableId||null)}});
    ipcMain.handle('restaurant:orders-history',(_,date)=>{requireUser();return {ok:true,data:listOrdersByLocalDay(date)}});
    ipcMain.handle('restaurant:catalog',()=>{requireUser();return {ok:true,data:catalog()}});
    ipcMain.handle('restaurant:table-save',(_,input)=>{
      requireAdmin();const label=String(input.label||'').trim().slice(0,25);if(!label)throw err('Informe o número/nome da mesa.');const primary= input.primary_operator_id?asInt(input.primary_operator_id):null;if(primary&&!db.prepare("SELECT 1 FROM operators WHERE id=? AND active=1 AND role<>'admin'").get(primary))throw err('Operador responsável inválido.');
      if(input.id){db.prepare('UPDATE restaurant_tables SET label=?,primary_operator_id=? WHERE id=? AND active=1').run(label,primary,asInt(input.id));}
      else db.prepare('INSERT INTO restaurant_tables(label,created_at,primary_operator_id) VALUES(?,?,?)').run(label,utc(),primary);
      return {ok:true,data:listTables()};
    });
    ipcMain.handle('restaurant:table-delete',(_,id)=>{
      requireAdmin();if(db.prepare("SELECT 1 FROM restaurant_orders WHERE table_id=? AND status='ABERTO'").get(asInt(id)))throw err('Mesa com pedido pendente.');
      db.prepare('UPDATE restaurant_tables SET active=0 WHERE id=?').run(asInt(id));return {ok:true,data:true};
    });
    ipcMain.handle('restaurant:order-create',(_,body)=>{const actor=requireUser();return {ok:true,data:saveOrder(body,actor)}});
    ipcMain.handle('restaurant:order-pay',async(_,body)=>{const actor=requireUser();const result=payTable(body,actor);audit(actor.name,'Mesa quitada','restaurant_order',result.orders[0]||null,`Mesa #${body.table_id} · Venda #${result.saleId} · ${body.method}`,result.total_cents,'orders');if(body.print_receipt)try{await printReceipt(result.saleId)}catch(e){result.print_error=e.message;audit(actor.name,'Falha ao imprimir comprovante','sale',result.saleId,e.message||String(e),0,'sales')}return {ok:true,data:result}});
    ipcMain.handle('restaurant:reprint',async(_,id)=>{requireAdmin();db.prepare("UPDATE restaurant_print_jobs SET status='PENDING' WHERE order_id=?").run(asInt(id));await printOrder(id);return {ok:true,data:db.prepare('SELECT status,last_error FROM restaurant_print_jobs WHERE order_id=?').get(asInt(id))};});
    ipcMain.handle('restaurant:printers',async()=>{requireAdmin();const win=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed());return {ok:true,data:win?await win.webContents.getPrintersAsync():[]}});
    ipcMain.handle('restaurant:settings',()=>{const admin=requireUser().role==='admin';return {ok:true,data:{printer:get('restaurant_printer'),receipt_printer:get('restaurant_receipt_printer'),port:Number(get('restaurant_port')||8765),ips:localIPs(),mobile_sessions:db.prepare('SELECT COUNT(*) n FROM restaurant_mobile_sessions WHERE expires_at>?').get(Date.now()).n,admin}};});
    ipcMain.handle('restaurant:printer-set',(_,printer)=>{const actor=requireAdmin();const value=String(printer||'');if(value&&value===get('restaurant_receipt_printer'))throw err('A impressora de comandas deve ser diferente da impressora do caixa.');put('restaurant_printer',value);audit(actor.name,'Impressora da cozinha alterada','printer',null,'Comandas: '+(value||'não configurada'),0,'system');return {ok:true,data:true};});
    ipcMain.handle('restaurant:receipt-printer-set',(_,printer)=>{const actor=requireAdmin();const value=String(printer||'');if(value&&value===get('restaurant_printer'))throw err('A impressora do caixa deve ser diferente da impressora de comandas.');put('restaurant_receipt_printer',value);audit(actor.name,'Impressora do caixa alterada','printer',null,'Comprovantes: '+(value||'não configurada'),0,'system');return {ok:true,data:true};});
    ipcMain.handle('restaurant:revoke-mobile',()=>{const actor=requireAdmin();db.prepare('DELETE FROM restaurant_mobile_sessions').run();audit(actor.name,'Sessões móveis revogadas','operator',actor.id,'Todos os aparelhos deverão entrar novamente',0,'system');return {ok:true,data:true};});
    ipcMain.handle('restaurant:mobile-orders',()=>{requireUser();return {ok:true,data:db.prepare("SELECT id,customer_name,operator_name,order_type,table_id,total_cents,created_at FROM restaurant_orders WHERE device_id IS NOT NULL AND device_id<>'' ORDER BY id DESC LIMIT 100").all()};});
    ipcMain.handle('restaurant:mobile-cancellations',()=>{requireUser();return {ok:true,data:db.prepare("SELECT id,customer_name,order_type,table_id,cancelled_at,cancelled_by,cancel_reason FROM restaurant_orders WHERE status='CANCELADO' AND cancel_origin='MOBILE' ORDER BY cancelled_at DESC LIMIT 100").all()};});
    ipcMain.handle('restaurant:order-cancel',async(_,input={})=>{const actor=requireUser();return {ok:true,data:await cancelOrder(input.order_id,input.reason,actor,false)};});
    ipcMain.handle('restaurant:item-delivery',(_,input)=>{const actor=requireUser();return {ok:true,data:updateItemDelivery(input,actor,false)}});
    ipcMain.handle('restaurant:order-ready',(_,orderId)=>{const actor=requireUser();return {ok:true,data:markOrderDelivered(orderId,actor)}});
    ipcMain.handle('restaurant:receipt',async(_,saleId)=>{requireUser();return {ok:true,data:await printReceipt(saleId)}});
  }
  return {register,startServer,shutdown,printOrder,syncRemoteOperator:(operator,password,enabled)=>remoteBridge.syncOperator(operator,password,enabled),resetRemoteOperationalData:callback=>remoteBridge.resetOperationalData(callback)};
}
module.exports={initializeRestaurant,makeRestaurant};
