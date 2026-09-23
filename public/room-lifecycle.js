/* Build 98: room lifecycle, system events, permanent delete and CLOSED UI. */
(() => {
  const roomLifecycle = new Map();
  const nativeFetch = window.fetch.bind(window);

  function systemEventText(message) {
    const actor = String(message?.event_actor_name || message?.sender_name || 'Участник');
    if (message?.event_type === 'participant_joined') return `${actor} присоединился к комнате`;
    if (message?.event_type === 'participant_left') return `${actor} покинул комнату`;
    return 'Системное событие';
  }

  function normalizeRoomStatus(value) {
    return String(value || 'open').toLowerCase() === 'closed' ? 'closed' : 'open';
  }

  function noteRoomState(roomId, status, closedAt = null) {
    if (!roomId || !status) return;
    const next = { status: normalizeRoomStatus(status), closedAt: closedAt || null };
    roomLifecycle.set(String(roomId), next);
    const chat = state.chats.find((item) => item.roomId === roomId);
    if (chat) {
      chat.closed = next.status === 'closed';
      chat.closedAt = next.closedAt;
      saveChats();
    }
    if (state.roomId === roomId) applyClosedRoomUi(roomId);
  }

  function getRoomLifecycle(roomId) {
    const known = roomLifecycle.get(String(roomId));
    if (known) return known;
    const chat = state.chats.find((item) => item.roomId === roomId);
    return { status: chat?.closed ? 'closed' : 'open', closedAt: chat?.closedAt || null };
  }

  function applyClosedRoomUi(roomId) {
    if (!roomId || state.roomId !== roomId || getRoomLifecycle(roomId).status !== 'closed') return;
    const view = document.querySelector('.chat-view');
    view?.classList.add('room-closed');
    const presence = document.getElementById('presenceLine');
    if (presence) presence.innerHTML = "<span class='presence-dot offline'></span><span>Чат завершён</span>";
    document.getElementById('replyComposerBar')?.classList.add('hidden');
    const preview = document.getElementById('mediaPreviewRoot');
    if (preview) preview.innerHTML = '';
    const form = document.getElementById('sendForm');
    if (form) {
      const bar = document.createElement('div');
      bar.id = 'closedRoomBar';
      bar.className = 'closed-room-bar';
      bar.textContent = 'Чат завершён';
      form.replaceWith(bar);
    }
  }

  const originalNormalizeNotificationSettings = normalizeNotificationSettings;
  normalizeNotificationSettings = function normalizeNotificationSettingsWithSystemEvents(value) {
    const normalized = originalNormalizeNotificationSettings(value);
    const raw = value && typeof value === 'object' ? value : {};
    return { ...normalized, notifySystemEvents: raw.notifySystemEvents !== false };
  };
  state.notif = normalizeNotificationSettings(state.notif);
  STORAGE.set(STORAGE.notif, state.notif);

  // Keep the existing push implementation, but extend its payload with the new setting.
  window.fetch = function fpchatLifecycleFetch(input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url;
      if ((url === '/api/push/subscribe' || url === '/api/push/settings') && init?.body) {
        const body = JSON.parse(init.body);
        if (url === '/api/push/subscribe') {
          body.settings = { ...(body.settings || {}), notifySystemEvents: state.notif.notifySystemEvents !== false };
        } else {
          body.notifySystemEvents = state.notif.notifySystemEvents !== false;
        }
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch {}
    return nativeFetch(input, init);
  };

  const originalDecryptRoomText = decryptRoomText;
  decryptRoomText = async function decryptRoomTextWithSystemEvents(roomId, message) {
    if (message?.type === 'system') return systemEventText(message);
    return originalDecryptRoomText(roomId, message);
  };

  const originalAppendMessage = appendMessage;
  appendMessage = function appendMessageWithSystemEvents(box, message, text, mine, autoScroll = true) {
    if (message?.type !== 'system') return originalAppendMessage(box, message, text, mine, autoScroll);
    const wrap = document.createElement('div');
    const incoming = !mine;
    const isRead = mine ? 1 : (message.status === 'read' ? 1 : 0);
    wrap.className = 'bubble-wrap msg system-event-wrap';
    wrap.dataset.id = message.id;
    wrap.dataset.createdAt = message.created_at;
    wrap.dataset.messageId = String(message.id);
    wrap.dataset.incoming = incoming ? '1' : '0';
    wrap.dataset.read = String(isRead);
    wrap.dataset.status = String(message.status || 'sent');
    const label = systemEventText(message);
    wrap.innerHTML = `<div class="system-event-chip">${safeText(label)}</div>`;
    box.appendChild(wrap);
    messageCache.set(Number(message.id), {
      id: Number(message.id),
      author: message.event_actor_name || message.sender_name || '',
      text: label,
      preview: label,
      kind: 'system'
    });
    if (incoming && !isRead) {
      if (!autoScroll) pendingIncomingReadIds.push(Number(message.id));
      observeUnreadMessage(wrap);
    }
    if (autoScroll) scrollCoordinator.requestBottom(box);
  };

  const originalOpenChatWithJoinData = openChatWithJoinData;
  openChatWithJoinData = async function openChatWithLifecycle(roomId, secret, deviceId, data, key = null) {
    if (Array.isArray(data?.systemEvents) && data.systemEvents.length) {
      const merged = [...(Array.isArray(data.messages) ? data.messages : []), ...data.systemEvents];
      const unique = new Map(merged.map((message) => [Number(message.id), message]));
      data = { ...data, messages: [...unique.values()].sort((a, b) => Number(a.id) - Number(b.id)) };
    }
    noteRoomState(roomId, data?.roomStatus || 'open', data?.closedAt || null);
    const result = await originalOpenChatWithJoinData(roomId, secret, deviceId, data, key);
    applyClosedRoomUi(roomId);
    const last = Array.isArray(data?.messages) ? data.messages[data.messages.length - 1] : null;
    if (last?.type === 'system') {
      upsertChat(roomId, { lastMessage: systemEventText(last), lastSender: '', lastAt: last.created_at });
      renderChats();
    }
    return result;
  };

  const originalHandleStableWsPayload = handleStableWsPayload;
  handleStableWsPayload = async function handleStableWsPayloadWithLifecycle(payload, deviceId) {
    if (payload?.roomId && payload?.roomStatus) noteRoomState(payload.roomId, payload.roomStatus, payload.closedAt || null);
    if (payload?.type === 'room:state' && payload?.roomId) {
      noteRoomState(payload.roomId, payload.status, payload.closedAt || null);
      return;
    }
    return originalHandleStableWsPayload(payload, deviceId);
  };

  async function unsubscribeRoomPush(roomId) {
    const roomState = STORAGE.get(STORAGE.roomState(roomId));
    if (!roomState?.deviceId) return true;
    try {
      const response = await nativeFetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, deviceId: roomState.deviceId }),
        keepalive: true
      });
      if (response.ok || response.status === 503 || response.status === 404 || response.status === 403) return true;
      return false;
    } catch {
      return state.notif.enabled === false;
    }
  }

  function removeLocalRoom(roomId, { permanent = false } = {}) {
    state.chats = state.chats.filter((chat) => chat.roomId !== roomId);
    if (permanent) {
      delete state.roomNames[roomId];
      delete state.roomMute[roomId];
      saveRoomNames();
      saveRoomMute();
      roomLifecycle.delete(String(roomId));
      roomKeyCache.delete(roomId);
      lastKnownMessageIdByRoom.delete(roomId);
      bufferedRoomMessages.delete(roomId);
    }
    saveChats();
    if (state.roomId === roomId) leaveActiveChat();
    renderChats();
    setView('chats');
    updateUnreadPresentation();
  }

  async function removeRoomFromList(roomId) {
    if (!confirm('Удалить чат из списка?\n\nЧат можно будет восстановить по recovery-коду.')) return;
    const unsubscribed = await unsubscribeRoomPush(roomId);
    if (!unsubscribed) {
      alert('Не удалось отключить уведомления этого чата. Проверьте соединение и повторите попытку.');
      return;
    }
    removeLocalRoom(roomId, { permanent: false });
  }

  function showPermanentDeleteConfirm() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'destructive-modal-overlay';
      overlay.innerHTML = `<div class="destructive-modal" role="dialog" aria-modal="true" aria-labelledby="deleteChatTitle"><h3 id="deleteChatTitle">Удалить чат?</h3><p>Вы навсегда покинете эту комнату.</p><p>После удаления восстановить чат или вернуться в эту комнату будет невозможно.</p><p>Ваш recovery-код для этой комнаты перестанет действовать.</p><div class="destructive-modal-actions"><button type="button" class="btn btn-secondary" data-action="cancel">Отмена</button><button type="button" class="btn danger-button" data-action="delete">Удалить чат</button></div></div>`;
      const finish = (value) => { overlay.remove(); resolve(value); };
      overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false); });
      overlay.querySelector('[data-action="cancel"]').onclick = () => finish(false);
      overlay.querySelector('[data-action="delete"]').onclick = () => finish(true);
      document.body.appendChild(overlay);
    });
  }

  async function permanentlyDeleteRoom(roomId) {
    if (!await showPermanentDeleteConfirm()) return;
    const local = STORAGE.get(STORAGE.roomState(roomId));
    if (!local?.deviceId) {
      alert('Не удалось определить участника этой комнаты.');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await nativeFetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: local.deviceId }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      // Local state is changed only after the server's successful ACK.
      removeLocalRoom(roomId, { permanent: true });
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'Сервер не подтвердил удаление вовремя. Чат не удалён локально.'
        : 'Не удалось удалить чат. Сервер не подтвердил операцию; локальные данные сохранены.';
      alert(message);
    } finally {
      clearTimeout(timer);
    }
  }

  showRoomMenu = function showRoomMenuWithPermanentDelete(roomId, x, y) {
    els.context.innerHTML = '';
    const closed = getRoomLifecycle(roomId).status === 'closed';
    const items = [
      ['Переименовать у себя', () => {
        const value = prompt('Новое имя', state.roomNames[roomId] || '');
        if (value !== null) {
          if (value.trim()) state.roomNames[roomId] = value.trim(); else delete state.roomNames[roomId];
          saveRoomNames(); renderChats(); if (state.roomId === roomId) openChat(roomId);
        }
      }],
      [state.roomMute[roomId] ? 'Включить уведомления в этом чате' : 'Выключить уведомления в этом чате', () => {
        state.roomMute[roomId] = !state.roomMute[roomId];
        saveRoomMute(); renderChats();
        const local = STORAGE.get(STORAGE.roomState(roomId));
        if (local?.deviceId) {
          fetch('/api/push/mute-room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, deviceId: local.deviceId, muted: state.roomMute[roomId] }) });
          if (!state.roomMute[roomId]) syncRoomPushSubscription(roomId).catch(() => {});
        }
      }],
      ['Скопировать invite-ссылку', () => {
        if (closed) { alert('Эта комната закрыта. Invite-ссылка больше недоступна.'); return; }
        const local = STORAGE.get(STORAGE.roomState(roomId));
        if (!local?.inviteLink) { alert('Invite-ссылка уже использована или устарела.'); return; }
        navigator.clipboard.writeText(local.inviteLink);
      }],
      ['Удалить из списка', () => { void removeRoomFromList(roomId); }],
      ['Удалить чат', () => { void permanentlyDeleteRoom(roomId); }]
    ];
    items.forEach(([title, action], index) => {
      const button = document.createElement('button');
      button.className = 'context-item' + (title.includes('Удалить') ? ' danger' : '');
      if (index > 0) button.dataset.sep = '1';
      button.textContent = title;
      button.onclick = () => { hideMenu(); action(); };
      els.context.appendChild(button);
    });
    els.context.classList.remove('hidden');
    const margin = 8;
    const rect = els.context.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - rect.width - margin;
    if (top + rect.height > window.innerHeight - margin) top = window.innerHeight - rect.height - margin;
    els.context.style.left = `${Math.max(margin, left)}px`;
    els.context.style.top = `${Math.max(margin, top)}px`;
    els.context.onclick = (event) => event.stopPropagation();
  };

  // Improve recovery errors without changing the recovery protocol.
  renderRestore = function renderRestoreWithRevokedMessage() {
    els.content.innerHTML = `<div class='panel'><h2>Восстановить</h2><label>Ваш ник</label><input id="nickRestore" value="${safeText(state.nick)}"/><label>Recovery-код</label><input id='recCode'/><div class='panel-actions'><button id='restoreBtn' class='btn btn-primary'>Восстановить</button><button id='backBtn' class='btn btn-secondary'>Назад</button></div><div id='restoreOut'></div></div>`;
    document.getElementById('backBtn').onclick = () => setView('chats');
    document.getElementById('restoreBtn').onclick = async () => {
      const restoreBtn = document.getElementById('restoreBtn');
      restoreBtn.disabled = true;
      restoreBtn.classList.add('btn-loading');
      restoreBtn.textContent = 'Восстановление...';
      try {
        const recoveryCode = document.getElementById('recCode').value.trim().toUpperCase();
        state.nick = document.getElementById('nickRestore').value.trim() || state.nick;
        localStorage.setItem(STORAGE.nick, state.nick);
        const deviceIds = getKnownDeviceIds();
        if (!deviceIds.length) throw new Error('Восстановление доступно только с устройства участника чата.');
        const response = await nativeFetch('/api/recover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recoveryCode, deviceIds })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (data?.code === 'RECOVERY_REVOKED') throw new Error('Доступ к этой комнате был окончательно удалён.');
          throw new Error(response.status === 403 ? 'Recovery-код неверный или не относится к этому устройству.' : 'Ошибка восстановления');
        }
        if (!data?.deviceId) throw new Error('Восстановление невозможно: отсутствует deviceId в recovery.');
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(recoveryCode), 'PBKDF2', false, ['deriveKey']);
        const recoveryKey = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64.decode(data.recoverySalt), iterations: 250000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.decode(data.recoverySecretIv) }, recoveryKey, b64.decode(data.recoverySecretCiphertext));
        const roomId = data.publicId;
        STORAGE.set(STORAGE.roomState(roomId), { secret: new TextDecoder().decode(plain), deviceId: data.deviceId, recoveryCode });
        upsertChat(roomId, { closed: normalizeRoomStatus(data.roomStatus) === 'closed', closedAt: data.closedAt || null });
        noteRoomState(roomId, data.roomStatus || 'open', data.closedAt || null);
        if (state.notif.enabled) syncRoomPushSubscription(roomId).catch(() => {});
        document.getElementById('restoreOut').innerHTML = `<p>Чат восстановлен</p><button id='goRest' class='btn btn-primary'>Перейти в чат</button>`;
        document.getElementById('goRest').onclick = () => openChat(roomId);
      } catch (error) {
        alert(error.message || 'Ошибка восстановления');
        restoreBtn.disabled = false;
        restoreBtn.classList.remove('btn-loading');
        restoreBtn.textContent = 'Восстановить';
      }
    };
  };

  window.FPRoomLifecycle98Ready = true;
  window.dispatchEvent(new Event('fpchat:room-lifecycle-ready174'));

  // Startup now installs this wrapper before any navigation. No repair re-entry.
})();
