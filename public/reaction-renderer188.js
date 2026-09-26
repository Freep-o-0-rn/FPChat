/* Build 188.3: thin reaction DOM worker under FPMessageRender178.
   Owns only .fp-message-reactions188 inside an already rendered message bubble.
   No message remount, history/scroll writes, gestures, timers, observers or transport. */
(() => {
  if (window.FPReactionRenderer188) return;

  const CONTAINER = 'fp-message-reactions188';
  const PILL = 'fp-reaction-pill188';
  const STYLE_ID = 'fp-reaction-renderer188-style';
  const stats = { mounts: 0, patches: 0, pillUpdates: 0, pillRemovals: 0, currentScans: 0 };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${CONTAINER}{
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        gap:4px;
        margin-top:5px;
        max-width:100%;
        min-width:0;
        pointer-events:none;
        -webkit-user-select:none;
        user-select:none;
      }
      .${PILL}{
        min-height:24px;
        max-width:100%;
        box-sizing:border-box;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:4px;
        padding:2px 7px 2px 5px;
        border:1px solid rgba(120,130,145,.22);
        border-radius:999px;
        background:rgba(120,130,145,.10);
        color:var(--text);
        font-size:12px;
        font-weight:650;
        line-height:1;
        white-space:nowrap;
        pointer-events:none;
        transition:background .12s ease,border-color .12s ease,color .12s ease;
      }
      .${PILL}.is-mine{
        border-color:rgba(51,144,236,.48);
        background:var(--accent-soft);
        color:var(--accent);
      }
      .fp-reaction-emoji188{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:18px;
        font-size:16px;
        line-height:18px;
      }
      .fp-reaction-count188{
        min-width:10px;
        font-variant-numeric:tabular-nums;
        text-align:center;
      }
      .fp-reaction-avatars188{
        display:inline-flex;
        align-items:center;
        height:18px;
      }
      .fp-reaction-avatar188{
        width:18px;
        height:18px;
        flex:0 0 18px;
        box-sizing:border-box;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        overflow:hidden;
        border-radius:50%;
        border:1.5px solid var(--panel);
        background:var(--accent);
        color:#fff;
        font-size:7px;
        font-weight:800;
        line-height:1;
        letter-spacing:-.02em;
      }
      .mine .fp-reaction-avatar188{border-color:#d8ecff}
      :root[data-theme='dark'] .mine .fp-reaction-avatar188{border-color:#244766}
      .fp-reaction-avatar188 + .fp-reaction-avatar188{margin-left:-5px}
      .fp-reaction-avatar188 img{
        width:100%;
        height:100%;
        display:block;
        object-fit:cover;
      }
      @media (prefers-reduced-motion: reduce){
        .${PILL}{transition:none}
      }
    `;
    document.head.appendChild(style);
  }

  function numericId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function cleanName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 64);
  }

  function initials(value) {
    const parts = cleanName(value).split(' ').filter(Boolean);
    const raw = parts.length > 1
      ? `${parts[0][0] || ''}${parts[1][0] || ''}`
      : (parts[0] || 'FP').slice(0, 2);
    return raw.toUpperCase() || 'FP';
  }

  function participantPresentation(participantId) {
    const id = numericId(participantId);
    if (!id) return { participantId: null, displayName: 'FP', avatarUrl: null };

    const me = typeof state !== 'undefined' ? state?.me : null;
    if (Number(me?.id) === id) {
      return {
        participantId: id,
        displayName: cleanName(me?.displayName || state?.nick || 'FP') || 'FP',
        avatarUrl: me?.avatarUrl || me?.avatar_url || null
      };
    }

    const presence = typeof state !== 'undefined' ? Object.values(state?.presence || {}) : [];
    const row = presence.find((item) => Number(item?.participantId) === id) || null;
    return {
      participantId: id,
      displayName: cleanName(row?.displayName || 'FP') || 'FP',
      avatarUrl: row?.avatarUrl || row?.avatar_url || null
    };
  }

  function makeAvatar(participantId) {
    const presentation = participantPresentation(participantId);
    const avatar = document.createElement('span');
    avatar.className = 'fp-reaction-avatar188';
    avatar.dataset.participantId = presentation.participantId ? String(presentation.participantId) : '';
    avatar.setAttribute('aria-hidden', 'true');

    if (presentation.avatarUrl) {
      const image = document.createElement('img');
      image.alt = '';
      image.decoding = 'async';
      image.src = presentation.avatarUrl;
      avatar.appendChild(image);
    } else {
      avatar.textContent = initials(presentation.displayName);
    }
    return avatar;
  }

  function reactionSignature(reaction) {
    const preview = Array.isArray(reaction?.previewParticipantIds)
      ? reaction.previewParticipantIds.map(Number).filter(Boolean).slice(0, 2)
      : [];
    return JSON.stringify([
      String(reaction?.reactionId || ''),
      String(reaction?.value || ''),
      Math.max(0, Number(reaction?.count || 0) || 0),
      reaction?.mine === true,
      preview
    ]);
  }

  function updatePill(pill, reaction) {
    const signature = reactionSignature(reaction);
    if (pill.dataset.fpReactionSignature188 === signature) return false;

    const count = Math.max(0, Number(reaction?.count || 0) || 0);
    const preview = Array.isArray(reaction?.previewParticipantIds)
      ? reaction.previewParticipantIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 2)
      : [];

    pill.dataset.fpReactionSignature188 = signature;
    pill.dataset.reactionId = String(reaction.reactionId || '');
    pill.classList.toggle('is-mine', reaction?.mine === true);
    pill.replaceChildren();

    const emoji = document.createElement('span');
    emoji.className = 'fp-reaction-emoji188';
    emoji.textContent = String(reaction?.value || reaction?.reactionId || '');
    pill.appendChild(emoji);

    if ((count === 1 || count === 2) && preview.length === count) {
      const avatars = document.createElement('span');
      avatars.className = 'fp-reaction-avatars188';
      preview.forEach((participantId) => avatars.appendChild(makeAvatar(participantId)));
      pill.appendChild(avatars);
    } else {
      const value = document.createElement('span');
      value.className = 'fp-reaction-count188';
      value.textContent = String(count);
      pill.appendChild(value);
    }

    pill.setAttribute('aria-label', `${String(reaction?.value || '')} ${count}`);
    stats.pillUpdates += 1;
    return true;
  }

  function ensureContainer(messageEl) {
    const bubble = messageEl?.querySelector?.(':scope > .bubble');
    if (!bubble) return null;
    let container = bubble.querySelector(`:scope > .${CONTAINER}`);
    if (container) return container;
    container = document.createElement('div');
    container.className = CONTAINER;
    container.dataset.fpReactionRenderer188 = '1';
    const meta = bubble.querySelector(':scope > .meta');
    bubble.insertBefore(container, meta || null);
    return container;
  }

  function removeContainer(messageEl) {
    const bubble = messageEl?.querySelector?.(':scope > .bubble');
    bubble?.querySelector?.(`:scope > .${CONTAINER}`)?.remove();
  }

  function patch(messageEl, roomId, messageId) {
    const id = numericId(messageId);
    const room = String(roomId || '');
    if (!messageEl || !id || !room || messageEl.classList?.contains('system-event-wrap')) return false;

    const stateRow = window.FPReactionManager188?.get?.(room, id);
    const reactions = Array.isArray(stateRow?.reactions)
      ? stateRow.reactions.filter((item) => Number(item?.count || 0) > 0)
      : [];

    if (!reactions.length) {
      removeContainer(messageEl);
      return true;
    }

    ensureStyle();
    const container = ensureContainer(messageEl);
    if (!container) return false;

    const existing = new Map(
      [...container.querySelectorAll(`:scope > .${PILL}[data-reaction-id]`)]
        .map((pill) => [String(pill.dataset.reactionId || ''), pill])
    );
    const keep = new Set();

    for (const reaction of reactions) {
      const reactionId = String(reaction?.reactionId || '');
      if (!reactionId) continue;
      keep.add(reactionId);
      let pill = existing.get(reactionId);
      if (!pill) {
        pill = document.createElement('span');
        pill.className = PILL;
        pill.dataset.reactionId = reactionId;
      }
      updatePill(pill, reaction);
      // Appending an existing node only reorders the reaction lane. The message
      // bubble itself is never rebuilt or replaced.
      container.appendChild(pill);
    }

    for (const [reactionId, pill] of existing) {
      if (keep.has(reactionId)) continue;
      pill.remove();
      stats.pillRemovals += 1;
    }

    if (!container.childElementCount) container.remove();
    stats.patches += 1;
    return true;
  }

  function mount(messageEl, roomId, message = null) {
    const id = numericId(message?.id ?? messageEl?.dataset?.messageId ?? messageEl?.dataset?.id);
    if (!id || !messageEl || message?.type === 'system' || messageEl.classList?.contains('system-event-wrap')) return false;
    messageEl.dataset.fpReactionMount188 = '1';
    stats.mounts += 1;
    return patch(messageEl, roomId, id);
  }

  function findMounted(messageId) {
    const id = numericId(messageId);
    if (!id) return null;
    const box = document.getElementById('messages');
    if (!box) return null;
    return [...box.querySelectorAll(':scope > .bubble-wrap.msg')]
      .find((node) => Number(node.dataset.messageId || node.dataset.id) === id) || null;
  }

  function patchMounted(roomId, messageId) {
    if (String(roomId || '') !== String(state?.roomId || '')) return false;
    const node = findMounted(messageId);
    return node ? patch(node, roomId, messageId) : false;
  }

  function mountCurrent() {
    const roomId = String(state?.roomId || '');
    const box = document.getElementById('messages');
    if (!roomId || !box) return 0;
    let count = 0;
    for (const node of box.querySelectorAll(':scope > .bubble-wrap.msg:not(.system-event-wrap)')) {
      if (mount(node, roomId, null)) count += 1;
    }
    stats.currentScans += 1;
    return count;
  }

  window.addEventListener('fpchat:reaction188-changed', (event) => {
    const detail = event?.detail || {};
    patchMounted(detail.roomId, detail.messageId);
  }, { passive: true });

  ensureStyle();

  window.FPReactionRenderer188 = Object.freeze({
    mount,
    patch,
    patchMounted,
    mountCurrent,
    participantPresentation,
    snapshot: () => ({ owner: 'FPReactionRenderer188', ...stats })
  });

  try {
    window.FPRuntime?.registerOwner?.('reaction-renderer188', {
      role: 'reaction-dom-worker',
      mode: 'thin-worker',
      owner: 'FPMessageRender178',
      scope: '.fp-message-reactions188 only',
      input: 'FPReactionManager188 canonical state',
      gestures: 'none in Build 188.3',
      scrollWrites: false,
      observers: false
    });
  } catch {}

  mountCurrent();
})();
