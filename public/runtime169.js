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
    roomOpenDuration: 'build186-explicit-owner-stages; direct-entry-partial',
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

  // Build 186.4: bounded, explicit observations. No transport/timer/crypto
  // monkey patches, request bodies, URL keys, content or persistent telemetry.
  const loading186 = (() => {
    const LIMIT = 240;
    const records = new Map(), contexts = new WeakMap(), watches = new Map();
    const kinds = new Set(['room', 'media', 'viewer', 'gallery-history', 'cache-repair']);
    const consumers = new Set(['chat-thumbnail', 'gallery-current', 'gallery-neighbor', 'other']);
    const phases = new Set(('key-start key-ready join-start join-headers join-ready committed history-start history-ready render-start first-message-mounted text-ready draft-start draft-ready composer-ready scroll-start scroll-ready layout-wait-start layout-thumbs-wait-end layout-wait-end messages-revealed visible-frame ready queue-start slot-ready cache-start cache-ready cache-open-start cache-open-ready cache-meta-start cache-meta-ready cache-match-start cache-match-ready cache-delete-start cache-delete-ready cache-keys-start cache-keys-ready cache-repair-start cache-repair-ready maintenance-wait-start maintenance-wait-end cache-keys-wait-start cache-keys-wait-end network-start response-ready body-start body-ready buffer-start buffer-ready decrypt-start decrypt-ready url-ready asset-start asset-ready element-ready paint-opportunity history-page').split(' '));
    const cacheStates = new Set(['unknown', 'hit', 'miss', 'expired', 'unavailable', 'error', 'ram-hit', 'ram-pending']);
    let sequence = 0, dropped = 0, enabled = true, sweepQueued = false;
    const round = value => Math.round(Math.max(0, value) * 10) / 10;
    const get = token => token && records.get(token.id);
    function cleanup(id) { const watch = watches.get(id); if (watch) { watches.delete(id); watch.cleanup(); } }
    function begin(kind, metadata = {}) {
      if (!enabled || !kinds.has(kind)) return null;
      const id = ++sequence;
      const item = {id, kind, startMs:performance.now(), durationMs:null, status:'pending', points:{}, counts:{}, cache:'unknown'};
      if (consumers.has(metadata.consumer)) item.consumer = metadata.consumer;
      if (metadata.endpoint === 'thumb' || metadata.endpoint === 'blob') item.endpoint = metadata.endpoint;
      if (['image','video','audio','file'].includes(metadata.mediaType)) item.mediaType = metadata.mediaType;
      if (Number.isSafeInteger(metadata.parent)) item.parent = metadata.parent;
      records.set(id, item);
      while (records.size > LIMIT) { const oldest = records.keys().next().value; cleanup(oldest); records.delete(oldest); dropped++; }
      return Object.freeze({id});
    }
    function step(token, name, value) {
      const item = get(token);
      if (!enabled || !item || !phases.has(name) || item.status === 'cancelled' || item.status === 'error') return;
      if (item.status !== 'pending' && !['messages-revealed','visible-frame'].includes(name)) return;
      if (item.points[name] === undefined) item.points[name] = round(performance.now() - item.startMs);
      if (name === 'history-page') item.counts.pages = (item.counts.pages || 0) + 1;
      if (['history-ready', 'text-ready'].includes(name) && Number.isFinite(value)) item.counts.messages = Math.max(0, Math.trunc(value));
      if (name === 'body-ready' && Number.isFinite(value)) item.bytes = Math.max(0, value);
      if (name === 'layout-thumbs-wait-end' && Number.isFinite(value)) item.counts.pendingThumbnailsAtLayoutWaitEnd = Math.max(0,value);
      if (name === 'cache-keys-ready' && Number.isFinite(value)) item.counts.entries = Math.max(0, Math.trunc(value));
      if (name === 'cache-repair-ready' && Number.isFinite(value)) item.counts.updatedEntries = Math.max(0, Math.trunc(value));
      if (name === 'response-ready' && Number.isInteger(value)) item.httpStatus = value;
    }
    function cache(token, state) { const item = get(token); if (item && cacheStates.has(state)) item.cache = state; }
    function finish(token, status = 'ok') {
      const item = get(token);
      if (!item || item.status !== 'pending') return;
      item.status = ['ok', 'cancelled', 'error'].includes(status) ? status : 'error';
      item.durationMs = round(performance.now() - item.startMs);
      cleanup(item.id);
    }
    function fail(token, stage, error, httpStatus) {
      const item = get(token);
      if (!item || item.status !== 'pending') return;
      const cancelled = error?.name === 'AbortError';
      item.error = {
        stage: ['queue', 'fetch', 'response', 'body', 'buffer', 'decrypt', 'element', 'history', 'key', 'join', 'render', 'cache-repair'].includes(stage) ? stage : 'unknown',
        category: cancelled ? 'abort' : Number.isInteger(httpStatus) ? 'http' : error?.name === 'RangeError' ? 'resource-limit' : stage === 'decrypt' ? 'crypto' : stage === 'element' ? 'decode-or-element' : stage === 'body' || stage === 'buffer' ? 'body-read' : error?.name === 'TypeError' ? 'network-or-type' : 'other'
      };
      if (Number.isInteger(httpStatus)) item.httpStatus = httpStatus;
      finish(token, cancelled ? 'cancelled' : 'error');
    }
    function roomToken(context) { return context && contexts.get(context); }
    function roomEvent(stage, context) {
      if (!context) return;
      let token = roomToken(context);
      if (stage === 'started' || stage === 'committed-direct') {
        token = begin('room');
        if (!token) return;
        contexts.set(context, token);
        get(token).entry = stage === 'started' ? 'ordinary' : 'direct-partial';
        context.signal?.addEventListener('abort', () => finish(token, 'cancelled'), {once:true});
      }
      if (stage === 'committed' || stage === 'committed-direct') step(token, 'committed');
      if (stage === 'ready') { step(token, 'ready'); finish(token); }
      if (stage === 'failed') fail(token, 'render');
      if (stage === 'cancelled' || stage === 'left' || stage.startsWith('stale-')) finish(token, 'cancelled');
    }
    function watchElement(token, element, signal) {
      const item = get(token);
      if (!item || item.status !== 'pending' || !element) return;
      let raf = 0;
      const readyEvent = element.tagName === 'VIDEO' ? (element.autoplay ? 'loadeddata' : 'loadedmetadata') : 'load';
      item.elementEvent = readyEvent;
      const cancelled = () => finish(token, 'cancelled');
      const error = () => fail(token, 'element');
      const ready = () => {
        if (!element.isConnected || signal?.aborted) { cancelled(); return; }
        step(token, 'element-ready');
        // A frame opportunity, not a claim that pixels were painted or that
        // native image decode time can be isolated from the load event.
        if (document.visibilityState !== 'visible') { finish(token); return; }
        raf = requestAnimationFrame(() => {
          if (!element.isConnected || signal?.aborted) { cancelled(); return; }
          step(token, 'paint-opportunity'); finish(token);
        });
      };
      cleanup(item.id);
      watches.set(item.id, {element, cleanup() {
        cancelAnimationFrame(raf);
        element.removeEventListener(readyEvent, ready);
        element.removeEventListener('error', error);
        signal?.removeEventListener('abort', cancelled);
      }});
      element.addEventListener(readyEvent, ready, {once:true});
      element.addEventListener('error', error, {once:true});
      signal?.addEventListener('abort', cancelled, {once:true});
      if (signal?.aborted) cancelled();
      else if (element.tagName === 'VIDEO' ? element.readyState >= (element.autoplay ? 2 : 1) : element.complete && element.naturalWidth > 0) ready();
    }
    window.addEventListener('fpchat:dom173', event => {
      if (event.detail?.phase !== 'unmounted' || !watches.size || sweepQueued) return;
      sweepQueued = true;
      queueMicrotask(() => {
        sweepQueued = false;
        for (const [id, watch] of watches) if (!watch.element.isConnected) finish({id}, 'cancelled');
      });
    }, {passive:true});
    function report() {
      const duration = (item, from, to) => item.points[from] === undefined || item.points[to] === undefined ? null : round(item.points[to] - item.points[from]);
      const boot = window.FPBoot152?.timings186?.() || null;
      const bootEnd = boot?.points['boot-ready'] ?? boot?.points['safety-release'] ?? performance.now();
      const startupResources = {};
      for (const resource of resources) {
        if (resource.at > bootEnd) continue;
        const group = startupResources[resource.type] || (startupResources[resource.type] = {count:0, transferBytes:0, encodedBodyBytes:0});
        group.count++; group.transferBytes += resource.transferSize; group.encodedBodyBytes += resource.encodedBodySize;
      }
      return {
        schema:1, build:'186.4', mode:'passive-owner-hooks', installedAtMs:round(startedAt), enabled, limit:LIMIT, dropped, activeElementWatches:watches.size,
        coverage:{boot:'explicit-gate-marks-since-inline-loader; assets are bounded observed DOM load/error times, not native network/execute durations; only allowlisted static filenames; pending frozen at release; end marks can be timeout, see completed', room:'hooks from runtime installation; ordinary-entry; direct-entry-starts-after-join', media:'common readEncryptedMedia174 path including voice/save reads; no independent I/O or voice/save playback readiness', cache:'CacheStorage open/meta/match/expired-delete; repair scans separate; HTTP cache not inferred', display:'image load, active video loadeddata, neighbor video loadedmetadata and frame opportunity; not native decode duration or actual paint', resources:'partial browser buffer; bounded runtime history; zero bytes do not prove a cache hit', privacy:'local trace numbers only; no text, room/media/device/message IDs, URLs, keys, error messages or request bodies'},
        boot, startupResources,
        viewport:{width:window.innerWidth,height:window.innerHeight,pixelRatio:window.devicePixelRatio},
        runtime:{visibility:document.visibilityState, online:navigator.onLine, longTasks:longTasks.length, longTaskMs:round(longTasks.reduce((sum, x) => sum + x.durationMs, 0))},
        records:[...records.values()].map(item => ({...item, startMs:round(item.startMs), points:{...item.points}, counts:{...item.counts}, ...(item.error ? {error:{...item.error}} : {}), stagesMs:{queue:duration(item,'queue-start','slot-ready'), cache:duration(item,'cache-start','cache-ready'), cacheOpen:duration(item,'cache-open-start','cache-open-ready'), cacheMeta:duration(item,'cache-meta-start','cache-meta-ready'), cacheMatch:duration(item,'cache-match-start','cache-match-ready'), cacheDelete:duration(item,'cache-delete-start','cache-delete-ready'), cacheKeys:duration(item,'cache-keys-start','cache-keys-ready'), cacheRepair:duration(item,'cache-repair-start','cache-repair-ready'), maintenanceWait:duration(item,'maintenance-wait-start','maintenance-wait-end'), cacheKeysWait:duration(item,'cache-keys-wait-start','cache-keys-wait-end'), responseAfterAdmission:duration(item,'slot-ready','response-ready'), body:duration(item,'body-start','body-ready'), buffer:duration(item,'buffer-start','buffer-ready'), decrypt:duration(item,'decrypt-start','decrypt-ready'), element:duration(item,'url-ready','element-ready'), key:duration(item,'key-start','key-ready'), join:duration(item,'join-start','join-ready'), history:duration(item,'history-start','history-ready'), render:duration(item,'render-start','text-ready'), draft:duration(item,'draft-start','draft-ready'), scroll:duration(item,'scroll-start','scroll-ready')}}))
      };
    }
    function reset() { for (const id of watches.keys()) cleanup(id); records.clear(); dropped = 0; }
    function download() {
      const url = URL.createObjectURL(new Blob([JSON.stringify(report(), null, 2)], {type:'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = 'FPChat-186.4-loading.json';
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    return Object.freeze({begin, step, cache, finish, fail, roomToken, roomEvent, watchElement, report, reset, download,
      setEnabled(value) { enabled = Boolean(value); if (!enabled) reset(); }});
  })();

  window.FPRuntime169 = Object.freeze({
    loading: loading186,
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
