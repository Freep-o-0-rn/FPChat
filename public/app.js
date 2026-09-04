const STORAGE={roomState:(id)=>`fpchat:room:${id}`,activeChatsKey:'fpchat:active-chats',lastSelectedRoomId:'lastSelectedRoomId',nick:'fpchat:nick',theme:'fpchat:theme',roomNames:'fpchat:room-names',notif:'fpchat:notif',roomMute:'fpchat:room-mute',deviceId:'fpchat:device-id',set:(k,v)=>localStorage.setItem(k,JSON.stringify(v)),get:(k)=>{const v=localStorage.getItem(k);return v?JSON.parse(v):null;}};
const DEFAULT_NOTIFICATION_SETTINGS=Object.freeze({enabled:true,showText:true,hideSender:false,sound:true});
const NOTIFICATION_PROMPTED_KEY='fpchat:notification-prompted';
function normalizeNotificationSettings(value){const raw=value&&typeof value==='object'?value:{};return {enabled:raw.enabled!==false,showText:raw.showText!==false,hideSender:raw.hideSender===true,sound:raw.sound!==false};}
const storedNotificationSettings=STORAGE.get(STORAGE.notif);
const initialNotificationSettings=normalizeNotificationSettings(storedNotificationSettings||DEFAULT_NOTIFICATION_SETTINGS);
function getOrCreateDeviceId(){const current=String(localStorage.getItem(STORAGE.deviceId)||'').trim();if(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current))return current;const deviceId=crypto.randomUUID();localStorage.setItem(STORAGE.deviceId,deviceId);return deviceId;}
const state={view:'chats',roomId:null,secret:null,key:null,ws:null,me:null,chats:STORAGE.get(STORAGE.activeChatsKey)||[],roomNames:STORAGE.get(STORAGE.roomNames)||{},nick:localStorage.getItem(STORAGE.nick)||`Гость-${String(Math.floor(Math.random()*100000)).padStart(5,'0')}`,notif:initialNotificationSettings,roomMute:STORAGE.get(STORAGE.roomMute)||{},presence:{},localConnectionState:'disconnected',drafts:{}};localStorage.setItem(STORAGE.nick,state.nick);if(!storedNotificationSettings)STORAGE.set(STORAGE.notif,state.notif);
const messageCache=new Map();
const SWIPE_REPLY_THRESHOLD=52;
const SWIPE_CANCEL_VERTICAL=28;
const CHAT_BACK_SWIPE_THRESHOLD=80;
const CHAT_BACK_VERTICAL_CANCEL=40;
const CHAT_BACK_MAX_TRANSLATE=120;
const DRAFT_SAVE_DEBOUNCE_MS=700;
const VIEW_STATE_SAVE_DEBOUNCE_MS=900;
const CHAT_HISTORY_PAGE_SIZE=100;
const CHAT_HISTORY_LOAD_THRESHOLD_PX=220;

const els={content:document.getElementById('contentPane'),rows:document.getElementById('chatRows'),search:document.getElementById('chatSearch'),empty:document.getElementById('emptyChats'),sidebar:document.getElementById('sidebar'),sidebarOverlay:document.getElementById('sidebarOverlay'),context:document.getElementById('contextMenu'),appRoot:document.getElementById('appRoot')};
const b64={encode:(buf)=>btoa(String.fromCharCode(...new Uint8Array(buf))),decode:(str)=>Uint8Array.from(atob(str),c=>c.charCodeAt(0))};
const shortId=(id)=>`${id.slice(0,4)}...${id.slice(-3)}`;
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}
function safeText(value) {
  return escapeHtml(value);
}
function parseServerTime(value){if(!value)return null;if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))return new Date(value.replace(' ','T')+'Z');const date=new Date(value);return Number.isNaN(date.getTime())?null:date;}
function formatMessageTime(iso){const date=parseServerTime(iso);return date?date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'';}
function formatChatListTime(iso){const date=parseServerTime(iso);if(!date)return'';const now=new Date();const startToday=new Date(now.getFullYear(),now.getMonth(),now.getDate());const startTarget=new Date(date.getFullYear(),date.getMonth(),date.getDate());const oneDay=24*60*60*1000;const diff=Math.round((startToday-startTarget)/oneDay);if(diff===0)return formatMessageTime(iso);if(diff===1)return'Вчера';if(diff>1&&diff<7)return ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][date.getDay()];return `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}.${String(date.getFullYear()).slice(-2)}`;}
function getLocalDayKey(value){const date=parseServerTime(value);if(!date)return'';const y=date.getFullYear();const m=String(date.getMonth()+1).padStart(2,'0');const d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`;}
function formatDateSeparator(value){const date=parseServerTime(value);if(!date)return'';const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());const target=new Date(date.getFullYear(),date.getMonth(),date.getDate());const diffDays=Math.round((today-target)/(24*60*60*1000));if(diffDays===0)return 'Сегодня';if(diffDays===1)return 'Вчера';const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];const day=date.getDate();const month=months[date.getMonth()];if(date.getFullYear()===now.getFullYear())return `${day} ${month}`;return `${day} ${month} ${date.getFullYear()}`;}
function appendDateSeparatorIfNeeded(box,createdAt){if(!box)return;const dayKey=getLocalDayKey(createdAt);if(!dayKey)return;const lastDayKey=box.dataset.lastDayKey||'';if(dayKey===lastDayKey)return;box.dataset.lastDayKey=dayKey;const sep=document.createElement('div');sep.className='date-sep';sep.textContent=formatDateSeparator(createdAt);box.appendChild(sep);}
const MEDIA_LIMITS = {maxFiles:10,maxImageSize:10*1024*1024,maxVideoSize:100*1024*1024,maxTotalSize:1024*1024*1024,thumbMaxSide:480,thumbQuality:0.75};
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4','video/webm','video/quicktime']);
let mediaPreviewState=null;
let mediaViewerState=null;
const APP_BUILD_KEY='fpchat:app-build';
const APP_UPDATE_RELOADING_KEY='fpchat:update-reloading';
let activeChatDeviceId=null;let activeChatHistory=null;let pendingIncomingReadIds=[];const pendingReadQueue=new Map();const pendingReceivedQueue=new Map();const messageStatusByKey=new Map();const pendingTextSends=new Map();let unreadVisibleObserver=null;let initialMessagesScrollPending=false;let appWsSeq=0;let activeAppWsSeq=0;let appWsConnectInFlight=null;let chatViewReadyRoomId=null;let chatOpenToken=0;const roomKeyCache=new Map();const lastKnownMessageIdByRoom=new Map();const bufferedRoomMessages=new Map();let stableWsDesiredDeviceId=null;let stableWsSequence=0;let stableWsConnectPromise=null;let stableWsConnectDeviceId=null;let stableWsReconnectTimer=null;let stableWsReconnectAttempt=0;let stableWsManualClose=false;let stableWsSyncPromise=null;
let appVersionCheckInFlight=false;
let deferredInstallPrompt=null;
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
async function getRoomKey(roomId,secretHint=null){const persisted=STORAGE.get(STORAGE.roomState(roomId));const secret=String(secretHint||persisted?.secret||'');if(!secret)return null;const cached=roomKeyCache.get(roomId);if(cached?.secret===secret&&cached.key)return cached.key;const key=await deriveKey(secret);roomKeyCache.set(roomId,{secret,key});return key;}
async function decryptRoomText(roomId,message){const key=await getRoomKey(roomId);if(!key)throw new Error('room key unavailable');const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64.decode(message.iv)},key,b64.decode(message.ciphertext));return new TextDecoder().decode(plain);}
function generateRecoveryCode(){return `R-${Array.from({length:5}).map(()=>Array.from({length:4}).map(()=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join('')).join('-')}`;}
async function buildRecoveryPayload(recoveryCode,secret){const salt=crypto.getRandomValues(new Uint8Array(16));const recoverySalt=b64.encode(salt);const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(recoveryCode+':'+recoverySalt));const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(recoveryCode),'PBKDF2',false,['deriveKey']);const recoveryKey=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64.decode(recoverySalt),iterations:250000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},recoveryKey,new TextEncoder().encode(secret));return {recoveryCode,recoverySalt,recoveryVerifier:b64.encode(digest),recoverySecretIv:b64.encode(iv),recoverySecretCiphertext:b64.encode(ciphertext)};}
function makeRecoveryTxt(recoveryCode){return `FPChat recovery code\n\nRecovery code:\n${recoveryCode}\n\nВажно:\nБез этого кода восстановить чат нельзя.\nНе отправляйте этот код посторонним.`;}
function downloadRecoveryCode(recoveryCode){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([makeRecoveryTxt(recoveryCode)],{type:'text/plain'}));a.download=`fpchat-recovery-${new Date().toISOString().slice(0,10)}.txt`;a.click();}
async function registerRecoveryForJoinedParticipant(publicId,deviceId,roomSecret){
  const recoveryCode=generateRecoveryCode();
  const recoveryPayload=await buildRecoveryPayload(recoveryCode,roomSecret);
  const res=await fetch(`/api/rooms/${publicId}/recovery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId,recoverySalt:recoveryPayload.recoverySalt,recoveryVerifier:recoveryPayload.recoveryVerifier,recoverySecretIv:recoveryPayload.recoverySecretIv,recoverySecretCiphertext:recoveryPayload.recoverySecretCiphertext})});
  if(!res.ok)throw new Error('failed to register recovery');
  return recoveryCode;
}
function showRecoveryCodeModal(recoveryCode){
  const root=document.createElement('div');
  root.style.position='fixed';root.style.inset='0';root.style.background='rgba(0,0,0,.45)';root.style.display='flex';root.style.alignItems='center';root.style.justifyContent='center';root.style.zIndex='1000';
  root.innerHTML=`<div class='panel' style='max-width:560px;width:min(92vw,560px)'><h2>Сохраните recovery-код</h2><textarea readonly id='joinRecoveryCode' style='min-height:72px'>${recoveryCode}</textarea><p class='sys'>Recovery-код помогает восстановить чат только на устройстве участника. Если очистить данные приложения или браузера, восстановление может быть невозможно. Храните recovery-код как пароль.</p><div class='panel-actions'><button id='joinRecCopy' class='btn btn-secondary'>Скопировать</button><button id='joinRecSave' class='btn btn-secondary'>Скачать .txt</button><button id='joinRecDone' class='btn btn-primary'>Я сохранил</button></div></div>`;
  document.body.appendChild(root);
  root.querySelector('#joinRecCopy').onclick=async()=>{try{await navigator.clipboard.writeText(recoveryCode);}catch{alert('Не удалось скопировать recovery-код. Скопируйте вручную.');}};
  root.querySelector('#joinRecSave').onclick=()=>downloadRecoveryCode(recoveryCode);
  root.querySelector('#joinRecDone').onclick=()=>root.remove();
}
async function encryptText(t){const iv=crypto.getRandomValues(new Uint8Array(12)); const c=await crypto.subtle.encrypt({name:'AES-GCM',iv},state.key,new TextEncoder().encode(t)); return {iv:b64.encode(iv),ciphertext:b64.encode(c)};}
async function decryptText(iv,c){const p=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64.decode(iv)},state.key,b64.decode(c)); return new TextDecoder().decode(p)}
async function encryptBlobWithIvPrefix(blob){const iv=crypto.getRandomValues(new Uint8Array(12));const plain=await blob.arrayBuffer();const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},state.key,plain);const out=new Uint8Array(iv.byteLength+cipher.byteLength);out.set(iv,0);out.set(new Uint8Array(cipher),iv.byteLength);return new Blob([out],{type:'application/octet-stream'});}
async function decryptBlobWithIvPrefix(encryptedBlob,mimeType){const buf=await encryptedBlob.arrayBuffer();const bytes=new Uint8Array(buf);const iv=bytes.slice(0,12);const cipher=bytes.slice(12);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},state.key,cipher);return new Blob([plain],{type:mimeType||'application/octet-stream'});}
function uploadEncryptedMediaXhr(roomId,deviceId,formData,onProgress){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',`/api/rooms/${roomId}/media/upload`);xhr.upload.onprogress=(event)=>{if(event.lengthComputable&&typeof onProgress==='function')onProgress(event.loaded,event.total);};xhr.onload=()=>{let data=null;try{data=JSON.parse(xhr.responseText);}catch{}if(xhr.status>=200&&xhr.status<300&&data?.ok)resolve(data.media);else reject(new Error(data?.error||`upload failed ${xhr.status}`));};xhr.onerror=()=>reject(new Error('network error'));xhr.send(formData);});}
function makeReplyPreview(text){const safe=String(text||'').replace(/\s+/g,' ').trim();if(!safe)return'Сообщение недоступно';return safe.length>80?safe.slice(0,80).trimEnd()+'…':safe;}
function ensureDraftState(roomId){if(!state.drafts[roomId])state.drafts[roomId]={text:'',replyTo:null,loaded:false,saveTimer:null};return state.drafts[roomId];}
function setSelectedReply(roomId,replyTo){if(!roomId)return;const draft=ensureDraftState(roomId);draft.replyTo=replyTo;markReplyTargetRead(replyTo?.messageId);updateReplyComposerBar();void saveDraftNow(roomId);document.getElementById('msgInput')?.focus();}
function clearSelectedReply(roomId){if(!roomId)return;const draft=ensureDraftState(roomId);draft.replyTo=null;updateReplyComposerBar();void saveDraftNow(roomId);}
function updateReplyComposerBar(){const bar=document.getElementById('replyComposerBar');if(!bar||!state.roomId)return;const draft=ensureDraftState(state.roomId);const reply=draft.replyTo;if(!reply){bar.classList.add('hidden');bar.innerHTML='';return;}bar.classList.remove('hidden');bar.innerHTML=`<div class="reply-composer-content"><div class="reply-composer-author"></div><div class="reply-composer-preview"></div></div><button class="reply-composer-close" type="button" aria-label="Отменить ответ">×</button>`;bar.querySelector('.reply-composer-author').textContent=reply.author||'Неизвестно';bar.querySelector('.reply-composer-preview').textContent=reply.preview||'Сообщение недоступно';bar.querySelector('.reply-composer-close').onclick=()=>clearSelectedReply(state.roomId);}
function scheduleDraftSave(roomId){if(!roomId)return;const draft=ensureDraftState(roomId);clearTimeout(draft.saveTimer);draft.saveTimer=setTimeout(()=>{void saveDraftNow(roomId);},DRAFT_SAVE_DEBOUNCE_MS);}
async function saveDraftNow(roomId){if(!roomId)return;const draft=ensureDraftState(roomId);clearTimeout(draft.saveTimer);draft.saveTimer=null;const persisted=STORAGE.get(STORAGE.roomState(roomId));if(!persisted?.deviceId||!state.key)return;const text=draft.text||'';const replyToMessageId=draft.replyTo?.messageId||null;if(!text.trim()&&!replyToMessageId){await clearDraftOnServer(roomId);renderChats();return;}const body={deviceId:persisted.deviceId,replyToMessageId};if(text.trim()){const enc=await encryptText(text);body.ciphertext=enc.ciphertext;body.iv=enc.iv;}else{body.ciphertext=null;body.iv=null;}await fetch(`/api/rooms/${roomId}/draft`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(()=>{});renderChats();}
async function clearDraftOnServer(roomId){if(!roomId)return;const persisted=STORAGE.get(STORAGE.roomState(roomId));if(!persisted?.deviceId)return;const draft=ensureDraftState(roomId);clearTimeout(draft.saveTimer);draft.saveTimer=null;draft.text='';draft.replyTo=null;await fetch(`/api/rooms/${roomId}/draft`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:persisted.deviceId})}).catch(()=>{});renderChats();}
async function loadDraftForCurrentRoom(){const roomId=state.roomId;const persisted=STORAGE.get(STORAGE.roomState(roomId));const input=document.getElementById('msgInput');if(!roomId||!persisted?.deviceId||!input||!state.key)return;const draft=ensureDraftState(roomId);draft.loaded=true;let res;try{res=await fetch(`/api/rooms/${roomId}/draft?deviceId=${encodeURIComponent(persisted.deviceId)}`);}catch{return;}if(!res.ok)return;const data=await res.json().catch(()=>null);const serverDraft=data?.draft;if(!serverDraft){draft.text='';draft.replyTo=null;input.value='';updateReplyComposerBar();autoResizeMessageInput(input);renderChats();return;}let text='';if(serverDraft.ciphertext&&serverDraft.iv){try{text=await decryptText(serverDraft.iv,serverDraft.ciphertext);}catch{text='';}}draft.text=text;input.value=text;autoResizeMessageInput(input);if(serverDraft.reply_to_message_id){draft.replyTo=getMessageReplyMeta(serverDraft.reply_to_message_id);}else{draft.replyTo=null;}updateReplyComposerBar();renderChats();}
function showMessageReplyMenu(messageId,x,y){hideMessageReplyMenu();const menu=document.createElement('div');menu.className='message-reply-menu';menu.innerHTML='<button type="button">Ответить</button>';menu.querySelector('button').onclick=()=>{const replyTo=getMessageReplyMeta(messageId);setSelectedReply(state.roomId,replyTo);hideMessageReplyMenu();};document.body.appendChild(menu);const margin=8;const rect=menu.getBoundingClientRect();let left=Math.min(x,window.innerWidth-rect.width-margin);let top=Math.min(y,window.innerHeight-rect.height-margin);left=Math.max(margin,left);top=Math.max(margin,top);menu.style.left=`${left}px`;menu.style.top=`${top}px`;setTimeout(()=>{document.addEventListener('click',hideMessageReplyMenu,{once:true});});}
function hideMessageReplyMenu(){document.querySelector('.message-reply-menu')?.remove();}
async function findAndFocusReplyMessage(messageId){let target=document.querySelector(`.msg[data-message-id="${messageId}"]`);if(!target)target=await loadHistoryUntilMessage(messageId);if(!target){alert('Сообщение не найдено');return;}target.scrollIntoView({behavior:'smooth',block:'center'});if(target.dataset.incoming==='1'&&target.dataset.read!=='1'){markMessageRead(messageId);}target.classList.add('reply-highlight');setTimeout(()=>target.classList.remove('reply-highlight'),1400);}
function getMessageReplyMeta(messageId){const cached=messageCache.get(Number(messageId));if(cached)return{messageId:Number(messageId),author:cached.author||'Неизвестно',preview:cached.preview||'Сообщение недоступно',kind:cached.kind||'text'};return{messageId:Number(messageId),author:'Неизвестно',preview:'Сообщение недоступно',kind:'text'};}
function upsertChat(roomId,patch={}){const i=state.chats.findIndex(x=>x.roomId===roomId);const existing=i>=0?state.chats[i]:null;const next={...(existing||{roomId,unread:0}),...patch,roomId};if(!next.lastActivity){next.lastActivity=existing?.lastActivity||new Date().toISOString();}if(i>=0)state.chats[i]=next; else state.chats.push(next); state.chats.sort((a,b)=>new Date(b.lastActivity)-new Date(a.lastActivity)); saveChats(); renderChats();}
function setActiveNav(v){document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===v));}
function showListPane(){els.appRoot?.setAttribute('data-pane','list'); els.appRoot?.classList.remove('mobile-chat');}
function showContentPane(){els.appRoot?.setAttribute('data-pane','content');}
function leaveActiveChat(){if(!state.roomId)return;if(viewStateSaveTimer){clearTimeout(viewStateSaveTimer);viewStateSaveTimer=null;}void saveViewStateNow({keepalive:true});state.roomId=null;activeChatDeviceId=null;activeChatHistory=null;chatViewReadyRoomId=null;sendClientState();}
function setView(v){if(state.roomId)leaveActiveChat();state.view=v; setActiveNav(v); closeMobileMenu(); if(v==='chats'){showListPane(); renderMainChatsPlaceholder(); const deviceId=String(localStorage.getItem(STORAGE.deviceId)||'').trim();if(deviceId&&state.chats.length)void ensureStableWsConnected(deviceId);return;} if(v==='create'){renderCreate(); showContentPane(); return;} if(v==='restore'){renderRestore(); showContentPane(); return;} if(v==='join'){renderJoin(); showContentPane(); return;} if(v==='settings'){renderSettings(); showContentPane();}}
function isMobileViewport(){return window.matchMedia('(max-width: 900px)').matches;}
function isBackGestureBlockedTarget(target){
  if(!target)return true;
  return Boolean(target.closest('.composer, .composer *, .chat-header, .chat-header *, #backMob, #reloadBtn, #menuBtn, textarea, button, input, select, [contenteditable="true"]'));
}
function resetChatBackSwipe(chatView){
  if(!chatView)return;
  chatView.classList.remove('back-swiping');
  chatView.classList.add('back-swipe-reset');
  chatView.style.transform='translateX(0)';
  const cleanup=()=>{
    chatView.classList.remove('back-swipe-reset');
    chatView.style.transform='';
    chatView.style.transition='';
    chatView.removeEventListener('transitionend',cleanup);
  };
  chatView.addEventListener('transitionend',cleanup);
}
function setupChatBackSwipe(chatView){
  if(!chatView)return;
  let swipe=null;
  chatView.addEventListener('touchstart',(e)=>{
    if(!isMobileViewport()||state.view!=='chats'||!state.roomId)return;
    if(els.sidebar?.classList.contains('open'))return;
    if(!els.context?.classList.contains('hidden'))return;
    const touch=e.touches?.[0];
    if(!touch)return;
    const target=e.target;
    if(isBackGestureBlockedTarget(target))return;
    swipe={startX:touch.clientX,startY:touch.clientY,dx:0,dy:0,canceled:false,back:false};
    chatView.classList.remove('back-swipe-reset');
  },{passive:true});
  chatView.addEventListener('touchmove',(e)=>{
    if(!swipe||swipe.canceled)return;
    const touch=e.touches?.[0];
    if(!touch)return;
    swipe.dx=touch.clientX-swipe.startX;
    swipe.dy=touch.clientY-swipe.startY;
    if(Math.abs(swipe.dy)>CHAT_BACK_VERTICAL_CANCEL&&Math.abs(swipe.dy)>Math.abs(swipe.dx)){
      swipe.canceled=true;
      chatView.classList.remove('back-swiping');
      chatView.style.transform='';
      return;
    }
    if(swipe.dx<=0)return;
    swipe.back=true;
    const translate=Math.min(swipe.dx,CHAT_BACK_MAX_TRANSLATE);
    chatView.classList.add('back-swiping');
    chatView.style.transform=`translateX(${translate}px)`;
  },{passive:true});
  const endSwipe=()=>{
    if(!swipe)return;
    const shouldGoBack=swipe.back&&!swipe.canceled&&swipe.dx>=CHAT_BACK_SWIPE_THRESHOLD;
    if(shouldGoBack){
      chatView.classList.remove('back-swiping');
      chatView.style.transform='';
      showChatsList();
    }else{
      resetChatBackSwipe(chatView);
    }
    swipe=null;
  };
  chatView.addEventListener('touchend',endSwipe,{passive:true});
  chatView.addEventListener('touchcancel',endSwipe,{passive:true});
}
function showChatsList(){leaveActiveChat();closeMobileMenu();els.appRoot?.classList.remove('mobile-chat');renderChats();setView('chats');sendClientState();const deviceId=String(localStorage.getItem(STORAGE.deviceId)||'').trim();if(deviceId&&state.chats.length)void ensureStableWsConnected(deviceId);}
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
  if(typeof updateUnreadPresentation==='function'){
    updateUnreadPresentation();
  }
}
function openMobileMenu(){if(!isMobileViewport())return; els.sidebar?.classList.add('open'); els.sidebarOverlay?.classList.add('open','active'); els.appRoot?.classList.add('menu-open'); document.body.classList.add('menu-open');}
function closeMobileMenu(){els.sidebar?.classList.remove('open'); els.sidebarOverlay?.classList.remove('open','active'); els.appRoot?.classList.remove('menu-open'); document.body.classList.remove('menu-open');}
function toggleMobileMenu(){if(els.sidebar?.classList.contains('open')) closeMobileMenu(); else openMobileMenu();}
let edgeSwipe={active:false,startX:0,startY:0,tracking:false};

let lastBackPressAt=0;
const BACK_EXIT_INTERVAL=2000;
function showBackExitToast(){
  let toast=document.getElementById('backExitToast');
  if(!toast){
    toast=document.createElement('div');
    toast.id='backExitToast';
    toast.className='back-exit-toast';
    toast.textContent='Нажмите ещё раз, чтобы выйти';
    document.body.appendChild(toast);
  }
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer=setTimeout(()=>{toast.classList.remove('show');},1800);
}
function handleAndroidBackNavigation(){
  const sidebarOpen=els.sidebar?.classList.contains('open');
  if(sidebarOpen){closeMobileMenu();return true;}
  if(state.roomId){showChatsList();return true;}
  if(state.view&&state.view!=='chats'){setView('chats');return true;}
  const now=Date.now();
  if(now-lastBackPressAt<BACK_EXIT_INTERVAL)return false;
  lastBackPressAt=now;
  showBackExitToast();
  return true;
}
function pushAppHistoryState(){
  try{history.pushState({fpchat:true},'',location.href);}catch{}
}

function renderChats(){const q=els.search.value?.toLowerCase()||''; let chats=state.chats.filter(c=>{const n=(state.roomNames[c.roomId]||'').toLowerCase(); return [n,c.roomId,(c.lastMessage||'').toLowerCase()].some(s=>s.includes(q));}); els.rows.innerHTML=''; if(els.empty){ els.empty.classList.toggle('hidden', chats.length>0); } chats.forEach(c=>{const displayLastSender=safeText(c.lastSender||'');const minePrefix=c.lastSender===state.nick?'Вы: ':c.lastSender?`${displayLastSender}: `:'';const draft=state.drafts[c.roomId];const hasDraft=Boolean(draft&&(draft.text?.trim()||draft.replyTo));const displayLastMessage=safeText(c.lastMessage||'');const displayDraftText=safeText(draft?.text?.trim()||'');const lastHtml=hasDraft?`<div class='last'><span class='draft-label'>Черновик</span>${draft.text?.trim()?`<div class='draft-text'>${displayDraftText}</div>`:''}</div>`:`<div class='last'>${state.roomMute[c.roomId]?'🔕 ':''}${minePrefix}${displayLastMessage}</div>`;const row=document.createElement('div'); row.className='chat-row'+(c.roomId===state.roomId?' active':'')+(c.unread?' unread':''); const displayRoomName=safeText(state.roomNames[c.roomId]||`Комната ${shortId(c.roomId)}`);const displaySystemRoom=safeText(`Комната ${shortId(c.roomId)}`);row.innerHTML=`<div class='row-top'><div><div><strong>${displayRoomName}</strong></div>${state.roomNames[c.roomId]?`<div class='sys'>${displaySystemRoom}</div>`:''}</div><div class="chat-row-meta">${c.unread>0?`<span class="chat-unread-badge">${c.unread>99?'99+':c.unread}</span>`:''}<span class="chat-time">${formatChatListTime(c.lastActivity)}</span></div></div><div class='row-top'>${lastHtml}</div>`; let longPressTimer=null; let longPressTriggered=false; let suppressNextClickUntil=0; let startX=0; let startY=0; row.addEventListener('touchstart',(e)=>{const touch=e.touches?.[0]; if(!touch)return; startX=touch.clientX; startY=touch.clientY; longPressTriggered=false; if(longPressTimer){clearTimeout(longPressTimer);} longPressTimer=setTimeout(()=>{longPressTriggered=true; suppressNextClickUntil=Date.now()+500; showRoomMenu(c.roomId,startX,startY);navigator.vibrate?.(10);},600);},{passive:true}); row.addEventListener('touchmove',(e)=>{const touch=e.touches?.[0]; if(!touch||!longPressTimer)return; if(Math.abs(touch.clientX-startX)>10||Math.abs(touch.clientY-startY)>10){clearTimeout(longPressTimer);longPressTimer=null;}},{passive:true}); row.addEventListener('touchend',(e)=>{if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;} if(longPressTriggered===true){e.preventDefault();e.stopPropagation();longPressTriggered=false;}}, {passive:false}); row.addEventListener('touchcancel',()=>{if(longPressTimer){clearTimeout(longPressTimer);} longPressTimer=null; longPressTriggered=false;}); row.onclick=(e)=>{if(longPressTriggered===true||Date.now()<suppressNextClickUntil){e.preventDefault();e.stopPropagation();return;}openChat(c.roomId);}; row.oncontextmenu=(e)=>{e.preventDefault();e.stopPropagation();showRoomMenu(c.roomId,e.clientX,e.clientY)}; els.rows.appendChild(row);});}
function renderMainChatsPlaceholder(){els.content.innerHTML='';}
function parseInvite(){const m=location.pathname.match(/^\/i\/([A-Z0-9]{16,64})$/i);if(!m)return null; if(location.hash){return {error:'legacy'};} return {inviteCode:m[1]};}
function getKnownDeviceIds(){const ids=new Set();const stableDeviceId=String(localStorage.getItem(STORAGE.deviceId)||'').trim();if(stableDeviceId)ids.add(stableDeviceId);for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key||!key.startsWith('fpchat:room:'))continue;const val=STORAGE.get(key);if(val?.deviceId)ids.add(String(val.deviceId));}return [...ids];}
function parseChat(){const m=location.pathname.match(/^\/chat\/([A-Z0-9]{16})$/); return m?m[1]:null;}
function getInitialScrollTargetId(data){
  const unreadCount=Number(data?.unreadCount);
  const firstUnreadId=Number(data?.firstUnreadMessageId);
  if(unreadCount>0&&Number.isSafeInteger(firstUnreadId)&&firstUnreadId>0)return firstUnreadId;
  const savedAnchorId=Number(data?.viewState?.anchorMessageId);
  return Number.isSafeInteger(savedAnchorId)&&savedAnchorId>0?savedAnchorId:null;
}
async function hydrateHistoryForInitialPosition(roomId,deviceId,data){
  const anchorId=getInitialScrollTargetId(data);
  let messages=Array.isArray(data?.messages)?[...data.messages]:[];
  if(!Number.isSafeInteger(anchorId)||anchorId<=0||messages.some((message)=>Number(message?.id)===anchorId))return;
  let cursor=Number(data?.nextCursor);
  let hasMore=typeof data?.hasMore==='boolean'?data.hasMore:messages.length>=CHAT_HISTORY_PAGE_SIZE;
  let pages=0;
  while(hasMore&&Number.isSafeInteger(cursor)&&cursor>0&&pages<100&&!messages.some((message)=>Number(message?.id)===anchorId)){
    const params=new URLSearchParams({deviceId:String(deviceId),limit:String(CHAT_HISTORY_PAGE_SIZE),before:String(cursor)});
    const response=await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages?${params.toString()}`,{cache:'no-store'});
    if(!response.ok)break;
    const page=await response.json().catch(()=>null);
    if(!page||!Array.isArray(page.messages))break;
    const known=new Set(messages.map((message)=>Number(message?.id)));
    const older=page.messages.filter((message)=>{const id=Number(message?.id);return Number.isSafeInteger(id)&&id>0&&!known.has(id);});
    messages=[...older,...messages];
    const next=Number(page.nextCursor);
    const advanced=Number.isSafeInteger(next)&&next>0&&next<cursor;
    hasMore=Boolean(page.hasMore&&advanced&&page.messages.length);
    cursor=advanced?next:0;
    pages+=1;
  }
  data.messages=messages;
  data.nextCursor=cursor>0?cursor:null;
  data.hasMore=hasMore&&cursor>0;
}
async function openChatWithJoinData(roomId,secret,deviceId,data,key=null){
  const openToken=++chatOpenToken;
  chatViewReadyRoomId=null;
  state.roomId=roomId;
  state.secret=secret;
  if(key)state.key=key;
  if(state.key)roomKeyCache.set(roomId,{secret,key:state.key});
  state.me=data.participant;
  state.presence={};
  (data.participants||[]).forEach((item)=>{if(!item?.deviceId)return;state.presence[item.deviceId]={deviceId:item.deviceId,displayName:item.displayName,online:Boolean(item.online),lastSeenAt:item.lastSeenAt||null};});
  localStorage.setItem(STORAGE.lastSelectedRoomId,roomId);
  await hydrateHistoryForInitialPosition(roomId,deviceId,data).catch(()=>{});
  if(openToken!==chatOpenToken)return;
  const initialMessages=Array.isArray(data.messages)?data.messages:[];
  const loadedUnreadCount=initialMessages.filter((message)=>message?.sender_device_id!==deviceId&&message?.status!=='read').length;
  const serverUnreadCount=Number(data.unreadCount);
  const unreadCount=Number.isFinite(serverUnreadCount)&&serverUnreadCount>=0?Math.floor(serverUnreadCount):Math.max(loadedUnreadCount,state.chats.find((chat)=>chat.roomId===roomId)?.unread||0);
  const firstMessageId=Number(initialMessages[0]?.id);
  const nextCursor=Number(data.nextCursor);
  activeChatHistory={
    roomId,
    deviceId,
    oldestMessageId:Number.isSafeInteger(firstMessageId)&&firstMessageId>0?firstMessageId:null,
    nextCursor:Number.isSafeInteger(nextCursor)&&nextCursor>0?nextCursor:(Number.isSafeInteger(firstMessageId)&&firstMessageId>0?firstMessageId:null),
    hasMore:typeof data.hasMore==='boolean'?data.hasMore:initialMessages.length>=CHAT_HISTORY_PAGE_SIZE,
    loading:false,
    unreadCount,
    unloadedUnreadCount:Math.max(0,unreadCount-loadedUnreadCount),
    firstUnreadMessageId:Number.isSafeInteger(Number(data.firstUnreadMessageId))&&Number(data.firstUnreadMessageId)>0?Number(data.firstUnreadMessageId):null,
    loadedMessageIds:new Set(initialMessages.map((message)=>Number(message?.id)).filter((id)=>Number.isSafeInteger(id)&&id>0))
  };
  const last=initialMessages[initialMessages.length-1];
  const historyPatch={unread:unreadCount};
  if(last){historyPatch.lastActivity=last.created_at; const existing=state.chats.find(c=>c.roomId===roomId); if(!existing?.lastSender){historyPatch.lastSender=last.sender_name||'';}}
  upsertChat(roomId,historyPatch);
  const latestMessageId=Number(last?.id);
  if(Number.isSafeInteger(latestMessageId)&&latestMessageId>0)lastKnownMessageIdByRoom.set(roomId,latestMessageId);
  syncRoomPushSubscription(roomId).catch(()=>{});
  showContentPane();
  els.appRoot?.classList.add('mobile-chat');
  await renderChatView(initialMessages,deviceId,data.viewState||null);
  if(openToken!==chatOpenToken)return;
  chatViewReadyRoomId=roomId;
  await flushBufferedRoomMessages(roomId,deviceId);
  void ensureStableWsConnected(deviceId);
  setActiveNav('chats');
  renderChats();
}

async function joinByInviteText(text){
  const parsed=parseInviteInput(text);
  if(parsed?.error==='empty'){alert('Вставьте invite-ссылку');return false;}
  if(parsed?.error==='old_invite'){alert('Старая invite-ссылка больше не поддерживается. Попросите новую ссылку.');return false;}
  if(parsed?.error==='invalid'){alert('Некорректная invite-ссылка');return false;}
  if(!parsed?.inviteCode){alert('Некорректная invite-ссылка');return false;}
  state.nick=localStorage.getItem(STORAGE.nick)||state.nick;
  const displayName=state.nick;
  const deviceId=getOrCreateDeviceId();
  let res;
  try{
    res=await fetch(`/api/invites/${parsed.inviteCode}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName,deviceId})});
  }catch{
    alert('Не удалось подключиться. Проверьте соединение.');
    return false;
  }
  if(res.status===404){alert('Invite-ссылка недействительна.');return false;}
  if(res.status===410){alert('Invite-ссылка устарела или уже использована.');return false;}
  if(res.status===409){const errorData=await res.json().catch(()=>null);alert(errorData?.error==='device already belongs to room'?'Это устройство уже подключено к этому чату.':'В этот чат уже присоединился второй участник.');return false;}
  if(res.status===403){alert('Нет доступа к этому чату.');return false;}
  if(!res.ok){alert('Не удалось подключиться. Проверьте соединение.');return false;}
  const data=await res.json().catch(()=>null);
  if(!data?.ok||!data.publicId||!data.roomSecret||!Array.isArray(data.messages)){alert('Не удалось подключиться. Проверьте соединение.');return false;}
  let key;
  try{key=await deriveKey(data.roomSecret);}catch{alert('Не удалось подключиться. Проверьте соединение.');return false;}
  if(data.messages.length>0){
    let decryptedAny=false;
    for(const msg of data.messages){
      try{await crypto.subtle.decrypt({name:'AES-GCM',iv:b64.decode(msg.iv)},key,b64.decode(msg.ciphertext));decryptedAny=true;break;}catch{}
    }
    if(!decryptedAny){alert('Не удалось подключиться. Проверьте соединение.');return false;}
  }
  STORAGE.set(STORAGE.roomState(data.publicId),{secret:data.roomSecret,deviceId});
  upsertChat(data.publicId,{});
  state.key=key;
  let joinedRecoveryCode=null;
  let recoveryRegistrationFailed=false;
  try{joinedRecoveryCode=await registerRecoveryForJoinedParticipant(data.publicId,deviceId,data.roomSecret);}catch{recoveryRegistrationFailed=true;}
  await openChatWithJoinData(data.publicId,data.roomSecret,deviceId,data,key);
  if(joinedRecoveryCode){showRecoveryCodeModal(joinedRecoveryCode);}else if(recoveryRegistrationFailed){alert('Чат подключён, но recovery-код не был создан. Перезайдите или создайте новый чат.');}
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
  await openChatWithJoinData(roomId,persisted.secret,deviceId,data);
}
function deliveryIcon(s){if(s==='read')return "<span style='color:#3390ec'>✓✓</span>"; if(s==='delivered')return "<span style='color:#9aa0a6'>✓✓</span>"; if(s==='sent')return '✓'; return '⏳';}
function isMessagesAtBottom(){const box=document.getElementById('messages');if(!box)return true;return box.scrollTop+box.clientHeight>=box.scrollHeight-40;}
function queueReadIds(roomId,deviceId,messageIds){if(!roomId||!deviceId||!Array.isArray(messageIds)||!messageIds.length)return;const ids=messageIds.map(Number).filter((id)=>Number.isInteger(id)&&id>0);if(!ids.length)return;if(!pendingReadQueue.has(roomId)){pendingReadQueue.set(roomId,{deviceId,ids:new Set(),sentAt:0,retryTimer:null});}const entry=pendingReadQueue.get(roomId);entry.deviceId=deviceId;entry.sentAt=0;clearTimeout(entry.retryTimer);entry.retryTimer=null;ids.forEach((id)=>entry.ids.add(id));}
function flushPendingReads(roomId=state.roomId,deviceId=activeChatDeviceId){if(!roomId||!deviceId)return false;const entry=pendingReadQueue.get(roomId);if(!entry||!entry.ids?.size)return true;const wsDeviceId=state.ws?.deviceId;if(!state.ws||state.ws.readyState!==WebSocket.OPEN||wsDeviceId!==deviceId){return false;}if(entry.sentAt&&Date.now()-entry.sentAt<1000)return true;const messageIds=[...entry.ids].map(Number).filter((id)=>Number.isInteger(id)&&id>0);if(!messageIds.length){clearTimeout(entry.retryTimer);pendingReadQueue.delete(roomId);return true;}try{state.ws.send(JSON.stringify({type:'message:read:bulk',roomId,messageIds}));entry.sentAt=Date.now();clearTimeout(entry.retryTimer);const sentAt=entry.sentAt;entry.retryTimer=setTimeout(()=>{const current=pendingReadQueue.get(roomId);if(current===entry&&entry.sentAt===sentAt){entry.sentAt=0;flushPendingReads(roomId,entry.deviceId);}},1500);return true;}catch{entry.sentAt=0;clearTimeout(entry.retryTimer);entry.retryTimer=null;return false;}}
function queueReceivedMessageIds(roomId,deviceId,messageIds){if(!roomId||!deviceId||!Array.isArray(messageIds)||!messageIds.length)return;const ids=messageIds.map(Number).filter((id)=>Number.isSafeInteger(id)&&id>0);if(!ids.length)return;if(!pendingReceivedQueue.has(roomId))pendingReceivedQueue.set(roomId,{deviceId,ids:new Set()});const entry=pendingReceivedQueue.get(roomId);entry.deviceId=deviceId;ids.forEach((id)=>entry.ids.add(id));}
function clearReceivedMessageIds(roomId,messageIds){const entry=pendingReceivedQueue.get(roomId);if(!entry||!Array.isArray(messageIds))return;messageIds.map(Number).filter((id)=>Number.isSafeInteger(id)&&id>0).forEach((id)=>entry.ids.delete(id));if(!entry.ids.size)pendingReceivedQueue.delete(roomId);}
function flushPendingReceived(roomId=state.roomId,deviceId=activeChatDeviceId){if(!roomId||!deviceId)return false;const entry=pendingReceivedQueue.get(roomId);if(!entry?.ids?.size)return true;const ws=state.ws;if(!ws||ws.readyState!==WebSocket.OPEN||ws.deviceId!==deviceId)return false;const messageIds=[...entry.ids].map(Number).filter((id)=>Number.isSafeInteger(id)&&id>0);if(!messageIds.length){pendingReceivedQueue.delete(roomId);return true;}try{const payload=messageIds.length===1?{type:'message:received',roomId,messageId:messageIds[0]}:{type:'message:received:bulk',roomId,messageIds};ws.send(JSON.stringify(payload));pendingReceivedQueue.delete(roomId);return true;}catch{return false;}}
function markMessagesReceived(roomId,deviceId,messageIds){if(!roomId||!deviceId||!Array.isArray(messageIds)||!messageIds.length)return false;queueReceivedMessageIds(roomId,deviceId,messageIds);const flushed=flushPendingReceived(roomId,deviceId);if(!flushed){ensureStableWsConnected(deviceId).then(()=>{flushPendingReceived(roomId,deviceId);}).catch(()=>{});}return flushed;}
function markIncomingMessagesRead(roomId,deviceId,messageIds){if(!roomId||!deviceId||!Array.isArray(messageIds)||!messageIds.length)return false;const ids=[...new Set(messageIds.map(Number).filter((id)=>Number.isInteger(id)&&id>0))];if(!ids.length)return false;queueReadIds(roomId,deviceId,ids);const flushed=flushPendingReads(roomId,deviceId);if(!flushed){ensureWsConnected(deviceId).then(()=>{flushPendingReads(roomId,deviceId);}).catch(()=>{});}return flushed;}function formatUnreadLabel(count){if(count===1)return '1 новое сообщение ↓';if(count>=2&&count<=4)return `${count} новых сообщения ↓`;return `${count} новых сообщений ↓`;}
function renderNewMessagesPill(count){const pill=document.getElementById('newMessagesPill');if(!pill)return;const unreadCount=Number(count)||0;if(isMessagesAtBottom()){pill.classList.add('hidden');pill.textContent='';return;}pill.textContent=unreadCount>0?formatUnreadLabel(unreadCount):'Вниз ↓';pill.classList.remove('hidden');}
function recomputePendingUnread(){const unreadEls=[...document.querySelectorAll('.bubble-wrap[data-incoming="1"][data-read="0"]')];pendingIncomingReadIds=unreadEls.map(el=>Number(el.dataset.messageId||el.dataset.id)).filter(id=>Number.isInteger(id)&&id>0);pendingIncomingReadIds=[...new Set(pendingIncomingReadIds)];return pendingIncomingReadIds.length;}
function markReplyTargetRead(messageId){markMessageRead(messageId);}
function updateUnreadIndicators(){const box=document.getElementById('messages');if(!box||!state.roomId)return;const loadedCount=recomputePendingUnread();const unloadedCount=activeChatHistory?.roomId===state.roomId?Math.max(0,Number(activeChatHistory.unloadedUnreadCount)||0):0;const count=loadedCount+unloadedCount;const atBottom=isMessagesAtBottom();const visibleCount=unloadedCount>0?count:(atBottom?0:loadedCount);renderNewMessagesPill(visibleCount);upsertChat(state.roomId,{unread:visibleCount});renderChats();updateUnreadPresentation();}
function observeUnreadMessage(el){if(initialMessagesScrollPending||!el||!unreadVisibleObserver)return;if(el.dataset.incoming!=='1'||el.dataset.read!=='0')return;unreadVisibleObserver.observe(el);}
function resumeUnreadObservation(box){initialMessagesScrollPending=false;if(!box||!unreadVisibleObserver)return;unreadVisibleObserver.disconnect();box.querySelectorAll('.bubble-wrap[data-incoming="1"][data-read="0"]').forEach((el)=>observeUnreadMessage(el));}
function markMessageRead(messageId){const id=Number(messageId);if(!id||!state.roomId||!activeChatDeviceId)return;if(document.visibilityState!=='visible')return;const box=document.getElementById('messages');const msgEl=box?.querySelector(`.msg[data-message-id="${id}"], .msg[data-id="${id}"]`);if(!msgEl)return;if(msgEl.dataset.incoming!=='1')return;if(msgEl.dataset.read==='1')return;msgEl.dataset.read='1';unreadVisibleObserver?.unobserve(msgEl);pendingIncomingReadIds=pendingIncomingReadIds.filter((x)=>Number(x)!==id);markIncomingMessagesRead(state.roomId,activeChatDeviceId,[id]);recomputePendingUnread();updateUnreadIndicators();updateReplyComposerBar();}
let wsConnectStartedAt=0;let wsConnectInFlight=null;
function sendClientState(){
  if(!state.ws||state.ws.readyState!==WebSocket.OPEN)return;
  state.ws.send(JSON.stringify({type:'client:state',activeRoomId:state.roomId||null,visible:document.visibilityState==='visible'}));
}
function ensureWsConnected(deviceId,timeoutMs=1800){if(!deviceId)return Promise.resolve(false);const hasCorrectOpenWs=state.ws&&state.ws.readyState===WebSocket.OPEN&&state.ws.deviceId===deviceId;if(hasCorrectOpenWs){setLocalConnectionState('connected');return Promise.resolve(true);}const hasWrongDeviceWs=state.ws&&state.ws.readyState===WebSocket.OPEN&&state.ws.deviceId!==deviceId;const hasWrongConnectingWs=state.ws&&state.ws.readyState===WebSocket.CONNECTING&&state.ws.deviceId!==deviceId;const isStaleConnecting=state.ws&&state.ws.readyState===WebSocket.CONNECTING&&Date.now()-wsConnectStartedAt>timeoutMs;if(!state.ws||state.ws.readyState===WebSocket.CLOSING||state.ws.readyState===WebSocket.CLOSED||hasWrongDeviceWs||hasWrongConnectingWs||isStaleConnecting){setLocalConnectionState('connecting');if(state.ws){try{state.ws.close();}catch{}}connectWs(deviceId);}if(wsConnectInFlight)return wsConnectInFlight;wsConnectInFlight=new Promise((resolve)=>{const ws=state.ws;if(!ws){wsConnectInFlight=null;resolve(false);return;}if(ws.readyState===WebSocket.OPEN){wsConnectInFlight=null;resolve(state.ws===ws&&ws.deviceId===deviceId);return;}const done=(ok)=>{clearTimeout(timer);ws.removeEventListener('open',onOpen);ws.removeEventListener('error',onFail);ws.removeEventListener('close',onFail);if(wsConnectInFlight===promiseRef)wsConnectInFlight=null;resolve(ok&&state.ws===ws&&ws.readyState===WebSocket.OPEN&&ws.deviceId===deviceId);};const onOpen=()=>done(true);const onFail=()=>done(false);const timer=setTimeout(()=>done(false),timeoutMs);const promiseRef=wsConnectInFlight;ws.addEventListener('open',onOpen,{once:true});ws.addEventListener('error',onFail,{once:true});ws.addEventListener('close',onFail,{once:true});});return wsConnectInFlight;}
function waitForNextAnimationFrame(){return new Promise((resolve)=>requestAnimationFrame(resolve));}
function isCurrentMessagesBox(box){return Boolean(box&&document.getElementById('messages')===box&&activeChatHistory?.roomId===state.roomId);}
function getFirstUnreadMessageElement(box){return box?.querySelector('.bubble-wrap[data-incoming="1"][data-read="0"]')||null;}
function getViewStateMessageElement(box,viewState){const anchorId=Number(viewState?.anchorMessageId);if(!box||!Number.isInteger(anchorId)||anchorId<=0)return null;return box.querySelector(`.msg[data-message-id="${anchorId}"], .msg[data-id="${anchorId}"]`);}
function scrollMessagesToBottom(box){if(!box)return;requestAnimationFrame(()=>{requestAnimationFrame(()=>{if(isCurrentMessagesBox(box))box.scrollTop=box.scrollHeight;});});}
function scrollToFirstUnread(box=document.getElementById('messages')){const firstUnread=getFirstUnreadMessageElement(box);if(!firstUnread||!isCurrentMessagesBox(box))return false;const boxRect=box.getBoundingClientRect();const targetRect=firstUnread.getBoundingClientRect();const targetOffset=targetRect.top-boxRect.top-(box.clientHeight-targetRect.height)/2;box.scrollTop=Math.max(0,box.scrollTop+targetOffset);return true;}

let viewStateSaveTimer=null;
function getFirstVisibleMessageAnchor(box){if(!box)return null;const messages=[...box.querySelectorAll('.msg[data-message-id]')];if(!messages.length)return null;const boxTop=box.getBoundingClientRect().top;let fallback=null;for(const el of messages){const rect=el.getBoundingClientRect();const id=Number(el.dataset.messageId||el.dataset.id);if(!Number.isInteger(id)||id<=0)continue;if(!fallback)fallback={anchorMessageId:id,anchorOffsetPx:Math.round(rect.top-boxTop)};if(rect.bottom>=boxTop){return {anchorMessageId:id,anchorOffsetPx:Math.round(rect.top-boxTop)};}}return fallback;}
function scheduleViewStateSave(){if(!state.roomId)return;clearTimeout(viewStateSaveTimer);viewStateSaveTimer=setTimeout(()=>{void saveViewStateNow();},VIEW_STATE_SAVE_DEBOUNCE_MS);}
async function saveViewStateNow({keepalive=false}={}){const roomId=state.roomId;const persisted=STORAGE.get(STORAGE.roomState(roomId));const box=document.getElementById('messages');if(!roomId||!persisted?.deviceId||!box)return;const anchor=getFirstVisibleMessageAnchor(box);if(!anchor?.anchorMessageId)return;await fetch(`/api/rooms/${roomId}/view-state`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:persisted.deviceId,anchorMessageId:anchor.anchorMessageId,anchorOffsetPx:anchor.anchorOffsetPx}),keepalive:Boolean(keepalive)}).catch(()=>{});}
let lastLifecycleViewStateSaveAt=0;
function saveViewStateForLifecycle(){const now=Date.now();if(now-lastLifecycleViewStateSaveAt<500)return;lastLifecycleViewStateSaveAt=now;if(viewStateSaveTimer){clearTimeout(viewStateSaveTimer);viewStateSaveTimer=null;}void saveViewStateNow({keepalive:true});}
function restoreMessagesViewState(box,viewState){const target=getViewStateMessageElement(box,viewState);if(!target||!isCurrentMessagesBox(box))return false;const offset=Number(viewState?.anchorOffsetPx)||0;const boxTop=box.getBoundingClientRect().top;const targetTop=target.getBoundingClientRect().top;box.scrollTop+=targetTop-boxTop-offset;return true;}
async function applyInitialMessagesScroll(box,viewState){
  if(!isCurrentMessagesBox(box))return 'cancelled';
  await waitForNextAnimationFrame();
  await waitForNextAnimationFrame();
  if(!isCurrentMessagesBox(box))return 'cancelled';
  const hasUnread=recomputePendingUnread()>0||Number(activeChatHistory?.unloadedUnreadCount)>0;
  if(hasUnread&&scrollToFirstUnread(box))return 'unread';
  if(!hasUnread&&restoreMessagesViewState(box,viewState))return 'restored';
  box.scrollTop=box.scrollHeight;
  return 'bottom';
}

function getHistoryMessageId(message){const id=Number(message?.id);return Number.isSafeInteger(id)&&id>0?id:null;}
function setHistoryLoader(loading,message=''){const loader=document.getElementById('historyLoader');if(!loader)return;loader.textContent=loading?'Загрузка истории…':message;loader.classList.toggle('hidden',!loading&&!message);}
function rebuildDateSeparators(box){if(!box)return;box.querySelectorAll('.date-sep').forEach((separator)=>separator.remove());let lastDayKey='';const messages=[...box.querySelectorAll('.bubble-wrap.msg[data-message-id]')];for(const message of messages){const dayKey=getLocalDayKey(message.dataset.createdAt);if(!dayKey||dayKey===lastDayKey)continue;const separator=document.createElement('div');separator.className='date-sep';separator.textContent=formatDateSeparator(message.dataset.createdAt);box.insertBefore(separator,message);lastDayKey=dayKey;}box.dataset.lastDayKey=lastDayKey;}
function refreshReplyBlocks(box){if(!box)return;box.querySelectorAll('.reply-block[data-reply-message-id]').forEach((block)=>{const meta=getMessageReplyMeta(block.dataset.replyMessageId);const author=block.querySelector('.reply-block-author');const preview=block.querySelector('.reply-block-preview');if(author)author.textContent=meta.author||'Неизвестно';if(preview)preview.textContent=meta.preview||'Сообщение недоступно';});}
async function appendOlderMessages(box,messages,deviceId,history){const known=new Set(history.loadedMessageIds||[]);const unique=[];for(const message of Array.isArray(messages)?messages:[]){const id=getHistoryMessageId(message);if(!id||known.has(id))continue;known.add(id);unique.push({...message,status:getEffectiveMessageStatus(history.roomId,message)});}if(!unique.length)return{added:0,unreadCount:0,beforeTop:box.scrollTop,beforeHeight:box.scrollHeight};const scratch=document.createElement('div');for(const message of unique){if(activeChatHistory!==history||state.roomId!==history.roomId)return{added:0,unreadCount:0,beforeTop:box.scrollTop,beforeHeight:box.scrollHeight};const text=await decryptText(message.iv,message.ciphertext).catch(()=> '[cannot decrypt]');appendMessage(scratch,message,text,message.sender_device_id===deviceId,false);}if(activeChatHistory!==history||state.roomId!==history.roomId||document.getElementById('messages')!==box)return{added:0,unreadCount:0,beforeTop:box.scrollTop,beforeHeight:box.scrollHeight};const beforeTop=box.scrollTop;const beforeHeight=box.scrollHeight;const fragment=document.createDocumentFragment();while(scratch.firstChild)fragment.appendChild(scratch.firstChild);const firstMessage=box.querySelector('.bubble-wrap.msg[data-message-id]');box.insertBefore(fragment,firstMessage||null);history.loadedMessageIds=known;rebuildDateSeparators(box);refreshReplyBlocks(box);unique.forEach((message)=>{const element=findMessageElement(message.id);if(element)observeUnreadMessage(element);});const receivedIds=unique.filter((message)=>message.sender_device_id!==deviceId&&message.status==='sent').map((message)=>Number(message.id));if(receivedIds.length)markMessagesReceived(history.roomId,deviceId,receivedIds);const unreadCount=unique.filter((message)=>message.sender_device_id!==deviceId&&message.status!=='read').length;return{added:unique.length,unreadCount,beforeTop,beforeHeight};}
async function loadOlderMessages(){const history=activeChatHistory;const box=document.getElementById('messages');if(!history||!box||history.roomId!==state.roomId||history.loading||!history.hasMore)return false;const cursor=Number(history.nextCursor);if(!Number.isSafeInteger(cursor)||cursor<=0){history.hasMore=false;return false;}history.loading=true;setHistoryLoader(true);try{const persisted=STORAGE.get(STORAGE.roomState(history.roomId));const deviceId=persisted?.deviceId||history.deviceId;const params=new URLSearchParams({deviceId:String(deviceId),limit:String(CHAT_HISTORY_PAGE_SIZE),before:String(cursor)});const response=await fetch(`/api/rooms/${encodeURIComponent(history.roomId)}/messages?${params.toString()}`,{cache:'no-store'});if(!response.ok)throw new Error(`history request failed: ${response.status}`);const data=await response.json().catch(()=>null);if(!data||!Array.isArray(data.messages))throw new Error('invalid history response');if(activeChatHistory!==history||state.roomId!==history.roomId)return false;const result=await appendOlderMessages(box,data.messages,deviceId,history);if(activeChatHistory!==history||state.roomId!==history.roomId)return false;const previousCursor=cursor;const next=Number(data.nextCursor);const cursorAdvanced=Number.isSafeInteger(next)&&next>0&&next<previousCursor;const serverHasMore=typeof data.hasMore==='boolean'?data.hasMore:data.messages.length>=CHAT_HISTORY_PAGE_SIZE;history.nextCursor=cursorAdvanced?next:null;history.oldestMessageId=cursorAdvanced?next:(history.oldestMessageId||null);history.hasMore=Boolean(serverHasMore&&cursorAdvanced&&data.messages.length);const loader=document.getElementById('historyLoader');const loaderHeight=loader&&!loader.classList.contains('hidden')?loader.getBoundingClientRect().height:0;setHistoryLoader(false);if(result.added>0||loaderHeight>0){const afterHeight=box.scrollHeight;box.scrollTop=Math.max(0,result.beforeTop+afterHeight-result.beforeHeight+loaderHeight);if(result.added>0)scheduleViewStateSave();}history.unloadedUnreadCount=Math.max(0,history.unloadedUnreadCount-result.unreadCount);updateUnreadIndicators();if(!result.added&&!cursorAdvanced)history.hasMore=false;return result.added>0;}catch(error){if(activeChatHistory===history)setHistoryLoader(false);console.warn('Failed to load older messages',error);return false;}finally{if(activeChatHistory===history)history.loading=false;}}
async function loadHistoryUntilMessage(messageId){const wanted=Number(messageId);if(!Number.isSafeInteger(wanted)||wanted<=0)return null;let target=findMessageElement(wanted);while(!target&&activeChatHistory?.roomId===state.roomId&&activeChatHistory.hasMore){const cursorBefore=activeChatHistory.nextCursor;const added=await loadOlderMessages();target=findMessageElement(wanted);if(!added&&activeChatHistory.nextCursor===cursorBefore)break;}return target;}

function autoResizeMessageInput(input){if(!input)return;const lineHeight=parseFloat(getComputedStyle(input).lineHeight)||22;const maxHeight=lineHeight*4;input.style.height=`${lineHeight}px`;const nextHeight=Math.min(input.scrollHeight,maxHeight);input.style.height=`${Math.max(lineHeight,nextHeight)}px`;input.style.overflowY=input.scrollHeight>maxHeight?'auto':'hidden';}
async function renderChatView(messages,deviceId,viewState=null){messages=Array.isArray(messages)?messages:[];activeChatDeviceId=deviceId;pendingIncomingReadIds=[];initialMessagesScrollPending=true;messageCache.clear();if(unreadVisibleObserver){unreadVisibleObserver.disconnect();unreadVisibleObserver=null;}els.content.innerHTML=`<div class='chat-view'><div class='chat-header'><div><strong>${safeText(state.roomNames[state.roomId]||`Комната ${shortId(state.roomId)}`)}</strong><div id='presenceLine' class='presence-line'></div><div id='connectionWarning' class='connection-warning hidden'></div></div><div class='chat-header-actions'><button id='backMob' class='mobile-only btn btn-icon' aria-label='Назад'>←</button><button id='reloadBtn' class='btn btn-icon' aria-label='Обновить'>↻</button><button id='menuBtn' class='btn btn-icon' aria-label='Меню чата'>⋮</button></div></div><div class='messages' id='messages'></div><button id='newMessagesPill' class='new-messages-pill hidden' type='button'></button><div id='replyComposerBar' class='reply-composer-bar hidden'></div><form class='send composer' id='sendForm'><button class='composer-icon composer-attach' type='button' aria-label='Вложения'><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M16.5 6.5l-7.8 7.8a3 3 0 104.2 4.2l8.1-8.1a5 5 0 10-7.1-7.1L5.6 11.6a7 7 0 109.9 9.9l6.4-6.4'/></svg></button><div class='composer-input-wrap'><textarea id='msgInput' placeholder='Сообщение'></textarea><button class='composer-emoji' type='button' aria-label='Emoji'><svg viewBox='0 0 24 24' aria-hidden='true'><circle cx='12' cy='12' r='9'/><path d='M8.5 10h.01M15.5 10h.01M8.5 14.5c1 1.2 2.1 1.8 3.5 1.8s2.5-.6 3.5-1.8'/></svg></button></div><button id='sendBtn' class='btn-send composer-send' type='submit' disabled>➤</button><input id='mediaFileInput' type='file' accept='image/*,video/*' multiple hidden></form></div><div id='mediaPreviewRoot'></div>`; document.getElementById('backMob')?.addEventListener('click',()=>showChatsList()); document.getElementById('reloadBtn').onclick=()=>window.location.reload(); document.getElementById('menuBtn').onclick=(e)=>{e.preventDefault();e.stopPropagation();const rect=e.currentTarget.getBoundingClientRect();showRoomMenu(state.roomId,rect.right,rect.bottom+6)};setupChatBackSwipe(document.querySelector('.chat-view'));const box=document.getElementById('messages');box.dataset.lastDayKey=''; unreadVisibleObserver=new IntersectionObserver((entries)=>{if(document.visibilityState!=='visible')return;if(!state.roomId)return;entries.forEach((entry)=>{if(!entry.isIntersecting)return;const el=entry.target;if(el.dataset.incoming!=='1')return;if(el.dataset.read==='1')return;markMessageRead(el.dataset.messageId||el.dataset.id);unreadVisibleObserver?.unobserve(el);});},{root:box,threshold:0.2}); const receivedIds=messages.filter((message)=>message.sender_device_id!==deviceId&&message.status==='sent').map((message)=>Number(message.id)).filter((id)=>Number.isSafeInteger(id)&&id>0); for(const m of messages){appendDateSeparatorIfNeeded(box,m.created_at);const mine=m.sender_device_id===deviceId; const txt=await decryptText(m.iv,m.ciphertext).catch(()=>"[cannot decrypt]"); appendMessage(box,m,txt,mine,false);}if(receivedIds.length)markMessagesReceived(state.roomId,deviceId,receivedIds);recomputePendingUnread();updateUnreadIndicators();updateReplyComposerBar();
box.addEventListener('scroll',()=>{scheduleViewStateSave();recomputePendingUnread();updateUnreadIndicators();updateReplyComposerBar();});
document.getElementById('newMessagesPill').onclick=()=>{const firstUnread=document.querySelector('.msg[data-read="0"][data-incoming="1"]');if(firstUnread){firstUnread.scrollIntoView({behavior:'smooth',block:'center'});return;}scrollMessagesToBottom(document.getElementById('messages'));};
renderPresenceStatus();
const mediaFileInput=document.getElementById('mediaFileInput');const attachBtn=document.querySelector('.composer-attach');if(attachBtn&&mediaFileInput){attachBtn.onclick=(e)=>{e.preventDefault();mediaFileInput.click();};mediaFileInput.onchange=async()=>{const files=Array.from(mediaFileInput.files||[]);mediaFileInput.value='';if(!files.length)return;await openMediaPreviewFromFiles(files);};}const form=document.getElementById('sendForm'),input=document.getElementById('msgInput'),sendBtn=document.getElementById('sendBtn'); if(form&&input&&sendBtn){const syncSendBtn=()=>{sendBtn.disabled=!input.value.trim();}; input.addEventListener('input',()=>{syncSendBtn();autoResizeMessageInput(input);const draft=ensureDraftState(state.roomId);draft.text=input.value;scheduleDraftSave(state.roomId);renderChats();}); input.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}}); form.onsubmit=async(e)=>{e.preventDefault();const t=input.value.trim();if(!t)return;const ok=await ensureWsConnected(activeChatDeviceId);if(!ok||!state.ws||state.ws.readyState!==WebSocket.OPEN||state.ws.deviceId!==activeChatDeviceId){alert('Нет соединения. Попробуйте обновить чат.');return;}const enc=await encryptText(t);const draft=ensureDraftState(state.roomId);const replyToMessageId=draft.replyTo?.messageId||null;if(replyToMessageId){markReplyTargetRead(replyToMessageId);}const clientMessageId=crypto.randomUUID();const createdAt=new Date().toISOString();const outbound={type:'message:send',roomId:state.roomId,clientMessageId,...enc,notificationPreview:t.slice(0,80),replyToMessageId};const tempMessage={id:clientMessageId,client_message_id:clientMessageId,ciphertext:enc.ciphertext,iv:enc.iv,reply_to_message_id:replyToMessageId,status:'sending',created_at:createdAt,delivered_at:null,read_at:null,sender_name:state.nick,sender_device_id:activeChatDeviceId,type:'text',media:[]};const box=document.getElementById('messages');try{appendDateSeparatorIfNeeded(box,createdAt);appendMessage(box,tempMessage,t,true,true);upsertRoomMessage(state.roomId,tempMessage,{text:t,unread:0});if(!queuePendingTextSend(outbound))throw new Error('queue');}catch{alert('Не удалось отправить сообщение. Проверьте соединение.');return;}input.value='';draft.text='';draft.replyTo=null;updateReplyComposerBar();await clearDraftOnServer(state.roomId);syncSendBtn();autoResizeMessageInput(input);}; syncSendBtn();autoResizeMessageInput(input);await loadDraftForCurrentRoom();syncSendBtn();}}function buildMediaFallbackText(media=[],caption=''){const c=String(caption||'').trim();if(c)return c;if(media.length===1)return media[0]?.media_kind==='video'?'Видео':'Фото';if(media.length>1)return'Альбом';return'Медиа';}
async function fetchMediaThumbUrl(media){const persisted=STORAGE.get(STORAGE.roomState(state.roomId));if(!persisted?.deviceId||!media?.public_id)return'';try{const r=await fetch(`/api/media/${media.public_id}/thumb?deviceId=${encodeURIComponent(persisted.deviceId)}`);if(!r.ok)throw new Error('thumb');const enc=await r.blob();const dec=await decryptBlobWithIvPrefix(enc,'image/webp');return URL.createObjectURL(dec);}catch{return'';}}
function openMediaViewer(messageMedia,startIndex=0){mediaViewerState={messageMedia,index:startIndex,loaded:new Map()};renderMediaViewer();}
function renderMediaViewer(){const root=document.getElementById('mediaViewerRoot')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'mediaViewerRoot'}));const v=mediaViewerState;if(!v){root.innerHTML='';return;}const m=v.messageMedia[v.index];root.innerHTML=`<div class="media-viewer-overlay"><button class="media-viewer-close" type="button">×</button><div class="media-viewer-content"><div class="media-progress-ring">Загрузка...</div></div>${v.messageMedia.length>1?'<button class="media-viewer-nav prev">←</button><button class="media-viewer-nav next">→</button>':''}</div>`;root.querySelector('.media-viewer-overlay').onclick=(e)=>{if(e.target.classList.contains('media-viewer-overlay')){mediaViewerState=null;renderMediaViewer();}};root.querySelector('.media-viewer-close').onclick=()=>{mediaViewerState=null;renderMediaViewer();};root.querySelector('.prev')?.addEventListener('click',(e)=>{e.stopPropagation();if(v.index>0){v.index--;renderMediaViewer();}});root.querySelector('.next')?.addEventListener('click',(e)=>{e.stopPropagation();if(v.index<v.messageMedia.length-1){v.index++;renderMediaViewer();}});loadViewerMedia(m,root.querySelector('.media-viewer-content'));}
async function loadViewerMedia(media,container){try{const persisted=STORAGE.get(STORAGE.roomState(state.roomId));const res=await fetch(`/api/media/${media.public_id}/blob?deviceId=${encodeURIComponent(persisted.deviceId)}`);if(!res.ok)throw new Error('load');const enc=await res.blob();const plain=await decryptBlobWithIvPrefix(enc,media.mime_type);const url=URL.createObjectURL(plain);container.innerHTML=media.media_kind==='video'?`<video controls autoplay src="${url}"></video>`:`<img src="${url}" alt="media">`;}catch{container.innerHTML='<div class="media-error-box">Не удалось загрузить медиа <button type="button" class="btn btn-secondary">Повторить</button></div>';container.querySelector('button')?.addEventListener('click',()=>loadViewerMedia(media,container));}}
function appendMessage(box,m,txt,mine,autoScroll=true){const w=document.createElement('div');w.className=`bubble-wrap msg ${mine?'mine':''}`;const isIncoming=!mine;const isRead=mine?1:(m.status==='read'?1:0);w.dataset.id=m.id;w.dataset.createdAt=m.created_at;w.dataset.messageId=String(m.id);w.dataset.incoming=isIncoming?'1':'0';w.dataset.read=String(isRead);const replyMeta=m.reply_to_message_id?getMessageReplyMeta(m.reply_to_message_id):null;const replyHtml=replyMeta?`<button type="button" class="reply-block" data-reply-message-id="${replyMeta.messageId}"><div class="reply-block-author">${safeText(replyMeta.author)}</div><div class="reply-block-preview">${safeText(replyMeta.preview)}</div></button>`:'';const isMedia=m.type==='media';const mediaList=Array.isArray(m.media)?m.media:[];const caption=(txt||'').trim();const captionHtml=caption?`<div class="message-text">${safeText(caption)}</div>`:'';const mediaGridClass=mediaList.length===1?'one':(mediaList.length<=4?'few':'many');const contentHtml=isMedia?`<div class="media-grid ${mediaGridClass}">${mediaList.map((item,idx)=>`<button type="button" class="media-tile" data-media-index="${idx}"><img class="media-thumb" alt="media"><span class="media-video-badge ${item.media_kind==='video'?'':'hidden'}">▶</span></button>`).join('')}</div>${captionHtml}`:`<div class="message-text">${safeText(txt)}</div>`;w.innerHTML=`<div class='bubble'><div><b>${safeText(m.sender_name)}</b></div>${replyHtml}${contentHtml}<div class='meta'>${formatMessageTime(m.created_at)} ${mine?deliveryIcon(m.status):''}</div></div>`;w.querySelector('.reply-block')?.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();const id=Number(e.currentTarget.dataset.replyMessageId);void findAndFocusReplyMessage(id);});w.addEventListener('contextmenu',(e)=>{e.preventDefault();e.stopPropagation();showMessageReplyMenu(m.id,e.clientX,e.clientY);});const bubble=w.querySelector('.bubble');const swipeIcon=document.createElement('div');swipeIcon.className='swipe-reply-icon';swipeIcon.textContent='↩';w.appendChild(swipeIcon);let touchStartX=0,touchStartY=0,currentDx=0,tracking=false;w.addEventListener('touchstart',(e)=>{if(e.touches.length!==1||!bubble)return;const t=e.touches[0];touchStartX=t.clientX;touchStartY=t.clientY;currentDx=0;tracking=true;w.classList.remove('swipe-reset');w.classList.add('swiping');bubble.style.transform='';},{passive:true});w.addEventListener('touchmove',(e)=>{if(!tracking||e.touches.length!==1||!bubble)return;const t=e.touches[0];const dx=t.clientX-touchStartX;const dy=t.clientY-touchStartY;if(Math.abs(dy)>Math.abs(dx)){tracking=false;bubble.style.transform='';w.classList.remove('swiping');return;}if(dx>=0){currentDx=0;bubble.style.transform='';return;}currentDx=Math.max(-110,dx);bubble.style.transform=`translateX(${currentDx}px)`;const progress=Math.min(1,Math.abs(currentDx)/SWIPE_REPLY_THRESHOLD);swipeIcon.style.opacity=String(Math.max(0.12,progress));swipeIcon.style.transform=`translateY(-50%) scale(${0.8+progress*0.2})`;},{passive:true});const finishSwipe=()=>{if(!bubble)return;const shouldReply=tracking&&Math.abs(currentDx)>=SWIPE_REPLY_THRESHOLD;w.classList.remove('swiping');w.classList.add('swipe-reset');bubble.style.transform='';swipeIcon.style.opacity='';swipeIcon.style.transform='';tracking=false;currentDx=0;setTimeout(()=>w.classList.remove('swipe-reset'),180);if(shouldReply){setSelectedReply(state.roomId,getMessageReplyMeta(m.id));navigator.vibrate?.(10);}};w.addEventListener('touchend',finishSwipe);w.addEventListener('touchcancel',finishSwipe);if(isMedia){w.querySelectorAll('.media-tile').forEach(async(el)=>{const idx=Number(el.dataset.mediaIndex);const item=mediaList[idx];const img=el.querySelector('img');const u=await fetchMediaThumbUrl(item);if(u)img.src=u;el.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();if(w.dataset.incoming==='1'&&w.dataset.read!=='1'){markMessageRead(m.id);}openMediaViewer(mediaList,idx);});});}box.appendChild(w);const previewText=isMedia?buildMediaFallbackText(mediaList,caption):txt==='[cannot decrypt]'?'Сообщение недоступно':makeReplyPreview(txt);messageCache.set(Number(m.id),{id:Number(m.id),author:m.sender_name,text:isMedia?caption:txt,preview:previewText,kind:isMedia?'media':'text'});if(isIncoming&&!isRead){if(!autoScroll){pendingIncomingReadIds.push(Number(m.id));}observeUnreadMessage(w);}if(autoScroll)box.scrollTop=box.scrollHeight;}
const renderChatViewWithoutLazyHistory=renderChatView;
renderChatView=async function renderChatViewWithLazyHistory(messages,deviceId,viewState=null){
  await renderChatViewWithoutLazyHistory(messages,deviceId,viewState);
  const box=document.getElementById('messages');
  if(!box||activeChatHistory?.roomId!==state.roomId)return;
  const loader=document.createElement('div');
  loader.id='historyLoader';
  loader.className='history-loader hidden';
  loader.setAttribute('role','status');
  loader.setAttribute('aria-live','polite');
  box.insertBefore(loader,box.firstChild||null);
  const initialScrollMode=await applyInitialMessagesScroll(box,viewState);
  if(initialScrollMode!=='cancelled'){
    resumeUnreadObservation(box);
    updateUnreadIndicators();
    updateReplyComposerBar();
  }
  box.addEventListener('scroll',()=>{if(box.scrollTop<=CHAT_HISTORY_LOAD_THRESHOLD_PX)void loadOlderMessages();},{passive:true});
};
const MESSAGE_STATUS_RANK=Object.freeze({sending:0,sent:1,delivered:2,read:3});
const liveMessageKeys=new Set();
function normalizeMessageStatus(value){const status=String(value||'sent');return Object.prototype.hasOwnProperty.call(MESSAGE_STATUS_RANK,status)?status:'sent';}
function messageStatusRank(value){return MESSAGE_STATUS_RANK[normalizeMessageStatus(value)];}
function strongerMessageStatus(current,next){const a=normalizeMessageStatus(current);const b=normalizeMessageStatus(next);return messageStatusRank(b)>messageStatusRank(a)?b:a;}
function messageStatusKey(roomId,messageId){if(roomId===null||roomId===undefined||messageId===null||messageId===undefined||String(messageId)==='')return'';return String(roomId)+':'+String(messageId);}
function rememberMessageStatus(roomId,messageId,status,clientMessageId=null){const normalized=normalizeMessageStatus(status);const keys=[messageStatusKey(roomId,messageId),messageStatusKey(roomId,clientMessageId)].filter(Boolean);const uniqueKeys=[...new Set(keys)];let strongest=normalized;uniqueKeys.forEach((key)=>{const current=messageStatusByKey.get(key);if(!current||messageStatusRank(normalized)>messageStatusRank(current))messageStatusByKey.set(key,normalized);strongest=strongerMessageStatus(strongest,messageStatusByKey.get(key));});return strongest;}
function getEffectiveMessageStatus(roomId,message){let strongest=normalizeMessageStatus(message?.status);const keys=[messageStatusKey(roomId,message?.id),messageStatusKey(roomId,message?.client_message_id)].filter(Boolean);keys.forEach((key)=>{if(messageStatusByKey.has(key))strongest=strongerMessageStatus(strongest,messageStatusByKey.get(key));});return strongest;}
function findMessageElement(messageId,clientMessageId=null){const values=new Set([messageId,clientMessageId].filter((value)=>value!==null&&value!==undefined&&String(value)!=='').map(String));if(!values.size)return null;return [...document.querySelectorAll('.bubble-wrap.msg')].find((el)=>values.has(String(el.dataset.messageId||''))||values.has(String(el.dataset.id||''))||values.has(String(el.dataset.clientMessageId||'')))||null;}
function updateMessageStatusElement(el,status){if(!el)return;const normalized=normalizeMessageStatus(status);el.dataset.status=normalized;if(el.classList.contains('mine')){const meta=el.querySelector('.meta');if(meta)meta.innerHTML=formatMessageTime(el.dataset.createdAt)+' '+deliveryIcon(normalized);}if(normalized==='read'&&el.dataset.incoming==='1'){el.dataset.read='1';unreadVisibleObserver?.unobserve(el);pendingIncomingReadIds=pendingIncomingReadIds.filter((id)=>Number(id)!==Number(el.dataset.messageId||el.dataset.id));}}
function promoteMessageElement(roomId,messageId,clientMessageId,status,createdAt=null){const el=findMessageElement(messageId,clientMessageId);if(!el)return false;if(messageId!==null&&messageId!==undefined){el.dataset.id=String(messageId);el.dataset.messageId=String(messageId);}if(clientMessageId!==null&&clientMessageId!==undefined&&String(clientMessageId)!=='')el.dataset.clientMessageId=String(clientMessageId);if(createdAt)el.dataset.createdAt=createdAt;updateMessageStatusElement(el,status);return true;}
function acknowledgeRead(roomId,messageId){const entry=pendingReadQueue.get(roomId);if(!entry)return;entry.ids.delete(Number(messageId));if(entry.ids.size){entry.sentAt=0;flushPendingReads(roomId,entry.deviceId);}else{clearTimeout(entry.retryTimer);pendingReadQueue.delete(roomId);}}
function resetPendingReadAttempts(){pendingReadQueue.forEach((entry)=>{entry.sentAt=0;});}
function clearPendingText(clientMessageId){const key=String(clientMessageId||'');if(!key)return;const pending=pendingTextSends.get(key);if(!pending)return;clearTimeout(pending.timer);pendingTextSends.delete(key);}
function transmitPendingText(pending){if(!pending||pendingTextSends.get(pending.clientMessageId)!==pending)return false;if(!state.ws||state.ws.readyState!==WebSocket.OPEN||!state.ws.deviceId)return false;try{state.ws.send(JSON.stringify(pending.payload));pending.attempts+=1;pending.sentAt=Date.now();clearTimeout(pending.timer);if(pending.attempts<4){const sentAt=pending.sentAt;pending.timer=setTimeout(()=>{if(pendingTextSends.get(pending.clientMessageId)===pending&&pending.sentAt===sentAt)transmitPendingText(pending);},1800);}return true;}catch{return false;}}
function queuePendingTextSend(payload){const clientMessageId=String(payload?.clientMessageId||'');if(!clientMessageId)return false;clearPendingText(clientMessageId);const pending={clientMessageId,payload,attempts:0,sentAt:0,timer:null};pendingTextSends.set(clientMessageId,pending);transmitPendingText(pending);return true;}
function resendPendingTextMessages(){[...pendingTextSends.values()].forEach((pending)=>{clearTimeout(pending.timer);pending.attempts=0;pending.sentAt=0;transmitPendingText(pending);});}
function upsertRoomMessage(roomId,message,patch={}){const ids=[message?.id,message?.client_message_id].filter((value)=>value!==null&&value!==undefined&&String(value)!=='').map(String);const keys=ids.map((id)=>String(roomId)+':'+id);const isDuplicate=keys.some((key)=>liveMessageKeys.has(key));keys.forEach((key)=>liveMessageKeys.add(key));while(liveMessageKeys.size>600)liveMessageKeys.delete(liveMessageKeys.values().next().value);if(message?.id!==null||message?.client_message_id){rememberMessageStatus(roomId,message?.id,message?.status||'sent',message?.client_message_id||null);}const chatPatch={lastMessage:patch.text??'',lastSender:message?.sender_name||'',lastActivity:message?.created_at||new Date().toISOString(),...patch};if(!Object.prototype.hasOwnProperty.call(patch,'unread'))chatPatch.unread=state.chats.find((chat)=>chat.roomId===roomId)?.unread||0;upsertChat(roomId,chatPatch);return{isDuplicate};}
function handleWsPresenceUpdate(payload){if(payload?.type!=='presence:update'||!payload.deviceId)return false;state.presence[payload.deviceId]={deviceId:payload.deviceId,displayName:payload.displayName,online:Boolean(payload.online),lastSeenAt:payload.lastSeenAt||null};renderPresenceStatus();return true;}
function handleWsMessageAck(payload){if(payload?.type!=='message:ack')return false;const roomId=String(payload.roomId||state.roomId||'');const clientMessageId=payload.clientMessageId||payload.message?.client_message_id||null;if(payload.accepted===false){clearPendingText(clientMessageId);return true;}const messageId=payload.messageId??payload.message?.id??null;const status=rememberMessageStatus(roomId,messageId,payload.status||payload.message?.status||'sent',clientMessageId);promoteMessageElement(roomId,messageId,clientMessageId,status,payload.message?.created_at||null);if(messageStatusRank(status)>=messageStatusRank('delivered'))clearPendingText(clientMessageId);return true;}
function handleWsMessageStatus(payload){if(payload?.type!=='message:status')return false;const roomId=String(payload.roomId||state.roomId||'');const status=rememberMessageStatus(roomId,payload.messageId,payload.status||'sent',payload.clientMessageId||null);if(status==='read')acknowledgeRead(roomId,payload.messageId);if(messageStatusRank(status)>=messageStatusRank('delivered')){clearPendingText(payload.clientMessageId||null);clearReceivedMessageIds(roomId,[payload.messageId]);}const el=findMessageElement(payload.messageId,payload.clientMessageId||null);if(el)updateMessageStatusElement(el,status);if(roomId===state.roomId){recomputePendingUnread();updateUnreadIndicators();updateReplyComposerBar();}return true;}
function connectWs(deviceId){setLocalConnectionState('connecting');if(state.ws){try{state.ws.close();}catch{}}const p=location.protocol==='https:'?'wss':'ws';const currentSeq=++appWsSeq;activeAppWsSeq=currentSeq;const ws=new WebSocket(p+'://'+location.host+'?device='+encodeURIComponent(deviceId));ws.deviceId=deviceId;state.ws=ws;const isCurrentWs=()=>state.ws===ws&&activeAppWsSeq===currentSeq;wsConnectStartedAt=Date.now();ws.onopen=()=>{if(!isCurrentWs())return;setLocalConnectionState('connected');sendClientState();flushPendingReads(state.roomId,ws.deviceId||activeChatDeviceId);resendPendingTextMessages();};ws.onerror=()=>{if(!isCurrentWs())return;resetPendingReadAttempts();setLocalConnectionState('disconnected');};ws.onclose=()=>{if(!isCurrentWs())return;resetPendingReadAttempts();setLocalConnectionState('disconnected');};ws.onmessage=async(ev)=>{if(!isCurrentWs())return;let payload;try{payload=JSON.parse(ev.data);}catch{return;}if(handleWsPresenceUpdate(payload)||handleWsMessageAck(payload)||handleWsMessageStatus(payload))return;if(payload.type!=='message:new'||!payload.message)return;const roomId=payload.roomId;if(!roomId)return;const incomingMessage=payload.message;const message={...incomingMessage,status:getEffectiveMessageStatus(roomId,incomingMessage)};const messageId=message.id;const clientMessageId=message.client_message_id||null;if(messageId!==null&&messageId!==undefined){rememberMessageStatus(roomId,messageId,message.status,clientMessageId);promoteMessageElement(roomId,messageId,clientMessageId,message.status,message.created_at||null);if(clientMessageId&&messageStatusRank(message.status)>=messageStatusRank('delivered'))clearPendingText(clientMessageId);}const chat=state.chats.find((c)=>c.roomId===roomId)||{};const txt=await decryptText(message.iv,message.ciphertext).catch(()=>'[cannot decrypt]');const mine=message.sender_device_id===deviceId;const box=document.getElementById('messages');const inActiveChat=state.roomId===roomId&&box;const nearBottom=inActiveChat?isMessagesAtBottom():false;const hasMessageInDom=Boolean(findMessageElement(messageId,clientMessageId));let upsertResult={isDuplicate:false};if(mine){upsertResult=upsertRoomMessage(roomId,message,{text:txt,unread:chat.unread||0});if(inActiveChat&&!hasMessageInDom){appendDateSeparatorIfNeeded(box,message.created_at);appendMessage(box,message,txt,true,true);scrollMessagesToBottom(box);}}else if(inActiveChat){if(!hasMessageInDom){appendDateSeparatorIfNeeded(box,message.created_at);appendMessage(box,message,txt,false,nearBottom);}if(nearBottom){markMessageRead(messageId);upsertResult=upsertRoomMessage(roomId,message,{text:txt,unread:0});scrollMessagesToBottom(box);}else{const incomingId=Number(messageId);if(Number.isInteger(incomingId)&&incomingId>0)pendingIncomingReadIds=[...new Set([...pendingIncomingReadIds,incomingId])];const unreadCount=pendingIncomingReadIds.length;upsertResult=upsertRoomMessage(roomId,message,{text:txt,unread:unreadCount});renderNewMessagesPill(unreadCount);}}else{upsertResult=upsertRoomMessage(roomId,message,{text:txt});const unread=upsertResult.isDuplicate?(chat.unread||0):((chat.unread||0)+1);upsertChat(roomId,{unread});updateUnreadPresentation();}if(!mine&&!upsertResult.isDuplicate)notifyIncoming(message.sender_name,txt,roomId,false);updateReplyComposerBar();};}
function rememberLastKnownMessageId(roomId,messageId){const id=Number(messageId);if(!Number.isSafeInteger(id)||id<=0)return;const current=Number(lastKnownMessageIdByRoom.get(roomId)||0);if(id>current)lastKnownMessageIdByRoom.set(roomId,id);}
function bufferRoomMessage(roomId,message,notify){const queue=bufferedRoomMessages.get(roomId)||[];const id=String(message?.id??message?.client_message_id??'');if(id&&!queue.some((item)=>String(item.message?.id??item.message?.client_message_id??'')===id))queue.push({message,notify});bufferedRoomMessages.set(roomId,queue);}
async function flushBufferedRoomMessages(roomId,deviceId){const queue=bufferedRoomMessages.get(roomId);if(!queue?.length)return;bufferedRoomMessages.delete(roomId);for(const item of queue)await processStableIncomingMessage(roomId,item.message,deviceId,{notify:item.notify});if(bufferedRoomMessages.has(roomId))await flushBufferedRoomMessages(roomId,deviceId);}
async function processStableIncomingMessage(roomId,incomingMessage,deviceId,{notify=true}={}){
  if(!roomId||!incomingMessage)return;
  const message={...incomingMessage,status:getEffectiveMessageStatus(roomId,incomingMessage)};
  const messageId=message.id;
  const clientMessageId=message.client_message_id||null;
  rememberLastKnownMessageId(roomId,messageId);
  if(messageId!==null&&messageId!==undefined){
    rememberMessageStatus(roomId,messageId,message.status,clientMessageId);
    promoteMessageElement(roomId,messageId,clientMessageId,message.status,message.created_at||null);
    if(clientMessageId&&messageStatusRank(message.status)>=messageStatusRank('delivered'))clearPendingText(clientMessageId);
  }
  const box=document.getElementById('messages');
  const inActiveChat=state.roomId===roomId&&Boolean(box);
  if(inActiveChat&&chatViewReadyRoomId!==roomId){bufferRoomMessage(roomId,message,notify);return;}
  const chat=state.chats.find((item)=>item.roomId===roomId)||{};
  const text=await decryptRoomText(roomId,message).catch(()=>message.type==='media'?'':'[cannot decrypt]');
  const mine=message.sender_device_id===deviceId;
  const hasMessageInDom=Boolean(findMessageElement(messageId,clientMessageId));
  const nearBottom=inActiveChat?isMessagesAtBottom():false;
  let upsertResult={isDuplicate:hasMessageInDom};
  if(mine){
    const result=upsertRoomMessage(roomId,message,{text,unread:chat.unread||0});
    upsertResult={isDuplicate:Boolean(result.isDuplicate||hasMessageInDom)};
    if(inActiveChat&&!hasMessageInDom){appendDateSeparatorIfNeeded(box,message.created_at);appendMessage(box,message,text,true,true);scrollMessagesToBottom(box);}
  }else if(inActiveChat){
    if(!hasMessageInDom){appendDateSeparatorIfNeeded(box,message.created_at);appendMessage(box,message,text,false,nearBottom);}
    if(nearBottom){
      markMessageRead(messageId);
      const unloadedCount=activeChatHistory?.roomId===roomId?Math.max(0,Number(activeChatHistory.unloadedUnreadCount)||0):0;
      upsertRoomMessage(roomId,message,{text,unread:unloadedCount});
      renderNewMessagesPill(unloadedCount);
    }else{
      const incomingId=Number(messageId);
      if(Number.isInteger(incomingId)&&incomingId>0)pendingIncomingReadIds=[...new Set([...pendingIncomingReadIds,incomingId])];
      const unloadedCount=activeChatHistory?.roomId===roomId?Math.max(0,Number(activeChatHistory.unloadedUnreadCount)||0):0;
      const unreadCount=pendingIncomingReadIds.length+unloadedCount;
      upsertRoomMessage(roomId,message,{text,unread:unreadCount});
      renderNewMessagesPill(unreadCount);
    }
  }else{
    const result=upsertRoomMessage(roomId,message,{text});
    upsertResult={isDuplicate:Boolean(result.isDuplicate||hasMessageInDom)};
    const unread=upsertResult.isDuplicate?(chat.unread||0):((chat.unread||0)+1);
    upsertChat(roomId,{unread});
    updateUnreadPresentation();
  }
  if(!mine&&message.status==='sent'&&Number.isSafeInteger(Number(messageId))&&Number(messageId)>0)markMessagesReceived(roomId,deviceId,[Number(messageId)]);
  if(!mine&&!upsertResult.isDuplicate&&notify)notifyIncoming(message.sender_name,text,roomId,false);
  updateReplyComposerBar();
}
async function fetchRoomMessagesPage(roomId,deviceId,params){
  const query=new URLSearchParams({deviceId:String(deviceId),limit:String(CHAT_HISTORY_PAGE_SIZE),...params});
  const response=await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages?${query.toString()}`,{cache:'no-store'});
  if(!response.ok)throw new Error(`sync request failed: ${response.status}`);
  const data=await response.json();
  if(!data||!Array.isArray(data.messages))throw new Error('invalid sync response');
  return data;
}
async function syncRoomAfterReconnect(roomId,deviceId){
  let known=Number(lastKnownMessageIdByRoom.get(roomId)||0);
  let snapshot=null;
  try{snapshot=await fetchRoomMessagesPage(roomId,deviceId,{limit:String(CHAT_HISTORY_PAGE_SIZE)});}catch{return;}
  const snapshotMessages=snapshot.messages;
  const receivedIds=[];
  for(const message of snapshotMessages){
    rememberLastKnownMessageId(roomId,message.id);
    const status=getEffectiveMessageStatus(roomId,message);
    rememberMessageStatus(roomId,message.id,status,message.client_message_id||null);
    promoteMessageElement(roomId,message.id,message.client_message_id||null,status,message.created_at||null);
    if(message.sender_device_id!==deviceId&&status==='sent'){const id=Number(message.id);if(Number.isSafeInteger(id)&&id>0)receivedIds.push(id);}else if(message.sender_device_id!==deviceId){clearReceivedMessageIds(roomId,[message.id]);}
  }
  if(receivedIds.length)markMessagesReceived(roomId,deviceId,receivedIds);
  const serverUnreadCount=Number(snapshot.unreadCount);
  if(Number.isFinite(serverUnreadCount)&&serverUnreadCount>=0){
    const unread=Math.floor(serverUnreadCount);
    if(state.roomId===roomId&&activeChatHistory?.roomId===roomId){
      activeChatHistory.unreadCount=unread;
      activeChatHistory.unloadedUnreadCount=Math.max(0,unread-recomputePendingUnread());
      updateUnreadIndicators();
    }else{
      upsertChat(roomId,{unread});
    }
  }
  const latest=snapshotMessages[snapshotMessages.length-1];
  if(latest&&(!state.chats.find((item)=>item.roomId===roomId)?.lastActivity||new Date(latest.created_at)>new Date(state.chats.find((item)=>item.roomId===roomId)?.lastActivity||0))){
    const text=await decryptRoomText(roomId,latest).catch(()=>latest.type==='media'?'':'[cannot decrypt]');
    upsertChat(roomId,{lastMessage:text,lastSender:latest.sender_name||'',lastActivity:latest.created_at});
  }
  if(!Number.isSafeInteger(known)||known<=0){rememberLastKnownMessageId(roomId,latest?.id);return;}
  let cursor=known;
  for(let pageIndex=0;pageIndex<100;pageIndex+=1){
    let page;
    try{page=await fetchRoomMessagesPage(roomId,deviceId,{after:String(cursor)});}catch{return;}
    if(!page.messages.length)break;
    for(const message of page.messages)await processStableIncomingMessage(roomId,message,deviceId,{notify:false});
    const ids=page.messages.map((message)=>Number(message.id)).filter((id)=>Number.isSafeInteger(id)&&id>cursor);
    const next=Number(page.nextCursor);
    const advanced=ids.length?Math.max(...ids):next>cursor?next:0;
    if(!advanced)break;
    cursor=advanced;
    if(!page.hasMore)break;
  }
  rememberLastKnownMessageId(roomId,cursor);
}
async function syncAllRoomsAfterReconnect(deviceId){
  if(stableWsSyncPromise)return stableWsSyncPromise;
  const rooms=[...new Set([...state.chats.map((chat)=>chat.roomId),state.roomId].filter(Boolean))];
  stableWsSyncPromise=Promise.all(rooms.map((roomId)=>syncRoomAfterReconnect(roomId,STORAGE.get(STORAGE.roomState(roomId))?.deviceId||deviceId).catch(()=>{}))).finally(()=>{stableWsSyncPromise=null;});
  return stableWsSyncPromise;
}
function stableWsShouldRun(){return Boolean(stableWsDesiredDeviceId&&(state.chats.length||state.roomId));}
function clearStableWsReconnect(){if(stableWsReconnectTimer){clearTimeout(stableWsReconnectTimer);stableWsReconnectTimer=null;}}
function scheduleStableWsReconnect(){
  if(stableWsReconnectTimer||stableWsManualClose||!stableWsShouldRun())return;
  const attempt=stableWsReconnectAttempt++;
  const delay=Math.min(15000,500*2**Math.min(attempt,5))+Math.floor(Math.random()*250);
  stableWsReconnectTimer=setTimeout(()=>{stableWsReconnectTimer=null;if(stableWsDesiredDeviceId)void ensureStableWsConnected(stableWsDesiredDeviceId);},delay);
}
function sendStableClientState(){
  const ws=state.ws;
  if(!ws||ws.readyState!==WebSocket.OPEN)return false;
  try{ws.send(JSON.stringify({type:'client:state',activeRoomId:state.roomId||null,visible:document.visibilityState==='visible'}));return true;}catch{return false;}
}
function handleStableWsPayload(payload,deviceId){
  if(handleWsPresenceUpdate(payload)||handleWsMessageAck(payload)||handleWsMessageStatus(payload))return Promise.resolve();
  if(payload?.type==='message:new'&&payload.message&&payload.roomId)return processStableIncomingMessage(payload.roomId,payload.message,deviceId,{notify:true});
  return Promise.resolve();
}
function connectStableWs(deviceId,timeoutMs=8000){
  const safeDeviceId=String(deviceId||'').trim();
  if(!safeDeviceId)return Promise.resolve(false);
  const current=state.ws;
  if(current?.readyState===WebSocket.OPEN&&current.deviceId===safeDeviceId){sendStableClientState();return Promise.resolve(true);}
  if(current?.readyState===WebSocket.CONNECTING&&current.deviceId===safeDeviceId&&stableWsConnectPromise)return stableWsConnectPromise;
  clearStableWsReconnect();
  if(current){stableWsSequence+=1;try{current.close();}catch{}}
  const sequence=++stableWsSequence;
  const protocol=location.protocol==='https:'?'wss':'ws';
  let ws;
  try{ws=new WebSocket(`${protocol}://${location.host}?device=${encodeURIComponent(safeDeviceId)}`);}catch{scheduleStableWsReconnect();return Promise.resolve(false);}
  ws.deviceId=safeDeviceId;
  ws.isFpCurrent=()=>state.ws===ws&&stableWsSequence===sequence;
  state.ws=ws;
  stableWsConnectDeviceId=safeDeviceId;
  let promise;
  promise=new Promise((resolve)=>{
    let settled=false;
    const timer=setTimeout(()=>{if(settled)return;try{ws.close();}catch{}finish(false);},timeoutMs);
    const finish=(ok)=>{if(settled)return;settled=true;clearTimeout(timer);if(stableWsConnectPromise===promise)stableWsConnectPromise=null;resolve(Boolean(ok&&ws.isFpCurrent()&&ws.readyState===WebSocket.OPEN));};
    let incomingChain=Promise.resolve();
    ws.onopen=()=>{if(!ws.isFpCurrent())return;stableWsReconnectAttempt=0;stableWsManualClose=false;setLocalConnectionState('connected');sendStableClientState();resetPendingReadAttempts();flushPendingReads(state.roomId,safeDeviceId);resendPendingTextMessages();finish(true);void syncAllRoomsAfterReconnect(safeDeviceId);};
    ws.onerror=()=>{if(ws.isFpCurrent())setLocalConnectionState('disconnected');};
    ws.onclose=()=>{if(!ws.isFpCurrent()){finish(false);return;}state.ws=null;resetPendingReadAttempts();setLocalConnectionState('disconnected');finish(false);if(!stableWsManualClose&&stableWsShouldRun())scheduleStableWsReconnect();};
    ws.onmessage=(event)=>{if(!ws.isFpCurrent())return;incomingChain=incomingChain.then(async()=>{let payload;try{payload=JSON.parse(event.data);}catch{return;}await handleStableWsPayload(payload,safeDeviceId);}).catch(()=>{});};
  });
  stableWsConnectPromise=promise;
  return promise;
}
function ensureStableWsConnected(deviceId,timeoutMs=8000){
  const safeDeviceId=String(deviceId||'').trim();
  if(!safeDeviceId)return Promise.resolve(false);
  stableWsDesiredDeviceId=safeDeviceId;
  stableWsManualClose=false;
  if(state.ws?.readyState===WebSocket.OPEN&&state.ws.deviceId===safeDeviceId){setLocalConnectionState('connected');sendStableClientState();return Promise.resolve(true);}
  if(state.ws?.readyState===WebSocket.CONNECTING&&state.ws.deviceId===safeDeviceId&&stableWsConnectPromise)return stableWsConnectPromise;
  setLocalConnectionState('connecting');
  return connectStableWs(safeDeviceId,timeoutMs);
}
function sendClientState(){return sendStableClientState();}
function ensureWsConnected(deviceId,timeoutMs=8000){return ensureStableWsConnected(deviceId,timeoutMs);}
function connectWs(deviceId){return ensureStableWsConnected(deviceId);}
window.addEventListener('online',()=>{const deviceId=String(localStorage.getItem(STORAGE.deviceId)||'').trim();if(deviceId&&state.chats.length)void ensureStableWsConnected(deviceId);});
window.addEventListener('offline',()=>{if(state.roomId)setLocalConnectionState('disconnected');});

function showRoomMenu(roomId,x,y){els.context.innerHTML='';[['Переименовать у себя',()=>{const v=prompt('Новое имя',state.roomNames[roomId]||''); if(v!==null){if(v.trim())state.roomNames[roomId]=v.trim(); else delete state.roomNames[roomId]; saveRoomNames(); renderChats(); if(state.roomId===roomId)openChat(roomId);}}],[state.roomMute[roomId]?'Включить уведомления в этом чате':'Выключить уведомления в этом чате',()=>{state.roomMute[roomId]=!state.roomMute[roomId];saveRoomMute();renderChats();const st=STORAGE.get(STORAGE.roomState(roomId));if(st?.deviceId){fetch('/api/push/mute-room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,deviceId:st.deviceId,muted:state.roomMute[roomId]})});if(!state.roomMute[roomId])syncRoomPushSubscription(roomId).catch(()=>{});}}],['Скопировать invite-ссылку',()=>{const st=STORAGE.get(STORAGE.roomState(roomId)); if(!st?.inviteLink){alert('Invite-ссылка уже использована или устарела.');return;} navigator.clipboard.writeText(st.inviteLink);} ],['Удалить из списка',()=>{if(confirm('Удалить чат из списка?')){state.chats=state.chats.filter(c=>c.roomId!==roomId);saveChats();hideMenu();if(state.roomId===roomId){if(state.ws)state.ws.close();state.ws=null;state.roomId=null;}setView('chats');renderChats();if(typeof updatePushBadge==='function')updateUnreadPresentation();}}]].forEach(([t,fn],idx)=>{const b=document.createElement('button');b.className='context-item'+(t.includes('Удалить')?' danger':'');if(idx>0)b.dataset.sep='1';b.textContent=t;b.onclick=()=>{fn();hideMenu()};els.context.appendChild(b)});els.context.classList.remove('hidden');const margin=8;let left=x;let top=y;const rect=els.context.getBoundingClientRect();if(left+rect.width>window.innerWidth-margin){left=window.innerWidth-rect.width-margin;}if(top+rect.height>window.innerHeight-margin){top=window.innerHeight-rect.height-margin;}left=Math.max(margin,left);top=Math.max(margin,top);els.context.style.left=left+'px';els.context.style.top=top+'px';els.context.onclick=(e)=>{e.stopPropagation()};}
function hideMenu(){els.context.classList.add('hidden')} document.addEventListener('click',hideMenu);
function parseInviteInput(value){const raw=String(value||'').trim();if(!raw)return {error:'empty'};if(raw.includes('#'))return {error:'old_invite'};let inviteCode='';try{const url=new URL(raw,location.origin);const match=url.pathname.match(/^\/i\/([A-Z0-9]{16,64})$/i);if(match)inviteCode=match[1];}catch{}if(!inviteCode){const direct=raw.match(/^([A-Z0-9]{16,64})$/i);if(direct)inviteCode=direct[1];}if(!inviteCode)return {error:'invalid'};return {inviteCode};}

function renderJoin(){els.content.innerHTML=`<div class='panel'><h2>Присоединиться к чату</h2><label>Invite-ссылка</label><textarea id='joinInviteInput' placeholder='Вставьте invite-ссылку или invite-код'></textarea><p class='sys'>Invite-ссылка действует 24 часа и только один раз.</p><div class='panel-actions'><button id='joinBtn' class='btn btn-primary'>Присоединиться</button><button id='pasteJoinBtn' class='btn btn-secondary'>Вставить из буфера</button><button id='backBtn' class='btn btn-secondary'>Назад</button></div></div>`; document.getElementById('backBtn').onclick=()=>setView('chats'); document.getElementById('joinBtn').onclick=async()=>{const input=document.getElementById('joinInviteInput');await joinByInviteText(input?.value||'');}; document.getElementById('pasteJoinBtn').onclick=async()=>{if(!navigator.clipboard?.readText){alert('Буфер обмена недоступен. Вставьте ссылку вручную.');return;} try{const text=await navigator.clipboard.readText();const parsed=parseInviteInput(text);if(parsed?.error==='empty'){alert('В буфере обмена нет invite-ссылки.');return;}if(parsed?.error==='old_invite'){alert('В буфере старая invite-ссылка. Попросите новую ссылку.');return;}if(!parsed||parsed.error){alert('В буфере обмена не invite-ссылка FPChat.');return;}const input=document.getElementById('joinInviteInput');if(input)input.value=text;await joinByInviteText(text);}catch{alert('Не удалось прочитать буфер обмена. Вставьте ссылку вручную.');}};}
function renderCreate(){els.content.innerHTML=`<div class='panel'><h2>Создать чат</h2><label>Ваш ник</label><input id="nickCreate" value="${safeText(state.nick)}"/><div class='panel-actions'><button id='createBtn' class='btn btn-primary'>Создать чат</button><button id='backBtn' class='btn btn-secondary'>Назад</button></div><div id='createOut'></div></div>`; document.getElementById('backBtn').onclick=()=>setView('chats'); document.getElementById('createBtn').onclick=async()=>{const createBtn=document.getElementById('createBtn');const baseText='Создать чат';createBtn.disabled=true;createBtn.classList.add('btn-loading');createBtn.textContent='Создание...';try{state.nick=document.getElementById('nickCreate').value.trim()||state.nick; localStorage.setItem(STORAGE.nick,state.nick);
const secret=crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,''); const rec=`R-${Array.from({length:5}).map(()=>Array.from({length:4}).map(()=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join('')).join('-')}`; const salt=crypto.getRandomValues(new Uint8Array(16)); const recSalt=b64.encode(salt); const dig=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rec+':'+recSalt)); const mat=await crypto.subtle.importKey('raw',new TextEncoder().encode(rec),'PBKDF2',false,['deriveKey']); const rk=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64.decode(recSalt),iterations:250000,hash:'SHA-256'},mat,{name:'AES-GCM',length:256},false,['encrypt']); const iv=crypto.getRandomValues(new Uint8Array(12)); const c=await crypto.subtle.encrypt({name:'AES-GCM',iv},rk,new TextEncoder().encode(secret));
const creatorDeviceId=getOrCreateDeviceId();const res=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId:creatorDeviceId,roomSecret:secret,recoverySalt:recSalt,recoveryVerifier:b64.encode(dig),recoverySecretIv:b64.encode(iv),recoverySecretCiphertext:b64.encode(c)})}); const data=await res.json(); STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId:creatorDeviceId,recoveryCode:rec,inviteLink:data.inviteLink,inviteExpiresAt:data.inviteExpiresAt}); upsertChat(data.publicId,{}); if(state.notif.enabled)syncRoomPushSubscription(data.publicId).catch(()=>{});
const inv=`${data.inviteLink}`; document.getElementById('createOut').innerHTML=`<label>Invite-ссылка</label><textarea readonly id='inv'>${inv}</textarea><p class='sys'>Важно: invite-ссылка действует 24 часа и только один раз. Если второй участник не присоединится за это время, чат будет автоматически удалён.</p><div class='panel-actions'><button id='copyInv' class='btn btn-secondary'>Скопировать ссылку</button><button id='shareInv' class='btn btn-secondary'>Поделиться</button></div><label>Recovery-код</label><textarea readonly id='rec'>${rec}</textarea><p class='sys'>Recovery-код помогает восстановить чат только на устройстве участника. Если очистить данные приложения или браузера, восстановление может быть невозможно. Храните recovery-код как пароль.</p><div class='panel-actions'><button id='saveRec' class='btn btn-secondary'>Сохранить recovery-код</button><button id='goChat' class='btn btn-primary'>Перейти в чат</button></div>`; document.getElementById('copyInv').onclick=()=>navigator.clipboard.writeText(inv); document.getElementById('shareInv').onclick=async()=>{if(navigator.share){try{await navigator.share({text:inv});}catch{}} else navigator.clipboard.writeText(inv)}; document.getElementById('saveRec').onclick=()=>{navigator.clipboard.writeText(rec);downloadRecoveryCode(rec);}; document.getElementById('goChat').onclick=()=>openChat(data.publicId);}catch(e){alert('Не удалось создать чат');createBtn.disabled=false;createBtn.classList.remove('btn-loading');createBtn.textContent=baseText;}}
;}
function renderRestore(){els.content.innerHTML=`<div class='panel'><h2>Восстановить</h2><label>Ваш ник</label><input id="nickRestore" value="${safeText(state.nick)}"/><label>Recovery-код</label><input id='recCode'/><div class='panel-actions'><button id='restoreBtn' class='btn btn-primary'>Восстановить</button><button id='backBtn' class='btn btn-secondary'>Назад</button></div><div id='restoreOut'></div></div>`; document.getElementById('backBtn').onclick=()=>setView('chats'); document.getElementById('restoreBtn').onclick=async()=>{const restoreBtn=document.getElementById('restoreBtn');const baseText='Восстановить';restoreBtn.disabled=true;restoreBtn.classList.add('btn-loading');restoreBtn.textContent='Восстановление...';try{const recoveryCode=document.getElementById('recCode').value.trim().toUpperCase(); state.nick=document.getElementById('nickRestore').value.trim()||state.nick; localStorage.setItem(STORAGE.nick,state.nick); const deviceIds=getKnownDeviceIds(); if(!deviceIds.length) throw new Error('Восстановление доступно только с устройства участника чата.'); const res=await fetch('/api/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recoveryCode,deviceIds})}); if(!res.ok){const msg=res.status===403?'Восстановление доступно только с устройства участника чата.':'Ошибка восстановления'; throw new Error(msg);} const d=await res.json(); if(!d.deviceId) throw new Error('Восстановление невозможно: отсутствует deviceId в recovery.'); const roomId=d.publicId; const mat=await crypto.subtle.importKey('raw',new TextEncoder().encode(recoveryCode),'PBKDF2',false,['deriveKey']); const rk=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64.decode(d.recoverySalt),iterations:250000,hash:'SHA-256'},mat,{name:'AES-GCM',length:256},false,['decrypt']); const pl=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64.decode(d.recoverySecretIv)},rk,b64.decode(d.recoverySecretCiphertext)); STORAGE.set(STORAGE.roomState(roomId),{secret:new TextDecoder().decode(pl),deviceId:d.deviceId,recoveryCode}); upsertChat(roomId,{}); if(state.notif.enabled)syncRoomPushSubscription(roomId).catch(()=>{}); document.getElementById('restoreOut').innerHTML=`<p>Чат восстановлен</p><button id='goRest' class='btn btn-primary'>Перейти в чат</button>`; document.getElementById('goRest').onclick=()=>openChat(roomId);}catch(e){alert(e.message||'Ошибка восстановления');restoreBtn.disabled=false;restoreBtn.classList.remove('btn-loading');restoreBtn.textContent=baseText;}};}
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

function isStandalonePwa(){
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone===true;
}
function isIosDevice(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function getInstallHelpText(){
  if(isStandalonePwa()){
    return 'FPChat уже установлен и запущен как приложение.';
  }
  if(deferredInstallPrompt){
    return 'Можно установить FPChat как отдельное приложение.';
  }
  if(isIosDevice()){
    return 'Для установки на iPhone/iPad откройте меню «Поделиться» в Safari и выберите «На экран Домой».';
  }
  return 'Если кнопка установки недоступна, откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».';
}
function updateInstallUi(){
  const help=document.getElementById('installHelpText');
  const btn=document.getElementById('installPwaBtn');
  if(help){
    help.textContent=getInstallHelpText();
  }
  if(!btn)return;
  if(isStandalonePwa()){
    btn.textContent='Приложение установлено';
    btn.disabled=true;
    return;
  }
  btn.textContent=deferredInstallPrompt?'Установить FPChat':'Как установить FPChat';
  btn.disabled=false;
}
async function handleInstallClick(){
  if(isStandalonePwa()){
    alert('FPChat уже установлен.');
    return;
  }
  if(!deferredInstallPrompt){
    alert(getInstallHelpText());
    return;
  }
  try{
    deferredInstallPrompt.prompt();
    const choice=await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null;
    if(typeof updateInstallUi==='function'){
      updateInstallUi();
    }
    if(choice?.outcome==='accepted'){
      alert('FPChat устанавливается.');
    }
  }catch{
    alert('Не удалось открыть установку. Попробуйте установить через меню браузера.');
  }
}
function renderSettings(){els.content.innerHTML=`<div class='panel'><h2>Настройки</h2><label>Ваш ник</label><input id="nick" value="${safeText(state.nick)}"/><label>Тема</label><select id='theme'><option value='auto'>Авто</option><option value='light'>Светлая</option><option value='dark'>Тёмная</option></select><div class='settings-section notification-settings'><h3>Уведомления</h3><label><input type='checkbox' id='nEnabled' ${state.notif.enabled?'checked':''}/> Включить уведомления</label><label><input type='checkbox' id='nText' ${state.notif.showText?'checked':''}/> Показывать текст сообщения</label><label><input type='checkbox' id='nSender' ${state.notif.hideSender?'checked':''}/> Скрывать отправителя</label><label><input type='checkbox' id='nSound' ${state.notif.sound?'checked':''}/> Звук нового сообщения</label><p id='notificationPermissionStatus' class='settings-hint'></p><button id='requestNotificationsBtn' type='button' class='btn btn-secondary'>Разрешить уведомления</button></div><div class='settings-section'><h3>Установка приложения</h3><p id='installHelpText' class='settings-hint'></p><button id='installPwaBtn' class='btn btn-secondary'>Установить FPChat</button></div><div id='settingsVersion' class='sys'>${settingsVersionInfo}</div><div class='panel-actions'><button id='save' class='btn btn-primary'>Сохранить</button><button id='backBtn' class='btn btn-secondary'>Назад</button></div></div>`;void refreshSettingsVersionLine(); document.getElementById('backBtn').onclick=()=>setView('chats'); const t=document.getElementById('theme'); t.value=localStorage.getItem(STORAGE.theme)||'auto'; t.onchange=()=>applyTheme(t.value); const toggle=()=>updateNotificationOptionControls(); document.getElementById('nEnabled').onchange=async()=>{if(document.getElementById('nEnabled').checked){await ensurePushSubscription({requestPermission:true,showErrors:true});}toggle();renderNotificationPermissionStatus();}; toggle();renderNotificationPermissionStatus();bindClick('requestNotificationsBtn',enableNotificationsFromSettings);bindClick('installPwaBtn',handleInstallClick);updateInstallUi(); document.getElementById('save').onclick=async()=>{state.nick=document.getElementById('nick').value.trim()||state.nick;localStorage.setItem(STORAGE.nick,state.nick);state.notif=normalizeNotificationSettings({enabled:document.getElementById('nEnabled').checked,showText:document.getElementById('nText').checked,hideSender:document.getElementById('nSender').checked,sound:document.getElementById('nSound').checked});STORAGE.set(STORAGE.notif,state.notif);let pushReady=true;if(!state.notif.enabled){await unsubscribeAllPushDevices();}else{const subscription=await ensurePushSubscription({requestPermission:true,showErrors:true});if(subscription){await syncAllPushSubscriptions({subscription});await updateAllPushSettings();}else pushReady=false;}renderNotificationPermissionStatus();alert(pushReady?'Сохранено':'Сохранено. Уведомления включены в FPChat, но разрешение браузера или push-подписка не выданы.');};}
function applyTheme(v){localStorage.setItem(STORAGE.theme,v);const root=document.documentElement;if(v==='auto'){root.dataset.theme=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';} else root.dataset.theme=v;}
function buildNotificationText(sender,text,notif=state.notif){if(notif.showText){return notif.hideSender?text:`${sender}: ${text}`;}return notif.hideSender?'Новое сообщение':`${sender}: новое сообщение`;}
let notificationAudio=null;
function shouldShowInAppToast({roomId,mine}){if(mine)return false;if(!state.notif.enabled)return false;if(state.roomMute[roomId])return false;if(document.visibilityState!=='visible')return false;if(roomId===state.roomId)return false;return true;}
function shouldPlayNotificationSound({roomId,mine}){if(mine)return false;if(!state.notif.enabled)return false;if(!state.notif.sound)return false;if(state.roomMute[roomId])return false;if(document.visibilityState!=='visible')return false;if(roomId===state.roomId)return false;return true;}
function playNotificationSoundSafe(){if(!notificationAudio)notificationAudio=new Audio('data:audio/wav;base64,UklGRlQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YTAAAAABAQEB');notificationAudio.currentTime=0;notificationAudio.play().catch(()=>{});}
function playNotificationSound({roomId,mine}){if(!shouldPlayNotificationSound({roomId,mine}))return;playNotificationSoundSafe();}
function ensureToastRoot(){let root=document.getElementById('toastRoot');if(root)return root;root=document.createElement('div');root.id='toastRoot';document.body.appendChild(root);return root;}
function showInAppToast({roomId,roomName,sender,text}){if(!state.notif.enabled||state.roomMute[roomId])return;const visible=document.visibilityState==='visible';if(visible&&state.roomId===roomId&&isMessagesAtBottom())return;const root=ensureToastRoot();while(root.children.length>=3){root.removeChild(root.firstElementChild);}const toast=document.createElement('button');toast.className='fp-toast';const t=document.createElement('strong');t.textContent=roomName||`Комната ${shortId(roomId)}`;const b=document.createElement('div');b.textContent=buildNotificationText(sender,text);toast.appendChild(t);toast.appendChild(b);toast.onclick=()=>{openChat(roomId);toast.remove();};root.appendChild(toast);setTimeout(()=>toast.remove(),4000);}
function notifyIncoming(sender,text,roomId,mine=false){if(shouldShowInAppToast({roomId,mine})){showInAppToast({roomId,roomName:state.roomNames[roomId],sender,text});}playNotificationSound({roomId,mine});}

function bindClick(id,handler){const el=document.getElementById(id); if(el) el.onclick=handler; return el;}
window.addEventListener('beforeinstallprompt',(event)=>{
  event.preventDefault();
  deferredInstallPrompt=event;
  if(typeof updateInstallUi==='function'){
    updateInstallUi();
  }
});
window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null;
  localStorage.setItem('fpchat:pwa-installed','1');
  if(typeof updateInstallUi==='function'){
    updateInstallUi();
  }
});
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
const restoreWsOnResume=()=>{const deviceId=String(localStorage.getItem(STORAGE.deviceId)||activeChatDeviceId||'').trim();if(!deviceId||(!state.chats.length&&!state.roomId))return;ensureStableWsConnected(deviceId).then(()=>{if(state.roomId&&activeChatDeviceId)flushPendingReads(state.roomId,activeChatDeviceId);}).catch(()=>{});};const handleAppResume=()=>{restoreWsOnResume();checkAppVersionOnEntry();};
window.addEventListener('focus',handleAppResume);
window.addEventListener('beforeunload',saveViewStateForLifecycle);
window.addEventListener('pagehide',saveViewStateForLifecycle);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveViewStateForLifecycle();sendClientState();if(document.visibilityState==='visible'){handleAppResume();flushPendingReads(state.roomId,activeChatDeviceId);}});window.addEventListener('focus',sendClientState);window.addEventListener('pageshow',()=>{lastLifecycleViewStateSaveAt=0;sendClientState();flushPendingReads(state.roomId,activeChatDeviceId);});window.addEventListener('pageshow',handleAppResume);

window.addEventListener('popstate',()=>{const handled=handleAndroidBackNavigation();if(handled){pushAppHistoryState();}});

document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>{setView(b.dataset.view); closeMobileMenu();}); els.search.oninput=renderChats;
document.addEventListener('click',(event)=>{const target=event.target?.closest?.('.chat-row,#createBtn,#joinBtn,#pasteJoinBtn,#restoreBtn');if(target)void maybeRequestNotificationsFromUserGesture();},true);
pushAppHistoryState();
(async()=>{
  await registerServiceWorker();
  const updateStarted=await checkAppVersionOnEntry();
  if(updateStarted)return;
  void getPushConfig().then(()=>{if(document.getElementById('notificationPermissionStatus'))renderNotificationPermissionStatus();});
  void initializeNotifications();
  applyTheme(localStorage.getItem(STORAGE.theme)||'auto');
  const inv=parseInvite();
  const chat=parseChat();

  if(inv){
    if(inv.error==='legacy'){alert('Старая invite-ссылка больше не поддерживается. Попросите новую ссылку.');hideBootSplash();return;}
    await joinByInviteText(`${location.origin}/i/${inv.inviteCode}`);
    hideBootSplash();
    return;
  }

  if(chat){
    const hasAccess=STORAGE.get(STORAGE.roomState(chat));
    if(hasAccess){
      upsertChat(chat,{});
      await openChat(chat);
      hideBootSplash();
      return;
    }
    els.content.innerHTML=`<div class='panel'><h2>Нет локального доступа к этому чату</h2><p>Восстановите доступ по recovery-коду или войдите по invite-ссылке</p><div class='panel-actions'><button id='goRestore' class='btn btn-primary'>Восстановить</button><button id='goJoinFromChat' class='btn btn-secondary'>Присоединиться по invite-ссылке</button><button id='goChatsList' class='btn btn-secondary'>К списку чатов</button></div></div>`;
    bindClick('goRestore',()=>setView('restore'));bindClick('goJoinFromChat',()=>setView('join'));bindClick('goChatsList',()=>showChatsList());
    showContentPane();
    hideBootSplash();
    return;
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
let pushSetupInFlight=null;
let pushConfigCache=null;
let pushConfigPromise=null;
function canUsePushNotifications(){return typeof navigator!=='undefined'&&'serviceWorker' in navigator&&typeof window!=='undefined'&&'PushManager' in window&&typeof Notification!=='undefined';}
function getNotificationPermission(){return canUsePushNotifications()?Notification.permission:'unsupported';}
async function getPushConfig(){
  if(pushConfigCache)return pushConfigCache;
  if(pushConfigPromise)return pushConfigPromise;
  pushConfigPromise=fetch('/api/push/vapid-public-key',{cache:'no-store'}).then(async(response)=>{
    if(!response.ok)return {enabled:false};
    const payload=await response.json();
    return payload?.enabled&&typeof payload.publicKey==='string'&&payload.publicKey?{enabled:true,publicKey:payload.publicKey}:{enabled:false};
  }).catch(()=>({enabled:false})).then((config)=>{pushConfigCache=config;return config;}).finally(()=>{pushConfigPromise=null;});
  return pushConfigPromise;
}
async function ensurePushSubscription({requestPermission=false,showErrors=false}={}){
  if(pushSetupInFlight)return pushSetupInFlight;
  const run=async()=>{
    const fail=(message)=>{if(showErrors&&message)alert(message);return null;};
    if(!canUsePushNotifications())return fail('Push-уведомления недоступны в этом браузере или на этом устройстве.');
    if(pushConfigCache&&!pushConfigCache.enabled)return fail('Push-уведомления сейчас недоступны на сервере.');
    let permission=Notification.permission;
    if(permission==='denied')return fail('Уведомления запрещены браузером. Разрешите их для сайта в настройках браузера.');
    if(permission==='default'){
      if(!requestPermission)return null;
      try{
        permission=await Notification.requestPermission();
      }catch{
        return fail('Не удалось запросить разрешение на уведомления.');
      }
      if(permission!=='granted')return fail(permission==='denied'?'Уведомления запрещены браузером. Разрешите их для сайта в настройках браузера.':'Разрешение на уведомления не предоставлено.');
    }
    if(permission!=='granted')return null;
    const cfg=await getPushConfig();
    if(!cfg.enabled||!cfg.publicKey)return fail('Push-уведомления сейчас недоступны на сервере.');
    try{
      const registration=await navigator.serviceWorker.ready;
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64ToUint8Array(cfg.publicKey)});
      return subscription;
    }catch(error){
      console.warn('Push subscription failed',error);
      return fail('Не удалось включить push-уведомления. Попробуйте ещё раз.');
    }
  };
  const pending=run();
  pushSetupInFlight=pending;
  try{return await pending;}finally{if(pushSetupInFlight===pending)pushSetupInFlight=null;}
}
function serializePushSubscription(subscription){if(!subscription)return null;try{return typeof subscription.toJSON==='function'?subscription.toJSON():subscription;}catch{return null;}}
async function syncRoomPushSubscription(roomId,{requestPermission=false,showErrors=false,subscription=null}={}){
  if(!state.notif.enabled||state.roomMute[roomId])return false;
  const persisted=STORAGE.get(STORAGE.roomState(roomId));
  if(!persisted?.deviceId)return false;
  const pushSubscription=subscription||await ensurePushSubscription({requestPermission,showErrors});
  const serialized=serializePushSubscription(pushSubscription);
  if(!serialized)return false;
  try{
    const response=await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,deviceId:persisted.deviceId,subscription:serialized,settings:{showText:state.notif.showText,hideSender:state.notif.hideSender}})});
    if(!response.ok&&showErrors)alert('Не удалось сохранить подписку на уведомления для этого чата.');
    return response.ok;
  }catch{
    if(showErrors)alert('Не удалось подключиться для сохранения уведомлений.');
    return false;
  }
}
function getLocalRoomDevicePairs(){const unique=new Map();for(const chat of state.chats){const roomId=chat?.roomId;if(!roomId)continue;const st=STORAGE.get(STORAGE.roomState(roomId));const deviceId=st?.deviceId;if(!deviceId)continue;unique.set(`${roomId}::${deviceId}`,{roomId,deviceId});}return [...unique.values()];}
async function syncAllPushSubscriptions({requestPermission=false,showErrors=false,subscription=null}={}){
  if(!state.notif.enabled)return false;
  const pushSubscription=subscription||await ensurePushSubscription({requestPermission,showErrors});
  const serialized=serializePushSubscription(pushSubscription);
  if(!serialized)return false;
  let synced=false;
  for(const {roomId,deviceId} of getLocalRoomDevicePairs()){
    if(state.roomMute[roomId])continue;
    try{
      const response=await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,deviceId,subscription:serialized,settings:{showText:state.notif.showText,hideSender:state.notif.hideSender}})});
      if(response.ok)synced=true;
      else if(showErrors)console.warn('Push subscription sync failed',roomId,response.status);
    }catch(error){
      if(showErrors)console.warn('Push subscription sync failed',roomId,error);
    }
  }
  return synced;
}
async function updateAllPushSettings({showErrors=false}={}){
  let updated=false;
  for(const {roomId,deviceId} of getLocalRoomDevicePairs()){
    try{
      const response=await fetch('/api/push/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,deviceId,showText:state.notif.showText,hideSender:state.notif.hideSender})});
      if(response.ok)updated=true;
      else if(showErrors)console.warn('Push settings update failed',roomId,response.status);
    }catch(error){
      if(showErrors)console.warn('Push settings update failed',roomId,error);
    }
  }
  return updated;
}
async function unsubscribeAllPushDevices(){
  const deviceIds=[...new Set(getLocalRoomDevicePairs().map((p)=>p.deviceId))];
  let unsubscribed=false;
  for(const deviceId of deviceIds){
    try{
      const response=await fetch('/api/push/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId})});
      if(response.ok)unsubscribed=true;
    }catch{}
  }
  return unsubscribed;
}
function notificationsAppEnabled(){const checkbox=document.getElementById('nEnabled');return checkbox?checkbox.checked:state.notif.enabled;}
function updateNotificationOptionControls(){const enabled=notificationsAppEnabled();['nText','nSender','nSound'].forEach((id)=>{const option=document.getElementById(id);if(option)option.disabled=!enabled;});}
function notificationPermissionStatusText(){const appEnabled=notificationsAppEnabled();const permission=getNotificationPermission();if(!appEnabled)return'Уведомления выключены в настройках FPChat.';if(permission==='unsupported')return'Этот браузер или устройство не поддерживает push-уведомления.';if(pushConfigCache&&!pushConfigCache.enabled)return'Push-уведомления сейчас недоступны на сервере.';if(permission==='granted')return'Разрешение браузера выдано. Push будет работать для доступных чатов.';if(permission==='denied')return'Браузер заблокировал уведомления. Разрешите их в настройках сайта браузера.';return'Уведомления включены в FPChat. Разрешите их в браузере, чтобы получать сообщения вне открытой вкладки.';}
function renderNotificationPermissionStatus(){const status=document.getElementById('notificationPermissionStatus');const button=document.getElementById('requestNotificationsBtn');const permission=getNotificationPermission();const appEnabled=notificationsAppEnabled();if(status)status.textContent=notificationPermissionStatusText();if(!button)return;button.classList.toggle('hidden',permission==='unsupported'||(permission==='granted'&&appEnabled));if(!appEnabled)button.textContent='Включить уведомления';else if(permission==='denied')button.textContent='Как разрешить уведомления';else button.textContent='Разрешить уведомления';}
async function enableNotificationsFromSettings(){const checkbox=document.getElementById('nEnabled');if(checkbox)checkbox.checked=true;state.notif={...normalizeNotificationSettings(state.notif),enabled:true};STORAGE.set(STORAGE.notif,state.notif);updateNotificationOptionControls();const subscription=await ensurePushSubscription({requestPermission:true,showErrors:true});if(subscription){await syncAllPushSubscriptions({subscription});await updateAllPushSettings();}renderNotificationPermissionStatus();}
async function initializeNotifications(){if(!state.notif.enabled||getNotificationPermission()!=='granted')return false;return syncAllPushSubscriptions();}
async function maybeRequestNotificationsFromUserGesture({force=false}={}){
  if(!state.notif.enabled||!canUsePushNotifications())return null;
  const permission=Notification.permission;
  if(permission==='granted')return null;
  if(permission!=='default')return null;
  if(!force&&localStorage.getItem(NOTIFICATION_PROMPTED_KEY)==='1')return null;
  if(!force)localStorage.setItem(NOTIFICATION_PROMPTED_KEY,'1');
  const subscription=await ensurePushSubscription({requestPermission:true});
  if(subscription)await syncAllPushSubscriptions({subscription});
  renderNotificationPermissionStatus();
  return subscription;
}
async function updatePushBadge(){const unread=state.chats.reduce((a,c)=>a+(c.unread||0),0);if(unread===0&&navigator.clearAppBadge){try{await navigator.clearAppBadge();}catch{}}else if(unread>0&&navigator.setAppBadge){try{await navigator.setAppBadge(unread);}catch{}}}
async function updateUnreadPresentation(){const unread=state.chats.reduce((a,c)=>a+(c.unread||0),0);document.title=unread>0?`(${unread}) FPChat`:'FPChat';await updatePushBadge();}
if('serviceWorker' in navigator){navigator.serviceWorker.addEventListener('message',async(event)=>{const data=event.data||{};if(data.type!=='open-chat')return;const roomId=data.roomId;if(!roomId){showChatsList();return;}const hasRoom=STORAGE.get(STORAGE.roomState(roomId));if(hasRoom){upsertChat(roomId,{});await openChat(roomId);}else{showChatsList();alert('Нет локального доступа к этому чату. Восстановите доступ по recovery-коду или invite-ссылке.');}});}
async function createImageBitmapFromFile(file){return new Promise((resolve,reject)=>{const img=new Image();const url=URL.createObjectURL(file);img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('image decode failed'));};img.src=url;});}
function fitSize(w,h,maxSide){const scale=Math.min(1,maxSide/Math.max(w,h));return {w:Math.max(1,Math.round(w*scale)),h:Math.max(1,Math.round(h*scale))};}
async function createImageThumbBlob(file){const img=await createImageBitmapFromFile(file);const d=fitSize(img.naturalWidth||img.width,img.naturalHeight||img.height,MEDIA_LIMITS.thumbMaxSide);const c=document.createElement('canvas');c.width=d.w;c.height=d.h;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,d.w,d.h);const blob=await new Promise(r=>c.toBlob(r,'image/webp',MEDIA_LIMITS.thumbQuality));return {thumbnailBlob:blob,width:img.naturalWidth||img.width,height:img.naturalHeight||img.height,durationSeconds:null};}
async function compressImageFile(file){
  const steps=[{maxSide:2560,quality:0.85},{maxSide:2200,quality:0.82},{maxSide:1920,quality:0.80}];
  let source=file;
  for(const step of steps){
    const img=await createImageBitmapFromFile(source);
    const d=fitSize(img.naturalWidth||img.width,img.naturalHeight||img.height,step.maxSide);
    const c=document.createElement('canvas');c.width=d.w;c.height=d.h;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,d.w,d.h);
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',step.quality));
    if(!blob)continue;
    source=new File([blob],file.name,{type:'image/jpeg',lastModified:file.lastModified||Date.now()});
    if(source.size<=MEDIA_LIMITS.maxImageSize)return source;
  }
  alert('Не удалось сжать фото до 10 МБ без сильной потери качества.');
  return null;
}
async function createVideoThumbBlob(file){
  const objectUrl=URL.createObjectURL(file);
  try{
    const video=document.createElement('video');video.preload='metadata';video.src=objectUrl;video.muted=true;video.playsInline=true;
    await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error('video metadata failed'));});
    const durationSeconds=Number.isFinite(video.duration)?video.duration:null;
    const seekTime=durationSeconds&&durationSeconds>0.2?0.2:0;
    await new Promise((resolve)=>{const done=()=>resolve();video.onseeked=done;try{video.currentTime=seekTime;}catch{resolve();}setTimeout(resolve,600);});
    const d=fitSize(video.videoWidth||640,video.videoHeight||360,480);
    const c=document.createElement('canvas');c.width=d.w;c.height=d.h;const ctx=c.getContext('2d');ctx.drawImage(video,0,0,d.w,d.h);
    const thumbnailBlob=await new Promise(r=>c.toBlob(r,'image/webp',0.75));
    return {thumbnailBlob:thumbnailBlob||new Blob([], {type:'image/webp'}),width:video.videoWidth||null,height:video.videoHeight||null,durationSeconds};
  }finally{URL.revokeObjectURL(objectUrl);}
}
async function deleteUploadedPendingMedia(items){const persisted=STORAGE.get(STORAGE.roomState(state.roomId));if(!persisted?.deviceId||!state.roomId)return;const mediaIds=items.map((item)=>item.uploadedMedia?.id).filter(Boolean);if(!mediaIds.length)return;await fetch(`/api/rooms/${state.roomId}/media/pending`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:persisted.deviceId,mediaIds})}).catch(()=>{});}
async function openMediaPreviewFromFiles(rawFiles){let files=[...rawFiles];if(files.length>MEDIA_LIMITS.maxFiles){alert('Можно отправить максимум 10 файлов за раз.');files=files.slice(0,MEDIA_LIMITS.maxFiles);}const items=[];let total=0;for(const originalFile of files){let f=originalFile;const type=f.type||'';const isImg=ALLOWED_IMAGE_TYPES.has(type)||type.startsWith('image/');const isVid=ALLOWED_VIDEO_TYPES.has(type)||type.startsWith('video/');if(!isImg&&!isVid)continue;if(isVid&&f.size>MEDIA_LIMITS.maxVideoSize){alert('Видео больше 100 МБ. Сожмите его перед отправкой.');continue;}if(isImg&&f.size>MEDIA_LIMITS.maxImageSize){const shouldCompress=confirm('Фото больше 10 МБ. Сжать перед отправкой?');if(!shouldCompress)continue;const compressed=await compressImageFile(f);if(!compressed)continue;f=compressed;}if(total+f.size>MEDIA_LIMITS.maxTotalSize)break;const objectUrl=URL.createObjectURL(f);let thumb;let meta={width:null,height:null,durationSeconds:null};if(isImg){const t=await createImageThumbBlob(f);thumb=t.thumbnailBlob;meta=t;}else{const t=await createVideoThumbBlob(f).catch(()=>null);if(t){thumb=t.thumbnailBlob;meta=t;}else{thumb=new Blob([],{type:'image/webp'});}}const thumbUrl=thumb.size?URL.createObjectURL(thumb):objectUrl;items.push({id:crypto.randomUUID(),file:f,kind:isVid?'video':'image',objectUrl,thumbnailBlob:thumb,thumbnailObjectUrl:thumbUrl,width:meta.width,height:meta.height,durationSeconds:meta.durationSeconds,uploadedMedia:null,uploadError:null});total+=f.size;}
if(!items.length)return;mediaPreviewState={items,caption:'',sending:false,failedIndex:null};renderMediaPreviewModal();}
function closeMediaPreviewModal(){if(!mediaPreviewState)return;mediaPreviewState.items.forEach((i)=>{try{URL.revokeObjectURL(i.objectUrl);}catch{}try{URL.revokeObjectURL(i.thumbnailObjectUrl);}catch{}});mediaPreviewState=null;const root=document.getElementById('mediaPreviewRoot');if(root)root.innerHTML='';}
function renderMediaPreviewModal(){const root=document.getElementById('mediaPreviewRoot');if(!root||!mediaPreviewState)return;const items=mediaPreviewState.items;const gridClass=items.length===1?'one':(items.length<=4?'few':'many');root.innerHTML=`<div class="media-preview-overlay"><div class="media-preview-sheet"><div class="media-preview-header"><button class="media-preview-remove" type="button">×</button><div class="media-preview-count">${items.length>1?`✓ ${items.length}`:''}</div><strong>Выбрано ${items.length}</strong></div><div class="media-preview-grid ${gridClass}">${items.map((item,idx)=>`<div class="media-preview-item" data-idx="${idx}"><img src="${item.thumbnailObjectUrl||item.objectUrl}"><span class="media-preview-order">${idx+1}</span><button class="media-preview-remove media-item-remove" type="button" data-remove="${idx}">×</button>${item.kind==='video'?'<span class="media-video-play">▶</span>':''}</div>`).join('')}</div><div class="media-preview-footer"><textarea class="media-caption-input" placeholder="Добавить подпись...">${safeText(mediaPreviewState.caption||'')}</textarea><button class="media-send-btn" type="button">➤</button><div class="media-upload-progress"></div></div></div></div>`;
root.querySelector('.media-preview-overlay').onclick=async(e)=>{if(e.target.classList.contains('media-preview-overlay')){await deleteUploadedPendingMedia(mediaPreviewState?.items||[]);closeMediaPreviewModal();}};root.querySelector('.media-preview-header .media-preview-remove').onclick=async()=>{await deleteUploadedPendingMedia(mediaPreviewState?.items||[]);closeMediaPreviewModal();};root.querySelectorAll('[data-remove]').forEach(btn=>btn.onclick=()=>{const idx=Number(btn.dataset.remove);const [x]=mediaPreviewState.items.splice(idx,1);if(x){URL.revokeObjectURL(x.objectUrl);URL.revokeObjectURL(x.thumbnailObjectUrl);}if(!mediaPreviewState.items.length)closeMediaPreviewModal();else renderMediaPreviewModal();});root.querySelector('.media-caption-input').oninput=(e)=>{mediaPreviewState.caption=e.target.value;};root.querySelector('.media-send-btn').onclick=()=>sendMediaFromPreview(root);
}
async function sendMediaFromPreview(root){if(!mediaPreviewState||mediaPreviewState.sending)return;mediaPreviewState.sending=true;const persisted=STORAGE.get(STORAGE.roomState(state.roomId));const btn=root.querySelector('.media-send-btn');const prog=root.querySelector('.media-upload-progress');const total=mediaPreviewState.items.length;for(let i=0;i<total;i++){const item=mediaPreviewState.items[i];if(item.uploadedMedia)continue;btn.textContent='…';prog.textContent=`Загрузка ${Math.round((i/total)*100)}%`;const encryptedFile=await encryptBlobWithIvPrefix(item.file);const encryptedThumb=await encryptBlobWithIvPrefix(item.thumbnailBlob);const nameEnc=await encryptText(item.file.name||'media');const fd=new FormData();fd.append('deviceId',persisted.deviceId);fd.append('encryptedFile',encryptedFile,'file.bin');fd.append('encryptedThumbnail',encryptedThumb,'thumb.bin');fd.append('originalNameCiphertext',nameEnc.ciphertext);fd.append('originalNameIv',nameEnc.iv);fd.append('mimeType',item.file.type);fd.append('mediaKind',item.kind);fd.append('sizeBytes',String(item.file.size));fd.append('encryptedSizeBytes',String(encryptedFile.size));fd.append('thumbSizeBytes',String(item.thumbnailBlob.size));fd.append('thumbEncryptedSizeBytes',String(encryptedThumb.size));fd.append('width',String(item.width||0));fd.append('height',String(item.height||0));fd.append('durationSeconds',String(item.durationSeconds||0));fd.append('fileOrder',String(i));try{item.uploadedMedia=await uploadEncryptedMediaXhr(state.roomId,persisted.deviceId,fd,(l,t)=>{if(t)prog.textContent=`Загрузка ${Math.round(((i+l/t)/total)*100)}%`;});}catch{const retry=confirm(`Не удалось загрузить файл ${i+1} из ${total}. Повторить?`);if(retry){i--;continue;}mediaPreviewState.sending=false;return;}}
const ok=await ensureWsConnected(activeChatDeviceId);if(!ok||!state.ws||state.ws.readyState!==WebSocket.OPEN||state.ws.deviceId!==activeChatDeviceId){alert('Нет соединения. Попробуйте обновить чат.');mediaPreviewState.sending=false;return;}const caption=(mediaPreviewState.caption||'').trim();const enc=await encryptText(caption||'');const draft=ensureDraftState(state.roomId);const replyToMessageId=draft.replyTo?.messageId||null;if(replyToMessageId){markReplyTargetRead(replyToMessageId);}const mediaIds=mediaPreviewState.items.map(x=>x.uploadedMedia?.id).filter(Boolean);const notificationPreview=caption?caption.slice(0,80):buildMediaFallbackText(mediaPreviewState.items.map(x=>({media_kind:x.kind})),caption);try{state.ws.send(JSON.stringify({type:'message:new',roomId:state.roomId,messageType:'media',ciphertext:enc.ciphertext,iv:enc.iv,notificationPreview,replyToMessageId,mediaIds}));}catch{alert('Не удалось отправить сообщение. Проверьте соединение.');mediaPreviewState.sending=false;return;}draft.replyTo=null;await clearDraftOnServer(state.roomId);closeMediaPreviewModal();}
