/* Build 189.5: pinned-screen edge-back owner.
   FPLayer173 decides whether the pins modal is the active layer and FPGesture135
   arbitrates the gesture session. This module owns only the pins-screen back
   recognizer/presentation; it never owns chat history, room state or scrolling. */
(() => {
  if (window.FPPinsNavigation189) return;

  const EDGE_PX = 32;
  const LOCK_PX = 10;
  const BACK_THRESHOLD_PX = 72;
  let swipe = null;
  let visualToken = 0;
  const stats = { starts: 0, claims: 0, commits: 0, cancels: 0, nativeBackBlocks: 0 };

  const root = () => document.querySelector('.fp-pins114-screen');
  const panel = () => root()?.querySelector('.fp-pins114-panel');
  const manager = () => window.FPGesture135 || null;

  function pinsLayerActive(target = null, event = null) {
    const screen = root();
    if (!screen?.isConnected) return false;
    try {
      const layer = manager()?.currentLayer?.(event, target || screen)
        || window.FPLayer173?.currentLayer?.(target || screen);
      return layer === 'modal';
    } catch {
      return true;
    }
  }

  function clearVisual() {
    const screen = root();
    const body = panel();
    screen?.classList.remove('fp-pins189-back-preview', 'fp-pins189-back-anim');
    if (body) {
      body.style.transform = '';
      body.style.opacity = '';
      body.style.willChange = '';
      body.style.transition = '';
    }
  }

  function moveVisual(dx) {
    const screen = root();
    const body = panel();
    if (!screen || !body) return;
    const width = Math.max(1, screen.clientWidth || window.innerWidth || 1);
    const x = Math.min(Math.max(0, Number(dx) || 0), width * .96);
    screen.classList.add('fp-pins189-back-preview');
    body.style.willChange = 'transform,opacity';
    body.style.transition = 'none';
    body.style.transform = `translate3d(${x}px,0,0)`;
    body.style.opacity = String(Math.max(.78, 1 - (x / width) * .18));
  }

  function resetVisual(animate = true) {
    const screen = root();
    const body = panel();
    if (!screen || !body) { clearVisual(); return; }
    const token = ++visualToken;
    if (!animate) { clearVisual(); return; }
    screen.classList.add('fp-pins189-back-anim');
    body.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1),opacity .2s ease';
    body.style.transform = 'translate3d(0,0,0)';
    body.style.opacity = '1';
    const finish = () => { if (token === visualToken) clearVisual(); };
    body.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 240);
  }

  function commitBack() {
    const screen = root();
    const body = panel();
    if (!screen || !body) return false;
    const token = ++visualToken;
    screen.classList.add('fp-pins189-back-anim');
    body.style.willChange = 'transform,opacity';
    body.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1),opacity .2s ease';
    body.style.transform = 'translate3d(105%,0,0)';
    body.style.opacity = '.78';
    let finished = false;
    const finish = () => {
      if (finished || token !== visualToken) return;
      finished = true;
      const back = screen.querySelector('.fp-pins114-back');
      if (back) back.click();
      else screen.remove();
      clearVisual();
    };
    body.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 250);
    stats.commits += 1;
    return true;
  }

  function cancel(reason = 'cancel') {
    if (!swipe) return;
    swipe = null;
    stats.cancels += 1;
    resetVisual(true);
  }

  document.addEventListener('touchstart', (event) => {
    swipe = null;
    const screen = root();
    if (!screen || event.touches?.length !== 1) return;
    const touch = event.touches[0];
    if (touch.clientX > EDGE_PX) return;
    if (!pinsLayerActive(event.target, event)) return;
    if (event.target?.closest?.('input,textarea,[contenteditable="true"]')) return;

    swipe = { startX: touch.clientX, startY: touch.clientY, dx: 0, dy: 0, axis: 'pending', owned: false };
    stats.starts += 1;

    // WebKit decides native history/back at touchstart. Cancelling here keeps
    // the gesture inside FPChat instead of revealing/reloading the boot page.
    if (event.cancelable) {
      event.preventDefault();
      stats.nativeBackBlocks += 1;
    }
    try { manager()?.resetLegacyDrawerSwipe?.(); } catch {}
  }, { capture: true, passive: false });

  document.addEventListener('touchmove', (event) => {
    if (!swipe || event.touches?.length !== 1 || !root()) return;
    if (!pinsLayerActive(event.target, event)) return cancel('layer');
    const touch = event.touches[0];
    swipe.dx = touch.clientX - swipe.startX;
    swipe.dy = touch.clientY - swipe.startY;

    if (swipe.axis === 'pending') {
      if (Math.hypot(swipe.dx, swipe.dy) < LOCK_PX) return;
      if (Math.abs(swipe.dy) >= Math.abs(swipe.dx) || swipe.dx <= 0) return cancel('direction');
      swipe.axis = 'horizontal';
    }
    if (swipe.axis !== 'horizontal') return;

    const gestures = manager();
    if (!swipe.owned) {
      if (gestures?.claimAction && !gestures.claimAction('navigate:pins', event)) return cancel('arbiter');
      swipe.owned = true;
      stats.claims += 1;
    }
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    try { gestures?.resetLegacyDrawerSwipe?.(); } catch {}
    moveVisual(swipe.dx);
  }, { capture: true, passive: false });

  document.addEventListener('touchend', (event) => {
    if (!swipe) return;
    const current = swipe;
    swipe = null;
    if (current.owned && event.cancelable) event.preventDefault();
    if (current.owned) event.stopImmediatePropagation();
    try { manager()?.resetLegacyDrawerSwipe?.(); } catch {}
    if (!current.owned || current.dx < BACK_THRESHOLD_PX || !pinsLayerActive(event.target, event)) {
      stats.cancels += 1;
      resetVisual(true);
      return;
    }
    commitBack();
  }, { capture: true, passive: false });

  document.addEventListener('touchcancel', () => cancel('touchcancel'), { capture: true, passive: true });

  window.FPPinsNavigation189 = Object.freeze({
    back: commitBack,
    snapshot: () => ({ owner: 'FPPinsNavigation189', layerArbiter: 'FPLayer173', gestureArbiter: 'FPGesture135', active: Boolean(root()), ...stats })
  });

  try {
    window.FPRuntime?.registerOwner?.('pins-navigation189', {
      role: 'pinned-screen-navigation-manager',
      mode: 'active-owner',
      gestureArbiter: 'FPGesture135',
      layerArbiter: 'FPLayer173',
      owns: 'left-edge back recognition + pins-screen back transition + native iOS edge-back suppression while pins modal is active',
      doesNotOwn: 'room/chat state/history/chat scroll/pins data/rendering/global navigation'
    });
  } catch {}
})();
