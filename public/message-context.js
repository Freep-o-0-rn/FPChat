/* Build 103: Telegram-style message context mode with image save progress.
   Isolated from message transport, unread/read logic, lazy history and scroll coordinator. */
(() => {
  const LONG_PRESS_MS = 450;
  const MOVE_CANCEL_PX = 12;
  const VIEWER_RETURN_SWIPE_PX = 72;
  const MOBILE_QUERY = '(max-width: 900px)';
  const mediaByMessageId = new Map();
  const mediaBlobCache = new Map();
  const MEDIA_BLOB_CACHE_BYTES = 8 * 1024 * 1024;
  const activeMediaSaves = new Set();

  let contextState = null;
  let touchSession = null;
  let suppressUnderlyingClickUntil = 0;
  let viewerGestureCleanup = null;
  let viewerObserver = null;

  const originalAppendMessage = typeof appendMessage === 'function' ? appendMessage : null;
  if (originalAppendMessage) {
    appendMessage = function appendMessageWithContextMediaCache(...args) {
      const message = args[1];
      if (message?.id != null && Array.isArray(message.media)) {
        mediaByMessageId.set(String(message.id), message.media);
      }
      return originalAppendMessage.apply(this, args);
    };
  }

  function getMessageElement(target) {
    return target?.closest?.('.bubble-wrap.msg') || null;
  }

  function getMessageId(messageEl) {
    return String(messageEl?.dataset?.messageId || messageEl?.dataset?.id || '').trim();
  }

  function getMediaIndex(target, messageEl) {
    const tile = target?.closest?.('.media-tile');
    if (tile && messageEl?.contains(tile)) {
      const index = Number(tile.dataset.mediaIndex);
      return Number.isInteger(index) && index >= 0 ? index : null;
    }
    const tiles = messageEl?.querySelectorAll?.('.media-tile') || [];
    return tiles.length === 1 ? 0 : null;
  }

  function getMediaKindFromDom(messageEl, index) {
    if (index == null) return null;
    const tile = messageEl?.querySelector?.(`.media-tile[data-media-index="${index}"]`);
    if (!tile) return null;
    const badge = tile.querySelector('.media-video-badge');
    return badge && !badge.classList.contains('hidden') ? 'video' : 'image';
  }

  function getMessageText(messageEl, messageId) {
    const numericId = Number(messageId);
    if (Number.isSafeInteger(numericId) && typeof messageCache !== 'undefined') {
      const cached = messageCache.get(numericId);
      if (cached && typeof cached.text === 'string') return cached.text;
    }
    return messageEl?.querySelector?.('.message-text')?.textContent || '';
  }

  async function cacheMediaFromResponse(response) {
    if (!response?.ok) return;
    const data = await response.json().catch(() => null);
    for (const message of data?.messages || []) {
      if (message?.id != null && Array.isArray(message.media)) {
        mediaByMessageId.set(String(message.id), message.media);
      }
    }
  }

  async function ensureMessageMedia(messageId) {
    if (mediaByMessageId.has(String(messageId))) return mediaByMessageId.get(String(messageId));
    const roomId = typeof state !== 'undefined' ? state.roomId : null;
    const deviceId = typeof activeChatDeviceId !== 'undefined' ? activeChatDeviceId : null;
    if (!roomId || !deviceId) return [];

    const numericId = Number(messageId);
    const query = new URLSearchParams({ deviceId: String(deviceId), limit: '1' });
    if (Number.isSafeInteger(numericId) && numericId > 0) query.set('before', String(numericId + 1));

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages?${query.toString()}`, { cache: 'no-store' });
      await cacheMediaFromResponse(response);
    } catch {}
    return mediaByMessageId.get(String(messageId)) || [];
  }

  function emitMediaBlobProgress(entry) {
    const payload = {
      loaded: entry.loaded,
      total: entry.total,
      done: entry.done
    };
    for (const listener of entry.listeners) {
      try { listener(payload); } catch {}
    }
  }

  async function readResponseBlobWithProgress(response, entry) {
    const headerLength = Number(response.headers.get('content-length'));
    entry.total = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : 0;
    emitMediaBlobProgress(entry);

    if (!response.body || typeof response.body.getReader !== 'function') {
      const blob = await response.blob();
      entry.loaded = blob.size;
      if (!entry.total) entry.total = blob.size;
      emitMediaBlobProgress(entry);
      return blob;
    }

    const reader = response.body.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        chunks.push(value);
        entry.loaded += value.byteLength;
        emitMediaBlobProgress(entry);
      }
    }

    if (!entry.total) entry.total = entry.loaded;
    emitMediaBlobProgress(entry);
    return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
  }

  async function fetchOriginalMediaBlob(messageId, mediaIndex, onProgress = null) {
    const roomId = typeof state !== 'undefined' ? state.roomId : null;
    const persisted = roomId && typeof STORAGE !== 'undefined' ? STORAGE.get(STORAGE.roomState(roomId)) : null;
    const cacheKey = `${roomId}:${messageId}:${mediaIndex}`;

    const consumeEntry = async (entry) => {
      if (typeof onProgress === 'function') {
        entry.listeners.add(onProgress);
        try {
          onProgress({ loaded: entry.loaded, total: entry.total, done: entry.done });
        } catch {}
      }
      try {
        return await entry.promise;
      } finally {
        if (typeof onProgress === 'function') entry.listeners.delete(onProgress);
      }
    };

    if (mediaBlobCache.has(cacheKey)) return consumeEntry(mediaBlobCache.get(cacheKey));

    const entry = {
      loaded: 0,
      total: 0,
      done: false,
      listeners: new Set(),
      promise: null
    };

    entry.promise = (async () => {
      const media = await ensureMessageMedia(messageId);
      const item = media?.[mediaIndex];
      if (!item?.public_id) throw new Error('media unavailable');
      if (!persisted?.deviceId) throw new Error('device unavailable');
      const key=await getRoomKey(roomId);
      const blob=await readEncryptedMedia174(`/api/media/${encodeURIComponent(item.public_id)}/blob?deviceId=${encodeURIComponent(persisted.deviceId)}`,item.mime_type || 'application/octet-stream',key,{},response=>readResponseBlobWithProgress(response,entry));
      entry.done = true;
      entry.bytes = blob.size;
      // Bound the existing plaintext memo, independently of the encrypted disk
      // cache. Active save consumers retain their promise even after eviction.
      let retained = [...mediaBlobCache.values()].reduce((sum,value)=>sum+(value.done?value.bytes||0:0),0);
      for(const [key,value] of mediaBlobCache){
        if(retained<=MEDIA_BLOB_CACHE_BYTES)break;
        if(value.done){mediaBlobCache.delete(key);retained-=value.bytes||0;}
      }
      emitMediaBlobProgress(entry);
      return { blob, item, media };
    })();

    mediaBlobCache.set(cacheKey, entry);
    try {
      return await consumeEntry(entry);
    } catch (error) {
      if(mediaBlobCache.get(cacheKey)===entry)mediaBlobCache.delete(cacheKey);
      throw error;
    }
  }

  function buildMenuButton(icon, label, action, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `message-context-action ${extraClass}`.trim();
    button.innerHTML = `<span class="message-context-action-icon" aria-hidden="true">${icon}</span><span>${label}</span>`;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void action();
    });
    return button;
  }

  function getOriginalMessageRect(messageEl) {
    const bubble = messageEl?.querySelector?.('.bubble');
    return (bubble || messageEl)?.getBoundingClientRect?.() || { top: 12, bottom: 80, height: 68 };
  }

  function makeContextClone(messageEl, selectedMediaIndex) {
    const clone = messageEl.cloneNode(true);
    clone.classList.remove('swiping', 'swipe-reset', 'reply-highlight');
    clone.classList.add('message-context-copy');
    clone.querySelector('.swipe-reply-icon')?.remove();
    clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    clone.querySelectorAll('.media-tile').forEach((tile) => {
      tile.tabIndex = -1;
      const index = Number(tile.dataset.mediaIndex);
      tile.classList.toggle('message-context-selected-media', index === selectedMediaIndex);
    });
    return clone;
  }

  function restoreBackgroundScroll(snapshot) {
    if (!snapshot?.box?.isConnected) return;
    // The overlay does not own message geometry. History/viewport/user scroll
    // may have advanced while it was open; never restore an old absolute offset.
    // If a future context layout needs preservation, it must ask FPScroll173.
  }

  function closeContext({ restoreScroll = true } = {}) {
    const current = contextState;
    if (!current) return;
    contextState = null;
    current.root?.remove();
    document.body.classList.remove('message-context-open');
    if (restoreScroll) restoreBackgroundScroll(current.background);
    cleanupViewerReturn();
  }

  function cleanupViewerReturn() {
    viewerGestureCleanup?.();
    viewerGestureCleanup = null;
    viewerObserver?.disconnect();
    viewerObserver = null;
  }

  function restoreContextAfterViewer() {
    if (!contextState?.root?.isConnected) return;
    contextState.root.classList.remove('message-context-viewer-hidden');
    cleanupViewerReturn();
  }

  function closeViewerBackToContextWorker177(viewer) {
    if (!viewer || typeof mediaViewerState === 'undefined' || mediaViewerState !== viewer) return false;
    mediaViewerState = null;
    if (typeof renderMediaViewer === 'function') renderMediaViewer();
    return true;
  }

  function closeViewerBackToContext() {
    try {
      const viewer = typeof mediaViewerState !== 'undefined' ? mediaViewerState : null;
      const manager = window.FPMediaManager177;
      if (viewer && manager?.closeViewer) {
        const tracked = manager.currentViewer?.();
        if (tracked === viewer) manager.closeViewer(viewer, closeViewerBackToContextWorker177);
        else if (!tracked) closeViewerBackToContextWorker177(viewer);
      } else {
        if (typeof mediaViewerState !== 'undefined') mediaViewerState = null;
        if (typeof renderMediaViewer === 'function') renderMediaViewer();
      }
    } catch {}
    restoreContextAfterViewer();
  }

  function installViewerReturnGesture() {
    cleanupViewerReturn();
    const viewerRoot = document.getElementById('mediaViewerRoot');
    if (!viewerRoot) return;

    // Build 173: media-gallery134 is the single viewer gesture owner. Context
    // only waits for the viewer to really close, then restores its hidden layer.
    if (window.FPLayer173 && window.FPDOM173?.on) {
      const off = window.FPDOM173.on('viewer', 'unmounted', () => {
        queueMicrotask(() => {
          if (!contextState) return;
          if (!viewerRoot.querySelector('.media-viewer-overlay')) restoreContextAfterViewer();
        });
      });
      viewerGestureCleanup = off;
      return;
    }

    let gesture = null;

    const onStart = (event) => {
      if (event.touches?.length !== 1) return;
      const touch = event.touches[0];
      gesture = { x: touch.clientX, y: touch.clientY, dx: 0, dy: 0 };
    };
    const onMove = (event) => {
      if (!gesture || event.touches?.length !== 1) return;
      const touch = event.touches[0];
      gesture.dx = touch.clientX - gesture.x;
      gesture.dy = touch.clientY - gesture.y;
      if (Math.abs(gesture.dy) > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx) && event.cancelable) {
        event.preventDefault();
      }
    };
    const onEnd = () => {
      if (!gesture) return;
      const current = gesture;
      gesture = null;
      if (Math.abs(current.dy) >= VIEWER_RETURN_SWIPE_PX && Math.abs(current.dy) > Math.abs(current.dx) * 1.1) {
        closeViewerBackToContext();
      }
    };
    const onCancel = () => { gesture = null; };

    viewerRoot.addEventListener('touchstart', onStart, { passive: true });
    viewerRoot.addEventListener('touchmove', onMove, { passive: false });
    viewerRoot.addEventListener('touchend', onEnd, { passive: true });
    viewerRoot.addEventListener('touchcancel', onCancel, { passive: true });
    viewerGestureCleanup = () => {
      viewerRoot.removeEventListener('touchstart', onStart);
      viewerRoot.removeEventListener('touchmove', onMove);
      viewerRoot.removeEventListener('touchend', onEnd);
      viewerRoot.removeEventListener('touchcancel', onCancel);
    };

    viewerObserver = new MutationObserver(() => {
      if (!contextState) return;
      const overlay = viewerRoot.querySelector('.media-viewer-overlay');
      if (!overlay) restoreContextAfterViewer();
    });
    viewerObserver.observe(viewerRoot, { childList: true, subtree: true });
  }

  async function openViewerFromContext(index) {
    if (!contextState) return;
    const media = await ensureMessageMedia(contextState.messageId);
    if (!contextState || !media?.length || !media[index]) return;
    contextState.mediaIndex = index;
    contextState.mediaKind = media[index].media_kind || getMediaKindFromDom(contextState.original, index);
    contextState.root.classList.add('message-context-viewer-hidden');
    try {
      openMediaViewer(media, index);
      installViewerReturnGesture();
    } catch {
      contextState.root.classList.remove('message-context-viewer-hidden');
    }
  }

  async function copyText(text) {
    const value = String(text || '');
    if (!value) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      textarea.remove();
      return ok;
    }
  }

  async function convertImageToPng(blob) {
    if (blob.type === 'image/png') return blob;
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      if (typeof image.decode === 'function') await image.decode();
      else await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, image.naturalWidth || image.width);
      canvas.height = Math.max(1, image.naturalHeight || image.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas unavailable');
      ctx.drawImage(image, 0, 0);
      return await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('png conversion failed')), 'image/png'));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function copySelectedImage() {
    if (!contextState || contextState.mediaIndex == null) return false;
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      alert('Этот браузер не поддерживает копирование изображений в буфер обмена.');
      return false;
    }
    try {
      const messageId = contextState.messageId;
      const mediaIndex = contextState.mediaIndex;
      // Create ClipboardItem immediately from the user action. Safari/WebKit
      // is stricter about preserving user activation across async media loads.
      const pngPromise = fetchOriginalMediaBlob(messageId, mediaIndex)
        .then(({ blob }) => convertImageToPng(blob));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
      return true;
    } catch {
      alert('Не удалось скопировать изображение.');
      return false;
    }
  }

  function extensionForMime(mime) {
    const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    return map[String(mime || '').toLowerCase()] || 'jpg';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function createSaveProgress(stateForSave) {
    const tile = stateForSave?.mediaIndex == null
      ? null
      : stateForSave.original?.querySelector?.(`.media-tile[data-media-index="${stateForSave.mediaIndex}"]`);

    if (!tile) {
      return {
        setProgress() {},
        success() {},
        error() {},
        cancel() {}
      };
    }

    tile.querySelector('.media-save-progress')?.remove();
    tile.classList.add('media-save-progress-host');

    const overlay = document.createElement('div');
    overlay.className = 'media-save-progress is-indeterminate';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-label', 'Сохранение фото');
    overlay.innerHTML = `
      <span class="media-save-progress-ring" aria-hidden="true">
        <svg viewBox="0 0 48 48">
          <circle class="media-save-progress-track" cx="24" cy="24" r="18"></circle>
          <circle class="media-save-progress-value" cx="24" cy="24" r="18"></circle>
        </svg>
        <span class="media-save-progress-icon">↓</span>
      </span>`;
    tile.appendChild(overlay);

    const progressCircle = overlay.querySelector('.media-save-progress-value');
    const icon = overlay.querySelector('.media-save-progress-icon');
    const circumference = 2 * Math.PI * 18;
    progressCircle.style.strokeDasharray = `${circumference}`;
    progressCircle.style.strokeDashoffset = `${circumference}`;

    let finished = false;
    let removeTimer = null;

    const remove = (delay = 0) => {
      clearTimeout(removeTimer);
      removeTimer = setTimeout(() => {
        overlay.remove();
        tile.classList.remove('media-save-progress-host');
      }, delay);
    };

    const finish = (className, symbol, delay) => {
      if (finished) return;
      finished = true;
      overlay.classList.remove('is-indeterminate');
      overlay.classList.add(className);
      progressCircle.style.strokeDashoffset = '0';
      icon.textContent = symbol;
      remove(delay);
    };

    return {
      setProgress({ loaded = 0, total = 0 } = {}) {
        if (finished) return;
        if (total > 0) {
          const ratio = Math.max(0, Math.min(1, loaded / total));
          overlay.classList.remove('is-indeterminate');
          progressCircle.style.strokeDashoffset = `${circumference * (1 - ratio)}`;
          overlay.setAttribute('aria-label', `Сохранение фото: ${Math.round(ratio * 100)}%`);
        } else {
          overlay.classList.add('is-indeterminate');
          overlay.setAttribute('aria-label', 'Сохранение фото');
        }
      },
      success() {
        finish('is-success', '✓', 750);
      },
      error() {
        finish('is-error', '×', 1100);
      },
      cancel() {
        if (finished) return;
        finished = true;
        remove(120);
      }
    };
  }

  async function saveSelectedPhoto(stateForSave, progress) {
    if (!stateForSave || stateForSave.mediaIndex == null) return false;
    const saveKey = `${stateForSave.messageId}:${stateForSave.mediaIndex}`;
    if (activeMediaSaves.has(saveKey)) return false;
    activeMediaSaves.add(saveKey);

    try {
      const { blob, item } = await fetchOriginalMediaBlob(
        stateForSave.messageId,
        stateForSave.mediaIndex,
        (value) => progress?.setProgress(value)
      );
      const extension = extensionForMime(item?.mime_type || blob.type);
      const filename = `FPChat-${stateForSave.messageId}-${stateForSave.mediaIndex + 1}.${extension}`;
      const file = new File([blob], filename, { type: item?.mime_type || blob.type || 'image/jpeg' });
      const isMobile = window.matchMedia(MOBILE_QUERY).matches;

      if (isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          progress?.success();
          return true;
        } catch (error) {
          if (error?.name === 'AbortError') {
            progress?.cancel();
            return false;
          }
        }
      }

      downloadBlob(blob, filename);
      progress?.success();
      return true;
    } catch {
      progress?.error();
      alert('Не удалось сохранить фото.');
      return false;
    } finally {
      activeMediaSaves.delete(saveKey);
    }
  }

  function replyToSelectedMessage() {
    if (!contextState) return;
    const numericId = Number(contextState.messageId);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return;
    const replyTo = getMessageReplyMeta(numericId);
    setSelectedReply(state.roomId, replyTo);
    closeContext();
  }

  async function copySelectedContent() {
    if (!contextState) return;
    let ok = false;
    if (contextState.mediaKind === 'image' && contextState.mediaIndex != null) {
      ok = await copySelectedImage();
    } else {
      ok = await copyText(contextState.text);
      if (!ok) alert('Не удалось скопировать сообщение.');
    }
    if (ok) closeContext();
  }

  async function saveSelectedContent() {
    if (!contextState || contextState.mediaIndex == null) return;
    const stateForSave = contextState;
    const progress = createSaveProgress(stateForSave);
    closeContext();
    await saveSelectedPhoto(stateForSave, progress);
  }

  function buildMenu(stateForMenu) {
    const menu = document.createElement('div');
    menu.className = 'message-context-menu';
    menu.setAttribute('role', 'menu');
    menu.appendChild(buildMenuButton('↩', 'Ответить', replyToSelectedMessage));
    menu.appendChild(buildMenuButton('⧉', 'Копировать', copySelectedContent));
    if (stateForMenu.mediaKind === 'image' && stateForMenu.mediaIndex != null) {
      menu.appendChild(buildMenuButton('⇩', 'Сохранить фото', saveSelectedContent));
    }
    return menu;
  }

  function openContext(messageEl, sourceTarget, point = null) {
    if (!messageEl?.isConnected) return;
    closeContext();
    try { hideMessageReplyMenu?.(); } catch {}
    try { hideMenu?.(); } catch {}

    const messageId = getMessageId(messageEl);
    if (!messageId) return;
    const mediaIndex = getMediaIndex(sourceTarget, messageEl);
    const mediaKind = getMediaKindFromDom(messageEl, mediaIndex);
    const text = getMessageText(messageEl, messageId);
    const messagesBox = document.getElementById('messages');
    const background = messagesBox ? { box: messagesBox } : null;
    const sourceRect = getOriginalMessageRect(messageEl);
    const boxRect = messagesBox?.getBoundingClientRect?.() || { left: 0, width: window.innerWidth };

    const root = document.createElement('div');
    root.className = 'message-context-root';
    root.innerHTML = '<div class="message-context-backdrop"></div><div class="message-context-scroll"><div class="message-context-stage"></div></div>';
    const scroll = root.querySelector('.message-context-scroll');
    const stage = root.querySelector('.message-context-stage');
    const cluster = document.createElement('div');
    cluster.className = `message-context-cluster ${messageEl.classList.contains('mine') ? 'mine' : 'incoming'}`;

    const viewportMargin = 10;
    const width = Math.max(220, Math.min(boxRect.width || window.innerWidth, window.innerWidth - viewportMargin * 2));
    const left = Math.max(viewportMargin, Math.min(boxRect.left || viewportMargin, window.innerWidth - width - viewportMargin));
    cluster.style.width = `${width}px`;
    cluster.style.marginLeft = `${left}px`;

    const clone = makeContextClone(messageEl, mediaIndex);
    const nextState = {
      root,
      scroll,
      stage,
      cluster,
      clone,
      original: messageEl,
      messageId,
      mediaIndex,
      mediaKind,
      text,
      background,
      point
    };
    const menu = buildMenu(nextState);
    const menuHeight = mediaKind === 'image' ? 154 : 106;
    const spaceBelow = window.innerHeight - sourceRect.bottom;
    const spaceAbove = sourceRect.top;
    const menuBefore = spaceBelow < menuHeight + 18 && spaceAbove > menuHeight + 18;

    const topPadding = Math.max(12, Math.min(sourceRect.top, window.innerHeight * 0.62));
    cluster.style.paddingTop = `${topPadding}px`;
    if (menuBefore) {
      cluster.appendChild(menu);
      cluster.appendChild(clone);
      menu.classList.add('message-context-menu-before');
    } else {
      cluster.appendChild(clone);
      cluster.appendChild(menu);
    }
    stage.appendChild(cluster);
    document.body.appendChild(root);
    document.body.classList.add('message-context-open');
    contextState = nextState;

    scroll.addEventListener('click', (event) => {
      if (event.target === scroll || event.target === stage || event.target === cluster) closeContext();
    });
    root.querySelector('.message-context-backdrop')?.addEventListener('click', () => closeContext());
    clone.addEventListener('click', (event) => {
      event.stopPropagation();
      const tile = event.target.closest('.media-tile');
      if (!tile) return;
      const index = Number(tile.dataset.mediaIndex);
      if (!Number.isInteger(index) || index < 0) return;
      void openViewerFromContext(index);
    });

    if (mediaKind === 'image' && mediaIndex != null) {
      void fetchOriginalMediaBlob(messageId, mediaIndex).catch(() => {});
    } else if (messageEl.querySelector('.media-grid')) {
      void ensureMessageMedia(messageId);
    }

    requestAnimationFrame(() => {
      const menuRect = menu.getBoundingClientRect();
      const cloneRect = clone.getBoundingClientRect();
      const contentBottom = Math.max(menuRect.bottom, cloneRect.bottom);
      if (contentBottom > window.innerHeight - 12) {
        scroll.scrollTop = Math.min(contentBottom - window.innerHeight + 12, Math.max(0, scroll.scrollHeight - scroll.clientHeight));
      }
    });
  }

  document.addEventListener('contextmenu', (event) => {
    const messageEl = getMessageElement(event.target);
    if (!messageEl) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openContext(messageEl, event.target, { x: event.clientX, y: event.clientY, source: 'mouse' });
  }, true);

  document.addEventListener('touchstart', (event) => {
    if (contextState || event.touches?.length !== 1) return;
    if(window.FPGesture135&&FPGesture135.currentLayer(event,event.target)!=='chat')return;
    const messageEl = getMessageElement(event.target);
    if (!messageEl) return;
    const touch = event.touches[0];
    const session = {
      messageEl,
      target: event.target,
      startX: touch.clientX,
      startY: touch.clientY,
      triggered: false,
      timer: null
    };
    session.timer = setTimeout(() => {
      if (touchSession !== session || !messageEl.isConnected) return;
      if(window.FPGesture135&&FPGesture135.currentLayer(null,session.target)!=='chat')return;
      session.triggered = true;
      suppressUnderlyingClickUntil = Date.now() + 700;
      openContext(messageEl, session.target, { x: session.startX, y: session.startY, source: 'touch' });
      navigator.vibrate?.(10);
    }, LONG_PRESS_MS);
    touchSession = session;
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', (event) => {
    const session = touchSession;
    if (!session || event.touches?.length !== 1) return;
    if(!session.triggered&&window.FPGesture135&&FPGesture135.currentLayer(event,event.target)!=='chat'){clearTimeout(session.timer);touchSession=null;return;}
    if (session.triggered && contextState && getMessageElement(event.target) === session.messageEl) {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      return;
    }
    const touch = event.touches[0];
    const dx = touch.clientX - session.startX;
    const dy = touch.clientY - session.startY;
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
      clearTimeout(session.timer);
      touchSession = null;
    }
  }, { capture: true, passive: false });

  document.addEventListener('touchend', () => {
    if (!touchSession) return;
    clearTimeout(touchSession.timer);
    touchSession = null;
  }, { capture: true, passive: true });

  document.addEventListener('touchcancel', () => {
    if (!touchSession) return;
    clearTimeout(touchSession.timer);
    touchSession = null;
  }, { capture: true, passive: true });

  document.addEventListener('click', (event) => {
    if (Date.now() >= suppressUnderlyingClickUntil) return;
    if (event.target.closest('.message-context-root')) return;
    if (!getMessageElement(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && contextState) {
      event.preventDefault();
      closeContext();
    }
  });

  window.addEventListener('resize', () => {
    if (contextState) closeContext();
  });
})();
