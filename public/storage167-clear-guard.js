/* Build 167: hard media-I/O guard for safe cache clearing.
   Stops client media downloads and cache writes before cleanup, keeps the
   cleaning screen exclusive, and never cancels outgoing uploads. */
(() => {
  if (window.__fpStorage167ClearGuardInstalled) return;
  window.__fpStorage167ClearGuardInstalled = true;

  const MEDIA_PATH_RE = /\/api\/media\/[^/]+\/(?:blob|thumb)(?:\?|$)/;
  const activeMediaControllers = new Set();
  const activeMediaPromises = new Set();
  const activeCacheWrites = new Set();
  let clearingActive = false;
  let startIntercepting = false;
  let lastBlockedFetchAt = 0;
  let safetyTimer = 0;
  let preparingOverlay = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function mediaRequestInfo(input, init) {
    try {
      const raw = typeof input === 'string' ? input : String(input?.url || '');
      const url = new URL(raw, window.location.href);
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      return method === 'GET' && url.origin === window.location.origin && MEDIA_PATH_RE.test(`${url.pathname}${url.search}`)
        ? { url, signal: init?.signal || input?.signal || null }
        : null;
    } catch {
      return null;
    }
  }

  function abortError() {
    try { return new DOMException('Media loading paused for cache cleanup', 'AbortError'); }
    catch {
      const error = new Error('Media loading paused for cache cleanup');
      error.name = 'AbortError';
      return error;
    }
  }

  const baseFetch = window.fetch.bind(window);
  window.fetch = async function fpStorage167ClearGuardFetch(input, init) {
    const info = mediaRequestInfo(input, init);
    if (!info) return baseFetch(input, init);

    if (clearingActive) {
      lastBlockedFetchAt = Date.now();
      throw abortError();
    }

    const controller = new AbortController();
    const sourceSignal = info.signal;
    let detachSourceAbort = null;
    if (sourceSignal) {
      if (sourceSignal.aborted) controller.abort(sourceSignal.reason);
      else {
        const forwardAbort = () => controller.abort(sourceSignal.reason);
        sourceSignal.addEventListener('abort', forwardAbort, { once: true });
        detachSourceAbort = () => sourceSignal.removeEventListener('abort', forwardAbort);
      }
    }

    const nextInit = { ...(init || {}), signal: controller.signal };
    activeMediaControllers.add(controller);
    const task = Promise.resolve().then(() => baseFetch(input, nextInit));
    activeMediaPromises.add(task);
    try {
      return await task;
    } finally {
      activeMediaControllers.delete(controller);
      activeMediaPromises.delete(task);
      detachSourceAbort?.();
    }
  };
  window.fetch.__fpStorage167ClearGuard = true;

  if (typeof Cache !== 'undefined' && Cache.prototype?.put && !Cache.prototype.put.__fpStorage167ClearGuard) {
    const basePut = Cache.prototype.put;
    const wrappedPut = function fpStorage167ClearGuardPut(request, response) {
      let isMedia = false;
      try {
        const raw = typeof request === 'string' ? request : String(request?.url || '');
        const url = new URL(raw, window.location.href);
        isMedia = url.origin === window.location.origin && MEDIA_PATH_RE.test(`${url.pathname}${url.search}`);
      } catch {}

      if (!isMedia) return basePut.call(this, request, response);
      if (clearingActive) return Promise.resolve(undefined);

      let task;
      try { task = Promise.resolve(basePut.call(this, request, response)); }
      catch (error) { return Promise.reject(error); }
      activeCacheWrites.add(task);
      task.then(
        () => activeCacheWrites.delete(task),
        () => activeCacheWrites.delete(task)
      );
      return task;
    };
    wrappedPut.__fpStorage167ClearGuard = true;
    Cache.prototype.put = wrappedPut;
  }

  const style = document.createElement('style');
  style.id = 'fp-storage167-clear-guard-style';
  style.textContent = `
    #fpStorage167PreparingGuard{
      position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;
      padding:calc(24px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right))
              calc(24px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left));
      background:var(--bg,#edf1f7);color:var(--text,#1d2733)
    }
    #fpStorage167PreparingGuard>div{width:min(420px,100%);text-align:center}
    #fpStorage167PreparingGuard b{display:block;font-size:22px;margin-bottom:8px}
    #fpStorage167PreparingGuard span{display:block;color:var(--muted);font-size:14px;line-height:1.45}
    #fpStorage167PreparingGuard i{display:block;width:44px;height:44px;margin:0 auto 20px;border-radius:50%;border:4px solid rgba(127,145,165,.22);border-top-color:var(--accent);animation:fpStorage167GuardSpin .8s linear infinite}
    @keyframes fpStorage167GuardSpin{to{transform:rotate(360deg)}}
    .fp-settings131.fp-storage167-clearing-page{
      position:fixed!important;inset:0!important;z-index:2147483000!important;width:100%!important;
      max-width:none!important;height:100dvh!important;margin:0!important;overflow:auto!important;
      padding:calc(10px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right))
              calc(18px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left))!important;
      background:var(--bg,#edf1f7)!important;color:var(--text,#1d2733)!important
    }
    .fp-settings131.fp-storage167-clearing-page .fp-settings131-body{width:min(720px,100%);margin:auto}
  `;
  document.head.appendChild(style);

  function showPreparingOverlay() {
    preparingOverlay?.remove();
    preparingOverlay = document.createElement('div');
    preparingOverlay.id = 'fpStorage167PreparingGuard';
    preparingOverlay.innerHTML = '<div><i aria-hidden="true"></i><b>Подготовка к очистке</b><span>Останавливаем загрузку медиа и завершаем операции с локальным кэшем…</span></div>';
    document.body.appendChild(preparingOverlay);
  }

  function hidePreparingOverlay() {
    preparingOverlay?.remove();
    preparingOverlay = null;
  }

  function markProgressPageExclusive() {
    const percent = document.getElementById('fpStorage167Percent');
    const root = percent?.closest('.fp-settings131');
    if (root) root.classList.add('fp-storage167-clearing-page');
  }

  function unloadGuard(event) {
    if (!clearingActive) return;
    event.preventDefault();
    event.returnValue = '';
  }

  async function waitForInflightToStop() {
    for (const controller of [...activeMediaControllers]) {
      try { controller.abort(abortError()); } catch { try { controller.abort(); } catch {} }
    }
    if (activeMediaPromises.size) await Promise.allSettled([...activeMediaPromises]);
    if (activeCacheWrites.size) await Promise.allSettled([...activeCacheWrites]);
    await window.FPNetwork171?.waitForMediaCacheIdle?.();
    await sleep(0);
  }

  async function waitForBackgroundQueueToDrain() {
    let quietSince = Date.now();
    while (clearingActive) {
      const newestActivity = Math.max(lastBlockedFetchAt, quietSince);
      if (activeMediaPromises.size === 0 && activeCacheWrites.size === 0 && Date.now() - newestActivity >= 350) return;
      if (lastBlockedFetchAt > quietSince) quietSince = lastBlockedFetchAt;
      await sleep(50);
    }
  }

  function releaseClearGuard() {
    if (!clearingActive) return;
    clearingActive = false;
    startIntercepting = false;
    clearTimeout(safetyTimer);
    safetyTimer = 0;
    hidePreparingOverlay();
    window.removeEventListener('beforeunload', unloadGuard, true);
  }

  function monitorClearCompletion() {
    const observer = new MutationObserver(() => {
      markProgressPageExclusive();
      const text = String(document.getElementById('fpStorage167ProgressText')?.textContent || '').trim();
      if (!text) return;
      if (text === 'Кэш очищен' || /Не удалось полностью очистить кэш/i.test(text)) {
        observer.disconnect();
        void (async () => {
          await waitForBackgroundQueueToDrain();
          releaseClearGuard();
        })();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    markProgressPageExclusive();
    return observer;
  }

  async function runExclusive(startClear, button = null) {
    if (typeof startClear !== 'function' || startIntercepting || clearingActive) return false;
    startIntercepting = true;
    clearingActive = true;
    lastBlockedFetchAt = Date.now();
    window.addEventListener('beforeunload', unloadGuard, true);
    showPreparingOverlay();
    if (button) button.disabled = true;

    safetyTimer = setTimeout(() => releaseClearGuard(), 5 * 60 * 1000);

    try {
      await waitForInflightToStop();
      const observer = monitorClearCompletion();
      hidePreparingOverlay();
      startClear();
      markProgressPageExclusive();
      setTimeout(() => {
        if (!document.getElementById('fpStorage167Percent') && clearingActive) {
          observer.disconnect();
          releaseClearGuard();
        }
      }, 1000);
      return true;
    } catch {
      releaseClearGuard();
      if (button) button.disabled = false;
      return false;
    }
  }

  window.FPStorage167ClearGuard = Object.freeze({
    runExclusive,
    isClearing: () => clearingActive,
    activeDownloads: () => activeMediaPromises.size,
    activeCacheWrites: () => activeCacheWrites.size
  });
})();
