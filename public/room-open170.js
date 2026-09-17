/* Build 170: guarded room-open owner.
   Replaces only the public openChat path. Existing openChatWithJoinData/rendering,
   scroll, presence, unread and WebSocket behavior stay unchanged. */
(() => {
  if (window.__fpRoomOpen170Installed) return;

  const contexts = window.FPRoomContext170;
  if (!contexts
      || typeof contexts.beginTransition !== 'function'
      || typeof openChat !== 'function'
      || typeof openChatWithJoinData !== 'function') {
    return;
  }

  window.__fpRoomOpen170Installed = true;

  function normalizeRoomId(value) {
    return String(value || '').trim();
  }

  function dispatch(stage, context, extra = {}) {
    try {
      window.dispatchEvent(new CustomEvent('fpchat:room-open170', {
        detail: {
          stage,
          roomId: context?.roomId || null,
          generation: context?.generation || null,
          ...extra
        }
      }));
    } catch {}
  }

  function isLatest(context) {
    return contexts.isLatestTransition(context);
  }

  function cancelIfLatest(context, reason) {
    if (isLatest(context)) contexts.cancelTransition(context, reason);
  }

  openChat = async function openChat170(roomId) {
    closeMobileMenu();

    const normalizedRoomId = normalizeRoomId(roomId);
    const persisted = STORAGE.get(STORAGE.roomState(roomId));
    if (!persisted?.secret || !persisted?.deviceId) {
      alert('Нет доступа к этому чату. Восстановите доступ по recovery-коду или invite-ссылке.');
      removeBrokenChat(roomId);
      return;
    }

    const context = contexts.beginTransition(normalizedRoomId);
    dispatch('started', context);

    const secret = String(persisted.secret || '');
    const deviceId = String(persisted.deviceId || '');
    let key;
    let response;

    try {
      key = await deriveKey(secret);
      if (!isLatest(context)) {
        dispatch('stale-after-key', context);
        return;
      }

      response = await fetch(`/api/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: state.nick, deviceId })
      });

      if (!isLatest(context)) {
        dispatch('stale-after-join', context);
        return;
      }
    } catch {
      if (!isLatest(context)) {
        dispatch('stale-after-error', context);
        return;
      }
      cancelIfLatest(context, 'connection-error');
      alert('Не удалось подключиться к чату. Проверьте соединение.');
      setView('chats');
      return;
    }

    if ([500, 502, 503].includes(response.status)) {
      cancelIfLatest(context, `http-${response.status}`);
      alert('Не удалось подключиться к чату. Проверьте соединение.');
      setView('chats');
      return;
    }

    if (response.status === 404) {
      cancelIfLatest(context, 'room-not-found');
      removeBrokenChat(roomId);
      return;
    }

    if (response.status === 403) {
      cancelIfLatest(context, 'room-forbidden');
      alert('Нет доступа к этому чату. Восстановите доступ по recovery-коду или invite-ссылке.');
      removeBrokenChat(roomId);
      return;
    }

    if (!response.ok) {
      cancelIfLatest(context, `http-${response.status}`);
      setView('chats');
      return;
    }

    const data = await response.json().catch(() => null);
    if (!isLatest(context)) {
      dispatch('stale-after-json', context);
      return;
    }

    if (!data || !Array.isArray(data.messages)) {
      cancelIfLatest(context, 'invalid-join-payload');
      alert('Не удалось загрузить чат.');
      setView('chats');
      return;
    }

    const activeContext = contexts.commitTransition(context, key);
    if (!activeContext) {
      dispatch('stale-before-commit', context);
      return;
    }

    dispatch('committed', activeContext);

    try {
      await openChatWithJoinData(roomId, secret, deviceId, data, key);
    } catch (error) {
      if (contexts.isCurrent(activeContext)) {
        contexts.endRoom(activeContext, 'open-failed');
        dispatch('failed', activeContext);
      }
      throw error;
    }

    if (!contexts.isCurrent(activeContext)) {
      dispatch('stale-after-render', activeContext);
      return;
    }

    dispatch('ready', activeContext);
  };

  try {
    window.FPRuntime?.registerOwner?.('room-open170', {
      role: 'open-chat',
      mode: 'active-owner',
      replaces: 'legacy openChat'
    });
  } catch {}
})();
