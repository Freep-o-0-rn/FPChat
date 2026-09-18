/* Build 158: stabilize the existing mobile viewport during iOS keyboard transitions.
   Extends the stable Build 99 viewport fix without replacing chat scrolling,
   unread/lazy-history, composer mechanics or the Build 139 keyboard detector.

   Build 158 adds two narrow protections:
   - do not keep a stale keyboard-sized visualViewport after the keyboard closes;
   - if the user was already at the bottom, keep the message bottom anchored while
     the keyboard opens/closes. Users reading older messages are left untouched. */
(() => {
  const STYLE_ID = 'fpchat-mobile-viewport-style';
  const MANAGED_CLASS = 'fpchat-mobile-chat-viewport';
  const MOBILE_QUERY = window.matchMedia('(max-width: 900px)');
  const app = document.getElementById('appRoot');
  if (!app) return;

  const STALE_VIEWPORT_MIN_GAP_PX = 120;
  const BOTTOM_PIN_MS = 1500;

  let correctionY = 0;
  let rafId = 0;
  let settleTimers = [];
  let closedViewportHeight = 0;
  let expectKeyboardClosedUntil = 0;
  let recoveringStaleViewport = false;
  let pinBottom = false;
  let pinBottomUntil = 0;

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

  function composerIsFocused() {
    const active = document.activeElement;
    return Boolean(
      active?.closest?.('.composer') &&
      active.matches?.('textarea,input,[contenteditable="true"]')
    );
  }

  function rawVisualHeight() {
    const visualHeight = Number(window.visualViewport?.height);
    if (Number.isFinite(visualHeight) && visualHeight > 240) return visualHeight;
    return Math.max(240, Number(window.innerHeight) || document.documentElement.clientHeight || 240);
  }

  function staleGap(reference, candidate) {
    if (!(reference > 0) || !(candidate > 0) || candidate >= reference) return false;
    return reference - candidate >= Math.max(STALE_VIEWPORT_MIN_GAP_PX, reference * 0.16);
  }

  function currentVisibleHeight() {
    const raw = rawVisualHeight();
    const focused = composerIsFocused();
    const keyboardExpectedClosed = performance.now() < expectKeyboardClosedUntil;
    recoveringStaleViewport = false;

    if (!closedViewportHeight) closedViewportHeight = raw;

    // While the keyboard is definitely not active, normal small browser-chrome
    // changes are allowed to update the baseline. A keyboard-sized drop is not.
    if (!focused && !staleGap(closedViewportHeight, raw)) {
      closedViewportHeight = raw;
    } else if (raw > closedViewportHeight) {
      closedViewportHeight = raw;
    }

    // Safari/PWA can briefly keep visualViewport at the old keyboard height
    // after blur/return. Do not shrink the whole fixed app to that stale value.
    if (
      staleGap(closedViewportHeight, raw) &&
      (!focused || keyboardExpectedClosed)
    ) {
      recoveringStaleViewport = true;
      return closedViewportHeight;
    }

    return raw;
  }

  function requestedViewportCorrection() {
    if (recoveringStaleViewport) return 0;

    const vv = window.visualViewport;
    const rectTop = app.getBoundingClientRect().top;

    // rectTop already contains the correction we applied on the previous pass.
    // Subtract it to recover WebKit's actual viewport pan. This also works on
    // iOS builds where visualViewport.offsetTop can under-report the pan.
    const rawRectTop = rectTop - correctionY;
    const rectPan = Math.max(0, -rawRectTop);
    const pagePan = Math.max(0, Number(vv?.pageTop) || 0);
    const offsetPan = Math.max(0, Number(vv?.offsetTop) || 0);
    return Math.max(rectPan, pagePan, offsetPan);
  }

  function messagesAtBottom(box) {
    if (!box) return false;
    try {
      if (typeof isMessagesAtBottom === 'function') return Boolean(isMessagesAtBottom(box));
    } catch {}
    return box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
  }

  function startBottomPin() {
    const box = document.getElementById('messages');
    pinBottom = Boolean(chatIsOpen() && box && messagesAtBottom(box));
    pinBottomUntil = pinBottom ? performance.now() + BOTTOM_PIN_MS : 0;
  }

  function stopBottomPin() {
    pinBottom = false;
    pinBottomUntil = 0;
  }

  function keepBottomPinned() {
    if (!pinBottom || performance.now() > pinBottomUntil) {
      stopBottomPin();
      return;
    }

    const box = document.getElementById('messages');
    if (!chatIsOpen() || !box) {
      stopBottomPin();
      return;
    }

    requestAnimationFrame(() => {
      if (!pinBottom || performance.now() > pinBottomUntil || box !== document.getElementById('messages')) return;
      try {
        if (typeof scrollCoordinator !== 'undefined' && scrollCoordinator?.requestBottom) {
          scrollCoordinator.requestBottom(box);
          return;
        }
      } catch {}
      box.scrollTop = box.scrollHeight;
    });
  }

  function clearSettleTimers() {
    for (const timer of settleTimers) clearTimeout(timer);
    settleTimers = [];
  }

  function syncViewportNow() {
    rafId = 0;
    if (!chatIsOpen()) {
      correctionY = 0;
      stopBottomPin();
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

    keepBottomPinned();
  }

  function requestViewportSync() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(syncViewportNow);
  }

  function settleViewport() {
    clearSettleTimers();
    for (const delay of [0, 40, 90, 160, 260, 400, 650, 900, 1250]) {
      settleTimers.push(setTimeout(requestViewportSync, delay));
    }
  }

  function expectKeyboardClosed() {
    expectKeyboardClosedUntil = performance.now() + 1500;
  }

  installStyles();
  closedViewportHeight = rawVisualHeight();

  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', requestViewportSync, { passive: true });
  viewport?.addEventListener('scroll', requestViewportSync, { passive: true });
  window.addEventListener('resize', settleViewport, { passive: true });
  window.addEventListener('orientationchange', () => {
    closedViewportHeight = 0;
    expectKeyboardClosedUntil = 0;
    stopBottomPin();
    settleViewport();
  }, { passive: true });

  document.addEventListener('focusin', (event) => {
    if (!event.target?.closest?.('.composer, #closedRoomBar')) return;
    // Capture the user's scroll intent before iOS starts shrinking the viewport.
    startBottomPin();
    settleViewport();
  }, true);

  document.addEventListener('focusout', (event) => {
    if (!event.target?.closest?.('.composer, #closedRoomBar')) return;
    // If the user is still at the bottom, keep that same bottom anchored while
    // the keyboard expands away. Also reject a stale keyboard-sized viewport.
    startBottomPin();
    expectKeyboardClosed();
    settleViewport();
  }, true);

  // Any deliberate interaction with message history cancels the temporary
  // bottom anchor, so opening the keyboard never drags a reader back to latest.
  document.addEventListener('touchstart', (event) => {
    if (event.target?.closest?.('#messages')) stopBottomPin();
  }, { capture: true, passive: true });
  document.addEventListener('pointerdown', (event) => {
    if (event.target?.closest?.('#messages')) stopBottomPin();
  }, { capture: true, passive: true });
  document.addEventListener('wheel', (event) => {
    if (event.target?.closest?.('#messages')) stopBottomPin();
  }, { capture: true, passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!composerIsFocused()) expectKeyboardClosed();
    settleViewport();
  });

  window.addEventListener('pageshow', () => {
    if (!composerIsFocused()) expectKeyboardClosed();
    settleViewport();
  }, { passive: true });

  // Build 173: chat/composer mount state now comes from the centralized DOM
  // lifecycle owner. The broad subtree observer is retained only as a fallback.
  if (window.FPDOM173?.on) {
    window.FPDOM173.on('chat', 'mounted', settleViewport);
    window.FPDOM173.on('chat', 'unmounted', settleViewport);
    window.FPDOM173.on('composer', 'mounted', settleViewport);
    window.FPDOM173.on('composer', 'unmounted', settleViewport);
  } else {
    const observer = new MutationObserver(requestViewportSync);
    observer.observe(document.getElementById('contentPane') || app, { childList: true, subtree: true });
  }

  window.FPViewport173 = Object.freeze({
    owners: Object.freeze({
      geometry: 'viewport-fix158',
      keyboardState: 'FPViewport136',
      messageScroll: 'FPScroll173'
    }),
    sync: requestViewportSync,
    settle: settleViewport,
    stopBottomPin,
    snapshot: () => ({
      owner: 'FPViewport173',
      chatOpen: chatIsOpen(),
      composerFocused: composerIsFocused(),
      correctionY: Math.round(correctionY || 0),
      closedViewportHeight: Math.round(closedViewportHeight || 0),
      visibleHeight: Math.round(currentVisibleHeight() || 0),
      bottomPin: Boolean(pinBottom)
    })
  });

  const registerRuntime = () => {
    try {
      window.FPRuntime?.registerOwner?.('viewport-geometry173', {
        role: 'mobile-viewport-geometry-owner',
        mode: 'active-owner',
        publicOwner: 'FPViewport173'
      });
    } catch {}
  };
  registerRuntime();
  window.addEventListener?.('fpchat:boot-ready', registerRuntime, { once: true, passive: true });

  settleViewport();
})();
