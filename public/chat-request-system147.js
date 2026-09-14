/* Build 147: request decisions, 24-hour countdown and sender-room promotion in the FPChat system chat. */
(() => {
  if (window.__fpChatRequestSystem147Installed) return;
  window.__fpChatRequestSystem147Installed = true;
  window.__fpChatRequestActions146Installed = true;

  const style = document.createElement('style');
  style.id = 'fpchat-chat-request-system147-style';
  style.textContent = `
    .fp-system147-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
    .fp-system147-btn{min-height:38px;padding:0 13px;border:0;border-radius:11px;font:inherit;font-size:12px;font-weight:760;cursor:pointer;transition:transform .12s,opacity .15s}
    .fp-system147-btn:active:not(:disabled){transform:scale(.98)}.fp-system147-btn:disabled{opacity:.55;cursor:default}
    .fp-system147-btn.accept{background:var(--accent);color:#fff;flex:1 1 150px}.fp-system147-btn.reject{background:rgba(120,130,145,.13);color:inherit;flex:1 1 115px}.fp-system147-btn.block{background:rgba(235,87,87,.1);color:var(--danger,#e85b5b);flex:1 1 115px}
    .fp-system147-status{display:inline-flex;margin-top:10px;padding:4px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:750}
    .fp-system147-status.rejected,.fp-system147-status.blocked,.fp-system147-status.expired{background:rgba(235,87,87,.1);color:var(--danger,#e85b5b)}
    .fp-system147-status.accepted{background:rgba(59,196,125,.12);color:#3bc47d}
    .fp-system147-countdown{margin-top:8px;color:var(--muted);font-size:11px;font-weight:650}.fp-system147-countdown.expiring{color:var(--danger,#e85b5b)}
    .fp-system147-error{margin-top:8px;color:var(--danger,#e85b5b);font-size:11px;line-height:1.4}
    @media(max-width:600px){.fp-system147-actions{gap:7px}.fp-system147-btn{min-height:40px}}
  `;
  document.head.appendChild(style);

  let overlay = null;
  let requests = new Map();
  let syncPromise = null;
  let countdownTimer = 0;
  let refreshAtZero = false;
  let hostObserver = null;
  const joining = new Set();

  const api = () => window.FPSystem144 || null;
  function deviceId() {
    try { if (typeof getOrCreateDeviceId === 'function') return String(getOrCreateDeviceId() || '').trim(); } catch {}
    return String(localStorage.getItem('fpchat:device-id') || '').trim();
  }
  function dateOf(value) {
    if (!value) return null;
    const text = String(value);
    const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? new Date(`${text.replace(' ', 'T')}Z`) : new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const timeText = (value) => dateOf(value)?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '';
  function listTime(value) {
    try { if (typeof formatChatListTime === 'function') return formatChatListTime(value); } catch {}
    const date = dateOf(value); if (!date) return '';
    return date.toDateString() === new Date().toDateString() ? timeText(value) : `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}`;
  }
  function initials(value) {
    const p = String(value || '').trim().split(/\s+/).filter(Boolean);
    return (p.length > 1 ? `${p[0][0] || ''}${p[1][0] || ''}` : (p[0] || 'FP').slice(0,2)).toUpperCase() || 'FP';
  }

  async function fetchRequests() {
    const id = deviceId(); if (!id) return [];
    const response = await fetch(`/api/chat-requests/mine?${new URLSearchParams({ deviceId: id, limit: '100' })}`, { cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error('request list unavailable');
    return Array.isArray(data.requests) ? data.requests : [];
  }
  async function syncRequests() {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      try {
        const rows = await fetchRequests();
        requests = new Map(rows.map((row) => [String(row.requestId || ''), row]));
        window.FPChatRequestOwner147?.reconcile?.(rows);
        ensureSystemRow(rows);
        void decorateRow(rows);
        return rows;
      } finally { syncPromise = null; }
    })();
    return syncPromise;
  }

  const reqId = (event) => String(event?.refId || event?.payload?.requestId || '');
  const reqFor = (event) => requests.get(reqId(event)) || null;
  function preview(request) {
    if (!request) return '';
    const who = request.peer?.displayName || (request.peer?.username ? `@${request.peer.username}` : 'Пользователь');
    if (request.status === 'pending') return request.direction === 'outgoing' ? `Ожидаем ответ от ${who}` : `${who} хочет начать чат`;
    if (request.status === 'accepted') return request.direction === 'outgoing' ? `${who} принял запрос` : 'Запрос принят';
    if (request.status === 'expired') return 'Срок запроса истёк';
    if (request.status === 'blocked') return 'Пользователь заблокирован';
    if (request.status === 'rejected') return 'Запрос на чат отклонён';
    return '';
  }
  function newestRequest(rows) {
    return [...(rows || [])].sort((a,b) => (dateOf(b.updatedAt || b.createdAt)?.getTime() || 0) - (dateOf(a.updatedAt || a.createdAt)?.getTime() || 0))[0] || null;
  }
  function syntheticPending(rows) {
    return [...(rows || [])].filter((r) => r?.direction === 'outgoing' && r?.status === 'pending').sort((a,b) => (dateOf(b.createdAt)?.getTime() || 0) - (dateOf(a.createdAt)?.getTime() || 0))[0] || null;
  }
  function buildSystemRow(request) {
    const row = document.createElement('div'); row.className = 'chat-row fp-system145-row'; row.setAttribute('role','button'); row.tabIndex = 0;
    row.innerHTML = `<div class="row-top"><div><div><strong><span class="fp-system145-icon">FP</span>FPChat</strong></div><div class="sys">Системный чат</div></div><div class="chat-row-meta"><span class="chat-time">${listTime(request.createdAt)}</span></div></div><div class="row-top"><div class="last"></div></div>`;
    row.querySelector('.last').textContent = preview(request); return row;
  }
  function ensureSystemRow(rows = [...requests.values()]) {
    const host = document.getElementById('fpSystemChatHost145'); if (!host) return;
    if (String(document.getElementById('chatSearch')?.value || '').trim()) return;
    if (host.querySelector('.fp-system145-row')) return;
    const pending = syntheticPending(rows); if (!pending) return;
    host.hidden = false; host.replaceChildren(buildSystemRow(pending));
  }
  async function decorateRow(rows = [...requests.values()]) {
    const row = document.querySelector('.fp-system145-row'); if (!row) return;
    try {
      const event = api()?.getEvents ? (await api().getEvents(1))[0] || null : null;
      const request = newestRequest(rows);
      const eventMs = dateOf(event?.createdAt)?.getTime() || 0;
      const requestMs = dateOf(request?.updatedAt || request?.createdAt)?.getTime() || 0;
      let text = requestMs > eventMs ? preview(request) : '';
      if (!text && event) text = preview(reqFor(event)) || (event.type === 'chat_request_expired' ? 'Срок запроса истёк' : event.type === 'chat_request_rejected' ? 'Запрос на чат отклонён' : 'Новое системное уведомление');
      const last = row.querySelector('.last'); if (last && text) last.textContent = text;
    } catch {}
  }

  const statusText = (status) => ({ accepted:'Запрос принят', rejected:'Запрос отклонён', blocked:'Пользователь заблокирован', expired:'Срок запроса истёк', pending:'Ожидает решения' }[status] || 'Ожидает решения');
  function head(profile) {
    const root = document.createElement('div'); root.className = 'fp-system145-request-head';
    const avatar = document.createElement('div'); avatar.className = 'fp-system145-avatar'; avatar.textContent = initials(profile?.displayName || profile?.username);
    const copy = document.createElement('div'); copy.className = 'fp-system145-request-copy';
    const name = document.createElement('b'); name.textContent = profile?.displayName || 'Пользователь FPChat';
    const handle = document.createElement('span'); handle.textContent = profile?.username ? `@${profile.username}` : 'Пользователь FPChat';
    copy.append(name, handle); root.append(avatar, copy); return root;
  }
  function requestText(request, event) {
    const status = request?.status || event?.payload?.status || 'pending';
    if (status === 'expired' || event?.type === 'chat_request_expired') return 'Срок действия запроса на приватный чат истёк.';
    if (event?.type === 'chat_request_accepted') return 'Принял ваш запрос на новый приватный чат.';
    if (event?.type === 'chat_request_rejected') return 'Отклонил ваш запрос на новый приватный чат.';
    if (request?.direction === 'outgoing') return 'Вы отправили запрос на новый приватный чат.';
    if (status === 'accepted') return 'Вы приняли запрос на новый приватный чат.';
    if (status === 'rejected') return 'Вы отклонили запрос на новый приватный чат.';
    if (status === 'blocked') return 'Вы заблокировали дальнейшие запросы этого пользователя.';
    return 'Хочет начать с вами новый приватный чат.';
  }
  function errorText(card, text) {
    let el = card.querySelector('.fp-system147-error');
    if (!el) { el = document.createElement('div'); el.className = 'fp-system147-error'; card.appendChild(el); }
    el.textContent = text || ''; el.hidden = !text;
  }
  function busy(actions, value) {
    actions?.querySelectorAll('button').forEach((button) => { button.disabled = value; });
  }

  async function postAction(requestId, action) {
    const response = await fetch(`/api/chat-requests/${encodeURIComponent(requestId)}/${action}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ targetDeviceId: deviceId() }) });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) { const error = new Error(action); error.code = data?.code; throw error; }
    return data;
  }
  async function accept(request, card, actions) {
    const id = String(request?.requestId || ''); if (!id || joining.has(id)) return;
    joining.add(id); busy(actions, true); errorText(card, '');
    try {
      const claim = await postAction(id, 'claim');
      if (!claim.alreadyJoined) {
        if (!claim.inviteCode || typeof joinByInviteText !== 'function') throw Object.assign(new Error('join'), { code:'CHAT_REQUEST_INVITE_UNAVAILABLE' });
        if (!await joinByInviteText(claim.inviteCode)) throw Object.assign(new Error('join'), { code:'CHAT_REQUEST_JOIN_FAILED' });
      }
      await postAction(id, 'complete');
      closeOverlay(); await api()?.refresh?.(); await syncRequests();
    } catch (error) {
      busy(actions, false);
      errorText(card, ['CHAT_REQUEST_ALREADY_RESOLVED','CHAT_REQUEST_INVITE_EXPIRED','CHAT_REQUEST_INVITE_UNAVAILABLE','CHAT_REQUEST_ROOM_CLOSED'].includes(error?.code) ? 'Запрос больше не действует.' : 'Не удалось принять запрос. Попробуйте ещё раз.');
      await refreshOverlay().catch(() => {});
    } finally { joining.delete(id); }
  }
  async function reject(request, card, actions) {
    busy(actions,true); errorText(card,'');
    try { await postAction(request.requestId,'reject'); await refreshOverlay(); await api()?.refresh?.(); }
    catch { busy(actions,false); errorText(card,'Не удалось отклонить запрос.'); }
  }
  async function block(request, card, actions, profile) {
    const who = profile?.displayName || (profile?.username ? `@${profile.username}` : 'этого пользователя');
    if (!confirm(`Заблокировать ${who}? Он больше не сможет отправлять вам запросы на чат.`)) return;
    busy(actions,true); errorText(card,'');
    try { await postAction(request.requestId,'block'); await refreshOverlay(); await api()?.refresh?.(); }
    catch { busy(actions,false); errorText(card,'Не удалось заблокировать пользователя.'); }
  }

  function countdown(card, request) {
    if (request?.status !== 'pending' || !request.expiresAt) return;
    const el = document.createElement('div'); el.className = 'fp-system147-countdown'; el.dataset.expiresAt = request.expiresAt; card.appendChild(el);
  }
  function card(event, request) {
    const root = document.createElement('div'); root.className = 'fp-system145-event';
    const profile = request?.peer || event?.payload?.sender || event?.payload?.target || {};
    root.appendChild(head(profile));
    const text = document.createElement('div'); text.className = 'fp-system145-request-text'; text.textContent = requestText(request,event); root.appendChild(text);
    const status = request?.status || event?.payload?.status || (event?.type === 'chat_request_expired' ? 'expired' : 'pending');
    const chip = document.createElement('div'); chip.className = `fp-system147-status ${status}`; chip.textContent = statusText(status); root.appendChild(chip);
    countdown(root, request);
    if (status === 'pending' && request?.direction === 'incoming') {
      const actions = document.createElement('div'); actions.className = 'fp-system147-actions';
      for (const [kind,label,fn] of [['accept','Принять',()=>accept(request,root,actions)],['reject','Отклонить',()=>reject(request,root,actions)],['block','Заблокировать',()=>block(request,root,actions,profile)]]) {
        const button = document.createElement('button'); button.type='button'; button.className=`fp-system147-btn ${kind}`; button.textContent=label; button.onclick=fn; actions.appendChild(button);
      }
      root.appendChild(actions);
    }
    const time = document.createElement('div'); time.className='fp-system145-event-time'; time.textContent=timeText(event?.createdAt || request?.createdAt); root.appendChild(time);
    return root;
  }
  function generic(event) {
    const root = document.createElement('div'); root.className='fp-system145-event';
    const text = document.createElement('div'); text.className='fp-system145-generic'; text.textContent='Системное уведомление FPChat'; root.appendChild(text);
    const time = document.createElement('div'); time.className='fp-system145-event-time'; time.textContent=timeText(event?.createdAt); root.appendChild(time); return root;
  }
  function timeline(events, rows) {
    const linked = new Map(), other = [];
    for (const event of events || []) {
      const id = reqId(event);
      if (id && (event.refType === 'chat_request' || requests.has(id))) { if (!linked.has(id)) linked.set(id,event); }
      else other.push({ event, request:null, at:event.createdAt });
    }
    for (const [id,event] of linked) other.push({ event, request:requests.get(id) || null, at:event.createdAt });
    for (const request of rows || []) if (request.direction === 'outgoing' && request.status === 'pending' && !linked.has(String(request.requestId))) other.push({ request, event:{ type:'chat_request_pending_outgoing', createdAt:request.createdAt, refId:request.requestId, payload:{} }, at:request.createdAt });
    return other.sort((a,b) => (dateOf(a.at)?.getTime() || 0) - (dateOf(b.at)?.getTime() || 0));
  }

  function updateCountdowns() {
    if (!overlay) return;
    let zero = false;
    overlay.querySelectorAll('.fp-system147-countdown').forEach((el) => {
      const remaining = (dateOf(el.dataset.expiresAt)?.getTime() || 0) - Date.now();
      if (remaining <= 0) { el.textContent='Срок запроса истёк'; el.classList.add('expiring'); el.closest('.fp-system145-event')?.querySelectorAll('button').forEach((b)=>b.disabled=true); zero=true; return; }
      const total=Math.ceil(remaining/1000), h=Math.floor(total/3600), m=Math.floor(total%3600/60), s=total%60;
      el.textContent=`Истекает через ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      el.classList.toggle('expiring', remaining <= 3600000);
    });
    if (zero && !refreshAtZero) { refreshAtZero=true; setTimeout(async()=>{ try { await refreshOverlay(); await api()?.refresh?.(); } finally { refreshAtZero=false; } },250); }
  }
  function startCountdown() { clearInterval(countdownTimer); updateCountdowns(); countdownTimer=setInterval(updateCountdowns,1000); }
  function stopCountdown() { clearInterval(countdownTimer); countdownTimer=0; }

  async function render(root, feed) {
    const [events, rows] = await Promise.all([api().getEvents(100), syncRequests()]);
    if (overlay !== root) return;
    const items = timeline(events, rows); feed.replaceChildren();
    if (!items.length) { const e=document.createElement('div'); e.className='fp-system145-empty'; e.textContent='Системных уведомлений пока нет.'; feed.appendChild(e); }
    else { for (const item of items) feed.appendChild(item.request || reqId(item.event) ? card(item.event,item.request || reqFor(item.event)) : generic(item.event)); feed.scrollTop=feed.scrollHeight; }
    const unread = events.filter((e)=>!e.readAt).map((e)=>e.id);
    if (unread.length) { try { await api().markRead(unread); } catch {} try { await api().refresh(); } catch {} ensureSystemRow(rows); }
    startCountdown();
  }
  function closeOverlay() { if (!overlay) return; document.removeEventListener('keydown', keydown,true); stopCountdown(); overlay.remove(); overlay=null; }
  function keydown(event) { if (event.key === 'Escape') { event.preventDefault(); closeOverlay(); } }
  async function openOverlay() {
    api()?.close?.(); closeOverlay();
    const root=document.createElement('div'); root.className='fp-system145-overlay';
    const sheet=document.createElement('section'); sheet.className='fp-system145-sheet'; sheet.setAttribute('role','dialog'); sheet.setAttribute('aria-modal','true');
    const header=document.createElement('div'); header.className='fp-system145-header';
    const back=document.createElement('button'); back.className='fp-system145-back'; back.type='button'; back.textContent='‹'; back.setAttribute('aria-label','Назад');
    const title=document.createElement('div'); title.className='fp-system145-title'; title.innerHTML='<b>FPChat</b><span>Системный чат</span>'; header.append(back,title,document.createElement('span'));
    const feed=document.createElement('div'); feed.className='fp-system145-feed'; feed.innerHTML='<div class="fp-system145-empty">Загружаем системные события…</div>';
    sheet.append(header,feed); root.appendChild(sheet); document.body.appendChild(root); overlay=root;
    back.onclick=closeOverlay; root.addEventListener('click',(e)=>{if(e.target===root&&matchMedia('(min-width:601px)').matches)closeOverlay();}); document.addEventListener('keydown',keydown,true);
    try { await render(root,feed); } catch { if (overlay===root) feed.innerHTML='<div class="fp-system145-empty">Не удалось загрузить системный чат.</div>'; }
  }
  async function refreshOverlay() {
    const rows=await syncRequests().catch(()=>[]); if (!overlay) { ensureSystemRow(rows); return; }
    const feed=overlay.querySelector('.fp-system145-feed'); if (feed) await render(overlay,feed).catch(()=>{});
  }

  function install() {
    document.addEventListener('click',(event)=>{const row=event.target?.closest?.('.fp-system145-row');if(!row)return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void openOverlay();},true);
    document.addEventListener('keydown',(event)=>{const row=event.target?.closest?.('.fp-system145-row');if(!row||!['Enter',' '].includes(event.key))return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void openOverlay();},true);
    const host=document.getElementById('fpSystemChatHost145');
    if (host) { hostObserver=new MutationObserver(()=>queueMicrotask(()=>ensureSystemRow())); hostObserver.observe(host,{childList:true,attributes:true,attributeFilter:['hidden']}); }
    document.getElementById('chatSearch')?.addEventListener('input',()=>queueMicrotask(()=>ensureSystemRow()));
    const periodic=async()=>{if(!api())return;try{await api().refresh();const rows=await syncRequests();ensureSystemRow(rows);if(overlay)await refreshOverlay();}catch{}};
    void periodic(); window.addEventListener('focus',()=>{if(document.visibilityState==='visible')void periodic();}); window.addEventListener('pageshow',()=>void periodic()); document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void periodic();}); setInterval(()=>{if(document.visibilityState==='visible')void periodic();},10000);
  }
  function wait(n=0){if(api())install();else if(n<100)setTimeout(()=>wait(n+1),100);}
  wait();
})();
