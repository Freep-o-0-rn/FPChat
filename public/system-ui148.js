/* Build 149: system-chat edge back swipe and stable system preview over existing layers. */
(() => {
  if (window.__fpSystemUi148Installed) return;
  window.__fpSystemUi148Installed = true;

  const EDGE_WIDTH = 28;
  const DIRECTION_LOCK = 10;
  const BACK_THRESHOLD = 80;
  const MAX_TRANSLATE = 120;
  const GENERIC_PREVIEW = 'Новое системное уведомление';

  const style = document.createElement('style');
  style.id = 'fpchat-system-ui148-style';
  style.textContent = `
    @media(max-width:600px){
      .fp-system145-overlay{overscroll-behavior-x:none;touch-action:pan-y}
      .fp-system145-overlay.fp-system148-back-swiping{transition:none!important;will-change:transform}
      .fp-system145-overlay.fp-system148-back-reset{transition:transform .18s ease!important;will-change:transform}
    }
  `;
  document.head.appendChild(style);

  let swipe = null;
  let cachedPreview = '';
  let previewRefresh = null;
  let hostObserver = null;

  function isMobile() {
    try {
      if (typeof isMobileViewport === 'function') return Boolean(isMobileViewport());
    } catch {}
    return window.matchMedia('(max-width:600px)').matches;
  }

  function visibleSystemOverlay() {
    const items = [...document.querySelectorAll('.fp-system145-overlay')];
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const el = items[i];
      if (!el.isConnected || el.hidden) continue;
      try {
        const css = getComputedStyle(el);
        if (css.display !== 'none' && css.visibility !== 'hidden' && el.getClientRects().length) return el;
      } catch {}
    }
    return null;
  }

  function blockedStartTarget(target) {
    return Boolean(target?.closest?.('button,input,textarea,select,[contenteditable="true"]'));
  }

  function gestureOwnsSystem(event) {
    const overlay = visibleSystemOverlay();
    if (!overlay || !overlay.contains(event.target)) return false;
    const manager = window.FPGesture135;
    if (!manager) return true;
    try {
      // System chat is already an aria-modal layer in the centralized arbiter.
      return manager.currentLayer(event, event.target) === 'modal';
    } catch {
      return false;
    }
  }

  function clearTransform(root) {
    if (!root) return;
    root.classList.remove('fp-system148-back-swiping', 'fp-system148-back-reset');
    root.style.transform = '';
    root.style.willChange = '';
  }

  function resetSwipe(root) {
    if (!root?.isConnected) return;
    root.classList.remove('fp-system148-back-swiping');
    root.classList.add('fp-system148-back-reset');
    root.style.transform = 'translate3d(0,0,0)';
    const cleanup = () => clearTransform(root);
    root.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, 220);
  }

  function closeThroughExistingBack(root) {
    const back = root?.querySelector('.fp-system145-back');
    clearTransform(root);
    if (back instanceof HTMLButtonElement) {
      back.click();
      return;
    }
    try { window.FPSystem144?.close?.(); } catch {}
  }

  function onTouchStart(event) {
    if (!isMobile() || event.touches?.length !== 1) return;
    const touch = event.touches[0];
    if (!touch || touch.clientX > EDGE_WIDTH || blockedStartTarget(event.target)) return;
    if (!gestureOwnsSystem(event)) return;
    const root = visibleSystemOverlay();
    if (!root) return;

    // iOS can reserve a left-edge gesture for native page/history navigation
    // before touchmove has travelled far enough for our direction lock. Claim
    // the already-approved system-chat edge gesture at touchstart, while it is
    // still cancelable, so the browser never starts moving/reloading the page
    // behind the FPChat layer.
    if (event.cancelable) event.preventDefault();

    try { window.FPGesture135?.resetLegacyDrawerSwipe?.(); } catch {}
    queueMicrotask(() => { try { window.FPGesture135?.resetLegacyDrawerSwipe?.(); } catch {} });
    clearTransform(root);
    swipe = {
      root,
      startX: touch.clientX,
      startY: touch.clientY,
      dx: 0,
      dy: 0,
      axis: 'pending',
      canceled: false,
      back: false
    };
  }

  function onTouchMove(event) {
    if (!swipe || swipe.canceled || event.touches?.length !== 1) return;
    const touch = event.touches[0];
    if (!touch || !swipe.root?.isConnected) return;
    swipe.dx = touch.clientX - swipe.startX;
    swipe.dy = touch.clientY - swipe.startY;

    if (swipe.axis === 'pending') {
      if (Math.hypot(swipe.dx, swipe.dy) < DIRECTION_LOCK) return;
      if (Math.abs(swipe.dy) >= Math.abs(swipe.dx)) {
        swipe.axis = 'vertical';
        swipe.canceled = true;
        clearTransform(swipe.root);
        return;
      }
      if (swipe.dx <= 0) {
        swipe.axis = 'other';
        swipe.canceled = true;
        return;
      }
      swipe.axis = 'horizontal';
    }

    if (swipe.axis !== 'horizontal' || swipe.dx <= 0) return;
    swipe.back = true;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    try { window.FPGesture135?.resetLegacyDrawerSwipe?.(); } catch {}
    const translate = Math.min(swipe.dx, MAX_TRANSLATE);
    swipe.root.classList.add('fp-system148-back-swiping');
    swipe.root.style.transform = `translate3d(${translate}px,0,0)`;
  }

  function finishSwipe(cancelled = false) {
    if (!swipe) return;
    const current = swipe;
    swipe = null;
    const shouldGoBack = !cancelled && current.back && !current.canceled && current.dx >= BACK_THRESHOLD;
    if (shouldGoBack) closeThroughExistingBack(current.root);
    else resetSwipe(current.root);
  }

  function dateOf(value) {
    if (!value) return null;
    const text = String(value);
    const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
      ? new Date(`${text.replace(' ', 'T')}Z`)
      : new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function requestPreview(request) {
    if (!request) return '';
    const who = request.peer?.displayName || (request.peer?.username ? `@${request.peer.username}` : 'Пользователь');
    if (request.status === 'pending') return request.direction === 'outgoing' ? `Ожидаем ответ от ${who}` : `${who} хочет начать чат`;
    if (request.status === 'accepted') return request.direction === 'outgoing' ? `${who} принял запрос` : 'Запрос принят';
    if (request.status === 'expired') return 'Срок запроса истёк';
    if (request.status === 'blocked') return 'Пользователь заблокирован';
    if (request.status === 'rejected') return 'Запрос на чат отклонён';
    return '';
  }

  function eventPreview(event, request = null) {
    const byRequest = requestPreview(request);
    if (byRequest) return byRequest;
    if (!event) return '';
    if (event.type === 'chat_request_received') {
      const sender = event.payload?.sender || {};
      const who = sender.displayName || (sender.username ? `@${sender.username}` : 'Пользователь');
      return `${who} хочет начать чат`;
    }
    if (event.type === 'chat_request_accepted') {
      const target = event.payload?.target || {};
      const who = target.displayName || (target.username ? `@${target.username}` : 'Пользователь');
      return `${who} принял запрос`;
    }
    if (event.type === 'chat_request_rejected') return 'Запрос на чат отклонён';
    if (event.type === 'chat_request_expired') return 'Срок запроса истёк';
    return GENERIC_PREVIEW;
  }

  function deviceId() {
    try {
      if (typeof getOrCreateDeviceId === 'function') return String(getOrCreateDeviceId() || '').trim();
    } catch {}
    return String(localStorage.getItem('fpchat:device-id') || '').trim();
  }

  async function fetchRequests() {
    const id = deviceId();
    if (!id) return [];
    const params = new URLSearchParams({ deviceId: id, limit: '100' });
    const response = await fetch(`/api/chat-requests/mine?${params.toString()}`, { cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) return [];
    return Array.isArray(data.requests) ? data.requests : [];
  }

  function applyCachedPreview() {
    if (!cachedPreview || cachedPreview === GENERIC_PREVIEW) return;
    const last = document.querySelector('#fpSystemChatHost145 .fp-system145-row .last');
    if (last && last.textContent === GENERIC_PREVIEW) last.textContent = cachedPreview;
  }

  async function refreshPreviewCache() {
    if (previewRefresh) return previewRefresh;
    previewRefresh = (async () => {
      try {
        const api = window.FPSystem144;
        if (!api?.getEvents) return cachedPreview;
        const [events, rows] = await Promise.all([api.getEvents(1), fetchRequests()]);
        const event = events?.[0] || null;
        const requestMap = new Map((rows || []).map((row) => [String(row.requestId || ''), row]));
        const requestId = String(event?.refId || event?.payload?.requestId || '');
        const linked = requestMap.get(requestId) || null;
        const newest = [...(rows || [])].sort((a, b) =>
          (dateOf(b.updatedAt || b.createdAt)?.getTime() || 0) - (dateOf(a.updatedAt || a.createdAt)?.getTime() || 0)
        )[0] || null;
        const eventMs = dateOf(event?.createdAt)?.getTime() || 0;
        const requestMs = dateOf(newest?.updatedAt || newest?.createdAt)?.getTime() || 0;
        cachedPreview = requestMs > eventMs ? requestPreview(newest) : eventPreview(event, linked);
        applyCachedPreview();
        return cachedPreview;
      } catch {
        return cachedPreview;
      } finally {
        previewRefresh = null;
      }
    })();
    return previewRefresh;
  }

  function installPreviewStabilizer() {
    const host = document.getElementById('fpSystemChatHost145');
    if (!host || hostObserver) return Boolean(host);
    hostObserver = new MutationObserver(() => {
      applyCachedPreview();
      if (document.querySelector('#fpSystemChatHost145 .fp-system145-row .last')?.textContent === GENERIC_PREVIEW) {
        void refreshPreviewCache();
      }
    });
    hostObserver.observe(host, { childList: true, subtree: true, characterData: true });
    void refreshPreviewCache();
    return true;
  }

  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  document.addEventListener('touchend', () => finishSwipe(false), { capture: true, passive: true });
  document.addEventListener('touchcancel', () => finishSwipe(true), { capture: true, passive: true });

  window.addEventListener('focus', () => { if (document.visibilityState === 'visible') void refreshPreviewCache(); });
  window.addEventListener('pageshow', () => void refreshPreviewCache());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshPreviewCache();
    else finishSwipe(true);
  });

  let attempts = 0;
  const boot = () => {
    const hostReady = installPreviewStabilizer();
    if ((!window.FPGesture135 || !hostReady) && attempts++ < 100) setTimeout(boot, 100);
  };
  boot();
})();