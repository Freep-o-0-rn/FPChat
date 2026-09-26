/* Build 188.1: canonical client owner for reaction summary state.
   No DOM ownership, no gesture ownership, no persistent cache and no offline queue. */
(() => {
  if (window.FPReactionManager188) return;

  const rooms = new Map();
  const holds = new Map();
  let catalogPromise = null;
  let catalogState = null;
  const stats = { ingested: 0, staleIgnored: 0, released: 0, destroyed: 0, catalogLoads: 0, catalogFailures: 0 };

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

  function cleanReaction(item) {
    const reactionId = String(item?.reactionId || '').trim();
    if (!reactionId) return null;
    const count = Math.max(0, Number(item?.count || 0) || 0);
    const preview = Array.isArray(item?.previewParticipantIds)
      ? item.previewParticipantIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 2)
      : [];
    return Object.freeze({
      reactionId,
      type: String(item?.type || 'emoji'),
      value: String(item?.value || ''),
      count,
      mine: item?.mine === true,
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

  function normalizePayload(payload) {
    const revision = Math.max(0, Number(payload?.reactionRevision || 0) || 0);
    const reactions = (Array.isArray(payload?.reactions) ? payload.reactions : []).map(cleanReaction).filter(Boolean);
    const myReactions = (Array.isArray(payload?.myReactions) ? payload.myReactions : []).map(cleanMyReaction).filter(Boolean);
    return Object.freeze({
      reactionRevision: revision,
      reactions: Object.freeze(reactions),
      myReactions: Object.freeze(myReactions),
      catalogVersion: Math.max(0, Number(payload?.catalogVersion || 0) || 0)
    });
  }

  function applyAuthoritative(roomId, messageId, payload) {
    const room = roomFor(roomId, true);
    const id = normalizeMessageId(messageId);
    if (!room || !id) return null;
    const next = normalizePayload(payload);
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

  function hold(roomId, messageId, reason = 'feature') {
    const holdKey = key(roomId, messageId);
    if (!holdKey) return () => {};
    let set = holds.get(holdKey);
    if (!set) holds.set(holdKey, set = new Set());
    const token = `${String(reason || 'feature')}:${crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
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

  function syncHistoryRange(roomId, loadedMessageIds) {
    const room = roomFor(roomId, false);
    if (!room) return 0;
    const keep = new Set((loadedMessageIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0));
    let released = 0;
    for (const id of [...room.keys()]) {
      if (keep.has(id) || !canRelease(roomId, id)) continue;
      room.delete(id);
      released += 1;
    }
    stats.released += released;
    if (!room.size) rooms.delete(normalizeRoomId(roomId));
    return released;
  }

  function destroyMessage(roomId, messageId) {
    window.FPReactionArbiter188?.cancelMessage?.(roomId, messageId, 'MESSAGE_DELETED');
    holds.delete(key(roomId, messageId));
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

  function snapshot() {
    let messages = 0;
    for (const room of rooms.values()) messages += room.size;
    return {
      owner: 'FPReactionManager188',
      rooms: rooms.size,
      messages,
      holds: holds.size,
      catalogLoaded: Boolean(catalogState),
      catalogVersion: catalogState?.version || 0,
      stats: { ...stats }
    };
  }

  window.FPReactionManager188 = Object.freeze({
    applyAuthoritative,
    get,
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
        cache: 'RAM only; bounded by history lifecycle',
        owns: 'reaction summary/my-reactions/revision; no DOM/gesture/transport'
      });
    } catch {}
  };
  register();
  window.addEventListener?.('fpchat:boot-ready', register, { once: true, passive: true });
})();
