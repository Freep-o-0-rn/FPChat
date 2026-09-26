/* Build 188.2: canonical client owner for bounded reaction state.
   No DOM ownership, no gesture ownership, no persistent cache and no offline queue. */
(() => {
  if (window.FPReactionManager188) return;

  const rooms = new Map();
  const loadedByRoom = new Map();
  const holds = new Map();
  let activeHistoryRoom = '';
  let catalogPromise = null;
  let catalogState = null;
  const stats = {
    ingested: 0,
    historyPages: 0,
    wsApplied: 0,
    wsIgnoredUnloaded: 0,
    staleIgnored: 0,
    released: 0,
    destroyed: 0,
    rangeSyncs: 0,
    catalogLoads: 0,
    catalogFailures: 0
  };

  function normalizeRoomId(value) {
    return String(value || '').trim();
  }

  function normalizeMessageId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function key(roomId, messageId) {
    const room = normalizeRoomId(roomId);
    const message = normalizeMessageId(messageId);
    return room && message ? `${room}:${message}` : '';
  }

  function roomFor(roomId, create = true) {
    const id = normalizeRoomId(roomId);
    if (!id) return null;
    let room = rooms.get(id);
    if (!room && create) {
      room = new Map();
      rooms.set(id, room);
    }
    return room || null;
  }

  function cleanReaction(item, mineOverride = null) {
    const reactionId = String(item?.reactionId || '').trim();
    if (!reactionId) return null;
    const count = Math.max(0, Number(item?.count || 0) || 0);
    const preview = Array.isArray(item?.previewParticipantIds)
      ? item.previewParticipantIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 2)
      : [];
    const mine = mineOverride === null ? item?.mine === true : Boolean(mineOverride);
    return Object.freeze({
      reactionId,
      type: String(item?.type || 'emoji'),
      value: String(item?.value || ''),
      count,
      mine,
      ...(count <= 2 ? { previewParticipantIds: Object.freeze(preview) } : {})
    });
  }

  function cleanMyReaction(item) {
    const reactionId = String(item?.reactionId || '').trim();
    if (!reactionId) return null;
    return Object.freeze({
      reactionId,
      type: String(item?.type || 'emoji'),
      value: String(item?.value || ''),
      createdAt: item?.createdAt || null
    });
  }

  function normalizePayload(payload, mineIds = null) {
    const revision = Math.max(0, Number(payload?.reactionRevision || 0) || 0);
    const mineSet = mineIds instanceof Set ? mineIds : null;
    const reactions = (Array.isArray(payload?.reactions) ? payload.reactions : [])
      .map((item) => cleanReaction(item, mineSet ? mineSet.has(String(item?.reactionId || '')) : null))
      .filter(Boolean);
    const myReactions = (Array.isArray(payload?.myReactions) ? payload.myReactions : []).map(cleanMyReaction).filter(Boolean);
    return Object.freeze({
      reactionRevision: revision,
      reactions: Object.freeze(reactions),
      myReactions: Object.freeze(myReactions),
      catalogVersion: Math.max(0, Number(payload?.catalogVersion || 0) || 0)
    });
  }

  function applyAuthoritative(roomId, messageId, payload, options = {}) {
    const room = roomFor(roomId, true);
    const id = normalizeMessageId(messageId);
    if (!room || !id) return null;
    const next = normalizePayload(payload, options.mineIds instanceof Set ? options.mineIds : null);
    const current = room.get(id);
    if (current && next.reactionRevision < current.reactionRevision) {
      stats.staleIgnored += 1;
      return current;
    }
    room.set(id, next);
    stats.ingested += 1;
    try {
      window.dispatchEvent(new CustomEvent('fpchat:reaction188-changed', {
        detail: { roomId: normalizeRoomId(roomId), messageId: id, reactionRevision: next.reactionRevision }
      }));
    } catch {}
    return next;
  }

  function get(roomId, messageId) {
    const room = roomFor(roomId, false);
    const id = normalizeMessageId(messageId);
    return room && id ? room.get(id) || null : null;
  }

  function isLoaded(roomId, messageId) {
    const room = normalizeRoomId(roomId);
    const id = normalizeMessageId(messageId);
    return Boolean(room && id && loadedByRoom.get(room)?.has(id));
  }

  function hold(roomId, messageId, reason = 'feature') {
    const holdKey = key(roomId, messageId);
    if (!holdKey) return () => {};
    let set = holds.get(holdKey);
    if (!set) holds.set(holdKey, set = new Set());
    const token = `${String(reason || 'feature')}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
    set.add(token);
    return () => {
      const current = holds.get(holdKey);
      if (!current) return;
      current.delete(token);
      if (!current.size) holds.delete(holdKey);
    };
  }

  function canRelease(roomId, messageId) {
    const holdKey = key(roomId, messageId);
    if (!holdKey) return true;
    if (holds.get(holdKey)?.size) return false;
    return !window.FPReactionArbiter188?.hasPending?.(roomId, messageId);
  }

  function releaseMessage(roomId, messageId) {
    const room = roomFor(roomId, false);
    const id = normalizeMessageId(messageId);
    if (!room || !id || !canRelease(roomId, id)) return false;
    const removed = room.delete(id);
    if (removed) stats.released += 1;
    if (!room.size) rooms.delete(normalizeRoomId(roomId));
    return removed;
  }

  function releaseInactiveHistoryRooms(keepRoomId) {
    const keep = normalizeRoomId(keepRoomId);
    for (const roomId of [...loadedByRoom.keys()]) {
      if (roomId === keep) continue;
      loadedByRoom.delete(roomId);
      const room = roomFor(roomId, false);
      if (!room) continue;
      for (const messageId of [...room.keys()]) {
        if (canRelease(roomId, messageId) && room.delete(messageId)) stats.released += 1;
      }
      if (!room.size) rooms.delete(roomId);
    }
  }

  function syncHistoryRange(roomId, loadedMessageIds) {
    const id = normalizeRoomId(roomId);
    if (!id) return 0;
    const keep = new Set((loadedMessageIds || []).map(Number).filter((value) => Number.isSafeInteger(value) && value > 0));
    activeHistoryRoom = id;
    releaseInactiveHistoryRooms(id);
    loadedByRoom.set(id, keep);
    stats.rangeSyncs += 1;

    const room = roomFor(id, false);
    if (!room) return 0;
    let released = 0;
    for (const messageId of [...room.keys()]) {
      if (keep.has(messageId) || !canRelease(id, messageId)) continue;
      room.delete(messageId);
      released += 1;
    }
    stats.released += released;
    if (!room.size) rooms.delete(id);
    return released;
  }

  function ingestHistoryPage(roomId, summaries, { messageIds = null } = {}) {
    const id = normalizeRoomId(roomId);
    if (!id) return 0;
    const allowed = Array.isArray(messageIds)
      ? new Set(messageIds.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))
      : null;
    let applied = 0;
    for (const summary of Array.isArray(summaries) ? summaries : []) {
      const messageId = normalizeMessageId(summary?.messageId);
      if (!messageId || (allowed && !allowed.has(messageId))) continue;
      applyAuthoritative(id, messageId, summary);
      applied += 1;
    }
    stats.historyPages += 1;
    return applied;
  }

  function mineFromCurrent(current) {
    return new Set((current?.myReactions || []).map((item) => String(item.reactionId || '')).filter(Boolean));
  }

  function participantOwnStateFromWs(payload, current, viewerParticipantId) {
    const viewer = Number(viewerParticipantId);
    const changed = Number(payload?.changedParticipantId);
    if (!Number.isSafeInteger(viewer) || viewer <= 0 || changed !== viewer) {
      return {
        ids: mineFromCurrent(current),
        items: Array.isArray(current?.myReactions) ? [...current.myReactions] : []
      };
    }

    const ids = new Set((Array.isArray(payload?.changedParticipantReactions) ? payload.changedParticipantReactions : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean));
    const previous = new Map((current?.myReactions || []).map((item) => [String(item.reactionId), item]));
    const reactionRows = new Map((Array.isArray(payload?.reactions) ? payload.reactions : []).map((item) => [String(item?.reactionId || ''), item]));
    const items = [...ids].map((reactionId) => {
      const old = previous.get(reactionId);
      const row = reactionRows.get(reactionId);
      const catalogItem = catalogState?.byId?.get?.(reactionId) || null;
      return {
        reactionId,
        type: String(row?.type || old?.type || catalogItem?.type || 'emoji'),
        value: String(row?.value || old?.value || catalogItem?.value || ''),
        createdAt: old?.createdAt || null
      };
    });
    return { ids, items };
  }

  function ingestWs(payload, viewerParticipantId = null) {
    if (payload?.type !== 'reaction:update') return false;
    const roomId = normalizeRoomId(payload.roomId);
    const messageId = normalizeMessageId(payload.messageId);
    if (!roomId || !messageId) return true;

    const holdKey = key(roomId, messageId);
    const retained = isLoaded(roomId, messageId)
      || Boolean(holds.get(holdKey)?.size)
      || Boolean(window.FPReactionArbiter188?.hasPending?.(roomId, messageId));
    if (!retained) {
      stats.wsIgnoredUnloaded += 1;
      return true;
    }

    const current = get(roomId, messageId);
    const own = participantOwnStateFromWs(payload, current, viewerParticipantId);
    const next = {
      reactionRevision: Math.max(0, Number(payload.reactionRevision || 0) || 0),
      reactions: Array.isArray(payload.reactions) ? payload.reactions : [],
      myReactions: own.items,
      catalogVersion: Math.max(0, Number(payload.catalogVersion || current?.catalogVersion || 0) || 0)
    };
    applyAuthoritative(roomId, messageId, next, { mineIds: own.ids });
    stats.wsApplied += 1;
    return true;
  }

  function destroyMessage(roomId, messageId) {
    window.FPReactionArbiter188?.cancelMessage?.(roomId, messageId, 'MESSAGE_DELETED');
    holds.delete(key(roomId, messageId));
    loadedByRoom.get(normalizeRoomId(roomId))?.delete(normalizeMessageId(messageId));
    const room = roomFor(roomId, false);
    const id = normalizeMessageId(messageId);
    const removed = Boolean(room && id && room.delete(id));
    if (removed) stats.destroyed += 1;
    if (room && !room.size) rooms.delete(normalizeRoomId(roomId));
    return removed;
  }

  function releaseRoom(roomId) {
    const id = normalizeRoomId(roomId);
    if (!id) return;
    window.FPReactionArbiter188?.cancelRoom?.(id, 'REACTION_ROOM_CANCELLED');
    rooms.delete(id);
    loadedByRoom.delete(id);
    if (activeHistoryRoom === id) activeHistoryRoom = '';
    for (const holdKey of [...holds.keys()]) if (holdKey.startsWith(`${id}:`)) holds.delete(holdKey);
  }

  async function loadCatalog() {
    if (catalogState) return catalogState;
    if (catalogPromise) return catalogPromise;
    stats.catalogLoads += 1;
    catalogPromise = (async () => {
      try {
        const response = await fetch('/api/reactions/catalog', { cache: 'no-store' });
        if (!response.ok) throw new Error(`catalog ${response.status}`);
        const data = await response.json();
        const reactions = Array.isArray(data?.reactions) ? data.reactions.map((item) => Object.freeze({ ...item })) : [];
        const byId = new Map(reactions.map((item) => [String(item.id), item]));
        const quick = reactions.filter((item) => item.enabled !== false && Number.isSafeInteger(Number(item.quickOrder)))
          .sort((a, b) => Number(a.quickOrder) - Number(b.quickOrder) || String(a.id).localeCompare(String(b.id)));
        catalogState = Object.freeze({
          version: Math.max(0, Number(data?.version || 0) || 0),
          maxPerParticipantPerMessage: Math.max(1, Number(data?.maxPerParticipantPerMessage || 3) || 3),
          quickLimit: Math.max(1, Number(data?.quickLimit || 7) || 7),
          reactions: Object.freeze(reactions),
          quick: Object.freeze(quick),
          byId
        });
        return catalogState;
      } catch (error) {
        stats.catalogFailures += 1;
        catalogPromise = null;
        throw error;
      }
    })();
    return catalogPromise;
  }

  async function getQuickReactions() {
    return (await loadCatalog()).quick;
  }

  async function getAvailableReactions() {
    return (await loadCatalog()).reactions.filter((item) => item.enabled !== false);
  }

  function loadedMessageIds(roomId = activeHistoryRoom) {
    return [...(loadedByRoom.get(normalizeRoomId(roomId)) || [])];
  }

  function snapshot() {
    let messages = 0;
    for (const room of rooms.values()) messages += room.size;
    let loaded = 0;
    for (const ids of loadedByRoom.values()) loaded += ids.size;
    return {
      owner: 'FPReactionManager188',
      activeHistoryRoom: activeHistoryRoom || null,
      rooms: rooms.size,
      messages,
      loaded,
      holds: holds.size,
      catalogLoaded: Boolean(catalogState),
      catalogVersion: catalogState?.version || 0,
      stats: { ...stats }
    };
  }

  window.FPReactionManager188 = Object.freeze({
    applyAuthoritative,
    ingestHistoryPage,
    ingestWs,
    get,
    isLoaded,
    loadedMessageIds,
    hold,
    releaseMessage,
    syncHistoryRange,
    destroyMessage,
    releaseRoom,
    loadCatalog,
    getQuickReactions,
    getAvailableReactions,
    snapshot
  });

  const register = () => {
    try {
      window.FPRuntime?.registerOwner?.('reaction-manager188', {
        role: 'reaction-state-owner',
        mode: 'active-owner',
        cache: 'RAM only; bounded by FPHistory174 mounted numeric IDs',
        owns: 'reaction summary/my-reactions/revision; no DOM/gesture/transport'
      });
    } catch {}
  };
  register();
  window.addEventListener?.('fpchat:boot-ready', register, { once: true, passive: true });

  try { window.dispatchEvent(new CustomEvent('fpchat:reaction188-ready')); } catch {}
  queueMicrotask(() => {
    try { window.FPHistory174?.syncReactionRange?.(); } catch {}
  });
})();
