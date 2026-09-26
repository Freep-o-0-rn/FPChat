/* Build 189.3: single owner for message-context geometry and mobile callout suppression.
   FPGesture135 arbitrates gesture admission; FPLayer173 arbitrates the active UI layer.
   This manager never changes chat scrollTop or message/history state. */
(() => {
  if (window.FPContextLayout189) return;

  const SAFE_GAP = 12;
  const STYLE_ID = 'fp-context-layout189-style';
  const states = new WeakMap();
  const stats = { mounts: 0, relayouts: 0, centered: 0, calloutsBlocked: 0, lastTranslateY: 0 };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .bubble-wrap.msg,.bubble-wrap.msg *{-webkit-touch-callout:none}
      .bubble-wrap.msg .bubble,.bubble-wrap.msg .message-text{-webkit-user-select:none;user-select:none}
      .message-context-cluster.fp-context-layout189{will-change:transform;transition:transform .2s cubic-bezier(.2,.8,.2,1)}
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

  function layout(root) {
    if (!admitted(root)) return false;
    const cluster = root.querySelector('.message-context-cluster');
    const clone = root.querySelector('.message-context-copy');
    const scroll = root.querySelector('.message-context-scroll');
    if (!cluster || !clone) return false;

    // The context layer owns only its visual copy. Never move the real chat.
    if (scroll && scroll.scrollTop !== 0) scroll.scrollTop = 0;
    cluster.classList.add('fp-context-layout189');
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
      // Keep the whole context visible while placing the selected message as
      // close to the viewport center as the menu/reactions allow.
      shift = Math.max(minShift, Math.min(maxShift, desired));
    } else {
      // Oversized content: preserve the selected message as the visual anchor.
      // The picker itself owns its internal scrolling.
      const centeredTop = cloneRect.top + desired;
      const centeredBottom = cloneRect.bottom + desired;
      if (centeredTop < bounds.top) shift += bounds.top - centeredTop;
      if (centeredBottom > bounds.bottom) shift -= centeredBottom - bounds.bottom;
    }

    shift = Math.round(shift);
    cluster.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
    stats.relayouts += 1;
    stats.centered += 1;
    stats.lastTranslateY = shift;
    return true;
  }

  function schedule(root) {
    requestAnimationFrame(() => requestAnimationFrame(() => layout(root)));
  }

  function mount(root) {
    if (!(root instanceof Element) || states.has(root)) return;
    const state = { observer: null };
    states.set(root, state);
    stats.mounts += 1;
    const observer = new MutationObserver(() => schedule(root));
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'aria-expanded'] });
    state.observer = observer;
    schedule(root);
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
    // Message long-press belongs to FPGesture135/message-context, not WebKit.
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

  window.visualViewport?.addEventListener?.('resize', () => document.querySelectorAll('.message-context-root').forEach(schedule), { passive: true });
  window.visualViewport?.addEventListener?.('scroll', () => document.querySelectorAll('.message-context-root').forEach(schedule), { passive: true });

  window.FPContextLayout189 = Object.freeze({
    relayout(root = document.querySelector('.message-context-root')) { if (root) schedule(root); },
    snapshot: () => ({ owner: 'FPContextLayout189', gestureArbiter: 'FPGesture135', layerArbiter: 'FPLayer173', ...stats })
  });

  try {
    window.FPRuntime?.registerOwner?.('context-layout189', {
      role: 'message-context-geometry-manager',
      mode: 'active-owner',
      gestureArbiter: 'FPGesture135',
      layerArbiter: 'FPLayer173',
      owns: 'context clone centering + context overlay geometry + mobile message callout suppression',
      doesNotOwn: 'chat scroll/history/message state/reaction mutations'
    });
  } catch {}
})();
