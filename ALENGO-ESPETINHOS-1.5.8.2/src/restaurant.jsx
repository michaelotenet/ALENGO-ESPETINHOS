import React,{useEffect,useState,useCallback,useRef} from 'react';
import * as I from 'lucide-react';
const brl=n=>(Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const randomKey=()=>((globalThis.crypto&&globalThis.crypto.randomUUID)?globalThis.crypto.randomUUID():String(Date.now())+'_'+Math.random().toString(36).slice(2));

export default function RestaurantPage({notify}){
 const [tables,setTables]=useState([]),[orders,setOrders]=useState([]),[catalog,setCatalog]=useState({products:[],kits:[]}),[config,setConfig]=useState({}),[printers,setPrinters]=useState([]),[operators,setOperators]=useState([]),[primaryOperatorId,setPrimaryOperatorId]=useState('');
 const [selected,setSelected]=useState(null),[label,setLabel]=useState(''),[customer,setCustomer]=useState(''),[items,setItems]=useState([]),[busy,setBusy]=useState(false);
 const [historyDate,setHistoryDate]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}),[historyOrders,setHistoryOrders]=useState([]),[historyLoading,setHistoryLoading]=useState(false);
 const [tableView,setTableView]=useState(()=>{try{return ['blocks','details','list'].includes(localStorage.getItem('alengo:mesa-view'))?localStorage.getItem('alengo:mesa-view'):'blocks'}catch{return 'blocks'}});
 const lastCancelled=useRef(null);
 const [payment,setPayment]=useState('PIX'),[fee,setFee]=useState('0'),[installments,setInstallments]=useState('1'),[printReceipt,setPrintReceipt]=useState(true),[payOrderId,setPayOrderId]=useState(null);
 const notifyRef=useRef(notify);notifyRef.current=notify;
 const load=useCallback(async()=>{try{
  const [t,o,c,settings,ops]=await Promise.all([window.api.restaurant.tables(),window.api.restaurant.orders(),window.api.restaurant.catalog(),window.api.restaurant.settings(),window.api.operators.list()]);
  if(lastCancelled.current!==null){const fresh=o.filter(x=>x.status==='CANCELADO'&&x.cancelled_at&&!lastCancelled.current.has(x.id));for(const cancelled of fresh){if(cancelled.cancelled_by!==settings.current_operator_name)notifyRef.current(`Pedido #${cancelled.id} cancelado por ${cancelled.cancelled_by||'atendente'}: ${cancelled.cancel_reason||'sem motivo'}`)}}
  lastCancelled.current=new Set(o.filter(x=>x.status==='CANCELADO').map(x=>x.id));
  setTables(t);setOrders(o);setCatalog(c);setConfig(settings);setOperators((ops||[]).filter(x=>x.role!=='admin')); 
 }catch(e){notifyRef.current(e)}},[]);
 useEffect(()=>{load();const timer=setInterval(load,4500);return()=>clearInterval(timer)},[load]);
 const isPickup=selected==='RETIRADA';
 const active=orders.filter(o=>o.status==='ABERTO'&&(isPickup?o.order_type==='RETIRADA':Number(o.table_id)===Number(selected)&&!!selected&&o.order_type!=='RETIRADA'));
 const pending=active.reduce((a,o)=>a+Number(o.total_cents),0);
 const preparing=orders.filter(o=>o.status==='PAGO'&&!o.ready_at&&(isPickup?o.order_type==='RETIRADA':Number(o.table_id)===Number(selected)&&!!selected&&o.order_type!=='RETIRADA'));
 const visibleOrders=[...active,...preparing].sort((a,b)=>b.id-a.id);
 const awaitingPreparation=orders.filter(o=>!o.ready_at&&(o.status==='ABERTO'||o.status==='PAGO')).sort((a,b)=>b.id-a.id);
 const selectedOrder=active.find(o=>o.id===Number(payOrderId))||active[0];
 const paymentBase=isPickup?Number(selectedOrder?.total_cents||0):pending;
 const submit=async(action)=>{if(busy)return;setBusy(true);try{const result=await action();await load();return result}catch(e){notifyRef.current(e);return null}finally{setBusy(false)}};
 const addProduct=(p,kit=false)=>setItems(prev=>{const key=(kit?'k':'p')+p.id;const exists=prev.find(x=>x.key===key);return exists?prev.map(x=>x.key===key?{...x,quantity:x.quantity+1}:x):[...prev,{key,name:p.name,quantity:1,price_cents:p.price_cents,notes:'',...(kit?{kit_id:p.id}:{product_id:p.id})}]});
 const totalDraft=items.reduce((a,i)=>a+Number(i.quantity)*Number(i.price_cents),0);
 const select=x=>{setSelected(x);setItems([]);setCustomer('');setPayOrderId(null)};
 const pay=()=>submit(async()=>{
  const input={...(isPickup?{order_id:selectedOrder.id}:{table_id:selected}),method:payment,fee_percent:Number(fee)||0,installments:Number(installments)||1,print_receipt:printReceipt};
  const result=await window.api.restaurant.pay(input);window.dispatchEvent(new Event('unipdv-data-refresh'));
  notifyRef.current(`Venda #${result.saleId} recebida: ${brl(result.total_cents)}.${result.print_error?' Comprovante não impresso: '+result.print_error:''}`);
  setPayOrderId(null);return result;
 });
 const cancelOrder=o=>{
  const reason=window.prompt(`Cancelar pedido #${o.id} de ${o.customer_name}?\nInforme o motivo (mínimo 5 caracteres):`,'');
  if(reason===null)return;
  if(reason.trim().length<5){notifyRef.current('Informe um motivo com pelo menos 5 caracteres.');return}
  submit(async()=>{const r=await window.api.restaurant.cancel({order_id:o.id,reason:reason.trim()});notifyRef.current(`Pedido #${o.id} cancelado. Estoque estornado e atendente avisado, quando vinculado.`);return r;});
 };
 const chooseView=x=>{setTableView(x);try{localStorage.setItem('alengo:mesa-view',x)}catch{}};
 const loadHistory=async()=>{setHistoryLoading(true);try{setHistoryOrders(await window.api.restaurant.history(historyDate));}catch(e){notifyRef.current(e)}finally{setHistoryLoading(false)}};
 const alertReady=o=>submit(async()=>{
  const r=await window.api.restaurant.ready(o.id);
  notifyRef.current(o.device_id?`Todos os itens do pedido #${o.id} foram marcados como prontos e entregues. Alerta disponibilizado ao celular de origem.${r.push_configured?' Notificação push também solicitada.':''}`:`Todos os itens do pedido #${o.id} foram marcados como prontos e entregues no caixa (não há celular vinculado).`);
 });
 const updateDelivery=(o,item,delta)=>submit(async()=>{
  const r=await window.api.restaurant.itemDelivery({order_id:o.id,item_id:item.id,delta});
  notifyRef.current(`${item.name}: ${r.item.delivered_quantity}/${item.quantity} unidade(s) prontas e entregues no pedido #${o.id}.`);
  return r;
 });
 const renderDeliveryItems=o=>{
  const total=o.items.reduce((sum,i)=>sum+Number(i.quantity||0),0);
  const delivered=o.items.reduce((sum,i)=>sum+Number(i.delivered_quantity||0),0);
  return <div className="alengo-item-delivery">
   <div className="alengo-item-delivery-summary"><b>Entrega dos itens</b><span>{delivered}/{total} unidade(s) prontas e entregues{delivered===total?' · Pedido completo':delivered>0?' · Parcial':' · Aguardando entrega'}</span></div>
   {o.items.map(item=>{const done=Number(item.delivered_quantity||0),qty=Number(item.quantity||0);return <div className="alengo-item-delivery-row" key={item.id}>
    <div className="alengo-item-delivery-name"><b>{item.name}</b><small>{done}/{qty} pronta(s) e entregue(s){item.notes?` · ${item.notes}`:''}</small></div>
    <div className="alengo-item-delivery-actions"><button className="smallbtn" type="button" title="Corrigir quantidade entregue" disabled={busy||done<=0} onClick={()=>updateDelivery(o,item,-1)}>−</button><button className="smallbtn alengo-ready" type="button" disabled={busy||done>=qty||o.status==='CANCELADO'} onClick={()=>updateDelivery(o,item,1)}>Pronto + entregue (+1)</button></div>
   </div>})}
  </div>;
 };
 return <div className="alengo-orders">
  <div className="toolbar"><div><h2>Pedidos e mesas</h2><p className="muted">Identifique cada pedido como <b>Mesa</b> ou <b>Retirada</b>. Comandas na cozinha e comprovantes no caixa.</p></div><button className="smallbtn" onClick={load}><I.RefreshCcw/> Atualizar</button></div>
  <div className="panel alengo-ready-queue" aria-label="Pedidos aguardando preparo">
    <div className="toolbar"><div><h3><I.BellRing/> Pedidos aguardando preparo</h3><p className="muted">Marque cada unidade conforme fica pronta e é levada à mesa. O andamento é compartilhado com o aplicativo móvel; a quitação é independente do preparo.</p></div><strong>{awaitingPreparation.length} aguardando</strong></div>
    {awaitingPreparation.length===0?<p className="muted">Nenhum pedido aguardando preparo.</p>:<div className="alengo-ready-list">
      {awaitingPreparation.slice(0,40).map(o=><div className="alengo-ready-row" key={o.id}>
       <div className="alengo-ready-row-main"><b>#{o.id} · {o.order_type==='RETIRADA'?'RETIRADA':`MESA ${tables.find(t=>Number(t.id)===Number(o.table_id))?.label||o.table_id||'-'}`} · {o.customer_name}</b>
       <small>{o.operator_name} · {o.status==='PAGO'?'Pago':'Aguardando pagamento'} · {o.device_id?'Enviado pelo celular':'Registrado no Windows'}</small>{renderDeliveryItems(o)}</div>
       <button className="smallbtn alengo-ready" type="button" disabled={busy||o.items.every(i=>Number(i.delivered_quantity||0)>=Number(i.quantity))} onClick={()=>alertReady(o)}><I.CheckCircle2/> Marcar tudo entregue</button>
       {o.status==='ABERTO'&&!o.items.some(i=>Number(i.delivered_quantity||0)>0)&&<button className="smallbtn danger" type="button" disabled={busy} onClick={()=>cancelOrder(o)}><I.XCircle/> Cancelar pedido</button>}
      </div>)}
      {awaitingPreparation.length>40&&<p className="muted">Mostrando os 40 pedidos mais recentes; atualize ou selecione a mesa para consultar outros.</p>}
    </div>}
  </div>
  <div className="panel"><div className="toolbar"><h3>Tipo de atendimento</h3><div className="alengo-view-switch" aria-label="Visualização das mesas">
    {[["details","Detalhes",I.ListCollapse],["list","Lista Completa",I.List],["blocks","Blocos",I.LayoutGrid]].map(([id,title,Icon])=><button key={id} className={`smallbtn ${tableView===id?'active':''}`} aria-pressed={tableView===id} onClick={()=>chooseView(id)}><Icon/> {title}</button>)}
  </div></div><div className={`alengo-tables-view alengo-mesas-${tableView}`}>
    <button className={`alengo-table alengo-pickup-tile ${isPickup?'active':''}`} onClick={()=>select('RETIRADA')}><I.ShoppingBag/><strong>RETIRADA</strong><small>{orders.filter(o=>o.order_type==='RETIRADA'&&o.status==='ABERTO').length} pedido(s) aguardando</small>{tableView==='details'&&<span className="muted">Clientes sem mesa · pagamentos individuais</span>}</button>
    {tables.map(t=>{const activeOrders=orders.filter(o=>o.table_id===t.id&&o.status==='ABERTO');return <button key={t.id} onClick={()=>select(t.id)} className={`alengo-table ${Number(selected)===Number(t.id)?'active':''} ${t.open_orders?'occupied':''}`}><I.Utensils/><strong>Mesa {t.label}</strong><small>{t.open_orders?`${t.open_orders} pedido(s) · ${brl(t.pending_cents)}`:'Livre'}</small>{tableView==='details'&&<span className="alengo-table-description">{activeOrders.slice(0,3).map(o=>`#${o.id}: ${o.customer_name}`).join(' · ')||'Disponível para atendimento'}</span>}</button>})}
  </div>{config.admin&&<div className="alengo-inline"><input placeholder="Número ou nome da mesa" value={label} onChange={e=>setLabel(e.target.value)}/><select value={primaryOperatorId} onChange={e=>setPrimaryOperatorId(e.target.value)}><option value="">Sem responsável principal</option>{operators.map(op=><option key={op.id} value={op.id}>{op.name}</option>)}</select><button className="primary" disabled={busy||!label.trim()} onClick={()=>submit(async()=>{await window.api.restaurant.saveTable({label,primary_operator_id:primaryOperatorId||null});setLabel('');setPrimaryOperatorId('');})}><I.Plus/> Cadastrar mesa</button>{selected&&!isPickup&&<button className="smallbtn danger" onClick={()=>submit(()=>window.api.restaurant.deleteTable(selected).then(()=>setSelected(null)))}>Desativar mesa</button>}</div>}</div>
  {selected&&<div className="panel">
    <div className="toolbar"><h3>{isPickup?'Pedidos para retirada':`Mesa ${tables.find(t=>Number(t.id)===Number(selected))?.label||selected}`}</h3><strong>{brl(pending)} pendente</strong></div>
    {isPickup&&<p className="muted">Retiradas são cobradas individualmente e não exigem uma mesa cadastrada.</p>}
    {visibleOrders.map(o=><div className="alengo-order" key={o.id}><div>
      <b>#{o.id} · {o.order_type==='RETIRADA'?'RETIRADA':'MESA'} · {o.customer_name}</b>
      <small>{o.operator_name} · {new Date(o.created_at).toLocaleString('pt-BR')} · {brl(o.total_cents)} · {o.status==='PAGO'?'PAGO, aguardando preparo':'Pendente de pagamento'} · Impressão: {o.print?.status||'Pendente'}</small>
      {renderDeliveryItems(o)}
      {o.print?.status==='FAILED'&&<small className="danger">{o.print.last_error}</small>}
      {o.ready_at&&<small className="alengo-ready-info">✓ TODOS OS ITENS ENTREGUES · {new Date(o.ready_at).toLocaleString('pt-BR')}</small>}
      {!o.device_id&&!o.ready_at&&<small className="muted">Pedido gerado no Windows: pode ser marcado pronto sem envio a celular.</small>}
    </div><div className="alengo-order-actions">
      {!o.ready_at&&<button className="smallbtn alengo-ready" type="button" disabled={busy||o.items.every(i=>Number(i.delivered_quantity||0)>=Number(i.quantity))} onClick={()=>alertReady(o)}><I.BellRing/> Marcar tudo entregue</button>}
      {o.status==='ABERTO'&&!o.items.some(i=>Number(i.delivered_quantity||0)>0)&&<button className="smallbtn danger" type="button" disabled={busy} onClick={()=>cancelOrder(o)}><I.XCircle/> Cancelar pedido</button>}
      {isPickup&&o.status==='ABERTO'&&<button className="smallbtn" disabled={busy} onClick={()=>setPayOrderId(o.id)}><I.WalletCards/> {Number(payOrderId)===o.id?'Selecionado':'Cobrar este pedido'}</button>}
      {config.admin&&<button className="smallbtn" disabled={busy} onClick={()=>submit(()=>window.api.restaurant.reprint(o.id))}><I.Printer/> Reimprimir</button>}
    </div></div>)}
    {!visibleOrders.length&&<p className="muted">Nenhum pedido pendente neste atendimento.</p>}
    {active.length>0&&<div className="alengo-payment"><h3>{isPickup?`Receber retirada #${selectedOrder?.id||'-'}`:'Receber conta da mesa'}</h3>
      {isPickup&&<label>Pedido para receber<select value={selectedOrder?.id||''} onChange={e=>setPayOrderId(Number(e.target.value))}>{active.map(o=><option key={o.id} value={o.id}>#{o.id} · {o.customer_name} · {brl(o.total_cents)}</option>)}</select></label>}
      <div className="formgrid"><label>Forma de pagamento<select value={payment} onChange={e=>setPayment(e.target.value)}>{['Dinheiro','PIX','Cartão de débito','Cartão de crédito'].map(x=><option key={x}>{x}</option>)}</select></label>
       {payment==='Cartão de crédito'&&<><label>Taxa (%)<input type="number" min="0" max="100" step="0.01" value={fee} onChange={e=>setFee(e.target.value)}/></label><label>Parcelas<input type="number" min="1" max="36" value={installments} onChange={e=>setInstallments(e.target.value)}/></label></>}
      </div><p><strong>Total: {brl(paymentBase+Math.round(paymentBase*(payment==='Cartão de crédito'?Number(fee)||0:0)/100))}</strong></p>
      <label className="printoption"><input type="checkbox" checked={printReceipt} onChange={e=>setPrintReceipt(e.target.checked)}/> Imprimir comprovante na impressora do caixa</label>
      <button className="primary" disabled={busy||!selectedOrder} onClick={pay}><I.CheckCircle2/> Confirmar recebimento</button>
    </div>}
    <div className="alengo-create"><h3>{isPickup?'Novo pedido para retirada':'Novo pedido para esta mesa'}</h3><label>Nome do cliente (obrigatório)<input value={customer} onChange={e=>setCustomer(e.target.value)} placeholder="Nome que será impresso na comanda"/></label>
      <div className="alengo-products">{catalog.products.map(p=><button key={'p'+p.id} className="smallbtn" disabled={p.stock<1} onClick={()=>addProduct(p)}>{p.name} · {brl(p.price_cents)} ({p.stock})</button>)}{catalog.kits.map(k=><button key={'k'+k.id} className="smallbtn" onClick={()=>addProduct(k,true)}>Combo: {k.name} · {brl(k.price_cents)}</button>)}</div>
      {items.map(i=><div key={i.key} className="alengo-item"><b>{i.name}</b><input type="number" min="1" max="1000" value={i.quantity} onChange={e=>setItems(xs=>xs.map(x=>x.key===i.key?{...x,quantity:Math.max(1,Number(e.target.value)||1)}:x))}/><input placeholder="Observações" value={i.notes} onChange={e=>setItems(xs=>xs.map(x=>x.key===i.key?{...x,notes:e.target.value}:x))}/><button className="iconbtn danger" onClick={()=>setItems(xs=>xs.filter(x=>x.key!==i.key))}><I.X/></button></div>)}
      <div className="alengo-inline"><b>Total: {brl(totalDraft)}</b><button className="primary" disabled={busy||items.length===0||customer.trim().length<2} onClick={()=>submit(async()=>{
       const r=await window.api.restaurant.create({order_type:isPickup?'RETIRADA':'MESA',...(isPickup?{}:{table_id:selected}),customer_name:customer,idempotency_key:randomKey(),items});setItems([]);setCustomer('');notifyRef.current(`Pedido #${r.id} enviado para impressão.`);return r;
      })}><I.Send/> Enviar pedido e comanda</button></div>
    </div>
  </div>}
  <details className="panel alengo-cancel-history"><summary>Histórico recente de pedidos cancelados ({orders.filter(o=>o.status==='CANCELADO').length})</summary>
  {orders.filter(o=>o.status==='CANCELADO').slice(0,25).map(o=><div className="alengo-cancel-history-item" key={o.id}>#{o.id} · {o.order_type==='RETIRADA'?'Retirada':`Mesa ${tables.find(t=>t.id===o.table_id)?.label||o.table_id}`} · {o.customer_name} · Cancelado por {o.cancelled_by||'-'} · {o.cancel_reason||'-'}</div>)}</details>
  <details className="panel alengo-cancel-history" onToggle={e=>{if(e.currentTarget.open&&!historyOrders.length)loadHistory()}}><summary>Histórico completo de pedidos por dia</summary>
   <div className="alengo-inline"><label>Dia de operação<input type="date" value={historyDate} onChange={e=>setHistoryDate(e.target.value)}/></label><button className="smallbtn" disabled={historyLoading} onClick={loadHistory}><I.CalendarDays/> {historyLoading?'Consultando...':'Consultar dia'}</button></div>
   {historyOrders.length?historyOrders.map(o=><div className="alengo-cancel-history-item" key={o.id}><b>#{o.id} · {o.order_type==='RETIRADA'?'Retirada':`Mesa ${tables.find(t=>Number(t.id)===Number(o.table_id))?.label||o.table_id}`} · {o.customer_name}</b><br/><small>{new Date(o.created_at).toLocaleString('pt-BR')} · {o.operator_name||'-'} · {brl(o.total_cents)} · {o.status}</small>{o.status==='CANCELADO'&&<p>Cancelado por {o.cancelled_by||'-'} · Motivo: {o.cancel_reason||'Não informado'}</p>}{o.items?.length>0&&<small>{o.items.map(i=>`${i.quantity}× ${i.name}`).join(' · ')}</small>}</div>):<p className="muted">{historyLoading?'Carregando histórico...':'Nenhum pedido encontrado nesta data.'}</p>}
  </details>
  {config.admin&&<div className="panel"><h3>Integração com celulares</h3>
    <p className="muted">O atendente entra uma vez com IP, usuário e senha. A sessão fica salva no armazenamento seguro do aparelho. Não é necessário PIN de pareamento. É possível utilizar vários celulares ao mesmo tempo.</p>
    <p>IP do computador: {(config.ips||[]).map(ip=><code key={ip}> http://{ip}:{config.port} </code>)}</p>
    <div className="alengo-inline"><strong>Sessões móveis válidas: {config.mobile_sessions||0}</strong><button className="smallbtn danger" disabled={busy} onClick={()=>{
      if(window.confirm('Revogar todas as sessões móveis? Os celulares precisarão digitar a senha novamente.'))submit(async()=>{await window.api.restaurant.revokeMobile();notifyRef.current('Todos os acessos móveis foram revogados.');});
    }}><I.ShieldOff/> Revogar acessos móveis</button></div>
<p className="muted">Uso piloto em rede local privada. A comunicação HTTP sem criptografia precisa ser protegida antes do uso comercial. O aviso sonoro por Wi-Fi funciona com o app aberto; push em segundo plano exige internet e credenciais FCM/APNs.</p>
  </div>}
 </div>;
}
