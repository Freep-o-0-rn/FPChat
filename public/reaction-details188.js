/* Build 188.6: Reaction Details modal owner.
   Read-only lazy participant list. Mutation state remains in FPReactionManager188.
   Uses existing FPNetwork171 and FPLayer173 modal detection. */
(() => {
  if (window.FPReactionDetails188) return;

  const PAGE_SIZE = 30;
  const SCROLL_THRESHOLD_PX = 120;
  const STYLE_ID = 'fp-reaction-details188-style';
  let active = null;

  const stats = {
    opens: 0,
    closes: 0,
    requests: 0,
    pages: 0,
    rows: 0,
    stale: 0,
    profileOpens: 0,
    failures: 0
  };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .fp-reaction-details188-overlay{
        position:fixed;
        inset:0;
        z-index:4550;
        display:flex;
        align-items:center;
        justify-content:center;
        box-sizing:border-box;
        padding:20px;
        background:rgba(0,0,0,.44);
        -webkit-backdrop-filter:blur(3px);
        backdrop-filter:blur(3px);
      }
      .fp-reaction-details188-sheet{
        width:min(430px,100%);
        max-height:min(720px,calc(100dvh - 36px));
        display:flex;
        flex-direction:column;
        overflow:hidden;
        border:1px solid rgba(120,130,145,.22);
        border-radius:22px;
        background:var(--panel);
        color:var(--text);
        box-shadow:0 24px 70px rgba(0,0,0,.34);
      }
      .fp-reaction-details188-head{
        display:flex;
        align-items:center;
        gap:10px;
        min-height:58px;
        padding:8px 10px 8px 16px;
        box-sizing:border-box;
        border-bottom:1px solid rgba(120,130,145,.16);
      }
      .fp-reaction-details188-title{
        flex:1;
        min-width:0;
        font-size:17px;
        font-weight:800;
      }
      .fp-reaction-details188-refresh{
        appearance:none;
        min-height:34px;
        padding:0 10px;
        border:0;
        border-radius:999px;
        background:var(--accent-soft);
        color:var(--accent);
        font:inherit;
        font-size:12px;
        font-weight:750;
        cursor:pointer;
      }
      .fp-reaction-details188-refresh[hidden]{display:none!important}
      .fp-reaction-details188-close{
        appearance:none;
        width:38px;
        height:38px;
        flex:0 0 38px;
        display:grid;
        place-items:center;
        border:0;
        border-radius:50%;
        background:rgba(120,130,145,.12);
        color:inherit;
        font:inherit;
        font-size:24px;
        line-height:1;
        cursor:pointer;
      }
      .fp-reaction-details188-tabs{
        display:flex;
        gap:5px;
        overflow-x:auto;
        overflow-y:hidden;
        padding:8px 10px;
        border-bottom:1px solid rgba(120,130,145,.13);
        scrollbar-width:none;
        overscroll-behavior-x:contain;
      }
      .fp-reaction-details188-tabs::-webkit-scrollbar{display:none}
      .fp-reaction-details188-tab{
        appearance:none;
        min-height:34px;
        flex:0 0 auto;
        display:inline-flex;
        align-items:center;
        gap:5px;
        padding:0 11px;
        border:0;
        border-radius:999px;
        background:rgba(120,130,145,.10);
        color:var(--muted);
        font:inherit;
        font-size:13px;
        font-weight:700;
        cursor:pointer;
        touch-action:manipulation;
      }
      .fp-reaction-details188-tab.is-active{
        background:var(--accent-soft);
        color:var(--accent);
      }
      .fp-reaction-details188-list{
        min-height:120px;
        overflow-x:hidden;
        overflow-y:auto;
        overscroll-behavior:contain;
        -webkit-overflow-scrolling:touch;
        padding:4px 0 calc(8px + env(safe-area-inset-bottom));
      }
      .fp-reaction-details188-row{
        width:100%;
        min-height:58px;
        display:flex;
        align-items:center;
        gap:11px;
        box-sizing:border-box;
        padding:8px 14px;
        border:0;
        background:transparent;
        color:inherit;
        text-align:left;
        font:inherit;
      }
      button.fp-reaction-details188-row{
        cursor:pointer;
        touch-action:manipulation;
      }
      button.fp-reaction-details188-row:hover{
        background:rgba(120,130,145,.08);
      }
      .fp-reaction-details188-avatar{
        width:40px;
        height:40px;
        flex:0 0 40px;
        display:grid;
        place-items:center;
        overflow:hidden;
        border-radius:50%;
        background:var(--accent);
        color:#fff;
        font-size:13px;
        font-weight:800;
        user-select:none;
      }
      .fp-reaction-details188-avatar img{
        width:100%;
        height:100%;
        display:block;
        object-fit:cover;
      }
      .fp-reaction-details188-copy{
        min-width:0;
        flex:1;
        display:flex;
        flex-direction:column;
        gap:3px;
      }
      .fp-reaction-details188-name{
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        font-size:14px;
        font-weight:750;
      }
      .fp-reaction-details188-meta{
        min-width:0;
        display:flex;
        align-items:center;
        gap:6px;
        color:var(--muted);
        font-size:12px;
        line-height:1.25;
      }
      .fp-reaction-details188-emojis{
        display:inline-flex;
        align-items:center;
        gap:1px;
        flex:0 0 auto;
        font-size:16px;
        line-height:1;
      }
      .fp-reaction-details188-time{
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }
      .fp-reaction-details188-chevron{
        flex:0 0 auto;
        color:var(--muted);
        font-size:22px;
        line-height:1;
        opacity:.65;
      }
      .fp-reaction-details188-state{
        padding:24px 18px;
        color:var(--muted);
        text-align:center;
        font-size:13px;
        line-height:1.45;
      }
      .fp-reaction-details188-state.error{color:var(--danger)}
      .fp-reaction-details188-more{
        min-height:40px;
        display:grid;
        place-items:center;
        color:var(--muted);
        font-size:12px;
      }
      @media(max-width:600px){
        .fp-reaction-details188-overlay{
          align-items:flex-end;
          padding:0;
        }
        .fp-reaction-details188-sheet{
          width:100%;
          max-height:min(78dvh,720px);
          border-radius:22px 22px 0 0;
          border-left:0;
          border-right:0;
          border-bottom:0;
        }
        .fp-reaction-details188-list{
          min-height:180px;
        }
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

  function formatReactionTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((startToday - startTarget) / 86400000);
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days === 0) return `сегодня в ${time}`;
    if (days === 1) return `вчера в ${time}`;
    return `${date.toLocaleDateString()} в ${time}`;
  }

  function networkFetch(input, init) {
    const owner = window.FPNetwork171;
    if (typeof owner?.fetch === 'function') return owner.fetch(input, init);
    return window.fetch(input, init);
  }

  function close(reason = 'close') {
    const state = active;
    if (!state) return;
    active = null;
    state.controller?.abort?.(reason);
    state.roomAbortCleanup?.();
    document.removeEventListener('keydown', state.onKey, true);
    state.overlay.remove();
    stats.closes += 1;
  }

  function renderAvatar(row) {
    const avatar = document.createElement('span');
    avatar.className = 'fp-reaction-details188-avatar';
    const url = String(row?.avatarUrl || row?.profile?.avatarUrl || '').trim();
    if (url) {
      const image = document.createElement('img');
      image.alt = '';
      image.decoding = 'async';
      image.src = url;
      avatar.appendChild(image);
    } else {
      avatar.textContent = initials(row?.displayName);
    }
    return avatar;
  }

  function openProfile(row) {
    if (!row?.profile) return false;
    const opener = window.FPUsernameSearch143?.openProfile;
    if (typeof opener !== 'function') return false;
    const profile = row.profile;
    close('profile-open');
    const opened = opener(profile);
    if (opened) stats.profileOpens += 1;
    return Boolean(opened);
  }

  function renderRow(state, row) {
    const clickable = Boolean(row?.profile && window.FPUsernameSearch143?.openProfile);
    const root = document.createElement(clickable ? 'button' : 'div');
    if (clickable) root.type = 'button';
    root.className = 'fp-reaction-details188-row';
    root.dataset.participantId = String(row?.participantId || '');

    const avatar = renderAvatar(row);
    const copy = document.createElement('span');
    copy.className = 'fp-reaction-details188-copy';

    const name = document.createElement('span');
    name.className = 'fp-reaction-details188-name';
    name.textContent = cleanName(row?.displayName) || 'Пользователь FPChat';

    const meta = document.createElement('span');
    meta.className = 'fp-reaction-details188-meta';

    const emojis = document.createElement('span');
    emojis.className = 'fp-reaction-details188-emojis';
    const reactions = Array.isArray(row?.reactions) ? row.reactions : [];
    for (const reaction of reactions) {
      const emoji = document.createElement('span');
      emoji.textContent = String(reaction?.value || '');
      const ownTime = formatReactionTime(reaction?.createdAt);
      if (ownTime) emoji.title = ownTime;
      emojis.appendChild(emoji);
    }

    const time = document.createElement('span');
    time.className = 'fp-reaction-details188-time';
    time.textContent = formatReactionTime(row?.lastReactionAt);

    meta.append(emojis, time);
    copy.append(name, meta);
    root.append(avatar, copy);

    if (clickable) {
      const chevron = document.createElement('span');
      chevron.className = 'fp-reaction-details188-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.textContent = '›';
      root.appendChild(chevron);
      root.setAttribute('aria-label', `Открыть профиль ${name.textContent}`);
      root.addEventListener('click', () => openProfile(row));
    }
    return root;
  }

  function setStateMessage(state, text, kind = '') {
    state.list.replaceChildren();
    const item = document.createElement('div');
    item.className = `fp-reaction-details188-state${kind ? ` ${kind}` : ''}`;
    item.textContent = text;
    state.list.appendChild(item);
  }

  function buildTabs(state, tabs) {
    state.tabs.replaceChildren();
    const entries = [
      { id: 'all', label: 'Все', count: Math.max(0, Number(tabs?.allCount || 0)) },
      ...(Array.isArray(tabs?.reactions) ? tabs.reactions : []).map((item) => ({
        id: String(item?.reactionId || ''),
        label: String(item?.value || ''),
        count: Math.max(0, Number(item?.count || 0))
      })).filter((item) => item.id)
    ];

    if (state.tab !== 'all' && !entries.some((entry) => entry.id === state.tab)) {
      const descriptor = window.FPReactionManager188?.get?.(state.roomId, state.messageId)?.reactions
        ?.find?.((item) => String(item.reactionId) === state.tab);
      entries.push({
        id: state.tab,
        label: String(descriptor?.value || state.tab),
        count: 0
      });
    }

    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `fp-reaction-details188-tab${entry.id === state.tab ? ' is-active' : ''}`;
      button.dataset.reactionId = entry.id;
      button.textContent = entry.id === 'all'
        ? `Все${entry.count ? ` ${entry.count}` : ''}`
        : `${entry.label} ${entry.count}`;
      button.addEventListener('click', () => {
        if (state.tab === entry.id || state.loading) return;
        state.tab = entry.id;
        void loadPage(state, { reset: true });
      });
      state.tabs.appendChild(button);
    }
  }

  function markStale(state) {
    if (!state || state.stale) return;
    state.stale = true;
    state.refresh.hidden = false;
    stats.stale += 1;
  }

  function requestUrl(state, { cursor = null, revision = null } = {}) {
    const params = new URLSearchParams({
      deviceId: state.deviceId,
      reactionId: state.tab || 'all'
    });
    if (cursor) params.set('cursor', cursor);
    if (revision != null) params.set('revision', String(revision));
    return `/api/rooms/${encodeURIComponent(state.roomId)}/messages/${state.messageId}/reactions/details?${params.toString()}`;
  }

  async function loadPage(state, { reset = false } = {}) {
    if (!state || active !== state || state.loading) return false;
    if (!reset && !state.hasMore) return false;

    if (reset) {
      state.controller?.abort?.('details-reset');
      state.cursor = null;
      state.revision = null;
      state.hasMore = true;
      state.stale = false;
      state.refresh.hidden = true;
      setStateMessage(state, 'Загрузка…');
    }

    const controller = new AbortController();
    state.controller = controller;
    state.loading = true;
    stats.requests += 1;

    const context = state.roomContext;
    const onRoomAbort = () => controller.abort(context?.signal?.reason || 'room-context-ended');
    if (context?.signal?.aborted) onRoomAbort();
    else context?.signal?.addEventListener?.('abort', onRoomAbort, { once: true });

    try {
      const response = await networkFetch(requestUrl(state, {
        cursor: reset ? null : state.cursor,
        revision: reset ? null : state.revision
      }), {
        cache: 'no-store',
        signal: controller.signal
      });
      const data = await response.json().catch(() => null);
      if (active !== state || controller.signal.aborted) return false;

      if (response.status === 409 && data?.code === 'REACTION_DETAILS_STALE') {
        markStale(state);
        return false;
      }
      if (!response.ok || !data?.ok) {
        if (reset) setStateMessage(state, 'Не удалось загрузить реакции.', 'error');
        stats.failures += 1;
        return false;
      }

      if (reset) {
        state.list.replaceChildren();
        state.list.scrollTop = 0;
      }

      state.revision = Math.max(0, Number(data.reactionRevision || 0) || 0);
      state.cursor = data.nextCursor || null;
      state.hasMore = data.hasMore === true;
      if (reset || !state.tabs.childElementCount) buildTabs(state, data.tabs);

      const rows = Array.isArray(data.rows) ? data.rows : [];
      if (!rows.length && reset) {
        setStateMessage(state, 'Здесь пока нет реакций.');
      } else {
        const oldState = state.list.querySelector('.fp-reaction-details188-state');
        if (oldState) oldState.remove();
        const oldMore = state.list.querySelector('.fp-reaction-details188-more');
        if (oldMore) oldMore.remove();
        const fragment = document.createDocumentFragment();
        rows.forEach((row) => fragment.appendChild(renderRow(state, row)));
        state.list.appendChild(fragment);
        stats.rows += rows.length;
      }

      state.list.querySelector('.fp-reaction-details188-more')?.remove();
      if (state.hasMore) {
        const more = document.createElement('div');
        more.className = 'fp-reaction-details188-more';
        more.textContent = 'Прокрутите ниже для загрузки';
        state.list.appendChild(more);
      }
      stats.pages += 1;
      return true;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        stats.failures += 1;
        if (reset && active === state) setStateMessage(state, 'Не удалось загрузить реакции.', 'error');
      }
      return false;
    } finally {
      context?.signal?.removeEventListener?.('abort', onRoomAbort);
      if (active === state && state.controller === controller) {
        state.loading = false;
        state.controller = null;
      }
    }
  }

  function createState({ roomId, messageId, reactionId }) {
    ensureStyle();

    const overlay = document.createElement('div');
    overlay.className = 'fp-reaction-details188-overlay';
    overlay.setAttribute('role', 'presentation');

    const sheet = document.createElement('section');
    sheet.className = 'fp-reaction-details188-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Реакции на сообщение');

    const head = document.createElement('div');
    head.className = 'fp-reaction-details188-head';

    const title = document.createElement('div');
    title.className = 'fp-reaction-details188-title';
    title.textContent = 'Реакции';

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'fp-reaction-details188-refresh';
    refresh.textContent = 'Обновить';
    refresh.hidden = true;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'fp-reaction-details188-close';
    closeButton.setAttribute('aria-label', 'Закрыть');
    closeButton.textContent = '×';

    const tabs = document.createElement('div');
    tabs.className = 'fp-reaction-details188-tabs';
    tabs.setAttribute('role', 'tablist');

    const list = document.createElement('div');
    list.className = 'fp-reaction-details188-list';

    head.append(title, refresh, closeButton);
    sheet.append(head, tabs, list);
    overlay.appendChild(sheet);

    const manager = window.FPReactionManager188;
    const deviceId = String(manager?.deviceIdForRoom?.(roomId) || '').trim();
    const roomContext = window.FPRoomContext170?.current?.() || null;

    const state = {
      roomId,
      messageId,
      tab: reactionId || 'all',
      deviceId,
      roomContext,
      overlay,
      sheet,
      tabs,
      list,
      refresh,
      closeButton,
      controller: null,
      cursor: null,
      revision: null,
      hasMore: true,
      loading: false,
      stale: false,
      roomAbortCleanup: null,
      onKey: null
    };

    state.onKey = (event) => {
      if (event.key !== 'Escape' || active !== state) return;
      event.preventDefault();
      close('escape');
    };

    closeButton.addEventListener('click', () => close('button'));
    refresh.addEventListener('click', () => {
      if (active === state) void loadPage(state, { reset: true });
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close('backdrop');
    });
    list.addEventListener('scroll', () => {
      if (active !== state || state.loading || !state.hasMore || state.stale) return;
      if (list.scrollHeight - list.clientHeight - list.scrollTop <= SCROLL_THRESHOLD_PX) {
        void loadPage(state);
      }
    }, { passive: true });

    if (roomContext?.signal) {
      const onAbort = () => {
        if (active === state) close('room-context');
      };
      roomContext.signal.addEventListener('abort', onAbort, { once: true });
      state.roomAbortCleanup = () => roomContext.signal.removeEventListener('abort', onAbort);
    } else {
      state.roomAbortCleanup = () => {};
    }

    return state;
  }

  function open({ roomId, messageId, reactionId = 'all' } = {}) {
    const room = String(roomId || '').trim();
    const message = numericId(messageId);
    const tab = String(reactionId || 'all').trim() || 'all';
    if (!room || !message) return false;

    const manager = window.FPReactionManager188;
    const deviceId = String(manager?.deviceIdForRoom?.(room) || '').trim();
    if (!deviceId) return false;

    const currentContext = window.FPRoomContext170?.current?.() || null;
    if (currentContext && String(currentContext.roomId || '') !== room) return false;

    close('replace');
    const state = createState({ roomId: room, messageId: message, reactionId: tab });
    active = state;
    document.body.appendChild(state.overlay);
    document.addEventListener('keydown', state.onKey, true);
    queueMicrotask(() => state.closeButton.focus({ preventScroll: true }));
    stats.opens += 1;
    void loadPage(state, { reset: true });
    return true;
  }

  window.addEventListener('fpchat:reaction188-changed', (event) => {
    const state = active;
    if (!state) return;
    const detail = event?.detail || {};
    if (String(detail.roomId || '') !== state.roomId || numericId(detail.messageId) !== state.messageId) return;
    // High-volume groups must not trigger one HTTP refresh per WS mutation.
    // Mark the current snapshot stale; user refresh or a stale page boundary reloads it.
    markStale(state);
  }, { passive: true });

  window.FPLifecycle170?.subscribe?.((event) => {
    if (active && ['background', 'pagehide', 'beforeunload'].includes(event?.lastType)) close('lifecycle');
  });

  ensureStyle();

  window.FPReactionDetails188 = Object.freeze({
    PAGE_SIZE,
    open,
    close,
    isOpen: () => Boolean(active),
    snapshot: () => ({
      owner: 'FPReactionDetails188',
      pageSize: PAGE_SIZE,
      open: Boolean(active),
      roomId: active?.roomId || null,
      messageId: active?.messageId || null,
      tab: active?.tab || null,
      revision: active?.revision ?? null,
      loading: Boolean(active?.loading),
      stale: Boolean(active?.stale),
      ...stats
    })
  });

  try {
    window.FPRuntime?.registerOwner?.('reaction-details188', {
      role: 'reaction-details-read-owner',
      mode: 'active-owner',
      pageSize: PAGE_SIZE,
      layerOwner: 'FPLayer173 via existing aria-modal contract',
      transportOwner: 'FPNetwork171',
      profileOwner: 'FPUsernameSearch143',
      owns: 'reaction details modal + 30-row keyset lazy read state only',
      mutationOwner: 'none'
    });
  } catch {}
})();
