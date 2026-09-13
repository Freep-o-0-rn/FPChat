/* Build 99: keep the mobile chat chrome inside the visible iOS viewport.
   Only the message list may scroll; the chat header stays at the top and the
   composer stays immediately above the software keyboard. */
(() => {
  const STYLE_ID = 'fpchat-mobile-viewport-style';
  const MANAGED_CLASS = 'fpchat-mobile-chat-viewport';
  const MOBILE_QUERY = window.matchMedia('(max-width: 900px)');
  const app = document.getElementById('appRoot');
  if (!app) return;

  let correctionY = 0;
  let rafId = 0;
  let settleTimers = [];

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @media (max-width: 900px) {
        #appRoot.${MANAGED_CLASS} {
          position: fixed !important;
          top: 0 !important;
          right: 0 !important;
          bottom: auto !important;
          left: 0 !important;
          width: 100% !important;
          height: var(--fpchat-visible-height, 100dvh) !important;
          min-height: 0 !important;
          overflow: hidden !important;
          transform: translate3d(0, var(--fpchat-viewport-correction-y, 0px), 0);
        }

        #appRoot.${MANAGED_CLASS}[data-pane="content"] .content.chat-content {
          height: 100% !important;
          min-height: 0 !important;
          overflow: hidden !important;
        }

        #appRoot.${MANAGED_CLASS} .chat-view {
          height: 100% !important;
          min-height: 0 !important;
          overflow: hidden !important;
          display: flex !important;
          flex-direction: column !important;
        }

        #appRoot.${MANAGED_CLASS} .chat-view .chat-header {
          position: relative !important;
          top: auto !important;
          flex: 0 0 auto !important;
          z-index: 20;
          background: var(--panel);
        }

        #appRoot.${MANAGED_CLASS} .chat-view .messages {
          flex: 1 1 auto !important;
          min-height: 0 !important;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch;
        }

        #appRoot.${MANAGED_CLASS} .chat-view .composer,
        #appRoot.${MANAGED_CLASS} .chat-view #closedRoomBar {
          flex: 0 0 auto !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function chatIsOpen() {
    return Boolean(
      MOBILE_QUERY.matches &&
      app.dataset.pane === 'content' &&
      document.querySelector('.chat-view') &&
      document.getElementById('messages')
    );
  }

  function currentVisibleHeight() {
    const visualHeight = Number(window.visualViewport?.height);
    if (Number.isFinite(visualHeight) && visualHeight > 240) return visualHeight;
    return Math.max(240, Number(window.innerHeight) || document.documentElement.clientHeight || 240);
  }

  function requestedViewportCorrection() {
    const vv = window.visualViewport;
    const rectTop = app.getBoundingClientRect().top;

    // rectTop already contains the correction we applied on the previous pass.
    // Subtract it to recover WebKit's actual viewport pan. This also works on
    // iOS 26 builds where visualViewport.offsetTop can under-report the pan.
    const rawRectTop = rectTop - correctionY;
    const rectPan = Math.max(0, -rawRectTop);
    const pagePan = Math.max(0, Number(vv?.pageTop) || 0);
    const offsetPan = Math.max(0, Number(vv?.offsetTop) || 0);
    return Math.max(rectPan, pagePan, offsetPan);
  }

  function clearSettleTimers() {
    for (const timer of settleTimers) clearTimeout(timer);
    settleTimers = [];
  }

  function syncViewportNow() {
    rafId = 0;
    if (!chatIsOpen()) {
      correctionY = 0;
      app.classList.remove(MANAGED_CLASS);
      app.style.removeProperty('--fpchat-visible-height');
      app.style.removeProperty('--fpchat-viewport-correction-y');
      return;
    }

    app.classList.add(MANAGED_CLASS);
    app.style.setProperty('--fpchat-visible-height', `${Math.ceil(currentVisibleHeight())}px`);

    const nextCorrection = Math.min(
      Math.max(0, Number(window.innerHeight) || 1200),
      requestedViewportCorrection(),
    );

    if (Math.abs(nextCorrection - correctionY) > 0.5) {
      correctionY = nextCorrection;
      app.style.setProperty('--fpchat-viewport-correction-y', `${Math.round(correctionY)}px`);
    } else if (!app.style.getPropertyValue('--fpchat-viewport-correction-y')) {
      app.style.setProperty('--fpchat-viewport-correction-y', `${Math.round(correctionY)}px`);
    }
  }

  function requestViewportSync() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(syncViewportNow);
  }

  function settleViewport() {
    clearSettleTimers();
    for (const delay of [0, 40, 90, 160, 260, 400, 650]) {
      settleTimers.push(setTimeout(requestViewportSync, delay));
    }
  }

  installStyles();

  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', requestViewportSync, { passive: true });
  viewport?.addEventListener('scroll', requestViewportSync, { passive: true });
  window.addEventListener('resize', settleViewport, { passive: true });
  window.addEventListener('orientationchange', settleViewport, { passive: true });

  document.addEventListener('focusin', (event) => {
    if (!event.target?.closest?.('.composer, #closedRoomBar')) return;
    settleViewport();
  }, true);

  document.addEventListener('focusout', (event) => {
    if (!event.target?.closest?.('.composer, #closedRoomBar')) return;
    settleViewport();
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') settleViewport();
  });

  // Chat DOM is rebuilt when a room is opened/closed/restored. Re-evaluate the
  // managed viewport without coupling this fix to the chat rendering code.
  const observer = new MutationObserver(requestViewportSync);
  observer.observe(document.getElementById('contentPane') || app, { childList: true, subtree: true });

  settleViewport();
})();
