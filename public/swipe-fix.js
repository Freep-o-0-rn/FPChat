/* Build 97: keep iOS left-edge right-swipes inside FPChat.
   Open chat -> chat list. Settings -> chat list. Main screens -> navigation/settings drawer.
   Isolated from room, WebSocket, push and update logic. */
(() => {
  const EDGE_PX = 32;
  const DIRECTION_LOCK_PX = 10;
  const CHAT_BACK_THRESHOLD_PX = 80;
  const DRAWER_THRESHOLD_PX = 70;
  const SETTINGS_BACK_THRESHOLD_PX = 70;
  let swipe = null;

  const isMobile = () => window.matchMedia("(max-width: 900px)").matches;
  const chatIsOpen = () => Boolean(document.querySelector(".chat-view") && document.getElementById("messages"));
  const settingsIsOpen = () => {
    try {
      if (typeof state !== "undefined" && state?.view === "settings") return true;
    } catch {}
    return Boolean(document.getElementById("nick") && document.getElementById("theme") && document.getElementById("settingsVersion"));
  };
  const drawerIsOpen = () => Boolean(document.getElementById("sidebar")?.classList.contains("open"));
  const blockedTarget = (target) => Boolean(target?.closest?.(
    '.message-context-root, .message-context-root *, .composer, .composer *, .chat-header, .chat-header *, #backMob, #reloadBtn, #menuBtn, textarea, button, input, select, [contenteditable="true"]',
  ));
  const resetLegacyDrawerSwipe = () => {
    try {
      if (typeof edgeSwipe !== "undefined" && edgeSwipe) edgeSwipe.tracking = false;
    } catch {}
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
    if (!isMobile() || drawerIsOpen() || event.touches?.length !== 1) return;
    if (blockedTarget(event.target)) return;

    const touch = event.touches[0];
    const mode = chatIsOpen() ? "chat" : settingsIsOpen() ? "settings" : "drawer";

    // Main/settings navigation gestures are deliberately edge-only. This
    // mirrors Telegram and lets normal horizontal/vertical touches elsewhere pass.
    if ((mode === "drawer" || mode === "settings") && touch.clientX > EDGE_PX) return;

    swipe = {
      mode,
      startX: touch.clientX,
      startY: touch.clientY,
      dx: 0,
      dy: 0,
      axis: "pending",
      owned: false,
      canceled: false,
    };

    // Safari decides whether to perform native Back at touchstart. Cancel the
    // left edge immediately, before WebKit can navigate/reveal the boot page.
    if (touch.clientX <= EDGE_PX && event.cancelable) event.preventDefault();
  }, { capture: true, passive: false });

  document.addEventListener("touchmove", (event) => {
    if (!swipe || swipe.canceled || event.touches?.length !== 1) return;
    const touch = event.touches[0];
    swipe.dx = touch.clientX - swipe.startX;
    swipe.dy = touch.clientY - swipe.startY;

    if (swipe.axis === "pending") {
      if (Math.hypot(swipe.dx, swipe.dy) < DIRECTION_LOCK_PX) return;
      if (Math.abs(swipe.dy) >= Math.abs(swipe.dx)) {
        swipe.axis = "vertical";
        swipe.canceled = true;
        return;
      }
      if (swipe.dx <= 0) {
        // Preserve the existing left-swipe-to-reply gesture in an open chat.
        swipe.axis = "other";
        swipe.canceled = true;
        return;
      }
      swipe.axis = "horizontal";
    }

    if (swipe.axis !== "horizontal" || swipe.dx <= 0) return;
    swipe.owned = true;
    if (event.cancelable) event.preventDefault();

    // Stop build-77's separate drawer listener from competing with this
    // gesture. We invoke the intended in-app action ourselves on touchend.
    event.stopImmediatePropagation();
    resetLegacyDrawerSwipe();
  }, { capture: true, passive: false });

  document.addEventListener("touchend", (event) => {
    if (!swipe) return;
    const current = swipe;
    swipe = null;
    if (!current.owned) return;

    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    resetLegacyDrawerSwipe();

    const threshold = current.mode === "chat"
      ? CHAT_BACK_THRESHOLD_PX
      : current.mode === "settings"
        ? SETTINGS_BACK_THRESHOLD_PX
        : DRAWER_THRESHOLD_PX;
    if (current.canceled || current.dx < threshold) return;

    if (current.mode === "chat") {
      if (!chatIsOpen()) return;
      document.activeElement?.blur?.();
      if (typeof window.showChatsList === "function") window.showChatsList();
      try {
        history.replaceState({ ...history.state, fpchat: true, fpchatGuard: true }, "", "/");
      } catch {}
      return;
    }

    if (current.mode === "settings") {
      if (!settingsIsOpen()) return;
      document.activeElement?.blur?.();
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
    swipe = null;
    resetLegacyDrawerSwipe();
  }, { capture: true, passive: true });
})();
