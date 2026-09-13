/* Build 125: isolated Telegram-like voice cancel hint. No voice/read-state mechanics changed. */
(() => {
  if (window.__fpVoiceCancel125Installed) return;
  window.__fpVoiceCancel125Installed = true;

  const CANCEL_THRESHOLD_PX = 145;
  const GRAY = [148, 163, 184];
  const RED = [255, 107, 107];
  let gesture = null;

  const TRASH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4.8h6V7M7.5 7l.8 12h7.4l.8-12M10 10.5v5M14 10.5v5"/></svg>';

  const style = document.createElement('style');
  style.dataset.fpVoiceCancel125 = '1';
  style.textContent = `
    .fp-voice-cancel-ui125 {
      display: none;
      position: absolute;
      left: 72px;
      right: 82px;
      top: 50%;
      min-width: 0;
      height: 32px;
      padding: 0 9px;
      box-sizing: border-box;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border-radius: 16px;
      color: rgb(148,163,184);
      background: rgba(14,22,33,.58);
      border: 1px solid rgba(148,163,184,.10);
      box-shadow: 0 2px 8px rgba(0,0,0,.08);
      transform: translateY(-50%);
      pointer-events: none;
      -webkit-user-select: none;
      user-select: none;
      z-index: 7;
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
      border-color: rgba(255,107,107,.25);
      box-shadow: 0 2px 10px rgba(255,107,107,.08);
    }

    @media (max-width: 430px) {
      .fp-voice-cancel-ui125 {
        left: 66px;
        right: 72px;
        height: 31px;
        padding-left: 7px;
        padding-right: 7px;
        gap: 4px;
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

  function resetUi(form) {
    const ui = ensureUi(form);
    if (!ui) return;
    ui.style.color = 'rgb(148,163,184)';
    ui.style.background = 'rgba(14,22,33,.58)';
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
    ui.style.background = `rgba(${Math.round(14 + (28 * warm))},${Math.round(22 + (5 * warm))},${Math.round(33 + (3 * warm))},${(0.58 + (0.10 * warm)).toFixed(3)})`;

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

  const observer = new MutationObserver(() => ensureUi());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  ensureUi();
})();
