const STORAGE={roomState:(id)=>`fpchat:room:${id}`,activeChatsKey:'fpchat:active-chats',lastSelectedRoomId:'lastSelectedRoomId',nick:'fpchat:nick',theme:'fpchat:theme',roomNames:'fpchat:room-names',notif:'fpchat:notif',roomMute:'fpchat:room-mute',set:(k,v)=>localStorage.setItem(k,JSON.stringify(v)),get:(k)=>{const v=localStorage.getItem(k);return v?JSON.parse(v):null;}};
const state={view:'chats',roomId:null,secret:null,key:null,ws:null,me:null,chats:STORAGE.get(STORAGE.activeChatsKey)||[],roomNames:STORAGE.get(STORAGE.roomNames)||{},nick:localStorage.getItem(STORAGE.nick)||`Гость-${String(Math.floor(Math.random()*100000)).padStart(5,'0')}`,notif:STORAGE.get(STORAGE.notif)||{enabled:false,showText:true,hideSender:false,sound:true},roomMute:STORAGE.get(STORAGE.roomMute)||{},presence:{},localConnectionState:'disconnected',drafts:{}};localStorage.setItem(STORAGE.nick,state.nick);
const messageCache=new Map();
const SWIPE_REPLY_THRESHOLD=52;
const SWIPE_CANCEL_VERTICAL=28;
const CHAT_BACK_SWIPE_THRESHOLD=80;
const CHAT_BACK_VERTICAL_CANCEL=40;
const CHAT_BACK_MAX_TRANSLATE=120;
const DRAFT_SAVE_DEBOUNCE_MS=700;
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
let activeChatDeviceId=null;let pendingIncomingReadIds=[];let unreadVisibleObserver=null;let appWsSeq=0;let activeAppWsSeq=0;let appWsConnectInFlight=null;
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
function setSelectedReply(roomId,replyTo){if(!roomId)return;const draft=ensureDraftState(roomId);draft.replyTo=replyTo;updateReplyComposerBar();void saveDraftNow(roomId);document.getElementById('msgInput')?.focus();}
function clearSelectedReply(roomId){if(!roomId)return;const draft=ensureDraftState(roomId);draft.replyTo=null;updateReplyComposerBar();void saveDraftNow(roomId);}
function updateReplyComposerBar(){const bar=document.getElementById('replyComposerBar');if(!bar||!state.roomId)return;const draft=ensureDraftState(state.roomId);const reply=draft.replyTo;if(!reply){bar.classList.add('hidden');bar.innerHTML='';return;}bar.classList.remove('hidden');bar.innerHTML=`<div class="reply-composer-content"><div class="reply-composer-author"></div><div class="reply-composer-preview"></div></div><button class="reply-composer-close" type="button" aria-label="Отменить ответ">×</button>`;bar.querySelector('.reply-composer-author').textContent=reply.author||'Неизвестно';bar.querySelector('.reply-composer-preview').textContent=reply.preview||'Сообщение недоступно';bar.querySelector('.reply-composer-close').onclick=()=>clearSelectedReply(state.roomId);}
function scheduleDraftSave(roomId){if(!roomId)return;const draft=ensureDraftState(roomId);clearTimeout(draft.saveTimer);draft.saveTimer=setTimeout(()=>{void saveDraftNow(roomId);},DRAFT_SAVE_DEBOUNCE_MS);}
async function saveDraftNow(roomId){if(!roomId)return;const draft=ensureDraftState(roomId);clearTimeout(draft.saveTimer);draft.saveTimer=null;const persisted=STORAGE.get(STORAGE.roomState(roomId));if(!persisted?.deviceId||!state.key)return;const text=draft.text||'';const replyToMessageId=draft.replyTo?.messageId||null;if(!text.trim()&&!replyToMessageId){await clearDraftOnServer(roomId);renderChats();return;}const body={deviceId:persisted.deviceId,replyToMessageId};if(text.trim()){const enc=await encryptText(text);body.ciphertext=enc.ciphertext;body.iv=enc.iv;}else{body.ciphertext=null;body.iv=null;}await fetch(`/api/rooms/${roomId}/draft`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(()=>{});renderChats();}
async function clearDraftOnServer(roomId){if(!roomId)return;const persisted=STORAGE.get(STORAGE.roomState(roomId));if(!persisted?.deviceId)return;const draft=ensureDraftState(roomId);clearTimeout(draft.saveTimer);draft.saveTimer=null;draft.text='';draft.replyTo=null;await fetch(`/api/rooms/${roomId}/draft`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:persisted.deviceId})}).catch(()=>{});renderChats();}
async function loadDraftForCurrentRoom(){const roomId=state.roomId;const persisted=STORAGE.get(STORAGE.roomState(roomId));const input=document.getElementById('msgInput');if(!roomId||!persisted?.deviceId||!input||!state.key)return;const draft=ensureDraftState(roomId);draft.loaded=true;let res;try{res=await fetch(`/api/rooms/${roomId}/draft?deviceId=${encodeURIComponent(persisted.deviceId)}`);}catch{return;}if(!res.ok)return;const data=await res.json().catch(()=>null);const serverDraft=data?.draft;if(!serverDraft){draft.text='';draft.replyTo=null;input.value='';updateReplyComposerBar();autoResizeMessageInput(input);renderChats();return;}let text='';if(serverDraft.ciphertext&&serverDraft.iv){try{text=await decryptText(serverDraft.iv,serverDraft.ciphertext);}catch{text='';}}draft.text=text;input.value=text;autoResizeMessageInput(input);if(serverDraft.reply_to_message_id){draft.replyTo=getMessageReplyMeta(serverDraft.reply_to_message_id);}else{draft.replyTo=null;}updateReplyComposerBar();renderChats();}
function showMessageReplyMenu(messageId,x,y){hideMessageReplyMenu();const menu=document.createElement('div');menu.className='message-reply-menu';menu.innerHTML='<button type="button">Ответить</button>';menu.querySelector('button').onclick=()=>{const replyTo=getMessageReplyMeta(messageId);setSelectedReply(state.roomId,replyTo);hideMessageReplyMenu();};document.body.appendChild(menu);const margin=8;const rect=menu.getBoundingClientRect();let left=Math.min(x,window.innerWidth-rect.width-margin);let top=Math.min(y,window.innerHeight-rect.height-margin);left=Math.max(margin,left);top=Math.max(margin,top);menu.style.left=`${left}px`;menu.style.top=`${top}px`;setTimeout(()=>{document.addEventListener('click',hideMessageReplyMenu,{once:true});});}
function hideMessageReplyMenu(){document.querySelector('.message-reply-menu')?.remove();}
async function findAndFocusReplyMessage(messageId){const target=document.querySelector(`.msg[data-message-id="${messageId}"]`);if(!target){alert('Сообщение не найдено');return;}target.scrollIntoView({behavior:'smooth',block:'center'});target.classList.add('reply-highlight');setTimeout(()=>target.classList.remove('reply-highlight'),1400);}
function getMessageReplyMeta(messageId){const cached=messageCache.get(Number(messageId));if(cached)return{messageId:Number(messageId),author:cached.author||'Неизвестно',preview:cached.preview||'Сообщение недоступно',kind:cached.kind||'text'};return{messageId:Number(messageId),author:'Неизвестно',preview:'Сообщение недоступно',kind:'text'};}
function upsertChat(roomId,patch={}){const i=state.chats.findIndex(x=>x.roomId===roomId);const existing=i>=0?state.chats[i]:null;const next={...(existing||{roomId,unread:0}),...patch,roomId};if(!next.lastActivity){next.lastActivity=existing?.lastActivity||new Date().toISOString();}if(i>=0)state.chats[i]=next; else state.chats.push(next); state.chats.sort((a,b)=>new Date(b.lastActivity)-new Date(a.lastActivity)); saveChats(); renderChats();}
function safeScrollToBottom(box=document.getElementById('messages')){if(!box)return;requestAnimationFrame(()=>{requestAnimationFrame(()=>{box.scrollTop=box.scrollHeight;});});}
function upsertRoomMessage(roomId,message,opts={}){if(!roomId||!message)return{chat:null,isDuplicate:false};const existing=state.chats.find(c=>c.roomId===roomId)||{};const mediaPayload=Array.isArray(message.media)?message.media:[];const textValue=String(opts.text??'').trim();const lastMessage=message.type==='media'?buildMediaFallbackText(mediaPayload,textValue):textValue||existing.lastMessage||'';const messageId=Number(message.id);const knownIds=Array.isArray(existing.messageIds)?existing.messageIds:[];const isTrackedId=Number.isInteger(messageId)&&messageId>0;const isDuplicate=isTrackedId?knownIds.includes(messageId):false;const nextMessageIds=isTrackedId?[...knownIds.filter((id)=>id!==messageId),messageId].slice(-300):knownIds.slice(-300);const patch={lastMessage,lastSender:message.sender_name||existing.lastSender||'',lastActivity:message.created_at||new Date().toISOString(),messageIds:nextMessageIds};if(typeof opts.unread==='number'&&opts.unread>=0)patch.unread=opts.unread;upsertChat(roomId,patch);return{chat:state.chats.find(c=>c.roomId===roomId)||null,isDuplicate};}
function getChatSortTs(chat){const ts=chat?.updatedAt||chat?.lastMessageAt||chat?.lastActivity||'1970-01-01T00:00:00.000Z';const n=new Date(ts).getTime();return Number.isFinite(n)?n:0;}
function setActiveNav(v){document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===v));}
function showListPane(){els.appRoot?.setAttribute('data-pane','list'); els.appRoot?.classList.remove('mobile-chat');}
function showContentPane(){els.appRoot?.setAttribute('data-pane','content');}
function setView(v){state.view=v; setActiveNav(v); closeMobileMenu(); if(v==='chats'){showListPane(); renderMainChatsPlaceholder(); return;} if(v==='create'){renderCreate(); showContentPane(); return;} if(v==='restore'){renderRestore(); showContentPane(); return;} if(v==='join'){renderJoin(); showContentPane(); return;} if(v==='settings'){renderSettings(); showContentPane();}}
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

function renderChats(){const q=els.search.value?.toLowerCase()||''; let chats=[...state.chats].sort((a,b)=>getChatSortTs(b)-getChatSortTs(a)).filter(c=>{const n=(state.roomNames[c.roomId]||'').toLowerCase(); return [n,c.roomId,(c.lastMessage||'').toLowerCase()].some(s=>s.includes(q));}); els.rows.innerHTML=''; if(els.empty){ els.empty.classList.toggle('hidden', chats.length>0); } chats.forEach(c=>{const displayLastSender=safeText(c.lastSender||'');const minePrefix=c.lastSender===state.nick?'Вы: ':c.lastSender?`${displayLastSender}: `:'';const draft=state.drafts[c.roomId];const hasDraft=Boolean(draft&&(draft.text?.trim()||draft.replyTo));const displayLastMessage=safeText(c.lastMessage||'');const displayDraftText=safeText(draft?.text?.trim()||'');const lastHtml=hasDraft?`<div class='last'><span class='draft-label'>Черновик</span>${draft.text?.trim()?`<div class='draft-text'>${displayDraftText}</div>`:''}</div>`:`<div class='last'>${state.roomMute[c.roomId]?'🔕 ':''}${minePrefix}${displayLastMessage}</div>`;const row=document.createElement('div'); row.className='chat-row'+(c.roomId===state.roomId?' active':'')+(c.unread?' unread':''); const displayRoomName=safeText(state.roomNames[c.roomId]||`Комната ${shortId(c.roomId)}`);const displaySystemRoom=safeText(`Комната ${shortId(c.roomId)}`);row.innerHTML=`<div class='row-top'><div><div><strong>${displayRoomName}</strong></div>${state.roomNames[c.roomId]?`<div class='sys'>${displaySystemRoom}</div>`:''}</div><div class="chat-row-meta">${c.unread>0?`<span class="chat-unread-badge">${c.unread>99?'99+':c.unread}</span>`:''}<span class="chat-time">${formatChatListTime(c.lastActivity)}</span></div></div><div class='row-top'>${lastHtml}</div>`; let longPressTimer=null; let longPressTriggered=false; let suppressNextClickUntil=0; let startX=0; let startY=0; row.addEventListener('touchstart',(e)=>{const touch=e.touches?.[0]; if(!touch)return; startX=touch.clientX; startY=touch.clientY; longPressTriggered=false; if(longPressTimer){clearTimeout(longPressTimer);} longPressTimer=setTimeout(()=>{longPressTriggered=true; suppressNextClickUntil=Date.now()+500; showRoomMenu(c.roomId,startX,startY);navigator.vibrate?.(10);},600);},{passive:true}); row.addEventListener('touchmove',(e)=>{const touch=e.touches?.[0]; if(!touch||!longPressTimer)return; if(Math.abs(touch.clientX-startX)>10||Math.abs(touch.clientY-startY)>10){clearTimeout(longPressTimer);longPressTimer=null;}},{passive:true}); row.addEventListener('touchend',(e)=>{if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;} if(longPressTriggered===true){e.preventDefault();e.stopPropagation();longPressTriggered=false;}}, {passive:false}); row.addEventListener('touchcancel',()=>{if(longPressTimer){clearTimeout(longPressTimer);} longPressTimer=null; longPressTriggered=false;}); row.onclick=(e)=>{if(longPressTriggered===true||Date.now()<suppressNextClickUntil){e.preventDefault();e.stopPropagation();return;}openChat(c.roomId);}; row.oncontextmenu=(e)=>{e.preventDefault();e.stopPropagation();showRoomMenu(c.roomId,e.clientX,e.clientY)}; els.rows.appendChild(row);});}
function renderMainChatsPlaceholder(){els.content.innerHTML='';}
function parseInvite(){const m=location.pathname.match(/^\/i\/([A-Z0-9]{16,64})$/i);if(!m)return null; if(location.hash){return {error:'legacy'};} return {inviteCode:m[1]};}
function getKnownDeviceIds(){const ids=new Set();for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key||!key.startsWith('fpchat:room:'))continue;const val=STORAGE.get(key);if(val?.deviceId)ids.add(String(val.deviceId));}return [...ids];}
function parseChat(){const m=location.pathname.match(/^\/chat\/([A-Z0-9]{16})$/); return m?m[1]:null;}
async function openChatWithJoinData(roomId,secret,deviceId,data,key=null){
  state.roomId=roomId;
  state.secret=secret;
  if(key)state.key=key;
  state.me=data.participant;
  state.presence={};
  (data.participants||[]).forEach((item)=>{if(!item?.deviceId)return;state.presence[item.deviceId]={deviceId:item.deviceId,displayName:item.displayName,online:Boolean(item.online),lastSeenAt:item.lastSeenAt||null};});
  localStorage.setItem(STORAGE.lastSelectedRoomId,roomId);
  const last=data.messages?.[data.messages.length-1];
  const historyPatch={unread:0};
  if(last){historyPatch.lastActivity=last.created_at; const existing=state.chats.find(c=>c.roomId===roomId); if(!existing?.lastSender){historyPatch.lastSender=last.sender_name||'';}}
  upsertChat(roomId,historyPatch);
  syncRoomPushSubscription(roomId).catch(()=>{});
  showContentPane();
  els.appRoot?.classList.add('mobile-chat');
  await renderChatView(data.messages,deviceId);
  connectWs(deviceId);sendClientState();
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
  const deviceId=crypto.randomUUID();
  let res;
  try{
    res=await fetch(`/api/invites/${parsed.inviteCode}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName,deviceId})});
  }catch{
    alert('Не удалось подключиться. Проверьте соединение.');
    return false;
  }
  if(res.status===404){alert('Invite-ссылка недействительна.');return false;}
  if(res.status===410){alert('Invite-ссылка устарела или уже использована.');return false;}
  if(res.status===409){alert('В этот чат уже присоединился второй участник.');return false;}
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
function isMessagesAtBottom(){const box=document.getElementById('messages');if(!box)return true;return box.scrollHeight-box.scrollTop-box.clientHeight<120;}
function markIncomingMessagesRead(roomId,deviceId,messageIds){if(!state.ws||state.ws.readyState!==1||state.roomId!==roomId||!Array.isArray(messageIds)||!messageIds.length)return;state.ws.send(JSON.stringify({type:'message:read:bulk',roomId,messageIds:[...new Set(messageIds.map(Number).filter(Boolean))]}));}

function formatUnreadLabel(count){if(count===1)return '1 новое сообщение ↓';if(count>=2&&count<=4)return `${count} новых сообщения ↓`;return `${count} новых сообщений ↓`;}
function renderNewMessagesPill(count){const pill=document.getElementById('newMessagesPill');if(!pill)return;if(!count||count<=0){pill.classList.add('hidden');pill.textContent='';return;}pill.textContent=formatUnreadLabel(count);pill.classList.remove('hidden');}
function recomputePendingUnread(){const unreadEls=[...document.querySelectorAll('.bubble-wrap[data-incoming="1"][data-read="0"]')];pendingIncomingReadIds=unreadEls.map(el=>Number(el.dataset.messageId||el.dataset.id)).filter(id=>Number.isInteger(id)&&id>0);pendingIncomingReadIds=[...new Set(pendingIncomingReadIds)];return pendingIncomingReadIds.length;}
function updateUnreadIndicators(){const box=document.getElementById('messages');if(!box||!state.roomId)return;const count=recomputePendingUnread();const atBottom=isMessagesAtBottom();renderNewMessagesPill(atBottom?0:count);upsertChat(state.roomId,{unread:atBottom?0:count});renderChats();updateUnreadPresentation();}
function observeUnreadMessage(el){if(!el||!unreadVisibleObserver)return;if(el.dataset.incoming!=='1'||el.dataset.read!=='0')return;unreadVisibleObserver.observe(el);}
function markMessageRead(messageId){const id=Number(messageId);if(!id)return;const box=document.getElementById('messages');const msgEl=box?.querySelector(`.msg[data-message-id="${id}"], .msg[data-id="${id}"]`);if(!msgEl||msgEl.dataset.read!=='0')return;msgEl.dataset.read='1';unreadVisibleObserver?.unobserve(msgEl);markIncomingMessagesRead(state.roomId,activeChatDeviceId,[id]);recomputePendingUnread();updateUnreadIndicators();
updateReplyComposerBar();}
let wsConnectStartedAt=0;let wsConnectInFlight=null;
function sendClientState(){
  if(!state.ws||state.ws.readyState!==WebSocket.OPEN)return;
  state.ws.send(JSON.stringify({type:'client:state',activeRoomId:state.roomId||null,visible:document.visibilityState==='visible'}));
}
function ensureWsConnected(deviceId,timeoutMs=1800){if(!deviceId)return Promise.resolve(false);if(state.ws&&state.ws.readyState===WebSocket.OPEN){setLocalConnectionState('connected');return Promise.resolve(true);}const isStaleConnecting=state.ws&&state.ws.readyState===WebSocket.CONNECTING&&Date.now()-wsConnectStartedAt>timeoutMs;if(!state.ws||state.ws.readyState===WebSocket.CLOSING||state.ws.readyState===WebSocket.CLOSED||isStaleConnecting){setLocalConnectionState('connecting');if(state.ws){try{state.ws.close();}catch{}}connectWs(deviceId);sendClientState();} if(wsConnectInFlight)return wsConnectInFlight;wsConnectInFlight=new Promise((resolve)=>{const ws=state.ws;if(!ws){wsConnectInFlight=null;resolve(false);return;}if(ws.readyState===WebSocket.OPEN){wsConnectInFlight=null;resolve(true);return;}const done=(ok)=>{clearTimeout(timer);ws.removeEventListener('open',onOpen);ws.removeEventListener('error',onFail);ws.removeEventListener('close',onFail);if(wsConnectInFlight===promiseRef)wsConnectInFlight=null;resolve(ok&&state.ws===ws&&ws.readyState===WebSocket.OPEN);};const onOpen=()=>done(true);const onFail=()=>done(false);const timer=setTimeout(()=>done(false),timeoutMs);const promiseRef=wsConnectInFlight;ws.addEventListener('open',onOpen,{once:true});ws.addEventListener('error',onFail,{once:true});ws.addEventListener('close',onFail,{once:true});});return wsConnectInFlight;}
function scrollMessagesToBottom(box){if(!box)return;requestAnimationFrame(()=>{requestAnimationFrame(()=>{box.scrollTop=box.scrollHeight;});});}
function scrollToFirstUnread(){const firstUnread=document.querySelector('.bubble-wrap[data-incoming="1"][data-read="0"]');if(firstUnread){requestAnimationFrame(()=>{requestAnimationFrame(()=>{firstUnread.scrollIntoView({behavior:'auto',block:'center'});});});return true;}return false;}
function autoResizeMessageInput(input){if(!input)return;const lineHeight=parseFloat(getComputedStyle(input).lineHeight)||22;const maxHeight=lineHeight*4;input.style.height=`${lineHeight}px`;const nextHeight=Math.min(input.scrollHeight,maxHeight);input.style.height=`${Math.max(lineHeight,nextHeight)}px`;input.style.overflowY=input.scrollHeight>maxHeight?'auto':'hidden';}
async function renderChatView(messages,deviceId){messages=Array.isArray(messages)?messages:[];activeChatDeviceId=deviceId;pendingIncomingReadIds=[];messageCache.clear();if(unreadVisibleObserver){unreadVisibleObserver.disconnect();unreadVisibleObserver=null;}els.content.innerHTML=`<div class='chat-view'><div class='chat-header'><div><strong>${safeText(state.roomNames[state.roomId]||`Комната ${shortId(state.roomId)}`)}</strong><div id='presenceLine' class='presence-line'></div><div id='connectionWarning' class='connection-warning hidden'></div></div><div class='chat-header-actions'><button id='backMob' class='mobile-only btn btn-icon' aria-label='Назад'>←</button><button id='reloadBtn' class='btn btn-icon' aria-label='Обновить'>↻</button><button id='menuBtn' class='btn btn-icon' aria-label='Меню чата'>⋮</button></div></div><div class='messages' id='messages'></div><button id='newMessagesPill' class='new-messages-pill hidden' type='button'></button><div id='replyComposerBar' class='reply-composer-bar hidden'></div><form class='send composer' id='sendForm'><button class='composer-icon composer-attach' type='button' aria-label='Вложения'><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M16.5 6.5l-7.8 7.8a3 3 0 104.2 4.2l8.1-8.1a5 5 0 10-7.1-7.1L5.6 11.6a7 7 0 109.9 9.9l6.4-6.4'/></svg></button><div class='composer-input-wrap'><textarea id='msgInput' placeholder='Сообщение'></textarea><button class='composer-emoji' type='button' aria-label='Emoji'><svg viewBox='0 0 24 24' aria-hidden='true'><circle cx='12' cy='12' r='9'/><path d='M8.5 10h.01M15.5 10h.01M8.5 14.5c1 1.2 2.1 1.8 3.5 1.8s2.5-.6 3.5-1.8'/></svg></button></div><button id='sendBtn' class='btn-send composer-send' type='submit' disabled>➤</button><input id='mediaFileInput' type='file' accept='image/*,video/*' multiple hidden></form></div><div id='mediaPreviewRoot'></div>`; document.getElementById('backMob')?.addEventListener('click',()=>showChatsList()); document.getElementById('reloadBtn').onclick=()=>window.location.reload(); document.getElementById('menuBtn').onclick=(e)=>{e.preventDefault();e.stopPropagation();const rect=e.currentTarget.getBoundingClientRect();showRoomMenu(state.roomId,rect.right,rect.bottom+6)};setupChatBackSwipe(document.querySelector('.chat-view'));const box=document.getElementById('messages');box.dataset.lastDayKey=''; unreadVisibleObserver=new IntersectionObserver((entries)=>{entries.forEach((entry)=>{if(!entry.isIntersecting)return;const el=entry.target;markMessageRead(el.dataset.messageId);unreadVisibleObserver?.unobserve(el);});},{root:box,threshold:0.01}); for(const m of messages){appendDateSeparatorIfNeeded(box,m.created_at);const mine=m.sender_device_id===deviceId; const txt=await decryptText(m.iv,m.ciphertext).catch(()=>"[cannot decrypt]"); appendMessage(box,m,txt,mine,false);}recomputePendingUnread();const hasUnread=pendingIncomingReadIds.length>0;if(hasUnread){scrollToFirstUnread();renderNewMessagesPill(pendingIncomingReadIds.length);}else{safeScrollToBottom(box);renderNewMessagesPill(0);}updateUnreadIndicators();
updateReplyComposerBar();
box.addEventListener('scroll',()=>{if(isMessagesAtBottom()){const unreadEls=[...box.querySelectorAll('.msg[data-incoming="1"][data-read="0"]')];if(unreadEls.length){unreadEls.forEach((el)=>{el.dataset.read='1';unreadVisibleObserver?.unobserve(el);});markIncomingMessagesRead(state.roomId,activeChatDeviceId,unreadEls.map(el=>Number(el.dataset.messageId||el.dataset.id)));}}recomputePendingUnread();updateUnreadIndicators();
updateReplyComposerBar();});
document.getElementById('newMessagesPill').onclick=()=>{const firstUnread=document.querySelector('.msg[data-read="0"][data-incoming="1"]');if(firstUnread){firstUnread.scrollIntoView({behavior:'smooth',block:'center'});}};
renderPresenceStatus();
const mediaFileInput=document.getElementById('mediaFileInput');const attachBtn=document.querySelector('.composer-attach');if(attachBtn&&mediaFileInput){attachBtn.onclick=(e)=>{e.preventDefault();mediaFileInput.click();};mediaFileInput.onchange=async()=>{const files=Array.from(mediaFileInput.files||[]);mediaFileInput.value='';if(!files.length)return;await openMediaPreviewFromFiles(files);};}const form=document.getElementById('sendForm'),input=document.getElementById('msgInput'),sendBtn=document.getElementById('sendBtn'); if(form&&input&&sendBtn){const syncSendBtn=()=>{sendBtn.disabled=!input.value.trim();}; input.addEventListener('input',()=>{syncSendBtn();autoResizeMessageInput(input);const draft=ensureDraftState(state.roomId);draft.text=input.value;scheduleDraftSave(state.roomId);renderChats();}); input.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}}); form.onsubmit=async(e)=>{e.preventDefault();const t=input.value.trim();if(!t)return;const ok=await ensureWsConnected(activeChatDeviceId);if(!ok||!state.ws||state.ws.readyState!==WebSocket.OPEN){alert('Нет соединения. Попробуйте обновить чат.');return;}const enc=await encryptText(t);const draft=ensureDraftState(state.roomId);const replyToMessageId=draft.replyTo?.messageId||null;state.ws.send(JSON.stringify({type:'message:new',roomId:state.roomId,...enc,notificationPreview:t.slice(0,80),replyToMessageId}));input.value='';draft.text='';draft.replyTo=null;updateReplyComposerBar();await clearDraftOnServer(state.roomId);syncSendBtn();autoResizeMessageInput(input);}; syncSendBtn();autoResizeMessageInput(input);await loadDraftForCurrentRoom();syncSendBtn();}}
function buildMediaFallbackText(media=[],caption=''){const c=String(caption||'').trim();if(c)return c;if(media.length===1)return media[0]?.media_kind==='video'?'Видео':'Фото';if(media.length>1)return'Альбом';return'Медиа';}
async function fetchMediaThumbUrl(media){const persisted=STORAGE.get(STORAGE.roomState(state.roomId));if(!persisted?.deviceId||!media?.public_id)return'';try{const r=await fetch(`/api/media/${media.public_id}/thumb?deviceId=${encodeURIComponent(persisted.deviceId)}`);if(!r.ok)throw new Error('thumb');const enc=await r.blob();const dec=await decryptBlobWithIvPrefix(enc,'image/webp');return URL.createObjectURL(dec);}catch{return'';}}
function openMediaViewer(messageMedia,startIndex=0){mediaViewerState={messageMedia,index:startIndex,loaded:new Map()};renderMediaViewer();}
function renderMediaViewer(){const root=document.getElementById('mediaViewerRoot')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'mediaViewerRoot'}));const v=mediaViewerState;if(!v){root.innerHTML='';return;}const m=v.messageMedia[v.index];root.innerHTML=`<div class="media-viewer-overlay"><button class="media-viewer-close" type="button">×</button><div class="media-viewer-content"><div class="media-progress-ring">Загрузка...</div></div>${v.messageMedia.length>1?'<button class="media-viewer-nav prev">←</button><button class="media-viewer-nav next">→</button>':''}</div>`;root.querySelector('.media-viewer-overlay').onclick=(e)=>{if(e.target.classList.contains('media-viewer-overlay')){mediaViewerState=null;renderMediaViewer();}};root.querySelector('.media-viewer-close').onclick=()=>{mediaViewerState=null;renderMediaViewer();};root.querySelector('.prev')?.addEventListener('click',(e)=>{e.stopPropagation();if(v.index>0){v.index--;renderMediaViewer();}});root.querySelector('.next')?.addEventListener('click',(e)=>{e.stopPropagation();if(v.index<v.messageMedia.length-1){v.index++;renderMediaViewer();}});loadViewerMedia(m,root.querySelector('.media-viewer-content'));}
async function loadViewerMedia(media,container){try{const persisted=STORAGE.get(STORAGE.roomState(state.roomId));const res=await fetch(`/api/media/${media.public_id}/blob?deviceId=${encodeURIComponent(persisted.deviceId)}`);if(!res.ok)throw new Error('load');const enc=await res.blob();const plain=await decryptBlobWithIvPrefix(enc,media.mime_type);const url=URL.createObjectURL(plain);container.innerHTML=media.media_kind==='video'?`<video controls autoplay src="${url}"></video>`:`<img src="${url}" alt="media">`;}catch{container.innerHTML='<div class="media-error-box">Не удалось загрузить медиа <button type="button" class="btn btn-secondary">Повторить</button></div>';container.querySelector('button')?.addEventListener('click',()=>loadViewerMedia(media,container));}}
function appendMessage(box,m,txt,mine,autoScroll=true){const w=document.createElement('div');w.className=`bubble-wrap msg ${mine?'mine':''}`;const isIncoming=!mine;const isRead=mine?1:(m.status==='read'?1:0);w.dataset.id=m.id;w.dataset.createdAt=m.created_at;w.dataset.messageId=String(m.id);w.dataset.incoming=isIncoming?'1':'0';w.dataset.read=String(isRead);const replyMeta=m.reply_to_message_id?getMessageReplyMeta(m.reply_to_message_id):null;const replyHtml=replyMeta?`<button type="button" class="reply-block" data-reply-message-id="${replyMeta.messageId}"><div class="reply-block-author">${safeText(replyMeta.author)}</div><div class="reply-block-preview">${safeText(replyMeta.preview)}</div></button>`:'';const isMedia=m.type==='media';const mediaList=Array.isArray(m.media)?m.media:[];const caption=(txt||'').trim();const captionHtml=caption?`<div class="message-text">${safeText(caption)}</div>`:'';const mediaGridClass=mediaList.length===1?'one':(mediaList.length<=4?'few':'many');const contentHtml=isMedia?`<div class="media-grid ${mediaGridClass}">${mediaList.map((item,idx)=>`<button type="button" class="media-tile" data-media-index="${idx}"><img class="media-thumb" alt="media"><span class="media-video-badge ${item.media_kind==='video'?'':'hidden'}">▶</span></button>`).join('')}</div>${captionHtml}`:`<div class="message-text">${safeText(txt)}</div>`;w.innerHTML=`<div class='bubble'><div><b>${safeText(m.sender_name)}</b></div>${replyHtml}${contentHtml}<div class='meta'>${formatMessageTime(m.created_at)} ${mine?deliveryIcon(m.status):''}</div></div>`;w.querySelector('.reply-block')?.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();const id=Number(e.currentTarget.dataset.replyMessageId);void findAndFocusReplyMessage(id);});w.addEventListener('contextmenu',(e)=>{e.preventDefault();e.stopPropagation();showMessageReplyMenu(m.id,e.clientX,e.clientY);});const bubble=w.querySelector('.bubble');const swipeIcon=document.createElement('div');swipeIcon.className='swipe-reply-icon';swipeIcon.textContent='↩';w.appendChild(swipeIcon);let touchStartX=0,touchStartY=0,currentDx=0,tracking=false;w.addEventListener('touchstart',(e)=>{if(e.touches.length!==1||!bubble)return;const t=e.touches[0];touchStartX=t.clientX;touchStartY=t.clientY;currentDx=0;tracking=true;w.classList.remove('swipe-reset');w.classList.add('swiping');bubble.style.transform='';},{passive:true});w.addEventListener('touchmove',(e)=>{if(!tracking||e.touches.length!==1||!bubble)return;const t=e.touches[0];const dx=t.clientX-touchStartX;const dy=t.clientY-touchStartY;if(Math.abs(dy)>Math.abs(dx)){tracking=false;bubble.style.transform='';w.classList.remove('swiping');return;}if(dx>=0){currentDx=0;bubble.style.transform='';return;}currentDx=Math.max(-110,dx);bubble.style.transform=`translateX(${currentDx}px)`;const progress=Math.min(1,Math.abs(currentDx)/SWIPE_REPLY_THRESHOLD);swipeIcon.style.opacity=String(Math.max(0.12,progress));swipeIcon.style.transform=`translateY(-50%) scale(${0.8+progress*0.2})`;},{passive:true});const finishSwipe=()=>{if(!bubble)return;const shouldReply=tracking&&Math.abs(currentDx)>=SWIPE_REPLY_THRESHOLD;w.classList.remove('swiping');w.classList.add('swipe-reset');bubble.style.transform='';swipeIcon.style.opacity='';swipeIcon.style.transform='';tracking=false;currentDx=0;setTimeout(()=>w.classList.remove('swipe-reset'),180);if(shouldReply){setSelectedReply(state.roomId,getMessageReplyMeta(m.id));navigator.vibrate?.(10);}};w.addEventListener('touchend',finishSwipe);w.addEventListener('touchcancel',finishSwipe);if(isMedia){w.querySelectorAll('.media-tile').forEach(async(el)=>{const idx=Number(el.dataset.mediaIndex);const item=mediaList[idx];const img=el.querySelector('img');const u=await fetchMediaThumbUrl(item);if(u)img.src=u;el.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();openMediaViewer(mediaList,idx);});});}
box.appendChild(w);const previewText=isMedia?buildMediaFallbackText(mediaList,caption):txt==='[cannot decrypt]'?'Сообщение недоступно':makeReplyPreview(txt);messageCache.set(Number(m.id),{id:Number(m.id),author:m.sender_name,text:isMedia?caption:txt,preview:previewText,kind:isMedia?'media':'text'});if(isIncoming&&!isRead){if(!autoScroll){pendingIncomingReadIds.push(Number(m.id));}observeUnreadMessage(w);}if(autoScroll)box.scrollTop=box.scrollHeight;}
function connectWs(deviceId){setLocalConnectionState('connecting');if(state.ws)state.ws.close();const p=location.protocol==='https:'?'wss':'ws';const currentSeq=++appWsSeq;activeAppWsSeq=currentSeq;const ws=new WebSocket(`${p}://${location.host}?device=${encodeURIComponent(deviceId)}`);ws.deviceId=deviceId;state.ws=ws;const isCurrentWs=()=>state.ws===ws&&activeAppWsSeq===currentSeq;wsConnectStartedAt=Date.now();ws.onopen=()=>{if(!isCurrentWs())return;setLocalConnectionState('connected');sendClientState();};ws.onerror=()=>{if(!isCurrentWs())return;setLocalConnectionState('disconnected');};ws.onclose=()=>{if(!isCurrentWs())return;setLocalConnectionState('disconnected');};ws.onmessage=async(ev)=>{if(!isCurrentWs())return;const payload=JSON.parse(ev.data);if(payload.type==='message:new'){const roomId=payload.roomId; if(!roomId)return; const chat=state.chats.find(c=>c.roomId===roomId)||{};const txt=await decryptText(payload.message.iv,payload.message.ciphertext).catch(()=>"[cannot decrypt]");const mine=payload.message.sender_device_id===deviceId;const box=document.getElementById('messages');const inActiveChat=state.roomId===roomId&&box;const nearBottom=inActiveChat?isMessagesAtBottom():false;const messageId=payload.message.id;const messageSelector=`[data-message-id="${messageId}"], [data-id="${messageId}"]`;const hasMessageInDom=Boolean(document.querySelector(messageSelector));if(mine){upsertRoomMessage(roomId,payload.message,{text:txt,unread:chat.unread||0});if(inActiveChat&&!hasMessageInDom){appendDateSeparatorIfNeeded(box,payload.message.created_at);appendMessage(box,payload.message,txt,true,true);safeScrollToBottom(box);}}else if(inActiveChat){if(!hasMessageInDom){appendDateSeparatorIfNeeded(box,payload.message.created_at);appendMessage(box,payload.message,txt,false,nearBottom);}if(nearBottom){markIncomingMessagesRead(roomId,deviceId,[messageId]);upsertRoomMessage(roomId,payload.message,{text:txt,unread:0});safeScrollToBottom(box);}else{const incomingId=Number(messageId);if(Number.isInteger(incomingId)&&incomingId>0){pendingIncomingReadIds=[...new Set([...pendingIncomingReadIds,incomingId])];}const unreadCount=pendingIncomingReadIds.length;upsertRoomMessage(roomId,payload.message,{text:txt,unread:unreadCount});renderNewMessagesPill(unreadCount);}}else{const next=upsertRoomMessage(roomId,payload.message,{text:txt});const unread=next.isDuplicate?(chat.unread||0):((chat.unread||0)+1);upsertChat(roomId,{unread});updateUnreadPresentation();}
if(!mine)notifyIncoming(payload.message.sender_name,txt,roomId,mine);}if(payload.type==='presence:update'&&payload.deviceId){state.presence[payload.deviceId]={deviceId:payload.deviceId,displayName:payload.displayName,online:Boolean(payload.online),lastSeenAt:payload.lastSeenAt||null};renderPresenceStatus();}if(payload.type==='message:status'){if(payload.roomId&&payload.roomId!==state.roomId)return;document.querySelectorAll('.bubble-wrap').forEach(el=>{if(Number(el.dataset.messageId||el.dataset.id)===payload.messageId){const meta=el.querySelector('.meta');const createdAt=el.dataset.createdAt;const base=formatMessageTime(createdAt);const hasIcon=meta.textContent.includes('✓')||meta.textContent.includes('⏳');meta.innerHTML=hasIcon?`${base} ${deliveryIcon(payload.status)}`:base;if(payload.status==='read'){el.dataset.read='1';unreadVisibleObserver?.unobserve(el);pendingIncomingReadIds=pendingIncomingReadIds.filter((x)=>Number(x)!==Number(payload.messageId));}}});recomputePendingUnread();updateUnreadIndicators();
updateReplyComposerBar();}};}
function showRoomMenu(roomId,x,y){els.context.innerHTML='';[['Переименовать у себя',()=>{const v=prompt('Новое имя',state.roomNames[roomId]||''); if(v!==null){if(v.trim())state.roomNames[roomId]=v.trim(); else delete state.roomNames[roomId]; saveRoomNames(); renderChats(); if(state.roomId===roomId)openChat(roomId);}}],[state.roomMute[roomId]?'Включить уведомления в этом чате':'Выключить уведомления в этом чате',()=>{state.roomMute[roomId]=!state.roomMute[roomId];saveRoomMute();renderChats();const st=STORAGE.get(STORAGE.roomState(roomId));if(st?.deviceId){fetch('/api/push/mute-room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,deviceId:st.deviceId,muted:state.roomMute[roomId]})});if(!state.roomMute[roomId])syncRoomPushSubscription(roomId).catch(()=>{});}}],['Скопировать invite-ссылку',()=>{const st=STORAGE.get(STORAGE.roomState(roomId)); if(!st?.inviteLink){alert('Invite-ссылка уже использована или устарела.');return;} navigator.clipboard.writeText(st.inviteLink);} ],['Удалить из списка',()=>{if(confirm('Удалить чат из списка?')){state.chats=state.chats.filter(c=>c.roomId!==roomId);saveChats();hideMenu();if(state.roomId===roomId){if(state.ws)state.ws.close();state.ws=null;state.roomId=null;}setView('chats');renderChats();if(typeof updatePushBadge==='function')updateUnreadPresentation();}}]].forEach(([t,fn],idx)=>{const b=document.createElement('button');b.className='context-item'+(t.includes('Удалить')?' danger':'');if(idx>0)b.dataset.sep='1';b.textContent=t;b.onclick=()=>{fn();hideMenu()};els.context.appendChild(b)});els.context.classList.remove('hidden');const margin=8;let left=x;let top=y;const rect=els.context.getBoundingClientRect();if(left+rect.width>window.innerWidth-margin){left=window.innerWidth-rect.width-margin;}if(top+rect.height>window.innerHeight-margin){top=window.innerHeight-rect.height-margin;}left=Math.max(margin,left);top=Math.max(margin,top);els.context.style.left=left+'px';els.context.style.top=top+'px';els.context.onclick=(e)=>{e.stopPropagation()};}
function hideMenu(){els.context.classList.add('hidden')} document.addEventListener('click',hideMenu);
function parseInviteInput(value){const raw=String(value||'').trim();if(!raw)return {error:'empty'};if(raw.includes('#'))return {error:'old_invite'};let inviteCode='';try{const url=new URL(raw,location.origin);const match=url.pathname.match(/^\/i\/([A-Z0-9]{16,64})$/i);if(match)inviteCode=match[1];}catch{}if(!inviteCode){const direct=raw.match(/^([A-Z0-9]{16,64})$/i);if(direct)inviteCode=direct[1];}if(!inviteCode)return {error:'invalid'};return {inviteCode};}

function renderJoin(){els.content.innerHTML=`<div class='panel'><h2>Присоединиться к чату</h2><label>Invite-ссылка</label><textarea id='joinInviteInput' placeholder='Вставьте invite-ссылку или invite-код'></textarea><p class='sys'>Invite-ссылка действует 24 часа и только один раз.</p><div class='panel-actions'><button id='joinBtn' class='btn btn-primary'>Присоединиться</button><button id='pasteJoinBtn' class='btn btn-secondary'>Вставить из буфера</button><button id='backBtn' class='btn btn-secondary'>Назад</button></div></div>`; document.getElementById('backBtn').onclick=()=>setView('chats'); document.getElementById('joinBtn').onclick=async()=>{const input=document.getElementById('joinInviteInput');await joinByInviteText(input?.value||'');}; document.getElementById('pasteJoinBtn').onclick=async()=>{if(!navigator.clipboard?.readText){alert('Буфер обмена недоступен. Вставьте ссылку вручную.');return;} try{const text=await navigator.clipboard.readText();const parsed=parseInviteInput(text);if(parsed?.error==='empty'){alert('В буфере обмена нет invite-ссылки.');return;}if(parsed?.error==='old_invite'){alert('В буфере старая invite-ссылка. Попросите новую ссылку.');return;}if(!parsed||parsed.error){alert('В буфере обмена не invite-ссылка FPChat.');return;}const input=document.getElementById('joinInviteInput');if(input)input.value=text;await joinByInviteText(text);}catch{alert('Не удалось прочитать буфер обмена. Вставьте ссылку вручную.');}};}
function renderCreate(){els.content.innerHTML=`<div class='panel'><h2>Создать чат</h2><label>Ваш ник</label><input id="nickCreate" value="${safeText(state.nick)}"/><div class='panel-actions'><button id='createBtn' class='btn btn-primary'>Создать чат</button><button id='backBtn' class='btn btn-secondary'>Назад</button></div><div id='createOut'></div></div>`; document.getElementById('backBtn').onclick=()=>setView('chats'); document.getElementById('createBtn').onclick=async()=>{const createBtn=document.getElementById('createBtn');const baseText='Создать чат';createBtn.disabled=true;createBtn.classList.add('btn-loading');createBtn.textContent='Создание...';try{state.nick=document.getElementById('nickCreate').value.trim()||state.nick; localStorage.setItem(STORAGE.nick,state.nick);
const secret=crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,''); const rec=`R-${Array.from({length:5}).map(()=>Array.from({length:4}).map(()=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join('')).join('-')}`; const salt=crypto.getRandomValues(new Uint8Array(16)); const recSalt=b64.encode(salt); const dig=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rec+':'+recSalt)); const mat=await crypto.subtle.importKey('raw',new TextEncoder().encode(rec),'PBKDF2',false,['deriveKey']); const rk=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64.decode(recSalt),iterations:250000,hash:'SHA-256'},mat,{name:'AES-GCM',length:256},false,['encrypt']); const iv=crypto.getRandomValues(new Uint8Array(12)); const c=await crypto.subtle.encrypt({name:'AES-GCM',iv},rk,new TextEncoder().encode(secret));
const creatorDeviceId=crypto.randomUUID();const res=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId:creatorDeviceId,roomSecret:secret,recoverySalt:recSalt,recoveryVerifier:b64.encode(dig),recoverySecretIv:b64.encode(iv),recoverySecretCiphertext:b64.encode(c)})}); const data=await res.json(); STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId:creatorDeviceId,recoveryCode:rec,inviteLink:data.inviteLink,inviteExpiresAt:data.inviteExpiresAt}); upsertChat(data.publicId,{}); if(state.notif.enabled)syncRoomPushSubscription(data.publicId).catch(()=>{});
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
function renderSettings(){els.content.innerHTML=`<div class='panel'><h2>Настройки</h2><label>Ваш ник</label><input id="nick" value="${safeText(state.nick)}"/><label>Тема</label><select id='theme'><option value='auto'>Авто</option><option value='light'>Светлая</option><option value='dark'>Тёмная</option></select><label><input type='checkbox' id='nEnabled' ${state.notif.enabled?'checked':''}/> Включить уведомления</label><label><input type='checkbox' id='nText' ${state.notif.showText?'checked':''}/> Показывать текст сообщения</label><label><input type='checkbox' id='nSender' ${state.notif.hideSender?'checked':''}/> Скрывать отправителя</label><label><input type='checkbox' id='nSound' ${state.notif.sound?'checked':''}/> Звук нового сообщения</label><div class='settings-section'><h3>Установка приложения</h3><p id='installHelpText' class='settings-hint'></p><button id='installPwaBtn' class='btn btn-secondary'>Установить FPChat</button></div><div id='settingsVersion' class='sys'>${settingsVersionInfo}</div><div class='panel-actions'><button id='save' class='btn btn-primary'>Сохранить</button><button id='backBtn' class='btn btn-secondary'>Назад</button></div></div>`;void refreshSettingsVersionLine(); document.getElementById('backBtn').onclick=()=>setView('chats'); const t=document.getElementById('theme'); t.value=localStorage.getItem(STORAGE.theme)||'auto'; t.onchange=()=>applyTheme(t.value); const toggle=()=>{['nText','nSender','nSound'].forEach(id=>document.getElementById(id).disabled=!document.getElementById('nEnabled').checked)}; document.getElementById('nEnabled').onchange=async()=>{if(document.getElementById('nEnabled').checked){await ensurePushSubscription();} toggle()}; toggle(); bindClick('installPwaBtn',handleInstallClick);updateInstallUi(); document.getElementById('save').onclick=async()=>{state.nick=document.getElementById('nick').value.trim()||state.nick; localStorage.setItem(STORAGE.nick,state.nick); state.notif={enabled:document.getElementById('nEnabled').checked,showText:document.getElementById('nText').checked,hideSender:document.getElementById('nSender').checked,sound:document.getElementById('nSound').checked}; STORAGE.set(STORAGE.notif,state.notif);if(!state.notif.enabled){await unsubscribeAllPushDevices();}else{await syncAllPushSubscriptions();await updateAllPushSettings();} alert('Сохранено');};}
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
const restoreWsOnResume=()=>{if(state.roomId&&activeChatDeviceId){ensureWsConnected(activeChatDeviceId);}};
const handleAppResume=()=>{restoreWsOnResume();checkAppVersionOnEntry();};
window.addEventListener('focus',handleAppResume);
document.addEventListener('visibilitychange',()=>{sendClientState();if(document.visibilityState==='visible')handleAppResume();});window.addEventListener('focus',sendClientState);window.addEventListener('pageshow',sendClientState);
window.addEventListener('pageshow',handleAppResume);

window.addEventListener('popstate',()=>{const handled=handleAndroidBackNavigation();if(handled){pushAppHistoryState();}});

document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>{setView(b.dataset.view); closeMobileMenu();}); els.search.oninput=renderChats;
pushAppHistoryState();
(async()=>{
  await registerServiceWorker();
  const updateStarted=await checkAppVersionOnEntry();
  if(updateStarted)return;
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
async function getPushConfig(){const r=await fetch('/api/push/vapid-public-key');return r.json();}
async function ensurePushSubscription(){if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){alert('Push-уведомления недоступны на этом устройстве');return null;}const registration=await navigator.serviceWorker.ready;const cfg=await getPushConfig();if(!cfg.enabled){alert('Push-уведомления отключены на сервере');return null;}if(Notification.permission!=='granted'){const p=await Notification.requestPermission();if(p!=='granted')return null;}let sub=await registration.pushManager.getSubscription();if(!sub){sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64ToUint8Array(cfg.publicKey)});}return sub;}
async function syncRoomPushSubscription(roomId){if(!state.notif.enabled||state.roomMute[roomId])return;const persisted=STORAGE.get(STORAGE.roomState(roomId));if(!persisted?.deviceId)return;const sub=await ensurePushSubscription();if(!sub)return;await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,deviceId:persisted.deviceId,subscription:sub.toJSON(),settings:{showText:state.notif.showText,hideSender:state.notif.hideSender}})});}
function getLocalRoomDevicePairs(){const unique=new Map();for(const chat of state.chats){const roomId=chat?.roomId;if(!roomId)continue;const st=STORAGE.get(STORAGE.roomState(roomId));const deviceId=st?.deviceId;if(!deviceId)continue;unique.set(`${roomId}::${deviceId}`,{roomId,deviceId});}return [...unique.values()];}
async function syncAllPushSubscriptions(){if(!state.notif.enabled)return;const sub=await ensurePushSubscription();if(!sub)return;for(const {roomId,deviceId} of getLocalRoomDevicePairs()){if(state.roomMute[roomId])continue;await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,deviceId,subscription:sub.toJSON(),settings:{showText:state.notif.showText,hideSender:state.notif.hideSender}})});}}
async function updateAllPushSettings(){for(const {roomId,deviceId} of getLocalRoomDevicePairs()){await fetch('/api/push/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,deviceId,showText:state.notif.showText,hideSender:state.notif.hideSender})});}}
async function unsubscribeAllPushDevices(){const deviceIds=[...new Set(getLocalRoomDevicePairs().map((p)=>p.deviceId))];for(const deviceId of deviceIds){await fetch('/api/push/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId})});}}
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
const ok=await ensureWsConnected(activeChatDeviceId);if(!ok||!state.ws||state.ws.readyState!==WebSocket.OPEN){alert('Нет соединения. Попробуйте обновить чат.');mediaPreviewState.sending=false;return;}const caption=(mediaPreviewState.caption||'').trim();const enc=await encryptText(caption||'');const draft=ensureDraftState(state.roomId);const mediaIds=mediaPreviewState.items.map(x=>x.uploadedMedia?.id).filter(Boolean);const notificationPreview=caption?caption.slice(0,80):buildMediaFallbackText(mediaPreviewState.items.map(x=>({media_kind:x.kind})),caption);state.ws.send(JSON.stringify({type:'message:new',roomId:state.roomId,messageType:'media',ciphertext:enc.ciphertext,iv:enc.iv,notificationPreview,replyToMessageId:draft.replyTo?.messageId||null,mediaIds}));draft.replyTo=null;await clearDraftOnServer(state.roomId);closeMediaPreviewModal();}