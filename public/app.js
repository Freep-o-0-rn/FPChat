const STORAGE={roomState:(id)=>`fpchat:room:${id}`,activeChatsKey:'fpchat:active-chats',lastSelectedRoomId:'lastSelectedRoomId',nick:'fpchat:nick',theme:'fpchat:theme',roomNames:'fpchat:room-names',notif:'fpchat:notif',roomMute:'fpchat:room-mute',set:(k,v)=>localStorage.setItem(k,JSON.stringify(v)),get:(k)=>{const v=localStorage.getItem(k);return v?JSON.parse(v):null;}};
const state={view:'chats',roomId:null,secret:null,key:null,ws:null,me:null,chats:STORAGE.get(STORAGE.activeChatsKey)||[],roomNames:STORAGE.get(STORAGE.roomNames)||{},nick:localStorage.getItem(STORAGE.nick)||`Гость-${String(Math.floor(Math.random()*100000)).padStart(5,'0')}`,notif:STORAGE.get(STORAGE.notif)||{enabled:false,showText:true,hideSender:false,sound:true},roomMute:STORAGE.get(STORAGE.roomMute)||{},presence:{},localConnectionState:'disconnected'};localStorage.setItem(STORAGE.nick,state.nick);
const els={content:document.getElementById('contentPane'),rows:document.getElementById('chatRows'),search:document.getElementById('chatSearch'),empty:document.getElementById('emptyChats'),sidebar:document.getElementById('sidebar'),sidebarOverlay:document.getElementById('sidebarOverlay'),context:document.getElementById('contextMenu'),appRoot:document.getElementById('appRoot')};
const b64={encode:(buf)=>btoa(String.fromCharCode(...new Uint8Array(buf))),decode:(str)=>Uint8Array.from(atob(str),c=>c.charCodeAt(0))};
const shortId=(id)=>`${id.slice(0,4)}...${id.slice(-3)}`;
function parseServerTime(value){if(!value)return null;if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))return new Date(value.replace(' ','T')+'Z');const date=new Date(value);return Number.isNaN(date.getTime())?null:date;}
function formatMessageTime(iso){const date=parseServerTime(iso);return date?date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'';}
function formatChatListTime(iso){const date=parseServerTime(iso);if(!date)return'';const now=new Date();const startToday=new Date(now.getFullYear(),now.getMonth(),now.getDate());const startTarget=new Date(date.getFullYear(),date.getMonth(),date.getDate());const oneDay=24*60*60*1000;const diff=Math.round((startToday-startTarget)/oneDay);if(diff===0)return formatMessageTime(iso);if(diff===1)return'Вчера';if(diff>1&&diff<7)return ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][date.getDay()];return `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}.${String(date.getFullYear()).slice(-2)}`;}
function formatDateSeparator(iso){const date=parseServerTime(iso);if(!date)return'';const now=new Date();const startToday=new Date(now.getFullYear(),now.getMonth(),now.getDate());const startTarget=new Date(date.getFullYear(),date.getMonth(),date.getDate());const oneDay=24*60*60*1000;const diff=Math.round((startToday-startTarget)/oneDay);if(diff===0)return'Сегодня';if(diff===1)return'Вчера';return date.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});}
const APP_BUILD_KEY='fpchat:app-build';
const APP_UPDATE_RELOADING_KEY='fpchat:update-reloading';
let activeChatDeviceId=null;let pendingIncomingReadIds=[];let unreadVisibleObserver=null;
let appVersionCheckInFlight=false;
function setBootSplashText(title, text) {
  const titleEl = document.getElementById('bootTitle');
  const textEl = document.getElementById('bootText');
  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = text;
}
function hideBootSplash() {
  document.getElementById('bootSplash')?.remove();
  els.appRoot?.classList.remove('hidden-boot');}
let settingsVersionInfo='Версия: —';
function setLocalConnectionState(value){state.localConnectionState=value;renderPresenceStatus();}
function formatLastSeen(lastSeenAt){const d=parseServerTime(lastSeenAt);if(!d)return '';const now=new Date();const startToday=new Date(now.getFullYear(),now.getMonth(),now.getDate());const startTarget=new Date(d.getFullYear(),d.getMonth(),d.getDate());const oneDay=24*60*60*1000;const diff=Math.round((startToday-startTarget)/oneDay);const hhmm=d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});if(diff===0)return `был в ${hhmm}`;if(diff===1)return `был вчера в ${hhmm}`;const dd=String(d.getDate()).padStart(2,'0');const mm=String(d.getMonth()+1).padStart(2,'0');const yy=String(d.getFullYear()).slice(-2);return `был ${dd}.${mm}.${yy} в ${hhmm}`;}
function renderPresenceStatus(){const line=document.getElementById('presenceLine');const warning=document.getElementById('connectionWarning');if(!line)return;const me=state.me?.deviceId;const peer=Object.values(state.presence).find((p)=>p?.deviceId&&p.deviceId!==me);if(peer){const dotClass=peer.online?'online':'offline';const label=peer.online?'Онлайн':`Оффлайн${peer.lastSeenAt?` · ${formatLastSeen(peer.lastSeenAt)}`:''}`;line.innerHTML=`<span class='presence-dot ${dotClass}'></span><span>${label}</span>`;}else{line.innerHTML="<span class='presence-dot offline'></span><span>Ожидание собеседника</span>";}
if(warning){if(state.localConnectionState==='connected'){warning.classList.add('hidden');warning.textContent='';}else if(state.localConnectionState==='connecting'){warning.classList.remove('hidden');warning.textContent='⟳ Подключение...';}else{warning.classList.remove('hidden');warning.textContent='🌐! Нет соединения';}}}
function saveChats(){STORAGE.set(STORAGE.activeChatsKey,state.chats);} function saveRoomNames(){STORAGE.set(STORAGE.roomNames,state.roomNames);} function saveRoomMute(){STORAGE.set(STORAGE.roomMute,state.roomMute);}
async function deriveKey(secret){const m=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),'PBKDF2',false,['deriveKey']); return crypto.subtle.deriveKey({name:'PBKDF2',salt:new TextEncoder().encode('fpchat-room-salt-v1'),iterations:150000,hash:'SHA-256'},m,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function encryptText(t){const iv=crypto.getRandomValues(new Uint8Array(12)); const c=await crypto.subtle.encrypt({name:'AES-GCM',iv},state.key,new TextEncoder().encode(t)); return {iv:b64.encode(iv),ciphertext:b64.encode(c)};}
async function decryptText(iv,c){const p=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64.decode(iv)},state.key,b64.decode(c)); return new TextDecoder().decode(p)}
function upsertChat(roomId,patch={}){const i=state.chats.findIndex(x=>x.roomId===roomId);const base=i>=0?state.chats[i]:{roomId,unread:0};const next={...base,...patch,roomId,lastActivity:patch.lastActivity||new Date().toISOString()};if(i>=0)state.chats[i]=next; else state.chats.push(next); state.chats.sort((a,b)=>new Date(b.lastActivity)-new Date(a.lastActivity)); saveChats(); renderChats();}
function setActiveNav(v){document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===v));}
function showListPane(){els.appRoot?.setAttribute('data-pane','list'); els.appRoot?.classList.remove('mobile-chat');}
function showContentPane(){els.appRoot?.setAttribute('data-pane','content');}
function setView(v){state.view=v; setActiveNav(v); closeMobileMenu(); if(v==='chats'){showListPane(); renderMainChatsPlaceholder(); return;} if(v==='create'){renderCreate(); showContentPane(); return;} if(v==='restore'){renderRestore(); showContentPane(); return;} if(v==='join'){renderJoin(); showContentPane(); return;} if(v==='settings'){renderSettings(); showContentPane();}}
function isMobileViewport(){return window.matchMedia('(max-width: 900px)').matches;}
function showChatsList(){state.roomId=null; closeMobileMenu(); els.appRoot?.classList.remove('mobile-chat'); renderChats(); setView('chats');}
function removeBrokenChat(roomId){
  state.chats=state.chats.filter(c=>c.roomId!==roomId);
  if(state.roomId===roomId){
    state.roomId=null;
  }
  try{
    localStorage.removeItem(STORAGE.roomState(roomId));
  }catch{}
  saveChats();
  renderChats();
  setView('chats');
  if(typeof updatePushBadge==='function'){
    updatePushBadge();
  }
}
function openMobileMenu(){if(!isMobileViewport())return; els.sidebar?.classList.add('open'); els.sidebarOverlay?.classList.add('open','active'); els.appRoot?.classList.add('menu-open'); document.body.classList.add('menu-open');}
function closeMobileMenu(){els.sidebar?.classList.remove('open'); els.sidebarOverlay?.classList.remove('open','active'); els.appRoot?.classList.remove('menu-open'); document.body.classList.remove('menu-open');}
function toggleMobileMenu(){if(els.sidebar?.classList.contains('open')) closeMobileMenu(); else openMobileMenu();}
let edgeSwipe={active:false,startX:0,startY:0,tracking:false};
function renderChats(){const q=els.search.value?.toLowerCase()||''; let chats=state.chats.filter(c=>{const n=(state.roomNames[c.roomId]||'').toLowerCase(); return [n,c.roomId,(c.lastMessage||'').toLowerCase()].some(s=>s.includes(q));}); els.rows.innerHTML=''; if(els.empty){ els.empty.classList.toggle('hidden', chats.length>0); } chats.forEach(c=>{const minePrefix=c.lastSender===state.nick?'Вы: ':c.lastSender?`${c.lastSender}: `:'';const row=document.createElement('div'); row.className='chat-row'+(c.roomId===state.roomId?' active':'')+(c.unread?' unread':''); row.innerHTML=`<div class='row-top'><div><div><strong>${state.roomNames[c.roomId]||`Комната ${shortId(c.roomId)}`}</strong></div>${state.roomNames[c.roomId]?`<div class='sys'>Комната ${shortId(c.roomId)}</div>`:''}</div><div class="chat-row-meta">${c.unread>0?`<span class="chat-unread-badge">${c.unread>99?'99+':c.unread}</span>`:''}<span class="chat-time">${formatChatListTime(c.lastActivity)}</span></div></div><div class='row-top'><div class='last'>${state.roomMute[c.roomId]?'🔕 ':''}${minePrefix}${c.lastMessage||''}</div></div>`; let longPressTimer=null; let longPressTriggered=false; let suppressNextClickUntil=0; let startX=0; let startY=0; row.addEventListener('touchstart',(e)=>{const touch=e.touches?.[0]; if(!touch)return; startX=touch.clientX; startY=touch.clientY; longPressTriggered=false; if(longPressTimer){clearTimeout(longPressTimer);} longPressTimer=setTimeout(()=>{longPressTriggered=true; suppressNextClickUntil=Date.now()+500; showRoomMenu(c.roomId,startX,startY);navigator.vibrate?.(10);},600);},{passive:true}); row.addEventListener('touchmove',(e)=>{const touch=e.touches?.[0]; if(!touch||!longPressTimer)return; if(Math.abs(touch.clientX-startX)>10||Math.abs(touch.clientY-startY)>10){clearTimeout(longPressTimer);longPressTimer=null;}},{passive:true}); row.addEventListener('touchend',(e)=>{if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;} if(longPressTriggered===true){e.preventDefault();e.stopPropagation();longPressTriggered=false;}}, {passive:false}); row.addEventListener('touchcancel',()=>{if(longPressTimer){clearTimeout(longPressTimer);} longPressTimer=null; longPressTriggered=false;}); row.onclick=(e)=>{if(longPressTriggered===true||Date.now()<suppressNextClickUntil){e.preventDefault();e.stopPropagation();return;}openChat(c.roomId);}; row.oncontextmenu=(e)=>{e.preventDefault();e.stopPropagation();showRoomMenu(c.roomId,e.clientX,e.clientY)}; els.rows.appendChild(row);});}
function renderMainChatsPlaceholder(){els.content.innerHTML='';}
function parseInvite(){const m=location.pathname.match(/^\/i\/([A-Z0-9]{16})$/);if(!m)return null;const roomId=m[1], secret=location.hash?location.hash.slice(1):null; if(secret)history.replaceState({},'',`/i/${roomId}`); return {roomId,secret};}
function parseChat(){const m=location.pathname.match(/^\/chat\/([A-Z0-9]{16})$/); return m?m[1]:null;}
function openChatWithJoinData(roomId,secret,deviceId,data,key=null){
  state.roomId=roomId;
  state.secret=secret;
  if(key)state.key=key;
  state.me=data.participant;
  state.presence={};
  (data.participants||[]).forEach((item)=>{if(!item?.deviceId)return;state.presence[item.deviceId]={deviceId:item.deviceId,displayName:item.displayName,online:Boolean(item.online),lastSeenAt:item.lastSeenAt||null};});
  localStorage.setItem(STORAGE.lastSelectedRoomId,roomId);
  upsertChat(roomId,{lastActivity:new Date().toISOString(),unread:0});
  syncRoomPushSubscription(roomId).catch(()=>{});
  showContentPane();
  els.appRoot?.classList.add('mobile-chat');
  renderChatView(data.messages,deviceId);
  connectWs(roomId,deviceId);
  setActiveNav('chats');
  renderChats();
}

async function joinByInviteText(text){
  const parsed=parseInviteInput(text);
  if(parsed?.error==='empty'){alert('Вставьте invite-ссылку');return false;}
  if(parsed?.error==='missing_secret'){alert('В invite-ссылке нет ключа доступа');return false;}
  if(!parsed||parsed?.error){alert('Некорректная invite-ссылка');return false;}
  state.nick=localStorage.getItem(STORAGE.nick)||state.nick;
  const {roomId,secret}=parsed;
  const stored=STORAGE.get(STORAGE.roomState(roomId));
  const deviceId=stored?.deviceId||crypto.randomUUID();
  let key;
  try{
    key=await deriveKey(secret);
  }catch{
    alert('Некорректная invite-ссылка');
    return false;
  }
  let res;
  try{
    res=await fetch(`/api/rooms/${roomId}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId})});
  }catch{
    alert('Не удалось подключиться. Проверьте соединение.');
    return false;
  }
  if([500,502,503].includes(res.status)){
    alert('Не удалось подключиться. Проверьте соединение.');
    return false;
  }
  if(res.status===404){
    alert('Комната не найдена или invite-ссылка недействительна.');
    return false;
  }
  if(res.status===403){
    alert('Нет доступа к комнате. Проверьте invite-ссылку.');
    return false;
  }
  if(!res.ok){
    alert('Не удалось подключиться. Проверьте соединение.');
    return false;
  }
  const data=await res.json().catch(()=>null);
  if(!data||!Array.isArray(data.messages)){
    alert('Не удалось подключиться. Проверьте соединение.');
    return false;
  }
  if(data.messages.length>0){
    let decryptedAny=false;
    for(const msg of data.messages){
      try{await crypto.subtle.decrypt({name:'AES-GCM',iv:b64.decode(msg.iv)},key,b64.decode(msg.ciphertext));decryptedAny=true;break;}catch{}
    }
    if(!decryptedAny){
      alert('Ключ доступа неверный. Проверьте invite-ссылку.');
      return false;
    }
  }
  STORAGE.set(STORAGE.roomState(roomId),{...stored,secret,deviceId});
  state.key=key;
  upsertChat(roomId,{});
  openChatWithJoinData(roomId,secret,deviceId,data,key);
  return true;
}
async function openChat(roomId){
  closeMobileMenu();
  const persisted=STORAGE.get(STORAGE.roomState(roomId));
  if(!persisted?.secret||!persisted?.deviceId){
    alert('Нет доступа к этому чату. Восстановите доступ по recovery-коду или invite-ссылке.');
    removeBrokenChat(roomId);
    return;
  }
  const deviceId=persisted.deviceId;
  let res;
  try{
    state.secret=persisted.secret;
    state.key=await deriveKey(state.secret);
    res=await fetch(`/api/rooms/${roomId}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId})});
  }catch{
    alert('Не удалось подключиться к чату. Проверьте соединение.');
    setView('chats');
    return;
  }
  if([500,502,503].includes(res.status)){
    alert('Не удалось подключиться к чату. Проверьте соединение.');
    setView('chats');
    return;
  }
  if(res.status===404){
    removeBrokenChat(roomId);
    return;
  }
  if(res.status===403){
    alert('Нет доступа к этому чату. Восстановите доступ по recovery-коду или invite-ссылке.');
    removeBrokenChat(roomId);
    return;
  }
  if(!res.ok){
    setView('chats');
    return;
  }
  const data=await res.json().catch(()=>null);
  if(!data||!Array.isArray(data.messages)){
    alert('Не удалось загрузить чат.');
    setView('chats');
    return;
  }
  openChatWithJoinData(roomId,persisted.secret,deviceId,data);
}
function deliveryIcon(s){if(s==='read')return "<span style='color:#3390ec'>✓✓</span>"; if(s==='delivered')return "<span style='color:#9aa0a6'>✓✓</span>"; if(s==='sent')return '✓'; return '⏳';}
function isMessagesAtBottom(){const box=document.getElementById('messages');if(!box)return true;return box.scrollTop+box.clientHeight>=box.scrollHeight-40;}
function markIncomingMessagesRead(roomId,deviceId,messageIds){if(!state.ws||state.ws.readyState!==1||state.roomId!==roomId||!Array.isArray(messageIds)||!messageIds.length)return;state.ws.send(JSON.stringify({type:'message:read:bulk',messageIds:[...new Set(messageIds.map(Number).filter(Boolean))]}));}

function formatUnreadLabel(count){if(count===1)return '1 новое сообщение ↓';if(count>=2&&count<=4)return `${count} новых сообщения ↓`;return `${count} новых сообщений ↓`;}
function renderNewMessagesPill(count){const pill=document.getElementById('newMessagesPill');if(!pill)return;if(!count||count<=0){pill.classList.add('hidden');pill.textContent='';return;}pill.textContent=formatUnreadLabel(count);pill.classList.remove('hidden');}
function recomputePendingUnread(){const unreadEls=[...document.querySelectorAll('.bubble-wrap[data-incoming="1"][data-read="0"]')];pendingIncomingReadIds=unreadEls.map(el=>Number(el.dataset.messageId||el.dataset.id)).filter(id=>Number.isInteger(id)&&id>0);pendingIncomingReadIds=[...new Set(pendingIncomingReadIds)];return pendingIncomingReadIds.length;}
function updateUnreadIndicators(){const box=document.getElementById('messages');if(!box||!state.roomId)return;const count=recomputePendingUnread();const atBottom=isMessagesAtBottom();renderNewMessagesPill(atBottom?0:count);upsertChat(state.roomId,{unread:atBottom?0:count});renderChats();updatePushBadge();}
function observeUnreadMessage(el){if(!el||!unreadVisibleObserver)return;if(el.dataset.incoming!=='1'||el.dataset.read!=='0')return;unreadVisibleObserver.observe(el);}
function markMessageRead(messageId){const id=Number(messageId);if(!id)return;const box=document.getElementById('messages');const msgEl=box?.querySelector(`.msg[data-message-id="${id}"], .msg[data-id="${id}"]`);if(!msgEl||msgEl.dataset.read!=='0')return;msgEl.dataset.read='1';unreadVisibleObserver?.unobserve(msgEl);markIncomingMessagesRead(state.roomId,activeChatDeviceId,[id]);recomputePendingUnread();updateUnreadIndicators();}
let wsConnectStartedAt=0;let wsConnectInFlight=null;
function ensureWsConnected(roomId,deviceId,timeoutMs=1800){if(!roomId||!deviceId)return Promise.resolve(false);if(state.ws&&state.ws.readyState===WebSocket.OPEN){setLocalConnectionState('connected');return Promise.resolve(true);}const isStaleConnecting=state.ws&&state.ws.readyState===WebSocket.CONNECTING&&Date.now()-wsConnectStartedAt>timeoutMs;if(!state.ws||state.ws.readyState===WebSocket.CLOSING||state.ws.readyState===WebSocket.CLOSED||isStaleConnecting){setLocalConnectionState('connecting');if(state.ws){try{state.ws.close();}catch{}}connectWs(roomId,deviceId);} if(wsConnectInFlight)return wsConnectInFlight;wsConnectInFlight=new Promise((resolve)=>{const ws=state.ws;if(!ws){wsConnectInFlight=null;resolve(false);return;}if(ws.readyState===WebSocket.OPEN){wsConnectInFlight=null;resolve(true);return;}const done=(ok)=>{clearTimeout(timer);ws.removeEventListener('open',onOpen);ws.removeEventListener('error',onFail);ws.removeEventListener('close',onFail);if(wsConnectInFlight===promiseRef)wsConnectInFlight=null;resolve(ok&&state.ws===ws&&ws.readyState===WebSocket.OPEN);};const onOpen=()=>done(true);const onFail=()=>done(false);const timer=setTimeout(()=>done(false),timeoutMs);const promiseRef=wsConnectInFlight;ws.addEventListener('open',onOpen,{once:true});ws.addEventListener('error',onFail,{once:true});ws.addEventListener('close',onFail,{once:true});});return wsConnectInFlight;}
function renderChatView(messages,deviceId){messages=Array.isArray(messages)?messages:[];activeChatDeviceId=deviceId;pendingIncomingReadIds=[];if(unreadVisibleObserver){unreadVisibleObserver.disconnect();unreadVisibleObserver=null;}els.content.innerHTML=`<div class='chat-header'><div><strong>${state.roomNames[state.roomId]||`Комната ${shortId(state.roomId)}`}</strong><div id='presenceLine' class='presence-line'></div><div id='connectionWarning' class='connection-warning hidden'></div></div><div class='chat-header-actions'><button id='backMob' class='mobile-only btn btn-icon' aria-label='Назад'>←</button><button id='reloadBtn' class='btn btn-icon' aria-label='Обновить'>↻</button><button id='menuBtn' class='btn btn-icon' aria-label='Меню чата'>⋮</button></div></div><div class='messages' id='messages'></div><button id='newMessagesPill' class='new-messages-pill hidden' type='button'></button><form class='send' id='sendForm'><textarea id='msgInput' placeholder='Сообщение'></textarea><button id='sendBtn' class='btn-send' type='submit' disabled>➤</button></form>`; document.getElementById('backMob')?.addEventListener('click',()=>setView('chats')); document.getElementById('reloadBtn').onclick=()=>window.location.reload(); document.getElementById('menuBtn').onclick=(e)=>{e.preventDefault();e.stopPropagation();const rect=e.currentTarget.getBoundingClientRect();showRoomMenu(state.roomId,rect.right,rect.bottom+6)};
const box=document.getElementById('messages'); unreadVisibleObserver=new IntersectionObserver((entries)=>{entries.forEach((entry)=>{if(!entry.isIntersecting)return;const el=entry.target;markMessageRead(el.dataset.messageId);unreadVisibleObserver?.unobserve(el);});},{root:box,threshold:0.01}); let prev=''; messages.forEach(async m=>{const d=formatDateSeparator(m.created_at); if(d!==prev){prev=d; const sep=document.createElement('div');sep.className='date-sep';sep.textContent=d;box.appendChild(sep);} const mine=m.sender_device_id===deviceId; const txt=await decryptText(m.iv,m.ciphertext).catch(()=>"[cannot decrypt]"); appendMessage(box,m,txt,mine,false);}); box.scrollTop=box.scrollHeight;recomputePendingUnread();updateUnreadIndicators();
box.addEventListener('scroll',()=>{if(isMessagesAtBottom()){const unreadEls=[...box.querySelectorAll('.msg[data-incoming="1"][data-read="0"]')];if(unreadEls.length){unreadEls.forEach((el)=>{el.dataset.read='1';unreadVisibleObserver?.unobserve(el);});markIncomingMessagesRead(state.roomId,activeChatDeviceId,unreadEls.map(el=>Number(el.dataset.messageId||el.dataset.id)));}}recomputePendingUnread();updateUnreadIndicators();});
document.getElementById('newMessagesPill').onclick=()=>{const firstUnread=document.querySelector('.msg[data-read="0"][data-incoming="1"]');if(firstUnread){firstUnread.scrollIntoView({behavior:'smooth',block:'center'});}};
renderPresenceStatus();
const form=document.getElementById('sendForm'),input=document.getElementById('msgInput'),sendBtn=document.getElementById('sendBtn'); if(form&&input&&sendBtn){const syncSendBtn=()=>{sendBtn.disabled=!input.value.trim();}; input.addEventListener('input',syncSendBtn); input.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}}); form.onsubmit=async(e)=>{e.preventDefault();const t=input.value.trim();if(!t)return;const ok=await ensureWsConnected(state.roomId,activeChatDeviceId);if(!ok||!state.ws||state.ws.readyState!==WebSocket.OPEN){alert('Нет соединения. Попробуйте обновить чат.');return;}const enc=await encryptText(t); state.ws.send(JSON.stringify({type:'message:new',...enc})); input.value=''; syncSendBtn();}; syncSendBtn();}}
function appendMessage(box,m,txt,mine,autoScroll=true){const w=document.createElement('div');w.className=`bubble-wrap msg ${mine?'mine':''}`;const isIncoming=!mine;const isRead=mine?1:(m.status==='read'?1:0);w.innerHTML=`<div class='bubble'><div><b>${m.sender_name}</b></div><div>${txt}</div><div class='meta'>${formatMessageTime(m.created_at)} ${mine?deliveryIcon(m.status):''}</div></div>`;w.dataset.id=m.id;w.dataset.createdAt=m.created_at;w.dataset.messageId=String(m.id);w.dataset.incoming=isIncoming?'1':'0';w.dataset.read=String(isRead);box.appendChild(w);if(isIncoming&&!isRead){if(!autoScroll){pendingIncomingReadIds.push(Number(m.id));}observeUnreadMessage(w);}if(autoScroll)box.scrollTop=box.scrollHeight;}
function connectWs(roomId,deviceId){setLocalConnectionState('connecting');if(state.ws)state.ws.close();const p=location.protocol==='https:'?'wss':'ws';state.ws=new WebSocket(`${p}://${location.host}?room=${roomId}&device=${encodeURIComponent(deviceId)}`);wsConnectStartedAt=Date.now();state.ws.onopen=()=>setLocalConnectionState('connected');state.ws.onerror=()=>setLocalConnectionState('disconnected');state.ws.onclose=()=>setLocalConnectionState('disconnected');state.ws.onmessage=async(ev)=>{const payload=JSON.parse(ev.data);if(payload.type==='message:new'){const chat=state.chats.find(c=>c.roomId===roomId)||{};const txt=await decryptText(payload.message.iv,payload.message.ciphertext).catch(()=>"[cannot decrypt]");const mine=payload.message.sender_device_id===deviceId;const messagesEl=document.getElementById('messages');const inActiveChat=state.roomId===roomId&&messagesEl;const nearBottom=inActiveChat?isMessagesAtBottom():false;const normalizedLast={lastMessage:txt,lastSender:payload.message.sender_name,lastActivity:new Date().toISOString()};if(mine){upsertChat(roomId,{...normalizedLast,unread:chat.unread||0});renderChats();}else if(inActiveChat){appendMessage(messagesEl,payload.message,txt,false,nearBottom);if(nearBottom){markMessageRead(payload.message.id);upsertChat(roomId,{...normalizedLast,unread:0});}else{const incomingId=Number(payload.message.id);if(Number.isInteger(incomingId)&&incomingId>0){pendingIncomingReadIds=[...new Set([...pendingIncomingReadIds,incomingId])];}const unreadCount=pendingIncomingReadIds.length;upsertChat(roomId,{...normalizedLast,unread:unreadCount});renderNewMessagesPill(unreadCount);}recomputePendingUnread();updateUnreadIndicators();}else{const unread=(chat.unread||0)+1;upsertChat(roomId,{...normalizedLast,unread});renderChats();updatePushBadge();}
if(!mine)notifyIncoming(payload.message.sender_name,txt,roomId);}if(payload.type==='presence:update'&&payload.deviceId){state.presence[payload.deviceId]={deviceId:payload.deviceId,displayName:payload.displayName,online:Boolean(payload.online),lastSeenAt:payload.lastSeenAt||null};renderPresenceStatus();}if(payload.type==='message:status'){document.querySelectorAll('.bubble-wrap').forEach(el=>{if(Number(el.dataset.messageId||el.dataset.id)===payload.messageId){const meta=el.querySelector('.meta');const createdAt=el.dataset.createdAt;const base=formatMessageTime(createdAt);const hasIcon=meta.textContent.includes('✓')||meta.textContent.includes('⏳');meta.innerHTML=hasIcon?`${base} ${deliveryIcon(payload.status)}`:base;if(payload.status==='read'){el.dataset.read='1';unreadVisibleObserver?.unobserve(el);pendingIncomingReadIds=pendingIncomingReadIds.filter((x)=>Number(x)!==Number(payload.messageId));}}});recomputePendingUnread();updateUnreadIndicators();}};}
function showRoomMenu(roomId,x,y){els.context.innerHTML='';[['Переименовать у себя',()=>{const v=prompt('Новое имя',state.roomNames[roomId]||''); if(v!==null){if(v.trim())state.roomNames[roomId]=v.trim(); else delete state.roomNames[roomId]; saveRoomNames(); renderChats(); if(state.roomId===roomId)openChat(roomId);}}],[state.roomMute[roomId]?'Включить уведомления':'Отключить уведомления',()=>{state.roomMute[roomId]=!state.roomMute[roomId];saveRoomMute();renderChats();const st=STORAGE.get(STORAGE.roomState(roomId));if(st?.deviceId){fetch('/api/push/mute-room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,deviceId:st.deviceId,muted:state.roomMute[roomId]})});if(!state.roomMute[roomId])syncRoomPushSubscription(roomId).catch(()=>{});}}],['Скопировать invite-ссылку',()=>{const st=STORAGE.get(STORAGE.roomState(roomId)); navigator.clipboard.writeText(`${location.origin}/i/${roomId}#${st.secret}`);} ],['Удалить из списка',()=>{if(confirm('Удалить чат из списка?')){state.chats=state.chats.filter(c=>c.roomId!==roomId);saveChats();hideMenu();if(state.roomId===roomId){if(state.ws)state.ws.close();state.ws=null;state.roomId=null;}setView('chats');renderChats();if(typeof updatePushBadge==='function')updatePushBadge();}}]].forEach(([t,fn],idx)=>{const b=document.createElement('button');b.className='context-item'+(t.includes('Удалить')?' danger':'');if(idx>0)b.dataset.sep='1';b.textContent=t;b.onclick=()=>{fn();hideMenu()};els.context.appendChild(b)});els.context.classList.remove('hidden');const margin=8;let left=x;let top=y;const rect=els.context.getBoundingClientRect();if(left+rect.width>window.innerWidth-margin){left=window.innerWidth-rect.width-margin;}if(top+rect.height>window.innerHeight-margin){top=window.innerHeight-rect.height-margin;}left=Math.max(margin,left);top=Math.max(margin,top);els.context.style.left=left+'px';els.context.style.top=top+'px';els.context.onclick=(e)=>{e.stopPropagation()};}
function hideMenu(){els.context.classList.add('hidden')} document.addEventListener('click',hideMenu);
function parseInviteInput(value){const input=(value||'').trim(); if(!input)return {error:'empty'}; const parseFromPath=(path,hash)=>{const m=(path||'').match(/^\/i\/([A-Z0-9]{16})$/); if(!m)return null; const secret=(hash||'').replace(/^#/,'').trim(); if(!secret)return {error:'missing_secret'}; return {roomId:m[1],secret};}; try{const u=new URL(input); const parsed=parseFromPath(u.pathname,u.hash); if(parsed)return parsed;}catch{} if(input.startsWith('/i/')){const hashIdx=input.indexOf('#'); const path=hashIdx>=0?input.slice(0,hashIdx):input; const hash=hashIdx>=0?input.slice(hashIdx):''; const parsed=parseFromPath(path,hash); if(parsed)return parsed; return {error:'invalid'};} const short=input.match(/^([A-Z0-9]{16})(?:#(.*))?$/); if(short){const secret=(short[2]||'').trim(); if(!secret)return {error:'missing_secret'}; return {roomId:short[1],secret};} return {error:'invalid'};}

function renderJoin(){els.content.innerHTML=`<div class='panel'><h2>Присоединиться к чату</h2><label>Invite-ссылка</label><textarea id='joinInviteInput' placeholder='Вставьте invite-ссылку'></textarea><div class='panel-actions'><button id='joinBtn' class='btn btn-primary'>Присоединиться</button><button id='pasteJoinBtn' class='btn btn-secondary'>Вставить из буфера</button><button id='backBtn' class='btn btn-secondary'>Назад</button></div></div>`; document.getElementById('backBtn').onclick=()=>setView('chats'); document.getElementById('joinBtn').onclick=async()=>{await joinByInviteText(document.getElementById('joinInviteInput').value);}; document.getElementById('pasteJoinBtn').onclick=async()=>{if(!navigator.clipboard?.readText){alert('Буфер обмена недоступен. Вставьте ссылку вручную.');return;} let text=''; try{text=await navigator.clipboard.readText();}catch{text='';} const parsed=parseInviteInput(text); if(parsed?.error==='empty'||parsed?.error==='invalid'){alert('В буфере обмена не invite-ссылка FPChat.');return;} if(parsed?.error==='missing_secret'){alert('В invite-ссылке нет ключа доступа');return;} if(parsed?.error){alert('В буфере обмена не invite-ссылка FPChat.');return;} const input=document.getElementById('joinInviteInput'); if(input)input.value=text; await joinByInviteText(text);};}
function renderCreate(){els.content.innerHTML=`<div class='panel'><h2>Создать чат</h2><label>Ваш ник</label><input id='nickCreate' value='${state.nick}'/><div class='panel-actions'><button id='createBtn' class='btn btn-primary'>Создать чат</button><button id='backBtn' class='btn btn-secondary'>Назад</button></div><div id='createOut'></div></div>`; document.getElementById('backBtn').onclick=()=>setView('chats'); document.getElementById('createBtn').onclick=async()=>{const createBtn=document.getElementById('createBtn');const baseText='Создать чат';createBtn.disabled=true;createBtn.classList.add('btn-loading');createBtn.textContent='Создание...';try{state.nick=document.getElementById('nickCreate').value.trim()||state.nick; localStorage.setItem(STORAGE.nick,state.nick);
const secret=crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,''); const rec=`R-${Array.from({length:5}).map(()=>Array.from({length:4}).map(()=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join('')).join('-')}`; const salt=crypto.getRandomValues(new Uint8Array(16)); const recSalt=b64.encode(salt); const dig=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rec+':'+recSalt)); const mat=await crypto.subtle.importKey('raw',new TextEncoder().encode(rec),'PBKDF2',false,['deriveKey']); const rk=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64.decode(recSalt),iterations:250000,hash:'SHA-256'},mat,{name:'AES-GCM',length:256},false,['encrypt']); const iv=crypto.getRandomValues(new Uint8Array(12)); const c=await crypto.subtle.encrypt({name:'AES-GCM',iv},rk,new TextEncoder().encode(secret));
const res=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recoverySalt:recSalt,recoveryVerifier:b64.encode(dig),recoverySecretIv:b64.encode(iv),recoverySecretCiphertext:b64.encode(c)})}); const data=await res.json(); STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId:crypto.randomUUID()}); upsertChat(data.publicId,{});
const inv=`${data.inviteLink}#${secret}`; document.getElementById('createOut').innerHTML=`<label>Invite-ссылка</label><textarea readonly id='inv'>${inv}</textarea><div class='panel-actions'><button id='copyInv' class='btn btn-secondary'>Скопировать ссылку</button><button id='shareInv' class='btn btn-secondary'>Поделиться</button></div><label>Recovery-код</label><textarea readonly id='rec'>${rec}</textarea><div class='panel-actions'><button id='saveRec' class='btn btn-secondary'>Сохранить recovery-код</button><button id='goChat' class='btn btn-primary'>Перейти в чат</button></div>`; document.getElementById('copyInv').onclick=()=>navigator.clipboard.writeText(inv); document.getElementById('shareInv').onclick=async()=>{if(navigator.share){try{await navigator.share({text:inv});}catch{}} else navigator.clipboard.writeText(inv)}; document.getElementById('saveRec').onclick=()=>{navigator.clipboard.writeText(rec); const txt=`FPChat recovery code\n\nRecovery code:\n${rec}\n\nВажно:\nБез этого кода восстановить чат нельзя.\nНе отправляйте этот код посторонним.`; const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'})); a.download=`fpchat-recovery-${new Date().toISOString().slice(0,10)}.txt`; a.click();}; document.getElementById('goChat').onclick=()=>openChat(data.publicId);}catch(e){alert('Не удалось создать чат');createBtn.disabled=false;createBtn.classList.remove('btn-loading');createBtn.textContent=baseText;}}
;}
function renderRestore(){els.content.innerHTML=`<div class='panel'><h2>Восстановить</h2><label>Ваш ник</label><input id='nickRestore' value='${state.nick}'/><label>Recovery-код</label><input id='recCode'/><div class='panel-actions'><button id='restoreBtn' class='btn btn-primary'>Восстановить</button><button id='backBtn' class='btn btn-secondary'>Назад</button></div><div id='restoreOut'></div></div>`; document.getElementById('backBtn').onclick=()=>setView('chats'); document.getElementById('restoreBtn').onclick=async()=>{const restoreBtn=document.getElementById('restoreBtn');const baseText='Восстановить';restoreBtn.disabled=true;restoreBtn.classList.add('btn-loading');restoreBtn.textContent='Восстановление...';try{const recoveryCode=document.getElementById('recCode').value.trim().toUpperCase(); state.nick=document.getElementById('nickRestore').value.trim()||state.nick; localStorage.setItem(STORAGE.nick,state.nick); const res=await fetch('/api/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recoveryCode})}); if(!res.ok){const msg=res.status===403?'Recovery-код неверный или чат не найден':'Ошибка восстановления'; throw new Error(msg);} const d=await res.json(); const roomId=d.publicId; const mat=await crypto.subtle.importKey('raw',new TextEncoder().encode(recoveryCode),'PBKDF2',false,['deriveKey']); const rk=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64.decode(d.recoverySalt),iterations:250000,hash:'SHA-256'},mat,{name:'AES-GCM',length:256},false,['decrypt']); const pl=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64.decode(d.recoverySecretIv)},rk,b64.decode(d.recoverySecretCiphertext)); STORAGE.set(STORAGE.roomState(roomId),{secret:new TextDecoder().decode(pl),deviceId:crypto.randomUUID()}); upsertChat(roomId,{}); document.getElementById('restoreOut').innerHTML=`<p>Чат восстановлен</p><button id='goRest' class='btn btn-primary'>Перейти в чат</button>`; document.getElementById('goRest').onclick=()=>openChat(roomId);}catch(e){alert(e.message||'Ошибка восстановления');restoreBtn.disabled=false;restoreBtn.classList.remove('btn-loading');restoreBtn.textContent=baseText;}};}
async function fetchVersionInfo(){
  try{
    const response=await fetch('/version.json',{cache:'no-store'});
    if(!response.ok)return 'Версия: —';
    const payload=await response.json();
    const version=typeof payload?.version==='string'?payload.version.trim():'';
    const build=Number(payload?.build);
    if(version&&Number.isFinite(build))return `Версия: ${version} / build ${build}`;
    if(version)return `Версия: ${version}`;
    return 'Версия: —';
  }catch{
    return 'Версия: —';
  }
}
async function refreshSettingsVersionLine(){
  settingsVersionInfo=await fetchVersionInfo();
  const el=document.getElementById('settingsVersion');
  if(el)el.textContent=settingsVersionInfo;
}

function renderSettings(){els.content.innerHTML=`<div class='panel'><h2>Настройки</h2><label>Ваш ник</label><input id='nick' value='${state.nick}'/><label>Тема</label><select id='theme'><option value='auto'>Авто</option><option value='light'>Светлая</option><option value='dark'>Тёмная</option></select><label><input type='checkbox' id='nEnabled' ${state.notif.enabled?'checked':''}/> Включить уведомления</label><label><input type='checkbox' id='nText' ${state.notif.showText?'checked':''}/> Показывать текст сообщения</label><label><input type='checkbox' id='nSender' ${state.notif.hideSender?'checked':''}/> Скрывать отправителя</label><label><input type='checkbox' id='nSound' ${state.notif.sound?'checked':''}/> Звук нового сообщения</label><div id='settingsVersion' class='sys'>${settingsVersionInfo}</div><div class='panel-actions'><button id='save' class='btn btn-primary'>Сохранить</button><button id='backBtn' class='btn btn-secondary'>Назад</button></div></div>`;void refreshSettingsVersionLine(); document.getElementById('backBtn').onclick=()=>setView('chats'); const t=document.getElementById('theme'); t.value=localStorage.getItem(STORAGE.theme)||'auto'; t.onchange=()=>applyTheme(t.value); const toggle=()=>{['nText','nSender','nSound'].forEach(id=>document.getElementById(id).disabled=!document.getElementById('nEnabled').checked)}; document.getElementById('nEnabled').onchange=async()=>{if(document.getElementById('nEnabled').checked){await ensurePushSubscription();} toggle()}; toggle(); document.getElementById('save').onclick=async()=>{state.nick=document.getElementById('nick').value.trim()||state.nick; localStorage.setItem(STORAGE.nick,state.nick); state.notif={enabled:document.getElementById('nEnabled').checked,showText:document.getElementById('nText').checked,hideSender:document.getElementById('nSender').checked,sound:document.getElementById('nSound').checked}; STORAGE.set(STORAGE.notif,state.notif);const deviceId=STORAGE.get(STORAGE.roomState(state.roomId||''))?.deviceId;if(!state.notif.enabled&&deviceId){await fetch('/api/push/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId})});}if(state.roomId&&deviceId){await fetch('/api/push/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId:state.roomId,deviceId,showText:state.notif.showText,hideSender:state.notif.hideSender})});if(state.notif.enabled&&!state.roomMute[state.roomId])await syncRoomPushSubscription(state.roomId);} alert('Сохранено');};}
function applyTheme(v){localStorage.setItem(STORAGE.theme,v);const root=document.documentElement;if(v==='auto'){root.dataset.theme=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';} else root.dataset.theme=v;}
function notifyIncoming(sender,text,incomingRoomId){if(!state.notif.enabled)return; const msg= state.notif.showText ? (state.notif.hideSender?text:`${sender}: ${text}`) : (state.notif.hideSender?'Новое сообщение':`${sender}: новое сообщение`); if('Notification'in window && Notification.permission==='granted') new Notification('FPChat',{body:msg}); if(state.notif.sound && incomingRoomId!==state.roomId){new Audio('data:audio/wav;base64,UklGRlQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YTAAAAABAQEB').play().catch(()=>{});} }

function bindClick(id,handler){const el=document.getElementById(id); if(el) el.onclick=handler; return el;}
bindClick('emptyCreateBtn',()=>setView('create'));
bindClick('emptyRestoreBtn',()=>setView('restore'));
bindClick('emptyJoinBtn',()=>setView('join'));
bindClick('mobileMenuBtn',toggleMobileMenu);
bindClick('sidebarCloseBtn',closeMobileMenu);
els.sidebarOverlay?.addEventListener('click',closeMobileMenu);
document.addEventListener('keydown',(e)=>{if(e.key==='Escape')closeMobileMenu();});
window.addEventListener('resize',()=>{if(!isMobileViewport())closeMobileMenu();});
document.addEventListener('touchstart',(e)=>{
  if(!isMobileViewport())return;
  if(els.sidebar?.classList.contains('open'))return;
  if(!els.context?.classList.contains('hidden'))return;
  const touch=e.touches?.[0];
  if(!touch)return;
  if(touch.clientX>32)return;
  edgeSwipe={active:true,startX:touch.clientX,startY:touch.clientY,tracking:true};
},{passive:true});
document.addEventListener('touchmove',(e)=>{
  if(!edgeSwipe.tracking)return;
  const touch=e.touches?.[0];
  if(!touch)return;
  const dx=touch.clientX-edgeSwipe.startX;
  const dy=touch.clientY-edgeSwipe.startY;
  if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>16){
    edgeSwipe.tracking=false;
    return;
  }
  if(dx>70&&Math.abs(dy)<40){
    openMobileMenu();
    edgeSwipe.tracking=false;
  }
},{passive:true});
document.addEventListener('touchend',()=>{edgeSwipe.tracking=false;},{passive:true});
document.addEventListener('touchcancel',()=>{edgeSwipe.tracking=false;},{passive:true});
const restoreWsOnResume=()=>{if(state.roomId&&activeChatDeviceId){ensureWsConnected(state.roomId,activeChatDeviceId);}};
const handleAppResume=()=>{restoreWsOnResume();checkAppVersionOnEntry();};
window.addEventListener('focus',handleAppResume);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')handleAppResume();});
window.addEventListener('pageshow',handleAppResume);


document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>{setView(b.dataset.view); closeMobileMenu();}); els.search.oninput=renderChats;
(async()=>{
  await registerServiceWorker();
  const updateStarted=await checkAppVersionOnEntry();
  if(updateStarted)return;
  applyTheme(localStorage.getItem(STORAGE.theme)||'auto');
  const inv=parseInvite();
  const chat=parseChat();

  if(inv){
    const stored=STORAGE.get(STORAGE.roomState(inv.roomId));
    const isNewInvite=Boolean(inv.secret && !stored?.secret);


    if(isNewInvite){
      await joinByInviteText(`${location.origin}/i/${inv.roomId}#${inv.secret}`);
      hideBootSplash();
      return;
    }
    if(stored?.secret){
      upsertChat(inv.roomId,{});
    }
  }

  if(chat){
    // Диплинк /chat/:id больше не открывает чат автоматически.
  }

  showChatsList();
  if(!els.appRoot?.dataset.pane) showListPane();
  hideBootSplash();
})();
function urlB64ToUint8Array(base64String){const padding='='.repeat((4-base64String.length%4)%4);const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');const rawData=atob(base64);return Uint8Array.from([...rawData].map(c=>c.charCodeAt(0)));}
async function registerServiceWorker(){if(!('serviceWorker' in navigator))return null;try{return await navigator.serviceWorker.register('/sw.js');}catch{return null;}}

async function applyAppUpdate(){
  try{
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      for(const reg of regs){
        try{await reg.update();}catch{}
      }
    }
    if('caches' in window){
      const keys=await caches.keys();
      await Promise.all(keys.map((key)=>caches.delete(key)));
    }
  }finally{
    location.reload();
  }
}
async function checkAppVersionOnEntry(){
  if(appVersionCheckInFlight)return false;
  appVersionCheckInFlight=true;
  try{
    const response=await fetch('/version.json',{cache:'no-store'});
    if(!response.ok)return false;
    const payload=await response.json();
    const serverBuild=Number(payload?.build);
    if(!Number.isFinite(serverBuild))return false;
    const localBuildRaw=localStorage.getItem(APP_BUILD_KEY);
    const localBuild=localBuildRaw===null?null:Number(localBuildRaw);
    const isReloading=sessionStorage.getItem(APP_UPDATE_RELOADING_KEY)==='1';
    if(localBuild===null||!Number.isFinite(localBuild)){
      localStorage.setItem(APP_BUILD_KEY,String(serverBuild));
      return false;
    }
    if(serverBuild>localBuild){
      localStorage.setItem(APP_BUILD_KEY,String(serverBuild));
      sessionStorage.setItem(APP_UPDATE_RELOADING_KEY,'1');
      setBootSplashText('Обновление приложения...','Применяем новую версию');
      await applyAppUpdate();
      return true;
    }
    if(serverBuild<=localBuild&&isReloading){
      sessionStorage.removeItem(APP_UPDATE_RELOADING_KEY);
    }
  }catch{
    return false;
  }finally{
    appVersionCheckInFlight=false;
  }
}
async function getPushConfig(){const r=await fetch('/api/push/vapid-public-key');return r.json();}
async function ensurePushSubscription(){if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){alert('Push-уведомления недоступны на этом устройстве');return null;}const registration=await navigator.serviceWorker.ready;const cfg=await getPushConfig();if(!cfg.enabled){alert('Push-уведомления отключены на сервере');return null;}if(Notification.permission!=='granted'){const p=await Notification.requestPermission();if(p!=='granted')return null;}let sub=await registration.pushManager.getSubscription();if(!sub){sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64ToUint8Array(cfg.publicKey)});}return sub;}
async function syncRoomPushSubscription(roomId){if(!state.notif.enabled||state.roomMute[roomId])return;const persisted=STORAGE.get(STORAGE.roomState(roomId));if(!persisted?.deviceId)return;const sub=await ensurePushSubscription();if(!sub)return;await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,deviceId:persisted.deviceId,subscription:sub.toJSON(),settings:{showText:state.notif.showText,hideSender:state.notif.hideSender}})});}
async function updatePushBadge(){const unread=state.chats.reduce((a,c)=>a+(c.unread||0),0);if(unread===0&&navigator.clearAppBadge){try{await navigator.clearAppBadge();}catch{}}else if(unread>0&&navigator.setAppBadge){try{await navigator.setAppBadge(unread);}catch{}}}