/* Build 152: keep the cold-start splash visible until the existing client layers are ready. */
(() => {
  if (window.__fpBootReady152Installed) return;
  window.__fpBootReady152Installed = true;

  const gate = document.getElementById('bootHold152');
  const appRoot = document.getElementById('appRoot');
  const bootTracker = window.FPBoot152 || null;
  let released = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function coreReady() {
    return Boolean(appRoot && !appRoot.classList.contains('hidden-boot'));
  }

  function layersReady() {
    return Boolean(
      window.__fpUiHotfix128Installed
      && window.__fpRoomMenuTouch151Installed
      && window.__fpChatOpening129Installed
      && window.__fpSettings131Installed
      && window.__fpUsernameProfile140Installed
      && window.FPChatRequestOwner147
      && window.__fpUsernameSearch143Installed
      && window.FPSystem144
      && window.__fpChatRequestSystem147Installed
      && window.FPGesture135
      && window.__fpSystemUi148Installed
      && window.__fpViewport136Installed
      && window.__fpMediaGallery134Installed
      && window.__fpVoicePolish124Installed
      && window.__fpVoiceCancel126Installed
      && window.__fpVoicePins127Installed
    );
  }

  async function waitFor(test, timeoutMs) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      try { if (test()) return true; } catch {}
      await sleep(40);
    }
    try { return Boolean(test()); } catch { return false; }
  }

  function requestSyncFinishedAtLeastOnce() {
    try {
      return performance.getEntriesByType('resource').some((entry) => {
        const url = new URL(entry.name, location.href);
        return url.origin === location.origin && url.pathname === '/api/chat-requests/mine';
      });
    } catch {
      return false;
    }
  }

  async function waitForResourceQuiet(timeoutMs = 4000, quietMs = 180) {
    const started = performance.now();
    let quietSince = 0;
    while (performance.now() - started < timeoutMs) {
      const pending = Number(bootTracker?.pendingCount?.() || 0);
      if (pending === 0) {
        if (!quietSince) quietSince = performance.now();
        if (performance.now() - quietSince >= quietMs) return true;
      } else {
        quietSince = 0;
      }
      await sleep(40);
    }
    return Number(bootTracker?.pendingCount?.() || 0) === 0;
  }

  async function nextPaint() {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function release() {
    if (released) return;
    released = true;
    try { window.FPViewport136?.sync?.(); } catch {}
    bootTracker?.stop?.();
    gate?.remove();
    bootTracker?.mark186?.('boot-ready');
    document.documentElement.removeAttribute('data-fp-boot152');
    const readyAt = performance.now();
    window.__fpBootReady169At = readyAt;
    window.dispatchEvent(new CustomEvent('fpchat:boot-ready', { detail: { build: 152, readyAtMs: readyAt } }));
  }

  async function prepare() {
    document.documentElement.setAttribute('data-fp-boot152', 'preparing');

    // app.js still owns its original boot sequence. We only delay the visible
    // reveal until that core sequence has already completed behind this gate.
    bootTracker?.mark186?.('core-wait-start');
    const coreCompleted = await waitFor(coreReady, 9000);
    bootTracker?.mark186?.('core-wait-end',coreCompleted);
    if (!coreCompleted) {
      release();
      return;
    }

    // Do not change feature ordering. Wait for the already-existing layers to
    // finish installing in their current dependency order.
    bootTracker?.mark186?.('layers-start');
    const layersCompleted186 = await waitFor(layersReady, 7000);
    bootTracker?.mark186?.('layers-end',layersCompleted186);

    // Ensure the list surface/safe-area has been applied before it becomes
    // visible, then wait for the existing system-chat refresh to finish once.
    try { window.FPViewport136?.sync?.(); } catch {}
    bootTracker?.mark186?.('system-start');
    try {
      const refresh = window.FPSystem144?.refresh?.();
      if (refresh && typeof refresh.then === 'function') {
        await Promise.race([refresh.catch(() => null), sleep(2500)]);
      }
    } catch {}
    bootTracker?.mark186?.('system-end');

    // chat-request-system147 performs its own initial synchronization. This is
    // only an observation of that existing request; no second request is made.
    if (window.__fpChatRequestSystem147Installed) {
      bootTracker?.mark186?.('requests-start');
      const requestsCompleted186 = await waitFor(requestSyncFinishedAtLeastOnce, 2500);
      bootTracker?.mark186?.('requests-end',requestsCompleted186);
    }

    // All dynamically appended startup JS/CSS is tracked by index.html. Wait
    // for a short quiet period so late onload children are included as well.
    bootTracker?.mark186?.('quiet-start');
    const quietCompleted186 = await waitForResourceQuiet();
    bootTracker?.mark186?.('quiet-end',quietCompleted186);

    // Give MutationObserver/request-preview work one final paint before reveal.
    await sleep(120);
    await nextPaint();
    release();
  }

  prepare().catch(() => release());
})();
