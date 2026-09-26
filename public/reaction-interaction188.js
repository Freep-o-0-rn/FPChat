/* Build 188.5: reaction interaction owner.
   Owns reaction tap/long-press/right-click, quick-strip semantics and picker selection delegation.
   Gesture admission remains with FPGesture135; message-context remains its existing owner. */
(() => {
  if (window.FPReactionInteractionManager188) return;

  const LONG_PRESS_MS = 450;
  const MOVE_CANCEL_PX = 12;
  const PILL_SELECTOR = '.fp-reaction-pill188';
  const QUICK_CLASS = 'fp-reaction-quick188';
  const ERROR_TOAST_CLASS = 'fp-reaction-error188';
  const STYLE_ID = 'fp-reaction-interaction188-style';

  let touchSession = null;
  let suppressClickUntil = 0;
  const stats = {
    pillClicks: 0,
    longPresses: 0,
    rightClicks: 0,
    quickOpens: 0,
    quickClicks: 0,
    pickerOpens: 0,
    pickerSelections: 0,
    mutationsFailed: 0,
    detailsFallbacks: 0,
    lastMutationError: null
  };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${QUICK_CLASS}{
        min-height:46px;
        width:max-content;
        max-width:min(360px,calc(100vw - 28px));
        display:flex;
        align-items:center;
        gap:2px;
        box-sizing:border-box;
        margin:0 6px 8px auto;
        padding:4px 5px;
        border:1px solid rgba(255,255,255,.30);
        border-radius:999px;
        background:color-mix(in srgb,var(--panel) 88%,transparent);
        -webkit-backdrop-filter:blur(22px) saturate(1.2);
        backdrop-filter:blur(22px) saturate(1.2);
        box-shadow:0 12px 30px rgba(0,0,0,.24);
        overflow:hidden;
        pointer-events:auto;
      }
      .message-context-cluster.incoming .${QUICK_CLASS}{
        margin-left:6px;
        margin-right:auto;
      }
      :root[data-theme='dark'] .${QUICK_CLASS}{
        border-color:rgba(255,255,255,.11);
        background:color-mix(in srgb,var(--panel) 92%,transparent);
      }
      .fp-reaction-quick-button188{
        appearance:none;
        width:39px;
        height:38px;
        flex:0 0 39px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        padding:0;
        border:0;
        border-radius:999px;
        background:transparent;
        color:inherit;
        font:inherit;
        font-size:23px;
        line-height:1;
        cursor:pointer;
        touch-action:manipulation;
        transition:transform .1s ease,background .1s ease;
      }
      .fp-reaction-quick-button188:hover{
        background:rgba(120,130,145,.13);
      }
      .fp-reaction-quick-button188:active{
        transform:scale(.90);
      }
      .fp-reaction-quick-button188.is-mine{
        background:var(--accent-soft);
      }
      .fp-reaction-quick-button188:focus-visible{
        outline:2px solid var(--accent);
        outline-offset:1px;
      }
      @media (max-width:900px){
        .${QUICK_CLASS}{
          max-width:calc(100vw - 20px);
          margin-right:8px;
        }
        .message-context-cluster.incoming .${QUICK_CLASS}{margin-left:8px}
        .fp-reaction-quick-button188{
          width:34px;
          height:36px;
          flex-basis:34px;
          font-size:22px;
        }
      }
      .${ERROR_TOAST_CLASS}{
        position:fixed;
        left:50%;
        bottom:calc(22px + env(safe-area-inset-bottom));
        z-index:5200;
        max-width:min(360px,calc(100vw - 28px));
        transform:translateX(-50%);
        padding:9px 12px;
        border-radius:12px;
        background:rgba(28,32,38,.94);
        color:#fff;
        box-shadow:0 10px 30px rgba(0,0,0,.28);
        font-size:12px;
        font-weight:650;
        line-height:1.35;
        text-align:center;
        pointer-events:none;
      }
      @media (prefers-reduced-motion:reduce){
        .fp-reaction-quick-button188{transition:none}
      }
    `;
    document.head.appendChild(style);
  }

  function numericId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function messageElementFrom(target) {
    const message = target?.closest?.('.bubble-wrap.msg') || null;
    if (!message || !document.getElementById('messages')?.contains(message)) return null;
    return message;
  }

  function targetInfo(target) {
    const pill = target?.closest?.(PILL_SELECTOR) || null;
    if (!pill || pill.closest('.message-context-copy')) return null;
    const message = messageElementFrom(pill);
    if (!message) return null;
    const messageId = numericId(message.dataset.messageId || message.dataset.id);
    const reactionId = String(pill.dataset.reactionId || '').trim();
    const roomId = String(state?.roomId || '').trim();
    if (!roomId || !messageId || !reactionId) return null;
    return { pill, message, roomId, messageId, reactionId };
  }

  function reactionDescriptor(info) {
    const row = window.FPReactionManager188?.get?.(info.roomId, info.messageId);
    return (row?.reactions || []).find((item) => String(item.reactionId) === info.reactionId) || null;
  }

  function showMutationError(error) {
    document.querySelector(`.${ERROR_TOAST_CLASS}`)?.remove();
    const code = String(error?.code || 'REACTION_FAILED');
    const toast = document.createElement('div');
    toast.className = ERROR_TOAST_CLASS;
    toast.setAttribute('role', 'status');
    toast.textContent = `Не удалось изменить реакцию (${code})`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  function reportMutationFailure(error, detail = {}) {
    const rawCode = String(error?.code || '');
    const isCancellation = error?.name === 'AbortError' || rawCode.includes('CANCEL');
    const stillInSameRoom = String(detail?.roomId || '') === String(state?.roomId || '');
    if (isCancellation && (!stillInSameRoom || document.visibilityState === 'hidden')) return;

    const code = error?.name === 'AbortError'
      ? 'REACTION_ABORTED'
      : (rawCode || 'REACTION_FAILED');
    const visibleError = Object.assign(new Error(error?.message || code), {
      code,
      status: Number(error?.status || 0) || null
    });

    stats.mutationsFailed += 1;
    stats.lastMutationError = {
      code,
      status: visibleError.status,
      at: Date.now()
    };
    console.warn('[FPChat] reaction mutation failed', stats.lastMutationError, error);
    showMutationError(visibleError);
    try {
      window.dispatchEvent(new CustomEvent('fpchat:reaction188-error', {
        detail: {
          code,
          status: visibleError.status,
          message: String(error?.message || ''),
          ...detail
        }
      }));
    } catch {}
  }

  function toggle(info, reaction = null) {
    const manager = window.FPReactionManager188;
    if (!manager?.toggleReaction) return Promise.reject(new Error('reaction manager unavailable'));
    const promise = manager.toggleReaction({
      roomId: info.roomId,
      messageId: info.messageId,
      reactionId: info.reactionId,
      reaction: reaction || reactionDescriptor(info)
    });
    // The manager applies optimistic state synchronously. Explicitly ask the thin
    // renderer to paint it so physical UI does not depend on event delivery timing.
    window.FPReactionRenderer188?.patchMounted?.(info.roomId, info.messageId);
    return Promise.resolve(promise).then((result) => {
      window.FPReactionRenderer188?.patchMounted?.(info.roomId, info.messageId);
      return result;
    });
  }

  function requestDetails(info, point, source) {
    try {
      const detailsOwner = window.FPReactionDetails188;
      if (typeof detailsOwner?.open === 'function') {
        const handled = detailsOwner.open({
          roomId: info.roomId,
          messageId: info.messageId,
          reactionId: info.reactionId,
          source,
          point
        });
        if (handled !== false) return true;
      }
    } catch {}

    const detail = {
      roomId: info.roomId,
      messageId: info.messageId,
      reactionId: info.reactionId,
      source,
      point,
      handled: false
    };
    try {
      window.dispatchEvent(new CustomEvent('fpchat:reaction188-details-request', { detail }));
    } catch {}
    return detail.handled === true;
  }

  function fallbackToMessageContext(info, point) {
    stats.detailsFallbacks += 1;
    const target = info.message.querySelector(':scope > .bubble') || info.message;
    const x = Number(point?.x);
    const y = Number(point?.y);
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Number.isFinite(x) ? x : 0,
      clientY: Number.isFinite(y) ? y : 0,
      button: 2,
      buttons: 0
    }));
  }

  function openDetailsOrFallback(info, point, source) {
    if (!requestDetails(info, point, source)) fallbackToMessageContext(info, point);
  }

  function cancelTouch(reason = 'cancel') {
    const session = touchSession;
    if (!session) return;
    clearTimeout(session.timer);
    session.timer = null;
    session.actionLease?.release?.();
    session.actionLease = null;
    touchSession = null;
    return reason;
  }

  document.addEventListener('touchstart', (event) => {
    if (event.touches?.length !== 1) return;
    const info = targetInfo(event.target);
    if (!info) return;
    if (window.FPGesture135 && FPGesture135.currentLayer(event, event.target) !== 'chat') return;

    cancelTouch();
    const touch = event.touches[0];
    const session = {
      info,
      target: event.target,
      startX: touch.clientX,
      startY: touch.clientY,
      triggered: false,
      timer: null,
      actionLease: null
    };

    session.actionLease = window.FPGesture135?.watchAction?.('reaction-long-press', event, (reason) => {
      clearTimeout(session.timer);
      session.timer = null;
      if (reason === 'end') return;
      if (session.triggered && reason === 'layer') return;
      if (touchSession === session) touchSession = null;
    }) || null;

    session.timer = setTimeout(() => {
      if (touchSession !== session || !session.info.pill.isConnected) return;
      if (window.FPGesture135 && FPGesture135.currentLayer(null, session.target) !== 'chat') return;
      if (session.actionLease && !session.actionLease.claim()) {
        cancelTouch('claim-denied');
        return;
      }
      session.triggered = true;
      suppressClickUntil = Date.now() + 700;
      stats.longPresses += 1;
      openDetailsOrFallback(session.info, { x: session.startX, y: session.startY }, 'touch');
      navigator.vibrate?.(10);
    }, LONG_PRESS_MS);
    touchSession = session;
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', (event) => {
    const session = touchSession;
    if (!session || event.touches?.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - session.startX;
    const dy = touch.clientY - session.startY;

    if (session.triggered) {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (window.FPGesture135 && FPGesture135.currentLayer(event, event.target) !== 'chat') {
      cancelTouch('layer');
      return;
    }
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) cancelTouch('move');
  }, { capture: true, passive: false });

  document.addEventListener('touchend', () => cancelTouch('end'), { capture: true, passive: true });
  document.addEventListener('touchcancel', () => cancelTouch('cancel'), { capture: true, passive: true });

  document.addEventListener('click', (event) => {
    const info = targetInfo(event.target);
    if (!info) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (Date.now() < suppressClickUntil) return;
    stats.pillClicks += 1;
    void toggle(info).catch((error) => reportMutationFailure(error, info));
  }, true);

  document.addEventListener('contextmenu', (event) => {
    const info = targetInfo(event.target);
    if (!info) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stats.rightClicks += 1;
    openDetailsOrFallback(info, { x: event.clientX, y: event.clientY }, 'mouse');
  }, true);

  function mineIds(roomId, messageId) {
    const row = window.FPReactionManager188?.get?.(roomId, messageId);
    return new Set((row?.myReactions || []).map((item) => String(item.reactionId || '')));
  }

  function updateQuickSelection(strip, roomId, messageId) {
    const mine = mineIds(roomId, messageId);
    strip.querySelectorAll('.fp-reaction-quick-button188[data-reaction-id]').forEach((button) => {
      const selected = mine.has(String(button.dataset.reactionId || ''));
      button.classList.toggle('is-mine', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    window.FPReactionPicker188?.syncSelection?.(strip, mine);
  }

  function decorateContext(contextState, { clone, sourceRect, closeContext } = {}) {
    const manager = window.FPReactionManager188;
    const roomId = String(state?.roomId || '').trim();
    const messageId = numericId(contextState?.messageId);
    const original = contextState?.original;
    if (!manager?.getQuickReactions || !roomId || !messageId || !clone || !original) return false;
    if (original.classList?.contains('system-event-wrap')) return false;
    if (contextState.cluster?.querySelector?.(`:scope > .${QUICK_CLASS}`)) return true;

    ensureStyle();
    const strip = document.createElement('div');
    strip.className = QUICK_CLASS;
    strip.dataset.roomId = roomId;
    strip.dataset.messageId = String(messageId);
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', 'Быстрые реакции');
    contextState.cluster.insertBefore(strip, clone);

    const currentPadding = Number.parseFloat(contextState.cluster.style.paddingTop) || 0;
    const reserve = 54;
    contextState.cluster.style.paddingTop = `${Math.max(12, currentPadding - reserve)}px`;
    stats.quickOpens += 1;

    void Promise.all([
      manager.getQuickReactions(),
      manager.getAvailableReactions()
    ]).then(([reactions, available]) => {
      if (!strip.isConnected || !contextState.root?.isConnected) return;
      strip.replaceChildren();
      for (const reaction of reactions || []) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'fp-reaction-quick-button188';
        button.dataset.reactionId = String(reaction.id || '');
        button.textContent = String(reaction.value || '');
        button.setAttribute('aria-label', `Реакция ${String(reaction.value || '')}`);
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const info = {
            roomId,
            messageId,
            reactionId: String(reaction.id || ''),
            message: original,
            pill: button
          };
          stats.quickClicks += 1;
          void toggle(info, {
            reactionId: String(reaction.id || ''),
            type: String(reaction.type || 'emoji'),
            value: String(reaction.value || ''),
            enabled: reaction.enabled !== false
          }).catch((error) => reportMutationFailure(error, info));
          closeContext?.();
        });
        strip.appendChild(button);
      }

      const picker = window.FPReactionPicker188;
      if (picker?.attach) {
        picker.attach({
          strip,
          clone,
          catalog: available,
          getMineIds: () => mineIds(roomId, messageId),
          onExpandedChange: (expanded) => {
            if (expanded) stats.pickerOpens += 1;
          },
          onSelect: (reaction) => {
            const info = {
              roomId,
              messageId,
              reactionId: String(reaction?.id || ''),
              message: original,
              pill: null
            };
            stats.pickerSelections += 1;
            void toggle(info, {
              reactionId: String(reaction?.id || ''),
              type: String(reaction?.type || 'emoji'),
              value: String(reaction?.value || ''),
              enabled: reaction?.enabled !== false
            }).catch((error) => reportMutationFailure(error, info));
            closeContext?.();
          }
        });
      }

      updateQuickSelection(strip, roomId, messageId);
    }).catch(() => {
      if (!strip.isConnected) return;
      strip.remove();
      contextState.cluster.style.paddingTop = `${currentPadding}px`;
    });
    return true;
  }

  window.addEventListener('fpchat:reaction188-changed', (event) => {
    const roomId = String(event?.detail?.roomId || '');
    const messageId = numericId(event?.detail?.messageId);
    if (!roomId || !messageId) return;
    document.querySelectorAll(`.${QUICK_CLASS}[data-room-id="${CSS.escape(roomId)}"][data-message-id="${messageId}"]`)
      .forEach((strip) => updateQuickSelection(strip, roomId, messageId));
  }, { passive: true });

  window.FPLifecycle170?.subscribe?.((event) => {
    if (['background', 'pagehide', 'beforeunload'].includes(event?.lastType)) cancelTouch('lifecycle');
  });

  ensureStyle();
  document.documentElement.classList.add('fp-reaction-interaction188-ready');
  // Tiny catalog preload happens only after boot-ready through this optional owner.
  // It does not extend the stable Build 187 startup gate.
  void window.FPReactionManager188?.loadCatalog?.().catch?.(() => {});

  window.FPReactionInteractionManager188 = Object.freeze({
    LONG_PRESS_MS,
    MOVE_CANCEL_PX,
    decorateContext,
    requestDetails,
    snapshot: () => ({ owner: 'FPReactionInteractionManager188', ...stats, touchActive: Boolean(touchSession) })
  });

  try {
    window.FPRuntime?.registerOwner?.('reaction-interaction188', {
      role: 'reaction-interaction-manager',
      mode: 'active-owner',
      gestureAdmission: 'FPGesture135',
      longPressMs: LONG_PRESS_MS,
      moveCancelPx: MOVE_CANCEL_PX,
      owns: 'reaction pill tap/long-press/right-click + quick reaction strip + picker selection delegation',
      mutationOwner: 'FPReactionManager188 + FPReactionArbiter188',
      layerOwner: 'FPLayer173/message-context'
    });
  } catch {}
})();
