/* Build 169: passive runtime diagnostics foundation.
   Does not own chat logic, transport, rendering, gestures, storage or message state.
   No message text, room secrets, recovery codes or device identifiers are collected. */
(() => {
  if (window.FPRuntime169) return;

  const startedAt = performance.now();
  const counters = Object.create(null);
  const recent = [];
  const resources = [];
  const longTasks = [];
  const owners = new Map();
  const trackedResources = new Map();
  const measurements = [];
  const captures = [];
  const errors = [];
  let nextResourceId = 1;
  let nextMeasurementId = 1;
  let bootReadyAt = Number(window.__fpBootReady169At || 0) || null;
  let bootReadySource = bootReadyAt == null ? null : 'boot-ready-marker';

  const COVERAGE = Object.freeze({
    navigation: 'browser-performance-entry',
    completedNetworkResources: 'performance-resource-partial-by-browser-buffer',
    longTasks: 'browser-dependent',
    memory: 'browser-dependent',
    lifecycleEvents: 'from-runtime-installation',
    timers: 'partial-static-audit-and-registered-only',
    observers: 'partial-static-audit-and-registered-only',
    websocket: 'snapshot-only',
    roomOpenDuration: 'manual-measurement-api-until-build170-owner',
    reconnectDuration: 'manual-measurement-api-until-build170-owner',
    server: 'separate-optional-sampler'
  });

  const LEGACY_AUDIT = Object.freeze({
    polling: [
      { owner: 'message-actions', cadenceMs: 500, purpose: 'attach current WebSocket' },
      { owner: 'message-pins', cadenceMs: 500, purpose: 'attach current WebSocket' },
      { owner: 'message-pins-screen115', cadenceMs: 500, purpose: 'attach current WebSocket' },
      { owner: 'voice', cadenceMs: 500, purpose: 'room/UI state tracking' },
      { owner: 'message-actions', cadenceMs: 30000, purpose: 'sync all rooms while visible' },
      { owner: 'system-chat144', cadenceMs: 10000, purpose: 'system state refresh while visible' },
      { owner: 'chat-request-actions146', cadenceMs: 10000, purpose: 'chat request refresh while visible' }
    ],
    fetchOwners: [
      'typing',
      'room-lifecycle',
      'build165-ui voice block feedback',
      'chat-request-owner147',
      'storage167',
      'storage167-clear-guard',
      'storage167-cache-fix'
    ],
    appendMessageOwners: [
      'message-actions',
      'voice-polish123',
      'user-blocks165',
      'storage167',
      'storage167-cache-fix'
    ],
    broadDomObservers: [
      'chat-fix',
      'build165-ui',
      'message-actions',
      'message-pins',
      'voice',
      'voice-cancel125',
      'viewport-layout136',
      'viewport-fix',
      'system-ui148',
      'storage168'
    ]
  });

  const KNOWN_LEGACY_COUNTS = Object.freeze({
    pollingLoops: LEGACY_AUDIT.polling.length,
    fetchOwners: LEGACY_AUDIT.fetchOwners.length,
    appendMessageOwners: LEGACY_AUDIT.appendMessageOwners.length,
    broadDomObservers: LEGACY_AUDIT.broadDomObservers.length
  });

  function inc(name, by = 1) {
    counters[name] = (Number(counters[name]) || 0) + by;
  }

  function pushRecent(type, detail = '') {
    recent.push({ at: Date.now(), type: String(type || ''), detail: String(detail || '').slice(0, 120) });
    while (recent.length > 80) recent.shift();
  }

  function safePath(value) {
    try {
      const url = new URL(String(value || ''), location.href);
      return { sameOrigin: url.origin === location.origin, pathname: url.pathname };
    } catch {
      return { sameOrigin: false, pathname: '' };
    }
  }

  function classifyResource(entry) {
    const info = safePath(entry?.name);
    if (!info.sameOrigin) return 'external';
    if (info.pathname.startsWith('/api/media/')) return 'media';
    if (info.pathname.startsWith('/api/')) return 'api';
    if (info.pathname.endsWith('.js')) return 'js';
    if (info.pathname.endsWith('.css')) return 'css';
    if (info.pathname.endsWith('.json')) return 'json';
    return 'other';
  }

  function recordResource(entry) {
    if (!entry) return;
    const item = {
      at: Math.round(Number(entry.startTime || 0)),
      durationMs: Math.round((Number(entry.duration || 0) || 0) * 10) / 10,
      transferSize: Math.max(0, Number(entry.transferSize || 0) || 0),
      encodedBodySize: Math.max(0, Number(entry.encodedBodySize || 0) || 0),
      type: classifyResource(entry),
      path: safePath(entry.name).pathname
    };
    resources.push(item);
    while (resources.length > 1200) resources.shift();
    inc(`resource:${item.type}`);
  }

  try {
    performance.getEntriesByType('resource').forEach(recordResource);
    const po = new PerformanceObserver((list) => list.getEntries().forEach(recordResource));
    po.observe({ type: 'resource', buffered: false });
  } catch {}

  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const durationMs = Math.max(0, Number(entry.duration || 0) || 0);
        longTasks.push({ at: Math.round(Number(entry.startTime || 0)), durationMs: Math.round(durationMs * 10) / 10 });
        while (longTasks.length > 200) longTasks.shift();
        inc('longtask');
      }
    });
    po.observe({ type: 'longtask', buffered: true });
  } catch {}

  function noteLifecycle(type, detail = '') {
    inc(`lifecycle:${type}`);
    pushRecent(`lifecycle:${type}`, detail);
  }

  document.addEventListener('visibilitychange', () => noteLifecycle('visibility', document.visibilityState), { passive: true });
  window.addEventListener('focus', () => noteLifecycle('focus'), { passive: true });
  window.addEventListener('blur', () => noteLifecycle('blur'), { passive: true });
  window.addEventListener('online', () => noteLifecycle('online'), { passive: true });
  window.addEventListener('offline', () => noteLifecycle('offline'), { passive: true });
  window.addEventListener('pageshow', (event) => noteLifecycle('pageshow', event.persisted ? 'bfcache' : 'normal'), { passive: true });
  window.addEventListener('pagehide', (event) => noteLifecycle('pagehide', event.persisted ? 'bfcache' : 'normal'), { passive: true });

  for (const eventName of [
    'fpchat:boot-ready',
    'fpchat:storage-changed',
    'fpchat:storage-settings-changed',
    'fpchat:block-list-changed',
    'fpchat:chat-request-changed'
  ]) {
    window.addEventListener(eventName, () => {
      inc(`event:${eventName}`);
      if (eventName === 'fpchat:boot-ready' && bootReadyAt == null) {
        bootReadyAt = performance.now();
        bootReadySource = 'event';
      }
      pushRecent(eventName);
    }, { passive: true });
  }

  setTimeout(() => {
    if (bootReadyAt != null) return;
    const root = document.getElementById('appRoot');
    const gate = document.getElementById('bootHold152');
    if (root && !root.classList.contains('hidden-boot') && !gate && !document.documentElement.hasAttribute('data-fp-boot152')) {
      bootReadyAt = performance.now();
      bootReadySource = 'detected-after-install';
    }
  }, 0);

  window.addEventListener('error', (event) => {
    inc('error');
    errors.push({
      at: Date.now(),
      type: 'error',
      message: String(event?.message || 'error').slice(0, 180),
      source: safePath(event?.filename).pathname
    });
    while (errors.length > 40) errors.shift();
  });

  window.addEventListener('unhandledrejection', (event) => {
    inc('unhandledrejection');
    let message = 'unhandled rejection';
    try { message = String(event?.reason?.message || event?.reason || message); } catch {}
    errors.push({ at: Date.now(), type: 'unhandledrejection', message: message.slice(0, 180), source: '' });
    while (errors.length > 40) errors.shift();
  });

  function registerOwner(name, metadata = {}) {
    const key = String(name || '').trim();
    if (!key) return false;
    owners.set(key, { name: key, ...metadata, registeredAt: Date.now() });
    inc('owner:registered');
    return true;
  }

  function registerResource(owner, kind, name, metadata = {}) {
    const id = nextResourceId++;
    trackedResources.set(id, {
      id,
      owner: String(owner || 'unknown'),
      kind: String(kind || 'unknown'),
      name: String(name || ''),
      ...metadata,
      registeredAt: Date.now()
    });
    inc(`tracked:${String(kind || 'unknown')}`);
    return id;
  }

  function releaseResource(id) {
    return trackedResources.delete(Number(id));
  }

  function startMeasure(name, metadata = {}) {
    const token = {
      id: nextMeasurementId++,
      name: String(name || 'unnamed').slice(0, 80),
      startedAt: performance.now(),
      metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {}
    };
    inc(`measure:${token.name}:started`);
    return token;
  }

  function endMeasure(token, status = 'ok') {
    if (!token || !Number.isFinite(Number(token.startedAt))) return null;
    const durationMs = Math.max(0, performance.now() - Number(token.startedAt));
    const item = {
      id: Number(token.id || 0),
      name: String(token.name || 'unnamed').slice(0, 80),
      durationMs: Math.round(durationMs * 10) / 10,
      status: String(status || 'ok').slice(0, 40),
      at: Date.now()
    };
    measurements.push(item);
    while (measurements.length > 200) measurements.shift();
    inc(`measure:${item.name}:finished`);
    return item;
  }

  function measurementSummary() {
    const grouped = Object.create(null);
    for (const item of measurements) {
      const bucket = grouped[item.name] || (grouped[item.name] = { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 });
      bucket.count += 1;
      bucket.totalMs += item.durationMs;
      bucket.maxMs = Math.max(bucket.maxMs, item.durationMs);
      bucket.lastMs = item.durationMs;
    }
    for (const bucket of Object.values(grouped)) {
      bucket.avgMs = bucket.count ? Math.round((bucket.totalMs / bucket.count) * 10) / 10 : null;
      bucket.totalMs = Math.round(bucket.totalMs * 10) / 10;
      bucket.maxMs = Math.round(bucket.maxMs * 10) / 10;
    }
    return grouped;
  }

  function navigationSnapshot() {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (!nav) return null;
      return {
        type: nav.type || null,
        domInteractiveMs: Math.round(Number(nav.domInteractive || 0)),
        domContentLoadedMs: Math.round(Number(nav.domContentLoadedEventEnd || 0)),
        loadEventEndMs: Math.round(Number(nav.loadEventEnd || 0)),
        transferSize: Math.max(0, Number(nav.transferSize || 0) || 0)
      };
    } catch {
      return null;
    }
  }

  function memorySnapshot() {
    try {
      const memory = performance.memory;
      if (!memory) return { supported: false };
      return {
        supported: true,
        usedJSHeapSize: Number(memory.usedJSHeapSize || 0),
        totalJSHeapSize: Number(memory.totalJSHeapSize || 0),
        jsHeapSizeLimit: Number(memory.jsHeapSizeLimit || 0)
      };
    } catch {
      return { supported: false };
    }
  }

  async function sampleMemory() {
    try {
      if (typeof performance.measureUserAgentSpecificMemory === 'function') {
        const result = await performance.measureUserAgentSpecificMemory();
        return { supported: true, source: 'measureUserAgentSpecificMemory', bytes: Number(result?.bytes || 0) || 0 };
      }
    } catch {}
    const legacy = memorySnapshot();
    return legacy.supported
      ? { supported: true, source: 'performance.memory', bytes: legacy.usedJSHeapSize }
      : { supported: false, source: 'unavailable', bytes: null };
  }

  function roomSnapshot() {
    try {
      return {
        open: Boolean(typeof state !== 'undefined' && state?.roomId),
        chats: Array.isArray(state?.chats) ? state.chats.length : 0,
        messageCacheSize: typeof messageCache !== 'undefined' && messageCache?.size != null ? Number(messageCache.size) : null,
        roomKeyCacheSize: typeof roomKeyCache !== 'undefined' && roomKeyCache?.size != null ? Number(roomKeyCache.size) : null
      };
    } catch {
      return { open: false, chats: 0, messageCacheSize: null, roomKeyCacheSize: null };
    }
  }

  function websocketSnapshot() {
    try {
      const ws = typeof state !== 'undefined' ? state?.ws : null;
      return { exists: Boolean(ws), readyState: ws ? Number(ws.readyState) : null };
    } catch {
      return { exists: false, readyState: null };
    }
  }

  function domSnapshot() {
    let gestureLayer = null;
    try { gestureLayer = window.FPGesture135?.snapshot?.()?.topLayer || null; } catch {}
    return {
      messages: document.querySelectorAll('#messages .bubble-wrap.msg').length,
      nodes: document.getElementsByTagName('*').length,
      scripts: document.scripts.length,
      stylesheets: document.styleSheets?.length || 0,
      gestureLayer
    };
  }

  function resourceSummary(windowMs = 60000) {
    const cutoff = Math.max(0, performance.now() - Math.max(1000, Number(windowMs) || 60000));
    const summary = { total: 0, api: 0, media: 0, js: 0, css: 0, json: 0, other: 0, external: 0, transferSize: 0 };
    for (const item of resources) {
      if (item.at < cutoff) continue;
      summary.total += 1;
      summary[item.type] = (summary[item.type] || 0) + 1;
      summary.transferSize += item.transferSize;
    }
    return summary;
  }

  function snapshot() {
    return {
      build: 169,
      mode: 'shadow',
      uptimeMs: Math.round(performance.now() - startedAt),
      bootReadyMs: bootReadyAt == null ? null : Math.round(bootReadyAt),
      bootReadySource,
      visibility: document.visibilityState,
      online: navigator.onLine,
      navigation: navigationSnapshot(),
      memory: memorySnapshot(),
      room: roomSnapshot(),
      websocket: websocketSnapshot(),
      dom: domSnapshot(),
      resourcesLastMinute: resourceSummary(60000),
      performance: {
        longTaskCount: longTasks.length,
        longTaskDurationMs: Math.round(longTasks.reduce((sum, item) => sum + item.durationMs, 0) * 10) / 10
      },
      knownLegacyCounts: KNOWN_LEGACY_COUNTS,
      legacyAuditBuild: 168,
      legacyAuditScope: 'historical-static-baseline-not-current-runtime-counts',
      coverage: COVERAGE,
      registeredOwners: [...owners.values()],
      registeredResources: [...trackedResources.values()],
      measurementSummary: measurementSummary(),
      counters: { ...counters },
      errors: errors.slice(-20),
      recent: recent.slice(-30)
    };
  }

  function capture(label = '') {
    const item = { label: String(label || '').slice(0, 80), capturedAt: new Date().toISOString(), snapshot: snapshot() };
    captures.push(item);
    while (captures.length > 30) captures.shift();
    return item;
  }

  function inspect() {
    return {
      ...snapshot(),
      legacyAudit: LEGACY_AUDIT,
      recentMeasurements: measurements.slice(-30),
      captures: captures.slice()
    };
  }

  window.FPRuntime169 = Object.freeze({
    registerOwner,
    registerResource,
    releaseResource,
    startMeasure,
    endMeasure,
    measurementSummary,
    sampleMemory,
    capture,
    snapshot,
    inspect,
    resourceSummary,
    coverage: COVERAGE,
    legacyAudit: LEGACY_AUDIT,
    knownLegacyCounts: KNOWN_LEGACY_COUNTS
  });
  window.FPRuntime = window.FPRuntime169;

  registerOwner('runtime169', { role: 'diagnostics', mode: 'shadow' });
  pushRecent('runtime:installed', 'Build 169 shadow diagnostics');
})();
