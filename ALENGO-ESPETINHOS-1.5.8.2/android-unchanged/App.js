import React,{useState,useEffect,useRef,useCallback} from 'react';
import {SafeAreaView,StatusBar,ScrollView,View,Text,TextInput,Pressable,Image,Alert,StyleSheet,Platform,AppState,BackHandler} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

const STORE_KEY='alengo-secure-session-v2';
const money=n=>(Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const C={bg:'#121314',panel:'#24211f',accent:'#dda05b',accent2:'#e9c18d',text:'#f0ebe5',muted:'#bcb2a8',border:'#584739',danger:'#ef5d4c'};
const orderKey=()=> 'pedido_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
const deviceKey=()=> 'device_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
const normalizeIp=v=>String(v||'').trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/:[0-9]+$/,'');
const hostFor=ip=>'http://'+normalizeIp(ip)+':8765';

// O canal de notificações reproduz o toque suave; nenhuma instância de áudio é criada no startup.
Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:false,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:false})});

async function requestTo(ip,path,method='GET',body=null,token=''){
 const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),9000);
 try{
  const res=await fetch(hostFor(ip)+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:ctrl.signal});
  const data=await res.json();
  if(!res.ok){const e=new Error(data.error||'Falha na comunicação.');e.status=res.status;throw e}
  return data;
 }catch(e){if(e.name==='AbortError')throw new Error('Conexão expirada. Verifique o IP e a rede Wi-Fi.');throw e}
 finally{clearTimeout(timer)}
}
function Btn({children,onPress,disabled=false,secondary=false}){return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button,secondary&&styles.secondary,disabled&&{opacity:.4}]}><Text style={[styles.buttonText,secondary&&{color:C.text}]}>{children}</Text></Pressable>}
function Field({label,value,onChangeText,secureTextEntry=false,placeholder='',keyboardType='default'}){return <View style={{marginVertical:7}}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChangeText} secureTextEntry={secureTextEntry} placeholder={placeholder} placeholderTextColor="#a19083" keyboardType={keyboardType} autoCapitalize="none"/></View>}

function MainApp(){
 const [ip,setIP]=useState(''),[user,setUser]=useState(''),[password,setPassword]=useState(''),[token,setToken]=useState(''),[operator,setOperator]=useState('');
 const [deviceId,setDeviceId]=useState(''),[booting,setBooting]=useState(true),[busy,setBusy]=useState(false),[connection,setConnection]=useState('');
 const [tables,setTables]=useState([]),[catalog,setCatalog]=useState({products:[],kits:[]});
 const [orderType,setOrderType]=useState(null),[table,setTable]=useState(null),[customer,setCustomer]=useState(''),[cart,setCart]=useState([]),[pendingKey,setPendingKey]=useState(null);
 const [screen,setScreen]=useState('home'),[search,setSearch]=useState(''),[alerts,setAlerts]=useState([]);
 const [myOrders,setMyOrders]=useState([]),[cancelTarget,setCancelTarget]=useState(null),[cancelReason,setCancelReason]=useState('');
 const alertIds=useRef(new Set());const foreground=useRef(true);
 // O som nativo não é instanciado na inicialização do app.
 // A notificação local, com o toque embutido no canal Android, é emitida apenas quando há um pedido.
 const api=useCallback((path,method='GET',body=null,tok=token,addr=ip)=>requestTo(addr,path,method,body,tok),[token,ip]);
 const refresh=useCallback(async(tk=token,addr=ip)=>{
  const [t,c,os]=await Promise.all([requestTo(addr,'/tables','GET',null,tk),requestTo(addr,'/catalog','GET',null,tk),requestTo(addr,'/orders','GET',null,tk)]);
  setTables(t);setCatalog(c);setMyOrders(os);setConnection('');
 },[token,ip]);
 const saveSession=async(v)=>SecureStore.setItemAsync(STORE_KEY,JSON.stringify(v));
 const clearSession=async()=>SecureStore.deleteItemAsync(STORE_KEY);
 const registerNotifications=useCallback(async(tk,addr)=>{
  try{
   if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('pedido-pronto',{name:'Pedidos prontos',importance:Notifications.AndroidImportance.HIGH,sound:'pedido_pronto.wav',vibrationPattern:[0,180,120,180]});
   let permission=await Notifications.getPermissionsAsync();
   if(!permission.granted)permission=await Notifications.requestPermissionsAsync();
   if(!permission.granted)return;
   const projectId=Constants?.expoConfig?.extra?.eas?.projectId||Constants?.easConfig?.projectId;
   if(!projectId)return; // alertas locais continuam funcionando sem EAS configurado
   const push=(await Notifications.getExpoPushTokenAsync({projectId})).data;
   await requestTo(addr,'/devices/push-token','POST',{push_token:push},tk);
  }catch(e){console.warn('Push não configurado neste aparelho:',e.message)}
 },[]);
 const restore=useCallback(async()=>{
  let saved=null;
  try{
   const raw=await SecureStore.getItemAsync(STORE_KEY);
   if(!raw)return;
   saved=JSON.parse(raw);
   setIP(saved.ip||'');setUser(saved.user||'');setDeviceId(saved.deviceId||'');
   if(!saved.token)return;
   const info=await requestTo(saved.ip,'/me','GET',null,saved.token);
   setToken(saved.token);setOperator(info.operator);setScreen('home');
   await refresh(saved.token,saved.ip).catch(e=>setConnection(e.message));
  }catch(e){
   if(e.status===401){await clearSession().catch(()=>{});setConnection('Sessão expirada. Entre novamente.');}
   else{
    if(saved?.token){setToken(saved.token);setOperator(saved.operator||saved.user);setScreen('home')}
    setConnection('Sem conexão com o PDV. Seu acesso continua salvo; confira o Wi-Fi ou atualize o IP.');
   }
  }finally{setBooting(false)}
 },[]);
 useEffect(()=>{restore()},[]);
 const login=async()=>{
  if(!normalizeIp(ip)||!user.trim()||!password){Alert.alert('Atenção','Informe IP, usuário e senha.');return}
  setBusy(true);
  try{
   const did=deviceId||deviceKey();
   const r=await requestTo(ip,'/login','POST',{username:user.trim(),password,device_id:did});
   await saveSession({ip:normalizeIp(ip),user:user.trim(),token:r.token,deviceId:did,operator:r.operator});
   setDeviceId(did);setToken(r.token);setOperator(r.operator);setPassword('');setScreen('home');setConnection('');
   await refresh(r.token,ip).catch(e=>setConnection(e.message));registerNotifications(r.token,ip);
  }catch(e){Alert.alert('Falha no acesso',e.message)}finally{setBusy(false)}
 };
 const logout=()=>Alert.alert('Encerrar acesso','Este aparelho precisará entrar novamente com a senha.',[
  {text:'Cancelar',style:'cancel'},
  {text:'Sair',style:'destructive',onPress:async()=>{
   await api('/logout','POST',{}).catch(()=>{});await clearSession().catch(()=>{});
   setToken('');setOperator('');setCart([]);setTable(null);setScreen('home');setAlerts([]);
  }}]);
 const pollAlerts=useCallback(async()=>{
  if(!token)return;
  try{
   const received=await api('/alerts');
   const fresh=received.filter(x=>!alertIds.current.has(x.id));
   if(fresh.length){
    fresh.forEach(x=>alertIds.current.add(x.id));
    setAlerts(prev=>[...fresh,...prev].slice(0,30));
    await api('/alerts/ack','POST',{ids:fresh.map(x=>x.id)});
    if(foreground.current){
     // A notificação local oferece o som sem iniciar o módulo nativo expo-audio no render.
     // O aviso visual permanece disponível mesmo sem permissão de notificações.
     try {
       await Notifications.scheduleNotificationAsync({
         content:{title:fresh.some(x=>x.type==='ORDER_CANCELLED')?'Pedido cancelado':'Pedido pronto!',body:fresh.map(x=>x.message).join('\n'),sound:'pedido_pronto.wav'},
         trigger:{type:Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,seconds:1,channelId:'pedido-pronto'},
       });
     } catch(soundError) { console.warn('Aviso sonoro indisponível:',soundError?.message||String(soundError)); }
     Alert.alert(fresh.some(x=>x.type==='ORDER_CANCELLED')?'⚠ Pedido cancelado':'🔔 Pedido pronto!',fresh.map(x=>x.message).join('\n'));
    }
   }
  }catch(e){if(e.status===401){setToken('');setConnection('Acesso revogado ou sessão expirada. Entre novamente.');await clearSession().catch(()=>{})}}
 },[token,api]);
 useEffect(()=>{
  if(!token)return;
  const t1=setInterval(()=>refresh().catch(e=>setConnection(e.message)),15000);
  const t2=setInterval(()=>pollAlerts(),4500);
  const appState=AppState.addEventListener('change',x=>{foreground.current=x==='active';if(x==='active'){pollAlerts();refresh().catch(()=>{})}});
  pollAlerts();registerNotifications(token,ip);
  return()=>{clearInterval(t1);clearInterval(t2);appState.remove()};
 },[token,ip,refresh,pollAlerts,registerNotifications]);
 const home=()=>{
  const move=()=>{setScreen('home');setOrderType(null);setTable(null);setCustomer('');setCart([]);setSearch('');setPendingKey(null)};
  if(cart.length&&screen!=='home')Alert.alert('Voltar ao início?','O pedido não enviado será descartado.',[{text:'Continuar pedido',style:'cancel'},{text:'Voltar ao início',style:'destructive',onPress:move}]);
  else move();
 };
 const back=useCallback(()=>{
  if(cancelTarget){setCancelTarget(null);setCancelReason('');return true;}
  if(screen==='home')return false;
  if(screen==='cart'){setScreen('catalog');return true;}
  if(screen==='catalog'){
   if(orderType==='MESA'){setScreen('tables');return true;}
   home();return true;
  }
  if(screen==='tables'||screen==='myorders'){home();return true;}
  home();return true;
 },[screen,orderType,cart,cancelTarget]);
 useEffect(()=>{if(Platform.OS!=='android')return;const listener=BackHandler.addEventListener('hardwareBackPress',back);return()=>listener.remove()},[back]);
 const chooseType=kind=>{
  setOrderType(kind);setCart([]);setCustomer('');setTable(null);setPendingKey(null);setSearch('');
  if(kind==='RETIRADA')setScreen('catalog');else setScreen('tables');
 };
 const chooseTable=t=>{setTable(t);setScreen('catalog')};
 const add=(p,isKit=false)=>{
  const id=(isKit?'kit_':'p_')+p.id;
  setCart(items=>{const old=items.find(x=>x.cartId===id);return old?items.map(x=>x.cartId===id?{...x,quantity:x.quantity+1}:x):[...items,{cartId:id,quantity:1,notes:'',name:p.name,price_cents:p.price_cents,...(isKit?{kit_id:p.id}:{product_id:p.id})}]});setPendingKey(null);
 };
 const change=(id,update)=>{setCart(items=>items.map(x=>x.cartId===id?{...x,...update}:x));setPendingKey(null)};
 const send=async()=>{
  if(orderType==='MESA'&&!table){Alert.alert('Selecione uma mesa');return}
  if(customer.trim().length<2){Alert.alert('Informe o nome do cliente');return}
  if(!cart.length)return;
  const sendKey=pendingKey||orderKey();setPendingKey(sendKey);setBusy(true);
  try{
   const result=await api('/orders','POST',{order_type:orderType,...(orderType==='MESA'?{table_id:table.id}:{}),customer_name:customer.trim(),items:cart.map(({product_id,kit_id,quantity,notes})=>({product_id,kit_id,quantity,notes})),idempotency_key:sendKey});
   setCart([]);setCustomer('');setPendingKey(null);setTable(null);setOrderType(null);setScreen('home');
   refresh().catch(()=>{});
   Alert.alert('Pedido registrado',`Pedido #${result.id} enviado ao PDV (${result.already_received?'envio repetido confirmado':'comanda para impressão'}).`);
  }catch(e){Alert.alert('Envio não confirmado',e.message+'\nO pedido foi mantido para reenvio sem duplicação.')}finally{setBusy(false)}
 };
 const cancelSelected=async()=>{
  if(!cancelTarget||cancelReason.trim().length<5)return;
  setBusy(true);
  try{
    const result=await api('/orders/cancel','POST',{order_id:cancelTarget.id,reason:cancelReason.trim()});
    setCancelTarget(null);setCancelReason('');await refresh();setScreen('home');
    Alert.alert('Pedido cancelado',`Pedido #${result.id} cancelado e comunicado ao caixa. O estoque foi restaurado.`);
  }catch(e){Alert.alert('Cancelamento não confirmado',e.message)}finally{setBusy(false)}
 };
 const updateItemDelivery=async(order,item,delta)=>{
  if(busy)return;
  setBusy(true);
  try{
   const result=await api('/orders/item-delivery','POST',{order_id:order.id,item_id:item.id,delta});
   await refresh();
   if(result.complete)Alert.alert('Pedido concluído','Todos os itens deste pedido foram marcados como entregues.');
  }catch(e){Alert.alert('Entrega não atualizada',e.message)}finally{setBusy(false)}
 };
 const balance=cart.reduce((sum,i)=>sum+i.price_cents*i.quantity,0);
 const kindLabel=orderType==='RETIRADA'?'RETIRADA':`MESA ${table?.label||''}`;
 return <SafeAreaView style={[styles.root,Platform.OS==='android'&&{paddingTop:StatusBar.currentHeight||24}]}><StatusBar barStyle="light-content" backgroundColor={C.bg}/>
  <View style={styles.header}>
   <Image source={require('./assets/icon.png')} style={styles.logo}/>
   <View style={{flex:1}}><Text style={styles.brand}>ALENGO ESPETINHOS</Text><Text style={styles.sub}>{operator||'CONECTAR AO CAIXA'}</Text></View>
   {!!token&&screen!=='home'&&<Pressable accessibilityLabel="Voltar para tela anterior" onPress={()=>back()} style={styles.homeButton}><Text style={styles.homeText}>‹ Voltar</Text></Pressable>}
   {!!token&&screen!=='home'&&<Pressable accessibilityLabel="Voltar à página inicial" onPress={home} style={styles.homeButton}><Text style={styles.homeText}>⌂ Início</Text></Pressable>}
  </View>
  {booting?<View style={styles.container}><Text style={styles.help}>Restaurando acesso seguro...</Text></View>:
  !token?<ScrollView contentContainerStyle={styles.container}><Text style={styles.h}>Acessar o caixa</Text><Text style={styles.help}>Digite os dados somente no primeiro acesso. A sessão será guardada com segurança neste aparelho; não é necessário código de pareamento.</Text>
    <Field label="IP do computador" value={ip} onChangeText={setIP} placeholder="Ex.: 192.168.1.100" keyboardType="numbers-and-punctuation"/>
    <Field label="Usuário do atendente" value={user} onChangeText={setUser}/>
    <Field label="Senha" value={password} onChangeText={setPassword} secureTextEntry/>
    <Btn onPress={login} disabled={busy}>{busy?'Conectando...':'Entrar e salvar acesso'}</Btn>
    {!!connection&&<Text style={styles.warning}>{connection}</Text>}
    <Text style={styles.help}>Teste em rede Wi-Fi privada. A comunicação HTTP sem criptografia ainda não é adequada para produção.</Text>
   </ScrollView>:
   <>
    {!!connection&&<Text style={styles.warning}>{connection}</Text>}
    {screen==='home'&&<ScrollView contentContainerStyle={styles.container}>
      {!!connection&&<View style={styles.connectRepair}><Text style={styles.help}>O computador pode estar desligado ou ter outro IP. A sessão continua salva.</Text><Field label="IP do computador" value={ip} onChangeText={setIP} keyboardType="numbers-and-punctuation"/><Btn secondary onPress={async()=>{try{await saveSession({ip:normalizeIp(ip),user,token,operator,deviceId});await refresh(token,ip);await pollAlerts()}catch(e){setConnection(e.message)}}}>Atualizar conexão sem entrar novamente</Btn></View>}
      <View style={[styles.connectionBadge,connection?styles.connectionOffline:styles.connectionOnline]}><Text style={styles.connectionBadgeTitle}>{connection?'⚠ Sem conexão com o PDV Windows':'✓ Pareado com o PDV Windows'}</Text><Text style={styles.connectionBadgeDetail}>Computador: {normalizeIp(ip)||'não configurado'} · Operador: {operator||user}</Text>{!!connection&&<Text style={styles.connectionBadgeDetail}>Os dados de acesso continuam salvos.</Text>}</View>
      <Text style={styles.h}>Novo pedido</Text><Text style={styles.help}>Selecione como o cliente será atendido:</Text>
      <Pressable style={styles.choice} onPress={()=>chooseType('MESA')}><Text style={styles.choiceTitle}>🍽️  Mesa</Text><Text style={styles.help}>Atendimento no estabelecimento; pedido vinculado a uma mesa.</Text></Pressable>
      <Pressable style={styles.choice} onPress={()=>chooseType('RETIRADA')}><Text style={styles.choiceTitle}>🥡  Retirada</Text><Text style={styles.help}>Cliente vai levar embora; não exige mesa.</Text></Pressable>
      {alerts.length>0&&<View style={styles.alertPanel}><Text style={styles.h}>Pedidos prontos</Text>{alerts.slice(0,8).map(x=><Text key={x.id} style={styles.readyText}>🔔 {x.message}</Text>)}<Btn secondary onPress={()=>setAlerts([])}>Limpar avisos da tela</Btn></View>}
      <Btn secondary onPress={()=>{refresh().then(()=>setScreen('myorders')).catch(e=>Alert.alert('Sem conexão',e.message))}}>Meus pedidos · Entregas e cancelamentos</Btn>
      <Btn secondary onPress={()=>refresh().catch(e=>Alert.alert('Sem conexão',e.message))}>Atualizar produtos e mesas</Btn>
      <Btn secondary onPress={logout}>Sair deste aparelho</Btn>
     </ScrollView>}
    {screen==='myorders'&&<ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h}>Meus pedidos · andamento das entregas</Text><Text style={styles.help}>Marque cada unidade quando estiver pronta e tiver sido levada à mesa ou entregue ao cliente. O andamento também é atualizado no PDV Windows. Pedidos não pagos e sem itens entregues podem ser cancelados.</Text>
      <Btn secondary onPress={()=>refresh().catch(e=>Alert.alert('Sem conexão',e.message))}>Atualizar pedidos</Btn>
      {myOrders.map(o=>{const total=o.items.reduce((sum,i)=>sum+Number(i.quantity||0),0),delivered=o.items.reduce((sum,i)=>sum+Number(i.delivered_quantity||0),0);return <View style={styles.cartItem} key={o.id}>
       <Text style={styles.itemName}>#{o.id} · {o.order_type==='RETIRADA'?'RETIRADA':`MESA ${tables.find(t=>t.id===o.table_id)?.label||o.table_id||'-'}`}</Text><Text style={styles.help}>{o.customer_name} · {money(o.total_cents)} · {o.status==='PAGO'?'Pago':'Aguardando pagamento'} · {delivered}/{total} pronta(s) e entregue(s)</Text>
       {o.items.map(item=>{const done=Number(item.delivered_quantity||0),qty=Number(item.quantity||0);return <View style={styles.deliveryItem} key={item.id}>
        <View style={{flex:1}}><Text style={styles.itemName}>{item.name}</Text><Text style={styles.help}>{done}/{qty} pronta(s) e entregue(s){item.notes?` · ${item.notes}`:''}</Text></View>
        <Btn secondary disabled={busy||done<=0} onPress={()=>updateItemDelivery(o,item,-1)}>−</Btn><Btn disabled={busy||done>=qty} onPress={()=>updateItemDelivery(o,item,1)}>Pronto + entregue (+1)</Btn>
       </View>})}
       {o.status==='ABERTO'&&delivered===0&&<Btn secondary onPress={()=>{setCancelTarget(o);setCancelReason('')}}>Cancelar este pedido</Btn>}
      </View>})}
      {!myOrders.length&&<Text style={styles.help}>Não há pedidos ativos neste aparelho.</Text>}
      {cancelTarget&&<View style={styles.cancelPanel}><Text style={styles.h}>Cancelar pedido #{cancelTarget.id}?</Text><Field label="Motivo obrigatório (mínimo 5 caracteres)" value={cancelReason} onChangeText={setCancelReason} placeholder="Ex.: cliente desistiu"/><Btn disabled={busy||cancelReason.trim().length<5} onPress={cancelSelected}>{busy?'Cancelando...':'Confirmar cancelamento'}</Btn><Btn secondary onPress={()=>{setCancelTarget(null);setCancelReason('')}}>Voltar sem cancelar</Btn></View>}
     </ScrollView>}
    {screen==='tables'&&<ScrollView contentContainerStyle={styles.container}><Text style={styles.h}>Selecione a mesa</Text><View style={styles.grid}>{tables.map(t=><Pressable key={t.id} style={styles.table} onPress={()=>chooseTable(t)}><Text style={styles.tableTitle}>MESA {t.label}</Text><Text style={styles.help}>{t.open_orders?`${t.open_orders} pedidos · ${money(t.pending_cents)}`:'Livre'}</Text></Pressable>)}</View>{!tables.length&&<Text style={styles.help}>Não há mesas cadastradas. Cadastre no PDV Windows.</Text>}</ScrollView>}
    {screen==='catalog'&&<ScrollView contentContainerStyle={styles.container}><Text style={styles.h}>{kindLabel} · Cardápio</Text><Field label="Nome do cliente (obrigatório)" value={customer} onChangeText={setCustomer} placeholder="Ex.: Carlos"/><Field label="Pesquisar produto" value={search} onChangeText={setSearch} placeholder="Espeto, bebida, chopp..."/>
      {[...catalog.products.map(p=>({...p,isKit:false})),...catalog.kits.map(p=>({...p,isKit:true}))].filter(x=>x.name.toLowerCase().includes(search.toLowerCase())).map(p=><View style={styles.product} key={(p.isKit?'k':'p')+p.id}><View style={{flex:1}}><Text style={styles.itemName}>{p.isKit?'Combo · ':''}{p.name}</Text><Text style={styles.help}>{money(p.price_cents)}{!p.isKit?` · Estoque: ${p.stock}`:''}</Text></View><Btn onPress={()=>add(p,p.isKit)} disabled={!p.isKit&&p.stock<1}>+ Adicionar</Btn></View>)}
      <Btn disabled={!cart.length} onPress={()=>setScreen('cart')}>Ver carrinho ({cart.length})</Btn>
     </ScrollView>}
    {screen==='cart'&&<ScrollView contentContainerStyle={styles.container}><Text style={styles.h}>{kindLabel} · Comanda</Text><Text style={styles.help}>Cliente: {customer||'não informado'}</Text>
      {cart.map(i=><View style={styles.cartItem} key={i.cartId}><Text style={styles.itemName}>{i.name} · {money(i.price_cents*i.quantity)}</Text><View style={{flexDirection:'row',alignItems:'center',gap:15}}><Btn secondary onPress={()=>i.quantity>1?change(i.cartId,{quantity:i.quantity-1}):setCart(v=>v.filter(x=>x.cartId!==i.cartId))}>−</Btn><Text style={styles.itemName}>{i.quantity}</Text><Btn secondary onPress={()=>change(i.cartId,{quantity:i.quantity+1})}>+</Btn></View><Field label="Observação para preparo" value={i.notes} onChangeText={v=>change(i.cartId,{notes:v})} placeholder="Ex.: bem passado, sem molho"/></View>)}
      <Text style={styles.total}>Total do pedido: {money(balance)}</Text><Btn disabled={busy||customer.trim().length<2||!cart.length} onPress={send}>{busy?'Enviando...':'Enviar comanda para cozinha'}</Btn>
      <Btn secondary onPress={()=>setScreen('catalog')}>Adicionar mais itens</Btn>
      <Text style={styles.help}>Após o envio confirmado, o aplicativo voltará automaticamente para a página inicial.</Text>
     </ScrollView>}
   </>}
 </SafeAreaView>;
}
// Captura erros de renderização JS e mostra uma tela legível em vez de uma tela vazia.
// Falhas nativas exigem adb logcat e não podem ser capturadas por um ErrorBoundary.
class StartupErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={error:null}}
  static getDerivedStateFromError(error){return {error}}
  componentDidCatch(error,info){console.error('ALENGO_MOBILE_RENDER_ERROR',error,info?.componentStack)}
  render(){
    if(this.state.error) return <SafeAreaView style={{flex:1,backgroundColor:'#121314',padding:24,justifyContent:'center'}}>
      <Text style={{fontSize:23,color:'#e9c18d',fontWeight:'bold',marginBottom:12}}>Não foi possível abrir esta tela</Text>
      <Text selectable style={{color:'#f0ebe5',marginBottom:15}}>{String(this.state.error.message||this.state.error)}</Text>
      <Pressable onPress={()=>this.setState({error:null})} style={{padding:16,backgroundColor:'#dda05b',borderRadius:10}}><Text style={{color:'#121314',textAlign:'center',fontWeight:'bold'}}>Tentar novamente</Text></Pressable>
    </SafeAreaView>;
    return this.props.children;
  }
}
export default function App(){return <StartupErrorBoundary><MainApp/></StartupErrorBoundary>}

const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},header:{paddingHorizontal:12,paddingVertical:11,minHeight:70,backgroundColor:'#221d19',borderBottomWidth:1,borderColor:C.border,flexDirection:'row',alignItems:'center',gap:10},
 logo:{width:45,height:45,borderRadius:23},brand:{fontSize:18,fontWeight:'900',color:C.accent2,letterSpacing:.7},sub:{fontSize:11,letterSpacing:.6,color:C.muted,marginTop:3},
 homeButton:{backgroundColor:'#35291f',borderWidth:1,borderColor:C.border,borderRadius:9,paddingVertical:11,paddingHorizontal:10,minHeight:44,justifyContent:'center'},homeText:{fontSize:13,fontWeight:'700',color:C.text},
 connectionBadge:{padding:13,borderWidth:1,borderRadius:12,marginBottom:19},connectionOnline:{backgroundColor:'#132d28',borderColor:'#398b6e'},connectionOffline:{backgroundColor:'#422c21',borderColor:'#a8643d'},connectionBadgeTitle:{fontSize:14,fontWeight:'800',color:'#fff3e2'},connectionBadgeDetail:{fontSize:12,color:'#ddcfc0',marginTop:5},container:{padding:17,paddingBottom:65},h:{fontSize:22,fontWeight:'800',color:C.text,marginBottom:12},label:{color:C.accent2,fontSize:13,fontWeight:'600',marginBottom:6},
 input:{borderWidth:1,borderColor:C.border,borderRadius:10,backgroundColor:C.panel,color:C.text,fontSize:16,padding:12},
 button:{backgroundColor:C.accent,borderRadius:10,paddingHorizontal:14,paddingVertical:13,marginVertical:5,alignItems:'center',justifyContent:'center'},secondary:{backgroundColor:'#35291f',borderWidth:1,borderColor:C.border},
 buttonText:{color:'#1c0f09',fontWeight:'800',fontSize:13},help:{color:C.muted,fontSize:13,lineHeight:21},warning:{backgroundColor:'#422c21',color:'#ffddbd',padding:12},
 choice:{marginTop:16,minHeight:117,backgroundColor:C.panel,borderWidth:1,borderColor:C.border,borderRadius:16,padding:20,justifyContent:'center'},choiceTitle:{fontSize:23,color:C.accent2,fontWeight:'900',marginBottom:8},
 cancelPanel:{marginVertical:20,padding:16,borderWidth:1,borderColor:C.danger,borderRadius:14,backgroundColor:'#362422'},
 connectRepair:{marginBottom:14,padding:12,borderWidth:1,borderColor:C.border,borderRadius:12,backgroundColor:C.panel},
 alertPanel:{marginTop:20,padding:13,borderRadius:12,borderWidth:1,borderColor:C.accent,backgroundColor:'#34291e'},readyText:{color:C.text,fontSize:14,paddingVertical:6},
 grid:{flexDirection:'row',flexWrap:'wrap',gap:10,marginVertical:12},table:{width:'47%',minHeight:110,backgroundColor:C.panel,borderWidth:1,borderColor:C.accent,borderRadius:13,padding:15,justifyContent:'center'},
 tableTitle:{fontSize:17,color:C.accent2,fontWeight:'800'},product:{flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderColor:C.border,paddingVertical:10,gap:8},deliveryItem:{flexDirection:'row',alignItems:'center',gap:7,paddingVertical:9,borderTopWidth:1,borderColor:C.border},
 itemName:{fontSize:16,color:C.text,fontWeight:'700'},cartItem:{backgroundColor:C.panel,padding:15,borderRadius:12,marginBottom:13,borderWidth:1,borderColor:C.border},total:{fontSize:20,color:C.accent2,fontWeight:'900',marginVertical:18}
});
