/* Build 165: full user blocking UI for profiles, rooms, composer and invite errors. */
(() => {
  if (window.__fpUserBlocks165ClientInstalled) return;
  window.__fpUserBlocks165ClientInstalled = true;

  const STYLE_ID = 'fpchat-user-blocks165-style';
  const DEVICE_KEY = 'fpchat:device-id';
  const roomStatus = new Map();
  const submittedText = new Map();
  let warningTimer = 0;
  let wrappedMenuBase = null;
  let wrappedAckBase = null;
  let wrappedJoinBase = null;
  let wrappedAppendBase = null;
  let wrappedPresenceBase = null;

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .fp-block165-warning{position:relative;margin:0 12px 8px;padding:8px 12px;border:1px solid color-mix(in srgb,var(--danger) 42%,transparent);border-radius:11px;background:color-mix(in srgb,var(--danger) 10%,var(--panel));color:var(--danger);font-size:13px;line-height:1.35;text-align:center;animation:fpBlock165In .14s ease-out}
      .fp-block165-owner{display:flex;align-items:center;justify-content:center;gap:10px;min-height:52px;margin:0 12px 8px;padding:8px 10px;border:1px solid rgba(120,130,145,.2);border-radius:14px;background:rgba(120,130,145,.07);box-sizing:border-box}
      .fp-block165-owner span{font-size:13px;color:var(--muted);line-height:1.3}
      .fp-block165-owner button{border:0;border-radius:10px;padding:8px 12px;background:var(--accent);color:#fff;font:inherit;font-size:13px;font-weight:750;cursor:pointer}
      #sendForm.fp-block165-hidden{display:none!important}
      .fp-profile165-block{width:100%;min-height:44px;margin-top:8px;border:1px solid color-mix(in srgb,var(--danger) 30%,transparent);border-radius:13px;padding:0 14px;background:color-mix(in srgb,var(--danger) 9%,transparent);color:var(--danger);font:inherit;font-size:14px;font-weight:750;cursor:pointer}
      .fp-profile165-block:disabled{opacity:.58;cursor:default}
      .fp-block165-menu-danger{color:var(--danger)!important}
      @keyframes fpBlock165In{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
      @media(max-width:600px){.fp-block165-warning,.fp-block165-owner{margin-left:8px;margin-right:8px}}
    `;
    document.head.appendChild(style);
  }

  function deviceId() {
    try {
      if (typeof getOrCreateDeviceId === 'function') return String(getOrCreateDeviceId() || '').trim();
    } catch {}
    return String(localStorage.getItem(DEVICE_KEY) || '').trim();
  }

  function currentRoomId() {
    try { return String(state?.roomId || ''); } catch { return ''; }
  }

  async function apiJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      const error = new Error(data?.error || data?.code || `HTTP ${response.status}`);
      error.code = data?.code || '';
      error.data = data;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function warningHost() {
    const form = document.getElementById('sendForm');
    return form?.parentElement || document.querySelector('.chat-view');
  }

  function showWarning(text = 'Отправка недоступна: вы заблокированы.') {
    const host = warningHost();
    if (!host) return;
    clearTimeout(warningTimer);
    let bar = document.getElementById('fpBlockWarning165');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'fpBlockWarning165';
      bar.className = 'fp-block165-warning';
      const form = document.getElementById('sendForm');
      if (form?.parentElement === host) host.insertBefore(bar, form);
      else host.appendChild(bar);
    }
    bar.textContent = text;
    bar.hidden = false;
    warningTimer = setTimeout(() => bar?.remove(), 5000);
  }

  function removeWarning() {
    clearTimeout(warningTimer);
    document.getElementById('fpBlockWarning165')?.remove();
  }

  function renderBlockedPresence() {
    const id = currentRoomId();
    const status = roomStatus.get(id);
    if (!status || status.presenceVisible !== false || status.blockedByMe) return false;
    const line = document.getElementById('presenceLine');
    if (!line) return false;
    line.classList.remove('fp-typing-active');
    line.innerHTML = "<span class='presence-dot offline'></span><span>Статус недоступен</span>";
    return true;
  }

  function applyRoomStatus(roomId, status) {
    if (!roomId || !status?.ok) return;
    const storedStatus = { ...status, _fetchedAt: Date.now(), _loading: false };
    roomStatus.set(String(roomId), storedStatus);
    status = storedStatus;
    if (String(roomId) !== currentRoomId()) return;

    if (status.peer?.deviceId && typeof state !== 'undefined') {
      state.presence[status.peer.deviceId] = {
        roomId: String(roomId),
        deviceId: status.peer.deviceId,
        displayName: status.peer.displayName || '',
        online: status.presenceVisible === false ? false : Boolean(status.peer.online),
        lastSeenAt: status.presenceVisible === false ? null : (status.peer.lastSeenAt || null),
        statusUnavailable: status.presenceVisible === false
      };
    }

    const form = document.getElementById('sendForm');
    const host = form?.parentElement || document.getElementById('fpBlockOwner165')?.parentElement;
    let owner = document.getElementById('fpBlockOwner165');
    if (status.blockedByMe && host) {
      removeWarning();
      if (form) form.classList.add('fp-block165-hidden');
      if (!owner) {
        owner = document.createElement('div');
        owner.id = 'fpBlockOwner165';
        owner.className = 'fp-block165-owner';
        owner.innerHTML = '<span>Вы заблокировали пользователя</span><button type="button">Разблокировать</button>';
        if (form?.parentElement === host) host.insertBefore(owner, form);
        else host.appendChild(owner);
      }
      const button = owner.querySelector('button');
      button.onclick = async () => {
        const latest = roomStatus.get(String(roomId));
        if (!latest?.blockId || button.disabled) return;
        button.disabled = true;
        button.textContent = 'Разблокируем…';
        try {
          await apiJson(`/api/user-blocks/${encodeURIComponent(latest.blockId)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: deviceId() })
          });
          await refreshRoomStatus(roomId, true);
          try { window.dispatchEvent(new CustomEvent('fpchat:block-list-changed')); } catch {}
        } catch {
          button.disabled = false;
          button.textContent = 'Разблокировать';
        }
      };
    } else {
      owner?.remove();
      form?.classList.remove('fp-block165-hidden');
    }

    if (!renderBlockedPresence()) {
      try { renderPresenceStatus(); } catch {}
    }
  }

  async function refreshRoomStatus(roomId = currentRoomId(), force = false) {
    const id = String(roomId || '');
    const dev = deviceId();
    if (!id || !dev) return null;
    const cached = roomStatus.get(id);
    if (!force && cached?._loading) return cached;
    if (!force && cached?._fetchedAt && Date.now() - cached._fetchedAt < 1500) return cached;
    const previous = cached || {};
    roomStatus.set(id, { ...previous, _loading: true });
    try {
      const params = new URLSearchParams({ roomId: id, deviceId: dev });
      const data = await apiJson(`/api/user-blocks/room-status?${params.toString()}`, { cache: 'no-store' });
      applyRoomStatus(id, data);
      return data;
    } catch {
      roomStatus.set(id, { ...previous, _loading: false });
      return null;
    }
  }

  async function blockRoomUser(roomId) {
    const peerName = roomStatus.get(String(roomId))?.peer?.displayName || 'пользователя';
    if (!confirm(`Заблокировать ${peerName}?\n\nВы не сможете писать друг другу, пока не разблокируете пользователя.`)) return false;
    try {
      await apiJson('/api/user-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId(), roomId })
      });
      await refreshRoomStatus(roomId, true);
      try { window.dispatchEvent(new CustomEvent('fpchat:block-list-changed')); } catch {}
      return true;
    } catch {
      alert('Не удалось заблокировать пользователя.');
      return false;
    }
  }

  async function unblockRoomUser(roomId) {
    const status = await refreshRoomStatus(roomId, true);
    if (!status?.blockId) return false;
    try {
      await apiJson(`/api/user-blocks/${encodeURIComponent(status.blockId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId() })
      });
      await refreshRoomStatus(roomId, true);
      try { window.dispatchEvent(new CustomEvent('fpchat:block-list-changed')); } catch {}
      return true;
    } catch {
      alert('Не удалось разблокировать пользователя.');
      return false;
    }
  }

  function installRoomMenuWrapper() {
    if (typeof showRoomMenu !== 'function' || showRoomMenu.__fpUserBlocks165) return;
    const base = showRoomMenu;
    wrappedMenuBase = base;
    const wrapped = function showRoomMenuWithUserBlocks165(roomId, x, y) {
      const result = base(roomId, x, y);
      queueMicrotask(async () => {
        const menu = document.getElementById('contextMenu');
        if (!menu || menu.classList.contains('hidden')) return;
        const deleteFromList = [...menu.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Удалить из списка');
        if (!deleteFromList) return;
        let button = menu.querySelector('[data-fp-user-block165]');
        if (!button) {
          button = document.createElement('button');
          button.className = 'context-item';
          button.dataset.fpUserBlock165 = '1';
          button.dataset.sep = '1';
          button.textContent = 'Проверяем блокировку…';
          button.disabled = true;
          menu.insertBefore(button, deleteFromList);
        }
        const status = await refreshRoomStatus(roomId, true);
        if (!status?.peer || !button.isConnected) {
          button?.remove();
          return;
        }
        button.disabled = false;
        button.textContent = status.blockedByMe ? 'Разблокировать пользователя' : 'Заблокировать пользователя';
        button.classList.toggle('fp-block165-menu-danger', !status.blockedByMe);
        button.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          try { hideMenu(); } catch {}
          if (status.blockedByMe) void unblockRoomUser(roomId);
          else void blockRoomUser(roomId);
        };
        const margin = 8;
        const rect = menu.getBoundingClientRect();
        let left = Number.parseFloat(menu.style.left) || x || margin;
        let top = Number.parseFloat(menu.style.top) || y || margin;
        if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - rect.width - margin;
        if (top + rect.height > window.innerHeight - margin) top = window.innerHeight - rect.height - margin;
        menu.style.left = `${Math.max(margin, left)}px`;
        menu.style.top = `${Math.max(margin, top)}px`;
      });
      return result;
    };
    wrapped.__fpUserBlocks165 = true;
    wrapped.__fpBase = base;
    showRoomMenu = wrapped;
  }

  function blockEventLabel(message) {
    const actor = String(message?.event_actor_name || message?.sender_name || 'Пользователь');
    return `${actor} попытался войти по приглашению. Вход отклонён из-за блокировки.`;
  }

  function installAppendWrapper() {
    if (typeof appendMessage !== 'function' || appendMessage.__fpUserBlocks165) return;
    const base = appendMessage;
    wrappedAppendBase = base;
    const wrapped = function appendMessageWithBlockedInvite165(box, message, text, mine, autoScroll = true) {
      if (message?.type !== 'system' || !String(message?.event_type || '').startsWith('blocked_invite_attempt:')) {
        return base(box, message, text, mine, autoScroll);
      }
      const wrap = document.createElement('div');
      const incoming = !mine;
      const isRead = mine ? 1 : (message.status === 'read' ? 1 : 0);
      wrap.className = 'bubble-wrap msg system-event-wrap';
      wrap.dataset.id = message.id;
      wrap.dataset.createdAt = message.created_at;
      wrap.dataset.messageId = String(message.id);
      wrap.dataset.incoming = incoming ? '1' : '0';
      wrap.dataset.read = String(isRead);
      const label = blockEventLabel(message);
      wrap.innerHTML = `<div class="system-event-chip">${safeText(label)}</div>`;
      box.appendChild(wrap);
      try {
        messageCache.set(Number(message.id), { id: Number(message.id), author: message.event_actor_name || '', text: label, preview: label, kind: 'system' });
      } catch {}
      if (incoming && !isRead) {
        try {
          if (!autoScroll) pendingIncomingReadIds.push(Number(message.id));
          observeUnreadMessage(wrap);
        } catch {}
      }
      if (autoScroll) {
        try { scrollCoordinator.requestBottom(box); } catch { try { scrollMessagesToBottom(box); } catch {} }
      }
      return wrap;
    };
    wrapped.__fpUserBlocks165 = true;
    appendMessage = wrapped;
  }

  function restoreRejectedText(roomId, clientMessageId) {
    const id = String(clientMessageId || '');
    if (id) {
      const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
      document.querySelector(`.bubble-wrap.msg[data-client-message-id="${escaped}"]`)?.remove();
    }
    if (String(roomId || '') !== currentRoomId()) return;
    const input = document.getElementById('msgInput');
    const saved = submittedText.get(String(roomId || '')) || '';
    if (input && saved && !input.value.trim()) {
      input.value = saved;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      try { autoResizeMessageInput(input); } catch {}
    }
  }

  function installAckWrapper() {
    if (typeof handleWsMessageAck !== 'function' || handleWsMessageAck.__fpUserBlocks165) return;
    const base = handleWsMessageAck;
    wrappedAckBase = base;
    const wrapped = function handleWsMessageAckWithBlocks165(payload) {
      const handled = base(payload);
      if (payload?.type === 'message:ack' && payload.accepted === false) {
        const roomId = String(payload.roomId || currentRoomId());
        if (payload.code === 'USER_BLOCKED_BY_PEER') {
          restoreRejectedText(roomId, payload.clientMessageId);
          showWarning();
          void refreshRoomStatus(roomId, true);
        } else if (payload.code === 'USER_BLOCKED_BY_YOU') {
          restoreRejectedText(roomId, payload.clientMessageId);
          void refreshRoomStatus(roomId, true);
        }
      }
      return handled;
    };
    wrapped.__fpUserBlocks165 = true;
    handleWsMessageAck = wrapped;
  }

  function installPresenceWrapper() {
    if (typeof renderPresenceStatus !== 'function' || renderPresenceStatus.__fpUserBlocks165) return;
    const base = renderPresenceStatus;
    wrappedPresenceBase = base;
    const wrapped = function renderPresenceStatusWithBlocks165() {
      if (renderBlockedPresence()) return;
      return base();
    };
    wrapped.__fpUserBlocks165 = true;
    renderPresenceStatus = wrapped;
  }

  function installWsWrapper() {
    if (typeof handleStableWsPayload !== 'function' || handleStableWsPayload.__fpUserBlocks165) return;
    const base = handleStableWsPayload;
    const wrapped = async function handleStableWsPayloadWithBlocks165(payload, dev) {
      if (payload?.type === 'user-block:changed' && payload.roomId) {
        await refreshRoomStatus(payload.roomId, true);
        return;
      }
      return base(payload, dev);
    };
    wrapped.__fpUserBlocks165 = true;
    handleStableWsPayload = wrapped;
  }

  function installJoinWrapper() {
    if (typeof joinByInviteText !== 'function' || joinByInviteText.__fpUserBlocks165) return;
    const base = joinByInviteText;
    wrappedJoinBase = base;
    const wrapped = async function joinByInviteTextWithBlockErrors165(text) {
      const parsed = parseInviteInput(text);
      if (parsed?.error === 'empty') { alert('Вставьте invite-ссылку'); return false; }
      if (parsed?.error === 'old_invite') { alert('Старая invite-ссылка больше не поддерживается. Попросите новую ссылку.'); return false; }
      if (parsed?.error === 'invalid' || !parsed?.inviteCode) { alert('Некорректная invite-ссылка'); return false; }
      state.nick = localStorage.getItem(STORAGE.nick) || state.nick;
      const displayName = state.nick;
      const dev = getOrCreateDeviceId();
      let res;
      try {
        res = await fetch(`/api/invites/${parsed.inviteCode}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName, deviceId: dev }) });
      } catch {
        alert('Не удалось подключиться. Проверьте соединение.');
        return false;
      }
      if (res.status === 404) { alert('Invite-ссылка недействительна.'); return false; }
      if (res.status === 410) { alert('Invite-ссылка устарела или уже использована.'); return false; }
      if (res.status === 409) {
        const errorData = await res.json().catch(() => null);
        alert(errorData?.error === 'device already belongs to room' ? 'Это устройство уже подключено к этому чату.' : 'В этот чат уже присоединился второй участник.');
        return false;
      }
      if (res.status === 403) {
        const errorData = await res.json().catch(() => null);
        if (errorData?.code === 'INVITE_BLOCKED_BY_CREATOR' || errorData?.code === 'INVITE_CREATOR_BLOCKED_BY_YOU') alert(errorData.error);
        else alert('Нет доступа к этому чату.');
        return false;
      }
      if (!res.ok) { alert('Не удалось подключиться. Проверьте соединение.'); return false; }
      const data = await res.json().catch(() => null);
      if (!data?.ok || !data.publicId || !data.roomSecret || !Array.isArray(data.messages)) { alert('Не удалось подключиться. Проверьте соединение.'); return false; }
      let key;
      try { key = await deriveKey(data.roomSecret); } catch { alert('Не удалось подключиться. Проверьте соединение.'); return false; }
      if (data.messages.length > 0) {
        let decryptedAny = false;
        for (const msg of data.messages) {
          try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.decode(msg.iv) }, key, b64.decode(msg.ciphertext)); decryptedAny = true; break; } catch {}
        }
        if (!decryptedAny) { alert('Не удалось подключиться. Проверьте соединение.'); return false; }
      }
      STORAGE.set(STORAGE.roomState(data.publicId), { secret: data.roomSecret, deviceId: dev });
      upsertChat(data.publicId, {});
      state.key = key;
      let joinedRecoveryCode = null;
      let recoveryRegistrationFailed = false;
      try { joinedRecoveryCode = await registerRecoveryForJoinedParticipant(data.publicId, dev, data.roomSecret); } catch { recoveryRegistrationFailed = true; }
      await openChatWithJoinData(data.publicId, data.roomSecret, dev, data, key);
      if (joinedRecoveryCode) showRecoveryCodeModal(joinedRecoveryCode);
      else if (recoveryRegistrationFailed) alert('Чат подключён, но recovery-код не был создан. Перезайдите или создайте новый чат.');
      return true;
    };
    wrapped.__fpUserBlocks165 = true;
    wrapped.__fpBase = base;
    joinByInviteText = wrapped;
  }

  async function profileBlock(username, button, existingUnblock) {
    if (!username || button.disabled) return;
    if (!confirm(`Заблокировать @${username}?\n\nВы не сможете писать друг другу, пока не разблокируете пользователя.`)) return;
    button.disabled = true;
    button.textContent = 'Блокируем…';
    try {
      const data = await apiJson('/api/user-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId(), targetUsername: username })
      });
      button.remove();
      if (existingUnblock && data.blockId) {
        existingUnblock.hidden = false;
        existingUnblock.disabled = false;
        existingUnblock.dataset.blockId = data.blockId;
        existingUnblock.textContent = 'Разблокировать';
      }
      try { window.dispatchEvent(new CustomEvent('fpchat:block-list-changed')); } catch {}
    } catch {
      button.disabled = false;
      button.textContent = 'Заблокировать пользователя';
      alert('Не удалось заблокировать пользователя.');
    }
  }

  function decorateProfile(overlay) {
    if (!overlay || overlay.dataset.fpBlocks165 === '1') return;
    overlay.dataset.fpBlocks165 = '1';
    const actions = overlay.querySelector('.fp-profile145-actions');
    const handle = overlay.querySelector('.fp-profile144-handle')?.textContent?.trim() || '';
    const username = handle.replace(/^@/, '').toLowerCase();
    if (!actions || !username) return;
    const ownBadge = [...overlay.querySelectorAll('.fp-profile144-badge')].some((el) => el.textContent?.trim() === 'Это вы');
    if (ownBadge) return;

    const blockButton = document.createElement('button');
    blockButton.type = 'button';
    blockButton.className = 'fp-profile165-block';
    blockButton.textContent = 'Заблокировать пользователя';
    const existingUnblock = overlay.querySelector('.fp-profile162-unblock');
    actions.appendChild(blockButton);

    const sync = () => {
      if (!blockButton.isConnected) return;
      blockButton.hidden = Boolean(existingUnblock && !existingUnblock.hidden);
    };
    sync();
    const observer = new MutationObserver(sync);
    if (existingUnblock) observer.observe(existingUnblock, { attributes: true, attributeFilter: ['hidden', 'disabled'] });
    blockButton.onclick = () => void profileBlock(username, blockButton, existingUnblock);
  }

  function currentBlockStatus() {
    return roomStatus.get(currentRoomId()) || null;
  }

  document.addEventListener('submit', (event) => {
    if (event.target?.id !== 'sendForm') return;
    const id = currentRoomId();
    const input = document.getElementById('msgInput');
    if (id && input) submittedText.set(id, input.value);
    const status = currentBlockStatus();
    if (!status?.communicationBlocked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (status.blockedByMe) void refreshRoomStatus(id, true);
    else showWarning();
  }, true);

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('#sendForm')) return;
    if (!target.closest('.composer-attach,.fp-voice-record-btn,.fp-voice-record-send')) return;
    const status = currentBlockStatus();
    if (!status?.communicationBlocked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!status.blockedByMe) showWarning();
  }, true);

  window.addEventListener('fpchat:block-list-changed', () => {
    const id = currentRoomId();
    if (id) void refreshRoomStatus(id, true);
  });

  const observer = new MutationObserver(() => {
    document.querySelectorAll('.fp-profile144-overlay').forEach(decorateProfile);
    const id = currentRoomId();
    if (id && document.getElementById('sendForm') && !roomStatus.get(id)?._loading) void refreshRoomStatus(id);
    installRoomMenuWrapper();
    installAckWrapper();
    installPresenceWrapper();
    installWsWrapper();
    installJoinWrapper();
    installAppendWrapper();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(() => {
    installRoomMenuWrapper();
    installAckWrapper();
    installPresenceWrapper();
    installWsWrapper();
    installJoinWrapper();
    installAppendWrapper();
  }, 700);

  setInterval(() => {
    const id = currentRoomId();
    if (id && document.visibilityState === 'visible') void refreshRoomStatus(id, true);
  }, 10000);

  installRoomMenuWrapper();
  installAckWrapper();
  installPresenceWrapper();
  installWsWrapper();
  installJoinWrapper();
  installAppendWrapper();
})();
