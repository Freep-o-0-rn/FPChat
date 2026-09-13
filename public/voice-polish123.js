/* Build 124: isolated voice UX polish over the stable Build 122 voice core. */
(() => {
  if (window.__fpVoicePolish124Installed) return;
  window.__fpVoicePolish124Installed = true;

  const CANCEL_THRESHOLD_PX = 145;
  const LOCK_THRESHOLD_PX = 118;
  const PLAYED_KEY = 'fpchat:voice-played:123';
  const BASELINE_ID_KEY = 'fpchat:voice-unheard-baseline-id:124';
  const LEGACY_BASELINE_TIME_KEY = 'fpchat:voice-unheard-baseline:123';
  const MAX_PLAYED_KEYS = 1600;

  const voiceMeta = new Map();
  const playbackPositions = new Map();
  let gesture = null;
  let seekGesture = null;
  let activeVoiceId = '';
  let lastRoomId = '';
  let redrawQueued = false;

  const legacyBaselineAt = Number(localStorage.getItem(LEGACY_BASELINE_TIME_KEY) || 0);

  let playedKeys = new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAYED_KEY) || '[]');
    if (Array.isArray(parsed)) playedKeys = new Set(parsed.map(String).slice(-MAX_PLAYED_KEYS));
  } catch {}

  let baselineIds = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(BASELINE_ID_KEY) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) baselineIds = parsed;
  } catch {}

  function currentRoomId() {
    try { return String(state?.roomId || ''); } catch { return ''; }
  }

  function roomDeviceId(roomId = currentRoomId()) {
    if (!roomId) return '';
    try { return String(STORAGE.get(STORAGE.roomState(roomId))?.deviceId || '').trim(); } catch { return ''; }
  }

  function isVoiceMessage(message) {
    const media = Array.isArray(message?.media) ? message.media : [];
    return message?.type === 'media' && media.length === 1 && String(media[0]?.media_kind || '') === 'audio';
  }

  function messageIdOf(message) {
    return String(message?.id ?? message?.message_id ?? '');
  }

  function storageVoiceKey(roomId, messageId) {
    return `${roomId}:${messageId}`;
  }

  function positionKey(roomId, messageId) {
    return `${roomId}:${messageId}`;
  }

  function persistPlayed() {
    try {
      const values = [...playedKeys];
      if (values.length > MAX_PLAYED_KEYS) playedKeys = new Set(values.slice(-MAX_PLAYED_KEYS));
      localStorage.setItem(PLAYED_KEY, JSON.stringify([...playedKeys]));
    } catch {}
  }

  function persistBaselines() {
    try { localStorage.setItem(BASELINE_ID_KEY, JSON.stringify(baselineIds)); } catch {}
  }

  function hasBaseline(roomId) {
    return Object.prototype.hasOwnProperty.call(baselineIds, roomId);
  }

  function setBaseline(roomId, messageId) {
    if (!roomId || hasBaseline(roomId)) return;
    baselineIds[roomId] = Math.max(0, Number(messageId) || 0);
    persistBaselines();
  }

  function rememberVoiceMeta(message, mine, roomId = currentRoomId()) {
    const messageId = messageIdOf(message);
    if (!messageId || !roomId || !isVoiceMessage(message)) return null;
    const createdAt = Date.parse(String(message?.created_at || ''));
    const existing = voiceMeta.get(messageId) || {};
    const meta = {
      ...existing,
      messageId,
      roomId,
      mine: Boolean(mine),
      createdAt: Number.isFinite(createdAt) ? createdAt : (existing.createdAt || 0)
    };
    voiceMeta.set(messageId, meta);
    return meta;
  }

  function messageElement(messageId) {
    const id = String(messageId || '');
    if (!id) return null;
    return [...document.querySelectorAll('#messages .bubble-wrap.msg')]
      .find((el) => String(el.dataset.messageId || el.dataset.id || '') === id) || null;
  }

  function playerRoot(messageId) {
    return messageElement(messageId)?.querySelector('.fp-voice-player') || null;
  }

  function ensureMetaFromDom(messageId) {
    const id = String(messageId || '');
    if (!id) return null;
    const existing = voiceMeta.get(id);
    if (existing) return existing;
    const messageEl = messageElement(id);
    if (!messageEl) return null;
    const meta = {
      messageId: id,
      roomId: currentRoomId(),
      mine: messageEl.classList.contains('mine'),
      createdAt: Date.parse(String(messageEl.dataset.createdAt || '')) || 0
    };
    voiceMeta.set(id, meta);
    return meta;
  }

  function isUnheard(meta) {
    if (!meta || meta.mine || !meta.messageId || !meta.roomId) return false;
    if (!hasBaseline(meta.roomId)) return false;
    const id = Number(meta.messageId);
    const baseline = Number(baselineIds[meta.roomId] || 0);
    if (!Number.isFinite(id) || id <= baseline) return false;
    return !playedKeys.has(storageVoiceKey(meta.roomId, meta.messageId));
  }

  function ensureUnheardDot(messageId) {
    const id = String(messageId || '');
    const meta = voiceMeta.get(id) || ensureMetaFromDom(id);
    const root = playerRoot(id);
    if (!meta || !root) return;
    const footer = root.querySelector('.fp-voice-footer');
    if (!footer) return;
    let dot = footer.querySelector('.fp-voice-unheard-dot');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'fp-voice-unheard-dot';
      dot.setAttribute('aria-label', 'Не прослушано');
    }
    const time = footer.querySelector('.fp-voice-time');
    if (time && dot.nextElementSibling !== time) time.before(dot);
    else if (!dot.isConnected) footer.prepend(dot);
    const unheard = isUnheard(meta);
    dot.classList.toggle('hidden', !unheard);
    root.classList.toggle('fp-voice-unheard', unheard);
  }

  function markPlayed(messageId) {
    const id = String(messageId || '');
    const meta = voiceMeta.get(id) || ensureMetaFromDom(id);
    if (!meta || meta.mine) return;
    const key = storageVoiceKey(meta.roomId, id);
    if (!playedKeys.has(key)) {
      playedKeys.add(key);
      persistPlayed();
    }
    ensureUnheardDot(id);
  }

  function scheduleRedraw() {
    if (redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(() => {
      redrawQueued = false;
      try { window.dispatchEvent(new Event('resize')); } catch {}
    });
  }

  function savePosition(messageId, seconds, duration, ratioOverride = null) {
    const id = String(messageId || '');
    if (!id) return;
    const roomId = voiceMeta.get(id)?.roomId || currentRoomId();
    if (!roomId) return;
    const safeDuration = Math.max(0, Number(duration) || 0);
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    let ratio = Number(ratioOverride);
    if (!Number.isFinite(ratio)) ratio = safeDuration > 0 ? safeSeconds / safeDuration : 0;
    ratio = Math.max(0, Math.min(1, ratio || 0));
    const key = positionKey(roomId, id);
    if (ratio <= 0.001 || (safeDuration > 0 && safeSeconds >= safeDuration - 0.35)) {
      playbackPositions.delete(key);
      return;
    }
    playbackPositions.set(key, { seconds: safeSeconds, duration: safeDuration, ratio, updatedAt: Date.now() });
  }

  function savedPosition(messageId) {
    const id = String(messageId || '');
    const roomId = voiceMeta.get(id)?.roomId || currentRoomId();
    if (!id || !roomId) return null;
    return playbackPositions.get(positionKey(roomId, id)) || null;
  }

  function restorePosition(root) {
    if (!root) return;
    const id = String(root.dataset.messageId || '');
    const saved = savedPosition(id);
    if (!saved || saved.ratio <= 0) return;
    root.dataset.pendingSeek = String(saved.ratio);
    scheduleRedraw();
  }

  function parseClock(value) {
    const match = String(value || '').trim().match(/^(\d+):(\d{2})$/);
    if (!match) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function captureTimePosition(timeEl) {
    if (!timeEl?.classList?.contains('fp-voice-time')) return;
    const root = timeEl.closest('.fp-voice-player');
    if (!root) return;
    const id = String(root.dataset.messageId || '');
    const parts = String(timeEl.textContent || '').split('/').map((part) => part.trim());
    if (parts.length !== 2) return;
    const current = parseClock(parts[0]);
    const duration = parseClock(parts[1]);
    if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0) return;
    const previous = savedPosition(id);
    if (current <= 0) {
      if (previous && previous.seconds >= duration - 1.1) savePosition(id, 0, duration, 0);
      return;
    }
    savePosition(id, current, duration);
  }

  function ensureLockTrack(form = document.getElementById('sendForm')) {
    const bar = form?.querySelector('.fp-voice-recording-bar');
    if (!bar || bar.querySelector('.fp-voice-lock-track123')) return;
    const track = document.createElement('span');
    track.className = 'fp-voice-lock-track123';
    track.setAttribute('aria-hidden', 'true');
    track.innerHTML = '<span class="fp-voice-lock-arrow123">↑</span><span class="fp-voice-lock-rail123"><span class="fp-voice-lock-fill123"></span></span>';
    bar.appendChild(track);
  }

  function resetGesturePolish(form) {
    const bar = form?.querySelector('.fp-voice-recording-bar');
    if (!bar) return;
    bar.style.removeProperty('--fp123-cancel-shift');
    bar.style.removeProperty('--fp123-lock-progress');
  }

  function beginGesture(event) {
    const mic = event.target?.closest?.('.fp-voice-record-btn');
    if (!mic) return;
    const form = mic.closest('#sendForm');
    if (!form) return;
    ensureLockTrack(form);
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      form
    };
    resetGesturePolish(form);
  }

  function updateGestureVisual(event) {
    if (!gesture || (event.pointerId != null && gesture.pointerId != null && event.pointerId !== gesture.pointerId)) return null;
    const bar = gesture.form?.querySelector('.fp-voice-recording-bar');
    if (!bar || gesture.form.classList.contains('fp-voice-locked')) return null;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const cancel = Math.max(0, Math.min(1, -dx / CANCEL_THRESHOLD_PX));
    const lock = Math.max(0, Math.min(1, -dy / LOCK_THRESHOLD_PX));
    const cancelDominant = cancel >= lock;
    const shift = cancelDominant ? -Math.round(cancel * 52) : 0;
    bar.style.setProperty('--fp123-cancel-shift', `${shift}px`);
    bar.style.setProperty('--fp123-lock-progress', String(lock));
    return { dx, dy, cancel, lock };
  }

  function gateCoreGesture(event) {
    const movement = updateGestureVisual(event);
    if (!movement || !gesture || gesture.form.classList.contains('fp-voice-locked')) return;
    const left = Math.max(0, -movement.dx);
    const up = Math.max(0, -movement.dy);
    const cancelReady = left >= CANCEL_THRESHOLD_PX && left > up * 0.85;
    const lockReady = up >= LOCK_THRESHOLD_PX && up > left * 0.72;
    if (cancelReady || lockReady) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }

  function endGesture(event) {
    if (!gesture || (event?.pointerId != null && gesture.pointerId != null && event.pointerId !== gesture.pointerId)) return;
    const form = gesture.form;
    gesture = null;
    setTimeout(() => resetGesturePolish(form), 90);
  }

  function seekFromPointer(event, root) {
    const canvas = root?.querySelector('.fp-voice-waveform');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const duration = Math.max(0, Number(root.dataset.duration || 0) || 0);
    savePosition(root.dataset.messageId, ratio * duration, duration, ratio);
  }

  function patchWaveformGeometry() {
    const proto = window.CanvasRenderingContext2D?.prototype;
    if (!proto || proto.__fpVoice124Geometry) return;
    const originalRoundRect = proto.roundRect;
    const originalRect = proto.rect;
    const shouldPolish = (ctx) => {
      const canvas = ctx?.canvas;
      return Boolean(canvas?.classList?.contains('fp-voice-waveform') || canvas?.classList?.contains('fp-voice-preview-waveform'));
    };
    const adjusted = (ctx, x, y, width, height) => {
      if (!shouldPolish(ctx)) return [x, y, width, height];
      const nextWidth = width * 1.22;
      const nextHeight = Math.min(ctx.canvas.height, height * 1.1);
      const nextX = x - (nextWidth - width) / 2;
      const centerY = y + height / 2;
      const nextY = Math.max(0, Math.min(ctx.canvas.height - nextHeight, centerY - nextHeight / 2));
      return [nextX, nextY, nextWidth, nextHeight];
    };
    if (typeof originalRoundRect === 'function') {
      proto.roundRect = function fpVoice124RoundRect(x, y, width, height, radii) {
        const next = adjusted(this, x, y, width, height);
        return originalRoundRect.call(this, next[0], next[1], next[2], next[3], radii);
      };
    }
    if (typeof originalRect === 'function') {
      proto.rect = function fpVoice124Rect(x, y, width, height) {
        const next = adjusted(this, x, y, width, height);
        return originalRect.call(this, next[0], next[1], next[2], next[3]);
      };
    }
    proto.__fpVoice124Geometry = true;
  }

  const baseAppendMessage = typeof appendMessage === 'function' ? appendMessage : null;
  if (baseAppendMessage && !baseAppendMessage.__fpVoicePolish124) {
    const wrapped = function fpVoice124AppendMessage(box, message, text, mine, autoScroll = true) {
      const roomId = currentRoomId();
      const voice = isVoiceMessage(message);
      if (voice) rememberVoiceMeta(message, mine, roomId);
      const result = baseAppendMessage.apply(this, arguments);
      if (voice) {
        const id = messageIdOf(message);
        queueMicrotask(() => {
          ensureUnheardDot(id);
          restorePosition(playerRoot(id));
        });
      }
      return result;
    };
    wrapped.__fpVoicePolish124 = true;
    try { appendMessage = wrapped; } catch {}
  }

  async function refreshCurrentVoiceMeta(roomId = currentRoomId()) {
    const deviceId = roomDeviceId(roomId);
    if (!roomId || !deviceId) return;
    try {
      const query = new URLSearchParams({ deviceId, limit: '100' });
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages?${query.toString()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      const messages = Array.isArray(data?.messages) ? data.messages : [];

      if (!hasBaseline(roomId)) {
        let baseline = 0;
        if (Number.isFinite(legacyBaselineAt) && legacyBaselineAt > 0) {
          for (const message of messages) {
            const id = Number(message?.id || 0);
            const createdAt = Date.parse(String(message?.created_at || ''));
            if (Number.isFinite(id) && id > baseline && Number.isFinite(createdAt) && createdAt <= legacyBaselineAt) baseline = id;
          }
        } else {
          for (const message of messages) {
            const id = Number(message?.id || 0);
            if (Number.isFinite(id) && id > baseline) baseline = id;
          }
        }
        setBaseline(roomId, baseline);
      }

      for (const message of messages) {
        if (!isVoiceMessage(message)) continue;
        const mine = String(message.sender_device_id || '') === deviceId;
        const meta = rememberVoiceMeta(message, mine, roomId);
        if (meta) {
          ensureUnheardDot(meta.messageId);
          restorePosition(playerRoot(meta.messageId));
        }
      }
    } catch {}
  }

  function scanPlayers() {
    document.querySelectorAll('#messages .fp-voice-player').forEach((root) => {
      const id = String(root.dataset.messageId || '');
      if (!id) return;
      ensureMetaFromDom(id);
      ensureUnheardDot(id);
      restorePosition(root);
    });
  }

  document.addEventListener('pointerdown', (event) => {
    beginGesture(event);
    const canvas = event.target?.closest?.('.fp-voice-waveform');
    const root = canvas?.closest?.('.fp-voice-player');
    if (root) {
      const id = String(root.dataset.messageId || '');
      activeVoiceId = id || activeVoiceId;
      seekGesture = { pointerId: event.pointerId, root };
      seekFromPointer(event, root);
    }
  }, true);

  window.addEventListener('pointermove', gateCoreGesture, { capture: true, passive: false });

  document.addEventListener('pointermove', (event) => {
    if (!seekGesture || (event.pointerId != null && seekGesture.pointerId != null && event.pointerId !== seekGesture.pointerId)) return;
    seekFromPointer(event, seekGesture.root);
  }, true);

  document.addEventListener('pointerup', (event) => {
    endGesture(event);
    if (seekGesture && (event.pointerId == null || seekGesture.pointerId == null || event.pointerId === seekGesture.pointerId)) {
      seekFromPointer(event, seekGesture.root);
      seekGesture = null;
    }
  }, true);

  document.addEventListener('pointercancel', (event) => {
    endGesture(event);
    if (seekGesture && (event.pointerId == null || seekGesture.pointerId == null || event.pointerId === seekGesture.pointerId)) seekGesture = null;
  }, true);

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('.fp-voice-play');
    if (!button) return;
    const root = button.closest('.fp-voice-player');
    if (!root) return;
    const id = String(root.dataset.messageId || '');
    if (!id) return;
    activeVoiceId = id;
    const saved = savedPosition(id);
    if (saved?.ratio > 0) root.dataset.pendingSeek = String(saved.ratio);
  }, true);

  const observer = new MutationObserver((records) => {
    const addedPlayers = new Set();
    const removedPlayers = new Set();
    const changedTime = new Set();
    const changedButtons = new Set();

    for (const record of records) {
      if (record.type === 'characterData') {
        const parent = record.target?.parentElement;
        if (parent?.classList?.contains('fp-voice-time')) changedTime.add(parent);
        continue;
      }
      if (record.type === 'attributes') {
        const target = record.target;
        if (target?.classList?.contains('fp-voice-play')) changedButtons.add(target);
        continue;
      }
      for (const node of record.addedNodes || []) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('.fp-voice-player')) addedPlayers.add(node);
        node.querySelectorAll?.('.fp-voice-player').forEach((root) => addedPlayers.add(root));
        if (node.matches?.('#sendForm') || node.querySelector?.('#sendForm')) ensureLockTrack(node.matches?.('#sendForm') ? node : node.querySelector('#sendForm'));
      }
      for (const node of record.removedNodes || []) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('.fp-voice-player')) removedPlayers.add(node);
        node.querySelectorAll?.('.fp-voice-player').forEach((root) => removedPlayers.add(root));
      }
    }

    for (const timeEl of changedTime) captureTimePosition(timeEl);
    for (const button of changedButtons) {
      if (button.getAttribute('aria-label') !== 'Пауза') continue;
      const id = String(button.closest('.fp-voice-player')?.dataset.messageId || '');
      if (id) markPlayed(id);
    }
    for (const root of removedPlayers) {
      const id = String(root.dataset.messageId || '');
      const timeEl = root.querySelector('.fp-voice-time');
      if (timeEl) captureTimePosition(timeEl);
      if (id && id === activeVoiceId && savedPosition(id)) {
        try { window.FPVoice?.stopPlayback?.(); } catch {}
        activeVoiceId = '';
      }
    }
    for (const root of addedPlayers) {
      const id = String(root.dataset.messageId || '');
      if (!id) continue;
      ensureMetaFromDom(id);
      restorePosition(root);
      ensureUnheardDot(id);
    }
    ensureLockTrack();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label']
  });

  patchWaveformGeometry();
  ensureLockTrack();
  lastRoomId = currentRoomId();
  if (lastRoomId) void refreshCurrentVoiceMeta(lastRoomId).then(scanPlayers);
  scheduleRedraw();

  setInterval(() => {
    ensureLockTrack();
    const roomId = currentRoomId();
    if (roomId !== lastRoomId) {
      lastRoomId = roomId;
      activeVoiceId = '';
      seekGesture = null;
      if (roomId) void refreshCurrentVoiceMeta(roomId).then(scanPlayers);
      return;
    }
    scanPlayers();
  }, 700);
})();
