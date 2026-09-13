/* Build 116: transient Telegram-like typing indicator. */
(() => {
  const STOP_DELAY_MS = 2400;
  const START_HEARTBEAT_MS = 1500;
  const REMOTE_SAFETY_MS = 5500;

  let attachedWs = null;
  let activeTypingRoomId = '';
  let typingStarted = false;
  let lastStartSentAt = 0;
  let stopTimer = null;
  const remoteTyping = new Map();

  const baseRenderPresenceStatus = typeof renderPresenceStatus === 'function' ? renderPresenceStatus : null;

  function currentRoomId() {
    try { return String(state?.roomId || ''); } catch { return ''; }
  }

  function currentDeviceId(roomId = currentRoomId()) {
    if (!roomId) return '';
    try { return String(STORAGE.get(STORAGE.roomState(roomId))?.deviceId || '').trim(); } catch { return ''; }
  }

  function socketReady() {
    try { return state?.ws && state.ws.readyState === WebSocket.OPEN; } catch { return false; }
  }

  function sendTyping(type, roomId) {
    if (!roomId || !socketReady()) return false;
    try {
      state.ws.send(JSON.stringify({ type, roomId }));
      return true;
    } catch {
      return false;
    }
  }

  function clearStopTimer() {
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = null;
  }

  function stopLocalTyping(roomId = activeTypingRoomId) {
    clearStopTimer();
    if (typingStarted && roomId) sendTyping('typing:stop', roomId);
    typingStarted = false;
    lastStartSentAt = 0;
    if (!roomId || roomId === activeTypingRoomId) activeTypingRoomId = '';
  }

  function scheduleStop() {
    clearStopTimer();
    stopTimer = setTimeout(() => stopLocalTyping(), STOP_DELAY_MS);
  }

  function pulseLocalTyping(input) {
    const roomId = currentRoomId();
    if (!roomId || document.visibilityState !== 'visible' || input?.disabled) {
      stopLocalTyping();
      return;
    }

    const hasContent = String(input?.value || '').length > 0;
    if (!hasContent) {
      stopLocalTyping();
      return;
    }

    if (activeTypingRoomId && activeTypingRoomId !== roomId) stopLocalTyping(activeTypingRoomId);
    activeTypingRoomId = roomId;

    const now = Date.now();
    if (!typingStarted || now - lastStartSentAt >= START_HEARTBEAT_MS) {
      if (sendTyping('typing:start', roomId)) {
        typingStarted = true;
        lastStartSentAt = now;
      }
    }
    scheduleStop();
  }

  function isRoomClosed() {
    return document.querySelector('.chat-view')?.classList.contains('room-closed') === true;
  }

  function renderRemoteTyping() {
    const roomId = currentRoomId();
    const entry = remoteTyping.get(roomId);
    if (!roomId || !entry || entry.expiresAt <= Date.now() || isRoomClosed()) return false;
    const line = document.getElementById('presenceLine');
    if (!line) return false;
    if (line.dataset.fpTypingDevice === entry.deviceId && line.classList.contains('fp-typing-active')) return true;
    line.dataset.fpTypingDevice = entry.deviceId;
    line.classList.add('fp-typing-active');
    line.innerHTML = "<span class='presence-dot online'></span><span class='fp-typing-label'>печатает…</span>";
    return true;
  }

  function restorePresence() {
    const line = document.getElementById('presenceLine');
    if (line) {
      line.classList.remove('fp-typing-active');
      delete line.dataset.fpTypingDevice;
    }
    if (!isRoomClosed() && baseRenderPresenceStatus) {
      try { baseRenderPresenceStatus(); } catch {}
    }
  }

  function clearRemoteTyping(roomId, deviceId = '') {
    const entry = remoteTyping.get(roomId);
    if (!entry || (deviceId && entry.deviceId !== deviceId)) return;
    if (entry.timer) clearTimeout(entry.timer);
    remoteTyping.delete(roomId);
    if (roomId === currentRoomId()) restorePresence();
  }

  function setRemoteTyping(roomId, deviceId, displayName) {
    if (!roomId || !deviceId || deviceId === currentDeviceId(roomId)) return;
    clearRemoteTyping(roomId);
    const entry = {
      deviceId,
      displayName: String(displayName || ''),
      expiresAt: Date.now() + REMOTE_SAFETY_MS,
      timer: null
    };
    entry.timer = setTimeout(() => clearRemoteTyping(roomId, deviceId), REMOTE_SAFETY_MS);
    remoteTyping.set(roomId, entry);
    if (roomId === currentRoomId()) renderRemoteTyping();
  }

  function handleWsMessage(event) {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (!payload || payload.type !== 'typing:update') return;
    const roomId = String(payload.roomId || '');
    const deviceId = String(payload.deviceId || '');
    if (!roomId || !deviceId) return;
    if (payload.typing === true) setRemoteTyping(roomId, deviceId, payload.displayName);
    else clearRemoteTyping(roomId, deviceId);
  }

  function attachCurrentWs() {
    const ws = state?.ws;
    if (!ws || ws === attachedWs) return;
    if (attachedWs) {
      try { attachedWs.removeEventListener('message', handleWsMessage); } catch {}
    }
    attachedWs = ws;
    ws.addEventListener('message', handleWsMessage);
    ws.addEventListener('open', () => {
      const input = document.getElementById('msgInput');
      if (document.activeElement === input && String(input?.value || '').length > 0) pulseLocalTyping(input);
    }, { once: true });
  }

  if (baseRenderPresenceStatus && !baseRenderPresenceStatus.__fpTypingWrapped) {
    const wrapped = function fpTypingRenderPresenceStatus(...args) {
      const result = baseRenderPresenceStatus.apply(this, args);
      renderRemoteTyping();
      return result;
    };
    wrapped.__fpTypingWrapped = true;
    try { renderPresenceStatus = wrapped; } catch {}
  }

  document.addEventListener('input', (event) => {
    if (event.target?.id !== 'msgInput') return;
    pulseLocalTyping(event.target);
  }, true);

  document.addEventListener('submit', (event) => {
    if (event.target?.id !== 'sendForm') return;
    stopLocalTyping();
  }, true);

  document.addEventListener('focusout', (event) => {
    if (event.target?.id !== 'msgInput') return;
    scheduleStop();
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') stopLocalTyping();
    else {
      attachCurrentWs();
      const entry = remoteTyping.get(currentRoomId());
      if (entry?.expiresAt > Date.now()) renderRemoteTyping();
    }
  });

  window.addEventListener('pagehide', () => stopLocalTyping());
  window.addEventListener('offline', () => {
    typingStarted = false;
    lastStartSentAt = 0;
    clearStopTimer();
  });

  let lastRoomId = currentRoomId();
  setInterval(() => {
    attachCurrentWs();
    const roomId = currentRoomId();
    if (lastRoomId !== roomId) {
      if (activeTypingRoomId && activeTypingRoomId !== roomId) stopLocalTyping(activeTypingRoomId);
      lastRoomId = roomId;
      if (!renderRemoteTyping() && !isRoomClosed() && baseRenderPresenceStatus) {
        try { baseRenderPresenceStatus(); } catch {}
      }
    }
  }, 500);

  attachCurrentWs();
})();
