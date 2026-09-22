/* Build 170: transient Telegram-like typing/media activity using connection and room events. */
(() => {
  const STOP_DELAY_MS = 3000;
  const START_HEARTBEAT_MS = 1500;
  const MEDIA_HEARTBEAT_MS = 1800;
  const MEDIA_STOP_GRACE_MS = 280;
  const REMOTE_SAFETY_MS = 7500;

  let attachedWs = null;
  let activeTypingRoomId = '';
  let typingStarted = false;
  let lastStartSentAt = 0;
  let stopTimer = null;
  const remoteActivity = new Map();
  const localMediaUploads = new Map();

  const baseRenderPresenceStatus = typeof renderPresenceStatus === 'function' ? renderPresenceStatus : null;
  const baseFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  const xhrProto = typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest.prototype : null;
  const baseXhrOpen = xhrProto?.open;
  const baseXhrSend = xhrProto?.send;

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

  function sendSignal(type, roomId, activity = '') {
    if (!roomId || !socketReady()) return false;
    try {
      const payload = { type, roomId };
      if (activity) payload.activity = activity;
      state.ws.send(JSON.stringify(payload));
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
    if (typingStarted && roomId) sendSignal('typing:stop', roomId, 'typing');
    typingStarted = false;
    lastStartSentAt = 0;
    if (!roomId || roomId === activeTypingRoomId) activeTypingRoomId = '';
  }

  function scheduleStop() {
    clearStopTimer();
    stopTimer = setTimeout(() => stopLocalTyping(), STOP_DELAY_MS);
  }

  function hasLocalMediaUpload(roomId = currentRoomId()) {
    const entry = localMediaUploads.get(roomId);
    return Boolean(entry && (entry.photo > 0 || entry.video > 0));
  }

  function pulseLocalTyping(input) {
    const roomId = currentRoomId();
    if (!roomId || document.visibilityState !== 'visible' || input?.disabled || hasLocalMediaUpload(roomId)) {
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
      if (sendSignal('typing:start', roomId, 'typing')) {
        typingStarted = true;
        lastStartSentAt = now;
      }
    }
    scheduleStop();
  }

  function mediaActivity(entry) {
    if (!entry) return '';
    if (entry.photo > 0 && entry.video > 0) return 'media';
    if (entry.video > 0) return 'video';
    if (entry.photo > 0) return 'photo';
    return '';
  }

  function clearMediaTimers(entry) {
    if (!entry) return;
    if (entry.stopTimer) clearTimeout(entry.stopTimer);
    if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer);
    entry.stopTimer = null;
    entry.heartbeatTimer = null;
  }

  function sendMediaPulse(roomId, entry) {
    const activity = mediaActivity(entry);
    if (!activity) return false;
    entry.lastActivity = activity;
    return sendSignal('activity:start', roomId, activity);
  }

  function ensureMediaHeartbeat(roomId, entry) {
    if (entry.heartbeatTimer) return;
    entry.heartbeatTimer = setInterval(() => {
      if (!localMediaUploads.has(roomId) || !mediaActivity(entry)) return;
      sendMediaPulse(roomId, entry);
    }, MEDIA_HEARTBEAT_MS);
  }

  function beginMediaUpload(roomId, kind) {
    if (!roomId || (kind !== 'photo' && kind !== 'video')) return;
    stopLocalTyping();
    let entry = localMediaUploads.get(roomId);
    if (!entry) {
      entry = { photo: 0, video: 0, stopTimer: null, heartbeatTimer: null, lastActivity: '' };
      localMediaUploads.set(roomId, entry);
    }
    if (entry.stopTimer) {
      clearTimeout(entry.stopTimer);
      entry.stopTimer = null;
    }
    entry[kind] += 1;
    sendMediaPulse(roomId, entry);
    ensureMediaHeartbeat(roomId, entry);
  }

  function finishMediaUpload(roomId, kind) {
    const entry = localMediaUploads.get(roomId);
    if (!entry || (kind !== 'photo' && kind !== 'video')) return;
    entry[kind] = Math.max(0, entry[kind] - 1);
    const nextActivity = mediaActivity(entry);
    if (nextActivity) {
      if (nextActivity !== entry.lastActivity) sendMediaPulse(roomId, entry);
      return;
    }
    if (entry.stopTimer) clearTimeout(entry.stopTimer);
    entry.stopTimer = setTimeout(() => {
      const current = localMediaUploads.get(roomId);
      if (current !== entry || mediaActivity(entry)) return;
      clearMediaTimers(entry);
      localMediaUploads.delete(roomId);
      sendSignal('activity:stop', roomId, entry.lastActivity || kind);
      if (roomId === currentRoomId() && document.visibilityState === 'visible') {
        const input = document.getElementById('msgInput');
        if (document.activeElement === input && String(input?.value || '').length > 0) pulseLocalTyping(input);
      }
    }, MEDIA_STOP_GRACE_MS);
  }

  function stopAllLocalMedia() {
    for (const [roomId, entry] of localMediaUploads) {
      clearMediaTimers(entry);
      sendSignal('activity:stop', roomId, entry.lastActivity || mediaActivity(entry));
    }
    localMediaUploads.clear();
  }

  function parseMediaUpload(input, init) {
    try {
      const rawUrl = typeof input === 'string' ? input : input?.url || String(input || '');
      if (!rawUrl) return null;
      const url = new URL(rawUrl, window.location.href);
      const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/media\/upload$/);
      if (!match) return null;
      const body = init?.body;
      if (!(body instanceof FormData)) return null;
      const mediaKind = String(body.get('mediaKind') || '').toLowerCase();
      const kind = mediaKind === 'video' ? 'video' : mediaKind === 'image' ? 'photo' : '';
      if (!kind) return null;
      return { roomId: decodeURIComponent(match[1]), kind };
    } catch {
      return null;
    }
  }

  if (baseFetch && !window.fetch.__fpActivityWrapped) {
    const wrappedFetch = async function fpActivityFetch(input, init) {
      const media = parseMediaUpload(input, init);
      if (!media) return baseFetch(input, init);
      beginMediaUpload(media.roomId, media.kind);
      try {
        return await baseFetch(input, init);
      } finally {
        finishMediaUpload(media.roomId, media.kind);
      }
    };
    wrappedFetch.__fpActivityWrapped = true;
    window.fetch = wrappedFetch;
  }

  if (xhrProto && baseXhrOpen && baseXhrSend && !xhrProto.__fpActivityWrapped) {
    const wrappedOpen = function fpActivityXhrOpen(method, url, ...rest) {
      this.__fpActivityRequestUrl = url;
      return baseXhrOpen.call(this, method, url, ...rest);
    };

    const wrappedSend = function fpActivityXhrSend(body) {
      const media = parseMediaUpload(this.__fpActivityRequestUrl, { body });
      if (!media) return baseXhrSend.call(this, body);

      beginMediaUpload(media.roomId, media.kind);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        finishMediaUpload(media.roomId, media.kind);
      };

      this.addEventListener('loadend', finish, { once: true });
      this.addEventListener('abort', finish, { once: true });
      this.addEventListener('error', finish, { once: true });
      this.addEventListener('timeout', finish, { once: true });

      try {
        return baseXhrSend.call(this, body);
      } catch (error) {
        finish();
        throw error;
      }
    };

    wrappedOpen.__fpActivityWrapped = true;
    wrappedSend.__fpActivityWrapped = true;
    xhrProto.open = wrappedOpen;
    xhrProto.send = wrappedSend;
    xhrProto.__fpActivityWrapped = true;
  }

  function isRoomClosed() {
    return document.querySelector('.chat-view')?.classList.contains('room-closed') === true;
  }

  function activityLabel(activity) {
    if (activity === 'photo') return 'загружает фото…';
    if (activity === 'video') return 'загружает видео…';
    if (activity === 'media') return 'загружает фото и видео…';
    if (activity === 'recording_audio') return 'записывает аудио…';
    if (activity === 'audio') return 'загружает аудио…';
    return 'печатает…';
  }

  function renderRemoteActivity() {
    const roomId = currentRoomId();
    const entry = remoteActivity.get(roomId);
    if (!roomId || !entry || entry.expiresAt <= Date.now() || isRoomClosed()) return false;
    const line = document.getElementById('presenceLine');
    if (!line) return false;
    const label = activityLabel(entry.activity);
    const renderedLabel = line.querySelector('.fp-typing-label');
    if (
      line.dataset.fpTypingDevice === entry.deviceId &&
      line.dataset.fpActivity === entry.activity &&
      line.classList.contains('fp-typing-active') &&
      renderedLabel?.textContent === label
    ) return true;
    line.dataset.fpTypingDevice = entry.deviceId;
    line.dataset.fpActivity = entry.activity;
    line.classList.add('fp-typing-active');
    line.innerHTML = `<span class='presence-dot online'></span><span class='fp-typing-label'>${label}</span>`;
    return true;
  }

  function restorePresence() {
    const line = document.getElementById('presenceLine');
    if (line) {
      line.classList.remove('fp-typing-active');
      delete line.dataset.fpTypingDevice;
      delete line.dataset.fpActivity;
    }
    if (!isRoomClosed() && baseRenderPresenceStatus) {
      try { baseRenderPresenceStatus(); } catch {}
    }
  }

  function clearRemoteActivity(roomId, deviceId = '') {
    const entry = remoteActivity.get(roomId);
    if (!entry || (deviceId && entry.deviceId !== deviceId)) return;
    if (entry.timer) clearTimeout(entry.timer);
    remoteActivity.delete(roomId);
    if (roomId === currentRoomId()) restorePresence();
  }

  function setRemoteActivity(roomId, deviceId, displayName, activity = 'typing') {
    if (!roomId || !deviceId || deviceId === currentDeviceId(roomId)) return;
    clearRemoteActivity(roomId);
    const safeActivity = ['typing', 'photo', 'video', 'media', 'recording_audio', 'audio'].includes(activity) ? activity : 'typing';
    const entry = {
      deviceId,
      displayName: String(displayName || ''),
      activity: safeActivity,
      expiresAt: Date.now() + REMOTE_SAFETY_MS,
      timer: null
    };
    entry.timer = setTimeout(() => clearRemoteActivity(roomId, deviceId), REMOTE_SAFETY_MS);
    remoteActivity.set(roomId, entry);
    if (roomId === currentRoomId()) renderRemoteActivity();
  }

  function handleWsMessage(event) {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (!payload || payload.type !== 'typing:update') return;
    const roomId = String(payload.roomId || '');
    const deviceId = String(payload.deviceId || '');
    if (!roomId || !deviceId) return;
    const activity = String(payload.activity || (payload.typing === true ? 'typing' : ''));
    if (payload.typing === true || activity) setRemoteActivity(roomId, deviceId, payload.displayName, activity || 'typing');
    else clearRemoteActivity(roomId, deviceId);
  }

  function attachCurrentWs() {
    const ws = state?.ws;
    if (ws === attachedWs) return;
    if (attachedWs) {
      try { attachedWs.removeEventListener('message', handleWsMessage); } catch {}
    }
    attachedWs = ws || null;
    if (!ws) return;
    ws.addEventListener('message', handleWsMessage);
    ws.addEventListener('open', () => {
      for (const [roomId, entry] of localMediaUploads) sendMediaPulse(roomId, entry);
      const input = document.getElementById('msgInput');
      if (!hasLocalMediaUpload() && document.activeElement === input && String(input?.value || '').length > 0) pulseLocalTyping(input);
    }, { once: true });
  }

  function syncRoomTransition() {
    const roomId = currentRoomId();
    if (activeTypingRoomId && activeTypingRoomId !== roomId) stopLocalTyping(activeTypingRoomId);
    if (!renderRemoteActivity() && !isRoomClosed() && baseRenderPresenceStatus) {
      try { baseRenderPresenceStatus(); } catch {}
    }
  }

  if (baseRenderPresenceStatus && !baseRenderPresenceStatus.__fpTypingWrapped) {
    const wrapped = function fpTypingRenderPresenceStatus(...args) {
      const result = baseRenderPresenceStatus.apply(this, args);
      renderRemoteActivity();
      return result;
    };
    wrapped.__fpTypingWrapped = true;
    try { renderPresenceStatus = wrapped; } catch {}
  }

  document.addEventListener('input', (event) => {
    if (event.target?.id !== 'msgInput' || !event.isTrusted) return;
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

  window.FPLifecycle170?.subscribe(event => {
    if (['background','pagehide','beforeunload'].includes(event.lastType)) {
      stopLocalTyping();stopAllLocalMedia();
    } else if (event.lastType === 'foreground') {
      attachCurrentWs();
      const entry = remoteActivity.get(currentRoomId());
      if (entry?.expiresAt > Date.now()) renderRemoteActivity();
    } else if (event.lastType === 'offline') {
      typingStarted=false;lastStartSentAt=0;clearStopTimer();
      for(const entry of localMediaUploads.values()){
        if(entry.heartbeatTimer)clearInterval(entry.heartbeatTimer);
        entry.heartbeatTimer=null;
      }
    } else if (event.lastType === 'online') {
      attachCurrentWs();
      for(const [roomId,entry]of localMediaUploads){sendMediaPulse(roomId,entry);ensureMediaHeartbeat(roomId,entry);}
    }
  });

  window.addEventListener('fpchat:connection170', attachCurrentWs, { passive: true });
  window.addEventListener('fpchat:room-context-changed', syncRoomTransition, { passive: true });
  window.addEventListener('fpchat:room-context-ended', syncRoomTransition, { passive: true });
  window.addEventListener('fpchat:room-open170', (event) => {
    if (event?.detail?.stage === 'ready' || event?.detail?.stage === 'left') syncRoomTransition();
  }, { passive: true });

  attachCurrentWs();
})();
