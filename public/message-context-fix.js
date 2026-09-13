/* Build 106: cache-aware media save UI. */
(() => {
  const ROOT = '.message-context-root';
  const COPY = '.message-context-copy';
  const MOBILE = '(max-width: 900px)';
  const videoCache = new Map();
  const videoSaves = new Set();
  let toastTimer = null;

  const msgId = (el) => String(el?.dataset?.messageId || el?.dataset?.id || '').trim();
  const px = (v) => Number.parseFloat(v) || 0;

  function originalMessage(id, clone) {
    return [...document.querySelectorAll('#messages .bubble-wrap.msg')]
      .find((el) => el !== clone && msgId(el) === id) || null;
  }

  function disableDrag(root = document) {
    root.querySelectorAll?.('.bubble-wrap.msg img,.bubble-wrap.msg video,.media-tile,.message-context-root img,.message-context-root video')
      .forEach((el) => { el.draggable = false; el.setAttribute('draggable', 'false'); });
  }

  function lockGeometry(root) {
    if (!root?.isConnected || root.dataset.fpGeometry === '1') return;
    const clone = root.querySelector(COPY);
    const original = originalMessage(msgId(clone), clone);
    const a = original?.querySelector('.bubble');
    const b = clone?.querySelector('.bubble');
    if (!clone || !a || !b) { root.dataset.fpGeometry = '1'; return; }
    const s = getComputedStyle(clone);
    const width = Math.min(a.getBoundingClientRect().width, Math.max(1, clone.getBoundingClientRect().width - px(s.paddingLeft) - px(s.paddingRight)));
    if (width > 0) {
      b.style.setProperty('width', `${width}px`, 'important');
      b.style.setProperty('max-width', `${width}px`, 'important');
      b.style.setProperty('flex', `0 0 ${width}px`, 'important');
    }
    root.dataset.fpGeometry = '1';
  }

  function closeContext(root) { root?.querySelector('.message-context-backdrop')?.click(); }

  function ensureToastStyle() {
    if (document.getElementById('fp-save-toast-style')) return;
    const s = document.createElement('style');
    s.id = 'fp-save-toast-style';
    s.textContent = '.fp-save-toast{position:fixed;left:50%;bottom:calc(78px + env(safe-area-inset-bottom));z-index:1700;transform:translate(-50%,8px);padding:10px 15px;border-radius:14px;background:rgba(24,32,40,.92);color:#fff;font:inherit;font-size:14px;font-weight:650;box-shadow:0 8px 24px rgba(0,0,0,.24);opacity:0;pointer-events:none;transition:.16s ease}.fp-save-toast.show{opacity:1;transform:translate(-50%,0)}.fp-save-toast.error{background:rgba(154,43,43,.94)}';
    document.head.appendChild(s);
  }

  function toast(kind, ok = true) {
    ensureToastStyle();
    clearTimeout(toastTimer);
    document.querySelector('.fp-save-toast')?.remove();
    const el = document.createElement('div');
    el.className = `fp-save-toast${ok ? '' : ' error'}`;
    const noun = kind === 'video' ? 'Видео' : 'Изображение';
    el.textContent = ok ? `✓ ${noun} сохранено` : `× Не удалось сохранить ${kind === 'video' ? 'видео' : 'изображение'}`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    toastTimer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 180); }, 1800);
  }

  function wrapShare() {
    if (typeof navigator.share !== 'function' || navigator.share.__fp106) return;
    const nativeShare = navigator.share.bind(navigator);
    const wrapped = async (data) => {
      const file = Array.isArray(data?.files) ? data.files[0] : null;
      const fp = file instanceof File && String(file.name || '').startsWith('FPChat-');
      const kind = String(file?.type || '').startsWith('video/') ? 'video' : 'image';
      if (fp) document.querySelectorAll('.media-save-progress').forEach((el) => { el.style.visibility = 'hidden'; el.style.opacity = '0'; });
      const result = await nativeShare(data);
      if (fp) toast(kind, true);
      return result;
    };
    wrapped.__fp106 = true;
    try { navigator.share = wrapped; } catch {}
  }

  function wirePhotoProgress(el) {
    if (!(el instanceof Element) || el.dataset.fp106 === '1') return;
    el.dataset.fp106 = '1';
    const hide = () => { el.style.visibility = 'hidden'; el.style.opacity = '0'; };
    const show = () => { el.style.visibility = 'visible'; el.style.opacity = '1'; };
    hide();
    let timer = null;
    let hadRealWork = false;
    const sync = () => {
      clearTimeout(timer);
      if (!el.isConnected) return;
      if (el.classList.contains('is-error')) { show(); return; }
      if (el.classList.contains('is-success')) { hide(); return; }
      const m = String(el.getAttribute('aria-label') || '').match(/(\d{1,3})%/);
      if (m) {
        const percent = Math.max(0, Math.min(100, Number(m[1])));
        if (percent < 100) { hadRealWork = true; show(); }
        else if (hadRealWork) show();
        else hide();
        return;
      }
      timer = setTimeout(() => {
        if (el.isConnected && !el.classList.contains('is-success') && !/100%/.test(el.getAttribute('aria-label') || '')) {
          hadRealWork = true;
          show();
        }
      }, 120);
    };
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ['class', 'aria-label'] });
    sync();
    setTimeout(() => mo.disconnect(), 30000);
  }

  function videoProgress(original, index) {
    const tile = original?.querySelector(`.media-tile[data-media-index="${index}"]`);
    if (!tile) return { set() {}, done() {}, fail() {} };
    tile.querySelector('.media-save-progress')?.remove();
    tile.classList.add('media-save-progress-host');
    const el = document.createElement('div');
    el.className = 'media-save-progress is-indeterminate';
    el.innerHTML = '<span class="media-save-progress-ring"><svg viewBox="0 0 48 48"><circle class="media-save-progress-track" cx="24" cy="24" r="18"></circle><circle class="media-save-progress-value" cx="24" cy="24" r="18"></circle></svg><span class="media-save-progress-icon">↓</span></span>';
    tile.appendChild(el);
    const c = el.querySelector('.media-save-progress-value');
    const icon = el.querySelector('.media-save-progress-icon');
    const n = 2 * Math.PI * 18;
    c.style.strokeDasharray = `${n}`; c.style.strokeDashoffset = `${n}`;
    const remove = () => { el.remove(); if (!tile.querySelector('.media-save-progress')) tile.classList.remove('media-save-progress-host'); };
    return {
      set({ loaded = 0, total = 0 } = {}) { if (!el.isConnected) return; if (total > 0) { const r = Math.max(0, Math.min(1, loaded / total)); el.classList.remove('is-indeterminate'); c.style.strokeDashoffset = `${n * (1 - r)}`; } },
      done: remove,
      fail() { if (!el.isConnected) return; el.classList.remove('is-indeterminate'); el.classList.add('is-error'); c.style.strokeDashoffset = '0'; icon.textContent = '×'; setTimeout(remove, 1000); }
    };
  }

  function emit(entry) { for (const fn of entry.listeners) { try { fn({ loaded: entry.loaded, total: entry.total, done: entry.done }); } catch {} } }

  async function mediaItem(messageId, index) {
    const roomId = typeof state !== 'undefined' ? state.roomId : null;
    const saved = roomId && typeof STORAGE !== 'undefined' ? STORAGE.get(STORAGE.roomState(roomId)) : null;
    const deviceId = typeof activeChatDeviceId !== 'undefined' && activeChatDeviceId ? activeChatDeviceId : saved?.deviceId;
    if (!roomId || !deviceId) throw new Error('device unavailable');
    const q = new URLSearchParams({ deviceId: String(deviceId), limit: '1' });
    const id = Number(messageId); if (Number.isSafeInteger(id) && id > 0) q.set('before', String(id + 1));
    const r = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages?${q}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('message unavailable');
    const d = await r.json();
    const m = (d?.messages || []).find((x) => String(x?.id) === String(messageId)) || d?.messages?.[0];
    const item = m?.media?.[index]; if (!item?.public_id) throw new Error('media unavailable');
    return { item, deviceId };
  }

  async function videoBlob(messageId, index, onProgress) {
    const key = `${messageId}:${index}`;
    const consume = async (e) => { if (onProgress) { e.listeners.add(onProgress); onProgress({ loaded:e.loaded,total:e.total,done:e.done }); } try { return await e.promise; } finally { if (onProgress) e.listeners.delete(onProgress); } };
    if (videoCache.has(key)) return consume(videoCache.get(key));
    const e = { loaded:0,total:0,done:false,listeners:new Set(),promise:null };
    e.promise = (async () => {
      const { item, deviceId } = await mediaItem(messageId, index);
      const r = await fetch(`/api/media/${encodeURIComponent(item.public_id)}/blob?deviceId=${encodeURIComponent(deviceId)}`);
      if (!r.ok) throw new Error('media load failed');
      const len = Number(r.headers.get('content-length')); e.total = Number.isFinite(len) && len > 0 ? len : 0; emit(e);
      let encrypted;
      if (r.body?.getReader) {
        const reader = r.body.getReader(), chunks = [];
        while (true) { const x = await reader.read(); if (x.done) break; if (x.value?.byteLength) { chunks.push(x.value); e.loaded += x.value.byteLength; emit(e); } }
        if (!e.total) e.total = e.loaded; encrypted = new Blob(chunks, { type:r.headers.get('content-type') || 'application/octet-stream' });
      } else { encrypted = await r.blob(); e.loaded = encrypted.size; if (!e.total) e.total = encrypted.size; emit(e); }
      const blob = await decryptBlobWithIvPrefix(encrypted, item.mime_type || 'video/mp4'); e.done = true; emit(e); return { blob, item };
    })();
    videoCache.set(key, e);
    try { return await consume(e); } catch (err) { videoCache.delete(key); throw err; }
  }

  function ext(mime) { return ({'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','video/x-m4v':'m4v'})[String(mime || '').toLowerCase()] || 'mp4'; }
  function download(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href=u; a.download=name; a.style.display='none'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u),1500); }

  async function saveVideo(s) {
    const key = `${s.messageId}:${s.index}`; if (videoSaves.has(key)) return; videoSaves.add(key);
    const progress = videoCache.get(key)?.done ? null : videoProgress(s.original, s.index);
    try {
      const { blob, item } = await videoBlob(s.messageId, s.index, (v) => progress?.set(v)); progress?.done();
      const mime = item?.mime_type || blob.type || 'video/mp4'; const name = `FPChat-${s.messageId}-${s.index + 1}.${ext(mime)}`; const file = new File([blob], name, { type:mime });
      if (window.matchMedia(MOBILE).matches && navigator.share && navigator.canShare?.({ files:[file] })) { try { await navigator.share({ files:[file] }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
      download(blob, name); toast('video', true);
    } catch { progress?.fail(); toast('video', false); } finally { videoSaves.delete(key); }
  }

  function decorate(root) {
    if (!root?.isConnected || root.dataset.fp106Decorated === '1') return; root.dataset.fp106Decorated = '1';
    const clone = root.querySelector(COPY), menu = root.querySelector('.message-context-menu'), tile = clone?.querySelector('.message-context-selected-media'); if (!clone || !menu || !tile) return;
    const save = [...menu.querySelectorAll('.message-context-action')].find((b) => /Сохранить фото/i.test(b.textContent || ''));
    if (save) { const label = save.querySelector('span:last-child'); if (label) label.textContent = 'Сохранить в галерею'; return; }
    if (!tile.querySelector('.media-video-badge:not(.hidden)')) return;
    const id = msgId(clone), index = Number(tile.dataset.mediaIndex), original = originalMessage(id, clone); if (!id || !Number.isInteger(index) || !original) return;
    const b = document.createElement('button'); b.type='button'; b.className='message-context-action'; b.innerHTML='<span class="message-context-action-icon">⇩</span><span>Сохранить в галерею</span>';
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeContext(root); void saveVideo({ messageId:id,index,original }); }; menu.appendChild(b);
  }

  document.addEventListener('click', (e) => { const root = e.target?.closest?.(ROOT); if (!root || e.target.closest('.message-context-menu') || e.target.closest('.message-context-copy .bubble')) return; if (e.target === root.querySelector('.message-context-backdrop')) return; e.preventDefault(); e.stopImmediatePropagation(); closeContext(root); }, true);
  document.addEventListener('dragstart', (e) => { if (!e.target?.closest?.('.bubble-wrap.msg,.message-context-root')) return; e.preventDefault(); e.stopImmediatePropagation(); }, true);

  wrapShare(); disableDrag(document);
  const mo = new MutationObserver((records) => { for (const r of records) for (const node of r.addedNodes) { if (!(node instanceof Element)) continue; disableDrag(node); if (node.matches(ROOT)) { lockGeometry(node); decorate(node); } node.querySelectorAll?.(ROOT).forEach((x) => { lockGeometry(x); decorate(x); }); if (node.matches('.media-save-progress')) wirePhotoProgress(node); node.querySelectorAll?.('.media-save-progress').forEach(wirePhotoProgress); } });
  mo.observe(document.body, { childList:true, subtree:true });
  document.querySelectorAll(ROOT).forEach((x) => { lockGeometry(x); decorate(x); });
  document.querySelectorAll('.media-save-progress').forEach(wirePhotoProgress);
})();
