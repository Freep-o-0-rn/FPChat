/* Build 168: real local-media accounting, including media cached before Build 167.
   Old media is discovered from server metadata, but is NEVER downloaded just to count it.
   We only migrate bytes that the browser already has in its own HTTP cache. */
(() => {
  if (window.__fpStorage168Installed) return;
  window.__fpStorage168Installed = true;

  const CACHE_NAME = 'fpchat-media-v167';
  const META_KEY = 'fpchat:storage:cache-meta167';
  const LEGACY_SCAN_KEY = 'fpchat:storage:legacy-http-scan168';
  const PROBE_CONCURRENCY = 6;

  let inventoryPromise = null;
  let scanPromise = null;
  let scanState = { phase: 'idle', done: 0, total: 0, found: 0, inventoryBytes: 0, error: '' };

  function deviceId() {
    try {
      if (typeof getOrCreateDeviceId === 'function') return String(getOrCreateDeviceId() || '').trim();
    } catch {}
    return String(localStorage.getItem('fpchat:device-id') || '').trim();
  }

  function normalizeKind(value) {
    const kind = String(value || '').toLowerCase();
    return ['image', 'video', 'audio', 'file'].includes(kind) ? kind : 'file';
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value || 0) || 0);
    if (bytes < 1024) return `${Math.round(bytes)} Б`;
    const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
    let amount = bytes / 1024;
    let index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
    const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
    return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: digits })} ${units[index]}`;
  }

  function readMeta() {
    try {
      const value = JSON.parse(localStorage.getItem(META_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function writeMeta(value) {
    try { localStorage.setItem(META_KEY, JSON.stringify(value)); } catch {}
  }

  function savedScan() {
    try {
      const value = JSON.parse(localStorage.getItem(LEGACY_SCAN_KEY) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function isClearing() {
    try { return window.FPStorage167ClearGuard?.isClearing?.() === true; }
    catch { return false; }
  }

  async function loadInventory() {
    if (inventoryPromise) return inventoryPromise;
    inventoryPromise = (async () => {
      const dev = deviceId();
      if (!dev) throw new Error('device unavailable');
      const items = [];
      let cursor = 0;
      for (let page = 0; page < 200; page += 1) {
        const params = new URLSearchParams({ deviceId: dev, cursor: String(cursor), limit: '500' });
        const response = await fetch(`/api/storage/media-inventory?${params.toString()}`, { cache: 'no-store' });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok || !Array.isArray(data.items)) throw new Error('inventory unavailable');
        items.push(...data.items);
        if (!data.hasMore || !data.items.length) break;
        const next = Number(data.nextCursor || 0);
        if (!Number.isSafeInteger(next) || next <= cursor) break;
        cursor = next;
      }

      try { window.FPStorage167?.rememberMediaList?.(items); } catch {}
      try { window.FPStorage167CacheFix?.rememberMediaList?.(items); } catch {}
      return items;
    })();
    try { return await inventoryPromise; }
    catch (error) { inventoryPromise = null; throw error; }
  }

  function endpointRecords(items) {
    const dev = deviceId();
    const records = [];
    for (const item of items) {
      const publicId = String(item?.public_id || '').trim();
      if (!publicId) continue;
      const kind = normalizeKind(item?.media_kind);
      records.push({
        url: new URL(`/api/media/${encodeURIComponent(publicId)}/blob?deviceId=${encodeURIComponent(dev)}`, location.href).href,
        publicId,
        endpoint: 'blob',
        kind,
        bytes: Math.max(0, Number(item?.encrypted_size_bytes || item?.size_bytes || 0) || 0)
      });
      if (item?.has_thumbnail) {
        records.push({
          url: new URL(`/api/media/${encodeURIComponent(publicId)}/thumb?deviceId=${encodeURIComponent(dev)}`, location.href).href,
          publicId,
          endpoint: 'thumb',
          kind,
          bytes: Math.max(0, Number(item?.thumb_encrypted_size_bytes || item?.thumb_size_bytes || 0) || 0)
        });
      }
    }
    return records;
  }

  async function repairManagedMeta(items) {
    if (typeof caches === 'undefined') return;
    try {
      const byId = new Map(items.map((item) => [String(item?.public_id || ''), item]));
      const cache = await caches.open(CACHE_NAME);
      const requests = await cache.keys();
      const meta = readMeta();
      let changed = false;
      for (const request of requests) {
        let url;
        try { url = new URL(request.url); } catch { continue; }
        const match = url.pathname.match(/^\/api\/media\/([^/]+)\/(blob|thumb)$/);
        if (!match) continue;
        const publicId = decodeURIComponent(match[1]);
        const endpoint = match[2];
        const item = byId.get(publicId);
        if (!item) continue;
        const current = meta[url.href] || {};
        const wantedBytes = endpoint === 'thumb'
          ? Math.max(0, Number(item.thumb_encrypted_size_bytes || item.thumb_size_bytes || 0) || 0)
          : Math.max(0, Number(item.encrypted_size_bytes || item.size_bytes || 0) || 0);
        const next = {
          publicId,
          endpoint,
          kind: normalizeKind(item.media_kind),
          bytes: Math.max(0, Number(current.bytes || 0) || wantedBytes),
          cachedAt: Math.max(0, Number(current.cachedAt || 0) || Date.now())
        };
        if (current.publicId !== next.publicId || current.endpoint !== next.endpoint || current.kind !== next.kind || Number(current.bytes || 0) !== next.bytes || !current.cachedAt) {
          meta[url.href] = next;
          changed = true;
        }
      }
      if (changed) {
        writeMeta(meta);
        window.dispatchEvent(new CustomEvent('fpchat:storage-changed'));
      }
    } catch {}
  }

  async function probeOne(record, cache, hits) {
    if (isClearing()) return;
    try {
      const response = await fetch(record.url, {
        method: 'GET',
        mode: 'same-origin',
        credentials: 'same-origin',
        cache: 'only-if-cached'
      });
      if (!response?.ok || isClearing()) return;

      const copy = response.clone();
      const request = new Request(record.url, { method: 'GET', credentials: 'same-origin' });
      await cache.put(request, copy);
      if (isClearing()) return;
      const headerBytes = Math.max(0, Number(response.headers.get('content-length') || 0) || 0);
      hits.push({ ...record, bytes: headerBytes || record.bytes });
      try { await response.body?.cancel?.(); } catch {}
    } catch {}
  }

  async function migrateLegacyHttpCache(items) {
    const dev = deviceId();
    const previous = savedScan();
    if (previous?.deviceId === dev && previous?.complete === true) return previous;
    if (typeof caches === 'undefined') return null;

    const records = endpointRecords(items);
    const cache = await caches.open(CACHE_NAME);
    const hits = [];
    scanState = {
      phase: 'scanning',
      done: 0,
      total: records.length,
      found: 0,
      inventoryBytes: items.reduce((sum, item) => sum + Math.max(0, Number(item?.encrypted_size_bytes || item?.size_bytes || 0) || 0) + Math.max(0, Number(item?.thumb_encrypted_size_bytes || item?.thumb_size_bytes || 0) || 0), 0),
      error: ''
    };
    renderStatus();

    let index = 0;
    async function worker() {
      while (index < records.length) {
        const current = index++;
        if (isClearing()) return;
        await probeOne(records[current], cache, hits);
        scanState.done += 1;
        scanState.found = hits.length;
        if (scanState.done % 10 === 0 || scanState.done === scanState.total) renderStatus();
      }
    }

    await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, Math.max(1, records.length)) }, worker));
    if (isClearing()) return null;

    const meta = readMeta();
    for (const hit of hits) {
      const current = meta[hit.url] || {};
      meta[hit.url] = {
        publicId: hit.publicId,
        endpoint: hit.endpoint,
        kind: hit.kind,
        bytes: Math.max(0, Number(hit.bytes || 0) || Number(current.bytes || 0) || 0),
        cachedAt: Math.max(0, Number(current.cachedAt || 0) || Date.now())
      };
    }
    writeMeta(meta);
    await repairManagedMeta(items);

    const result = { deviceId: dev, complete: true, completedAt: Date.now(), checked: records.length, found: hits.length };
    try { localStorage.setItem(LEGACY_SCAN_KEY, JSON.stringify(result)); } catch {}
    scanState.phase = 'done';
    scanState.found = hits.length;
    window.dispatchEvent(new CustomEvent('fpchat:storage-changed'));
    renderStatus();
    return result;
  }

  async function ensureAccounting() {
    if (scanPromise) return scanPromise;
    scanPromise = (async () => {
      try {
        scanState.phase = 'inventory';
        scanState.error = '';
        renderStatus();
        const items = await loadInventory();
        scanState.inventoryBytes = items.reduce((sum, item) => sum + Math.max(0, Number(item?.encrypted_size_bytes || item?.size_bytes || 0) || 0) + Math.max(0, Number(item?.thumb_encrypted_size_bytes || item?.thumb_size_bytes || 0) || 0), 0);
        await repairManagedMeta(items);
        const previous = savedScan();
        if (previous?.deviceId === deviceId() && previous?.complete === true) {
          scanState.phase = 'done';
          scanState.done = Number(previous.checked || 0);
          scanState.total = Number(previous.checked || 0);
          scanState.found = Number(previous.found || 0);
          renderStatus();
          return;
        }
        await migrateLegacyHttpCache(items);
      } catch {
        scanState.phase = 'error';
        scanState.error = 'Не удалось проверить старый локальный кэш.';
        renderStatus();
      }
    })();
    try { return await scanPromise; }
    finally { scanPromise = null; }
  }

  function statusText() {
    if (scanState.phase === 'inventory') return 'Проверяем старые медиа и локальный кэш…';
    if (scanState.phase === 'scanning') {
      return `Проверяем ранее загруженные медиа: ${scanState.done} из ${scanState.total}…`;
    }
    if (scanState.phase === 'error') return scanState.error;
    if (scanState.phase === 'done') return 'Размер кэша рассчитан с учётом ранее загруженных медиа, которые ещё сохранены браузером.';
    return '';
  }

  function renderStatus() {
    const root = document.querySelector('.fp-settings131[data-page="storage167"]');
    if (!root) return;
    const origin = root.querySelector('#fpStorage167Origin');
    if (!origin) return;
    let node = root.querySelector('#fpStorage168Accounting');
    if (!node) {
      node = document.createElement('div');
      node.id = 'fpStorage168Accounting';
      node.className = 'fp-storage168-accounting';
      origin.insertAdjacentElement('afterend', node);
    }
    node.textContent = statusText();
    node.hidden = !node.textContent;
  }

  const style = document.createElement('style');
  style.id = 'fp-storage168-style';
  style.textContent = `.fp-storage168-accounting{margin-top:5px;color:var(--muted);font-size:11px;line-height:1.35}.fp-storage168-accounting:empty{display:none}`;
  document.head.appendChild(style);

  const observer = new MutationObserver(() => {
    const root = document.querySelector('.fp-settings131[data-page="storage167"]');
    if (!root) return;
    renderStatus();
    void ensureAccounting();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('fpchat:storage-changed', renderStatus);

  window.FPStorage168 = Object.freeze({
    loadInventory,
    ensureAccounting,
    state: () => ({ ...scanState })
  });
})();
