/* Build 186.3: reveal after existing owners/layers and startup assets settle.
   System/request data refresh remains with its existing background owners. */
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

  async function waitForStartupAssets(timeoutMs = 4000) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      if (Number(bootTracker?.pendingCount?.() || 0) === 0) {
        // onload children and MutationObservers must settle before revealing.
        // Recheck after two frames instead of adding a fixed quiet + sleep delay.
        await nextPaint();
        if (Number(bootTracker?.pendingCount?.() || 0) === 0) return true;
      } else {
        await sleep(40);
      }
    }
    return false;
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

    // Keep the same interface readiness boundary. Network data is refreshed by
    // system-chat144 / chat-request-system147; it must not block the whole UI.
    try { window.FPViewport136?.sync?.(); } catch {}
    bootTracker?.mark186?.('assets-start');
    const assetsCompleted186 = await waitForStartupAssets();
    bootTracker?.mark186?.('assets-end',assetsCompleted186);
    release();
  }

  prepare().catch(() => release());
})();
