/* Build 189.5: single owner for message-context geometry, smooth visual transition,
   canvas-backed voice clone restoration and mobile callout suppression.
   FPGesture135 arbitrates gesture admission; FPLayer173 arbitrates the active UI layer.
   This manager never changes chat scrollTop or message/history state. */
(() => {
  if (window.FPContextLayout189) return;

  const SAFE_GAP = 12;
  const STYLE_ID = 'fp-context-layout189-style';
  const states = new WeakMap();
  const stats = { mounts: 0, relayouts: 0, centered: 0, animatedOpens: 0, calloutsBlocked: 0, canvasRestores: 0, lastTranslateY: 0 };

  function reducedMotion() {
    try { return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true; }
    catch { return false; }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .bubble-wrap.msg,.bubble-wrap.msg *{-webkit-touch-callout:none}
      .bubble-wrap.msg .bubble,.bubble-wrap.msg .message-text{-webkit-user-select:none;user-select:none}
      .message-context-cluster.fp-context-layout189{will-change:transform;transition:transform .2s cubic-bezier(.2,.8,.2,1)}
      .message-context-copy.fp-context-copy189{will-change:transform}
      @media (prefers-reduced-motion:reduce){.message-context-cluster.fp-context-layout189{transition:none}}
    `;
    document.head.appendChild(style);
  }

  function viewport() {
    const vv = window.visualViewport;
    const top = Math.max(0, Number(vv?.offsetTop || 0));
    const height = Math.max(1, Number(vv?.height || window.innerHeight || 1));
    return { top: top + SAFE_GAP, bottom: top + height - SAFE_GAP, center: top + height / 2 };
  }

  function admitted(root) {
    if (!(root instanceof Element) || !root.isConnected) return false;
    const layer = window.FPLayer173;
    if (layer && !['context', 'chat'].includes(layer.currentLayer(root))) return false;
    return true;
  }

  function messageIdOf(node) {
    return String(node?.dataset?.messageId || node?.dataset?.id || '').trim();
  }

  function restoreCanvasBackedUi(clone) {
    if (!(clone instanceof Element)) return 0;
    const messageId = messageIdOf(clone);
    if (!messageId) return 0;
    const original = [...document.querySelectorAll('#messages .bubble-wrap.msg')]
      .find((node) => messageIdOf(node) === messageId);
    if (!original) return 0;
    const sourceCanvases = [...original.querySelectorAll('canvas')];
    const cloneCanvases = [...clone.querySelectorAll('canvas')];
    let restored = 0;
    for (let i = 0; i < Math.min(sourceCanvases.length, cloneCanvases.length); i += 1) {
      const source = sourceCanvases[i];
      const target = cloneCanvases[i];
      if (!(source instanceof HTMLCanvasElement) || !(target instanceof HTMLCanvasElement)) continue;
      const width = Math.max(1, Number(source.width) || 1);
      const height = Math.max(1, Number(source.height) || 1);
      target.width = width;
      target.height = height;
      try {
        const ctx = target.getContext('2d');
        if (!ctx) continue;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(source, 0, 0, width, height);
        restored += 1;
      } catch {}
    }
    if (restored) stats.canvasRestores += restored;
    return restored;
  }

  function animateFirstPlacement(cluster, clone, shift, state) {
    if (state.placed || reducedMotion()) return;
    state.placed = true;
    stats.animatedOpens += 1;
    const target = shift ? `translate3d(0, ${shift}px, 0)` : 'translate3d(0, 0, 0)';
    try {
      cluster.animate([
        { transform: 'translate3d(0, 0, 0)', opacity: 0.96 },
        { transform: target, opacity: 1 }
      ], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'none' });
      clone.classList.add('fp-context-copy189');
      clone.animate([
        { transform: 'scale(.985)' },
        { transform: 'scale(1)' }
      ], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'none' });
    } catch {}
  }

  function layout(root) {
    if (!admitted(root)) return false;
    const cluster = root.querySelector('.message-context-cluster');
    const clone = root.querySelector('.message-context-copy');
    const scroll = root.querySelector('.message-context-scroll');
    const state = states.get(root);
    if (!cluster || !clone || !state) return false;

    // cloneNode() does not copy a canvas bitmap. Voice waveform and any other
    // canvas-backed message UI are restored from the original message without
    // creating a second player or taking playback ownership.
    restoreCanvasBackedUi(clone);

    const picker = root.querySelector('.fp-reaction-picker188');
    const pickerExpanded = Boolean(picker && !picker.hidden);
    if (pickerExpanded && state.placed) return true;

    if (scroll && scroll.scrollTop !== 0) scroll.scrollTop = 0;
    cluster.classList.add('fp-context-layout189');

    const previousTransition = cluster.style.transition;
    cluster.style.transition = 'none';
    cluster.style.transform = '';

    const bounds = viewport();
    const cloneRect = clone.getBoundingClientRect();
    const clusterRect = cluster.getBoundingClientRect();
    const desired = bounds.center - (cloneRect.top + cloneRect.height / 2);
    const minShift = bounds.top - clusterRect.top;
    const maxShift = bounds.bottom - clusterRect.bottom;

    let shift = desired;
    const availableHeight = bounds.bottom - bounds.top;
    if (clusterRect.height <= availableHeight) {
      shift = Math.max(minShift, Math.min(maxShift, desired));
    } else {
      const centeredTop = cloneRect.top + desired;
      const centeredBottom = cloneRect.bottom + desired;
      if (centeredTop < bounds.top) shift += bounds.top - centeredTop;
      if (centeredBottom > bounds.bottom) shift -= centeredBottom - bounds.bottom;
    }

    shift = Math.round(shift);
    const target = shift ? `translate3d(0, ${shift}px, 0)` : '';
    cluster.style.transform = target;
    void cluster.offsetWidth;
    cluster.style.transition = previousTransition;

    animateFirstPlacement(cluster, clone, shift, state);
    state.shift = shift;
    stats.relayouts += 1;
    stats.centered += 1;
    stats.lastTranslateY = shift;
    return true;
  }

  function schedule(root, reason = 'mutation') {
    const state = states.get(root);
    if (!state || state.raf) return;
    if (reason === 'mutation') {
      const picker = root.querySelector('.fp-reaction-picker188');
      if (picker && !picker.hidden && state.placed) return;
    }
    state.raf = requestAnimationFrame(() => {
      state.raf = requestAnimationFrame(() => {
        state.raf = 0;
        layout(root);
      });
    });
  }

  function mount(root) {
    if (!(root instanceof Element) || states.has(root)) return;
    const state = { observer: null, raf: 0, placed: false, shift: 0 };
    states.set(root, state);
    stats.mounts += 1;
    const observer = new MutationObserver(() => schedule(root, 'mutation'));
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-expanded'] });
    state.observer = observer;
    schedule(root, 'mount');
  }

  function scan(node) {
    if (!(node instanceof Element)) return;
    if (node.matches('.message-context-root')) mount(node);
    node.querySelectorAll?.('.message-context-root').forEach(mount);
  }

  function suppressNativeContext(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.bubble-wrap.msg')) return;
    if (target.closest('input,textarea,[contenteditable="true"]')) return;
    if (event.type === 'contextmenu') {
      event.preventDefault();
      stats.calloutsBlocked += 1;
    }
  }

  ensureStyle();
  document.addEventListener('contextmenu', suppressNativeContext, { capture: true });
  const bodyObserver = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes || []) scan(node);
  });
  bodyObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll('.message-context-root').forEach(mount);

  window.visualViewport?.addEventListener?.('resize', () => document.querySelectorAll('.message-context-root').forEach(root => schedule(root, 'viewport')), { passive: true });
  window.visualViewport?.addEventListener?.('scroll', () => document.querySelectorAll('.message-context-root').forEach(root => schedule(root, 'viewport')), { passive: true });

  window.FPContextLayout189 = Object.freeze({
    relayout(root = document.querySelector('.message-context-root'), reason = 'external') { if (root) schedule(root, reason); },
    snapshot: () => ({ owner: 'FPContextLayout189', gestureArbiter: 'FPGesture135', layerArbiter: 'FPLayer173', ...stats })
  });

  try {
    window.FPRuntime?.registerOwner?.('context-layout189', {
      role: 'message-context-geometry-manager',
      mode: 'active-owner',
      gestureArbiter: 'FPGesture135',
      layerArbiter: 'FPLayer173',
      owns: 'initial context clone centering + context overlay geometry + context transition + canvas-backed clone presentation + mobile message callout suppression',
      doesNotOwn: 'chat scroll/history/message state/audio playback/reaction mutations/reaction picker internal scroll'
    });
  } catch {}
})();
