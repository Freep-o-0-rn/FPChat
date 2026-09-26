/* Build 189.5: thin admission arbiter for pinned voice playback.
   The existing FPVoice and voice-pins127 players remain playback owners.
   This guard only prevents overlapping async pin starts and keeps pin UI exclusive. */
(() => {
  if (window.FPVoicePlaybackArbiter189) return;

  const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6.8v10.4c0 .8.9 1.2 1.5.8l8-5.2a1 1 0 0 0 0-1.6l-8-5.2c-.6-.4-1.5 0-1.5.8Z"/></svg>';
  let admittedRoot = null;
  let pendingRoot = null;
  let pendingSince = 0;
  let releaseTimer = 0;
  const stats = { admissions: 0, blockedOverlaps: 0, uiResets: 0 };

  function rootOf(target) {
    return target instanceof Element ? target.closest('.fp-pins127-player') : null;
  }

  function buttonOf(root) {
    return root?.querySelector?.('.fp-pins127-play') || null;
  }

  function resetOtherPinUi(owner) {
    document.querySelectorAll('.fp-pins127-player').forEach((root) => {
      if (root === owner) return;
      const button = buttonOf(root);
      if (!button) return;
      const wasBusy = button.classList.contains('is-loading') || !button.classList.contains('is-play');
      button.classList.remove('is-loading');
      button.classList.add('is-play');
      button.innerHTML = PLAY_SVG;
      button.setAttribute('aria-label', 'Воспроизвести голосовое');
      if (wasBusy) stats.uiResets += 1;
    });
  }

  function pendingBusy() {
    if (!pendingRoot?.isConnected) return false;
    const button = buttonOf(pendingRoot);
    if (!button) return false;
    if (button.classList.contains('is-loading')) return true;
    if (Date.now() - pendingSince < 180) return true;
    return false;
  }

  function releasePendingWhenSettled(root) {
    clearTimeout(releaseTimer);
    const check = () => {
      if (pendingRoot !== root) return;
      const button = buttonOf(root);
      if (!button || !root.isConnected || !button.classList.contains('is-loading')) {
        pendingRoot = null;
        pendingSince = 0;
        return;
      }
      releaseTimer = setTimeout(check, 80);
    };
    releaseTimer = setTimeout(check, 80);
  }

  function admit(event) {
    const button = event.target instanceof Element ? event.target.closest('.fp-pins127-play') : null;
    if (!button) return;
    const root = rootOf(button);
    if (!root) return;

    // voice-pins127 loads/decrypts before assigning its local active player.
    // During that await window a second activation used to be able to start a
    // second Audio instance. Admit exactly one pending start at a time.
    if (pendingBusy() && pendingRoot !== root) {
      event.preventDefault();
      event.stopImmediatePropagation();
      stats.blockedOverlaps += 1;
      return;
    }
    if (pendingBusy() && pendingRoot === root) {
      event.preventDefault();
      event.stopImmediatePropagation();
      stats.blockedOverlaps += 1;
      return;
    }

    admittedRoot = root;
    pendingRoot = root;
    pendingSince = Date.now();
    stats.admissions += 1;
    resetOtherPinUi(root);
    releasePendingWhenSettled(root);
  }

  document.addEventListener('click', admit, { capture: true });

  const observer = new MutationObserver(() => {
    if (admittedRoot && !admittedRoot.isConnected) admittedRoot = null;
    if (pendingRoot && !pendingRoot.isConnected) {
      pendingRoot = null;
      pendingSince = 0;
    }
    if (admittedRoot) resetOtherPinUi(admittedRoot);
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

  window.FPVoicePlaybackArbiter189 = Object.freeze({
    snapshot: () => ({ owner: 'FPVoicePlaybackArbiter189', admittedMessageId: String(admittedRoot?.dataset?.messageId || ''), pending: Boolean(pendingRoot), ...stats })
  });

  try {
    window.FPRuntime?.registerOwner?.('voice-playback-arbiter189', {
      role: 'voice-playback-admission-arbiter',
      mode: 'thin-arbiter',
      owns: 'admission of pinned voice async starts + exclusive pinned playback presentation',
      doesNotOwn: 'Audio lifecycle/blob loading/waveform/progress/chat message rendering'
    });
  } catch {}
})();
