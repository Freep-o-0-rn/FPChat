/* Build 162: exact @username lookup, profile actions, blacklist unblock and active-chat reuse.
   Existing local chat filtering and hidden-room semantics remain untouched. */
(() => {
  if (window.__fpUsernameSearch143Installed) return;
  window.__fpUsernameSearch143Installed = true;

  const search = document.getElementById('chatSearch');
  const chatList = document.getElementById('chatListPane');
  const searchTop = search?.closest?.('.chat-list-top');
  if (!search || !chatList || !searchTop) return;

  const style = document.createElement('style');
  style.id = 'fpchat-username-search143-style';
  style.textContent = `
    .fp-username-search143{padding:8px 10px 0}
    .fp-username-search143[hidden]{display:none!important}
    .fp-username-search143:not([hidden]) ~ #emptyChats{display:none!important}
    .fp-username-search143-label{padding:2px 4px 7px;color:var(--muted);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
    .fp-username-search143-card{display:flex;align-items:center;gap:12px;width:100%;padding:12px 13px;border:1px solid rgba(120,130,145,.2);border-radius:15px;background:rgba(120,130,145,.055);box-sizing:border-box;color:inherit;text-align:left;font:inherit;cursor:pointer;transition:background .15s,border-color .15s,transform .12s}
    .fp-username-search143-card:hover{background:rgba(120,130,145,.1);border-color:rgba(120,130,145,.3)}
    .fp-username-search143-card:active{transform:scale(.992)}
    .fp-username-search143-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .fp-username-search143-avatar{width:44px;height:44px;flex:0 0 44px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--accent);color:#fff;font-size:15px;font-weight:800;user-select:none}
    .fp-username-search143-copy{min-width:0;display:flex;flex-direction:column;gap:2px;flex:1}
    .fp-username-search143-name{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fp-username-search143-handle{font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fp-username-search143-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:3px}
    .fp-username-search143-badge{display:inline-flex;width:max-content;padding:2px 7px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:10px;font-weight:750}
    .fp-username-search143-chevron{font-size:24px;line-height:1;color:var(--muted);opacity:.72}
    .fp-username-search143-state{padding:11px 13px;border:1px solid rgba(120,130,145,.16);border-radius:13px;color:var(--muted);font-size:13px;line-height:1.35;background:rgba(120,130,145,.035)}
    .fp-username-search143-state.error{color:var(--danger)}

    .fp-profile144-overlay{position:fixed;inset:0;z-index:4600;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.5);backdrop-filter:blur(2px)}
    .fp-profile144-sheet{position:relative;width:min(420px,100%);max-height:min(720px,calc(100dvh - 32px));overflow:auto;border:1px solid rgba(120,130,145,.22);border-radius:22px;background:var(--panel);box-shadow:0 24px 70px rgba(0,0,0,.34);padding:22px;box-sizing:border-box}
    .fp-profile144-close{position:absolute;top:12px;right:12px;width:36px;height:36px;border:0;border-radius:50%;background:rgba(120,130,145,.12);color:inherit;font-size:24px;line-height:1;cursor:pointer}
    .fp-profile144-head{display:flex;flex-direction:column;align-items:center;text-align:center;padding:8px 28px 4px}
    .fp-profile144-avatar{width:76px;height:76px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--accent);color:#fff;font-size:24px;font-weight:800;box-shadow:0 8px 24px rgba(51,144,236,.22);user-select:none}
    .fp-profile144-name{margin-top:13px;font-size:20px;font-weight:800;line-height:1.25;word-break:break-word}
    .fp-profile144-handle{margin-top:4px;color:var(--muted);font-size:14px}
    .fp-profile144-badges{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:9px}
    .fp-profile144-badge{display:inline-flex;padding:3px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:750}
    .fp-profile144-info{margin-top:18px;padding:13px 14px;border-radius:14px;background:rgba(120,130,145,.07);color:var(--muted);font-size:13px;line-height:1.5}
    .fp-profile145-actions{margin-top:13px}
    .fp-profile145-request,.fp-profile162-unblock{width:100%;min-height:44px;border:0;border-radius:13px;padding:0 14px;font:inherit;font-size:14px;font-weight:750;cursor:pointer;transition:opacity .15s,transform .12s}
    .fp-profile145-request{background:var(--accent);color:#fff}
    .fp-profile162-unblock{margin-top:8px;background:rgba(120,130,145,.12);color:inherit}
    .fp-profile162-unblock[hidden]{display:none!important}
    .fp-profile145-request:active:not(:disabled),.fp-profile162-unblock:active:not(:disabled){transform:scale(.992)}
    .fp-profile145-request:disabled,.fp-profile162-unblock:disabled{cursor:default;opacity:.58}
    .fp-profile145-status{min-height:18px;margin-top:8px;color:var(--muted);font-size:12px;line-height:1.45;text-align:center}
    .fp-profile145-status.success{color:#3bc47d}
    .fp-profile145-status.error{color:var(--danger)}
    @media(max-width:600px){
      .fp-profile144-overlay{align-items:flex-end;padding:0}
      .fp-profile144-sheet{width:100%;max-height:min(78dvh,720px);border-radius:22px 22px 0 0;border-left:0;border-right:0;border-bottom:0;padding:22px 20px calc(22px + env(safe-area-inset-bottom))}
    }
  `;
  document.head.appendChild(style);

  const host = document.createElement('div');
  host.className = 'fp-username-search143';
  host.hidden = true;
  searchTop.insertAdjacentElement('afterend', host);

  let timer = 0;
  let requestSeq = 0;
  let profileOverlay = null;

  function getDeviceId() {
    try {
      if (typeof getOrCreateDeviceId === 'function') return String(getOrCreateDeviceId() || '').trim();
    } catch {}
    return String(localStorage.getItem('fpchat:device-id') || '').trim();
  }

  function listedRoomIds() {
    try {
      if (typeof state !== 'undefined' && Array.isArray(state?.chats)) {
        return [...new Set(state.chats.map((chat) => String(chat?.roomId || '').trim()).filter(Boolean))].slice(0, 100);
      }
    } catch {}
    return [];
  }

  function normalizeQuery(value) {
    const raw = String(value || '').trim();
    if (!raw.startsWith('@')) return null;
    return raw.slice(1).toLowerCase();
  }

  function validSyntax(username) {
    return /^[a-z0-9_]{5,32}$/.test(username || '');
  }

  function initials(value) {
    const clean = String(value || '').trim().replace(/\s+/g, ' ');
    const parts = clean.split(' ').filter(Boolean);
    const raw = parts.length > 1
      ? `${parts[0][0] || ''}${parts[1][0] || ''}`
      : (parts[0] || 'FP').slice(0, 2);
    return raw.toUpperCase() || 'FP';
  }

  async function getRequestStatus(user) {
    const deviceId = getDeviceId();
    if (!deviceId) return { ok: false, code: 'DEVICE_ID_REQUIRED' };
    const params = new URLSearchParams({ deviceId, targetUsername: user.username });
    const rooms = listedRoomIds();
    if (rooms.length) params.set('listedRooms', rooms.join(','));
    const response = await fetch(`/api/chat-requests/status?${params.toString()}`, { cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw Object.assign(new Error('request status unavailable'), { data, status: response.status });
    return data;
  }

  async function sendChatRequest(user) {
    const senderDeviceId = getDeviceId();
    if (!senderDeviceId) throw Object.assign(new Error('device unavailable'), { code: 'DEVICE_ID_REQUIRED' });
    const response = await fetch('/api/chat-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderDeviceId, targetUsername: user.username, listedRoomIds: listedRoomIds() })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      const error = new Error('chat request failed');
      error.code = data?.code || 'CHAT_REQUEST_FAILED';
      error.data = data;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function unblock(blockId) {
    const deviceId = getDeviceId();
    if (!deviceId || !blockId) throw new Error('unblock data unavailable');
    const response = await fetch(`/api/chat-requests/blocks/${encodeURIComponent(blockId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.code || 'unblock failed');
    try { window.dispatchEvent(new CustomEvent('fpchat:block-list-changed')); } catch {}
  }

  function closeProfile() {
    if (!profileOverlay) return;
    document.removeEventListener('keydown', onProfileKey, true);
    profileOverlay.remove();
    profileOverlay = null;
  }

  function onProfileKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeProfile();
    }
  }

  function setRequestStatus(el, text, kind = '') {
    if (!el) return;
    el.textContent = text || '';
    el.className = `fp-profile145-status${kind ? ` ${kind}` : ''}`;
  }

  function setOpenChatAction(button, status, roomId) {
    button.disabled = false;
    button.textContent = 'Открыть чат';
    button.dataset.fpAction = 'open-chat';
    button.dataset.roomId = roomId;
    setRequestStatus(status, 'У вас уже есть активный чат с этим пользователем.', 'success');
  }

  async function hydrateRequestAction(user, button, status, unblockButton) {
    if (!button || user.isSelf) return;
    button.disabled = true;
    button.textContent = 'Проверяем…';
    delete button.dataset.fpAction;
    delete button.dataset.roomId;
    if (unblockButton) {
      unblockButton.hidden = true;
      unblockButton.disabled = false;
      unblockButton.textContent = 'Разблокировать';
      delete unblockButton.dataset.blockId;
    }
    setRequestStatus(status, '');
    try {
      const data = await getRequestStatus(user);
      if (data.youBlockedTarget && data.blockId && unblockButton) {
        unblockButton.hidden = false;
        unblockButton.dataset.blockId = data.blockId;
      }
      if (data.existingChatRoomId) {
        setOpenChatAction(button, status, data.existingChatRoomId);
        return;
      }
      if (data.pending?.direction === 'outgoing') {
        button.textContent = 'Запрос уже отправлен';
        setRequestStatus(status, 'Запрос ожидает ответа пользователя.', 'success');
        return;
      }
      if (data.pending?.direction === 'incoming') {
        button.textContent = 'Есть входящий запрос';
        setRequestStatus(status, 'Этот пользователь уже отправил вам запрос. Откройте системный чат.');
        return;
      }
      if (!data.senderHasProfile) {
        button.textContent = 'Сначала установите username';
        setRequestStatus(status, 'Чтобы отправлять запросы, задайте свой username в Настройки → Профиль.');
        return;
      }
      if (data.youBlockedTarget) {
        button.textContent = 'Запросы заблокированы';
        setRequestStatus(status, 'Пользователь находится в вашем чёрном списке.');
        return;
      }
      if (!data.canSend) {
        button.textContent = 'Запрос недоступен';
        return;
      }
      button.disabled = false;
      button.textContent = 'Отправить запрос на чат';
      setRequestStatus(status, 'Пользователь получит запрос в системном чате.');
    } catch {
      button.textContent = 'Повторить проверку';
      button.disabled = false;
      setRequestStatus(status, 'Не удалось проверить состояние запроса.', 'error');
    }
  }

  function openProfile(user) {
    closeProfile();

    const overlay = document.createElement('div');
    overlay.className = 'fp-profile144-overlay';
    overlay.setAttribute('role', 'presentation');

    const sheet = document.createElement('section');
    sheet.className = 'fp-profile144-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', `Профиль @${user.username}`);

    const close = document.createElement('button');
    close.className = 'fp-profile144-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Закрыть');
    close.textContent = '×';

    const head = document.createElement('div');
    head.className = 'fp-profile144-head';

    const avatar = document.createElement('div');
    avatar.className = 'fp-profile144-avatar';
    avatar.textContent = initials(user.displayName);

    const name = document.createElement('div');
    name.className = 'fp-profile144-name';
    name.textContent = user.displayName || 'Пользователь FPChat';

    const handle = document.createElement('div');
    handle.className = 'fp-profile144-handle';
    handle.textContent = `@${user.username}`;

    const badges = document.createElement('div');
    badges.className = 'fp-profile144-badges';
    if (user.role === 'service') {
      const badge = document.createElement('span');
      badge.className = 'fp-profile144-badge';
      badge.textContent = 'Служебный профиль';
      badges.appendChild(badge);
    }
    if (user.isSelf) {
      const badge = document.createElement('span');
      badge.className = 'fp-profile144-badge';
      badge.textContent = 'Это вы';
      badges.appendChild(badge);
    }

    const info = document.createElement('div');
    info.className = 'fp-profile144-info';
    info.textContent = user.isSelf
      ? 'Это ваш публичный профиль. Другие пользователи смогут находить его только по точному @username.'
      : 'Профиль найден по точному @username. Новый чат создаётся только после отдельного запроса и согласия пользователя.';

    head.append(avatar, name, handle);
    if (badges.childElementCount) head.appendChild(badges);
    sheet.append(close, head, info);

    let requestButton = null;
    let requestStatus = null;
    let unblockButton = null;
    if (!user.isSelf) {
      const actions = document.createElement('div');
      actions.className = 'fp-profile145-actions';
      requestButton = document.createElement('button');
      requestButton.type = 'button';
      requestButton.className = 'fp-profile145-request';
      requestButton.textContent = 'Проверяем…';
      requestButton.disabled = true;
      requestStatus = document.createElement('div');
      requestStatus.className = 'fp-profile145-status';
      unblockButton = document.createElement('button');
      unblockButton.type = 'button';
      unblockButton.className = 'fp-profile162-unblock';
      unblockButton.textContent = 'Разблокировать';
      unblockButton.hidden = true;
      actions.append(requestButton, requestStatus, unblockButton);
      sheet.appendChild(actions);

      requestButton.onclick = async () => {
        if (requestButton.disabled) return;
        if (requestButton.dataset.fpAction === 'open-chat' && requestButton.dataset.roomId) {
          const roomId = requestButton.dataset.roomId;
          closeProfile();
          try {
            if (typeof openChat === 'function') await openChat(roomId);
          } catch {}
          return;
        }
        const label = requestButton.textContent;
        if (label === 'Повторить проверку') {
          await hydrateRequestAction(user, requestButton, requestStatus, unblockButton);
          return;
        }
        requestButton.disabled = true;
        requestButton.textContent = 'Отправляем…';
        setRequestStatus(requestStatus, '');
        try {
          await sendChatRequest(user);
          requestButton.textContent = 'Запрос отправлен';
          setRequestStatus(requestStatus, 'Запрос доставлен в системный чат пользователя и ожидает ответа.', 'success');
        } catch (error) {
          if (error.code === 'SENDER_PROFILE_REQUIRED') {
            requestButton.textContent = 'Сначала установите username';
            setRequestStatus(requestStatus, 'Чтобы отправлять запросы, задайте свой username в Настройки → Профиль.');
            return;
          }
          if (error.code === 'CHAT_REQUEST_EXISTING_CHAT' && error.data?.roomPublicId) {
            setOpenChatAction(requestButton, requestStatus, error.data.roomPublicId);
            return;
          }
          if (error.code === 'CHAT_REQUEST_BLOCKED_BY_YOU') {
            requestButton.textContent = 'Запросы заблокированы';
            requestButton.disabled = true;
            setRequestStatus(requestStatus, 'Пользователь находится в вашем чёрном списке.');
            if (error.data?.blockId) {
              unblockButton.hidden = false;
              unblockButton.dataset.blockId = error.data.blockId;
            }
            return;
          }
          if (error.code === 'CHAT_REQUEST_ALREADY_PENDING') {
            requestButton.textContent = 'Запрос уже отправлен';
            setRequestStatus(requestStatus, 'Запрос уже ожидает ответа пользователя.', 'success');
            return;
          }
          if (error.code === 'CHAT_REQUEST_INCOMING_PENDING') {
            requestButton.textContent = 'Есть входящий запрос';
            setRequestStatus(requestStatus, 'Этот пользователь уже отправил вам запрос. Откройте системный чат.');
            return;
          }
          requestButton.textContent = 'Повторить';
          requestButton.disabled = false;
          setRequestStatus(requestStatus, 'Не удалось отправить запрос.', 'error');
        }
      };

      unblockButton.onclick = async () => {
        const blockId = unblockButton.dataset.blockId;
        if (!blockId || unblockButton.disabled) return;
        unblockButton.disabled = true;
        unblockButton.textContent = 'Разблокируем…';
        try {
          await unblock(blockId);
          await hydrateRequestAction(user, requestButton, requestStatus, unblockButton);
        } catch {
          unblockButton.disabled = false;
          unblockButton.textContent = 'Разблокировать';
          setRequestStatus(requestStatus, 'Не удалось разблокировать пользователя.', 'error');
        }
      };
    }

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    close.onclick = closeProfile;
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeProfile();
    });
    document.addEventListener('keydown', onProfileKey, true);
    profileOverlay = overlay;
    queueMicrotask(() => close.focus({ preventScroll: true }));
    if (requestButton) void hydrateRequestAction(user, requestButton, requestStatus, unblockButton);
  }

  function clear() {
    requestSeq += 1;
    clearTimeout(timer);
    host.hidden = true;
    host.replaceChildren();
  }

  function renderState(text, error = false) {
    host.hidden = false;
    host.replaceChildren();
    const label = document.createElement('div');
    label.className = 'fp-username-search143-label';
    label.textContent = 'Глобальный поиск';
    const state = document.createElement('div');
    state.className = `fp-username-search143-state${error ? ' error' : ''}`;
    state.textContent = text;
    host.append(label, state);
  }

  function renderUser(user) {
    host.hidden = false;
    host.replaceChildren();

    const label = document.createElement('div');
    label.className = 'fp-username-search143-label';
    label.textContent = 'Глобальный поиск';

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'fp-username-search143-card';
    card.setAttribute('aria-label', `Открыть профиль @${user.username}`);

    const avatar = document.createElement('div');
    avatar.className = 'fp-username-search143-avatar';
    avatar.textContent = initials(user.displayName);

    const copy = document.createElement('div');
    copy.className = 'fp-username-search143-copy';

    const name = document.createElement('div');
    name.className = 'fp-username-search143-name';
    name.textContent = user.displayName || 'Пользователь FPChat';

    const handle = document.createElement('div');
    handle.className = 'fp-username-search143-handle';
    handle.textContent = `@${user.username}`;

    const badges = document.createElement('div');
    badges.className = 'fp-username-search143-badges';
    if (user.role === 'service') {
      const badge = document.createElement('span');
      badge.className = 'fp-username-search143-badge';
      badge.textContent = 'Служебный профиль';
      badges.appendChild(badge);
    }
    if (user.isSelf) {
      const badge = document.createElement('span');
      badge.className = 'fp-username-search143-badge';
      badge.textContent = 'Это вы';
      badges.appendChild(badge);
    }

    const chevron = document.createElement('span');
    chevron.className = 'fp-username-search143-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';

    copy.append(name, handle);
    if (badges.childElementCount) copy.appendChild(badges);
    card.append(avatar, copy, chevron);
    card.onclick = () => openProfile(user);
    host.append(label, card);
  }

  async function lookup(username, seq) {
    renderState(`Ищем @${username}…`);
    try {
      const params = new URLSearchParams({ username });
      const deviceId = getDeviceId();
      if (deviceId) params.set('deviceId', deviceId);
      const response = await fetch(`/api/users/by-username?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (seq !== requestSeq) return;

      if (!response.ok || !data?.ok) {
        renderState('Не удалось выполнить поиск.', true);
        return;
      }
      if (!data.found || !data.user) {
        renderState(`Пользователь @${username} не найден.`);
        return;
      }
      renderUser(data.user);
    } catch {
      if (seq === requestSeq) renderState('Не удалось выполнить поиск.', true);
    }
  }

  function onInput() {
    clearTimeout(timer);
    const username = normalizeQuery(search.value);
    if (username === null) return clear();

    const seq = ++requestSeq;
    if (!username) {
      renderState('Введите полный @username.');
      return;
    }
    if (!validSyntax(username)) {
      renderState('Для глобального поиска введите полный @username: 5–32 символа, латинские буквы, цифры и _.');
      return;
    }

    renderState(`Ищем @${username}…`);
    timer = setTimeout(() => lookup(username, seq), 300);
  }

  search.addEventListener('input', onInput);
  search.addEventListener('search', onInput);
  onInput();
})();
