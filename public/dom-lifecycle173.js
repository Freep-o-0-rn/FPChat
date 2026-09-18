/* Build 173: one DOM lifecycle observer for feature mount/unmount events.
   DOM remains a projection; this module does not own chat/message state. */
(() => {
  if (window.FPDOM173) return;

  const registry = Object.freeze({
    chat: '.chat-view',
    composer: '#sendForm',
    message: '.bubble-wrap.msg',
    context: '.message-context-root',
    settings: '.fp-settings131',
    viewer: '.media-viewer-overlay',
    modal: '.message-delete-overlay,.message-selection-delete-overlay,.destructive-modal-overlay,.message-pin-overlay,[aria-modal="true"]',
    progress: '.media-save-progress'
  });

  const listeners = new Map();
  const stats = { mounted: {}, unmounted: {}, observerCallbacks: 0 };
  let observer = null;

  function listenerKey(kind, phase) {
    return `${String(kind)}:${String(phase)}`;
  }

  function on(kind, phase, handler) {
    const key = listenerKey(kind, phase);
    if (typeof handler !== 'function') return () => {};
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (!set.size) listeners.delete(key);
    };
  }

  function emit(kind, phase, node) {
    stats[phase === 'mounted' ? 'mounted' : 'unmounted'][kind] =
      (stats[phase === 'mounted' ? 'mounted' : 'unmounted'][kind] || 0) + 1;

    const detail = { kind, phase, node };
    const set = listeners.get(listenerKey(kind, phase));
    if (set) {
      for (const handler of [...set]) {
        try { handler(detail); } catch (error) { console.error('[FPDOM173] listener failed', error); }
      }
    }

    try {
      window.dispatchEvent(new CustomEvent('fpchat:dom173', { detail }));
    } catch {}
  }

  function collect(root, selector) {
    if (!(root instanceof Element)) return [];
    const out = [];
    if (root.matches?.(selector)) out.push(root);
    root.querySelectorAll?.(selector).forEach((node) => out.push(node));
    return out;
  }

  function processNode(root, phase) {
    if (!(root instanceof Element)) return;
    for (const [kind, selector] of Object.entries(registry)) {
      for (const node of collect(root, selector)) emit(kind, phase, node);
    }
  }

  function scanExisting() {
    for (const [kind, selector] of Object.entries(registry)) {
      document.querySelectorAll(selector).forEach((node) => emit(kind, 'mounted', node));
    }
  }

  function install() {
    if (observer || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver((records) => {
      stats.observerCallbacks += 1;
      for (const record of records) {
        for (const node of record.removedNodes || []) processNode(node, 'unmounted');
        for (const node of record.addedNodes || []) processNode(node, 'mounted');
      }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    scanExisting();
  }

  function snapshot() {
    return {
      owner: 'FPDOM173',
      observerCallbacks: stats.observerCallbacks,
      mounted: { ...stats.mounted },
      unmounted: { ...stats.unmounted },
      listenerGroups: listeners.size
    };
  }

  window.FPDOM173 = Object.freeze({
    on,
    snapshot,
    kinds: Object.freeze(Object.keys(registry))
  });

  try {
    window.FPRuntime?.registerOwner?.('dom-lifecycle173', {
      role: 'dom-lifecycle-events',
      mode: 'active-owner',
      publicOwner: 'FPDOM173'
    });
  } catch {}

  window.addEventListener?.('fpchat:boot-ready', () => {
    try {
      window.FPRuntime?.registerOwner?.('dom-lifecycle173', {
        role: 'dom-lifecycle-events',
        mode: 'active-owner',
        publicOwner: 'FPDOM173'
      });
    } catch {}
  }, { once: true, passive: true });

  install();
})();
