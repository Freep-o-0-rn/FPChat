/* Build 120: isolated encrypted voice-message foundation. */
(() => {
  const MIN_RECORDING_MS = 700;
  const MAX_RECORDING_MS = 10 * 60 * 1000;
  const ACTIVITY_HEARTBEAT_MS = 1500;
  const REMOTE_ACTIVITY_TTL_MS = 7500;
  const voiceMessages = new Map();
  const voiceBlobCache = new Map();
  const boundComposers = new WeakSet();
  const remoteVoiceActivity = new Map();

  let pendingPress = null;
  let recordingState = null;
  let uploadInFlight = false;
  let localActivity = null;
  let localActivityTimer = null;
  let attachedWs = null;
  let activePlayback = null;
  let lastRoomId = '';

  const baseAppendMessage = typeof appendMessage === 'function' ? appendMessage : null;
  const baseBuildMediaFallbackText = typeof buildMediaFallbackText === 'function' ? buildMediaFallbackText : null;
  const baseRenderPresenceStatus = typeof renderPresenceStatus === 'function' ? renderPresenceStatus : null;

  function currentRoomId() {
    try { return String(state?.roomId || ''); } catch { return ''; }
  }

  function roomDeviceId(roomId = currentRoomId()) {
    try { return String(STORAGE.get(STORAGE.roomState(roomId))?.deviceId || '').trim(); } catch { return ''; }
  }

  function socketReady() {
    try { return state?.ws?.readyState === WebSocket.OPEN; } catch { return false; }
  }

  function sendActivitySignal(type, roomId, activity) {
    if (!roomId || !activity || !socketReady()) return false;
    try {
      state.ws.send(JSON.stringify({ type, roomId, activity }));
      return true;
    } catch {
      return false;
    }
  }

  function stopLocalActivity(expected = '') {
    const current = localActivity;
    if (!current) return;
    if (expected && current.activity !== expected) return;
    if (localActivityTimer) clearInterval(localActivityTimer);
    localActivityTimer = null;
    localActivity = null;
    sendActivitySignal('activity:stop', current.roomId, current.activity);
  }

  function startLocalActivity(roomId, activity) {
    if (!roomId || !activity) return;
    const previous = localActivity;
    if (previous && (previous.roomId !== roomId || previous.activity !== activity)) {
      if (localActivityTimer) clearInterval(localActivityTimer);
      localActivityTimer = null;
    }
    localActivity = { roomId, activity };
    sendActivitySignal('activity:start', roomId, activity);
    if (!localActivityTimer) {
      localActivityTimer = setInterval(() => {
        if (!localActivity) return;
        sendActivitySignal('activity:start', localActivity.roomId, localActivity.activity);
      }, ACTIVITY_HEARTBEAT_MS);
    }
  }

  function isVoiceMediaList(media) {
    return Array.isArray(media) && media.length === 1 && String(media[0]?.media_kind || '') === 'audio';
  }

  function isVoiceMessage(message) {
    return message?.type === 'media' && isVoiceMediaList(message.media);
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }

  function registerVoiceMessage(message) {
    if (!isVoiceMessage(message) || message?.id == null) return null;
    const media = message.media[0];
    const entry = { message, media };
    voiceMessages.set(String(message.id), entry);
    return entry;
  }

  function findMessageElement(messageId) {
    const id = String(messageId ?? '');
    if (!id) return null;
    return [...document.querySelectorAll('#messages .bubble-wrap.msg')].find((el) => String(el.dataset.messageId || el.dataset.id || '') === id) || null;
  }

  function setCachedPreview(messageId, entry) {
    const numericId = Number(messageId);
    if (!Number.isSafeInteger(numericId) || typeof messageCache === 'undefined') return;
    const duration = Number(entry?.media?.duration_seconds || 0);
    const existing = messageCache.get(numericId) || {};
    messageCache.set(numericId, {
      ...existing,
      id: numericId,
      author: entry?.message?.sender_name || existing.author || '',
      text: '',
      preview: `Голосовое сообщение${duration > 0 ? ` · ${formatDuration(duration)}` : ''}`,
      kind: 'voice'
    });
  }

  function renderVoiceProgress(root, currentTime = 0, durationOverride = null) {
    if (!root) return;
    const duration = Number(durationOverride ?? root.dataset.duration ?? 0) || 0;
    const current = Math.max(0, Math.min(duration || Infinity, Number(currentTime) || 0));
    const range = root.querySelector('.fp-voice-progress');
    const time = root.querySelector('.fp-voice-time');
    if (range) {
      range.max = String(Math.max(duration, 0.01));
      range.value = String(Math.min(current, duration || current));
      const pct = duration > 0 ? Math.max(0, Math.min(100, (current / duration) * 100)) : 0;
      range.style.setProperty('--fp-voice-progress', `${pct}%`);
    }
    if (time) time.textContent = duration > 0 ? `${formatDuration(current)} / ${formatDuration(duration)}` : formatDuration(current);
  }

  function decorateVoiceMessage(messageId) {
    const entry = voiceMessages.get(String(messageId));
    const messageEl = findMessageElement(messageId);
    if (!entry || !messageEl) return false;
    if (messageEl.dataset.fpVoiceDecorated === '1') {
      setCachedPreview(messageId, entry);
      return true;
    }

    const bubble = messageEl.querySelector('.bubble');
    const meta = bubble?.querySelector('.meta');
    if (!bubble || !meta) return false;

    bubble.querySelector('.media-grid')?.remove();
    const emptyText = bubble.querySelector('.message-text');
    if (emptyText && !String(emptyText.textContent || '').trim()) emptyText.remove();

    const duration = Math.max(0, Number(entry.media?.duration_seconds || 0) || 0);
    const root = document.createElement('div');
    root.className = 'fp-voice-player';
    root.dataset.messageId = String(messageId);
    root.dataset.duration = String(duration);
    root.innerHTML = `
      <button type="button" class="fp-voice-play" aria-label="Воспроизвести голосовое">▶</button>
      <div class="fp-voice-main">
        <input class="fp-voice-progress" type="range" min="0" max="${Math.max(duration, 0.01)}" step="0.01" value="0" aria-label="Позиция голосового сообщения">
        <div class="fp-voice-time">0:00 / ${formatDuration(duration)}</div>
      </div>`;

    meta.before(root);
    messageEl.dataset.fpVoiceDecorated = '1';
    messageEl.classList.add('fp-voice-message');
    setCachedPreview(messageId, entry);
    renderVoiceProgress(root, 0, duration);

    const play = root.querySelector('.fp-voice-play');
    const range = root.querySelector('.fp-voice-progress');

    play?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void toggleVoicePlayback(String(messageId), root);
    });

    range?.addEventListener('pointerdown', (event) => event.stopPropagation());
    range?.addEventListener('click', (event) => event.stopPropagation());
    range?.addEventListener('input', (event) => {
      event.stopPropagation();
      if (!activePlayback || activePlayback.messageId !== String(messageId)) return;
      const next = Number(event.currentTarget.value || 0);
      if (Number.isFinite(next)) {
        activePlayback.audio.currentTime = next;
        renderVoiceProgress(root, next, activePlayback.audio.duration || duration);
      }
    });
    return true;
  }

  function stopActivePlayback(reset = false) {
    const current = activePlayback;
    if (!current) return;
    try { current.audio.pause(); } catch {}
    const root = current.root?.isConnected ? current.root : findMessageElement(current.messageId)?.querySelector('.fp-voice-player');
    const button = root?.querySelector('.fp-voice-play');
    if (button) button.textContent = '▶';
    if (reset) {
      try { current.audio.currentTime = 0; } catch {}
      renderVoiceProgress(root, 0, current.duration);
    }
    activePlayback = null;
  }

  async function loadVoiceUrl(messageId) {
    const key = String(messageId);
    if (voiceBlobCache.has(key)) return voiceBlobCache.get(key);
    const entry = voiceMessages.get(key);
    if (!entry?.media?.public_id) throw new Error('voice media unavailable');
    const roomId = currentRoomId();
    const deviceId = roomDeviceId(roomId);
    if (!roomId || !deviceId) throw new Error('voice room unavailable');

    const promise = (async () => {
      const response = await fetch(`/api/media/${encodeURIComponent(entry.media.public_id)}/blob?deviceId=${encodeURIComponent(deviceId)}`);
      if (!response.ok) throw new Error('voice load failed');
      const encrypted = await response.blob();
      const plain = await decryptBlobWithIvPrefix(encrypted, entry.media.mime_type || 'audio/webm');
      return {
        url: URL.createObjectURL(plain),
        blob: plain,
        duration: Number(entry.media.duration_seconds || 0) || 0
      };
    })();

    voiceBlobCache.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      voiceBlobCache.delete(key);
      throw error;
    }
  }

  async function toggleVoicePlayback(messageId, root) {
    if (activePlayback?.messageId === messageId) {
      if (activePlayback.audio.paused) {
        try {
          await activePlayback.audio.play();
          root.querySelector('.fp-voice-play').textContent = 'Ⅱ';
        } catch {}
      } else {
        activePlayback.audio.pause();
        root.querySelector('.fp-voice-play').textContent = '▶';
      }
      return;
    }

    stopActivePlayback(false);
    root.classList.add('fp-voice-loading');
    const button = root.querySelector('.fp-voice-play');
    if (button) button.textContent = '…';

    try {
      const loaded = await loadVoiceUrl(messageId);
      const audio = new Audio(loaded.url);
      audio.preload = 'metadata';
      const duration = loaded.duration || Number(root.dataset.duration || 0) || 0;
      const playback = { messageId, root, audio, duration };
      activePlayback = playback;

      audio.addEventListener('loadedmetadata', () => {
        const actual = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
        playback.duration = actual;
        root.dataset.duration = String(actual);
        renderVoiceProgress(root, audio.currentTime, actual);
      });
      audio.addEventListener('timeupdate', () => {
        if (activePlayback !== playback) return;
        renderVoiceProgress(root, audio.currentTime, playback.duration || audio.duration);
      });
      audio.addEventListener('play', () => {
        if (activePlayback === playback && button) button.textContent = 'Ⅱ';
      });
      audio.addEventListener('pause', () => {
        if (activePlayback === playback && button) button.textContent = '▶';
      });
      audio.addEventListener('ended', () => {
        if (activePlayback !== playback) return;
        renderVoiceProgress(root, 0, playback.duration);
        if (button) button.textContent = '▶';
        activePlayback = null;
      });
      audio.addEventListener('error', () => {
        if (activePlayback === playback) activePlayback = null;
        if (button) button.textContent = '▶';
        root.classList.remove('fp-voice-loading');
      });

      root.classList.remove('fp-voice-loading');
      try {
        await audio.play();
      } catch {
        if (button) button.textContent = '▶';
      }
    } catch {
      root.classList.remove('fp-voice-loading');
      if (button) button.textContent = '▶';
      alert('Не удалось загрузить голосовое сообщение.');
    }
  }

  if (baseBuildMediaFallbackText && !baseBuildMediaFallbackText.__fpVoiceWrapped) {
    const wrapped = function fpVoiceMediaFallback(media = [], caption = '') {
      const text = String(caption || '').trim();
      if (!text && isVoiceMediaList(media)) return 'Голосовое сообщение';
      return baseBuildMediaFallbackText.apply(this, arguments);
    };
    wrapped.__fpVoiceWrapped = true;
    try { buildMediaFallbackText = wrapped; } catch {}
  }

  if (baseAppendMessage && !baseAppendMessage.__fpVoiceWrapped) {
    const wrapped = function fpVoiceAppendMessage(box, message, text, mine, autoScroll = true) {
      const result = baseAppendMessage.apply(this, arguments);
      if (isVoiceMessage(message)) {
        registerVoiceMessage(message);
        decorateVoiceMessage(message.id);
      }
      return result;
    };
    wrapped.__fpVoiceWrapped = true;
    try { appendMessage = wrapped; } catch {}
  }

  function chooseRecorderMime() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/mp4',
      'audio/webm',
      'audio/ogg;codecs=opus'
    ];
    if (typeof MediaRecorder === 'undefined') return '';
    if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
    for (const candidate of candidates) {
      try { if (MediaRecorder.isTypeSupported(candidate)) return candidate; } catch {}
    }
    return '';
  }

  function recordingUi(form, active, seconds = 0, processing = false) {
    if (!form) return;
    form.classList.toggle('fp-voice-recording', active);
    const bar = form.querySelector('.fp-voice-recording-bar');
    if (!bar) return;
    bar.classList.toggle('hidden', !active);
    const time = bar.querySelector('.fp-voice-record-time');
    const hint = bar.querySelector('.fp-voice-record-hint');
    if (time) time.textContent = formatDuration(seconds);
    if (hint) hint.textContent = processing ? 'Подготовка…' : 'Отпустите для отправки';
  }

  function syncComposer(form) {
    if (!form?.isConnected) return;
    const input = form.querySelector('#msgInput');
    const send = form.querySelector('#sendBtn');
    const mic = form.querySelector('.fp-voice-record-btn');
    if (!input || !send || !mic) return;
    const empty = !String(input.value || '').trim();
    const closed = form.closest('.chat-view')?.classList.contains('room-closed') === true;
    const currentBusy = Boolean(recordingState || uploadInFlight);
    form.classList.toggle('fp-voice-mic-mode', empty && !closed && !currentBusy);
    mic.disabled = closed || currentBusy || !empty;
  }

  function ensureComposer() {
    const form = document.getElementById('sendForm');
    if (!form || boundComposers.has(form)) return;
    boundComposers.add(form);

    const send = form.querySelector('#sendBtn');
    const input = form.querySelector('#msgInput');
    if (!send || !input) return;

    const mic = document.createElement('button');
    mic.type = 'button';
    mic.className = 'btn-send composer-send fp-voice-record-btn';
    mic.setAttribute('aria-label', 'Записать голосовое сообщение');
    mic.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V6.5a3.5 3.5 0 1 0-7 0V12a3.5 3.5 0 0 0 3.5 3.5Z"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"/></svg>';
    send.after(mic);

    const bar = document.createElement('div');
    bar.className = 'fp-voice-recording-bar hidden';
    bar.innerHTML = '<span class="fp-voice-record-dot"></span><strong class="fp-voice-record-time">0:00</strong><span class="fp-voice-record-hint">Отпустите для отправки</span>';
    form.insertBefore(bar, form.firstChild);

    input.addEventListener('input', () => syncComposer(form), true);
    mic.addEventListener('pointerdown', (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      void beginPressRecording(event, form, mic);
    });
    mic.addEventListener('contextmenu', (event) => event.preventDefault());
    syncComposer(form);
  }

  async function beginPressRecording(event, form, mic) {
    if (pendingPress || recordingState || uploadInFlight) return;
    const roomId = currentRoomId();
    const deviceId = roomDeviceId(roomId);
    if (!roomId || !deviceId) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert('Запись голосовых сообщений не поддерживается этим браузером.');
      return;
    }

    const session = {
      pointerId: event.pointerId,
      roomId,
      deviceId,
      form,
      mic,
      released: false,
      cancelled: false
    };
    pendingPress = session;
    try { mic.setPointerCapture?.(event.pointerId); } catch {}

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch {
      if (pendingPress === session) pendingPress = null;
      alert('Нет доступа к микрофону. Разрешите доступ к микрофону для FPChat.');
      syncComposer(form);
      return;
    }

    if (pendingPress !== session || session.released || session.cancelled || currentRoomId() !== roomId) {
      stream.getTracks().forEach((track) => track.stop());
      if (pendingPress === session) pendingPress = null;
      syncComposer(form);
      return;
    }

    const mimeType = chooseRecorderMime();
    let recorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      pendingPress = null;
      alert('Не удалось запустить запись голосового сообщения.');
      syncComposer(form);
      return;
    }

    const rec = {
      roomId,
      deviceId,
      form,
      mic,
      stream,
      recorder,
      chunks: [],
      mimeType: recorder.mimeType || mimeType || 'audio/webm',
      startedAt: performance.now(),
      shouldSend: true,
      timer: null,
      maxTimer: null,
      finalized: false
    };
    recordingState = rec;
    pendingPress = session;

    recorder.addEventListener('dataavailable', (e) => {
      if (e.data?.size) rec.chunks.push(e.data);
    });
    recorder.addEventListener('stop', () => { void finalizeRecording(rec); }, { once: true });
    recorder.addEventListener('error', () => {
      rec.shouldSend = false;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch {}
    });

    try {
      recorder.start(200);
    } catch {
      recordingState = null;
      pendingPress = null;
      stream.getTracks().forEach((track) => track.stop());
      alert('Не удалось запустить запись голосового сообщения.');
      syncComposer(form);
      return;
    }

    startLocalActivity(roomId, 'recording_audio');
    recordingUi(form, true, 0, false);
    rec.timer = setInterval(() => {
      const elapsed = (performance.now() - rec.startedAt) / 1000;
      recordingUi(form, true, elapsed, false);
    }, 100);
    rec.maxTimer = setTimeout(() => stopRecording(true), MAX_RECORDING_MS);
    syncComposer(form);
  }

  function stopRecording(shouldSend) {
    const rec = recordingState;
    if (!rec || rec.finalized) return;
    rec.shouldSend = shouldSend === true;
    if (rec.timer) clearInterval(rec.timer);
    rec.timer = null;
    if (rec.maxTimer) clearTimeout(rec.maxTimer);
    rec.maxTimer = null;
    recordingUi(rec.form, true, (performance.now() - rec.startedAt) / 1000, true);
    try {
      if (rec.recorder.state !== 'inactive') rec.recorder.stop();
      else void finalizeRecording(rec);
    } catch {
      void finalizeRecording(rec);
    }
  }

  async function encryptVoiceBlob(roomId, blob) {
    const key = await getRoomKey(roomId);
    if (!key) throw new Error('room key unavailable');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = await blob.arrayBuffer();
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    const out = new Uint8Array(iv.byteLength + cipher.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(cipher), iv.byteLength);
    return new Blob([out], { type: 'application/octet-stream' });
  }

  async function encryptVoiceCaption(roomId, text = '') {
    const key = await getRoomKey(roomId);
    if (!key) throw new Error('room key unavailable');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(text || '')));
    return { iv: b64.encode(iv), ciphertext: b64.encode(cipher) };
  }

  async function deletePendingVoice(roomId, deviceId, mediaId) {
    if (!roomId || !deviceId || !mediaId) return;
    await fetch(`/api/rooms/${encodeURIComponent(roomId)}/media/pending`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, mediaIds: [mediaId] })
    }).catch(() => {});
  }

  async function uploadAndSendVoice(rec, blob, durationSeconds) {
    uploadInFlight = true;
    syncComposer(rec.form);
    startLocalActivity(rec.roomId, 'audio');
    let uploadedMedia = null;
    try {
      const encryptedFile = await encryptVoiceBlob(rec.roomId, blob);
      const fd = new FormData();
      fd.append('deviceId', rec.deviceId);
      fd.append('encryptedFile', encryptedFile, 'voice.bin');
      fd.append('mimeType', blob.type || rec.mimeType || 'audio/webm');
      fd.append('sizeBytes', String(blob.size));
      fd.append('encryptedSizeBytes', String(encryptedFile.size));
      fd.append('durationSeconds', String(durationSeconds));

      const uploadResponse = await fetch(`/api/rooms/${encodeURIComponent(rec.roomId)}/voice/upload`, {
        method: 'POST',
        body: fd
      });
      const uploadData = await uploadResponse.json().catch(() => null);
      if (!uploadResponse.ok || !uploadData?.ok || !uploadData.media?.id) {
        throw new Error(uploadData?.error || 'voice upload failed');
      }
      uploadedMedia = uploadData.media;

      const wsOk = await ensureWsConnected(rec.deviceId);
      if (!wsOk || !state.ws || state.ws.readyState !== WebSocket.OPEN || state.ws.deviceId !== rec.deviceId) {
        throw new Error('voice websocket unavailable');
      }

      const enc = await encryptVoiceCaption(rec.roomId, '');
      const draft = typeof ensureDraftState === 'function' ? ensureDraftState(rec.roomId) : state.drafts?.[rec.roomId];
      const replyToMessageId = draft?.replyTo?.messageId || null;
      if (replyToMessageId && typeof markReplyTargetRead === 'function' && currentRoomId() === rec.roomId) {
        markReplyTargetRead(replyToMessageId);
      }

      state.ws.send(JSON.stringify({
        type: 'message:new',
        roomId: rec.roomId,
        messageType: 'media',
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        notificationPreview: 'Голосовое сообщение',
        replyToMessageId,
        mediaIds: [Number(uploadedMedia.id)]
      }));

      if (draft) {
        draft.replyTo = null;
        if (currentRoomId() === rec.roomId && typeof updateReplyComposerBar === 'function') updateReplyComposerBar();
      }
      if (typeof clearDraftOnServer === 'function') {
        try { await clearDraftOnServer(rec.roomId); } catch {}
      }
    } catch (error) {
      if (uploadedMedia?.id) await deletePendingVoice(rec.roomId, rec.deviceId, uploadedMedia.id);
      alert('Не удалось отправить голосовое сообщение. Проверьте соединение и попробуйте ещё раз.');
    } finally {
      uploadInFlight = false;
      stopLocalActivity('audio');
      syncComposer(rec.form);
    }
  }

  async function finalizeRecording(rec) {
    if (!rec || rec.finalized) return;
    rec.finalized = true;
    if (recordingState === rec) recordingState = null;
    if (pendingPress?.roomId === rec.roomId) pendingPress = null;
    if (rec.timer) clearInterval(rec.timer);
    if (rec.maxTimer) clearTimeout(rec.maxTimer);
    rec.timer = null;
    rec.maxTimer = null;
    rec.stream?.getTracks?.().forEach((track) => track.stop());

    const durationMs = Math.max(0, performance.now() - rec.startedAt);
    recordingUi(rec.form, false, 0, false);

    if (!rec.shouldSend || durationMs < MIN_RECORDING_MS || !rec.chunks.length) {
      stopLocalActivity('recording_audio');
      syncComposer(rec.form);
      return;
    }

    const blob = new Blob(rec.chunks, { type: rec.mimeType || rec.chunks[0]?.type || 'audio/webm' });
    if (!blob.size) {
      stopLocalActivity('recording_audio');
      syncComposer(rec.form);
      return;
    }

    await uploadAndSendVoice(rec, blob, Math.min(MAX_RECORDING_MS, durationMs) / 1000);
  }

  function finishPress(event, cancelled = false) {
    const session = pendingPress;
    if (!session) return;
    if (event?.pointerId != null && session.pointerId != null && event.pointerId !== session.pointerId) return;
    session.released = true;
    session.cancelled = cancelled;
    if (recordingState?.roomId === session.roomId) stopRecording(!cancelled);
    else if (pendingPress === session) pendingPress = null;
  }

  document.addEventListener('pointerup', (event) => finishPress(event, false), true);
  document.addEventListener('pointercancel', (event) => finishPress(event, true), true);

  function handleVisibilityLoss() {
    if (recordingState) stopRecording(false);
    if (pendingPress) {
      pendingPress.cancelled = true;
      pendingPress.released = true;
      pendingPress = null;
    }
    if (localActivity?.activity === 'recording_audio') stopLocalActivity('recording_audio');
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') handleVisibilityLoss();
  });
  window.addEventListener('pagehide', handleVisibilityLoss);

  function setRemoteVoiceActivity(roomId, deviceId, activity) {
    if (!roomId || !deviceId || deviceId === roomDeviceId(roomId)) return;
    const previous = remoteVoiceActivity.get(roomId);
    if (previous?.timer) clearTimeout(previous.timer);
    if (activity !== 'recording_audio' && activity !== 'audio') {
      remoteVoiceActivity.delete(roomId);
      if (roomId === currentRoomId() && baseRenderPresenceStatus) {
        try { baseRenderPresenceStatus(); } catch {}
      }
      return;
    }
    const entry = { deviceId, activity, expiresAt: Date.now() + REMOTE_ACTIVITY_TTL_MS, timer: null };
    entry.timer = setTimeout(() => {
      const current = remoteVoiceActivity.get(roomId);
      if (current !== entry) return;
      remoteVoiceActivity.delete(roomId);
      if (roomId === currentRoomId() && baseRenderPresenceStatus) {
        try { baseRenderPresenceStatus(); } catch {}
      }
    }, REMOTE_ACTIVITY_TTL_MS);
    remoteVoiceActivity.set(roomId, entry);
    if (roomId === currentRoomId()) renderRemoteVoiceActivity();
  }

  function renderRemoteVoiceActivity() {
    const roomId = currentRoomId();
    const entry = remoteVoiceActivity.get(roomId);
    if (!entry || entry.expiresAt <= Date.now()) return false;
    const line = document.getElementById('presenceLine');
    if (!line || document.querySelector('.chat-view')?.classList.contains('room-closed')) return false;
    line.classList.add('fp-typing-active');
    line.dataset.fpVoiceActivity = entry.activity;
    const label = entry.activity === 'recording_audio' ? 'записывает аудио…' : 'загружает аудио…';
    line.innerHTML = `<span class='presence-dot online'></span><span class='fp-typing-label'>${label}</span>`;
    return true;
  }

  function handleWsActivity(event) {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (!payload || payload.type !== 'typing:update') return;
    const roomId = String(payload.roomId || '');
    const deviceId = String(payload.deviceId || '');
    const activity = String(payload.activity || '');
    if (!roomId || !deviceId) return;
    if (activity === 'recording_audio' || activity === 'audio') {
      setRemoteVoiceActivity(roomId, deviceId, activity);
      return;
    }
    const current = remoteVoiceActivity.get(roomId);
    if (current?.deviceId === deviceId && payload.typing === false) setRemoteVoiceActivity(roomId, deviceId, '');
  }

  function attachWs() {
    const ws = state?.ws;
    if (!ws || ws === attachedWs) return;
    if (attachedWs) {
      try { attachedWs.removeEventListener('message', handleWsActivity); } catch {}
    }
    attachedWs = ws;
    ws.addEventListener('message', handleWsActivity);
  }

  if (baseRenderPresenceStatus && !baseRenderPresenceStatus.__fpVoiceWrapped) {
    const wrapped = function fpVoiceRenderPresenceStatus(...args) {
      const result = baseRenderPresenceStatus.apply(this, args);
      renderRemoteVoiceActivity();
      return result;
    };
    wrapped.__fpVoiceWrapped = true;
    try { renderPresenceStatus = wrapped; } catch {}
  }

  async function refreshVoiceSnapshot(roomId) {
    const deviceId = roomDeviceId(roomId);
    if (!roomId || !deviceId) return;
    try {
      const query = new URLSearchParams({ deviceId, limit: '100' });
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages?${query.toString()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      for (const message of data?.messages || []) {
        if (!isVoiceMessage(message)) continue;
        registerVoiceMessage(message);
        decorateVoiceMessage(message.id);
      }
    } catch {}
  }

  const observer = new MutationObserver(() => {
    ensureComposer();
    for (const messageId of voiceMessages.keys()) decorateVoiceMessage(messageId);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(() => {
    attachWs();
    ensureComposer();
    const roomId = currentRoomId();
    if (roomId !== lastRoomId) {
      stopActivePlayback(false);
      if (recordingState && recordingState.roomId !== roomId) stopRecording(false);
      lastRoomId = roomId;
      if (roomId) void refreshVoiceSnapshot(roomId);
    }
    renderRemoteVoiceActivity();
  }, 500);

  attachWs();
  ensureComposer();
  lastRoomId = currentRoomId();
  if (lastRoomId) void refreshVoiceSnapshot(lastRoomId);

  window.FPVoice = {
    cancelRecording: () => stopRecording(false),
    stopPlayback: () => stopActivePlayback(false)
  };
})();
