/* Build 138: OS-aware mobile viewport polish.
   Extends the stable Build 99 viewport fix without replacing chat scroll,
   unread/lazy-history, gestures or message rendering.

   Goals:
   - identify iOS / Android automatically;
   - detect when the software keyboard actually occupies the visual viewport;
   - on iOS, do not add the home-indicator safe-area a second time while the
     keyboard/input assistant already owns the bottom of the screen;
   - normalize the iOS top safe-area from the very first chat-list render so
     startup looks the same as returning to the chat list later;
   - keep the normal safe-area untouched when the keyboard is closed.
*/
(() => {
  if (window.__fpViewport136Installed) return;
  window.__fpViewport136Installed = true;

  const STYLE_ID = 'fpchat-viewport-layout136-style';
  const root = document.documentElement;
  const mobileQuery = window.matchMedia('(max-width: 900px)');
  const vv = window.visualViewport;

  const ua = String(navigator.userAgent || '');
  const platform = String(navigator.platform || '');
  const isIOS = /iPad|iPhone|iPod/i.test(ua)
    || (platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
  const isAndroid = /Android/i.test(ua);

  root.classList.toggle('fp-os-ios', isIOS);
  root.classList.toggle('fp-os-android', isAndroid);
  root.classList.toggle('fp-os-other', !isIOS && !isAndroid);
  root.dataset.fpOs = isIOS ? 'ios' : isAndroid ? 'android' : 'other';

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @media (max-width: 900px) {
      /* Build 138: on first PWA launch paint the iOS top safe-area with the
         same panel color as the chat list. This matches the state after a
         chat -> list transition and avoids the darker startup strip. */
      html.fp-os-ios #appRoot[data-pane="list"]::before {
        content: '';
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: env(safe-area-inset-top);
        background: var(--panel);
        pointer-events: none;
        z-index: 2;
      }

      /* iOS already reserves its keyboard/input-assistant region. Keeping the
         home-indicator safe area here as well creates an extra dark strip. */
      html.fp-os-ios.fp-keyboard-open #appRoot.fpchat-mobile-chat-viewport .chat-view .composer {
        padding-bottom: 8px !important;
      }

      html.fp-os-ios.fp-keyboard-open #appRoot.fpchat-mobile-chat-viewport .chat-view .new-messages-pill {
        bottom: 66px !important;
      }

      /* Avoid a transition from visually stretching the composer while the
         keyboard itself animates. Textarea height animation stays untouched. */
      html.fp-keyboard-opening #appRoot.fpchat-mobile-chat-viewport .chat-view .composer,
      html.fp-keyboard-closing #appRoot.fpchat-mobile-chat-viewport .chat-view .composer {
        transition: none !important;
      }
    }
  `;
  document.head.appendChild(style);

  let baselineHeight = 0;
  let keyboardOpen = false;
  let rafId = 0;
  let settleTimers = [];
  let transitionTimer = 0;

  const currentHeight = () => {
    const visual = Number(vv?.height);
    if (Number.isFinite(visual) && visual > 0) return visual;
    return Math.max(0, Number(window.innerHeight) || Number(document.documentElement.clientHeight) || 0);
  };

  const composerIsFocused = () => {
    const active = document.activeElement;
    return Boolean(active?.closest?.('.composer') && active.matches?.('textarea,input,[contenteditable="true"]'));
  };

  const chatIsOpen = () => Boolean(
    mobileQuery.matches
    && document.querySelector('.chat-view')
    && document.getElementById('messages')
  );

  function setTransitionClass(opening) {
    clearTimeout(transitionTimer);
    root.classList.remove('fp-keyboard-opening', 'fp-keyboard-closing');
    root.classList.add(opening ? 'fp-keyboard-opening' : 'fp-keyboard-closing');
    transitionTimer = setTimeout(() => {
      root.classList.remove('fp-keyboard-opening', 'fp-keyboard-closing');
    }, 420);
  }

  function applyKeyboardState(next) {
    if (keyboardOpen === next) return;
    keyboardOpen = next;
    root.classList.toggle('fp-keyboard-open', next);
    root.dataset.fpKeyboard = next ? 'open' : 'closed';
    setTransitionClass(next);
  }

  function syncNow() {
    rafId = 0;
    const height = currentHeight();

    if (!mobileQuery.matches || !chatIsOpen()) {
      applyKeyboardState(false);
      if (height > 0) baselineHeight = Math.max(baselineHeight, height);
      return;
    }

    const focused = composerIsFocused();

    // Grow the baseline only while the composer is not focused. This avoids
    // learning the shrunken keyboard viewport as the new normal height.
    if (!focused && height > 0) {
      baselineHeight = Math.max(baselineHeight, height);
      applyKeyboardState(false);
      return;
    }

    if (!baselineHeight && height > 0) baselineHeight = height;

    const obscured = Math.max(0, baselineHeight - height);
    const threshold = Math.max(110, baselineHeight * 0.16);
    applyKeyboardState(Boolean(focused && obscured >= threshold));
  }

  function requestSync() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(syncNow);
  }

  function clearSettleTimers() {
    for (const timer of settleTimers) clearTimeout(timer);
    settleTimers = [];
  }

  function settle() {
    clearSettleTimers();
    for (const delay of [0, 30, 70, 120, 200, 320, 480, 700]) {
      settleTimers.push(setTimeout(requestSync, delay));
    }
  }

  // Capture an initial keyboard-closed height before any composer focus.
  baselineHeight = currentHeight();
  root.dataset.fpKeyboard = 'closed';

  vv?.addEventListener('resize', requestSync, { passive: true });
  vv?.addEventListener('scroll', requestSync, { passive: true });
  window.addEventListener('resize', settle, { passive: true });
  window.addEventListener('orientationchange', () => {
    baselineHeight = 0;
    settle();
  }, { passive: true });

  document.addEventListener('focusin', (event) => {
    if (!event.target?.closest?.('.composer')) return;
    settle();
  }, true);

  document.addEventListener('focusout', (event) => {
    if (!event.target?.closest?.('.composer')) return;
    // iOS reports the restored viewport over several frames after blur.
    applyKeyboardState(false);
    settle();
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    baselineHeight = 0;
    settle();
  });

  const observer = new MutationObserver(requestSync);
  observer.observe(document.getElementById('contentPane') || document.body, {
    childList: true,
    subtree: true,
  });

  window.FPViewport136 = Object.freeze({
    snapshot() {
      return {
        os: root.dataset.fpOs || 'other',
        keyboard: keyboardOpen ? 'open' : 'closed',
        baselineHeight: Math.round(baselineHeight || 0),
        visibleHeight: Math.round(currentHeight() || 0),
        composerFocused: composerIsFocused(),
      };
    },
    sync: settle,
  });

  settle();
})();
