/* Build 92: keep iOS right-swipe navigation inside FPChat.
   Isolated from room, WebSocket, push and update logic. */
(() => {
  const EDGE_PX = 28;
  const DIRECTION_LOCK_PX = 10;
  const BACK_THRESHOLD_PX = 80;
  let swipe = null;

  const isMobile = () => window.matchMedia("(max-width: 900px)").matches;
  const chatIsOpen = () => Boolean(document.querySelector(".chat-view") && document.getElementById("messages"));
  const blockedTarget = (target) => Boolean(target?.closest?.(
    '.composer, .composer *, .chat-header, .chat-header *, #backMob, #reloadBtn, #menuBtn, textarea, button, input, select, [contenteditable="true"]',
  ));
  const resetLegacyDrawerSwipe = () => {
    try {
      if (typeof edgeSwipe !== "undefined" && edgeSwipe) edgeSwipe.tracking = false;
    } catch {}
  };

  // Build 77 already inserts one same-document history entry. Keep it as the
  // guard instead of allowing iOS to reveal/navigate to the boot document.
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
    if (!isMobile() || !chatIsOpen() || event.touches?.length !== 1) return;
    if (blockedTarget(event.target)) return;
    const touch = event.touches[0];
    swipe = {
      startX: touch.clientX,
      startY: touch.clientY,
      dx: 0,
      dy: 0,
      axis: "pending",
      back: false,
      canceled: false,
    };
    // Safari commits to the native Back gesture at touchstart. This is the
    // critical build-85 behavior: cancel only the narrow left edge early.
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
        // Leave the existing left-swipe-to-reply behavior untouched.
        swipe.axis = "other";
        swipe.canceled = true;
        return;
      }
      swipe.axis = "horizontal";
    }

    if (swipe.axis !== "horizontal" || swipe.dx <= 0) return;
    swipe.back = true;
    if (event.cancelable) event.preventDefault();
    // Build 77 also has a drawer edge listener. Do not let the same gesture
    // open the drawer while a room is active.
    event.stopImmediatePropagation();
    resetLegacyDrawerSwipe();
  }, { capture: true, passive: false });

  document.addEventListener("touchend", (event) => {
    if (!swipe) return;
    const shouldGoBack = swipe.back && !swipe.canceled && swipe.dx >= BACK_THRESHOLD_PX;
    const owned = swipe.back;
    swipe = null;
    if (!owned) return;

    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    resetLegacyDrawerSwipe();
    if (!shouldGoBack || !chatIsOpen()) return;

    document.activeElement?.blur?.();
    if (typeof window.showChatsList === "function") window.showChatsList();
    try {
      history.replaceState({ ...history.state, fpchat: true, fpchatGuard: true }, "", "/");
    } catch {}
  }, { capture: true, passive: false });

  document.addEventListener("touchcancel", () => {
    swipe = null;
    resetLegacyDrawerSwipe();
  }, { capture: true, passive: true });
})();
