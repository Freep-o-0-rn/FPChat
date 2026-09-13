/* Build 128: isolated UI hotfix for pinned voice progress and photo viewer swipe-close. */
(() => {
  if (window.__fpUiHotfix128Installed) return;
  window.__fpUiHotfix128Installed = true;

  const PHOTO_CLOSE_DISTANCE_PX = 92;
  const PHOTO_FAST_DISTANCE_PX = 48;
  const PHOTO_FAST_VELOCITY = 0.62;
  const TIME_SELECTOR = '.fp-pins127-time';

  const style = document.createElement('style');
  style.dataset.fpUiHotfix128 = '1';
  style.textContent = `
    .fp-pins128-time-proxy::before {
      content: attr(data-fp128-time);
    }

    #mediaViewerRoot .media-viewer-content img {
      touch-action: none;
    }

    .media-viewer-overlay.fp-media-swipe128 .media-viewer-content {
      touch-action: none;
      will-change: transform, opacity;
    }

    .media-viewer-overlay.fp-media-swipe128.fp-media-swipe-moving .media-viewer-content {
      transition: none !important;
    }

    .media-viewer-overlay.fp-media-swipe128.fp-media-swipe-reset .media-viewer-content {
      transition: transform .18s ease-out, opacity .18s ease-out !important;
    }

    .media-viewer-overlay.fp-media-swipe128.fp-media-swipe-closing .media-viewer-content {
      pointer-events: none;
      transition: transform .15s ease-in, opacity .15s ease-in !important;
    }
  `;
  document.head.appendChild(style);

  function parseClock(value) {
    const match = String(value || '').trim().match(/^(\d+):(\d{2})$/);
    if (!match) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function playbackSpeed() {
    const value = Number(localStorage.getItem('fpchat:voice-speed') || 1);
    return [1, 1.5, 2].includes(value) ? value : 1;
  }

  function updatePinnedVoiceClock(el, label) {
    const parts = String(label || '').split('/').map((part) => part.trim());
    if (parts.length !== 2) return;
    const seconds = parseClock(parts[0]);
    const duration = parseClock(parts[1]);
    if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return;

    const now = performance.now();
    let clock = el.__fp128Clock;
    if (!clock || clock.seconds !== seconds || clock.duration !== duration) {
      clock = { seconds, duration, changedAt: now };
      el.__fp128Clock = clock;
    }

    const elapsed = Math.max(0, (now - clock.changedAt) / 1000) * playbackSpeed();
    const estimated = Math.min(duration, seconds + Math.min(.98, elapsed));
    const root = el.closest('.fp-pins127-player');
    if (root) root.dataset.pendingSeek = String(Math.max(0, Math.min(1, estimated / duration)));
  }

  function stabilizePinnedVoiceTime(el) {
    if (!(el instanceof HTMLElement) || el.dataset.fp128TimeProxy === '1') return;
    const initial = String(el.textContent || '');
    el.dataset.fp128TimeProxy = '1';
    el.dataset.fp128Time = initial;
    el.classList.add('fp-pins128-time-proxy');

    try {
      el.replaceChildren();
      Object.defineProperty(el, 'textContent', {
        configurable: true,
        enumerable: false,
        get() {
          return String(this.dataset.fp128Time || '');
        },
        set(value) {
          const label = String(value ?? '');
          if (this.dataset.fp128Time !== label) this.dataset.fp128Time = label;
          updatePinnedVoiceClock(this, label);
        }
      });
      updatePinnedVoiceClock(el, initial);
    } catch {
      el.classList.remove('fp-pins128-time-proxy');
      el.dataset.fp128TimeProxy = '0';
      el.textContent = initial;
    }
  }

  function scanPinnedVoiceTimes(root = document) {
    if (root?.matches?.(TIME_SELECTOR)) stabilizePinnedVoiceTime(root);
    root?.querySelectorAll?.(TIME_SELECTOR).forEach(stabilizePinnedVoiceTime);
  }

  scanPinnedVoiceTimes();

  const pinnedObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes || []) {
        if (node.nodeType === 1) scanPinnedVoiceTimes(node);
      }
    }
  });
  pinnedObserver.observe(document.documentElement, { childList: true, subtree: true });

  let photoGesture = null;

  function imageViewerFromEvent(event) {
    const overlay = event.target?.closest?.('.media-viewer-overlay');
    if (!overlay) return null;
    const content = overlay.querySelector('.media-viewer-content');
    const image = content?.querySelector('img');
    if (!content || !image || content.querySelector('video')) return null;
    if (event.target?.closest?.('.media-viewer-close,.media-viewer-nav,button')) return null;
    if (!content.contains(event.target)) return null;
    return { overlay, content, image };
  }

  function resetPhotoVisual(gesture, animate = true) {
    if (!gesture?.overlay || !gesture?.content) return;
    gesture.overlay.classList.remove('fp-media-swipe-moving', 'fp-media-swipe-closing');
    if (animate) gesture.overlay.classList.add('fp-media-swipe-reset');
    gesture.content.style.transform = '';
    gesture.content.style.opacity = '';
    if (animate) {
      setTimeout(() => gesture.overlay?.classList.remove('fp-media-swipe-reset'), 190);
    } else {
      gesture.overlay.classList.remove('fp-media-swipe-reset');
    }
  }

  function finishPhotoGesture(event, cancelled = false) {
    const gesture = photoGesture;
    if (!gesture) return;
    if (event?.pointerId != null && gesture.pointerId != null && event.pointerId !== gesture.pointerId) return;
    photoGesture = null;

    const dy = Number(gesture.lastY - gesture.startY) || 0;
    const dt = Math.max(1, performance.now() - gesture.startedAt);
    const velocity = Math.abs(dy) / dt;
    const shouldClose = !cancelled && gesture.vertical && (
      Math.abs(dy) >= PHOTO_CLOSE_DISTANCE_PX ||
      (Math.abs(dy) >= PHOTO_FAST_DISTANCE_PX && velocity >= PHOTO_FAST_VELOCITY)
    );

    if (!shouldClose) {
      resetPhotoVisual(gesture, true);
      return;
    }

    const direction = dy < 0 ? -1 : 1;
    gesture.overlay.classList.remove('fp-media-swipe-moving', 'fp-media-swipe-reset');
    gesture.overlay.classList.add('fp-media-swipe-closing');
    gesture.content.style.transform = `translate3d(0, ${direction * 112}vh, 0) scale(.94)`;
    gesture.content.style.opacity = '0';
    navigator.vibrate?.(8);

    setTimeout(() => {
      const close = gesture.overlay?.querySelector('.media-viewer-close');
      if (close?.isConnected) close.click();
      else resetPhotoVisual(gesture, false);
    }, 145);
  }

  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType && event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    const viewer = imageViewerFromEvent(event);
    if (!viewer) return;
    viewer.overlay.classList.add('fp-media-swipe128');
    photoGesture = {
      ...viewer,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startedAt: performance.now(),
      vertical: false,
      rejected: false
    };
    try { viewer.content.setPointerCapture?.(event.pointerId); } catch {}
  }, true);

  document.addEventListener('pointermove', (event) => {
    const gesture = photoGesture;
    if (!gesture || gesture.rejected) return;
    if (event.pointerId != null && gesture.pointerId != null && event.pointerId !== gesture.pointerId) return;

    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);

    if (!gesture.vertical) {
      if (Math.max(ax, ay) < 9) return;
      if (ax > ay * 1.08) {
        gesture.rejected = true;
        resetPhotoVisual(gesture, false);
        return;
      }
      if (ay <= ax * 1.08) return;
      gesture.vertical = true;
      gesture.overlay.classList.remove('fp-media-swipe-reset');
      gesture.overlay.classList.add('fp-media-swipe-moving');
    }

    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    const progress = Math.min(1, ay / Math.max(150, window.innerHeight * .28));
    const translate = dy * .9;
    const scale = 1 - (.055 * progress);
    gesture.content.style.transform = `translate3d(0, ${translate}px, 0) scale(${scale})`;
    gesture.content.style.opacity = String(1 - (.34 * progress));
  }, { capture: true, passive: false });

  document.addEventListener('pointerup', (event) => finishPhotoGesture(event, false), true);
  document.addEventListener('pointercancel', (event) => finishPhotoGesture(event, true), true);
})();
