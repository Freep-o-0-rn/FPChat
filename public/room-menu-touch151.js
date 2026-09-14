/* Build 151: keep the existing chat context menu inert until the originating long-press touch is released. */
(() => {
  if (window.__fpRoomMenuTouch151Installed) return;
  window.__fpRoomMenuTouch151Installed = true;

  const menu = document.getElementById('contextMenu');
  const chatRows = document.getElementById('chatRows');
  if (!menu || !chatRows) return;

  const style = document.createElement('style');
  style.id = 'fpchat-room-menu-touch151-style';
  style.textContent = `
    .context-menu.fp-room-menu151-await-release{
      pointer-events:none!important;
      -webkit-user-select:none!important;
      user-select:none!important;
    }
    .context-menu.fp-room-menu151-await-release .context-item{
      pointer-events:none!important;
    }
    .context-menu.fp-room-menu151-await-release .context-item:hover,
    .context-menu.fp-room-menu151-await-release .context-item:active{
      background:transparent!important;
    }
  `;
  document.head.appendChild(style);

  let sourceTouch = null;
  let menuLocked = false;
  let suppressOriginClick = false;
  let awaitingFreshTap = false;

  function isMobile() {
    try {
      if (typeof isMobileViewport === 'function') return Boolean(isMobileViewport());
    } catch {}
    return window.matchMedia('(max-width:900px)').matches;
  }

  function menuVisible() {
    return !menu.classList.contains('hidden') && menu.getClientRects().length > 0;
  }

  function clearLegacyTouchLock() {
    // Build 78 already owns the synthetic-click lock. Keep using it, but do not
    // let its 700 ms timeout swallow the first real tap after this touch ended.
    try { roomMenuTouchLockUntil = 0; } catch {}
  }

  function lockUntilRelease() {
    if (menuLocked) return;
    menuLocked = true;
    menu.classList.add('fp-room-menu151-await-release');
  }

  function unlockAfterRelease({ suppressClick = true } = {}) {
    menuLocked = false;
    menu.classList.remove('fp-room-menu151-await-release');
    suppressOriginClick = suppressClick;
    awaitingFreshTap = suppressClick;
    clearLegacyTouchLock();
  }

  function beginSourceTouch(event) {
    if (!isMobile() || event.touches?.length !== 1) return;

    // A new touch inside an already-open menu is the explicit second tap the
    // user is supposed to make. Arm the existing menu immediately for it.
    if (menuVisible() && menu.contains(event.target)) {
      if (awaitingFreshTap) {
        awaitingFreshTap = false;
        suppressOriginClick = false;
        clearLegacyTouchLock();
      }
      return;
    }

    const row = event.target?.closest?.('#chatRows .chat-row');
    if (!row || !chatRows.contains(row)) {
      sourceTouch = null;
      return;
    }

    const touch = event.touches[0];
    sourceTouch = {
      startX: touch.clientX,
      startY: touch.clientY,
      canceled: false,
      openedMenu: false
    };
    suppressOriginClick = false;
    awaitingFreshTap = false;
  }

  function moveSourceTouch(event) {
    if (!sourceTouch || sourceTouch.openedMenu || event.touches?.length !== 1) return;
    const touch = event.touches[0];
    if (Math.abs(touch.clientX - sourceTouch.startX) > 10 || Math.abs(touch.clientY - sourceTouch.startY) > 10) {
      sourceTouch.canceled = true;
    }
  }

  function finishSourceTouch(cancelled = false) {
    if (!sourceTouch) return;
    const openedFromThisTouch = sourceTouch.openedMenu && menuVisible();
    sourceTouch = null;

    if (openedFromThisTouch) {
      // The menu becomes interactive only after this exact long-press touch is
      // over. Any click synthesized from that release is consumed below.
      unlockAfterRelease({ suppressClick: !cancelled });
      return;
    }

    if (menuLocked) unlockAfterRelease({ suppressClick: false });
  }

  const observer = new MutationObserver(() => {
    if (!sourceTouch || sourceTouch.canceled || !menuVisible()) return;
    sourceTouch.openedMenu = true;
    lockUntilRelease();
  });
  observer.observe(menu, { attributes: true, attributeFilter: ['class'], childList: true });

  document.addEventListener('touchstart', beginSourceTouch, { capture: true, passive: true });
  document.addEventListener('touchmove', moveSourceTouch, { capture: true, passive: true });
  document.addEventListener('touchend', () => finishSourceTouch(false), { capture: true, passive: true });
  document.addEventListener('touchcancel', () => finishSourceTouch(true), { capture: true, passive: true });

  menu.addEventListener('click', (event) => {
    if (!isMobile() || !suppressOriginClick) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    suppressOriginClick = false;
  }, true);
})();
