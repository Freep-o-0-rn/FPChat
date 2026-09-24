/* Build 167: cache media responses before their bodies are consumed.
   Loaded after storage167 + clear guard so normal media mechanics stay unchanged. */
(() => {
  if (window.__fpStorage167CacheFixInstalled) return;
  window.__fpStorage167CacheFixInstalled = true;

  const CACHE_NAME = 'fpchat-media-v167';
  const META_KEY = 'fpchat:storage:cache-meta167';
  const MEDIA_PATH_RE = /^\/api\/media\/([^/]+)\/(blob|thumb)$/;
  const mediaIndex = new Map();
  // Build 186.2: one trailing batch for history rendering, one repair in flight.
  let repairTimer = 0;
  let repairTask = null;
  let repairRequested = false;

  function normalizeKind(value) {
    const kind = String(value || '').toLowerCase();
    return ['image', 'video', 'audio', 'file'].includes(kind) ? kind : 'file';
  }

  function readMeta() {
    try {
      const parsed = JSON.parse(localStorage.getItem(META_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeMeta(meta) {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {}
  }

  function rememberMediaList(list) {
    if (!Array.isArray(list)) return;
    let changed = false;
    for (const item of list) {
      const publicId = String(item?.public_id || '').trim();
      if (!publicId) continue;
      const previous = mediaIndex.get(publicId);
      const next = {
        kind: normalizeKind(item?.media_kind),
        bytes: Math.max(0, Number(item?.encrypted_size_bytes || item?.size_bytes || previous?.bytes || 0) || 0),
        thumbBytes: Math.max(0, Number(item?.thumb_encrypted_size_bytes || item?.thumb_size_bytes || previous?.thumbBytes || 0) || 0)
      };
      if (previous && previous.kind === next.kind && previous.bytes === next.bytes && previous.thumbBytes === next.thumbBytes) continue;
      mediaIndex.set(publicId, next);
      changed = true;
    }
    if (changed) scheduleRepair();
  }

  function scheduleRepair() {
    repairRequested = true;
    if (repairTask) return;
    clearTimeout(repairTimer);
    repairTimer = setTimeout(() => { repairTimer = 0; void repairExistingEntries(); }, 100);
  }

  function requestInfo(input, init) {
    try {
      const raw = typeof input === 'string' ? input : String(input?.url || '');
      const url = new URL(raw, window.location.href);
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      if (method !== 'GET' || url.origin !== window.location.origin) return null;
      const match = url.pathname.match(MEDIA_PATH_RE);
      if (!match) return null;
      return {
        url: url.href,
        publicId: decodeURIComponent(match[1]),
        endpoint: match[2],
        request: new Request(url.href, { method: 'GET', credentials: 'same-origin' })
      };
    } catch {
      return null;
    }
  }

  function clearing() {
    try { return window.FPStorage167ClearGuard?.isClearing?.() === true; }
    catch { return false; }
  }

  async function persistCopy(info, copy, headerBytes) {
    if (!info || !copy?.ok || typeof caches === 'undefined' || clearing()) return;
    try {
      const cache = await caches.open(CACHE_NAME);
      if (clearing()) return;
      await cache.put(info.request, copy);
      if (clearing()) return;

      const indexed = mediaIndex.get(info.publicId) || {};
      const fallbackBytes = info.endpoint === 'thumb' ? indexed.thumbBytes : indexed.bytes;
      const meta = readMeta();
      meta[info.url] = {
        publicId: info.publicId,
        endpoint: info.endpoint,
        kind: normalizeKind(indexed.kind),
        bytes: Math.max(0, Number(headerBytes || 0) || Number(fallbackBytes || 0) || 0),
        cachedAt: Date.now()
      };
      writeMeta(meta);
      window.dispatchEvent(new CustomEvent('fpchat:storage-changed'));
    } catch {}
  }

  function repairExistingEntries() {
    clearTimeout(repairTimer);
    repairTimer = 0;
    repairRequested = true;
    if (repairTask) return repairTask;
    repairTask = (async () => {
      while (repairRequested && !clearing()) {
        repairRequested = false;
        await repairPass();
      }
    })().finally(() => { repairTask = null; });
    return repairTask;
  }

  async function repairPass() {
    if (typeof caches === 'undefined' || clearing()) return;
    const diagnostic = window.FPRuntime169?.loading;
    const trace = diagnostic?.begin('cache-repair');
    try {
      diagnostic?.step(trace, 'cache-open-start');
      const cache = await caches.open(CACHE_NAME);
      diagnostic?.step(trace, 'cache-open-ready');
      if (clearing()) { diagnostic?.finish(trace, 'cancelled'); return; }
      diagnostic?.step(trace, 'cache-keys-start');
      const requests = await cache.keys();
      diagnostic?.step(trace, 'cache-keys-ready', requests.length);
      if (clearing()) { diagnostic?.finish(trace, 'cancelled'); return; }
      diagnostic?.step(trace, 'cache-meta-start');
      const meta = readMeta();
      diagnostic?.step(trace, 'cache-meta-ready');
      diagnostic?.step(trace, 'cache-repair-start');
      let changed = 0;

      for (const request of requests) {
        const info = requestInfo(request);
        if (!info) continue;
        const indexed = mediaIndex.get(info.publicId);
        if (!indexed) continue;
        const current = meta[info.url] || {};
        const bytes = info.endpoint === 'thumb' ? indexed.thumbBytes : indexed.bytes;
        const nextKind = normalizeKind(indexed.kind);
        const nextBytes = Math.max(0, Number(current.bytes || 0) || Number(bytes || 0) || 0);
        if (current.publicId !== info.publicId || current.endpoint !== info.endpoint || current.kind !== nextKind || Number(current.bytes || 0) !== nextBytes) {
          meta[info.url] = {
            publicId: info.publicId,
            endpoint: info.endpoint,
            kind: nextKind,
            bytes: nextBytes,
            cachedAt: Math.max(0, Number(current.cachedAt || 0) || Date.now())
          };
          changed++;
        }
      }

      if (changed && !clearing()) {
        writeMeta(meta);
        window.dispatchEvent(new CustomEvent('fpchat:storage-changed'));
      }
      diagnostic?.step(trace, 'cache-repair-ready', changed);
      diagnostic?.finish(trace);
    } catch (error) { diagnostic?.fail(trace, 'cache-repair', error); }
  }

  const baseFetch = window.fetch.bind(window);
  window.fetch = async function fpStorage167CacheFixFetch(input, init) {
    const info = requestInfo(input, init);
    const response = await baseFetch(input, init);
    if (!info || !response?.ok || clearing()) return response;

    // Clone synchronously before the caller can consume response.body.
    try {
      const copy = response.clone();
      const headerBytes = Math.max(0, Number(response.headers.get('content-length') || 0) || 0);
      void persistCopy(info, copy, headerBytes);
    } catch {}
    return response;
  };
  window.fetch.__fpStorage167CacheFix = true;

  function installAppendWrapper() {
    if (typeof appendMessage !== 'function' || appendMessage.__fpStorage167CacheFix) return false;
    const base = appendMessage;
    const wrapped = function fpStorage167CacheFixAppend(box, message, text, mine, autoScroll = true) {
      if (Array.isArray(message?.media)) rememberMediaList(message.media);
      return base.call(this, box, message, text, mine, autoScroll);
    };
    wrapped.__fpStorage167CacheFix = true;
    appendMessage = wrapped;
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (installAppendWrapper() || attempts >= 100) clearInterval(timer);
  }, 50);
  installAppendWrapper();

  window.FPStorage167CacheFix = Object.freeze({
    rememberMediaList,
    repair: repairExistingEntries
  });
})();
