/* Build 171: centralized fetch ownership and ordered compatibility pipeline.
   FPChat keeps one public window.fetch owner while legacy feature layers are
   adapted into explicit, named stages in a deterministic order. */
(() => {
  if (window.FPNetwork171) return;
  if (typeof window.fetch !== 'function') return;

  const nativeFetch = window.fetch.bind(window);
  const layers = new Map();
  const continuationCache = new Map();
  const rejectedAssignments = [];
  const MAX_REJECTED = 40;

  // Lower priority = outer layer. This reproduces the intended Build 168/170
  // transport order without relying on script arrival timing.
  const LEGACY_SPECS = Object.freeze({
    'storage167-cache-fix.js': { id: 'storage-cache-copy167', priority: 100 },
    'storage167-clear-guard.js': { id: 'storage-clear-guard167', priority: 200 },
    'storage167.js': { id: 'storage-cache167', priority: 300 },
    'build165-ui.js': { id: 'voice-block-feedback166', priority: 400 },
    'chat-request-cooldown160.js': { id: 'chat-request-cooldown160', priority: 500 },
    'chat-request-owner147.js': { id: 'chat-request-owner147', priority: 600 },
    'room-lifecycle.js': { id: 'room-lifecycle98', priority: 700 },
    'typing.js': { id: 'typing-activity121', priority: 800 }
  });

  const stats = {
    startedAt: Date.now(),
    requests: 0,
    nativeCalls: 0,
    failures: 0,
    registrations: 0,
    rejectedAssignments: 0,
    perLayer: new Map()
  };

  function scriptName() {
    try {
      const src = String(document.currentScript?.src || '');
      if (!src) return '';
      return new URL(src, location.href).pathname.split('/').pop() || '';
    } catch {
      return '';
    }
  }

  function specForCurrentScript() {
    const name = scriptName();
    return name ? LEGACY_SPECS[name] || null : null;
  }

  function orderedLayersAfter(priority) {
    return [...layers.values()]
      .filter((layer) => layer.priority > priority)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  function layerStats(id) {
    if (!stats.perLayer.has(id)) stats.perLayer.set(id, { calls: 0, failures: 0 });
    return stats.perLayer.get(id);
  }

  async function dispatchAfter(priority, input, init) {
    const nextLayer = orderedLayersAfter(priority)[0];
    if (!nextLayer) {
      stats.nativeCalls += 1;
      return nativeFetch(input, init);
    }

    const entryStats = layerStats(nextLayer.id);
    entryStats.calls += 1;
    try {
      return await nextLayer.wrapper(input, init);
    } catch (error) {
      entryStats.failures += 1;
      throw error;
    }
  }

  function continuationForSpec(spec) {
    if (continuationCache.has(spec.id)) return continuationCache.get(spec.id);
    const continuation = function fpNetwork171Continuation(input, init) {
      return dispatchAfter(spec.priority, input, init);
    };
    Object.defineProperties(continuation, {
      __fpNetwork171Continuation: { value: true },
      __fpNetwork171LayerId: { value: spec.id }
    });
    continuationCache.set(spec.id, continuation);
    return continuation;
  }

  async function coordinatorFetch(input, init) {
    stats.requests += 1;
    try {
      return await dispatchAfter(Number.NEGATIVE_INFINITY, input, init);
    } catch (error) {
      stats.failures += 1;
      throw error;
    }
  }

  Object.defineProperties(coordinatorFetch, {
    __fpNetwork171: { value: true },
    __fpNetworkOwner: { value: 'FPNetwork171' }
  });

  function installLayer({ id, priority, wrapper, source = 'runtime', mode = 'native' }) {
    const safeId = String(id || '').trim();
    const safePriority = Number(priority);
    if (!safeId) throw new TypeError('FPNetwork171 layer id is required');
    if (!Number.isFinite(safePriority)) throw new TypeError(`FPNetwork171 layer ${safeId} requires numeric priority`);
    if (typeof wrapper !== 'function') throw new TypeError(`FPNetwork171 layer ${safeId} requires a function`);

    const current = layers.get(safeId);
    layers.set(safeId, {
      id: safeId,
      priority: safePriority,
      source: String(source || mode || 'runtime'),
      mode: String(mode || 'native'),
      wrapper
    });
    continuationCache.delete(safeId);
    if (!current || current.wrapper !== wrapper || current.priority !== safePriority) stats.registrations += 1;

    try {
      window.dispatchEvent(new CustomEvent('fpchat:network171-layer', {
        detail: { id: safeId, priority: safePriority, source: String(source || 'runtime'), mode: String(mode || 'native') }
      }));
    } catch {}

    return () => {
      const installed = layers.get(safeId);
      if (!installed || installed.wrapper !== wrapper) return false;
      layers.delete(safeId);
      continuationCache.delete(safeId);
      return true;
    };
  }

  // First-class API for Build 171+ code. Handler receives a stable next()
  // continuation, so new modules never assign window.fetch themselves.
  function use({ id, priority, handler, source = 'module' } = {}) {
    if (typeof handler !== 'function') throw new TypeError('FPNetwork171.use requires handler');
    const safeId = String(id || '').trim();
    const safePriority = Number(priority);
    const next = function fpNetwork171Next(input, init) {
      return dispatchAfter(safePriority, input, init);
    };
    const wrapper = function fpNetwork171Middleware(input, init) {
      return handler({ input, init, next, nativeFetch, fetch: coordinatorFetch });
    };
    return installLayer({ id: safeId, priority: safePriority, wrapper, source, mode: 'middleware' });
  }

  function registerLegacyAssignment(spec, wrapper, source) {
    return installLayer({
      id: spec.id,
      priority: spec.priority,
      wrapper,
      source,
      mode: 'legacy-adapter'
    });
  }

  function noteRejectedAssignment(value) {
    stats.rejectedAssignments += 1;
    const item = {
      at: Date.now(),
      source: scriptName() || 'unknown',
      functionName: typeof value === 'function' ? String(value.name || 'anonymous') : typeof value
    };
    rejectedAssignments.push(item);
    if (rejectedAssignments.length > MAX_REJECTED) rejectedAssignments.splice(0, rejectedAssignments.length - MAX_REJECTED);
    console.warn('[FPChat] Build 171 blocked an unowned window.fetch replacement:', item.source, item.functionName);
  }

  // Known legacy modules read window.fetch while their own script is executing.
  // They receive a stable continuation for their declared pipeline position.
  // Their later assignment is captured as a named layer rather than replacing
  // the public fetch function. Calls made later by normal app code always see
  // coordinatorFetch.
  Object.defineProperty(window, 'fetch', {
    configurable: false,
    enumerable: true,
    get() {
      const spec = specForCurrentScript();
      return spec ? continuationForSpec(spec) : coordinatorFetch;
    },
    set(value) {
      if (value === coordinatorFetch) return;
      const spec = specForCurrentScript();
      if (spec && typeof value === 'function') {
        registerLegacyAssignment(spec, value, scriptName());
        return;
      }
      noteRejectedAssignment(value);
    }
  });

  function snapshot() {
    return {
      owner: 'FPNetwork171',
      startedAt: stats.startedAt,
      requests: stats.requests,
      nativeCalls: stats.nativeCalls,
      failures: stats.failures,
      registrations: stats.registrations,
      rejectedAssignmentCount: stats.rejectedAssignments,
      layers: [...layers.values()]
        .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
        .map((layer) => ({
          id: layer.id,
          priority: layer.priority,
          source: layer.source,
          mode: layer.mode,
          calls: layerStats(layer.id).calls,
          failures: layerStats(layer.id).failures
        })),
      rejectedAssignments: rejectedAssignments.map((entry) => ({ ...entry }))
    };
  }

  function hasLayer(id) {
    return layers.has(String(id || ''));
  }

  function registerRuntimeOwner() {
    try {
      window.FPRuntime?.registerOwner?.('network171', {
        role: 'fetch-owner',
        mode: 'active-owner',
        publicOwner: 'window.fetch'
      });
    } catch {}
  }

  window.FPNetwork171 = Object.freeze({
    fetch: coordinatorFetch,
    nativeFetch,
    use,
    snapshot,
    hasLayer,
    expectedLayers: Object.freeze(Object.values(LEGACY_SPECS).map((item) => ({ ...item })))
  });

  registerRuntimeOwner();
  window.addEventListener('fpchat:boot-ready', registerRuntimeOwner, { once: true, passive: true });

  try {
    window.dispatchEvent(new CustomEvent('fpchat:network171-ready', { detail: snapshot() }));
  } catch {}
})();
