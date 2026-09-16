/* Build 167: managed encrypted-media cache and Data & Storage UI.
   Existing chat, send, media upload/decrypt and navigation mechanics stay untouched. */
(() => {
  if (window.__fpStorage167Installed) return;
  window.__fpStorage167Installed = true;

  const CACHE_NAME = 'fpchat-media-v167';
  const META_KEY = 'fpchat:storage:cache-meta167';
  const RETENTION_KEY = 'fpchat:storage:retention-days167';
  const AUTOLOAD_KEY = 'fpchat:storage:autoload167';
  const RETENTION_VALUES = new Set([0, 3, 7, 30]);
  const DEFAULT_AUTOLOAD = Object.freeze({ image: true, video: true, audio: true, file: false });
  const mediaIndex = new Map();
  const prefetchQueue = [];
  const prefetchQueued = new Set();
  let activePrefetch = 0;
  let activeStorageRoot = null;
  const PREFETCH_CONCURRENCY = 2;

  const baseFetch = window.fetch.bind(window);

  function cacheSupported() {
    return typeof window.caches !== 'undefined' && typeof window.caches.open === 'function';
  }

  function safeJsonRead(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function safeJsonWrite(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function normalizeKind(value) {
    const kind = String(value || '').toLowerCase();
    if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'file') return kind;
    return 'file';
  }

  function getAutoload() {
    const stored = safeJsonRead(AUTOLOAD_KEY, {});
    return {
      image: stored.image !== undefined ? stored.image !== false : DEFAULT_AUTOLOAD.image,
      video: stored.video !== undefined ? stored.video !== false : DEFAULT_AUTOLOAD.video,
      audio: stored.audio !== undefined ? stored.audio !== false : DEFAULT_AUTOLOAD.audio,
      file: stored.file !== undefined ? stored.file !== false : DEFAULT_AUTOLOAD.file
    };
  }

  function setAutoload(kind, enabled) {
    const key = normalizeKind(kind);
    const next = getAutoload();
    next[key] = Boolean(enabled);
    safeJsonWrite(AUTOLOAD_KEY, next);
    window.dispatchEvent(new CustomEvent('fpchat:storage-settings-changed', { detail: { autoload: next } }));
    return next;
  }

  function getRetentionDays() {
    const value = Number(localStorage.getItem(RETENTION_KEY));
    return RETENTION_VALUES.has(value) ? value : 0;
  }

  async function setRetentionDays(value) {
    const days = Number(value);
    const safe = RETENTION_VALUES.has(days) ? days : 0;
    try { localStorage.setItem(RETENTION_KEY, String(safe)); } catch {}
    await cleanupExpired();
    window.dispatchEvent(new CustomEvent('fpchat:storage-settings-changed', { detail: { retentionDays: safe } }));
    return safe;
  }

  function rememberMediaList(list) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const publicId = String(item?.public_id || '').trim();
      if (!publicId) continue;
      mediaIndex.set(publicId, {
        kind: normalizeKind(item?.media_kind),
        bytes: Math.max(0, Number(item?.encrypted_size_bytes || item?.size_bytes || 0) || 0),
        thumbBytes: Math.max(0, Number(item?.thumb_encrypted_size_bytes || item?.thumb_size_bytes || 0) || 0)
      });
    }
  }

  function requestInfo(input, init) {
    try {
      const raw = typeof input === 'string' ? input : String(input?.url || '');
      const url = new URL(raw, window.location.href);
      const inputMethod = typeof input === 'object' && input ? input.method : '';
      const method = String(init?.method || inputMethod || 'GET').toUpperCase();
      if (method !== 'GET' || url.origin !== window.location.origin) return null;
      const match = url.pathname.match(/^\/api\/media\/([^/]+)\/(blob|thumb)$/);
      if (!match) return null;
      return {
        url: url.href,
        publicId: decodeURIComponent(match[1]),
        endpoint: match[2],
        request: new Request(url.href, { method: 'GET', credentials: 'same-origin' })
      };
    } catch {
      return null;
    }
  }

  function metaMap() {
    return safeJsonRead(META_KEY, {});
  }

  function isExpired(meta) {
    const days = getRetentionDays();
    if (!days) return false;
    const cachedAt = Number(meta?.cachedAt || 0);
    return cachedAt > 0 && Date.now() - cachedAt >= days * 86400000;
  }

  async function storeResponse(info, response) {
    if (!cacheSupported() || !info || !response?.ok) return;
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(info.request, response.clone());
      const indexed = mediaIndex.get(info.publicId) || {};
      const headerBytes = Number(response.headers.get('content-length') || 0);
      const fallbackBytes = info.endpoint === 'thumb' ? indexed.thumbBytes : indexed.bytes;
      const meta = metaMap();
      meta[info.url] = {
        publicId: info.publicId,
        endpoint: info.endpoint,
        kind: normalizeKind(indexed.kind),
        bytes: Math.max(0, headerBytes || fallbackBytes || 0),
        cachedAt: Date.now()
      };
      safeJsonWrite(META_KEY, meta);
      window.dispatchEvent(new CustomEvent('fpchat:storage-changed'));
    } catch {}
  }

  window.fetch = async function fpStorage167Fetch(input, init) {
    const info = requestInfo(input, init);
    if (!info || !cacheSupported()) return baseFetch(input, init);

    try {
      const cache = await caches.open(CACHE_NAME);
      const meta = metaMap()[info.url];
      if (isExpired(meta)) {
        await cache.delete(info.request);
        const all = metaMap();
        delete all[info.url];
        safeJsonWrite(META_KEY, all);
      } else {
        const cached = await cache.match(info.request);
        if (cached) return cached;
      }
    } catch {}

    const response = await baseFetch(input, init);
    if (response?.ok) void storeResponse(info, response);
    return response;
  };
  window.fetch.__fpStorage167 = true;

  async function listEntries() {
    if (!cacheSupported()) return [];
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    const meta = metaMap();
    const entries = [];
    const alive = new Set();

    for (const request of requests) {
      const url = request.url;
      alive.add(url);
      const info = requestInfo(url);
      const saved = meta[url] || {};
      const indexed = info ? mediaIndex.get(info.publicId) : null;
      let bytes = Math.max(0, Number(saved.bytes || 0) || 0);
      if (!bytes) {
        try {
          const response = await cache.match(request);
          bytes = Math.max(0, Number(response?.headers?.get('content-length') || 0) || 0);
        } catch {}
      }
      entries.push({
        request,
        url,
        publicId: String(saved.publicId || info?.publicId || ''),
        endpoint: String(saved.endpoint || info?.endpoint || ''),
        kind: normalizeKind(saved.kind || indexed?.kind),
        bytes,
        cachedAt: Math.max(0, Number(saved.cachedAt || 0) || 0)
      });
    }

    let changed = false;
    for (const key of Object.keys(meta)) {
      if (!alive.has(key)) {
        delete meta[key];
        changed = true;
      }
    }
    if (changed) safeJsonWrite(META_KEY, meta);
    return entries;
  }

  async function getStats() {
    const entries = await listEntries();
    const categories = {
      image: { bytes: 0, count: 0 },
      video: { bytes: 0, count: 0 },
      audio: { bytes: 0, count: 0 },
      file: { bytes: 0, count: 0 }
    };
    let totalBytes = 0;
    for (const entry of entries) {
      const category = categories[entry.kind] || categories.file;
      category.bytes += entry.bytes;
      category.count += 1;
      totalBytes += entry.bytes;
    }

    let originUsage = 0;
    let quota = 0;
    try {
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        originUsage = Math.max(0, Number(estimate?.usage || 0) || 0);
        quota = Math.max(0, Number(estimate?.quota || 0) || 0);
      }
    } catch {}

    return { supported: cacheSupported(), totalBytes, categories, originUsage, quota, entryCount: entries.length };
  }

  async function clearCache(kinds, onProgress) {
    const selected = new Set((Array.isArray(kinds) ? kinds : []).map(normalizeKind));
    const entries = (await listEntries()).filter((entry) => selected.has(entry.kind));
    const cache = cacheSupported() ? await caches.open(CACHE_NAME) : null;
    const meta = metaMap();
    const weights = entries.map((entry) => Math.max(1, entry.bytes));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    let processedWeight = 0;
    let processedBytes = 0;

    const emit = (index = 0) => {
      const percent = totalWeight ? Math.min(100, Math.round(processedWeight / totalWeight * 100)) : 100;
      try { onProgress?.({ percent, processedBytes, totalBytes, processed: index, total: entries.length }); } catch {}
    };
    emit(0);

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      try { await cache?.delete(entry.request); } catch {}
      delete meta[entry.url];
      processedWeight += weights[i];
      processedBytes += entry.bytes;
      emit(i + 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    safeJsonWrite(META_KEY, meta);
    window.dispatchEvent(new CustomEvent('fpchat:storage-changed'));
    return { deleted: entries.length, bytes: processedBytes };
  }

  async function cleanupExpired() {
    const days = getRetentionDays();
    if (!days || !cacheSupported()) return { deleted: 0, bytes: 0 };
    const cutoff = Date.now() - days * 86400000;
    const entries = await listEntries();
    const expired = entries.filter((entry) => entry.cachedAt > 0 && entry.cachedAt <= cutoff);
    if (!expired.length) return { deleted: 0, bytes: 0 };
    const cache = await caches.open(CACHE_NAME);
    const meta = metaMap();
    let bytes = 0;
    for (const entry of expired) {
      try { await cache.delete(entry.request); } catch {}
      delete meta[entry.url];
      bytes += entry.bytes;
    }
    safeJsonWrite(META_KEY, meta);
    window.dispatchEvent(new CustomEvent('fpchat:storage-changed'));
    return { deleted: expired.length, bytes };
  }

  function currentRoomDeviceId() {
    try {
      const roomId = String(typeof state !== 'undefined' ? state?.roomId || '' : '');
      if (!roomId || typeof STORAGE === 'undefined') return '';
      const stored = STORAGE.get(STORAGE.roomState(roomId));
      return String(stored?.deviceId || '').trim();
    } catch {
      return '';
    }
  }

  function enqueuePrefetch(url) {
    if (!url || prefetchQueued.has(url)) return;
    prefetchQueued.add(url);
    prefetchQueue.push(url);
    pumpPrefetch();
  }

  function pumpPrefetch() {
    while (activePrefetch < PREFETCH_CONCURRENCY && prefetchQueue.length) {
      const url = prefetchQueue.shift();
      activePrefetch += 1;
      Promise.resolve()
        .then(() => window.fetch(url))
        .catch(() => null)
        .finally(() => {
          activePrefetch = Math.max(0, activePrefetch - 1);
          prefetchQueued.delete(url);
          pumpPrefetch();
        });
    }
  }

  function scheduleAutoload(message, autoScroll, mine) {
    if (mine || autoScroll === false || message?.type !== 'media' || !Array.isArray(message.media)) return;
    const deviceId = currentRoomDeviceId();
    if (!deviceId) return;
    const prefs = getAutoload();
    for (const item of message.media) {
      const publicId = String(item?.public_id || '').trim();
      const kind = normalizeKind(item?.media_kind);
      if (!publicId || prefs[kind] !== true) continue;
      const url = `/api/media/${encodeURIComponent(publicId)}/blob?deviceId=${encodeURIComponent(deviceId)}`;
      enqueuePrefetch(url);
    }
  }

  function installAppendWrapper() {
    if (typeof appendMessage !== 'function' || appendMessage.__fpStorage167) return false;
    const base = appendMessage;
    const wrapped = function fpStorage167AppendMessage(box, message, text, mine, autoScroll = true) {
      if (Array.isArray(message?.media)) rememberMediaList(message.media);
      const result = base.call(this, box, message, text, mine, autoScroll);
      scheduleAutoload(message, autoScroll, mine);
      return result;
    };
    wrapped.__fpStorage167 = true;
    appendMessage = wrapped;
    return true;
  }

  const API = Object.freeze({
    cacheName: CACHE_NAME,
    getStats,
    clearCache,
    cleanupExpired,
    getRetentionDays,
    setRetentionDays,
    getAutoload,
    setAutoload,
    rememberMediaList,
    open: renderStorage
  });
  window.FPStorage167 = API;

  let installAttempts = 0;
  const installTimer = setInterval(() => {
    installAttempts += 1;
    if (installAppendWrapper() || installAttempts >= 100) clearInterval(installTimer);
  }, 50);
  installAppendWrapper();
  setTimeout(() => void cleanupExpired(), 1200);

  const BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  const style = document.createElement('style');
  style.id = 'fp-storage167-style';
  style.textContent = `
    .fp-settings131-row[data-open="storage"] .fp-settings131-copy small{font-size:0}
    .fp-settings131-row[data-open="storage"] .fp-settings131-copy small::after{content:'Кэш и автозагрузка';font-size:13px}
    .fp-storage167-stack{display:grid;gap:12px}
    .fp-storage167-summary{padding:18px}
    .fp-storage167-summary-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px}
    .fp-storage167-summary-title{font-size:13px;color:var(--muted)}
    .fp-storage167-total{font-size:30px;line-height:1;font-weight:800;letter-spacing:-.02em}
    .fp-storage167-origin{margin-top:7px;color:var(--muted);font-size:12px;line-height:1.35}
    .fp-storage167-bar{height:8px;display:flex;overflow:hidden;border-radius:999px;background:rgba(127,145,165,.15);margin:18px 0 12px}
    .fp-storage167-bar span{display:block;height:100%;min-width:0;transition:width .2s ease}
    .fp-storage167-bar .image{background:#3390ec}.fp-storage167-bar .video{background:#8e5cf6}.fp-storage167-bar .audio{background:#34b27b}.fp-storage167-bar .file{background:#f5a623}
    .fp-storage167-categories{display:grid;gap:8px}
    .fp-storage167-category{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:10px;align-items:center;font-size:14px}
    .fp-storage167-dot{width:10px;height:10px;border-radius:50%}.fp-storage167-dot.image{background:#3390ec}.fp-storage167-dot.video{background:#8e5cf6}.fp-storage167-dot.audio{background:#34b27b}.fp-storage167-dot.file{background:#f5a623}
    .fp-storage167-category span:last-child{color:var(--muted);font-variant-numeric:tabular-nums}
    .fp-storage167-clear{width:100%;min-height:46px;margin-top:16px;border:0;border-radius:13px;background:var(--accent-soft);color:var(--accent);font:inherit;font-size:14px;font-weight:800;cursor:pointer}
    .fp-storage167-clear:disabled{opacity:.5;cursor:default}
    .fp-storage167-section-title{margin:2px 4px 7px;color:var(--muted);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
    .fp-storage167-settings-card{padding:0!important}
    .fp-storage167-setting-row{min-height:64px;padding:11px 15px;box-sizing:border-box;display:flex!important;align-items:center;gap:14px;margin:0!important;border-bottom:1px solid var(--s-border);font-size:inherit!important;font-weight:400!important}
    .fp-storage167-setting-row:last-child{border-bottom:0}.fp-storage167-setting-copy{flex:1;min-width:0}.fp-storage167-setting-copy b{display:block;font-size:15px;line-height:1.25}.fp-storage167-setting-copy small{display:block;margin-top:3px;color:var(--muted);font-size:12px;line-height:1.3}
    .fp-storage167-select{max-width:170px;border:1px solid var(--s-border);border-radius:10px;background:var(--panel);color:inherit;padding:8px 30px 8px 10px;font:inherit;font-size:13px}
    .fp-storage167-note{padding:0 4px;color:var(--muted);font-size:12px;line-height:1.45}
    .fp-storage167-picker{padding:0!important}
    .fp-storage167-pick{min-height:60px;padding:10px 15px;display:grid!important;grid-template-columns:24px minmax(0,1fr) auto;gap:10px;align-items:center;margin:0!important;border-bottom:1px solid var(--s-border);font:inherit!important;font-weight:400!important}
    .fp-storage167-pick:last-child{border-bottom:0}.fp-storage167-pick input{width:19px;height:19px;margin:0;accent-color:var(--accent)}.fp-storage167-pick b{font-size:15px}.fp-storage167-pick>span:last-child{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
    .fp-storage167-action{width:100%;min-height:48px;border:0;border-radius:14px;background:var(--accent);color:#fff;font:inherit;font-size:15px;font-weight:800;cursor:pointer}.fp-storage167-action:disabled{opacity:.48;cursor:default}
    .fp-storage167-progress-card{min-height:420px;padding:28px 20px!important;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
    .fp-storage167-broom{width:94px;height:94px;border-radius:30px;display:grid;place-items:center;background:var(--accent-soft);font-size:48px;animation:fpStorage167Broom 1.1s ease-in-out infinite alternate}
    @keyframes fpStorage167Broom{from{transform:rotate(-4deg) translateY(1px)}to{transform:rotate(5deg) translateY(-2px)}}
    .fp-storage167-percent{margin-top:24px;font-size:32px;font-weight:850;font-variant-numeric:tabular-nums}.fp-storage167-progress-text{max-width:440px;margin-top:10px;color:var(--muted);font-size:14px;line-height:1.4}
    .fp-storage167-progress{width:min(460px,100%);height:8px;margin-top:28px;border-radius:999px;overflow:hidden;background:rgba(127,145,165,.18)}.fp-storage167-progress>span{display:block;width:0;height:100%;border-radius:inherit;background:var(--accent);transition:width .12s linear}
    .fp-storage167-done .fp-storage167-broom{animation:none}.fp-storage167-error{color:var(--danger)}
    .fp-storage167-disabled-back{visibility:hidden;pointer-events:none}
    @media(max-width:700px){.fp-storage167-total{font-size:27px}.fp-storage167-progress-card{min-height:55dvh}.fp-storage167-select{max-width:145px}}
  `;
  document.head.appendChild(style);

  function escapeHtml167(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value || 0) || 0);
    if (bytes < 1024) return `${Math.round(bytes)} Б`;
    const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
    let amount = bytes / 1024;
    let index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
    const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
    return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: digits })} ${units[index]}`;
  }

  const categoryDefs = [
    { key: 'image', label: 'Изображения' },
    { key: 'video', label: 'Видео' },
    { key: 'audio', label: 'Голосовые' },
    { key: 'file', label: 'Файлы' }
  ];

  function settingsReady() {
    return typeof renderSettings === 'function' && typeof els !== 'undefined' && els?.content;
  }

  function mountPage(title, bodyHtml, onBack, { swipe = true, hideBack = false } = {}) {
    if (!settingsReady()) return null;
    activeStorageRoot = null;
    els.content.innerHTML = `<div class="fp-settings131" data-page="storage167"><div class="fp-settings131-header"><button class="fp-settings131-back${hideBack ? ' fp-storage167-disabled-back' : ''}" type="button" aria-label="Назад">${BACK_SVG}</button><h2>${escapeHtml167(title)}</h2><span></span></div><div class="fp-settings131-body">${bodyHtml}</div></div>`;
    const root = els.content.querySelector('.fp-settings131');
    const back = root?.querySelector('.fp-settings131-back');
    if (back && !hideBack) back.onclick = onBack;
    root?.addEventListener('contextmenu', (event) => {
      if (event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault();
    }, true);
    if (root && swipe && !hideBack) installBackSwipe(root, onBack);
    return root;
  }

  function installBackSwipe(root, goBack) {
    if (typeof PointerEvent === 'undefined') return;
    const EDGE = 32;
    let gesture = null;
    const down = (event) => {
      if (event.pointerType === 'mouse' || event.button !== 0 || event.clientX > EDGE || event.target.closest('input,select,button')) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, mode: '' };
    };
    const move = (event) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.mode && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) gesture.mode = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.15 ? 'back' : 'other';
      if (gesture.mode !== 'back') return;
      event.preventDefault();
      gesture.dx = Math.max(0, dx);
      root.style.transform = `translate3d(${Math.min(gesture.dx, root.clientWidth * .88)}px,0,0)`;
    };
    const finish = (event) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const commit = gesture.mode === 'back' && gesture.dx >= 82;
      gesture = null;
      root.style.transform = '';
      if (commit) goBack();
    };
    root.addEventListener('pointerdown', down, { passive: true });
    root.addEventListener('pointermove', move, { passive: false });
    root.addEventListener('pointerup', finish, { passive: true });
    root.addEventListener('pointercancel', finish, { passive: true });
  }

  function renderMainSettings() {
    try { renderSettings(); } catch { if (typeof setView === 'function') setView('settings'); }
  }

  async function renderStorage() {
    const retention = getRetentionDays();
    const auto = getAutoload();
    const root = mountPage('Данные и хранилище', `
      <div class="fp-storage167-stack">
        <div class="fp-settings131-card fp-storage167-summary">
          <div class="fp-storage167-summary-head"><div><div class="fp-storage167-summary-title">Кэш FPChat</div><div id="fpStorage167Total" class="fp-storage167-total">…</div></div></div>
          <div id="fpStorage167Origin" class="fp-storage167-origin">Подсчитываем локальные данные…</div>
          <div class="fp-storage167-bar" aria-hidden="true">${categoryDefs.map((item) => `<span class="${item.key}" data-bar="${item.key}"></span>`).join('')}</div>
          <div class="fp-storage167-categories">${categoryDefs.map((item) => `<div class="fp-storage167-category"><span class="fp-storage167-dot ${item.key}"></span><span>${item.label}</span><span data-size="${item.key}">…</span></div>`).join('')}</div>
          <button id="fpStorage167Clear" class="fp-storage167-clear" type="button" disabled>Очистить кэш</button>
        </div>

        <div><div class="fp-storage167-section-title">Хранение кэша</div><div class="fp-settings131-card fp-storage167-settings-card">
          <label class="fp-storage167-setting-row"><span class="fp-storage167-setting-copy"><b>Хранить медиа</b><small>Старые локальные копии удаляются автоматически</small></span><select id="fpStorage167Retention" class="fp-storage167-select"><option value="0">Без ограничения</option><option value="3">3 дня</option><option value="7">1 неделя</option><option value="30">1 месяц</option></select></label>
        </div></div>

        <div><div class="fp-storage167-section-title">Автозагрузка медиа</div><div class="fp-settings131-card fp-storage167-settings-card">
          ${[
            ['image', 'Фото', 'Загружать новые изображения в локальный кэш'],
            ['video', 'Видео', 'Загружать новые видео в локальный кэш'],
            ['audio', 'Голосовые', 'Загружать новые голосовые в локальный кэш'],
            ['file', 'Файлы', 'Загружать новые файлы в локальный кэш']
          ].map(([key, title, sub]) => `<label class="fp-storage167-setting-row"><span class="fp-storage167-setting-copy"><b>${title}</b><small>${sub}</small></span><span class="fp-privacy155-switch"><input type="checkbox" data-autoload="${key}" ${auto[key] ? 'checked' : ''}><span class="fp-privacy155-track"></span></span></label>`).join('')}
        </div></div>

        <div class="fp-storage167-note">Очистка удаляет только локальные зашифрованные копии медиа. Сообщения, комнаты, файлы на сервере, recovery, deviceId и настройки FPChat не удаляются.</div>
      </div>`, renderMainSettings);
    if (!root) return;
    activeStorageRoot = root;

    const retentionSelect = root.querySelector('#fpStorage167Retention');
    retentionSelect.value = String(retention);
    retentionSelect.onchange = async () => {
      retentionSelect.disabled = true;
      await setRetentionDays(retentionSelect.value);
      retentionSelect.disabled = false;
      await refreshStorageStats(root);
    };
    root.querySelectorAll('[data-autoload]').forEach((input) => {
      input.addEventListener('change', () => setAutoload(input.dataset.autoload, input.checked));
    });

    await refreshStorageStats(root);
  }

  async function refreshStorageStats(root) {
    if (!root?.isConnected) return;
    const total = root.querySelector('#fpStorage167Total');
    const origin = root.querySelector('#fpStorage167Origin');
    const clear = root.querySelector('#fpStorage167Clear');
    try {
      const stats = await getStats();
      if (!root.isConnected) return;
      total.textContent = formatBytes(stats.totalBytes);
      if (!stats.supported) origin.textContent = 'Управляемый кэш недоступен в этом браузере.';
      else if (stats.quota > 0) origin.textContent = `Данные сайта: ${formatBytes(stats.originUsage)} из ${formatBytes(stats.quota)}`;
      else origin.textContent = `Локальных объектов: ${stats.entryCount}`;
      for (const item of categoryDefs) {
        const bytes = Number(stats.categories[item.key]?.bytes || 0);
        const sizeNode = root.querySelector(`[data-size="${item.key}"]`);
        if (sizeNode) sizeNode.textContent = formatBytes(bytes);
        const bar = root.querySelector(`[data-bar="${item.key}"]`);
        if (bar) bar.style.width = stats.totalBytes > 0 ? `${bytes / stats.totalBytes * 100}%` : '0%';
      }
      clear.disabled = !stats.supported || stats.totalBytes <= 0;
      clear.textContent = stats.totalBytes > 0 ? `Очистить кэш · ${formatBytes(stats.totalBytes)}` : 'Кэш пуст';
      clear.onclick = () => void renderClearPicker(stats);
    } catch {
      total.textContent = '—';
      origin.textContent = 'Не удалось подсчитать локальный кэш.';
      clear.disabled = true;
    }
  }

  async function renderClearPicker(stats = null) {
    const data = stats || await getStats();
    const root = mountPage('Очистить кэш', `
      <div class="fp-storage167-stack">
        <div class="fp-settings131-card fp-storage167-picker">
          ${categoryDefs.map((item) => {
            const bytes = Number(data.categories[item.key]?.bytes || 0);
            return `<label class="fp-storage167-pick"><input type="checkbox" data-clear-kind="${item.key}" ${bytes > 0 ? 'checked' : 'disabled'}><b>${item.label}</b><span>${formatBytes(bytes)}</span></label>`;
          }).join('')}
        </div>
        <button id="fpStorage167StartClear" class="fp-storage167-action" type="button">Очистить</button>
        <div class="fp-storage167-note">Будут удалены только выбранные локальные копии. История сообщений и данные доступа к чатам останутся без изменений.</div>
      </div>`, renderStorage);
    if (!root) return;
    const button = root.querySelector('#fpStorage167StartClear');
    const inputs = [...root.querySelectorAll('[data-clear-kind]')];
    const update = () => {
      const selected = inputs.filter((input) => input.checked).map((input) => input.dataset.clearKind);
      const bytes = selected.reduce((sum, key) => sum + Number(data.categories[key]?.bytes || 0), 0);
      button.disabled = selected.length === 0;
      button.textContent = selected.length ? `Очистить · ${formatBytes(bytes)}` : 'Выберите данные';
      return selected;
    };
    inputs.forEach((input) => input.addEventListener('change', update));
    update();
    button.onclick = () => {
      const selected = update();
      if (selected.length) void renderClearProgress(selected);
    };
  }

  async function renderClearProgress(selectedKinds) {
    const root = mountPage('Очистка кэша', `
      <div class="fp-settings131-card fp-storage167-progress-card">
        <div class="fp-storage167-broom" aria-hidden="true">🧹</div>
        <div id="fpStorage167Percent" class="fp-storage167-percent">0%</div>
        <div id="fpStorage167ProgressText" class="fp-storage167-progress-text">Пожалуйста, не закрывайте приложение до завершения очистки кэша.</div>
        <div class="fp-storage167-progress"><span id="fpStorage167ProgressBar"></span></div>
      </div>`, () => {}, { swipe: false, hideBack: true });
    if (!root) return;
    const percentNode = root.querySelector('#fpStorage167Percent');
    const textNode = root.querySelector('#fpStorage167ProgressText');
    const bar = root.querySelector('#fpStorage167ProgressBar');
    let clearing = true;
    const beforeUnload = (event) => {
      if (!clearing) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);

    try {
      await clearCache(selectedKinds, ({ percent }) => {
        const safe = Math.max(0, Math.min(100, Number(percent || 0) || 0));
        percentNode.textContent = `${safe}%`;
        bar.style.width = `${safe}%`;
      });
      percentNode.textContent = '100%';
      bar.style.width = '100%';
      textNode.textContent = 'Кэш очищен';
      root.classList.add('fp-storage167-done');
      clearing = false;
      window.removeEventListener('beforeunload', beforeUnload);
      setTimeout(() => { if (root.isConnected) void renderStorage(); }, 650);
    } catch {
      clearing = false;
      window.removeEventListener('beforeunload', beforeUnload);
      textNode.textContent = 'Не удалось полностью очистить кэш. Попробуйте ещё раз.';
      textNode.classList.add('fp-storage167-error');
      const back = root.querySelector('.fp-settings131-back');
      back?.classList.remove('fp-storage167-disabled-back');
      if (back) back.onclick = () => void renderStorage();
    }
  }

  window.addEventListener('fpchat:storage-changed', () => {
    const root = activeStorageRoot;
    if (root?.isConnected) void refreshStorageStats(root);
  });

  function installStorageEntryPoint() {
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('.fp-settings131-row[data-open="storage"]') : null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void renderStorage();
    }, true);
  }

  installStorageEntryPoint();
})();