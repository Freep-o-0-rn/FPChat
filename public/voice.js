/* Build 121: Telegram-like locked recording, encrypted waveform metadata and polished voice playback. */
(() => {
  const MIN_RECORDING_MS = 700;
  const MAX_RECORDING_MS = 10 * 60 * 1000;
  const ACTIVITY_HEARTBEAT_MS = 1500;
  const LOCK_THRESHOLD_PX = 76;
  const CANCEL_THRESHOLD_PX = 92;
  const WAVEFORM_POINTS = 64;
  const VOICE_SPEED_KEY = 'fpchat:voice-speed';
  const PLAYBACK_SPEEDS = [1, 1.5, 2];
  const VOICE_BLOB_CACHE_LIMIT = 6;

  const voiceMessages = new Map();
  const voiceBlobCache = new Map();
  const voiceMetaCache = new Map();
  const boundComposers = new WeakSet();

  let pendingPress = null;
  let recordingState = null;
  let previewState = null;
  let uploadInFlight = false;
  let localActivity = null;
  let localActivityTimer = null;
  let activePlayback = null;
  let lastRoomId = '';
  let playbackGeneration = 0;

  const baseAppendMessage = typeof appendMessage === 'function' ? appendMessage : null;
  const baseBuildMediaFallbackText = typeof buildMediaFallbackText === 'function' ? buildMediaFallbackText : null;
  const baseDecryptRoomText = typeof decryptRoomText === 'function' ? decryptRoomText : null;

  const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6.8v10.4c0 .8.9 1.2 1.5.8l8-5.2a1 1 0 0 0 0-1.6l-8-5.2c-.6-.4-1.5 0-1.5.8Z"/></svg>';
  const PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7v10M16 7v10"/></svg>';
  const STOP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.5" y="7.5" width="9" height="9" rx="1.4"/></svg>';
  const SEND_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 5 16 7-16 7 3-7-3-7Z"/><path d="M7 12h13"/></svg>';
  const TRASH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4.8h6V7M7.5 7l.8 12h7.4l.8-12M10 10.5v5M14 10.5v5"/></svg>';
  const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="10" width="11" height="9" rx="2"/><path d="M9 10V7.5a3 3 0 0 1 6 0V10"/></svg>';

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
      sendActivitySignal('activity:stop', previous.roomId, previous.activity);
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
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }

  function playbackSpeed() {
    const raw = Number(localStorage.getItem(VOICE_SPEED_KEY) || '1');
    return PLAYBACK_SPEEDS.includes(raw) ? raw : 1;
  }

  function speedLabel(value) {
    return `${Number(value || 1)}×`;
  }

  function setPlaybackSpeed(value) {
    const speed = PLAYBACK_SPEEDS.includes(Number(value)) ? Number(value) : 1;
    localStorage.setItem(VOICE_SPEED_KEY, String(speed));
    document.querySelectorAll('.fp-voice-speed').forEach((el) => { el.textContent = speedLabel(speed); });
    if (activePlayback?.audio) activePlayback.audio.playbackRate = speed;
    if (previewState?.audio) previewState.audio.playbackRate = speed;
    return speed;
  }

  function cyclePlaybackSpeed() {
    const current = playbackSpeed();
    const index = PLAYBACK_SPEEDS.indexOf(current);
    return setPlaybackSpeed(PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length]);
  }

  function setPlayIcon(button, mode = 'play') {
    if (!button) return;
    button.classList.toggle('is-loading', mode === 'loading');
    if (mode === 'pause') {
      button.innerHTML = PAUSE_SVG;
      button.setAttribute('aria-label', 'Пауза');
    } else if (mode === 'loading') {
      button.innerHTML = '<span class="fp-voice-spinner" aria-hidden="true"></span>';
      button.setAttribute('aria-label', 'Загрузка голосового');
    } else {
      button.innerHTML = PLAY_SVG;
      button.setAttribute('aria-label', 'Воспроизвести голосовое');
    }
  }

  function defaultWaveform(seed = 'voice') {
    let hash = 2166136261;
    for (const ch of String(seed)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
    const out = [];
    for (let i = 0; i < WAVEFORM_POINTS; i += 1) {
      hash ^= hash << 13; hash ^= hash >>> 17; hash ^= hash << 5; hash >>>= 0;
      const value = 42 + (hash % 130);
      out.push(value);
    }
    return out;
  }

  function normalizeWaveform(samples, target = WAVEFORM_POINTS) {
    const clean = Array.isArray(samples)
      ? samples.map((v) => Math.max(0, Number(v) || 0)).filter(Number.isFinite)
      : [];
    if (!clean.length) return [];
    const out = [];
    for (let i = 0; i < target; i += 1) {
      const start = Math.floor((i * clean.length) / target);
      const end = Math.max(start + 1, Math.floor(((i + 1) * clean.length) / target));
      let peak = 0;
      let sum = 0;
      let count = 0;
      for (let j = start; j < Math.min(end, clean.length); j += 1) {
        peak = Math.max(peak, clean[j]);
        sum += clean[j];
        count += 1;
      }
      out.push(peak * 0.7 + (count ? sum / count : peak) * 0.3);
    }
    const max = Math.max(...out, 0.0001);
    return out.map((value) => Math.max(18, Math.min(255, Math.round((value / max) * 255))));
  }

  function resampleWaveform(waveform, count) {
    const source = Array.isArray(waveform) && waveform.length ? waveform : defaultWaveform('fallback');
    if (count <= 1) return [source[0] || 32];
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const position = (i / Math.max(1, count - 1)) * Math.max(0, source.length - 1);
      const left = Math.floor(position);
      const right = Math.min(source.length - 1, left + 1);
      const t = position - left;
      out.push((Number(source[left]) || 0) * (1 - t) + (Number(source[right]) || 0) * t);
    }
    return out;
  }

  function drawWaveform(canvas, waveform, progress = 0) {
    if (!canvas?.isConnected) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const style = getComputedStyle(canvas);
    const active = style.getPropertyValue('--fp-wave-active').trim() || style.color || '#3390ec';
    const idle = style.getPropertyValue('--fp-wave-idle').trim() || 'rgba(148,163,184,.45)';
    const cssBarWidth = 2.2;
    const cssGap = 1.9;
    const count = Math.max(12, Math.min(WAVEFORM_POINTS, Math.floor(rect.width / (cssBarWidth + cssGap))));
    const values = resampleWaveform(waveform, count);
    const barWidth = cssBarWidth * dpr;
    const gap = cssGap * dpr;
    const used = count * barWidth + Math.max(0, count - 1) * gap;
    let x = Math.max(0, (width - used) / 2);
    const playedBars = Math.round(Math.max(0, Math.min(1, Number(progress) || 0)) * count);
    values.forEach((raw, index) => {
      const normalized = Math.max(0.12, Math.min(1, Number(raw) / 255));
      const barHeight = Math.max(3 * dpr, normalized * height * 0.88);
      const y = (height - barHeight) / 2;
      ctx.fillStyle = index < playedBars ? active : idle;
      ctx.beginPath();
      const radius = Math.min(barWidth / 2, 2 * dpr);
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, barWidth, barHeight, radius);
      else ctx.rect(x, y, barWidth, barHeight);
      ctx.fill();
      x += barWidth + gap;
    });
  }

  async function extractWaveformFromBlob(blob) {
    if (!blob?.size) return [];
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return [];
    let context = null;
    try {
      context = new AudioContextCtor();
      const buffer = await blob.arrayBuffer();
      const audioBuffer = await new Promise((resolve, reject) => {
        const copy = buffer.slice(0);
        const result = context.decodeAudioData(copy, resolve, reject);
        if (result?.then) result.then(resolve, reject);
      });
      const channel = audioBuffer.getChannelData(0);
      if (!channel?.length) return [];
      const buckets = [];
      const bucketSize = Math.max(1, Math.floor(channel.length / WAVEFORM_POINTS));
      for (let i = 0; i < WAVEFORM_POINTS; i += 1) {
        const start = i * bucketSize;
        const end = i === WAVEFORM_POINTS - 1 ? channel.length : Math.min(channel.length, start + bucketSize);
        let sum = 0;
        let peak = 0;
        let count = 0;
        const step = Math.max(1, Math.floor((end - start) / 160));
        for (let j = start; j < end; j += step) {
          const value = Math.abs(channel[j] || 0);
          sum += value * value;
          peak = Math.max(peak, value);
          count += 1;
        }
        const rms = count ? Math.sqrt(sum / count) : 0;
        buckets.push(peak * 0.55 + rms * 0.45);
      }
      return normalizeWaveform(buckets, WAVEFORM_POINTS);
    } catch {
      return [];
    } finally {
      try { await context?.close?.(); } catch {}
    }
  }

  function registerVoiceMessage(message) {
    if (!isVoiceMessage(message) || message?.id == null) return null;
    const key = String(message.id);
    const media = message.media[0];
    const existing = voiceMessages.get(key);
    const cachedWave = voiceMetaCache.get(String(media.public_id || '')) || existing?.waveform || null;
    const entry = { message, media, waveform: cachedWave, metaPromise: existing?.metaPromise || null };
    voiceMessages.set(key, entry);
    return entry;
  }

  function findMessageElement(messageId) {
    const id = String(messageId ?? '');
    if (!id) return null;
    return [...document.querySelectorAll('#messages .bubble-wrap.msg')]
      .find((el) => String(el.dataset.messageId || el.dataset.id || '') === id) || null;
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

  async function decryptVoiceMeta(roomId, ciphertext, iv) {
    if (!ciphertext || !iv) return null;
    try {
      const key = await getRoomKey(roomId);
      if (!key) return null;
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.decode(iv) }, key, b64.decode(ciphertext));
      const parsed = JSON.parse(new TextDecoder().decode(plain));
      const waveform = Array.isArray(parsed?.waveform)
        ? parsed.waveform.slice(0, WAVEFORM_POINTS).map((v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0))))
        : [];
      return waveform.length ? waveform : null;
    } catch {
      return null;
    }
  }

  async function loadVoiceMeta(entry) {
    if (!entry?.media?.public_id) return null;
    if (entry.waveform?.length) return entry.waveform;
    const publicId = String(entry.media.public_id);
    const cached = voiceMetaCache.get(publicId);
    if (cached?.length) {
      entry.waveform = cached;
      return cached;
    }
    if (entry.metaPromise) return entry.metaPromise;
    const roomId = currentRoomId();
    const deviceId = roomDeviceId(roomId);
    if (!roomId || !deviceId) return null;
    entry.metaPromise = (async () => {
      try {
        const response = await fetch(`/api/media/${encodeURIComponent(publicId)}/voice-meta?deviceId=${encodeURIComponent(deviceId)}`, { cache: 'no-store' });
        if (!response.ok) return null;
        const data = await response.json().catch(() => null);
        const waveform = await decryptVoiceMeta(roomId, data?.meta?.ciphertext, data?.meta?.iv);
        if (waveform?.length) {
          entry.waveform = waveform;
          voiceMetaCache.set(publicId, waveform);
        }
        return waveform;
      } catch {
        return null;
      } finally {
        entry.metaPromise = null;
      }
    })();
    return entry.metaPromise;
  }

  function renderPlayerProgress(root, currentTime = 0, durationOverride = null) {
    if (!root) return;
    const duration = Number(durationOverride ?? root.dataset.duration ?? 0) || 0;
    const current = Math.max(0, Math.min(duration || Infinity, Number(currentTime) || 0));
    const time = root.querySelector('.fp-voice-time');
    const entry = voiceMessages.get(String(root.dataset.messageId || ''));
    const waveform = entry?.waveform || defaultWaveform(root.dataset.messageId || 'voice');
    drawWaveform(root.querySelector('.fp-voice-waveform'), waveform, duration > 0 ? current / duration : 0);
    if (time) time.textContent = duration > 0 ? `${formatDuration(current)} / ${formatDuration(duration)}` : formatDuration(current);
  }

  function bindWaveformSeek(canvas, getDuration, onSeek) {
    if (!canvas || canvas.dataset.fpSeekBound === '1') return;
    canvas.dataset.fpSeekBound = '1';
    let dragging = false;
    const seek = (event) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const duration = Number(getDuration?.() || 0);
      onSeek?.(ratio, duration);
    };
    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      try { canvas.setPointerCapture?.(event.pointerId); } catch {}
      seek(event);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      event.preventDefault();
      event.stopPropagation();
      seek(event);
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      event.preventDefault();
      event.stopPropagation();
      seek(event);
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', () => { dragging = false; });
    canvas.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); });
  }

  function decorateVoiceMessage(messageId) {
    const entry = voiceMessages.get(String(messageId));
    const messageEl = findMessageElement(messageId);
    if (!entry || !messageEl) return false;
    if (messageEl.dataset.fpVoiceDecorated === '1') {
      setCachedPreview(messageId, entry);
      renderPlayerProgress(messageEl.querySelector('.fp-voice-player'), activePlayback?.messageId === String(messageId) ? activePlayback.audio.currentTime : 0, activePlayback?.messageId === String(messageId) ? activePlayback.duration : null);
      return true;
    }

    const bubble = messageEl.querySelector('.bubble');
    const meta = bubble?.querySelector('.meta');
    if (!bubble || !meta) return false;

    bubble.querySelector('.media-grid')?.remove();
    bubble.querySelector('.message-text')?.remove();

    const duration = Math.max(0, Number(entry.media?.duration_seconds || 0) || 0);
    const root = document.createElement('div');
    root.className = 'fp-voice-player';
    root.dataset.messageId = String(messageId);
    root.dataset.duration = String(duration);
    root.innerHTML = `
      <button type="button" class="fp-voice-play" aria-label="Воспроизвести голосовое">${PLAY_SVG}</button>
      <div class="fp-voice-main">
        <canvas class="fp-voice-waveform" aria-label="Перемотка голосового сообщения"></canvas>
        <div class="fp-voice-footer">
          <span class="fp-voice-time">0:00 / ${formatDuration(duration)}</span>
          <button type="button" class="fp-voice-speed">${speedLabel(playbackSpeed())}</button>
        </div>
      </div>`;

    meta.before(root);
    messageEl.dataset.fpVoiceDecorated = '1';
    messageEl.classList.add('fp-voice-message');
    setCachedPreview(messageId, entry);

    const play = root.querySelector('.fp-voice-play');
    const speed = root.querySelector('.fp-voice-speed');
    const canvas = root.querySelector('.fp-voice-waveform');
    setPlayIcon(play, 'play');
    renderPlayerProgress(root, 0, duration);

    play?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void toggleVoicePlayback(String(messageId), root);
    });
    speed?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      cyclePlaybackSpeed();
    });
    bindWaveformSeek(canvas, () => Number(root.dataset.duration || 0), (ratio, seekDuration) => {
      const durationValue = seekDuration || Number(root.dataset.duration || 0) || 0;
      const target = ratio * durationValue;
      root.dataset.pendingSeek = String(ratio);
      if (activePlayback?.messageId === String(messageId)) {
        activePlayback.audio.currentTime = target;
        renderPlayerProgress(root, target, activePlayback.duration || durationValue);
      } else {
        renderPlayerProgress(root, target, durationValue);
      }
    });

    void loadVoiceMeta(entry).then((waveform) => {
      if (!waveform?.length || !root.isConnected) return;
      const current = activePlayback?.messageId === String(messageId) ? activePlayback.audio.currentTime : Number(root.dataset.pendingSeek || 0) * duration;
      renderPlayerProgress(root, current, activePlayback?.messageId === String(messageId) ? activePlayback.duration : duration);
    });
    return true;
  }

  function stopActivePlayback(reset = false) {
    playbackGeneration += 1;
    const current = activePlayback;
    if (!current) return;
    try { current.audio.pause(); } catch {}
    const root = current.root?.isConnected ? current.root : findMessageElement(current.messageId)?.querySelector('.fp-voice-player');
    setPlayIcon(root?.querySelector('.fp-voice-play'), 'play');
    if (reset) {
      try { current.audio.currentTime = 0; } catch {}
      if (root) root.dataset.pendingSeek = '0';
      renderPlayerProgress(root, 0, current.duration);
    }
    activePlayback = null;
  }

  function revokeVoiceBlobAsset(asset) {
    const url = String(asset?.url || '');
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch {}
  }

  function evictVoiceBlobCache(key) {
    const safeKey = String(key || '');
    if (!safeKey || !voiceBlobCache.has(safeKey)) return false;
    const pending = voiceBlobCache.get(safeKey);
    voiceBlobCache.delete(safeKey);
    Promise.resolve(pending).then(revokeVoiceBlobAsset).catch(() => {});
    return true;
  }

  function pruneVoiceBlobCache(limit = VOICE_BLOB_CACHE_LIMIT) {
    const safeLimit = Math.max(1, Number(limit) || VOICE_BLOB_CACHE_LIMIT);
    const activeKey = String(activePlayback?.messageId || '');
    for (const key of [...voiceBlobCache.keys()]) {
      if (voiceBlobCache.size <= safeLimit) break;
      if (key === activeKey) continue;
      evictVoiceBlobCache(key);
    }
  }

  function clearVoiceBlobCache() {
    const activeKey = String(activePlayback?.messageId || '');
    for (const key of [...voiceBlobCache.keys()]) {
      if (key === activeKey) continue;
      evictVoiceBlobCache(key);
    }
  }

  async function loadVoiceUrl(messageId) {
    const key = String(messageId);
    if (voiceBlobCache.has(key)) {
      const cached = voiceBlobCache.get(key);
      voiceBlobCache.delete(key);
      voiceBlobCache.set(key, cached);
      return cached;
    }
    const entry = voiceMessages.get(key);
    if (!entry?.media?.public_id) throw new Error('voice media unavailable');
    const roomId = currentRoomId();
    const deviceId = roomDeviceId(roomId);
    if (!roomId || !deviceId) throw new Error('voice room unavailable');
    const context = window.FPRoomContext170?.current?.();
    const roomKey = await getRoomKey(roomId);
    if (currentRoomId() !== roomId || (context && !window.FPRoomContext170.isCurrent(context))) throw new DOMException('Stale voice room', 'AbortError');

    const promise = (async () => {
      const plain = await readEncryptedMedia174(`/api/media/${encodeURIComponent(entry.media.public_id)}/blob?deviceId=${encodeURIComponent(deviceId)}`,entry.media.mime_type || 'audio/webm',roomKey,{signal:context?.signal});
      if (!entry.waveform?.length) {
        const extracted = await extractWaveformFromBlob(plain);
        if (extracted?.length) {
          entry.waveform = extracted;
          voiceMetaCache.set(String(entry.media.public_id), extracted);
        }
      }
      return {
        url: URL.createObjectURL(plain),
        blob: plain,
        duration: Number(entry.media.duration_seconds || 0) || 0
      };
    })();

    voiceBlobCache.set(key, promise);
    pruneVoiceBlobCache();
    try {
      const loaded = await promise;
      if (voiceBlobCache.get(key) === promise) {
        voiceBlobCache.delete(key);
        voiceBlobCache.set(key, promise);
        pruneVoiceBlobCache();
      }
      return loaded;
    } catch (error) {
      if (voiceBlobCache.get(key) === promise) voiceBlobCache.delete(key);
      throw error;
    }
  }

  async function toggleVoicePlayback(messageId, root) {
    if (activePlayback?.messageId === messageId) {
      if (activePlayback.audio.paused) {
        try {
          activePlayback.audio.playbackRate = playbackSpeed();
          await activePlayback.audio.play();
          setPlayIcon(root.querySelector('.fp-voice-play'), 'pause');
        } catch {}
      } else {
        activePlayback.audio.pause();
        setPlayIcon(root.querySelector('.fp-voice-play'), 'play');
      }
      return;
    }

    stopActivePlayback(false);
    const button = root.querySelector('.fp-voice-play');
    const generation = playbackGeneration;
    setPlayIcon(button, 'loading');

    try {
      const loaded = await loadVoiceUrl(messageId);
      if (generation !== playbackGeneration || !root.isConnected) return;
      const audio = new Audio(loaded.url);
      audio.preload = 'metadata';
      audio.playbackRate = playbackSpeed();
      const duration = loaded.duration || Number(root.dataset.duration || 0) || 0;
      const playback = { messageId, root, audio, duration };
      activePlayback = playback;

      audio.addEventListener('loadedmetadata', () => {
        const actual = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
        playback.duration = actual;
        root.dataset.duration = String(actual);
        const pendingRatio = Math.max(0, Math.min(1, Number(root.dataset.pendingSeek || 0)));
        if (pendingRatio > 0) {
          try { audio.currentTime = pendingRatio * actual; } catch {}
        }
        renderPlayerProgress(root, audio.currentTime, actual);
      });
      audio.addEventListener('timeupdate', () => {
        if (activePlayback !== playback) return;
        renderPlayerProgress(root, audio.currentTime, playback.duration || audio.duration);
      });
      audio.addEventListener('play', () => {
        if (activePlayback === playback) setPlayIcon(button, 'pause');
      });
      audio.addEventListener('pause', () => {
        if (activePlayback === playback) setPlayIcon(button, 'play');
      });
      audio.addEventListener('ended', () => {
        if (activePlayback !== playback) return;
        root.dataset.pendingSeek = '0';
        renderPlayerProgress(root, 0, playback.duration);
        setPlayIcon(button, 'play');
        activePlayback = null;
      });
      audio.addEventListener('error', () => {
        if (activePlayback === playback) activePlayback = null;
        setPlayIcon(button, 'play');
      });

      const pendingRatio = Math.max(0, Math.min(1, Number(root.dataset.pendingSeek || 0)));
      if (pendingRatio > 0 && duration > 0) {
        try { audio.currentTime = pendingRatio * duration; } catch {}
      }
      await audio.play();
      setPlayIcon(button, 'pause');
      renderPlayerProgress(root, audio.currentTime, playback.duration || duration);
    } catch {
      if (activePlayback?.messageId === messageId) activePlayback = null;
      setPlayIcon(button, 'play');
      alert('Не удалось загрузить голосовое сообщение.');
    }
  }

  if (baseDecryptRoomText && !baseDecryptRoomText.__fpVoice121Wrapped) {
    const wrapped = async function fpVoiceDecryptRoomText(roomId, message) {
      const text = await baseDecryptRoomText.apply(this, arguments);
      if (isVoiceMessage(message) && !String(text || '').trim()) return 'Голосовое сообщение';
      return text;
    };
    wrapped.__fpVoice121Wrapped = true;
    try { decryptRoomText = wrapped; } catch {}
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
      const voice = isVoiceMessage(message);
      const result = baseAppendMessage.call(this, box, message, voice && !String(text || '').trim() ? 'Голосовое сообщение' : text, mine, autoScroll);
      if (voice) {
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

  function stopLiveAnalyser(rec) {
    if (!rec) return;
    if (rec.analyserFrame) cancelAnimationFrame(rec.analyserFrame);
    rec.analyserFrame = null;
    try { rec.sourceNode?.disconnect?.(); } catch {}
    try { rec.analyser?.disconnect?.(); } catch {}
    rec.sourceNode = null;
    rec.analyser = null;
    const context = rec.audioContext;
    rec.audioContext = null;
    if (context?.close) void context.close().catch(() => {});
  }

  function startLiveAnalyser(rec) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor || !rec?.stream) return;
    try {
      const context = new AudioContextCtor();
      const source = context.createMediaStreamSource(rec.stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      rec.audioContext = context;
      rec.sourceNode = source;
      rec.analyser = analyser;
      rec.waveSamples = [];
      rec.lastWaveSampleAt = 0;
      void context.resume?.().catch(() => {});
      const data = new Uint8Array(analyser.fftSize);
      const tick = (timestamp) => {
        if (recordingState !== rec || rec.finalized || !rec.analyser) return;
        rec.analyser.getByteTimeDomainData(data);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < data.length; i += 1) {
          const value = Math.abs((data[i] - 128) / 128);
          sum += value * value;
          peak = Math.max(peak, value);
        }
        const rms = Math.sqrt(sum / data.length);
        const level = Math.min(1, peak * 0.6 + rms * 1.9);
        if (timestamp - rec.lastWaveSampleAt >= 45) {
          rec.waveSamples.push(level);
          if (rec.waveSamples.length > 12000) rec.waveSamples.shift();
          rec.lastWaveSampleAt = timestamp;
        }
        drawLiveRecordingWave(rec);
        rec.analyserFrame = requestAnimationFrame(tick);
      };
      rec.analyserFrame = requestAnimationFrame(tick);
    } catch {}
  }

  function drawLiveRecordingWave(rec) {
    const canvas = rec?.form?.querySelector('.fp-voice-live-waveform');
    if (!canvas) return;
    const recent = Array.isArray(rec.waveSamples) ? rec.waveSamples.slice(-96) : [];
    const waveform = normalizeWaveform(recent.length ? recent : [0.1, 0.15, 0.12], Math.min(WAVEFORM_POINTS, Math.max(16, recent.length || 16)));
    drawWaveform(canvas, waveform, 1);
  }

  function setRecordingUi(rec, mode = 'hold', processing = false) {
    const form = rec?.form;
    if (!form) return;
    const active = mode !== 'off';
    form.classList.toggle('fp-voice-recording', active);
    form.classList.toggle('fp-voice-locked', active && mode === 'locked');
    form.classList.toggle('fp-voice-processing', Boolean(processing));
    const bar = form.querySelector('.fp-voice-recording-bar');
    if (!bar) return;
    bar.classList.toggle('hidden', !active);
    const elapsed = rec?.startedAt ? Math.max(0, (performance.now() - rec.startedAt) / 1000) : 0;
    const time = bar.querySelector('.fp-voice-record-time');
    const hint = bar.querySelector('.fp-voice-record-hint');
    if (time) time.textContent = formatDuration(elapsed);
    if (hint) {
      if (processing) hint.textContent = 'Подготовка…';
      else if (mode === 'locked') hint.textContent = 'Запись зафиксирована';
      else hint.textContent = '← Отмена   ↑ Закрепить';
    }
    drawLiveRecordingWave(rec);
  }

  function updateGestureUi(session, dx, dy) {
    const form = session?.form;
    const bar = form?.querySelector('.fp-voice-recording-bar');
    if (!bar || session.locked) return;
    const cancelProgress = Math.max(0, Math.min(1, -dx / CANCEL_THRESHOLD_PX));
    const lockProgress = Math.max(0, Math.min(1, -dy / LOCK_THRESHOLD_PX));
    bar.style.setProperty('--fp-cancel-progress', String(cancelProgress));
    bar.style.setProperty('--fp-lock-progress', String(lockProgress));
    bar.classList.toggle('fp-voice-cancel-arming', cancelProgress > 0.18 && cancelProgress >= lockProgress);
    bar.classList.toggle('fp-voice-lock-arming', lockProgress > 0.18 && lockProgress > cancelProgress);
  }

  function resetGestureUi(form) {
    const bar = form?.querySelector('.fp-voice-recording-bar');
    if (!bar) return;
    bar.style.removeProperty('--fp-cancel-progress');
    bar.style.removeProperty('--fp-lock-progress');
    bar.classList.remove('fp-voice-cancel-arming', 'fp-voice-lock-arming');
  }

  function syncComposer(form) {
    if (!form?.isConnected) return;
    const input = form.querySelector('#msgInput');
    const send = form.querySelector('#sendBtn');
    if (!input || !send) return;
    const empty = !String(input.value || '').trim();
    send.disabled = empty;
    const mic = form.querySelector('.fp-voice-record-btn');
    if (!mic) return;
    const view = form.closest('.chat-view');
    const closed = view?.classList.contains('room-closed') === true;
    const editing = view?.classList.contains('fp-editing-message') === true;
    const currentBusy = Boolean(recordingState || uploadInFlight || previewState);
    form.classList.toggle('fp-voice-mic-mode', empty && !editing && !closed && !currentBusy);
    mic.disabled = editing || closed || currentBusy || !empty;
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

    const recordingBar = document.createElement('div');
    recordingBar.className = 'fp-voice-recording-bar hidden';
    recordingBar.innerHTML = `
      <button type="button" class="fp-voice-record-delete" aria-label="Удалить запись">${TRASH_SVG}</button>
      <div class="fp-voice-record-status"><span class="fp-voice-record-dot"></span><strong class="fp-voice-record-time">0:00</strong></div>
      <canvas class="fp-voice-live-waveform" aria-hidden="true"></canvas>
      <span class="fp-voice-record-hint">← Отмена   ↑ Закрепить</span>
      <span class="fp-voice-lock-cue" aria-hidden="true">${LOCK_SVG}</span>
      <button type="button" class="fp-voice-record-stop" aria-label="Остановить запись">${STOP_SVG}</button>
      <button type="button" class="fp-voice-record-send" aria-label="Отправить запись">${SEND_SVG}</button>`;
    form.insertBefore(recordingBar, form.firstChild);

    const previewBar = document.createElement('div');
    previewBar.className = 'fp-voice-preview-bar hidden';
    previewBar.innerHTML = `
      <button type="button" class="fp-voice-preview-play" aria-label="Прослушать запись">${PLAY_SVG}</button>
      <div class="fp-voice-preview-main">
        <canvas class="fp-voice-preview-waveform" aria-label="Перемотка записи"></canvas>
        <div class="fp-voice-preview-footer"><span class="fp-voice-preview-time">0:00</span><button type="button" class="fp-voice-speed">${speedLabel(playbackSpeed())}</button></div>
      </div>
      <button type="button" class="fp-voice-preview-delete" aria-label="Удалить запись">${TRASH_SVG}</button>
      <button type="button" class="fp-voice-preview-send" aria-label="Отправить запись">${SEND_SVG}</button>`;
    form.insertBefore(previewBar, form.firstChild);

    input.addEventListener('input', () => syncComposer(form), true);
    mic.addEventListener('pointerdown', (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      void beginPressRecording(event, form, mic);
    });
    mic.addEventListener('contextmenu', (event) => event.preventDefault());

    recordingBar.querySelector('.fp-voice-record-delete')?.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation(); stopRecording('cancel');
    });
    recordingBar.querySelector('.fp-voice-record-stop')?.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation(); stopRecording('preview');
    });
    recordingBar.querySelector('.fp-voice-record-send')?.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation(); stopRecording('send');
    });

    previewBar.querySelector('.fp-voice-preview-play')?.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation(); void togglePreviewPlayback();
    });
    previewBar.querySelector('.fp-voice-preview-delete')?.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation(); clearPreview(true);
    });
    previewBar.querySelector('.fp-voice-preview-send')?.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation(); void sendPreview();
    });
    previewBar.querySelector('.fp-voice-speed')?.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation(); cyclePlaybackSpeed();
    });
    bindWaveformSeek(previewBar.querySelector('.fp-voice-preview-waveform'), () => previewState?.duration || 0, (ratio, duration) => {
      if (!previewState) return;
      previewState.seekRatio = ratio;
      const target = ratio * duration;
      if (previewState.audio) previewState.audio.currentTime = target;
      renderPreviewProgress(target);
    });
    syncComposer(form);
  }

  async function beginPressRecording(event, form, mic) {
    if (pendingPress || recordingState || uploadInFlight || previewState) return;
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
      startX: event.clientX,
      startY: event.clientY,
      released: false,
      cancelled: false,
      locked: false
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
      session,
      chunks: [],
      mimeType: recorder.mimeType || mimeType || 'audio/webm',
      startedAt: performance.now(),
      finalAction: 'send',
      timer: null,
      maxTimer: null,
      finalized: false,
      locked: false,
      waveSamples: [],
      analyserFrame: null,
      audioContext: null,
      sourceNode: null,
      analyser: null
    };
    recordingState = rec;

    recorder.addEventListener('dataavailable', (e) => {
      if (e.data?.size) rec.chunks.push(e.data);
    });
    recorder.addEventListener('stop', () => { void finalizeRecording(rec); }, { once: true });
    recorder.addEventListener('error', () => {
      rec.finalAction = 'cancel';
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

    startLiveAnalyser(rec);
    startLocalActivity(roomId, 'recording_audio');
    setRecordingUi(rec, 'hold', false);
    rec.timer = setInterval(() => setRecordingUi(rec, rec.locked ? 'locked' : 'hold', false), 100);
    rec.maxTimer = setTimeout(() => stopRecording(rec.locked ? 'preview' : 'send'), MAX_RECORDING_MS);
    syncComposer(form);
  }

  function lockRecording(session) {
    const rec = recordingState;
    if (!rec || rec.session !== session || session.cancelled || session.locked) return;
    session.locked = true;
    rec.locked = true;
    resetGestureUi(rec.form);
    try { session.mic.releasePointerCapture?.(session.pointerId); } catch {}
    navigator.vibrate?.(18);
    setRecordingUi(rec, 'locked', false);
  }

  function cancelRecordingByGesture(session) {
    if (!session || session.cancelled) return;
    session.cancelled = true;
    navigator.vibrate?.(22);
    resetGestureUi(session.form);
    stopRecording('cancel');
  }

  function handlePointerMove(event) {
    const session = pendingPress;
    if (!session || session.locked || session.cancelled) return;
    if (event.pointerId != null && session.pointerId != null && event.pointerId !== session.pointerId) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    updateGestureUi(session, dx, dy);
    const horizontal = -dx >= CANCEL_THRESHOLD_PX && -dx > -dy * 0.85;
    const vertical = -dy >= LOCK_THRESHOLD_PX && -dy > -dx * 0.72;
    if (horizontal) {
      cancelRecordingByGesture(session);
      return;
    }
    if (vertical) lockRecording(session);
  }

  function stopRecording(action = 'cancel') {
    const rec = recordingState;
    if (!rec || rec.finalized) return;
    rec.finalAction = action;
    if (rec.timer) clearInterval(rec.timer);
    rec.timer = null;
    if (rec.maxTimer) clearTimeout(rec.maxTimer);
    rec.maxTimer = null;
    resetGestureUi(rec.form);
    setRecordingUi(rec, rec.locked ? 'locked' : 'hold', true);
    try {
      if (rec.recorder.state !== 'inactive') rec.recorder.stop();
      else void finalizeRecording(rec);
    } catch {
      void finalizeRecording(rec);
    }
  }

  function finishPress(event, cancelled = false) {
    const session = pendingPress;
    if (!session) return;
    if (event?.pointerId != null && session.pointerId != null && event.pointerId !== session.pointerId) return;
    session.released = true;
    if (cancelled) session.cancelled = true;
    if (session.locked) {
      if (pendingPress === session) pendingPress = null;
      return;
    }
    if (recordingState?.session === session) stopRecording(cancelled || session.cancelled ? 'cancel' : 'send');
    else if (pendingPress === session) pendingPress = null;
  }

  document.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true });
  document.addEventListener('pointerup', (event) => finishPress(event, false), true);
  document.addEventListener('pointercancel', (event) => finishPress(event, true), true);

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

  async function encryptVoiceText(roomId, text = '') {
    const key = await getRoomKey(roomId);
    if (!key) throw new Error('room key unavailable');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(text || '')));
    return { iv: b64.encode(iv), ciphertext: b64.encode(cipher) };
  }

  async function encryptVoiceMeta(roomId, waveform) {
    return encryptVoiceText(roomId, JSON.stringify({ version: 1, waveform: Array.isArray(waveform) ? waveform.slice(0, WAVEFORM_POINTS) : [] }));
  }

  async function deletePendingVoice(roomId, deviceId, mediaId) {
    if (!roomId || !deviceId || !mediaId) return;
    await fetch(`/api/rooms/${encodeURIComponent(roomId)}/media/pending`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, mediaIds: [mediaId] })
    }).catch(() => {});
  }

  async function uploadAndSendVoice(data) {
    const contexts = window.FPRoomContext170;
    const operation = contexts?.beginOperation?.(data.roomId, 'voice-send') || null;
    const draft = typeof ensureDraftState === 'function' ? ensureDraftState(data.roomId) : state.drafts?.[data.roomId];
    const draftText = draft?.text || '';
    const draftReply = draft?.replyTo || null;
    const replyToMessageId = draftReply?.messageId || null;
    let operationStatus = 'failed';

    uploadInFlight = true;
    syncComposer(data.form);
    startLocalActivity(data.roomId, 'audio');
    let uploadedMedia = null;
    try {
      const encryptedFile = await encryptVoiceBlob(data.roomId, data.blob);
      const meta = await encryptVoiceMeta(data.roomId, data.waveform);
      const fd = new FormData();
      fd.append('deviceId', data.deviceId);
      fd.append('encryptedFile', encryptedFile, 'voice.bin');
      fd.append('mimeType', data.blob.type || data.mimeType || 'audio/webm');
      fd.append('sizeBytes', String(data.blob.size));
      fd.append('encryptedSizeBytes', String(encryptedFile.size));
      fd.append('durationSeconds', String(data.duration));
      fd.append('metaCiphertext', meta.ciphertext);
      fd.append('metaIv', meta.iv);

      const uploadResponse = await fetch(`/api/rooms/${encodeURIComponent(data.roomId)}/voice/upload`, {
        method: 'POST',
        body: fd,
        signal: operation?.signal
      });
      const uploadData = await uploadResponse.json().catch(() => null);
      if (!uploadResponse.ok || !uploadData?.ok || !uploadData.media?.id) throw new Error(uploadData?.error || 'voice upload failed');
      uploadedMedia = uploadData.media;
      if (uploadedMedia.public_id && data.waveform?.length) voiceMetaCache.set(String(uploadedMedia.public_id), data.waveform);

      const wsOk = await ensureWsConnected(data.deviceId);
      if (!wsOk || !state.ws || state.ws.readyState !== WebSocket.OPEN || state.ws.deviceId !== data.deviceId) throw new Error('voice websocket unavailable');

      const enc = await encryptVoiceText(data.roomId, '');
      if (replyToMessageId && typeof markReplyTargetRead === 'function' && currentRoomId() === data.roomId) markReplyTargetRead(replyToMessageId);

      state.ws.send(JSON.stringify({
        type: 'message:new',
        roomId: data.roomId,
        messageType: 'media',
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        notificationPreview: 'Голосовое сообщение',
        replyToMessageId,
        mediaIds: [Number(uploadedMedia.id)]
      }));

      const draftUnchanged = Boolean(draft && draft.text === draftText && draft.replyTo === draftReply);
      if (draftUnchanged) {
        draft.replyTo = null;
        if (currentRoomId() === data.roomId && typeof updateReplyComposerBar === 'function') updateReplyComposerBar();
        if (typeof clearDraftOnServer === 'function') {
          try { await clearDraftOnServer(data.roomId); } catch {}
        }
      }
      operationStatus = 'sent';
      return true;
    } catch (error) {
      operationStatus = error?.name === 'AbortError' ? 'cancelled' : 'failed';
      if (uploadedMedia?.id) await deletePendingVoice(data.roomId, data.deviceId, uploadedMedia.id);
      return false;
    } finally {
      if (operation) contexts?.finishOperation?.(operation, operationStatus);
      uploadInFlight = false;
      stopLocalActivity('audio');
      syncComposer(data.form);
    }
  }

  function dispatchReadyVoice177(data) {
    const manager = window.FPSendManager177;
    if (!manager?.dispatch) return false;
    return manager.dispatch(() => uploadAndSendVoice(data));
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
    stopLiveAnalyser(rec);
    rec.stream?.getTracks?.().forEach((track) => track.stop());
    resetGestureUi(rec.form);
    setRecordingUi(rec, 'off', false);

    const durationMs = Math.max(0, performance.now() - rec.startedAt);
    stopLocalActivity('recording_audio');
    if (rec.finalAction === 'cancel' || durationMs < MIN_RECORDING_MS || !rec.chunks.length) {
      syncComposer(rec.form);
      return;
    }

    const blob = new Blob(rec.chunks, { type: rec.mimeType || rec.chunks[0]?.type || 'audio/webm' });
    if (!blob.size) {
      syncComposer(rec.form);
      return;
    }

    let waveform = normalizeWaveform(rec.waveSamples, WAVEFORM_POINTS);
    if (!waveform.length || Math.max(...waveform) <= 20) {
      const extracted = await extractWaveformFromBlob(blob);
      if (extracted?.length) waveform = extracted;
    }
    if (!waveform.length) waveform = defaultWaveform(`${durationMs}:${blob.size}`);

    const data = {
      roomId: rec.roomId,
      deviceId: rec.deviceId,
      form: rec.form,
      blob,
      mimeType: rec.mimeType,
      duration: Math.min(MAX_RECORDING_MS, durationMs) / 1000,
      waveform
    };

    if (rec.finalAction === 'preview') {
      showPreview(data);
      return;
    }

    const sent = await dispatchReadyVoice177(data);
    if (!sent) {
      showPreview(data);
      alert('Не удалось отправить голосовое сообщение. Запись сохранена в предпросмотре — можно повторить отправку.');
    }
  }

  function showPreview(data) {
    clearPreview(false);
    previewState = { ...data, url: URL.createObjectURL(data.blob), audio: null, seekRatio: 0, playing: false };
    const form = data.form;
    form.classList.add('fp-voice-previewing');
    const bar = form.querySelector('.fp-voice-preview-bar');
    bar?.classList.remove('hidden');
    setPlayIcon(bar?.querySelector('.fp-voice-preview-play'), 'play');
    const time = bar?.querySelector('.fp-voice-preview-time');
    if (time) time.textContent = `0:00 / ${formatDuration(data.duration)}`;
    drawWaveform(bar?.querySelector('.fp-voice-preview-waveform'), data.waveform, 0);
    syncComposer(form);
  }

  function renderPreviewProgress(current = 0) {
    if (!previewState) return;
    const bar = previewState.form?.querySelector('.fp-voice-preview-bar');
    if (!bar) return;
    const duration = Number(previewState.audio?.duration || previewState.duration || 0) || 0;
    const safeCurrent = Math.max(0, Math.min(duration || Infinity, Number(current) || 0));
    const time = bar.querySelector('.fp-voice-preview-time');
    if (time) time.textContent = `${formatDuration(safeCurrent)} / ${formatDuration(duration)}`;
    drawWaveform(bar.querySelector('.fp-voice-preview-waveform'), previewState.waveform, duration > 0 ? safeCurrent / duration : 0);
  }

  function clearPreview(sync = true) {
    const preview = previewState;
    if (!preview) return;
    try { preview.audio?.pause?.(); } catch {}
    try { URL.revokeObjectURL(preview.url); } catch {}
    const form = preview.form;
    form?.classList.remove('fp-voice-previewing', 'fp-voice-preview-sending');
    form?.querySelector('.fp-voice-preview-bar')?.classList.add('hidden');
    previewState = null;
    if (sync) syncComposer(form);
  }

  async function togglePreviewPlayback() {
    const preview = previewState;
    if (!preview) return;
    const bar = preview.form?.querySelector('.fp-voice-preview-bar');
    const button = bar?.querySelector('.fp-voice-preview-play');
    if (!bar || !button) return;
    if (!preview.audio) {
      const audio = new Audio(preview.url);
      audio.preload = 'metadata';
      audio.playbackRate = playbackSpeed();
      preview.audio = audio;
      audio.addEventListener('loadedmetadata', () => {
        if (previewState !== preview) return;
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : preview.duration;
        preview.duration = duration;
        if (preview.seekRatio > 0) {
          try { audio.currentTime = preview.seekRatio * duration; } catch {}
        }
        renderPreviewProgress(audio.currentTime);
      });
      audio.addEventListener('timeupdate', () => { if (previewState === preview) renderPreviewProgress(audio.currentTime); });
      audio.addEventListener('play', () => { if (previewState === preview) setPlayIcon(button, 'pause'); });
      audio.addEventListener('pause', () => { if (previewState === preview) setPlayIcon(button, 'play'); });
      audio.addEventListener('ended', () => {
        if (previewState !== preview) return;
        preview.seekRatio = 0;
        renderPreviewProgress(0);
        setPlayIcon(button, 'play');
      });
    }
    if (preview.audio.paused) {
      preview.audio.playbackRate = playbackSpeed();
      try { await preview.audio.play(); } catch {}
    } else preview.audio.pause();
  }

  async function sendPreview() {
    const preview = previewState;
    if (!preview || uploadInFlight) return;
    try { preview.audio?.pause?.(); } catch {}
    preview.form?.classList.add('fp-voice-preview-sending');
    const sent = await dispatchReadyVoice177(preview);
    preview.form?.classList.remove('fp-voice-preview-sending');
    if (sent && previewState === preview) clearPreview(true);
    else if (!sent) alert('Не удалось отправить голосовое сообщение. Запись осталась в предпросмотре.');
  }

  function handleVisibilityLoss() {
    if (recordingState) stopRecording('cancel');
    if (pendingPress) {
      pendingPress.cancelled = true;
      pendingPress.released = true;
      pendingPress = null;
    }
    if (localActivity?.activity === 'recording_audio') stopLocalActivity('recording_audio');
  }

  window.FPLifecycle170?.subscribe(event => {
    if (['background','pagehide','beforeunload'].includes(event.lastType)) handleVisibilityLoss();
    if (event.lastType === 'pagehide') {stopActivePlayback(false);clearVoiceBlobCache();}
  });

  async function refreshVoiceSnapshot(roomId) {
    const deviceId = roomDeviceId(roomId);
    if (!roomId || !deviceId) return;
    const context = window.FPRoomContext170?.current?.();
    try {
      const query = new URLSearchParams({ deviceId, limit: '100' });
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages?${query.toString()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      for (const message of data?.messages || []) {
        if (currentRoomId() !== roomId || lastRoomId !== roomId || (context && !window.FPRoomContext170.isCurrent(context))) return;
        if (!isVoiceMessage(message)) continue;
        registerVoiceMessage(message);
        decorateVoiceMessage(message.id);
      }
    } catch {}
  }

  function handleRoomChange173(roomId = currentRoomId()) {
    const nextRoomId = String(roomId || '');
    ensureComposer();
    if (nextRoomId === lastRoomId) return;
    stopActivePlayback(false);
    clearVoiceBlobCache();
    voiceMessages.clear();
    voiceMetaCache.clear();
    if (recordingState && recordingState.roomId !== nextRoomId) stopRecording('cancel');
    if (previewState && previewState.roomId !== nextRoomId) clearPreview(false);
    lastRoomId = nextRoomId;
    if (nextRoomId) void refreshVoiceSnapshot(nextRoomId);
  }

  if (window.FPDOM173?.on) {
    window.FPDOM173.on('composer', 'mounted', () => ensureComposer());
    window.FPDOM173.on('message', 'mounted', ({ node }) => {
      const messageId = String(node?.dataset?.messageId || node?.dataset?.id || '');
      if (messageId) decorateVoiceMessage(messageId);
    });
    window.FPDOM173.on('chat', 'mounted', () => handleRoomChange173());
    window.FPDOM173.on('chat', 'unmounted', () => queueMicrotask(() => handleRoomChange173()));
    window.addEventListener('fpchat:room-open170', (event) => {
      const stage = String(event?.detail?.stage || '');
      if (stage === 'ready' || stage === 'committed-direct') handleRoomChange173(event.detail.roomId || currentRoomId());
      if (stage === 'left') handleRoomChange173('');
    }, { passive: true });
  } else {
    // Compatibility fallback only if the Build 173 DOM lifecycle owner failed.
    const observer = new MutationObserver((records) => {
      let composerChanged = false;
      let messagesChanged = false;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.id === 'sendForm' || node.querySelector?.('#sendForm')) composerChanged = true;
          if (node.matches?.('.bubble-wrap.msg') || node.querySelector?.('.bubble-wrap.msg')) messagesChanged = true;
        }
      }
      if (composerChanged) ensureComposer();
      if (messagesChanged) {
        for (const messageId of voiceMessages.keys()) decorateVoiceMessage(messageId);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(() => handleRoomChange173(), 500);
  }

  window.addEventListener('resize', () => {
    for (const [messageId] of voiceMessages) {
      const root = findMessageElement(messageId)?.querySelector('.fp-voice-player');
      if (root) renderPlayerProgress(root, activePlayback?.messageId === String(messageId) ? activePlayback.audio.currentTime : Number(root.dataset.pendingSeek || 0) * Number(root.dataset.duration || 0), activePlayback?.messageId === String(messageId) ? activePlayback.duration : null);
    }
    if (recordingState) drawLiveRecordingWave(recordingState);
    if (previewState) renderPreviewProgress(previewState.audio?.currentTime || previewState.seekRatio * previewState.duration);
  });

  ensureComposer();
  lastRoomId = currentRoomId();
  if (lastRoomId) void refreshVoiceSnapshot(lastRoomId);

  window.FPVoice = {
    // Build 175: programmatic text changes use the same UI owner as native input.
    // Do not dispatch synthetic input: that would also run typing/draft handlers.
    syncComposer: (form = document.getElementById('sendForm')) => syncComposer(form),
    cancelRecording: () => stopRecording('cancel'),
    stopPlayback: () => stopActivePlayback(false),
    clearPreview: () => clearPreview(true),
    clearBlobCache: () => clearVoiceBlobCache(),
    memorySnapshot: () => ({
      blobCacheEntries: voiceBlobCache.size,
      messageEntries: voiceMessages.size,
      metaEntries: voiceMetaCache.size,
      blobCacheLimit: VOICE_BLOB_CACHE_LIMIT
    })
  };
})();
