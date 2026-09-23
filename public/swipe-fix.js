/* Build 97: keep iOS left-edge right-swipes inside FPChat.
   Open chat -> chat list. Settings -> chat list. Main screens -> navigation/settings drawer.
   Isolated from room, WebSocket, push and update logic.
   Build 122: voice waveform canvases own their horizontal gestures.
   Build 132: modern settings own their one-level edge-back navigation.
   Build 133: centralize modern settings edge-back in this touch layer to avoid iOS PointerEvent races.
   Build 134: fullscreen media viewer owns all swipe directions while it is open.
   Build 135: global navigation consults the centralized gesture/layer arbiter. */
(() => {
  const EDGE_PX = 32;
  const DIRECTION_LOCK_PX = 10;
  const CHAT_BACK_THRESHOLD_PX = 80;
  const DRAWER_THRESHOLD_PX = 70;
  const SETTINGS_BACK_THRESHOLD_PX = 70;
  let swipe = null;

  const isMobile = () => window.matchMedia("(max-width: 900px)").matches;
  const chatIsOpen = () => Boolean(document.querySelector(".chat-view") && document.getElementById("messages"));
  const modernSettingsRoot = () => document.querySelector('.fp-settings131');
  const mediaViewerIsOpen = () => {
    try {
      if (window.FPLayer173?.topLayer) return window.FPLayer173.topLayer() === 'viewer';
    } catch {}
    return Boolean(document.querySelector('#mediaViewerRoot .media-viewer-overlay'));
  };
  const gestureManager = () => window.FPGesture135 || null;
  const settingsIsOpen = () => {
    if (modernSettingsRoot()) return true;
    try {
      if (typeof state !== "undefined" && state?.view === "settings") return true;
    } catch {}
    return Boolean(document.getElementById("nick") && document.getElementById("theme") && document.getElementById("settingsVersion"));
  };
  const drawerIsOpen = () => Boolean(document.getElementById("sidebar")?.classList.contains("open"));
  const editableTarget = (target) => Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
  const blockedTarget = (target) => Boolean(target?.closest?.(
    '.message-context-root, .message-context-root *, .composer, .composer *, .chat-header, .chat-header *, #backMob, #reloadBtn, #menuBtn, textarea, button, input, select, [contenteditable="true"], .fp-voice-waveform, .fp-voice-preview-waveform, .fp-voice-live-waveform',
  ));
  const resetLegacyDrawerSwipe = () => {
    try {
      if (typeof edgeSwipe !== "undefined" && edgeSwipe) edgeSwipe.tracking = false;
    } catch {}
  };
  const deferLegacyDrawerReset = () => {
    try { queueMicrotask(resetLegacyDrawerSwipe); }
    catch { setTimeout(resetLegacyDrawerSwipe, 0); }
  };
  const resetModernSettingsVisual = (animate = true) => {
    const root = modernSettingsRoot();
    if (!root) return;
    if (animate) root.classList.add('fp-settings131-anim');
    root.style.transform = '';
    root.style.opacity = '';
    if (animate) setTimeout(() => root.classList.remove('fp-settings131-anim'), 180);
  };
  const moveModernSettingsVisual = (dx) => {
    const root = modernSettingsRoot();
    if (!root) return;
    root.classList.remove('fp-settings131-anim');
    const width = Math.max(1, root.clientWidth);
    const x = Math.min(Math.max(0, dx), width * .88);
    root.style.transform = `translate3d(${x}px,0,0)`;
    root.style.opacity = String(Math.max(.72, 1 - x / width * .22));
  };
  const commitModernSettingsBack = () => {
    const root = modernSettingsRoot();
    if (!root) return false;
    root.classList.add('fp-settings131-anim');
    root.style.transform = 'translate3d(105%,0,0)';
    root.style.opacity = '.7';
    setTimeout(() => {
      const back = document.querySelector('.fp-settings131-back');
      if (back) back.click();
      else resetModernSettingsVisual(false);
    }, 135);
    return true;
  };

  // Build 183: room-back animation reuses the existing chat-list/content panes.
  // This is visual state only; room/session state is not changed here.
  const chatBackElements = () => ({
    app: document.getElementById('appRoot'),
    list: document.getElementById('chatListPane'),
    content: document.getElementById('contentPane'),
  });

  const clearChatBackVisual = () => {
    const { app, list, content } = chatBackElements();
    app?.classList.remove('fp-chat-back-preview', 'fp-chat-back-anim');
    if (content) {
      content.style.transform = '';
      content.style.willChange = '';
    }
    if (list) {
      list.style.transform = '';
      list.style.willChange = '';
    }
  };

  const prepareChatBackVisual = () => {
    if (!isMobile() || !chatIsOpen()) return false;
    const { app, list, content } = chatBackElements();
    if (!app || !list || !content) return false;
    app.classList.add('fp-chat-back-preview');
    app.classList.remove('fp-chat-back-anim');
    content.style.willChange = 'transform';
    list.style.willChange = 'transform';
    return true;
  };

  let chatBackVisualToken = 0;

  const moveChatBackVisual = (dx) => {
    if (!prepareChatBackVisual()) return false;
    const { list, content } = chatBackElements();
    const width = Math.max(1, content?.clientWidth || window.innerWidth || 1);
    const x = Math.min(Math.max(0, Number(dx) || 0), width * .96);
    const progress = Math.max(0, Math.min(1, x / width));
    content.style.transform = `translate3d(${x}px,0,0)`;
    list.style.transform = `translate3d(${-24 * (1 - progress)}px,0,0)`;
    return true;
  };

  const resetChatBackVisual = (animate = true) => {
    const { app, list, content } = chatBackElements();
    if (!app?.classList.contains('fp-chat-back-preview')) {
      clearChatBackVisual();
      return false;
    }
    const token = ++chatBackVisualToken;
    if (animate) app.classList.add('fp-chat-back-anim');
    else app.classList.remove('fp-chat-back-anim');
    if (content) content.style.transform = 'translate3d(0,0,0)';
    if (list) list.style.transform = 'translate3d(-24px,0,0)';

    const finish = () => {
      if (token !== chatBackVisualToken) return;
      clearChatBackVisual();
    };
    if (!animate || !content) {
      finish();
      return true;
    }
    content.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 240);
    return true;
  };

  let chatBackCommitInFlight = false;

  const runExistingChatListExit = () => {
    try {
      if (typeof window.showChatsList === 'function') window.showChatsList();
      else if (typeof showChatsList === 'function') showChatsList();
    } catch {}
    try {
      history.replaceState({ ...history.state, fpchat: true, fpchatGuard: true }, '', '/');
    } catch {}
  };

  const commitChatBackVisual = () => {
    if (!isMobile() || !chatIsOpen()) return false;
    if (chatBackCommitInFlight) return true;
    if (!prepareChatBackVisual()) return false;
    const { app, list, content } = chatBackElements();
    if (!app || !content) return false;

    chatBackCommitInFlight = true;
    const token = ++chatBackVisualToken;
    app.classList.add('fp-chat-back-anim');
    content.style.transform = 'translate3d(105%,0,0)';
    if (list) list.style.transform = 'translate3d(0,0,0)';

    let finished = false;
    const finish = () => {
      if (finished || token !== chatBackVisualToken) return;
      finished = true;
      chatBackCommitInFlight = false;
      clearChatBackVisual();
      runExistingChatListExit();
    };
    content.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 260);
    return true;
  };

  // Settings now use the same mobile gesture model as chats, so the explicit
  // Back button is no longer needed. Keep desktop navigation via the sidebar.
  try {
    const baseRenderSettings = renderSettings;
    renderSettings = function renderSettingsWithoutBackButton(...args) {
      const result = baseRenderSettings.apply(this, args);
      document.getElementById("backBtn")?.remove();
      return result;
    };
    document.getElementById("backBtn")?.remove();
  } catch {}

  // Keep one same-document history guard so iOS cannot reveal an older boot
  // document when it recognizes a native edge-back gesture.
  try {
    history.scrollRestoration = "manual";
    history.replaceState({ ...history.state, fpchat: true, fpchatGuard: true }, "", location.href);
    if (typeof window.pushAppHistoryState === "function") {
      window.pushAppHistoryState = () => {
        try {
          history.scrollRestoration = "manual";
          if (history.state?.fpchatGuard) return;
          history.replaceState({ ...history.state, fpchat: true }, "", location.href);
          history.pushState({ fpchat: true, fpchatGuard: true }, "", location.href);
        } catch {}
      };
    }
  } catch {}

  document.addEventListener("touchstart", (event) => {
    swipe = null;
    if (!isMobile() || event.touches?.length !== 1) return;

    // Build 134 fallback. Build 135 normally rejects this through the manager,
    // but keep the proven viewer guard if the manager has not loaded yet.
    if (mediaViewerIsOpen()) {
      const touch = event.touches[0];
      resetLegacyDrawerSwipe();
      deferLegacyDrawerReset();
      if (touch.clientX <= EDGE_PX && event.cancelable) event.preventDefault();
      return;
    }

    if (drawerIsOpen()) return;

    const modernSettings = modernSettingsRoot();
    if (modernSettings) {
      // The settings page is mostly made of <button> rows. Do not apply the
      // generic button block here or the edge gesture will almost never start.
      if (editableTarget(event.target)) return;
    } else if (blockedTarget(event.target)) {
      return;
    }

    const touch = event.touches[0];
    const mode = chatIsOpen() ? "chat" : settingsIsOpen() ? "settings" : "drawer";
    const manager = gestureManager();
    if (manager && !manager.canNavigate(mode, event.target, event)) {
      resetLegacyDrawerSwipe();
      return;
    }

    // Main/settings navigation gestures are deliberately edge-only. Chat back
    // remains edge-only as well; left-swipe reply stays owned by the message.
    if ((mode === "drawer" || mode === "settings" || mode === "chat") && touch.clientX > EDGE_PX) return;

    swipe = {
      mode,
      modernSettings: mode === 'settings' && Boolean(modernSettings),
      startX: touch.clientX,
      startY: touch.clientY,
      dx: 0,
      dy: 0,
      axis: "pending",
      owned: false,
      canceled: false,
    };

    if (swipe.modernSettings) resetLegacyDrawerSwipe();

    // Safari decides whether to perform native Back at touchstart. Cancel the
    // left edge immediately, before WebKit can navigate/reveal the boot page.
    if (touch.clientX <= EDGE_PX && event.cancelable) event.preventDefault();

    // The legacy drawer also listens for the left edge. Modern settings own
    // this gesture completely, so do not let a later listener arm the drawer.
    if (swipe.modernSettings) event.stopImmediatePropagation();
  }, { capture: true, passive: false });

  document.addEventListener("touchmove", (event) => {
    if (mediaViewerIsOpen()) {
      if (swipe?.mode === 'chat') resetChatBackVisual();
      swipe = null;
      resetLegacyDrawerSwipe();
      return;
    }
    if (!swipe || swipe.canceled || event.touches?.length !== 1) return;

    const manager = gestureManager();
    if (manager && !manager.canNavigate(swipe.mode, event.target, event)) {
      if (swipe.modernSettings) resetModernSettingsVisual();
      if (swipe.mode === 'chat') resetChatBackVisual();
      swipe = null;
      resetLegacyDrawerSwipe();
      return;
    }

    const touch = event.touches[0];
    swipe.dx = touch.clientX - swipe.startX;
    swipe.dy = touch.clientY - swipe.startY;

    if (swipe.axis === "pending") {
      if (Math.hypot(swipe.dx, swipe.dy) < DIRECTION_LOCK_PX) return;
      if (Math.abs(swipe.dy) >= Math.abs(swipe.dx)) {
        swipe.axis = "vertical";
        swipe.canceled = true;
        if (swipe.modernSettings) resetModernSettingsVisual();
        return;
      }
      if (swipe.dx <= 0) {
        // Preserve the existing left-swipe-to-reply gesture in an open chat.
        swipe.axis = "other";
        swipe.canceled = true;
        if (swipe.modernSettings) resetModernSettingsVisual();
        return;
      }
      swipe.axis = "horizontal";
    }

    if (swipe.axis !== "horizontal" || swipe.dx <= 0) return;
    // Build 175: cancel competing pending actions before capture stops the row
    // from receiving its own touchmove/touchend cleanup. Thresholds stay here.
    if (manager?.claimAction && !manager.claimAction(`navigate:${swipe.mode}`, event)) {
      if (swipe.modernSettings) resetModernSettingsVisual();
      swipe = null;
      return;
    }
    swipe.owned = true;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    resetLegacyDrawerSwipe();

    if (swipe.modernSettings) moveModernSettingsVisual(swipe.dx);
    if (swipe.mode === 'chat') moveChatBackVisual(swipe.dx);
  }, { capture: true, passive: false });

  document.addEventListener("touchend", (event) => {
    if (mediaViewerIsOpen()) {
      if (swipe?.mode === 'chat') resetChatBackVisual();
      swipe = null;
      resetLegacyDrawerSwipe();
      return;
    }
    if (!swipe) return;
    const current = swipe;
    swipe = null;

    const manager = gestureManager();
    if (manager && !manager.canNavigate(current.mode, event.target, event)) {
      if (current.modernSettings) resetModernSettingsVisual();
      if (current.mode === 'chat') resetChatBackVisual();
      resetLegacyDrawerSwipe();
      return;
    }

    if (!current.owned) {
      if (current.modernSettings) {
        resetLegacyDrawerSwipe();
        resetModernSettingsVisual();
      }
      if (current.mode === 'chat') resetChatBackVisual();
      return;
    }

    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    resetLegacyDrawerSwipe();

    const threshold = current.mode === "chat"
      ? CHAT_BACK_THRESHOLD_PX
      : current.mode === "settings"
        ? SETTINGS_BACK_THRESHOLD_PX
        : DRAWER_THRESHOLD_PX;
    if (current.canceled || current.dx < threshold) {
      if (current.modernSettings) resetModernSettingsVisual();
      if (current.mode === 'chat') resetChatBackVisual();
      return;
    }

    if (current.mode === "chat") {
      if (!chatIsOpen()) return;
      document.activeElement?.blur?.();
      if (!commitChatBackVisual()) runExistingChatListExit();
      return;
    }

    if (current.mode === "settings") {
      if (!settingsIsOpen()) return;
      document.activeElement?.blur?.();

      // The visible Back button already knows the correct parent page.
      // Triggering it keeps one-level hierarchical navigation.
      if (current.modernSettings && commitModernSettingsBack()) return;

      try {
        if (typeof setView === "function") setView("chats");
        else if (typeof window.setView === "function") window.setView("chats");
      } catch {}
      return;
    }

    if (chatIsOpen() || settingsIsOpen() || drawerIsOpen()) return;
    if (typeof window.openMobileMenu === "function") window.openMobileMenu();
  }, { capture: true, passive: false });

  document.addEventListener("touchcancel", () => {
    if (swipe?.modernSettings) resetModernSettingsVisual();
    if (swipe?.mode === 'chat') resetChatBackVisual();
    swipe = null;
    resetLegacyDrawerSwipe();
  }, { capture: true, passive: true });
})();
