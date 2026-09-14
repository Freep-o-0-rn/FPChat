/* Build 146: accept / reject / block for isolated username chat requests.
   The accepted path deliberately reuses the existing /api/rooms creation endpoint
   and the existing invite/join client flow instead of creating a second room system. */
(() => {
  if (window.__fpChatRequestActions146Installed) return;
  window.__fpChatRequestActions146Installed = true;

  const STYLE_ID = 'fpchat-chat-request-actions146-style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .fp-system146-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .fp-system146-btn{min-height:38px;padding:0 13px;border:0;border-radius:11px;font:inherit;font-size:12px;font-weight:760;cursor:pointer;transition:transform .12s,opacity .15s,background .15s}
      .fp-system146-btn:active:not(:disabled){transform:scale(.98)}
      .fp-system146-btn:disabled{opacity:.55;cursor:default}
      .fp-system146-btn.accept{background:var(--accent);color:#fff;flex:1 1 150px}
      .fp-system146-btn.reject{background:rgba(120,130,145,.13);color:inherit;flex:1 1 115px}
      .fp-system146-btn.block{background:rgba(235,87,87,.1);color:var(--danger,#e85b5b);flex:1 1 115px}
      .fp-system146-status{display:inline-flex;margin-top:10px;padding:4px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:750}
      .fp-system146-status.rejected,.fp-system146-status.blocked{background:rgba(235,87,87,.1);color:var(--danger,#e85b5b)}
      .fp-system146-status.connected{background:rgba(59,196,125,.12);color:#3bc47d}
      .fp-system146-error{margin-top:8px;color:var(--danger,#e85b5b);font-size:11px;line-height:1.4}
      .fp-system146-event-text{margin-top:10px;font-size:13px;line-height:1.45}
      @media(max-width:600px){
        .fp-system146-actions{gap:7px}
        .fp-system146-btn{min-height:40px}
      }
    `;
    document.head.appendChild(style);
  }

  let overlay = null;
  let requestMap = new Map();
  let requestSyncInFlight = null;
  let acceptedSyncInFlight = null;
  const joiningRequestIds = new Set();

  function systemApi() {
    return window.FPSystem144 || null;
  }

  function getDeviceId() {
    try {
      if (typeof getOrCreateDeviceId === 'function') return String(getOrCreateDeviceId() || '').trim();
    } catch {}
    return String(localStorage.getItem('fpchat:device-id') || '').trim();
  }

  function getNick() {
    try {
      if (typeof state !== 'undefined' && state?.nick) return String(state.nick).trim();
    } catch {}
    return String(localStorage.getItem('fpchat:nick') || '').trim() || 'Пользователь FPChat';
  }

  function parseServerDate(value) {
    if (!value) return null;
    const text = String(value);
    const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
      ? new Date(text.replace(' ', 'T') + 'Z')
      : new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatTime(value) {
    const date = parseServerDate(value);
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function initials(value) {
    const clean = String(value || '').trim().replace(/\s+/g, ' ');
    const parts = clean.split(' ').filter(Boolean);
    const raw = parts.length > 1
      ? `${parts[0][0] || ''}${parts[1][0] || ''}`
      : (parts[0] || 'FP').slice(0, 2);
    return raw.toUpperCase() || 'FP';
  }

  async function getRequests() {
    const deviceId = getDeviceId();
    if (!deviceId) return [];
    const params = new URLSearchParams({ deviceId, limit: '100' });
    const response = await fetch(`/api/chat-requests/mine?${params.toString()}`, { cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error('chat requests unavailable');
    return Array.isArray(data.requests) ? data.requests : [];
  }

  async function syncRequestMap() {
    if (requestSyncInFlight) return requestSyncInFlight;
    requestSyncInFlight = (async () => {
      try {
        const rows = await getRequests();
        requestMap = new Map(rows.map((row) => [String(row.requestId || ''), row]));
        decorateSystemRow();
        return rows;
      } finally {
        requestSyncInFlight = null;
      }
    })();
    return requestSyncInFlight;
  }

  function requestByEvent(event) {
    const id = String(event?.refId || event?.payload?.requestId || '');
    return requestMap.get(id) || null;
  }

  function latestPreview(event) {
    if (!event) return '';
    if (event.type === 'chat_request_received') {
      const sender = event.payload?.sender || {};
      const who = sender.displayName || (sender.username ? `@${sender.username}` : 'Пользователь');
      return `${who} хочет начать чат`;
    }
    if (event.type === 'chat_request_accepted') {
      const target = event.payload?.target || {};
      const who = target.displayName || (target.username ? `@${target.username}` : 'Пользователь');
      return `${who} принял запрос`;
    }
    if (event.type === 'chat_request_rejected') return 'Запрос на чат отклонён';
    return '';
  }

  async function decorateSystemRow() {
    const api = systemApi();
    if (!api?.getEvents) return;
    const row = document.querySelector('.fp-system145-row');
    if (!row) return;
    try {
      const latest = (await api.getEvents(1))[0] || null;
      const preview = latestPreview(latest);
      const last = row.querySelector('.last');
      if (last && preview) last.textContent = preview;
    } catch {}
  }

  function statusLabel(status) {
    if (status === 'accepted') return 'Запрос принят';
    if (status === 'connected') return 'Чат создан';
    if (status === 'rejected') return 'Запрос отклонён';
    if (status === 'blocked') return 'Пользователь заблокирован';
    return 'Ожидает решения';
  }

  function appendStatus(card, status) {
    const chip = document.createElement('div');
    chip.className = `fp-system146-status ${status || 'pending'}`;
    chip.textContent = statusLabel(status);
    card.appendChild(chip);
    return chip;
  }

  function setCardError(card, text) {
    let error = card.querySelector('.fp-system146-error');
    if (!error) {
      error = document.createElement('div');
      error.className = 'fp-system146-error';
      const time = card.querySelector('.fp-system145-event-time');
      if (time) card.insertBefore(error, time);
      else card.appendChild(error);
    }
    error.textContent = text || '';
    error.hidden = !text;
  }

  function setButtonsBusy(actions, busy, label = 'Обработка…') {
    if (!actions) return;
    for (const button of actions.querySelectorAll('button')) {
      if (!button.dataset.baseText) button.dataset.baseText = button.textContent;
      button.disabled = busy;
      button.textContent = busy && button.classList.contains('accept') ? label : button.dataset.baseText;
    }
  }

  async function postDecision(requestId, action) {
    const targetDeviceId = getDeviceId();
    const response = await fetch(`/api/chat-requests/${encodeURIComponent(requestId)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetDeviceId })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      const error = new Error('request decision failed');
      error.code = data?.code || 'CHAT_REQUEST_DECISION_FAILED';
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function createNormalRoomForAcceptedRequest(requestId) {
    const deviceId = getDeviceId();
    if (!deviceId) throw new Error('device unavailable');
    if (typeof generateRecoveryCode !== 'function' || typeof buildRecoveryPayload !== 'function') {
      throw new Error('room crypto helpers unavailable');
    }

    const secret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const recoveryCode = generateRecoveryCode();
    const recoveryPayload = await buildRecoveryPayload(recoveryCode, secret);
    const displayName = getNick();

    const createResponse = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName,
        deviceId,
        roomSecret: secret,
        recoverySalt: recoveryPayload.recoverySalt,
        recoveryVerifier: recoveryPayload.recoveryVerifier,
        recoverySecretIv: recoveryPayload.recoverySecretIv,
        recoverySecretCiphertext: recoveryPayload.recoverySecretCiphertext
      })
    });
    const room = await createResponse.json().catch(() => null);
    if (!createResponse.ok || !room?.ok || !room?.publicId || !room?.inviteLink) {
      throw new Error('normal room creation failed');
    }

    let inviteCode = '';
    try {
      if (typeof parseInviteInput === 'function') inviteCode = parseInviteInput(room.inviteLink)?.inviteCode || '';
    } catch {}
    if (!inviteCode) {
      try {
        const url = new URL(room.inviteLink, location.origin);
        inviteCode = url.pathname.match(/^\/i\/([A-Za-z0-9_-]{16,96})$/)?.[1] || '';
      } catch {}
    }
    if (!inviteCode) throw new Error('normal invite unavailable');

    const acceptResponse = await fetch(`/api/chat-requests/${encodeURIComponent(requestId)}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetDeviceId: deviceId,
        roomPublicId: room.publicId,
        inviteCode
      })
    });
    const accepted = await acceptResponse.json().catch(() => null);
    if (!acceptResponse.ok || !accepted?.ok) {
      const error = new Error('request accept binding failed');
      error.code = accepted?.code || 'CHAT_REQUEST_ACCEPT_FAILED';
      throw error;
    }

    try {
      if (typeof STORAGE !== 'undefined' && STORAGE?.set && STORAGE?.roomState) {
        STORAGE.set(STORAGE.roomState(room.publicId), {
          secret,
          deviceId,
          recoveryCode,
          inviteLink: room.inviteLink,
          inviteExpiresAt: room.inviteExpiresAt
        });
      }
      if (typeof upsertChat === 'function') upsertChat(room.publicId, {});
      if (typeof state !== 'undefined' && state?.notif?.enabled && typeof syncRoomPushSubscription === 'function') {
        syncRoomPushSubscription(room.publicId).catch(() => {});
      }
    } catch {}

    return { roomId: room.publicId, recoveryCode };
  }

  async function acceptRequest(requestId, card, actions) {
    setButtonsBusy(actions, true, 'Создаём чат…');
    setCardError(card, '');
    try {
      const created = await createNormalRoomForAcceptedRequest(requestId);
      await syncRequestMap();
      await systemApi()?.refresh?.();
      closeOverlay();
      try {
        if (typeof openChat === 'function') await openChat(created.roomId);
      } catch {}
      try {
        if (typeof showRecoveryCodeModal === 'function') showRecoveryCodeModal(created.recoveryCode);
      } catch {}
    } catch (error) {
      setButtonsBusy(actions, false);
      const text = error?.code === 'CHAT_REQUEST_ALREADY_RESOLVED'
        ? 'Запрос уже обработан на другом устройстве.'
        : 'Не удалось принять запрос. Ничего в существующих чатах не изменено.';
      setCardError(card, text);
      try { await syncRequestMap(); } catch {}
    }
  }

  async function rejectRequest(requestId, card, actions) {
    setButtonsBusy(actions, true);
    setCardError(card, '');
    try {
      await postDecision(requestId, 'reject');
      await refreshOpenOverlay();
      await systemApi()?.refresh?.();
    } catch {
      setButtonsBusy(actions, false);
      setCardError(card, 'Не удалось отклонить запрос.');
    }
  }

  async function blockRequest(requestId, peerName, card, actions) {
    const who = String(peerName || 'этого пользователя').trim();
    if (!confirm(`Заблокировать ${who}? Он больше не сможет отправлять вам запросы на чат.`)) return;
    setButtonsBusy(actions, true);
    setCardError(card, '');
    try {
      await postDecision(requestId, 'block');
      await refreshOpenOverlay();
      await systemApi()?.refresh?.();
    } catch {
      setButtonsBusy(actions, false);
      setCardError(card, 'Не удалось заблокировать пользователя.');
    }
  }

  async function claimAccepted(request, manual = false) {
    const requestId = String(request?.requestId || '');
    if (!requestId || joiningRequestIds.has(requestId)) return false;
    const deviceId = getDeviceId();
    if (!deviceId || typeof joinByInviteText !== 'function') return false;

    joiningRequestIds.add(requestId);
    try {
      const response = await fetch(`/api/chat-requests/${encodeURIComponent(requestId)}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderDeviceId: deviceId })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        if (manual) alert('Не удалось подключиться к принятому запросу.');
        return false;
      }
      if (data.alreadyJoined) return true;
      if (!data.inviteCode) return false;
      const joined = await joinByInviteText(data.inviteCode);
      if (joined) {
        if (overlay) closeOverlay();
        try { await syncRequestMap(); } catch {}
        try { await systemApi()?.refresh?.(); } catch {}
      }
      return Boolean(joined);
    } finally {
      joiningRequestIds.delete(requestId);
    }
  }

  function localRoomExists(roomId) {
    if (!roomId) return false;
    try {
      if (typeof STORAGE !== 'undefined' && STORAGE?.get && STORAGE?.roomState) {
        const saved = STORAGE.get(STORAGE.roomState(roomId));
        if (saved?.secret) return true;
      }
    } catch {}
    return false;
  }

  function canAutoClaim() {
    if (document.visibilityState !== 'visible') return false;
    try {
      if (typeof state !== 'undefined' && state?.view === 'chat') return false;
    } catch {}
    return true;
  }

  async function syncAcceptedOutgoing(rows = null) {
    if (acceptedSyncInFlight) return acceptedSyncInFlight;
    acceptedSyncInFlight = (async () => {
      try {
        const list = Array.isArray(rows) ? rows : await syncRequestMap();
        if (!canAutoClaim()) return;
        for (const request of list) {
          if (request?.direction !== 'outgoing' || request?.status !== 'accepted') continue;
          if (request.roomPublicId && localRoomExists(request.roomPublicId)) continue;
          const joined = await claimAccepted(request, false);
          if (joined) break;
        }
      } catch {}
      finally { acceptedSyncInFlight = null; }
    })();
    return acceptedSyncInFlight;
  }

  function buildHead(profile) {
    const head = document.createElement('div');
    head.className = 'fp-system145-request-head';
    const avatar = document.createElement('div');
    avatar.className = 'fp-system145-avatar';
    avatar.textContent = initials(profile?.displayName || profile?.username);
    const copy = document.createElement('div');
    copy.className = 'fp-system145-request-copy';
    const name = document.createElement('b');
    name.textContent = profile?.displayName || 'Пользователь FPChat';
    const handle = document.createElement('span');
    handle.textContent = profile?.username ? `@${profile.username}` : 'Пользователь FPChat';
    copy.append(name, handle);
    head.append(avatar, copy);
    return head;
  }

  function renderIncomingEvent(event, request) {
    const card = document.createElement('div');
    card.className = 'fp-system145-event';
    const sender = event?.payload?.sender || request?.peer || {};
    card.appendChild(buildHead(sender));

    const text = document.createElement('div');
    text.className = 'fp-system145-request-text';
    text.textContent = 'Хочет начать с вами новый приватный чат.';
    card.appendChild(text);

    const status = request?.status || event?.payload?.status || 'pending';
    appendStatus(card, status);

    if (status === 'pending' && request?.direction === 'incoming') {
      const actions = document.createElement('div');
      actions.className = 'fp-system146-actions';
      const accept = document.createElement('button');
      accept.type = 'button';
      accept.className = 'fp-system146-btn accept';
      accept.textContent = 'Принять';
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'fp-system146-btn reject';
      reject.textContent = 'Отклонить';
      const block = document.createElement('button');
      block.type = 'button';
      block.className = 'fp-system146-btn block';
      block.textContent = 'Заблокировать';
      actions.append(accept, reject, block);
      card.appendChild(actions);

      accept.onclick = () => void acceptRequest(request.requestId, card, actions);
      reject.onclick = () => void rejectRequest(request.requestId, card, actions);
      block.onclick = () => void blockRequest(request.requestId, sender.displayName || (sender.username ? `@${sender.username}` : ''), card, actions);
    }

    const time = document.createElement('div');
    time.className = 'fp-system145-event-time';
    time.textContent = formatTime(event?.createdAt);
    card.appendChild(time);
    return card;
  }

  function renderOutgoingResult(event, request) {
    const card = document.createElement('div');
    card.className = 'fp-system145-event';
    const target = event?.payload?.target || request?.peer || {};
    card.appendChild(buildHead(target));

    const text = document.createElement('div');
    text.className = 'fp-system146-event-text';
    if (event?.type === 'chat_request_accepted') {
      text.textContent = 'Принял ваш запрос на новый приватный чат.';
    } else {
      text.textContent = 'Отклонил ваш запрос на новый приватный чат.';
    }
    card.appendChild(text);

    const status = request?.status || event?.payload?.status || (event?.type === 'chat_request_accepted' ? 'accepted' : 'rejected');
    appendStatus(card, status);

    if (event?.type === 'chat_request_accepted' && request?.direction === 'outgoing') {
      const actions = document.createElement('div');
      actions.className = 'fp-system146-actions';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'fp-system146-btn accept';
      open.textContent = status === 'connected' ? 'Открыть чат' : 'Подключиться';
      actions.appendChild(open);
      card.appendChild(actions);
      open.onclick = async () => {
        if (status === 'connected' && request.roomPublicId && localRoomExists(request.roomPublicId)) {
          closeOverlay();
          try { if (typeof openChat === 'function') await openChat(request.roomPublicId); } catch {}
          return;
        }
        open.disabled = true;
        open.textContent = 'Подключение…';
        const ok = await claimAccepted(request, true);
        if (!ok) {
          open.disabled = false;
          open.textContent = 'Повторить';
        }
      };
    }

    const time = document.createElement('div');
    time.className = 'fp-system145-event-time';
    time.textContent = formatTime(event?.createdAt);
    card.appendChild(time);
    return card;
  }

  function renderGenericEvent(event) {
    const card = document.createElement('div');
    card.className = 'fp-system145-event';
    const generic = document.createElement('div');
    generic.className = 'fp-system145-generic';
    generic.textContent = 'Системное уведомление FPChat';
    card.appendChild(generic);
    const time = document.createElement('div');
    time.className = 'fp-system145-event-time';
    time.textContent = formatTime(event?.createdAt);
    card.appendChild(time);
    return card;
  }

  function renderEvent(event) {
    const request = requestByEvent(event);
    if (event?.type === 'chat_request_received') return renderIncomingEvent(event, request);
    if (event?.type === 'chat_request_accepted' || event?.type === 'chat_request_rejected') {
      return renderOutgoingResult(event, request);
    }
    return renderGenericEvent(event);
  }

  function closeOverlay() {
    if (!overlay) return;
    document.removeEventListener('keydown', onOverlayKey, true);
    overlay.remove();
    overlay = null;
  }

  function onOverlayKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeOverlay();
    }
  }

  async function renderOverlayContents(root, feed) {
    const api = systemApi();
    if (!api?.getEvents) throw new Error('system chat unavailable');
    const [events] = await Promise.all([api.getEvents(100), syncRequestMap()]);
    if (overlay !== root) return;
    feed.replaceChildren();
    if (!events.length) {
      const empty = document.createElement('div');
      empty.className = 'fp-system145-empty';
      empty.textContent = 'Системных уведомлений пока нет.';
      feed.appendChild(empty);
      return;
    }
    [...events].reverse().forEach((event) => feed.appendChild(renderEvent(event)));
    feed.scrollTop = feed.scrollHeight;
    const unreadIds = events.filter((event) => !event.readAt).map((event) => event.id);
    if (unreadIds.length) {
      try { await api.markRead(unreadIds); } catch {}
      try { await api.refresh(); } catch {}
    }
  }

  async function openOverlay() {
    const api = systemApi();
    if (!api) return;
    try { api.close?.(); } catch {}
    closeOverlay();

    const root = document.createElement('div');
    root.className = 'fp-system145-overlay';
    root.setAttribute('role', 'presentation');

    const sheet = document.createElement('section');
    sheet.className = 'fp-system145-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Системный чат FPChat');

    const header = document.createElement('div');
    header.className = 'fp-system145-header';
    const back = document.createElement('button');
    back.className = 'fp-system145-back';
    back.type = 'button';
    back.setAttribute('aria-label', 'Назад');
    back.textContent = '‹';
    const title = document.createElement('div');
    title.className = 'fp-system145-title';
    title.innerHTML = '<b>FPChat</b><span>Системный чат</span>';
    header.append(back, title, document.createElement('span'));

    const feed = document.createElement('div');
    feed.className = 'fp-system145-feed';
    const loading = document.createElement('div');
    loading.className = 'fp-system145-empty';
    loading.textContent = 'Загружаем системные события…';
    feed.appendChild(loading);

    sheet.append(header, feed);
    root.appendChild(sheet);
    document.body.appendChild(root);
    overlay = root;

    back.onclick = closeOverlay;
    root.addEventListener('click', (event) => {
      if (event.target === root && window.matchMedia('(min-width:601px)').matches) closeOverlay();
    });
    document.addEventListener('keydown', onOverlayKey, true);

    try {
      await renderOverlayContents(root, feed);
    } catch {
      if (overlay !== root) return;
      feed.replaceChildren();
      const error = document.createElement('div');
      error.className = 'fp-system145-empty';
      error.textContent = 'Не удалось загрузить системный чат.';
      feed.appendChild(error);
    }
  }

  async function refreshOpenOverlay() {
    if (!overlay) {
      await syncRequestMap();
      return;
    }
    const feed = overlay.querySelector('.fp-system145-feed');
    if (!feed) return;
    try { await renderOverlayContents(overlay, feed); } catch {}
  }

  function installSystemChatInterception() {
    document.addEventListener('click', (event) => {
      const row = event.target?.closest?.('.fp-system145-row');
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void openOverlay();
    }, true);

    document.addEventListener('keydown', (event) => {
      const row = event.target?.closest?.('.fp-system145-row');
      if (!row || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void openOverlay();
    }, true);
  }

  async function periodicSync() {
    if (!systemApi()) return;
    try {
      const rows = await syncRequestMap();
      await syncAcceptedOutgoing(rows);
    } catch {}
  }

  function waitForSystemChat(attempt = 0) {
    if (systemApi()) {
      installSystemChatInterception();
      void periodicSync();
      window.addEventListener('focus', () => { if (document.visibilityState === 'visible') void periodicSync(); });
      window.addEventListener('pageshow', () => void periodicSync());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void periodicSync();
      });
      setInterval(() => {
        if (document.visibilityState === 'visible') void periodicSync();
      }, 10000);
      return;
    }
    if (attempt < 100) setTimeout(() => waitForSystemChat(attempt + 1), 100);
  }

  waitForSystemChat();
})();
