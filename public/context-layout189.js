/* Build 189.6: single owner for message-context geometry and smooth visual transition.
   FPGesture135 arbitrates gesture admission; FPLayer173 arbitrates the active UI layer.
   This manager never changes chat/history/message state or media playback. */
(() => {
  if (window.FPContextLayout189) return;

  const SAFE_GAP = 12;
  const STYLE_ID = 'fp-context-layout189-style';
  const states = new WeakMap();
  const stats = {
    mounts: 0,
    relayouts: 0,
    centered: 0,
    animatedOpens: 0,
    calloutsBlocked: 0,
    pickerBudgets: 0,
    lastTranslateY: 0
  };

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
    const rawTop = Math.max(0, Number(vv?.offsetTop || 0));
    const height = Math.max(1, Number(vv?.height || window.innerHeight || 1));
    return {
      top: rawTop + SAFE_GAP,
      bottom: rawTop + height - SAFE_GAP,
      center: rawTop + height / 2
    };
  }

  function admitted(root) {
    if (!(root instanceof Element) || !root.isConnected) return false;
    const layer = window.FPLayer173;
    if (layer && !['context', 'chat'].includes(layer.currentLayer(root))) return false;
    return true;
  }

  function setPickerBudget(cluster, picker, bounds) {
    if (!(picker instanceof Element)) return;
    if (picker.hidden) {
      picker.style.removeProperty('height');
      picker.style.removeProperty('max-height');
      return;
    }

    picker.style.removeProperty('height');
    picker.style.removeProperty('max-height');
    const pickerRect = picker.getBoundingClientRect();
    const clusterRect = cluster.getBoundingClientRect();
    const viewportHeight = Math.max(1, bounds.bottom - bounds.top);
    const surroundingHeight = Math.max(0, clusterRect.height - pickerRect.height);
    const mobile = window.matchMedia('(max-width: 900px)').matches;
    const cssCap = Math.min(
      mobile ? 360 : 420,
      viewportHeight * (mobile ? 0.45 : 0.50)
    );
    const available = Math.max(96, viewportHeight - surroundingHeight - 10);
    const height = Math.max(96, Math.min(cssCap, available));
    picker.style.height = `${Math.round(height)}px`;
    picker.style.maxHeight = `${Math.round(height)}px`;
    stats.pickerBudgets += 1;
  }

  function animateFirstPlacement(cluster, clone, shift) {
    if (reducedMotion()) return;
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

  function layout(root, reason = 'mutation') {
    if (!admitted(root)) return false;
    const cluster = root.querySelector('.message-context-cluster');
    const clone = root.querySelector('.message-context-copy');
    const scroll = root.querySelector('.message-context-scroll');
    const picker = root.querySelector('.fp-reaction-picker188');
    const state = states.get(root);
    if (!cluster || !clone || !state) return false;

    const pickerOpen = Boolean(picker && !picker.hidden);
    if (pickerOpen && state.pickerFrozen && !['picker-open', 'viewport-resize'].includes(reason)) {
      return true;
    }

    if (scroll && scroll.scrollTop !== 0) scroll.scrollTop = 0;
    cluster.classList.add('fp-context-layout189');

    const previousTransition = cluster.style.transition;
    cluster.style.transition = 'none';
    cluster.style.transform = '';

    const bounds = viewport();
    if (picker) setPickerBudget(cluster, picker, bounds);

    const cloneRect = clone.getBoundingClientRect();
    const clusterRect = cluster.getBoundingClientRect();
    const desired = bounds.center - (cloneRect.top + cloneRect.height / 2);
    const minShift = bounds.top - clusterRect.top;
    const maxShift = bounds.bottom - clusterRect.bottom;
    const availableHeight = bounds.bottom - bounds.top;

    let shift = desired;
    if (clusterRect.height <= availableHeight) {
      shift = Math.max(minShift, Math.min(maxShift, desired));
    } else {
      const centeredTop = cloneRect.top + desired;
      const centeredBottom = cloneRect.bottom + desired;
      if (centeredTop < bounds.top) shift += bounds.top - centeredTop;
      if (centeredBottom > bounds.bottom) shift -= centeredBottom - bounds.bottom;
    }

    shift = Math.round(shift);
    cluster.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
    void cluster.offsetWidth;
    cluster.style.transition = previousTransition;

    const firstPlacement = !state.placed;
    state.placed = true;
    state.shift = shift;
    state.pickerFrozen = pickerOpen;

    if (firstPlacement) animateFirstPlacement(cluster, clone, shift);

    stats.relayouts += 1;
    stats.centered += 1;
    stats.lastTranslateY = shift;
    return true;
  }

  function reasonPriority(reason) {
    if (reason === 'viewport-resize') return 5;
    if (reason === 'picker-open' || reason === 'picker-close' || reason === 'context-open') return 4;
    if (reason === 'external') return 3;
    if (reason === 'mount') return 2;
    return 1;
  }

  function schedule(root, reason = 'mutation') {
    const state = states.get(root);
    if (!state) return;

    const picker = root.querySelector('.fp-reaction-picker188');
    if (reason === 'mutation' && picker && !picker.hidden && state.pickerFrozen) return;

    if (!state.pendingReason || reasonPriority(reason) >= reasonPriority(state.pendingReason)) {
      state.pendingReason = reason;
    }
    if (state.raf) return;

    state.raf = requestAnimationFrame(() => {
      state.raf = requestAnimationFrame(() => {
        state.raf = 0;
        const nextReason = state.pendingReason || reason;
        state.pendingReason = '';
        layout(root, nextReason);
      });
    });
  }

  function mount(root) {
    if (!(root instanceof Element) || states.has(root)) return;
    const state = {
      observer: null,
      raf: 0,
      pendingReason: '',
      placed: false,
      shift: 0,
      pickerFrozen: false
    };
    states.set(root, state);
    stats.mounts += 1;

    const observer = new MutationObserver(() => schedule(root, 'mutation'));
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-expanded']
    });
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
    event.preventDefault();
    stats.calloutsBlocked += 1;
  }

  ensureStyle();
  document.addEventListener('contextmenu', suppressNativeContext, { capture: true });

  const bodyObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes || []) scan(node);
    }
  });
  bodyObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll('.message-context-root').forEach(mount);

  window.visualViewport?.addEventListener?.('resize', () => {
    document.querySelectorAll('.message-context-root').forEach((root) => schedule(root, 'viewport-resize'));
  }, { passive: true });

  window.FPContextLayout189 = Object.freeze({
    relayout(root = document.querySelector('.message-context-root'), reason = 'external') {
      if (root) schedule(root, reason);
    },
    snapshot: () => ({
      owner: 'FPContextLayout189',
      gestureArbiter: 'FPGesture135',
      layerArbiter: 'FPLayer173',
      ...stats
    })
  });

  try {
    window.FPRuntime?.registerOwner?.('context-layout189', {
      role: 'message-context-geometry-manager',
      mode: 'active-owner',
      gestureArbiter: 'FPGesture135',
      layerArbiter: 'FPLayer173',
      owns: 'context clone centering + context overlay geometry + transition + picker viewport budget + mobile message callout suppression',
      doesNotOwn: 'chat scroll/history/message state/audio playback/reaction mutations/reaction picker internal scroll'
    });
  } catch {}
})();