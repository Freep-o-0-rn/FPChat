/* Build 159: Telegram-like voice cancel hint plus isolated composer state resync. */
(() => {
  if (window.__fpVoiceCancel126Installed) return;
  window.__fpVoiceCancel126Installed = true;

  const CANCEL_THRESHOLD_PX = 145;
  const GRAY = [148, 163, 184];
  const RED = [255, 107, 107];
  const COMPOSER_SYNC_DELAYS = [0, 80, 220, 520, 900];
  const composerSyncTimers = new WeakMap();
  let gesture = null;

  const TRASH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4.8h6V7M7.5 7l.8 12h7.4l.8-12M10 10.5v5M14 10.5v5"/></svg>';

  const style = document.createElement('style');
  style.dataset.fpVoiceCancel126 = '1';
  style.textContent = `
    .fp-voice-cancel-ui125 {
      display: none;
      position: absolute;
      left: 76px;
      right: 104px;
      top: auto;
      bottom: calc(100% + 10px);
      min-width: 0;
      height: 32px;
      padding: 0 10px;
      box-sizing: border-box;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border-radius: 16px;
      color: rgb(148,163,184);
      background: rgba(14,22,33,.94);
      border: 1px solid rgba(148,163,184,.16);
      box-shadow: 0 5px 16px rgba(0,0,0,.22);
      transform: none;
      pointer-events: none;
      -webkit-user-select: none;
      user-select: none;
      z-index: 12;
    }

    #sendForm.fp-voice-recording:not(.fp-voice-locked):not(.fp-voice-processing) .fp-voice-cancel-ui125 {
      display: flex;
    }

    #sendForm.fp-voice-recording:not(.fp-voice-locked):not(.fp-voice-processing) .fp-voice-record-hint {
      visibility: hidden !important;
      flex: 0 0 0 !important;
      width: 0 !important;
      max-width: 0 !important;
      min-width: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      transform: none !important;
    }

    /* Keep the live red waveform inside its own visual zone and away from the right touch area. */
    #sendForm.fp-voice-recording:not(.fp-voice-locked):not(.fp-voice-processing) .fp-voice-live-waveform {
      flex: 1 1 0 !important;
      width: auto !important;
      min-width: 28px !important;
      max-width: none !important;
      margin-right: 54px !important;
      box-sizing: border-box;
    }

    .fp-voice-cancel-copy125 {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      line-height: 1;
      font-weight: 600;
      letter-spacing: .005em;
    }

    .fp-voice-cancel-trash125 {
      width: 19px;
      height: 19px;
      flex: 0 0 19px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #ff6b6b;
      opacity: 0;
      transform: scale(.65);
      transform-origin: center;
      transition: opacity .045s linear, transform .045s linear;
    }

    .fp-voice-cancel-trash125 svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.9;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .fp-voice-cancel-ui125.is-danger {
      border-color: rgba(255,107,107,.30);
      box-shadow: 0 5px 18px rgba(255,107,107,.10);
    }

    @media (max-width: 430px) {
      .fp-voice-cancel-ui125 {
        left: 58px;
        right: 88px;
        bottom: calc(100% + 9px);
        height: 31px;
        padding-left: 8px;
        padding-right: 8px;
        gap: 4px;
      }
      #sendForm.fp-voice-recording:not(.fp-voice-locked):not(.fp-voice-processing) .fp-voice-live-waveform {
        margin-right: 46px !important;
        min-width: 24px !important;
      }
      .fp-voice-cancel-copy125 {
        font-size: 11px;
      }
      .fp-voice-cancel-trash125 {
        width: 18px;
        height: 18px;
        flex-basis: 18px;
      }
    }
  `;
  document.head.appendChild(style);

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function mixColor(progress) {
    const warm = clamp01((progress - 0.4) / 0.4);
    const rgb = GRAY.map((from, index) => Math.round(from + ((RED[index] - from) * warm)));
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }

  function ensureUi(form = document.getElementById('sendForm')) {
    const bar = form?.querySelector('.fp-voice-recording-bar');
    if (!bar) return null;
    let ui = bar.querySelector('.fp-voice-cancel-ui125');
    if (ui) return ui;

    ui = document.createElement('span');
    ui.className = 'fp-voice-cancel-ui125';
    ui.setAttribute('aria-hidden', 'true');
    ui.innerHTML = `<span class="fp-voice-cancel-trash125">${TRASH_SVG}</span><span class="fp-voice-cancel-copy125">← Проведите влево для отмены</span>`;
    bar.appendChild(ui);
    return ui;
  }

  /*
   * voice.js owns the real composer state and already has the correct
   * empty/text/busy checks. Rarely, a freshly rebuilt chat can finish its
   * room/voice cleanup after the first sync pass, leaving the old visual state
   * until the chat is reopened. Nudge only voice.js' existing capture listener;
   * stop this synthetic event before app.js' normal input handler so drafts,
   * rendering and scroll behaviour are untouched.
   */
  function syncVoiceComposerState(form = document.getElementById('sendForm')) {
    if (!form?.isConnected) return;
    const input = form.querySelector('#msgInput');
    const mic = form.querySelector('.fp-voice-record-btn');
    if (!input || !mic) return;

    const stopAfterVoice = (event) => event.stopImmediatePropagation();
    input.addEventListener('input', stopAfterVoice, { capture: true, once: true });
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function scheduleVoiceComposerSync(form = document.getElementById('sendForm')) {
    if (!form) return;
    const previous = composerSyncTimers.get(form);
    previous?.forEach((timer) => clearTimeout(timer));

    const timers = COMPOSER_SYNC_DELAYS.map((delay) => setTimeout(() => {
      if (form.isConnected) syncVoiceComposerState(form);
    }, delay));
    composerSyncTimers.set(form, timers);
  }

  function resetUi(form) {
    const ui = ensureUi(form);
    if (!ui) return;
    ui.style.color = 'rgb(148,163,184)';
    ui.style.background = 'rgba(14,22,33,.94)';
    ui.classList.remove('is-danger');
    const trash = ui.querySelector('.fp-voice-cancel-trash125');
    if (trash) {
      trash.style.opacity = '0';
      trash.style.transform = 'scale(.65)';
    }
  }

  function begin(event) {
    const mic = event.target?.closest?.('.fp-voice-record-btn');
    if (!mic) return;
    const form = mic.closest('#sendForm');
    if (!form) return;
    ensureUi(form);
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      form
    };
    resetUi(form);
  }

  function update(event) {
    if (!gesture) return;
    if (event.pointerId != null && gesture.pointerId != null && event.pointerId !== gesture.pointerId) return;
    if (gesture.form?.classList.contains('fp-voice-locked')) return;

    const left = Math.max(0, gesture.startX - event.clientX);
    const up = Math.max(0, gesture.startY - event.clientY);
    const horizontalDominant = left >= up * 0.85;
    const progress = horizontalDominant ? clamp01(left / CANCEL_THRESHOLD_PX) : 0;
    const ui = ensureUi(gesture.form);
    if (!ui) return;

    ui.style.color = mixColor(progress);
    const warm = clamp01((progress - 0.4) / 0.4);
    ui.style.background = `rgba(${Math.round(14 + (28 * warm))},${Math.round(22 + (5 * warm))},${Math.round(33 + (3 * warm))},${(0.94 + (0.03 * warm)).toFixed(3)})`;

    const trashProgress = clamp01((progress - 0.8) / 0.2);
    const trash = ui.querySelector('.fp-voice-cancel-trash125');
    if (trash) {
      trash.style.opacity = String(trashProgress);
      trash.style.transform = `scale(${(0.65 + (0.55 * trashProgress)).toFixed(3)})`;
    }
    ui.classList.toggle('is-danger', progress >= 0.8);
  }

  function end(event) {
    if (!gesture) return;
    if (event?.pointerId != null && gesture.pointerId != null && event.pointerId !== gesture.pointerId) return;
    const form = gesture.form;
    gesture = null;
    setTimeout(() => resetUi(form), 120);
  }

  document.addEventListener('pointerdown', begin, true);
  document.addEventListener('pointermove', update, { capture: true, passive: true });
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);

  if (window.FPDOM173?.on) {
    window.FPDOM173.on('composer', 'mounted', () => {
      ensureUi();
      scheduleVoiceComposerSync();
    });
  } else {
    const observer = new MutationObserver((records) => {
      ensureUi();
      let composerChanged = false;
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node.nodeType !== 1) continue;
          if (
            node.id === 'sendForm' ||
            node.matches?.('.fp-voice-record-btn') ||
            node.querySelector?.('#sendForm, .fp-voice-record-btn')
          ) {
            composerChanged = true;
            break;
          }
        }
        if (composerChanged) break;
      }
      if (composerChanged) scheduleVoiceComposerSync();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleVoiceComposerSync();
  });
  window.addEventListener('pageshow', () => scheduleVoiceComposerSync(), { passive: true });

  ensureUi();
  scheduleVoiceComposerSync();
})();
