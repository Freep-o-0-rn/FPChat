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
        if (!response.ok) throw new Error(`gallery history ${response.status}`);
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
      return output;
    })();

    historyCache.set(roomId, { at: now, promise });
    try {
      return await promise;
    } catch (error) {
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
      if (!pointerGesture) renderMediaViewer134();
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
      root.innerHTML = '';
      pointerGesture = null;
      touchGuard = null;
      return;
    }

    if (!v.fpGallery134) {
      const source = Array.isArray(v.messageMedia) ? v.messageMedia.filter(isGalleryMedia) : [];
      if (!source.length) {
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
      mediaViewerState = null;
      root.innerHTML = '';
      return;
    }
    stateNow.index = Math.max(0, Math.min(stateNow.messageMedia.length - 1, Number(stateNow.index) || 0));

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
    void loadAsset(viewerState.fpRoomId, item).then((asset) => {
      if (!container.isConnected || container.dataset.publicId !== publicId) return;
      const live = currentGalleryState();
      if (!live || live.fpGeneration !== viewerState.fpGeneration) return;
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
        container.replaceChildren(video);
      } else {
        const image = document.createElement('img');
        image.src = asset.url;
        image.alt = 'media';
        image.draggable = false;
        container.replaceChildren(image);
      }
    }).catch(() => {
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

  async function loadAsset(roomId, item) {
    const key = mediaKey(roomId, item);
    const cached = assetCache.get(key);
    if (cached) return cached.promise;

    const entry = { url: '', promise: null, controller:new AbortController() };
    entry.promise = (async () => {
      const persisted = STORAGE.get(STORAGE.roomState(roomId));
      if (!persisted?.deviceId) throw new Error('gallery device unavailable');
      const key=await getRoomKey(roomId);
      const plain=await readEncryptedMedia174(`/api/media/${encodeURIComponent(item.public_id)}/blob?deviceId=${encodeURIComponent(persisted.deviceId)}`,item.mime_type || 'application/octet-stream',key,{signal:entry.controller.signal});
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
    pointerGesture = null;
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
    if (!v || !overlay) return false;
    const nextIndex = v.index + direction;
    if (nextIndex < 0 || nextIndex >= v.messageMedia.length) {
      resetHorizontalVisual(overlay, true);
      return false;
    }

    const track = overlay.querySelector('.fp-gallery134-track');
    if (!track) return false;
    if (animate) {
      track.classList.add('fp-gallery134-anim');
      track.style.transform = direction > 0 ? 'translate3d(-200%,0,0)' : 'translate3d(0,0,0)';
      await delay(ANIMATION_MS);
    }
    const live = currentGalleryState();
    if (!live || live !== v) return false;
    live.index = nextIndex;
    renderMediaViewer134();
    return true;
  }

  function installPointerGestures() {
    window.addEventListener('pointerdown', (event) => {
      const overlay = event.target?.closest?.('.media-viewer-overlay.fp-gallery134');
      if (!overlay || event.pointerType === 'mouse' || event.button !== 0) return;
      try {
        const manager = window.FPGesture135;
        if (manager && manager.currentLayer(event, event.target) !== 'viewer') return;
      } catch { return; }
      if (event.target?.closest?.('.media-viewer-close,.media-viewer-nav,.media-error-box button')) return;
      const stage = overlay.querySelector('.fp-gallery134-stage');
      const track = overlay.querySelector('.fp-gallery134-track');
      if (!stage || !track) return;
      pointerGesture = {
        pointerId: event.pointerId,
        overlay,
        stage,
        track,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        startedAt: performance.now(),
        axis: 'pending',
        moved: false,
      };
    }, { capture: true, passive: true });

    window.addEventListener('pointermove', (event) => {
      const gesture = pointerGesture;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);

      if (gesture.axis === 'pending') {
        if (Math.max(ax, ay) < AXIS_LOCK_PX) return;
        if (ax > ay * 1.08) gesture.axis = 'horizontal';
        else if (ay > ax * 1.08) gesture.axis = 'vertical';
        else return;
      }

      gesture.moved = true;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      const v = currentGalleryState();
      if (!v) return;

      if (gesture.axis === 'horizontal') {
        gesture.stage.style.transform = '';
        gesture.stage.style.opacity = '';
        const atStart = v.index <= 0 && dx > 0;
        const atEnd = v.index >= v.messageMedia.length - 1 && dx < 0;
        const effectiveDx = (atStart || atEnd) ? dx * .22 : dx;
        gesture.track.classList.remove('fp-gallery134-anim');
        gesture.track.style.transform = `translate3d(calc(-100% + ${effectiveDx}px),0,0)`;
        return;
      }

      gesture.track.classList.remove('fp-gallery134-anim');
      gesture.track.style.transform = 'translate3d(-100%,0,0)';
      const progress = Math.min(1, ay / Math.max(150, window.innerHeight * .28));
      gesture.stage.classList.remove('fp-gallery134-stage-reset');
      gesture.stage.style.transform = `translate3d(0, ${dy * .9}px, 0) scale(${1 - .055 * progress})`;
      gesture.stage.style.opacity = String(1 - .34 * progress);
    }, { capture: true, passive: false });

    const finish = (event, cancelled) => {
      const gesture = pointerGesture;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      pointerGesture = null;
      const dx = gesture.lastX - gesture.startX;
      const dy = gesture.lastY - gesture.startY;
      const dt = Math.max(1, performance.now() - gesture.startedAt);
      if (gesture.moved) {
        suppressClickUntil = Date.now() + 420;
        event.stopPropagation();
      }

      if (cancelled || gesture.axis === 'pending') {
        resetHorizontalVisual(gesture.overlay, true);
        resetVerticalVisual(gesture.overlay, true);
        return;
      }

      if (gesture.axis === 'horizontal') {
        const velocity = Math.abs(dx) / dt;
        const enough = Math.abs(dx) >= HORIZONTAL_DISTANCE_PX || (Math.abs(dx) >= HORIZONTAL_FAST_DISTANCE_PX && velocity >= HORIZONTAL_FAST_VELOCITY);
        if (!enough) {
          resetHorizontalVisual(gesture.overlay, true);
          return;
        }
        const direction = dx < 0 ? 1 : -1;
        void navigateGallery(direction, true);
        return;
      }

      const velocity = Math.abs(dy) / dt;
      const shouldClose = Math.abs(dy) >= VERTICAL_CLOSE_DISTANCE_PX || (Math.abs(dy) >= VERTICAL_FAST_DISTANCE_PX && velocity >= VERTICAL_FAST_VELOCITY);
      if (!shouldClose) {
        resetVerticalVisual(gesture.overlay, true);
        return;
      }
      const direction = dy < 0 ? -1 : 1;
      const stage = gesture.overlay.querySelector('.fp-gallery134-stage');
      if (!stage) return closeGallery();
      stage.classList.add('fp-gallery134-stage-close');
      stage.style.transform = `translate3d(0, ${direction * 112}vh, 0) scale(.94)`;
      stage.style.opacity = '0';
      navigator.vibrate?.(8);
      setTimeout(() => {
        if (currentOverlay() === gesture.overlay) closeGallery();
      }, 155);
    };

    window.addEventListener('pointerup', (event) => finish(event, false), { capture: true, passive: true });
    window.addEventListener('pointercancel', (event) => finish(event, true), { capture: true, passive: true });

    window.addEventListener('click', (event) => {
      if (Date.now() >= suppressClickUntil) return;
      if (!event.target?.closest?.('.media-viewer-overlay.fp-gallery134')) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  function installTouchGuard() {
    window.addEventListener('touchstart', (event) => {
      const overlay = event.target?.closest?.('.media-viewer-overlay.fp-gallery134');
      if (!overlay || event.touches?.length !== 1) {
        touchGuard = null;
        return;
      }
      const touch = event.touches[0];
      touchGuard = { x: touch.clientX, y: touch.clientY, moved: false };
    }, { capture: true, passive: true });

    window.addEventListener('touchmove', (event) => {
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
    if (animate) track.classList.add('fp-gallery134-anim');
    track.style.transform = 'translate3d(-100%,0,0)';
    if (animate) setTimeout(() => track.classList.remove('fp-gallery134-anim'), ANIMATION_MS + 30);
  }

  function resetVerticalVisual(overlay, animate) {
    const stage = overlay?.querySelector('.fp-gallery134-stage');
    if (!stage) return;
    stage.classList.remove('fp-gallery134-stage-close');
    if (animate) stage.classList.add('fp-gallery134-stage-reset');
    stage.style.transform = '';
    stage.style.opacity = '';
    if (animate) setTimeout(() => stage.classList.remove('fp-gallery134-stage-reset'), ANIMATION_MS + 30);
  }

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  boot();
})();
