/* Build 127: isolated voice-message integration for the existing pins UI. */
(() => {
  if (window.__fpVoicePins127Installed) return;
  window.__fpVoicePins127Installed = true;

  const SPEED_KEY = 'fpchat:voice-speed';
  const SPEEDS = [1, 1.5, 2];
  const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6.8v10.4c0 .8.9 1.2 1.5.8l8-5.2a1 1 0 0 0 0-1.6l-8-5.2c-.6-.4-1.5 0-1.5.8Z"/></svg>';
  const PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7v10M16 7v10"/></svg>';

  const pinMap = new Map();
  const waveformCache = new Map();
  const blobCache = new Map();
  const positions = new Map();
  let cacheRoomId = '';
  let lastFetchAt = 0;
  let fetchTask = null;
  let refreshRaf = 0;
  let active = null;

  function roomId() {
    try { return String(state?.roomId || ''); } catch { return ''; }
  }

  function roomDevice(id = roomId()) {
    if (!id) return '';
    try { return String(STORAGE.get(STORAGE.roomState(id))?.deviceId || '').trim(); } catch { return ''; }
  }

  function numericId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function isVoicePin(pin) {
    const media = Array.isArray(pin?.message?.media) ? pin.message.media : [];
    return pin?.message?.type === 'media' && media.length === 1 && String(media[0]?.media_kind || '') === 'audio';
  }

  function voiceMedia(pin) {
    return isVoicePin(pin) ? pin.message.media[0] : null;
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function speed() {
    const value = Number(localStorage.getItem(SPEED_KEY) || 1);
    return SPEEDS.includes(value) ? value : 1;
  }

  function speedLabel(value = speed()) {
    return `${Number(value || 1)}×`;
  }

  function setSpeed(value) {
    const next = SPEEDS.includes(Number(value)) ? Number(value) : 1;
    try { localStorage.setItem(SPEED_KEY, String(next)); } catch {}
    document.querySelectorAll('.fp-pins127-speed').forEach((el) => { el.textContent = speedLabel(next); });
    if (active?.audio) active.audio.playbackRate = next;
    return next;
  }

  function cycleSpeed() {
    const current = speed();
    return setSpeed(SPEEDS[(SPEEDS.indexOf(current) + 1) % SPEEDS.length]);
  }

  function pinKey(messageId) {
    return `${roomId()}:${messageId}`;
  }

  async function fetchPins(force = false) {
    const id = roomId();
    const deviceId = roomDevice(id);
    if (!id || !deviceId) return pinMap;
    if (id !== cacheRoomId) {
      stopPlayback(false);
      cacheRoomId = id;
      pinMap.clear();
      lastFetchAt = 0;
    }
    if (!force && Date.now() - lastFetchAt < 700 && pinMap.size) return pinMap;
    if (fetchTask) return fetchTask;
    fetchTask = (async () => {
      try {
        const query = new URLSearchParams({ deviceId });
        const response = await fetch(`/api/rooms/${encodeURIComponent(id)}/pins?${query.toString()}`, { cache: 'no-store' });
        if (!response.ok) return pinMap;
        const data = await response.json().catch(() => null);
        if (!data?.ok || !Array.isArray(data.pins)) return pinMap;
        pinMap.clear();
        for (const pin of data.pins) {
          const messageId = numericId(pin?.messageId || pin?.message?.id);
          if (messageId) pinMap.set(String(messageId), pin);
        }
        lastFetchAt = Date.now();
      } catch {}
      return pinMap;
    })().finally(() => { fetchTask = null; });
    return fetchTask;
  }

  function seededWaveform(seed) {
    let hash = 2166136261;
    for (const ch of String(seed || 'voice')) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
    const out = [];
    for (let i = 0; i < 48; i += 1) {
      hash ^= hash << 13; hash ^= hash >>> 17; hash ^= hash << 5; hash >>>= 0;
      out.push(35 + (hash % 180));
    }
    return out;
  }

  function resample(values, count) {
    const source = Array.isArray(values) && values.length ? values : [64];
    if (count <= 1) return [source[0]];
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const pos = (i / Math.max(1, count - 1)) * Math.max(0, source.length - 1);
      const left = Math.floor(pos);
      const right = Math.min(source.length - 1, left + 1);
      const t = pos - left;
      out.push((Number(source[left]) || 0) * (1 - t) + (Number(source[right]) || 0) * t);
    }
    return out;
  }

  function drawWave(canvas, waveform, progress = 0) {
    if (!canvas?.isConnected) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const style = getComputedStyle(canvas);
    const activeColor = style.getPropertyValue('--accent').trim() || '#3390ec';
    const idleColor = 'rgba(148,163,184,.35)';
    const barW = 2 * dpr;
    const gap = 1.7 * dpr;
    const count = Math.max(14, Math.min(52, Math.floor(width / (barW + gap))));
    const samples = resample(waveform, count);
    const used = count * barW + Math.max(0, count - 1) * gap;
    let x = Math.max(0, (width - used) / 2);
    const played = Math.round(Math.max(0, Math.min(1, Number(progress) || 0)) * count);
    for (let i = 0; i < count; i += 1) {
      const normalized = Math.max(.13, Math.min(1, (Number(samples[i]) || 0) / 255));
      const h = Math.max(3 * dpr, normalized * height * .86);
      const y = (height - h) / 2;
      ctx.fillStyle = i < played ? activeColor : idleColor;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, barW, h, Math.min(barW / 2, 2 * dpr));
      else ctx.rect(x, y, barW, h);
      ctx.fill();
      x += barW + gap;
    }
  }

  async function decryptWaveform(id, ciphertext, iv) {
    if (!ciphertext || !iv || typeof getRoomKey !== 'function' || typeof b64 === 'undefined') return null;
    try {
      const key = await getRoomKey(id);
      if (!key) return null;
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.decode(iv) }, key, b64.decode(ciphertext));
      const parsed = JSON.parse(new TextDecoder().decode(plain));
      const waveform = Array.isArray(parsed?.waveform)
        ? parsed.waveform.slice(0, 64).map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))))
        : [];
      return waveform.length ? waveform : null;
    } catch { return null; }
  }

  async function loadWaveform(pin) {
    const media = voiceMedia(pin);
    const publicId = String(media?.public_id || '');
    if (!publicId) return seededWaveform(pin?.messageId);
    if (waveformCache.has(publicId)) return await waveformCache.get(publicId);
    const task = (async () => {
      const id = roomId();
      const deviceId = roomDevice(id);
      if (!id || !deviceId) return seededWaveform(pin?.messageId);
      try {
        const response = await fetch(`/api/media/${encodeURIComponent(publicId)}/voice-meta?deviceId=${encodeURIComponent(deviceId)}`, { cache: 'no-store' });
        if (!response.ok) return seededWaveform(pin?.messageId);
        const data = await response.json().catch(() => null);
        return await decryptWaveform(id, data?.meta?.ciphertext, data?.meta?.iv) || seededWaveform(pin?.messageId);
      } catch { return seededWaveform(pin?.messageId); }
    })();
    waveformCache.set(publicId, task);
    return await task;
  }

  async function loadBlob(pin) {
    const media = voiceMedia(pin);
    const publicId = String(media?.public_id || '');
    if (!publicId || typeof decryptBlobWithIvPrefix !== 'function') throw new Error('voice unavailable');
    if (blobCache.has(publicId)) return await blobCache.get(publicId);
    const task = (async () => {
      const id = roomId();
      const deviceId = roomDevice(id);
      if (!id || !deviceId) throw new Error('room unavailable');
      const response = await fetch(`/api/media/${encodeURIComponent(publicId)}/blob?deviceId=${encodeURIComponent(deviceId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('voice load failed');
      return await decryptBlobWithIvPrefix(await response.blob(), media.mime_type || 'audio/webm');
    })();
    blobCache.set(publicId, task);
    try { return await task; }
    catch (error) { blobCache.delete(publicId); throw error; }
  }

  function setPlayState(root, mode = 'play') {
    const button = root?.querySelector('.fp-pins127-play');
    if (!button) return;
    button.classList.toggle('is-loading', mode === 'loading');
    button.classList.toggle('is-play', mode === 'play');
    button.innerHTML = mode === 'loading' ? '' : (mode === 'pause' ? PAUSE_SVG : PLAY_SVG);
    button.setAttribute('aria-label', mode === 'pause' ? 'Пауза' : mode === 'loading' ? 'Загрузка голосового' : 'Воспроизвести голосовое');
  }

  function renderProgress(root, pin, current = 0, durationOverride = null) {
    if (!root) return;
    const media = voiceMedia(pin);
    const duration = Math.max(0, Number(durationOverride ?? root.dataset.duration ?? media?.duration_seconds ?? 0) || 0);
    const safe = Math.max(0, Math.min(duration || Infinity, Number(current) || 0));
    root.dataset.duration = String(duration);
    const time = root.querySelector('.fp-pins127-time');
    if (time) time.textContent = `${formatDuration(safe)} / ${formatDuration(duration)}`;
    const waveform = root.__fpWaveform127 || seededWaveform(pin?.messageId);
    drawWave(root.querySelector('.fp-pins127-wave'), waveform, duration > 0 ? safe / duration : 0);
  }

  function stopPlayback(reset = false) {
    const current = active;
    if (!current) return;
    try { current.audio.pause(); } catch {}
    const duration = Number(current.duration || current.audio?.duration || 0) || 0;
    const now = Number(current.audio?.currentTime || 0) || 0;
    if (duration > 0 && now > .05 && now < duration - .25) positions.set(pinKey(current.messageId), now / duration);
    if (reset) positions.delete(pinKey(current.messageId));
    if (current.root?.isConnected) {
      current.root.dataset.pendingSeek = reset ? '0' : String(positions.get(pinKey(current.messageId)) || 0);
      setPlayState(current.root, 'play');
      renderProgress(current.root, current.pin, reset ? 0 : now, duration);
    }
    try { URL.revokeObjectURL(current.url); } catch {}
    active = null;
  }

  async function togglePlayback(root, pin) {
    const messageId = String(pin?.messageId || pin?.message?.id || '');
    if (!messageId || !root) return;
    if (active?.messageId === messageId) {
      if (active.audio.paused) {
        try { active.audio.playbackRate = speed(); await active.audio.play(); setPlayState(root, 'pause'); } catch {}
      } else {
        active.audio.pause();
        setPlayState(root, 'play');
      }
      return;
    }

    stopPlayback(false);
    try { window.FPVoice?.stopPlayback?.(); } catch {}
    setPlayState(root, 'loading');
    try {
      const blob = await loadBlob(pin);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.preload = 'metadata';
      audio.playbackRate = speed();
      const declared = Math.max(0, Number(voiceMedia(pin)?.duration_seconds || root.dataset.duration || 0) || 0);
      const playback = { messageId, pin, root, audio, url, duration: declared };
      active = playback;

      audio.addEventListener('loadedmetadata', () => {
        if (active !== playback) return;
        const actual = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : declared;
        playback.duration = actual;
        root.dataset.duration = String(actual);
        const ratio = Math.max(0, Math.min(1, Number(root.dataset.pendingSeek || positions.get(pinKey(messageId)) || 0)));
        if (ratio > 0) { try { audio.currentTime = ratio * actual; } catch {} }
        renderProgress(root, pin, audio.currentTime, actual);
      });
      audio.addEventListener('timeupdate', () => {
        if (active !== playback) return;
        const duration = playback.duration || audio.duration || declared;
        if (duration > 0) positions.set(pinKey(messageId), Math.max(0, Math.min(1, audio.currentTime / duration)));
        renderProgress(root, pin, audio.currentTime, duration);
      });
      audio.addEventListener('play', () => {
        if (active === playback) setPlayState(root, 'pause');
      });
      audio.addEventListener('pause', () => {
        if (active === playback) setPlayState(root, 'play');
      });
      audio.addEventListener('ended', () => {
        if (active !== playback) return;
        positions.delete(pinKey(messageId));
        root.dataset.pendingSeek = '0';
        renderProgress(root, pin, 0, playback.duration || audio.duration || declared);
        setPlayState(root, 'play');
        try { URL.revokeObjectURL(url); } catch {}
        active = null;
      });
      audio.addEventListener('error', () => {
        if (active === playback) active = null;
        setPlayState(root, 'play');
        try { URL.revokeObjectURL(url); } catch {}
      });

      const ratio = Math.max(0, Math.min(1, Number(root.dataset.pendingSeek || positions.get(pinKey(messageId)) || 0)));
      if (ratio > 0 && declared > 0) { try { audio.currentTime = ratio * declared; } catch {} }
      await audio.play();
      setPlayState(root, 'pause');
      renderProgress(root, pin, audio.currentTime, playback.duration || declared);
    } catch {
      if (active?.messageId === messageId) active = null;
      setPlayState(root, 'play');
      alert('Не удалось загрузить голосовое сообщение.');
    }
  }

  function bindSeek(canvas, root, pin) {
    let dragging = false;
    const seek = (event) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const duration = Math.max(0, Number(root.dataset.duration || voiceMedia(pin)?.duration_seconds || 0) || 0);
      root.dataset.pendingSeek = String(ratio);
      positions.set(pinKey(pin.messageId), ratio);
      if (active?.messageId === String(pin.messageId)) {
        try { active.audio.currentTime = ratio * (active.duration || duration); } catch {}
      }
      renderProgress(root, pin, ratio * duration, duration);
    };
    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault(); event.stopPropagation(); dragging = true;
      try { canvas.setPointerCapture?.(event.pointerId); } catch {}
      seek(event);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      event.preventDefault(); event.stopPropagation(); seek(event);
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false; event.preventDefault(); event.stopPropagation(); seek(event);
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', () => { dragging = false; });
  }

  function stopCardGesture(event) {
    event.stopPropagation();
  }

  function bindActivator(el, handler) {
    el.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); handler(); });
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); event.stopPropagation(); handler();
    });
  }

  function decorateCard(card, pin) {
    const media = voiceMedia(pin);
    const publicId = String(media?.public_id || '');
    if (!card || !publicId) return;
    if (card.dataset.fpPinsVoice127 === publicId) {
      const root = card.querySelector('.fp-pins127-player');
      if (root) renderProgress(root, pin, Number(root.dataset.pendingSeek || 0) * Number(root.dataset.duration || 0));
      return;
    }
    card.dataset.fpPinsVoice127 = publicId;
    card.classList.add('fp-pins127-card');
    const content = card.querySelector('.fp-pins114-content');
    if (!content) return;
    content.querySelector('.fp-pins114-thumb')?.remove();
    const text = content.querySelector('.fp-pins114-text');
    if (text) text.textContent = 'Голосовое сообщение';

    const duration = Math.max(0, Number(media.duration_seconds || 0) || 0);
    const root = document.createElement('span');
    root.className = 'fp-pins127-player';
    root.dataset.messageId = String(pin.messageId);
    root.dataset.duration = String(duration);
    root.dataset.pendingSeek = String(positions.get(pinKey(pin.messageId)) || 0);
    root.innerHTML = `<span class="fp-pins127-play is-play" role="button" tabindex="0" aria-label="Воспроизвести голосовое">${PLAY_SVG}</span><span class="fp-pins127-main"><canvas class="fp-pins127-wave" aria-label="Перемотка голосового"></canvas><span class="fp-pins127-footer"><span class="fp-pins127-time">0:00 / ${formatDuration(duration)}</span><span class="fp-pins127-speed" role="button" tabindex="0">${speedLabel()}</span></span></span>`;
    content.prepend(root);

    ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'contextmenu'].forEach((type) => root.addEventListener(type, stopCardGesture, { passive: type !== 'contextmenu' }));
    root.addEventListener('pointerdown', stopCardGesture);
    root.addEventListener('pointerup', stopCardGesture);
    root.addEventListener('click', stopCardGesture);

    bindActivator(root.querySelector('.fp-pins127-play'), () => void togglePlayback(root, pin));
    bindActivator(root.querySelector('.fp-pins127-speed'), () => cycleSpeed());
    bindSeek(root.querySelector('.fp-pins127-wave'), root, pin);

    const initialRatio = Number(root.dataset.pendingSeek || 0);
    renderProgress(root, pin, initialRatio * duration, duration);
    void loadWaveform(pin).then((waveform) => {
      if (!root.isConnected) return;
      root.__fpWaveform127 = waveform;
      const current = active?.messageId === String(pin.messageId) ? active.audio.currentTime : Number(root.dataset.pendingSeek || 0) * Number(root.dataset.duration || duration);
      renderProgress(root, pin, current, active?.messageId === String(pin.messageId) ? active.duration : duration);
    });
  }

  function decorateTopBar() {
    const bar = document.querySelector('.chat-pin-bar');
    if (!bar) return;
    const messageId = String(bar.dataset.messageId || '');
    const pin = pinMap.get(messageId);
    if (!isVoicePin(pin)) {
      bar.classList.remove('fp-pin-voice127');
      return;
    }
    const duration = Number(voiceMedia(pin)?.duration_seconds || 0) || 0;
    const preview = bar.querySelector('.chat-pin-preview');
    const text = `Голосовое сообщение · ${formatDuration(duration)}`;
    if (preview && preview.textContent !== text) preview.textContent = text;
    bar.classList.add('fp-pin-voice127');
  }

  function decorateScreenCards() {
    document.querySelectorAll('.fp-pins114-card[data-message-id]').forEach((card) => {
      const pin = pinMap.get(String(card.dataset.messageId || ''));
      if (isVoicePin(pin)) decorateCard(card, pin);
    });
  }

  async function refreshUi(force = false) {
    if (!document.querySelector('.chat-pin-bar,.fp-pins114-screen')) {
      if (active?.root && !active.root.isConnected) stopPlayback(false);
      return;
    }
    await fetchPins(force);
    const topId = String(document.querySelector('.chat-pin-bar')?.dataset?.messageId || '');
    const unknownCard = [...document.querySelectorAll('.fp-pins114-card[data-message-id]')]
      .some((card) => !pinMap.has(String(card.dataset.messageId || '')));
    if ((topId && !pinMap.has(topId)) || unknownCard) await fetchPins(true);
    decorateTopBar();
    decorateScreenCards();
    if (active?.root && !active.root.isConnected) stopPlayback(false);
  }

  function scheduleRefresh(force = false) {
    if (force) lastFetchAt = 0;
    if (refreshRaf) return;
    refreshRaf = requestAnimationFrame(() => {
      refreshRaf = 0;
      void refreshUi(force);
    });
  }

  const observer = new MutationObserver((records) => {
    let force = false;
    for (const record of records) {
      if (record.type === 'attributes' && record.attributeName === 'data-message-id') force = true;
      for (const node of record.addedNodes || []) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('.chat-pin-bar,.fp-pins114-card,.fp-pins114-screen') || node.querySelector?.('.chat-pin-bar,.fp-pins114-card,.fp-pins114-screen')) force = true;
      }
    }
    scheduleRefresh(force);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-message-id'] });

  window.addEventListener('resize', () => {
    document.querySelectorAll('.fp-pins127-player').forEach((root) => {
      const pin = pinMap.get(String(root.dataset.messageId || ''));
      if (!pin) return;
      const current = active?.messageId === String(pin.messageId) ? active.audio.currentTime : Number(root.dataset.pendingSeek || 0) * Number(root.dataset.duration || 0);
      renderProgress(root, pin, current, active?.messageId === String(pin.messageId) ? active.duration : null);
    });
  });

  scheduleRefresh(true);
})();
