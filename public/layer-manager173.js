/* Build 173: explicit UI layer ownership for gestures and overlays.
   Existing feature modules keep their behavior; this module owns layer state. */
(() => {
  if (window.FPLayer173) return;

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

  const MODAL_TARGETS = [
    '.media-preview-overlay,.fp-pins114-screen,.fp-pins114-action-overlay,.fp-pins114-delete-overlay',
    '.message-delete-overlay',
    '.message-selection-delete-overlay',
    '.destructive-modal-overlay',
    '.message-pin-overlay',
    '[aria-modal="true"]'
  ].join(',');

  const claims = new Map();
  const mounted = {
    chat: new Set(),
    settings: new Set(),
    context: new Set(),
    modal: new Set(),
    viewer: new Set()
  };
  const recent = [];
  let version = 0;
  let top = 'base';
  let composerObserver = null;
  let composerNode = null;
  let bodyObserver = null;
  let sidebarObserver = null;
  let legacyContextObserver = null;
  let compatibilityObserver = null;

  function priority(layer) {
    return PRIORITY[layer] ?? PRIORITY.base;
  }

  function pushRecent(reason, layer) {
    recent.push({ at: Date.now(), reason: String(reason || ''), layer: String(layer || 'base') });
    while (recent.length > 24) recent.shift();
  }

  function claimSet(layer) {
    let set = claims.get(layer);
    if (!set) {
      set = new Set();
      claims.set(layer, set);
    }
    return set;
  }

  function computeTop() {
    let next = 'base';
    for (const [layer, tokens] of claims) {
      if (!tokens.size) continue;
      if (priority(layer) > priority(next)) next = layer;
    }
    if (next === top) return top;
    top = next;
    version += 1;
    if (document.body) document.body.dataset.fpLayer173 = top;
    pushRecent('top-changed', top);
    try {
      window.dispatchEvent(new CustomEvent('fpchat:layer173', { detail: { layer: top, version } }));
    } catch {}
    return top;
  }

  function setClaim(layer, token, active = true) {
    const name = String(layer || 'base');
    const key = String(token || 'anonymous');
    if (!Object.prototype.hasOwnProperty.call(PRIORITY, name) || name === 'base') return false;
    const set = claimSet(name);
    const before = set.size;
    if (active) set.add(key);
    else set.delete(key);
    if (set.size !== before) computeTop();
    return true;
  }

  function claim(layer, token) {
    setClaim(layer, token, true);
    return () => setClaim(layer, token, false);
  }

  function targetLayer(target) {
    const el = target instanceof Element ? target : target?.parentElement instanceof Element ? target.parentElement : null;
    if (!el) return 'base';
    if (el.closest('.media-viewer-overlay')) return 'viewer';
    if (el.closest(MODAL_TARGETS)) return 'modal';
    if (el.closest('.message-context-root')) return 'context';
    if (el.closest(VOICE_TARGETS)) return 'voice';
    if (el.closest('.fp-settings131')) return 'settings';
    if (el.closest('#sidebar')) return 'drawer';
    if (el.closest('.chat-view')) return 'chat';
    return 'base';
  }

  function currentLayer(target = null) {
    const local = targetLayer(target);
    return priority(local) > priority(top) ? local : top;
  }

  function syncMountedClaim(kind, layer) {
    const set = mounted[kind];
    setClaim(layer, `dom:${kind}`, Boolean(set?.size));
  }

  function onMounted(kind, layer, detail) {
    if (!(detail?.node instanceof Element)) return;
    mounted[kind].add(detail.node);
    syncMountedClaim(kind, layer);
  }

  function onUnmounted(kind, layer, detail) {
    if (!(detail?.node instanceof Element)) return;
    mounted[kind].delete(detail.node);
    syncMountedClaim(kind, layer);
  }

  function bindDomLifecycle() {
    const dom = window.FPDOM173;
    if (!dom?.on) return false;
    for (const [kind, layer] of [
      ['chat', 'chat'],
      ['settings', 'settings'],
      ['context', 'context'],
      ['modal', 'modal'],
      ['viewer', 'viewer']
    ]) {
      dom.on(kind, 'mounted', (detail) => onMounted(kind, layer, detail));
      dom.on(kind, 'unmounted', (detail) => onUnmounted(kind, layer, detail));
    }
    dom.on('composer', 'mounted', ({ node }) => bindComposer(node));
    dom.on('composer', 'unmounted', ({ node }) => {
      if (node === composerNode) bindComposer(null);
    });
    return true;
  }

  function syncBodyClaims() {
    setClaim('selection', 'body:selection', Boolean(document.body?.classList.contains('fp-message-selection-open')));
  }

  function syncSidebarClaim() {
    const sidebar = document.getElementById('sidebar');
    setClaim('drawer', 'sidebar:open', Boolean(sidebar?.classList.contains('open')));
  }

  function syncLegacyContextClaim() {
    const menu = document.getElementById('contextMenu');
    const active = Boolean(menu && !menu.classList.contains('hidden') && !menu.hidden);
    setClaim('context', 'legacy-context-menu', active);
  }

  function syncVoiceClaim() {
    const form = composerNode;
    const active = Boolean(
      form?.classList.contains('fp-voice-recording')
      || form?.classList.contains('fp-voice-previewing')
      || form?.classList.contains('fp-voice-processing')
    );
    setClaim('voice', 'composer:voice', active);
  }

  function bindComposer(node) {
    composerObserver?.disconnect();
    composerObserver = null;
    composerNode = node instanceof Element ? node : null;
    syncVoiceClaim();
    if (!composerNode || typeof MutationObserver !== 'function') return;
    composerObserver = new MutationObserver(syncVoiceClaim);
    composerObserver.observe(composerNode, { attributes: true, attributeFilter: ['class'] });
  }

  function bootstrapMounted() {
    const selectors = {
      chat: '.chat-view',
      settings: '.fp-settings131',
      context: '.message-context-root',
      modal: MODAL_TARGETS,
      viewer: '.media-viewer-overlay'
    };
    for (const [kind, selector] of Object.entries(selectors)) {
      document.querySelectorAll(selector).forEach((node) => mounted[kind].add(node));
    }
    syncMountedClaim('chat', 'chat');
    syncMountedClaim('settings', 'settings');
    syncMountedClaim('context', 'context');
    syncMountedClaim('modal', 'modal');
    syncMountedClaim('viewer', 'viewer');
    bindComposer(document.getElementById('sendForm'));
    syncBodyClaims();
    syncSidebarClaim();
    syncLegacyContextClaim();
  }

  function installCompatibilityDomObserver() {
    if (typeof MutationObserver !== 'function' || compatibilityObserver) return;
    const selectors = {
      chat: '.chat-view',
      settings: '.fp-settings131',
      context: '.message-context-root',
      modal: MODAL_TARGETS,
      viewer: '.media-viewer-overlay'
    };
    const process = (root, phase) => {
      if (!(root instanceof Element)) return;
      for (const [kind, selector] of Object.entries(selectors)) {
        const nodes = [];
        if (root.matches?.(selector)) nodes.push(root);
        root.querySelectorAll?.(selector).forEach((node) => nodes.push(node));
        for (const node of nodes) {
          if (phase === 'mounted') onMounted(kind, kind === 'chat' ? 'chat' : kind, { node });
          else onUnmounted(kind, kind === 'chat' ? 'chat' : kind, { node });
        }
      }
      const composer = root.matches?.('#sendForm') ? root : root.querySelector?.('#sendForm');
      if (phase === 'mounted' && composer) bindComposer(composer);
      if (phase === 'unmounted' && composer === composerNode) bindComposer(null);
    };
    compatibilityObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes || []) process(node, 'unmounted');
        for (const node of record.addedNodes || []) process(node, 'mounted');
      }
    });
    compatibilityObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function installTargetedObservers() {
    if (typeof MutationObserver !== 'function') return;
    if (document.body) {
      bodyObserver = new MutationObserver(syncBodyClaims);
      bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebarObserver = new MutationObserver(syncSidebarClaim);
      sidebarObserver.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
    }
    const legacyContext = document.getElementById('contextMenu');
    if (legacyContext) {
      legacyContextObserver = new MutationObserver(syncLegacyContextClaim);
      legacyContextObserver.observe(legacyContext, { attributes: true, attributeFilter: ['class', 'hidden'] });
    }
  }

  function snapshot() {
    return {
      owner: 'FPLayer173',
      topLayer: top,
      version,
      claims: [...claims.entries()]
        .filter(([, set]) => set.size)
        .map(([layer, set]) => ({ layer, count: set.size })),
      mounted: Object.fromEntries(Object.entries(mounted).map(([kind, set]) => [kind, set.size])),
      recent: recent.slice()
    };
  }

  window.FPLayer173 = Object.freeze({
    priority: PRIORITY,
    claim,
    setClaim,
    currentLayer,
    targetLayer,
    topLayer: () => top,
    version: () => version,
    snapshot
  });

  const domLifecycleBound = bindDomLifecycle();
  bootstrapMounted();
  installTargetedObservers();
  if (!domLifecycleBound) installCompatibilityDomObserver();
  computeTop();

  const registerRuntime = () => {
    try {
      window.FPRuntime?.registerOwner?.('layer-manager173', {
        role: 'ui-layer-owner',
        mode: 'active-owner',
        publicOwner: 'FPLayer173'
      });
    } catch {}
  };
  registerRuntime();
  window.addEventListener?.('fpchat:boot-ready', registerRuntime, { once: true, passive: true });
})();
