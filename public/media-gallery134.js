/* Build 134: Telegram-like room media gallery and isolated viewer gestures. */
(() => {
  if (window.__fpMediaGallery134LoaderStarted) return;
  window.__fpMediaGallery134LoaderStarted = true;

  const HISTORY_LIMIT = 100;
  const HISTORY_CACHE_MS = 15000;
  const AXIS_LOCK_PX = 10;
  const HORIZONTAL_DISTANCE_PX = 68;
  const HORIZONTAL_FAST_DISTANCE_PX = 38;
  const HORIZONTAL_FAST_VELOCITY = 0.5;
  const VERTICAL_CLOSE_DISTANCE_PX = 92;
  const VERTICAL_FAST_DISTANCE_PX = 48;
  const VERTICAL_FAST_VELOCITY = 0.62;
  const ANIMATION_MS = 180;
  const MAX_PHOTO_SCALE = 4;
  let viewerInteraction = null;

  let bootAttempts = 0;
  let galleryGeneration = 0;
  let pointerGesture = null;
  let touchGuard = null;
  let suppressClickUntil = 0;

  const historyCache = new Map();
  const assetCache = new Map();

  const boot = () => {
    if (typeof openMediaViewer !== 'function' || typeof renderMediaViewer !== 'function' || typeof decryptBlobWithIvPrefix !== 'function') {
      if (bootAttempts++ < 100) setTimeout(boot, 50);
      return;
    }
    if (window.__fpMediaGallery134Installed) return;
    window.__fpMediaGallery134Installed = true;

    openMediaViewer = function openMediaViewer134(messageMedia, startIndex = 0) {
      const source = Array.isArray(messageMedia) ? messageMedia : [];
      const sourceItem = source[Number(startIndex) || 0] || source[0] || null;
      const initialItems = source.filter(isGalleryMedia);
      if (!initialItems.length || !sourceItem || !isGalleryMedia(sourceItem)) {
        mediaViewerState = { messageMedia: source, index: Number(startIndex) || 0, loaded: new Map() };
        renderMediaViewer();
        return;
      }

      const sourcePublicId = String(sourceItem.public_id || '');
      const initialIndex = Math.max(0, initialItems.findIndex((item) => String(item.public_id || '') === sourcePublicId));
      const roomId = String(state?.roomId || '');
      const generation = ++galleryGeneration;

      const nextViewer = {
        messageMedia: initialItems,
        index: initialIndex,
        loaded: new Map(),
        fpGallery134: true,
        fpRoomId: roomId,
        fpGeneration: generation,
      };
      const manager = window.FPMediaManager177;
      if (manager?.openViewer) manager.openViewer(nextViewer, openViewerWorker177);
      else openViewerWorker177(nextViewer);
      void hydrateWholeRoomGallery(roomId, sourcePublicId, generation, initialItems);
    };

    renderMediaViewer = renderMediaViewer134;
    installPointerGestures();
    installTouchGuard();
    installKeyboardNavigation();
    installViewerLifecycle185();
  };

  function openViewerWorker177(viewer) {
    mediaViewerState = viewer;
    renderMediaViewer();
    return viewer;
  }

  function isGalleryMedia(item) {
    const kind = String(item?.media_kind || '');
    return Boolean(item?.public_id) && (kind === 'image' || kind === 'video');
  }

  function mediaKey(roomId, item) {
    return `${roomId}:${String(item?.public_id || '')}`;
  }

  function currentGalleryState() {
    const v = typeof mediaViewerState !== 'undefined' ? mediaViewerState : null;
    return v?.fpGallery134 ? v : null;
  }

  function currentOverlay() {
    return document.querySelector('#mediaViewerRoot .media-viewer-overlay.fp-gallery134');
  }

  async function fetchWholeRoomMedia(roomId, force = false) {
    const now = Date.now();
    const cached = historyCache.get(roomId);
    if (!force && cached && now - cached.at < HISTORY_CACHE_MS) return cached.promise;

    const diagnostic186=window.FPRuntime169?.loading;
    const trace186=diagnostic186?.begin('gallery-history');
    const promise = (async () => {
      const persisted = STORAGE.get(STORAGE.roomState(roomId));
      const deviceId = persisted?.deviceId || (typeof activeChatDeviceId !== 'undefined' ? activeChatDeviceId : null);
      if (!roomId || !deviceId) throw new Error('gallery room unavailable');

      const messagesById = new Map();
      let before = null;
      let pages = 0;

      while (pages++ < 500) {
        const params = new URLSearchParams({ deviceId: String(deviceId), limit: String(HISTORY_LIMIT) });
        if (before != null) params.set('before', String(before));
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages?${params.toString()}`, { cache: 'no-store' });
        diagnostic186?.step(trace186,'history-page');
        if (!response.ok) { diagnostic186?.fail(trace186,'history',null,response.status); throw new Error(`gallery history ${response.status}`); }
        const data = await response.json().catch(() => null);
        if (!data || !Array.isArray(data.messages)) throw new Error('gallery history invalid');

        for (const message of data.messages) {
          const id = Number(message?.id);
          if (Number.isSafeInteger(id) && id > 0) messagesById.set(id, message);
        }

        const next = Number(data.nextCursor);
        const hasMore = data.hasMore === true;
        if (!hasMore || !Number.isSafeInteger(next) || next <= 0 || next === before || data.messages.length === 0) break;
        before = next;
      }

      const output = [];
      const seen = new Set();
      const orderedMessages = [...messagesById.values()].sort((a, b) => Number(a.id) - Number(b.id));
      for (const message of orderedMessages) {
        const media = Array.isArray(message.media) ? message.media : [];
        media.forEach((item, mediaIndex) => {
          if (!isGalleryMedia(item)) return;
          const publicId = String(item.public_id);
          if (seen.has(publicId)) return;
          seen.add(publicId);
          output.push({
            ...item,
            __fpMessageId: Number(message.id),
            __fpMediaOrder: Number.isFinite(Number(item.file_order)) ? Number(item.file_order) : mediaIndex,
          });
        });
      }
      output.sort((a, b) => (a.__fpMessageId - b.__fpMessageId) || (a.__fpMediaOrder - b.__fpMediaOrder));
      diagnostic186?.finish(trace186);
      return output;
    })();

    historyCache.set(roomId, { at: now, promise });
    try {
      return await promise;
    } catch (error) {
      diagnostic186?.fail(trace186,'history',error);
      if (historyCache.get(roomId)?.promise === promise) historyCache.delete(roomId);
      throw error;
    }
  }

  async function hydrateWholeRoomGallery(roomId, sourcePublicId, generation, initialItems) {
    if (!roomId || !sourcePublicId) return;
    try {
      let items = await fetchWholeRoomMedia(roomId, false);
      if (!items.some((item) => String(item.public_id) === sourcePublicId)) {
        items = await fetchWholeRoomMedia(roomId, true);
      }
      if (!items.some((item) => String(item.public_id) === sourcePublicId)) return;

      const v = currentGalleryState();
      if (!v || v.fpGeneration !== generation || v.fpRoomId !== roomId) return;
      const currentPublicId = String(v.messageMedia?.[v.index]?.public_id || sourcePublicId);
      const nextIndex = items.findIndex((item) => String(item.public_id) === currentPublicId);
      if (nextIndex < 0) return;

      v.messageMedia = items;
      v.index = nextIndex;
      renderMediaViewer134();
    } catch (error) {
      console.warn('Failed to build room media gallery', error);
      const v = currentGalleryState();
      if (!v || v.fpGeneration !== generation) return;
      if (!Array.isArray(v.messageMedia) || !v.messageMedia.length) {
        v.messageMedia = initialItems;
        v.index = 0;
        renderMediaViewer134();
      }
    }
  }

  function renderMediaViewer134() {
    const root = document.getElementById('mediaViewerRoot') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'mediaViewerRoot' }));
    const v = typeof mediaViewerState !== 'undefined' ? mediaViewerState : null;
    if (!v) {
      disposeInteraction185(viewerInteraction);
      root.innerHTML = '';
      pointerGesture = null;
      touchGuard = null;
      return;
    }

    if (!v.fpGallery134) {
      const source = Array.isArray(v.messageMedia) ? v.messageMedia.filter(isGalleryMedia) : [];
      if (!source.length) {
        disposeInteraction185(viewerInteraction);
        root.innerHTML = '';
        return;
      }
      const index = Math.max(0, Math.min(source.length - 1, Number(v.index) || 0));
      mediaViewerState = {
        ...v,
        messageMedia: source,
        index,
        fpGallery134: true,
        fpRoomId: String(state?.roomId || ''),
        fpGeneration: ++galleryGeneration,
      };
    }

    const stateNow = currentGalleryState();
    if (!stateNow?.messageMedia?.length) {
      disposeInteraction185(viewerInteraction);
      mediaViewerState = null;
      root.innerHTML = '';
      return;
    }
    stateNow.index = Math.max(0, Math.min(stateNow.messageMedia.length - 1, Number(stateNow.index) || 0));

    const interaction = interactionFor185(stateNow);
    if (pointerGesture?.interaction === interaction || interaction.transition) {
      interaction.renderPending = true;
      const counter = interaction.overlay?.querySelector('.fp-gallery134-counter');
      if (counter) counter.textContent = `${stateNow.index + 1} / ${stateNow.messageMedia.length}`;
      return;
    }
    unbindPhoto185(interaction);

    const canPrev = stateNow.index > 0;
    const canNext = stateNow.index < stateNow.messageMedia.length - 1;
    root.innerHTML = `<div class="media-viewer-overlay fp-gallery134" data-fp-gallery-index="${stateNow.index}">
      <button class="media-viewer-close" type="button" aria-label="Закрыть">×</button>
      <div class="fp-gallery134-counter">${stateNow.index + 1} / ${stateNow.messageMedia.length}</div>
      <div class="fp-gallery134-stage">
        <div class="fp-gallery134-track">
          <div class="fp-gallery134-slide" data-slot="prev"><div class="media-viewer-content"></div></div>
          <div class="fp-gallery134-slide is-current" data-slot="current"><div class="media-viewer-content"></div></div>
          <div class="fp-gallery134-slide" data-slot="next"><div class="media-viewer-content"></div></div>
        </div>
      </div>
      <button class="media-viewer-nav prev" type="button" aria-label="Предыдущее" ${canPrev ? '' : 'disabled'}>←</button>
      <button class="media-viewer-nav next" type="button" aria-label="Следующее" ${canNext ? '' : 'disabled'}>→</button>
    </div>`;

    const overlay = root.querySelector('.fp-gallery134');
    interaction.overlay = overlay;
    const stage = overlay.querySelector('.fp-gallery134-stage');
    const track = overlay.querySelector('.fp-gallery134-track');
    track.style.transform = 'translate3d(-100%,0,0)';

    mountSlot(overlay.querySelector('[data-slot="prev"] .media-viewer-content'), canPrev ? stateNow.messageMedia[stateNow.index - 1] : null, false, stateNow);
    mountSlot(overlay.querySelector('[data-slot="current"] .media-viewer-content'), stateNow.messageMedia[stateNow.index], true, stateNow);
    mountSlot(overlay.querySelector('[data-slot="next"] .media-viewer-content'), canNext ? stateNow.messageMedia[stateNow.index + 1] : null, false, stateNow);

    overlay.querySelector('.media-viewer-close').onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeGallery();
    };
    overlay.querySelector('.prev').onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void navigateGallery(-1, true);
    };
    overlay.querySelector('.next').onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void navigateGallery(1, true);
    };
    overlay.addEventListener('click', (event) => {
      if (Date.now() < suppressClickUntil) return;
      if (event.target === overlay || event.target === stage || event.target.classList?.contains('fp-gallery134-slide') || event.target.classList?.contains('media-viewer-content')) {
        closeGallery();
      }
    });

    const keep = new Set();
    [stateNow.index - 1, stateNow.index, stateNow.index + 1].forEach((index) => {
      const item = stateNow.messageMedia[index];
      if (item?.public_id) keep.add(mediaKey(stateNow.fpRoomId, item));
    });
    pruneAssetCache(keep);
  }

  function mountSlot(container, item, active, viewerState) {
    if (!container) return;
    if (!item) {
      container.innerHTML = '';
      return;
    }
    const publicId = String(item.public_id || '');
    container.dataset.publicId = publicId;
    container.innerHTML = '<div class="media-progress-ring">Загрузка...</div>';
    const diagnostic186=window.FPRuntime169?.loading;
    const consumer186=active?'gallery-current':'gallery-neighbor';
    const trace186=diagnostic186?.begin('viewer',{consumer:consumer186,endpoint:'blob'});
    diagnostic186?.step(trace186,'asset-start');
    void loadAsset(viewerState.fpRoomId, item, trace186, consumer186).then((asset) => {
      diagnostic186?.step(trace186,'asset-ready');
      if (!container.isConnected || container.dataset.publicId !== publicId) { diagnostic186?.finish(trace186,'cancelled'); return; }
      const live = currentGalleryState();
      if (!live || live.fpGeneration !== viewerState.fpGeneration) { diagnostic186?.finish(trace186,'cancelled'); return; }
      diagnostic186?.step(trace186,'url-ready');
      if (item.media_kind === 'video') {
        const video = document.createElement('video');
        video.src = asset.url;
        video.preload = 'metadata';
        video.playsInline = true;
        if (active) {
          video.controls = true;
          video.autoplay = true;
          video.addEventListener('loadeddata', () => video.play().catch(() => {}), { once: true });
        } else {
          video.muted = true;
        }
        diagnostic186?.watchElement(trace186,video);
        container.replaceChildren(video);
      } else {
        const image = document.createElement('img');
        diagnostic186?.watchElement(trace186,image);
        image.src = asset.url;
        image.alt = 'media';
        image.draggable = false;
        container.replaceChildren(image);
        if (active) bindPhoto185(viewerInteraction, image, viewerState, publicId);
      }
    }).catch((error) => {
      diagnostic186?.fail(trace186,'fetch',error);
      if (!container.isConnected || container.dataset.publicId !== publicId) return;
      container.innerHTML = '<div class="media-error-box"><span>Не удалось загрузить медиа</span><button type="button" class="btn btn-secondary">Повторить</button></div>';
      const retry = container.querySelector('button');
      retry?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropAsset(viewerState.fpRoomId, item);
        mountSlot(container, item, active, viewerState);
      });
    });
  }

  async function loadAsset(roomId, item, trace186=null, consumer186='other') {
    const key = mediaKey(roomId, item);
    const cached = assetCache.get(key);
    const diagnostic186=window.FPRuntime169?.loading;
    if (cached) { diagnostic186?.cache(trace186,cached.url?'ram-hit':'ram-pending'); return cached.promise; }

    const entry = { url: '', promise: null, controller:new AbortController() };
    entry.promise = (async () => {
      const persisted = STORAGE.get(STORAGE.roomState(roomId));
      if (!persisted?.deviceId) throw new Error('gallery device unavailable');
      diagnostic186?.step(trace186,'key-start');
      let key;
      try { key=await getRoomKey(roomId); }
      catch (error) { diagnostic186?.fail(trace186,'key',error); throw error; }
      diagnostic186?.step(trace186,'key-ready');
      const plain=await readEncryptedMedia174(`/api/media/${encodeURIComponent(item.public_id)}/blob?deviceId=${encodeURIComponent(persisted.deviceId)}`,item.mime_type || 'application/octet-stream',key,{signal:entry.controller.signal,fpConsumer186:consumer186,fpParent186:trace186?.id});
      if(entry.controller.signal.aborted||assetCache.get(mediaKey(roomId,item))!==entry)throw new DOMException('Stale gallery asset','AbortError');
      entry.url = URL.createObjectURL(plain);
      return { url: entry.url };
    })();
    assetCache.set(key, entry);
    try {
      return await entry.promise;
    } catch (error) {
      if(assetCache.get(key)===entry)assetCache.delete(key);
      throw error;
    }
  }

  function dropAsset(roomId, item) {
    const key = mediaKey(roomId, item);
    const entry = assetCache.get(key);
    entry?.controller?.abort();
    if (entry?.url) URL.revokeObjectURL(entry.url);
    assetCache.delete(key);
  }

  function pruneAssetCache(keep) {
    for (const [key, entry] of assetCache) {
      if (keep.has(key)) continue;
      entry?.controller?.abort();
      if (entry?.url) URL.revokeObjectURL(entry.url);
      assetCache.delete(key);
    }
  }

  function closeGalleryWorker177(viewer) {
    if (!viewer || mediaViewerState !== viewer) return false;
    disposeInteraction185(viewerInteraction);
    touchGuard = null;
    mediaViewerState = null;
    renderMediaViewer134();
    return true;
  }

  function closeGallery(viewer = currentGalleryState()) {
    if (!viewer) return false;
    const manager = window.FPMediaManager177;
    if (manager?.closeViewer) return manager.closeViewer(viewer, closeGalleryWorker177);
    return closeGalleryWorker177(viewer);
  }

  async function navigateGallery(direction, animate) {
    const v = currentGalleryState();
    const overlay = currentOverlay();
    const z = viewerInteraction;
    if (!v || !overlay || !isLive185(z) || pointerGesture || z.transition) return false;
    const nextIndex = v.index + direction;
    if (nextIndex < 0 || nextIndex >= v.messageMedia.length) {
      resetHorizontalVisual(overlay, true);
      return false;
    }
    const targetId = String(v.messageMedia[nextIndex].public_id);
    const track = overlay.querySelector('.fp-gallery134-track');
    if (!track) return false;
    if (animate) {
      track.classList.add('fp-gallery134-anim');
      track.style.transform = direction > 0 ? 'translate3d(-200%,0,0)' : 'translate3d(0,0,0)';
      if (!await transition185(z, ANIMATION_MS)) return false;
    }
    if (!isLive185(z) || currentOverlay() !== overlay) return false;
    const index = v.messageMedia.findIndex(item => String(item.public_id) === targetId);
    if (index < 0) { renderMediaViewer134(); return false; }
    v.index = index;
    renderMediaViewer134();
    return true;
  }

  function isLive185(z) {
    return Boolean(z && !z.disposed && viewerInteraction === z && currentGalleryState() === z.viewer
      && String(z.viewer.messageMedia[z.viewer.index]?.public_id || '') === z.key);
  }

  function interactionFor185(viewer) {
    const key = String(viewer.messageMedia[viewer.index]?.public_id || '');
    if (viewerInteraction?.viewer === viewer && viewerInteraction.key === key) return viewerInteraction;
    disposeInteraction185(viewerInteraction);
    const z = { viewer, key, scale: 1, x: 0, y: 0, ready: false, raf: 0,
      image: null, overlay: null, observer: null, imageCleanup: null,
      transition: null, renderPending: false, disposed: false };
    viewerInteraction = z;
    window.FPMediaManager177?.ownViewerCleanup?.(viewer, () => disposeInteraction185(z));
    return z;
  }

  function unbindPhoto185(z) {
    cancelAnimationFrame(z.raf);
    z.raf = 0;
    z.observer?.disconnect();
    z.observer = null;
    z.imageCleanup?.();
    z.imageCleanup = null;
    if (z.image) { z.image.style.transform = ''; z.image.style.willChange = ''; }
    z.image = null;
    z.ready = false;
  }

  function disposeInteraction185(z) {
    if (!z || z.disposed) return;
    z.disposed = true;
    cancelGesture185(z);
    cancelTransition185(z);
    unbindPhoto185(z);
    z.overlay = null;
    if (viewerInteraction === z) viewerInteraction = null;
  }

  function bindPhoto185(z, image, viewer, key) {
    if (!isLive185(z) || z.viewer !== viewer || z.key !== key || !image.isConnected) return;
    unbindPhoto185(z);
    z.image = image;
    image.classList.add('fp-photo-zoom185');
    const ready = () => { if (isLive185(z) && z.image === image) measurePhoto185(z); };
    image.addEventListener('load', ready);
    z.imageCleanup = () => image.removeEventListener('load', ready);
    if (typeof ResizeObserver === 'function') {
      z.observer = new ResizeObserver(ready);
      z.observer.observe(image);
      z.observer.observe(z.overlay.querySelector('.fp-gallery134-stage'));
    }
    ready();
  }

  function measurePhoto185(z) {
    if (!isLive185(z) || !z.image?.isConnected || !z.image.naturalWidth) return;
    // A late image load must not undo a navigation/dismiss already committed
    // on pointerup. The destination render (or cancellation) remeasures it.
    if (z.transition) return;
    const stage = z.overlay.querySelector('.fp-gallery134-stage');
    // Layout sizes exclude our transform. Read only on load/resize, never move.
    const width = z.image.offsetWidth, height = z.image.offsetHeight;
    const style = getComputedStyle(z.image.parentElement);
    const vw = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const vh = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (!(width > 0 && height > 0 && vw > 0 && vh > 0)) { z.ready = false; return; }
    if (z.ready && width === z.width && height === z.height && vw === z.vw && vh === z.vh) return;
    cancelGesture185(z);
    cancelTransition185(z);
    if (z.width && z.height) { z.x *= width / z.width; z.y *= height / z.height; }
    const rect = stage.getBoundingClientRect();
    Object.assign(z, { width, height, vw, vh, cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2, ready: true });
    clampPhoto185(z);
    queuePhoto185(z);
  }

  function clampPhoto185(z) {
    z.scale = Math.max(1, Math.min(MAX_PHOTO_SCALE, z.scale));
    const lx = Math.max(0, (z.width * z.scale - z.vw) / 2);
    const ly = Math.max(0, (z.height * z.scale - z.vh) / 2);
    z.x = Math.max(-lx, Math.min(lx, z.x));
    z.y = Math.max(-ly, Math.min(ly, z.y));
  }

  function queuePhoto185(z) {
    if (z.raf || !isLive185(z) || !z.ready) return;
    z.raf = requestAnimationFrame(() => {
      z.raf = 0;
      if (!isLive185(z) || !z.image?.isConnected) return;
      z.image.style.transform = `translate3d(${z.x}px,${z.y}px,0) scale(${z.scale})`;
    });
  }

  function cancelTransition185(z) {
    if (!z?.transition) return;
    const pending = z.transition;
    z.transition = null;
    clearTimeout(pending.timer);
    resetHorizontalVisual(z.overlay, false);
    resetVerticalVisual(z.overlay, false);
    pending.resolve(false);
    flushRender185(z);
    queueMicrotask(() => { if (isLive185(z)) measurePhoto185(z); });
  }

  function transition185(z, ms) {
    return new Promise(resolve => {
      const pending = { resolve, timer: 0 };
      z.transition = pending;
      const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
      pending.timer = setTimeout(() => {
        if (z.transition !== pending) return;
        z.transition = null;
        resolve(isLive185(z));
      }, duration);
    });
  }

  function flushRender185(z) {
    if (!z?.renderPending || z.disposed) return;
    queueMicrotask(() => {
      if (!isLive185(z) || pointerGesture || z.transition || !z.renderPending) return;
      z.renderPending = false;
      renderMediaViewer134();
    });
  }

  function releaseCaptures185(g) {
    for (const id of g.pointers.keys()) {
      try { if (g.stage.hasPointerCapture(id)) g.stage.releasePointerCapture(id); } catch {}
    }
  }

  function cancelGesture185(z) {
    const g = pointerGesture;
    if (!g || g.interaction !== z) return;
    pointerGesture = null;
    g.lease?.release();
    releaseCaptures185(g);
    g.pointers.clear();
    if (z.image) z.image.style.willChange = '';
    if (g.moved || g.multi) suppressClickUntil = Date.now() + 420;
    resetHorizontalVisual(g.overlay, false);
    resetVerticalVisual(g.overlay, false);
    flushRender185(z);
  }

  function rebaseGesture185(g) {
    const z = g.interaction;
    if (g.pointers.size >= 2) {
      g.multi = true;
      g.moved = true;
      resetHorizontalVisual(g.overlay, false);
      resetVerticalVisual(g.overlay, false);
      if (!z.ready) { g.mode = 'drain'; return; }
      g.pair = [...g.pointers.keys()].slice(0, 2);
      const a = g.pointers.get(g.pair[0]), b = g.pointers.get(g.pair[1]);
      const cx = (a.x + b.x) / 2 - z.cx, cy = (a.y + b.y) / 2 - z.cy;
      g.anchor = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: z.scale,
        qx: (cx - z.x) / z.scale, qy: (cy - z.y) / z.scale };
      g.mode = 'pinch';
    } else if (g.pointers.size === 1) {
      const p = g.pointers.values().next().value;
      g.anchor = { px: p.x, py: p.y, x: z.x, y: z.y };
      g.mode = z.ready && z.scale > 1 ? 'pan' : (g.multi ? 'drain' : 'swipe');
    }
  }

  function moveGesture185(g, event) {
    const z = g.interaction;
    if (!isLive185(z) || !g.lease?.active()) { cancelGesture185(z); return; }
    const p = g.pointers.get(event.pointerId);
    if (!p) return;
    p.x = event.clientX; p.y = event.clientY;
    g.lastX = p.x; g.lastY = p.y;
    if (g.mode === 'pinch') {
      const a = g.pointers.get(g.pair[0]), b = g.pointers.get(g.pair[1]);
      if (g.anchor.distance < 1) { rebaseGesture185(g); return; }
      z.scale = Math.max(1, Math.min(MAX_PHOTO_SCALE, g.anchor.scale * Math.hypot(a.x - b.x, a.y - b.y) / g.anchor.distance));
      z.x = (a.x + b.x) / 2 - z.cx - z.scale * g.anchor.qx;
      z.y = (a.y + b.y) / 2 - z.cy - z.scale * g.anchor.qy;
      clampPhoto185(z);
      queuePhoto185(z);
    } else if (g.mode === 'pan') {
      z.x = g.anchor.x + p.x - g.anchor.px;
      z.y = g.anchor.y + p.y - g.anchor.py;
      clampPhoto185(z);
      queuePhoto185(z);
      if (Math.hypot(p.x - g.anchor.px, p.y - g.anchor.py) >= AXIS_LOCK_PX) g.moved = true;
    } else if (g.mode === 'swipe') {
      const dx = p.x - g.startX, dy = p.y - g.startY;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (g.axis === 'pending') {
        if (Math.max(ax, ay) < AXIS_LOCK_PX) return;
        if (ax > ay * 1.08) g.axis = 'horizontal';
        else if (ay > ax * 1.08) g.axis = 'vertical';
        else return;
      }
      g.moved = true;
      if (g.axis === 'horizontal') {
        const v = z.viewer;
        const atEdge = (v.index <= 0 && dx > 0) || (v.index >= v.messageMedia.length - 1 && dx < 0);
        g.track.classList.remove('fp-gallery134-anim');
        g.track.style.transform = `translate3d(calc(-100% + ${atEdge ? dx * .22 : dx}px),0,0)`;
      } else {
        const progress = Math.min(1, ay / Math.max(150, window.innerHeight * .28));
        g.stage.classList.remove('fp-gallery134-stage-reset');
        g.stage.style.transform = `translate3d(0, ${dy * .9}px, 0) scale(${1 - .055 * progress})`;
        g.stage.style.opacity = String(1 - .34 * progress);
      }
    }
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }

  function finishGesture185(event, cancelled) {
    const g = pointerGesture;
    if (!g || !g.pointers.has(event.pointerId)) return;
    const z = g.interaction;
    if (cancelled || !isLive185(z)) { cancelGesture185(z); return; }
    g.pointers.delete(event.pointerId);
    try { if (g.stage.hasPointerCapture(event.pointerId)) g.stage.releasePointerCapture(event.pointerId); } catch {}
    if (g.pointers.size) {
      if (!g.pair?.every(id => g.pointers.has(id))) rebaseGesture185(g);
      return;
    }
    pointerGesture = null;
    g.lease?.release();
    if (z.image) z.image.style.willChange = '';
    if (g.moved || g.multi) { suppressClickUntil = Date.now() + 420; event.stopPropagation(); }
    if (g.multi || g.mode !== 'swipe' || g.axis === 'pending') {
      resetHorizontalVisual(g.overlay, true);
      resetVerticalVisual(g.overlay, true);
      flushRender185(z);
      return;
    }
    const dx = g.lastX - g.startX, dy = g.lastY - g.startY;
    const dt = Math.max(1, performance.now() - g.startedAt);
    if (g.axis === 'horizontal') {
      const enough = Math.abs(dx) >= HORIZONTAL_DISTANCE_PX || (Math.abs(dx) >= HORIZONTAL_FAST_DISTANCE_PX && Math.abs(dx) / dt >= HORIZONTAL_FAST_VELOCITY);
      if (enough) void navigateGallery(dx < 0 ? 1 : -1, true);
      else resetHorizontalVisual(g.overlay, true);
    } else {
      const enough = Math.abs(dy) >= VERTICAL_CLOSE_DISTANCE_PX || (Math.abs(dy) >= VERTICAL_FAST_DISTANCE_PX && Math.abs(dy) / dt >= VERTICAL_FAST_VELOCITY);
      if (enough) {
        g.stage.classList.add('fp-gallery134-stage-close');
        g.stage.style.transform = `translate3d(0, ${dy < 0 ? -112 : 112}vh, 0) scale(.94)`;
        g.stage.style.opacity = '0';
        navigator.vibrate?.(8);
        void transition185(z, 155).then(valid => { if (valid) closeGallery(z.viewer); });
      } else resetVerticalVisual(g.overlay, true);
    }
    flushRender185(z);
  }

  function installPointerGestures() {
    window.addEventListener('pointerdown', event => {
      const overlay = event.target?.closest?.('.media-viewer-overlay.fp-gallery134');
      const z = viewerInteraction;
      if (!overlay || !isLive185(z) || z.transition || event.pointerType === 'mouse' || event.button !== 0) return;
      const arbiter = window.FPGesture135;
      if (!arbiter || arbiter.currentLayer(event, event.target) !== 'viewer') return;
      if (event.target?.closest?.('button,video,input,a')) return;
      if (!event.target?.closest?.('.fp-gallery134-stage')) return;
      if (pointerGesture && pointerGesture.interaction !== z) return;
      let g = pointerGesture;
      if (!g) {
        const stage = overlay.querySelector('.fp-gallery134-stage');
        const track = overlay.querySelector('.fp-gallery134-track');
        g = { interaction: z, overlay, stage, track, pointers: new Map(), pair: null,
          startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY,
          startedAt: performance.now(), axis: 'pending', moved: false, multi: false, mode: 'swipe' };
        g.lease = arbiter.watchAction('viewer:interaction', event, () => cancelGesture185(z),
          { multiPointer: true, onPointerEnd: finishGesture185 });
        if (!g.lease?.claim()) { g.lease?.release(); return; }
        pointerGesture = g;
        resetHorizontalVisual(overlay, false);
        resetVerticalVisual(overlay, false);
      } else if (!g.lease.active()) return;
      g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      // A third contact must not change the established pinch anchor.
      if (g.pointers.size <= 2) rebaseGesture185(g);
      if (z.image) z.image.style.willChange = 'transform';
      try { g.stage.setPointerCapture(event.pointerId); } catch {}
    }, { capture: true, passive: true });

    window.addEventListener('pointermove', event => {
      if (pointerGesture) moveGesture185(pointerGesture, event);
    }, { capture: true, passive: false });
    // Normal up/cancel arrives through the arbiter before it tears down its lease.
    window.addEventListener('lostpointercapture', event => {
      if (pointerGesture?.pointers.has(event.pointerId)) cancelGesture185(pointerGesture.interaction);
    }, { capture: true, passive: true });
    window.addEventListener('click', event => {
      if (Date.now() >= suppressClickUntil || event.target?.closest?.('button,video,input,a')) return;
      if (!event.target?.closest?.('.media-viewer-overlay.fp-gallery134')) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  function installViewerLifecycle185() {
    window.FPLifecycle170?.subscribe(event => {
      const z = viewerInteraction;
      if (!z) return;
      if (['blur', 'pagehide', 'background'].includes(event.lastType)) {
        cancelGesture185(z);
        cancelTransition185(z);
        cancelAnimationFrame(z.raf);
        z.raf = 0;
        touchGuard = null;
      } else if (['foreground', 'pageshow'].includes(event.lastType)) {
        measurePhoto185(z);
        queuePhoto185(z);
        flushRender185(z);
      }
    });
    window.FPDOM173?.on('viewer', 'unmounted', ({ node }) => {
      const z = viewerInteraction;
      if (z?.overlay === node && !node.isConnected) disposeInteraction185(z);
    });
    window.FPRuntime?.registerOwner?.('media-gallery185', {
      role: 'viewer-interaction-executor', mode: 'active-owner',
      owns: 'photo transform + local geometry + gesture execution; admission FPGesture135; lifetime FPMediaManager177'
    });
  }

  function installTouchGuard() {
    window.addEventListener('touchstart', (event) => {
      const overlay = event.target?.closest?.('.media-viewer-overlay.fp-gallery134');
      if (!overlay || event.target?.closest?.('button,video,input,a') || event.touches?.length !== 1) {
        touchGuard = null;
        return;
      }
      const touch = event.touches[0];
      touchGuard = { x: touch.clientX, y: touch.clientY, moved: false };
    }, { capture: true, passive: true });

    window.addEventListener('touchmove', (event) => {
      if (pointerGesture?.multi) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!touchGuard || event.touches?.length !== 1 || !currentOverlay()) return;
      const touch = event.touches[0];
      if (!touchGuard.moved && Math.hypot(touch.clientX - touchGuard.x, touch.clientY - touchGuard.y) >= AXIS_LOCK_PX) touchGuard.moved = true;
      if (!touchGuard.moved) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    }, { capture: true, passive: false });

    const end = (event) => {
      if (touchGuard?.moved) event.stopPropagation();
      touchGuard = null;
    };
    window.addEventListener('touchend', end, { capture: true, passive: true });
    window.addEventListener('touchcancel', end, { capture: true, passive: true });
  }

  function installKeyboardNavigation() {
    window.addEventListener('keydown', (event) => {
      if (!currentOverlay()) return;
      if (event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void navigateGallery(-1, true);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        void navigateGallery(1, true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeGallery();
      }
    }, true);
  }

  function resetHorizontalVisual(overlay, animate) {
    const track = overlay?.querySelector('.fp-gallery134-track');
    if (!track) return;
    track.classList.toggle('fp-gallery134-anim', Boolean(animate));
    track.style.transform = 'translate3d(-100%,0,0)';
  }

  function resetVerticalVisual(overlay, animate) {
    const stage = overlay?.querySelector('.fp-gallery134-stage');
    if (!stage) return;
    stage.classList.remove('fp-gallery134-stage-close');
    stage.classList.toggle('fp-gallery134-stage-reset', Boolean(animate));
    stage.style.transform = '';
    stage.style.opacity = '';
  }

  boot();
})();
