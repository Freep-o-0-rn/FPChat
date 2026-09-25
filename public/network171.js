/* Build 171: centralized fetch/XHR ownership, media download budget and Cache Storage mutation gate.
   FPChat keeps one public network owner while legacy feature layers are adapted
   into explicit stages in a deterministic order. Existing API/upload semantics
   remain unchanged. */
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

  const XHR_LEGACY_SPECS = Object.freeze({
    'typing.js': { id: 'typing-activity121', priority: 800 }
  });

  const stats = {
    startedAt: Date.now(),
    requests: 0,
    nativeCalls: 0,
    failures: 0,
    registrations: 0,
    rejectedAssignments: 0,
    perLayer: new Map(),
    xhr: {
      opens: 0,
      sends: 0,
      uploads: 0,
      failures: 0,
      registrations: 0,
      rejectedAssignments: 0
    },
    mediaBudget: {
      limit: 4,
      active: 0,
      queued: 0,
      peakActive: 0,
      completed: 0,
      cancelled: 0
    },
    mediaCache: {
      writes: 0,
      joinedWrites: 0,
      skippedExisting: 0,
      deletes: 0,
      failures: 0,
      inFlight: 0
    }
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

  function xhrSpecForCurrentScript() {
    const name = scriptName();
    return name ? XHR_LEGACY_SPECS[name] || null : null;
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
      window.FPRuntime169?.loading?.step(init?.fpTrace186, 'network-start');
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

  function noteRejectedAssignment(value, surface = 'fetch') {
    if (surface === 'fetch') stats.rejectedAssignments += 1;
    else stats.xhr.rejectedAssignments += 1;
    const item = {
      at: Date.now(),
      surface,
      source: scriptName() || 'unknown',
      functionName: typeof value === 'function' ? String(value.name || 'anonymous') : typeof value
    };
    rejectedAssignments.push(item);
    if (rejectedAssignments.length > MAX_REJECTED) rejectedAssignments.splice(0, rejectedAssignments.length - MAX_REJECTED);
    console.warn(`[FPChat] Build 171 blocked an unowned ${surface} replacement:`, item.source, item.functionName);
  }

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
      noteRejectedAssignment(value, 'window.fetch');
    }
  });

  // ---- XMLHttpRequest ownership -------------------------------------------------
  const xhrProto = typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest.prototype : null;
  const nativeXhrOpen = xhrProto?.open;
  const nativeXhrSend = xhrProto?.send;
  const xhrOpenLayers = new Map();
  const xhrSendLayers = new Map();
  const xhrOpenContinuations = new Map();
  const xhrSendContinuations = new Map();
  let xhrOwnershipInstalled = false;

  function orderedXhrLayersAfter(collection, priority) {
    return [...collection.values()]
      .filter((layer) => layer.priority > priority)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  function dispatchXhrOpenAfter(priority, xhr, args) {
    const nextLayer = orderedXhrLayersAfter(xhrOpenLayers, priority)[0];
    if (!nextLayer) {
      stats.xhr.opens += 1;
      return nativeXhrOpen.apply(xhr, args);
    }
    return nextLayer.wrapper.apply(xhr, args);
  }

  function dispatchXhrSendAfter(priority, xhr, args) {
    const nextLayer = orderedXhrLayersAfter(xhrSendLayers, priority)[0];
    if (!nextLayer) {
      stats.xhr.sends += 1;
      return nativeXhrSend.apply(xhr, args);
    }
    return nextLayer.wrapper.apply(xhr, args);
  }

  function xhrOpenContinuation(spec) {
    if (xhrOpenContinuations.has(spec.id)) return xhrOpenContinuations.get(spec.id);
    const continuation = function fpNetwork171XhrOpenContinuation(...args) {
      return dispatchXhrOpenAfter(spec.priority, this, args);
    };
    xhrOpenContinuations.set(spec.id, continuation);
    return continuation;
  }

  function xhrSendContinuation(spec) {
    if (xhrSendContinuations.has(spec.id)) return xhrSendContinuations.get(spec.id);
    const continuation = function fpNetwork171XhrSendContinuation(...args) {
      return dispatchXhrSendAfter(spec.priority, this, args);
    };
    xhrSendContinuations.set(spec.id, continuation);
    return continuation;
  }

  function coordinatorXhrOpen(...args) {
    return dispatchXhrOpenAfter(Number.NEGATIVE_INFINITY, this, args);
  }

  function coordinatorXhrSend(...args) {
    return dispatchXhrSendAfter(Number.NEGATIVE_INFINITY, this, args);
  }

  function registerXhrLegacy(kind, spec, wrapper) {
    const target = kind === 'open' ? xhrOpenLayers : xhrSendLayers;
    const current = target.get(spec.id);
    target.set(spec.id, {
      id: spec.id,
      priority: spec.priority,
      source: scriptName(),
      wrapper
    });
    if (!current || current.wrapper !== wrapper) stats.xhr.registrations += 1;
  }

  if (xhrProto && typeof nativeXhrOpen === 'function' && typeof nativeXhrSend === 'function') {
    try {
      Object.defineProperty(xhrProto, 'open', {
        configurable: false,
        enumerable: false,
        get() {
          const spec = xhrSpecForCurrentScript();
          return spec ? xhrOpenContinuation(spec) : coordinatorXhrOpen;
        },
        set(value) {
          if (value === coordinatorXhrOpen) return;
          const spec = xhrSpecForCurrentScript();
          if (spec && typeof value === 'function') {
            registerXhrLegacy('open', spec, value);
            return;
          }
          noteRejectedAssignment(value, 'XMLHttpRequest.prototype.open');
        }
      });
      Object.defineProperty(xhrProto, 'send', {
        configurable: false,
        enumerable: false,
        get() {
          const spec = xhrSpecForCurrentScript();
          return spec ? xhrSendContinuation(spec) : coordinatorXhrSend;
        },
        set(value) {
          if (value === coordinatorXhrSend) return;
          const spec = xhrSpecForCurrentScript();
          if (spec && typeof value === 'function') {
            registerXhrLegacy('send', spec, value);
            return;
          }
          noteRejectedAssignment(value, 'XMLHttpRequest.prototype.send');
        }
      });
      xhrOwnershipInstalled = true;
    } catch (error) {
      console.warn('[FPChat] Build 171 could not claim XMLHttpRequest ownership.', error);
    }
  }

  // Common XHR upload API. Existing app.js direct XHR calls still work through
  // the same coordinator; new code can use this method without patching XHR.
  function upload({
    url,
    method = 'POST',
    body = null,
    headers = null,
    signal = null,
    timeoutMs = 0,
    responseType = '',
    onProgress = null
  } = {}) {
    if (typeof XMLHttpRequest === 'undefined') return Promise.reject(new Error('XMLHttpRequest unavailable'));
    const safeUrl = String(url || '');
    if (!safeUrl) return Promise.reject(new TypeError('FPNetwork171.upload requires url'));
    if (signal?.aborted) return Promise.reject(new DOMException('Upload aborted', 'AbortError'));
    stats.xhr.uploads += 1;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      let detachAbort = null;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        detachAbort?.();
        fn(value);
      };
      try {
        xhr.open(String(method || 'POST').toUpperCase(), safeUrl, true);
        if (Number(timeoutMs) > 0) xhr.timeout = Number(timeoutMs);
        if (responseType) xhr.responseType = responseType;
        if (headers && typeof headers === 'object') {
          for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, String(value));
        }
        if (xhr.upload && typeof onProgress === 'function') {
          xhr.upload.addEventListener('progress', (event) => {
            try { onProgress(event.loaded, event.total, event.lengthComputable, event); } catch {}
          });
        }
        xhr.addEventListener('load', () => finish(resolve, xhr), { once: true });
        xhr.addEventListener('error', () => {
          stats.xhr.failures += 1;
          finish(reject, new Error('network error'));
        }, { once: true });
        xhr.addEventListener('timeout', () => {
          stats.xhr.failures += 1;
          const error = new Error('network timeout');
          error.name = 'TimeoutError';
          finish(reject, error);
        }, { once: true });
        xhr.addEventListener('abort', () => {
          const error = new DOMException('Upload aborted', 'AbortError');
          finish(reject, error);
        }, { once: true });
        if (signal) {
          const abort = () => {
            finish(reject, new DOMException('Upload aborted', 'AbortError'));
            try { xhr.abort(); } catch {}
          };
          if (signal.aborted) { abort(); return; }
          else {
            signal.addEventListener('abort', abort, { once: true });
            detachAbort = () => signal.removeEventListener('abort', abort);
          }
        }
        if (!settled) xhr.send(body);
      } catch (error) {
        stats.xhr.failures += 1;
        finish(reject, error);
      }
    });
  }

  // ---- bounded media-download concurrency --------------------------------------
  const MEDIA_DOWNLOAD_RE = /^\/api\/media\/[^/]+\/(?:blob|thumb)(?:\/)?$/;
  const mediaWaiters = [];

  function mediaRequestSignal(input, init) {
    return init?.signal || (typeof input === 'object' && input ? input.signal : null) || null;
  }

  function isMediaDownload(input, init) {
    try {
      const raw = typeof input === 'string' ? input : String(input?.url || '');
      const url = new URL(raw, location.href);
      const method = String(init?.method || (typeof input === 'object' ? input?.method : '') || 'GET').toUpperCase();
      return method === 'GET' && url.origin === location.origin && MEDIA_DOWNLOAD_RE.test(url.pathname);
    } catch {
      return false;
    }
  }

  let reservedMediaSlots=0;
  function drainMediaSlots(){
    while(mediaWaiters.length&&reservedMediaSlots+mediaWaiters[0].weight<=stats.mediaBudget.limit){
      const waiter=mediaWaiters.shift();
      waiter.signal?.removeEventListener('abort',waiter.onAbort);
      reservedMediaSlots+=waiter.weight;stats.mediaBudget.active++;
      stats.mediaBudget.peakActive=Math.max(stats.mediaBudget.peakActive,stats.mediaBudget.active);
      waiter.resolve();
    }
    stats.mediaBudget.queued=mediaWaiters.length;
  }
  function acquireMediaSlot(signal,weight){
    if(signal?.aborted)return Promise.reject(new DOMException('Media request aborted','AbortError'));
    return new Promise((resolve,reject)=>{
      const waiter={resolve,reject,signal,weight,onAbort:null};
      waiter.onAbort=()=>{
        const index=mediaWaiters.indexOf(waiter);if(index<0)return;
        mediaWaiters.splice(index,1);stats.mediaBudget.cancelled++;
        reject(new DOMException('Media request aborted','AbortError'));drainMediaSlots();
      };
      signal?.addEventListener('abort',waiter.onAbort,{once:true});
      mediaWaiters.push(waiter);drainMediaSlots();
    });
  }
  function releaseMediaSlot(weight){
    reservedMediaSlots=Math.max(0,reservedMediaSlots-weight);
    stats.mediaBudget.active=Math.max(0,stats.mediaBudget.active-1);drainMediaSlots();
  }

  // One original through download/decrypt, or four thumbnails. Do not copy a
  // complete encrypted video merely to retain its slot. Backpressure stays live.
  use({id:'media-download-budget171',priority:90,source:'network171',handler:async({input,init,next})=>{
    if(!isMediaDownload(input,init))return next(input,init);
    const signal=mediaRequestSignal(input,init);
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    const original=url.pathname.endsWith('/blob');
    const weight=original?stats.mediaBudget.limit:1;
    const byteLimit=original?100*1024*1024+64:4*1024*1024;
    const diagnostic = window.FPRuntime169?.loading, trace = init?.fpTrace186;
    diagnostic?.step(trace, 'queue-start');
    try { await acquireMediaSlot(signal,weight); }
    catch (error) { diagnostic?.fail(trace, 'queue', error); throw error; }
    diagnostic?.step(trace, 'slot-ready');
    let released=false,reader,streamController,read=0;
    const release=()=>{if(released)return;released=true;signal?.removeEventListener('abort',abort);releaseMediaSlot(weight);};
    const abort=()=>{try{streamController?.error(new DOMException('Media request aborted','AbortError'));}catch{};void reader?.cancel().catch(()=>{});if(!init?.fpMediaLease174)release();};
    if(init?.fpMediaLease174)init.fpMediaLease174.release=release;
    signal?.addEventListener('abort',abort,{once:true});
    try{
      if(signal?.aborted)throw new DOMException('Media request aborted','AbortError');
      const response=await next(input,init);
      diagnostic?.step(trace, 'response-ready', response.status);
      if(signal?.aborted)throw new DOMException('Media request aborted','AbortError');
      if(Number(response.headers.get('content-length'))>byteLimit){void response.body?.cancel().catch(()=>{});throw new RangeError('Media body exceeds resource limit');}
      if(!response.body){stats.mediaBudget.completed++;release();return response;}
      reader=response.body.getReader();
      const body=new ReadableStream({
        start(controller){streamController=controller;},
        async pull(controller){
          try{
            const chunk=await reader.read();
            if(chunk.done){controller.close();stats.mediaBudget.completed++;if(!init?.fpMediaLease174)release();return;}
            read+=chunk.value.byteLength;
            if(read>byteLimit){void reader.cancel().catch(()=>{});throw new RangeError('Media body exceeds resource limit');}
            controller.enqueue(chunk.value);
          }catch(error){controller.error(error);release();}
        },
        cancel(reason){release();return reader.cancel(reason);}
      },{highWaterMark:0});
      const streamed=new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
      Object.defineProperty(streamed,'url',{value:response.url});
      return streamed;
    }catch(error){release();throw error;}
  }});
  async function consumeMedia(input,init,consume){
    const lease={release:null};let response;
    try{
      response=await coordinatorFetch(input,{...init,fpMediaLease174:lease});
      return await consume(response);
    }finally{
      if(response?.body&&!response.bodyUsed)void response.body.cancel().catch(()=>{});
      lease.release?.();
    }
  }

  // ---- one physical mutation gate for the managed encrypted-media cache --------
  const MEDIA_CACHE_NAME = 'fpchat-media-v167';
  const cacheNameByInstance = new WeakMap();
  const mediaCacheWrites = new Map();
  const cacheStorage = typeof window.caches !== 'undefined' ? window.caches : null;
  const nativeCacheOpen = cacheStorage?.open ? cacheStorage.open.bind(cacheStorage) : null;
  const cacheProto = typeof Cache !== 'undefined' ? Cache.prototype : null;
  const nativeCachePut = cacheProto?.put;
  const nativeCacheDelete = cacheProto?.delete;

  function cacheRequestKey(request) {
    try { return typeof request === 'string' ? new URL(request, location.href).href : String(request?.url || ''); }
    catch { return String(request?.url || request || ''); }
  }

  function clearingMediaCache() {
    try { return window.FPStorage167ClearGuard?.isClearing?.() === true; }
    catch { return false; }
  }

  if (nativeCacheOpen && cacheProto && typeof nativeCachePut === 'function' && typeof nativeCacheDelete === 'function') {
    try {
      cacheStorage.open = async function fpMediaCache171Open(name) {
        const cache = await nativeCacheOpen(name);
        try { cacheNameByInstance.set(cache, String(name || '')); } catch {}
        return cache;
      };

      cacheProto.put = function fpMediaCache171Put(request, response) {
        if (cacheNameByInstance.get(this) !== MEDIA_CACHE_NAME) return nativeCachePut.call(this, request, response);
        const discard=()=>{if(response?.body&&!response.bodyUsed)void response.body.cancel().catch(()=>{});};
        if (clearingMediaCache()){discard();return Promise.resolve(undefined);}
        const cache = this;
        const key = cacheRequestKey(request);
        if (key && mediaCacheWrites.has(key)) {
          stats.mediaCache.joinedWrites += 1;
          discard();
          return mediaCacheWrites.get(key).then(() => undefined);
        }

        const task = (async () => {
          try {
            if (clearingMediaCache()){discard();return;}
            const existing = await cache.match(request);
            if (existing) {
              stats.mediaCache.skippedExisting += 1;
              discard();
              return;
            }
            if (clearingMediaCache()){discard();return;}
            await nativeCachePut.call(cache, request, response);
            stats.mediaCache.writes += 1;
          } catch (error) {
            stats.mediaCache.failures += 1;
            throw error;
          }
        })();

        if (key) mediaCacheWrites.set(key, task);
        stats.mediaCache.inFlight = mediaCacheWrites.size;
        task.finally(() => {
          if (key && mediaCacheWrites.get(key) === task) mediaCacheWrites.delete(key);
          stats.mediaCache.inFlight = mediaCacheWrites.size;
        }).catch(() => {});
        return task;
      };

      cacheProto.delete = async function fpMediaCache171Delete(request, options) {
        if (cacheNameByInstance.get(this) !== MEDIA_CACHE_NAME) return nativeCacheDelete.call(this, request, options);
        const key = cacheRequestKey(request);
        const write = key ? mediaCacheWrites.get(key) : null;
        if (write) {
          try { await write; } catch {}
        }
        try {
          const result = await nativeCacheDelete.call(this, request, options);
          if (result) stats.mediaCache.deletes += 1;
          return result;
        } catch (error) {
          stats.mediaCache.failures += 1;
          throw error;
        }
      };
    } catch (error) {
      console.warn('[FPChat] Build 171 could not install media cache mutation gate.', error);
    }
  }

  async function waitForMediaCacheIdle() {
    while (mediaCacheWrites.size) {
      const pending = [...new Set(mediaCacheWrites.values())];
      if (!pending.length) break;
      await Promise.allSettled(pending);
    }
  }

  // Build 186.4: maintenance observes the existing read/queue/write owner.
  // This does not reserve slots or delay user media behind background work.
  function hasPendingMedia() {
    return stats.mediaBudget.active > 0 || mediaWaiters.length > 0 || mediaCacheWrites.size > 0;
  }

  function snapshot() {
    return {
      owner: 'FPNetwork171',
      startedAt: stats.startedAt,
      requests: stats.requests,
      nativeCalls: stats.nativeCalls,
      failures: stats.failures,
      registrations: stats.registrations,
      rejectedAssignmentCount: stats.rejectedAssignments,
      xhr: {
        ...stats.xhr,
        ownershipInstalled: xhrOwnershipInstalled,
        openLayers: [...xhrOpenLayers.values()].map((layer) => ({ id: layer.id, priority: layer.priority, source: layer.source })),
        sendLayers: [...xhrSendLayers.values()].map((layer) => ({ id: layer.id, priority: layer.priority, source: layer.source }))
      },
      mediaBudget: { ...stats.mediaBudget, reservedSlots:reservedMediaSlots, originalLimit:1, thumbnailLimit:4, wholeBodyCopies:0 },
      mediaCache: { ...stats.mediaCache, format: MEDIA_CACHE_NAME },
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
        role: 'fetch-xhr-cache-owner',
        mode: 'active-owner',
        publicOwner: 'window.fetch + XMLHttpRequest + fpchat-media-v167 mutations'
      });
    } catch {}
  }

  window.FPNetwork171 = Object.freeze({
    fetch: coordinatorFetch,
    nativeFetch,
    upload,
    consumeMedia,
    use,
    snapshot,
    waitForMediaCacheIdle,
    hasPendingMedia,
    hasLayer,
    expectedLayers: Object.freeze(Object.values(LEGACY_SPECS).map((item) => ({ ...item }))),
    mediaCacheName: MEDIA_CACHE_NAME
  });

  registerRuntimeOwner();
  window.addEventListener('fpchat:boot-ready', registerRuntimeOwner, { once: true, passive: true });

  try {
    window.dispatchEvent(new CustomEvent('fpchat:network171-ready', { detail: snapshot() }));
  } catch {}
})();
