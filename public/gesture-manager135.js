/* Build 135: centralized gesture/layer arbiter.
   It does not implement feature gestures. Existing viewer/voice/context/settings/chat
   handlers keep their behaviour; this layer only decides which UI layer may own input. */
(() => {
  if (window.FPGesture135) return;

  const PRIORITY = Object.freeze({
    base: 0,
    chat: 10,
    drawer: 20,
    settings: 30,
    voice: 40,
    selection: 50,
    context: 60,
    modal: 70,
    viewer: 80
  });

  const VOICE_TARGETS = [
    '.fp-voice-record-btn',
    '.fp-voice-recording-bar',
    '.fp-voice-preview-bar',
    '.fp-voice-player',
    '.fp-voice-waveform',
    '.fp-voice-preview-waveform',
    '.fp-voice-live-waveform',
    '.fp-pins127-player'
  ].join(',');

  const MODAL_SELECTORS = [
    '.message-delete-overlay',
    '.message-selection-delete-overlay',
    '.destructive-modal-overlay',
    '.message-pin-overlay'
  ].join(',');

  let touchSession = null;
  let pointerSession = null;
  let sequence = 0;
  const recent = [];

  function elementFrom(target) {
    if (target instanceof Element) return target;
    return target?.parentElement instanceof Element ? target.parentElement : null;
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected || element.hidden) return false;
    try {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return element.getClientRects().length > 0;
    } catch {
      return false;
    }
  }

  function firstVisible(selector) {
    for (const element of document.querySelectorAll(selector)) {
      if (isVisible(element)) return element;
    }
    return null;
  }

  function targetIsVoice(target) {
    return Boolean(elementFrom(target)?.closest?.(VOICE_TARGETS));
  }

  function detectLayer(target = null) {
    // Build 173: use explicit layer state when available. This removes repeated
    // document-wide selector/layout scans from touchmove/pointermove hot paths.
    try {
      if (window.FPLayer173?.currentLayer) return window.FPLayer173.currentLayer(target);
    } catch {}

    // Compatibility fallback for a failed Build 173 owner asset.
    if (firstVisible('.media-viewer-overlay')) return 'viewer';

    if (firstVisible(MODAL_SELECTORS)) return 'modal';
    const ariaModal = [...document.querySelectorAll('[aria-modal="true"]')].find(isVisible);
    if (ariaModal) return 'modal';

    if (firstVisible('.message-context-root')) return 'context';
    if (document.body?.classList.contains('fp-message-selection-open')) return 'selection';

    const form = document.getElementById('sendForm');
    if (form?.classList.contains('fp-voice-recording') || targetIsVoice(target)) return 'voice';

    if (firstVisible('.fp-settings131')) return 'settings';
    if (document.getElementById('sidebar')?.classList.contains('open')) return 'drawer';
    if (firstVisible('.chat-view')) return 'chat';
    return 'base';
  }

  function pushRecent(type, session, detail = '') {
    recent.push({
      at: Date.now(),
      type,
      id: session?.id || 0,
      layer: session?.layer || detectLayer(),
      detail: String(detail || '')
    });
    while (recent.length > 24) recent.shift();
  }

  function syncBodyLayer(layer = detectLayer()) {
    if (!document.body) return;
    document.body.dataset.fpGestureLayer = layer;
  }

  function resetLegacyDrawerSwipe() {
    try {
      if (typeof edgeSwipe !== 'undefined' && edgeSwipe) edgeSwipe.tracking = false;
    } catch {}
  }

  function blocksLegacyDrawer(layer) {
    // The legacy drawer is valid only on main screens. Chat, settings and all
    // overlays have their own gesture semantics and must never leak into it.
    return layer !== 'base' && layer !== 'drawer';
  }

  function promote(session, target = null) {
    if (!session) return null;
    const manager = window.FPLayer173;
    const managerVersion = manager?.version?.();
    // Build 173 freezes gesture ownership for the session unless the explicit
    // layer stack itself changes (for example a modal/viewer opens mid-gesture).
    if (Number.isFinite(managerVersion) && session.layerVersion === managerVersion) return session;
    const next = detectLayer(target);
    if ((PRIORITY[next] ?? 0) > (PRIORITY[session.layer] ?? 0)) {
      session.layer = next;
      pushRecent('promote', session, next);
    }
    if (Number.isFinite(managerVersion)) session.layerVersion = managerVersion;
    syncBodyLayer(session.layer);
    return session;
  }

  function makeSession(kind, event) {
    const target = elementFrom(event?.target);
    const layer = detectLayer(target);
    const session = {
      id: ++sequence,
      kind,
      layer,
      layerVersion: window.FPLayer173?.version?.() ?? -1,
      startedAt: performance.now(),
      target
    };
    pushRecent('start', session);
    syncBodyLayer(layer);
    if (blocksLegacyDrawer(layer)) {
      resetLegacyDrawerSwipe();
      // app.js has an older document-level drawer touchstart handler. It runs
      // later in the same event; clear it once all synchronous handlers finish.
      queueMicrotask(resetLegacyDrawerSwipe);
    }
    return session;
  }

  function endSession(kind, event) {
    const session = kind === 'touch' ? touchSession : pointerSession;
    if (!session) return;
    promote(session, event?.target);
    pushRecent('end', session);
    queueMicrotask(() => {
      if (kind === 'touch' && touchSession === session) touchSession = null;
      if (kind === 'pointer' && pointerSession === session) pointerSession = null;
      syncBodyLayer();
    });
  }

  function currentSession(event = null) {
    const type = String(event?.type || '');
    if (type.startsWith('touch')) return touchSession;
    if (type.startsWith('pointer')) return pointerSession;
    return touchSession || pointerSession;
  }

  function layerForEvent(event = null, target = null) {
    const session = currentSession(event);
    if (session) return promote(session, target || event?.target)?.layer || detectLayer(target);
    return detectLayer(target || event?.target);
  }

  function canNavigate(mode, target = null, event = null) {
    const layer = layerForEvent(event, target);
    if (mode === 'chat') return layer === 'chat';
    if (mode === 'settings') return layer === 'settings';
    if (mode === 'drawer') return layer === 'base' || layer === 'drawer';
    return false;
  }

  function shouldBlockUnderlyingNavigation(event = null, target = null) {
    const layer = layerForEvent(event, target);
    return ['viewer', 'modal', 'context', 'selection', 'voice'].includes(layer);
  }

  function touchStart(event) {
    if (event.touches?.length !== 1) {
      touchSession = null;
      syncBodyLayer();
      return;
    }
    touchSession = makeSession('touch', event);
  }

  function touchMove(event) {
    if (!touchSession) return;
    promote(touchSession, event.target);
    if (blocksLegacyDrawer(touchSession.layer)) resetLegacyDrawerSwipe();
  }

  function pointerStart(event) {
    if (event.pointerType === 'mouse' || (event.button != null && event.button !== 0)) return;
    pointerSession = makeSession('pointer', event);
  }

  function pointerMove(event) {
    if (!pointerSession) return;
    promote(pointerSession, event.target);
  }

  window.addEventListener('touchstart', touchStart, { capture: true, passive: true });
  window.addEventListener('touchmove', touchMove, { capture: true, passive: true });
  window.addEventListener('touchend', (event) => endSession('touch', event), { capture: true, passive: true });
  window.addEventListener('touchcancel', (event) => endSession('touch', event), { capture: true, passive: true });

  window.addEventListener('pointerdown', pointerStart, { capture: true, passive: true });
  window.addEventListener('pointermove', pointerMove, { capture: true, passive: true });
  window.addEventListener('pointerup', (event) => endSession('pointer', event), { capture: true, passive: true });
  window.addEventListener('pointercancel', (event) => endSession('pointer', event), { capture: true, passive: true });

  const reset = () => {
    touchSession = null;
    pointerSession = null;
    resetLegacyDrawerSwipe();
    syncBodyLayer();
  };
  window.addEventListener('blur', reset, true);
  window.addEventListener('pagehide', reset, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') reset();
    else syncBodyLayer();
  });

  window.FPGesture135 = Object.freeze({
    priority: PRIORITY,
    detectLayer,
    currentLayer: (event = null, target = null) => layerForEvent(event, target),
    canNavigate,
    shouldBlockUnderlyingNavigation,
    resetLegacyDrawerSwipe,
    snapshot: () => ({
      owner: 'FPGesture135',
      layerSource: window.FPLayer173 ? 'FPLayer173' : 'legacy-dom-fallback',
      touch: touchSession ? { id: touchSession.id, layer: touchSession.layer } : null,
      pointer: pointerSession ? { id: pointerSession.id, layer: pointerSession.layer } : null,
      topLayer: detectLayer(),
      recent: recent.slice()
    })
  });

  const registerRuntime = () => {
    try {
      window.FPRuntime?.registerOwner?.('gesture-manager173', {
        role: 'gesture-arbiter',
        mode: 'active-owner',
        publicOwner: 'FPGesture135 + FPLayer173'
      });
    } catch {}
  };
  registerRuntime();
  window.addEventListener?.('fpchat:boot-ready', registerRuntime, { once: true, passive: true });

  syncBodyLayer();
})();
