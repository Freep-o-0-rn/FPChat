/* Build 116: transient typing indicator transport. No persistence. */
function installTypingServer({ wss, q, sendToRoomParticipants, isRoomOpen }) {
  if (!wss || !q || !sendToRoomParticipants) throw new Error('typing server dependencies are missing');
  if (wss.__fpTypingInstalled) return;
  wss.__fpTypingInstalled = true;

  const TIMEOUT_MS = 5000;
  const rooms = new Map();

  function getRoomMap(roomPublicId) {
    let roomMap = rooms.get(roomPublicId);
    if (!roomMap) {
      roomMap = new Map();
      rooms.set(roomPublicId, roomMap);
    }
    return roomMap;
  }

  function broadcast(roomPublicId, deviceId, displayName, typing) {
    sendToRoomParticipants(roomPublicId, {
      type: 'typing:update',
      roomId: roomPublicId,
      deviceId,
      displayName: displayName || '',
      typing: typing === true
    }, deviceId);
  }

  function cleanupEntry(roomPublicId, deviceId, entry, emitStop) {
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    const roomMap = rooms.get(roomPublicId);
    roomMap?.delete(deviceId);
    if (roomMap && roomMap.size === 0) rooms.delete(roomPublicId);
    if (emitStop) broadcast(roomPublicId, deviceId, entry.displayName, false);
  }

  function armTimeout(roomPublicId, deviceId, entry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      const roomMap = rooms.get(roomPublicId);
      const current = roomMap?.get(deviceId);
      if (current !== entry) return;
      cleanupEntry(roomPublicId, deviceId, entry, true);
    }, TIMEOUT_MS);
    entry.timer.unref?.();
  }

  function startTyping(ws, room, participant) {
    if (!room || !participant || !isRoomOpen?.(room)) return;
    if (ws.visible !== true || ws.activeRoomId !== room.public_id) return;

    const roomMap = getRoomMap(room.public_id);
    let entry = roomMap.get(ws.deviceId);
    const wasTyping = Boolean(entry?.sockets?.size);
    if (!entry) {
      entry = { displayName: participant.display_name || '', sockets: new Set(), timer: null };
      roomMap.set(ws.deviceId, entry);
    }
    entry.displayName = participant.display_name || entry.displayName || '';
    entry.sockets.add(ws);
    armTimeout(room.public_id, ws.deviceId, entry);
    if (!wasTyping) broadcast(room.public_id, ws.deviceId, entry.displayName, true);
  }

  function stopTypingSocket(ws, roomPublicId) {
    const roomMap = rooms.get(roomPublicId);
    const entry = roomMap?.get(ws.deviceId);
    if (!entry) return;
    entry.sockets.delete(ws);
    if (entry.sockets.size > 0) {
      armTimeout(roomPublicId, ws.deviceId, entry);
      return;
    }
    cleanupEntry(roomPublicId, ws.deviceId, entry, true);
  }

  function stopAllForSocket(ws, exceptRoomId = null) {
    for (const [roomPublicId, roomMap] of rooms) {
      const entry = roomMap.get(ws.deviceId);
      if (!entry || !entry.sockets.has(ws) || roomPublicId === exceptRoomId) continue;
      stopTypingSocket(ws, roomPublicId);
    }
  }

  wss.on('connection', (ws) => {
    const onMessage = (raw) => {
      let payload;
      try { payload = JSON.parse(raw.toString()); } catch { return; }
      if (!payload || typeof payload !== 'object') return;

      if (payload.type === 'client:state') {
        const activeRoomId = payload.visible === true && typeof payload.activeRoomId === 'string'
          ? payload.activeRoomId.slice(0, 64)
          : null;
        stopAllForSocket(ws, activeRoomId);
        return;
      }

      if (payload.type === 'message:send' || payload.type === 'message:new') {
        const targetRoom = String(payload.roomId || '').slice(0, 64);
        if (targetRoom) stopTypingSocket(ws, targetRoom);
        return;
      }

      if (payload.type !== 'typing:start' && payload.type !== 'typing:stop') return;
      const roomPublicId = String(payload.roomId || '').slice(0, 64);
      if (!roomPublicId) return;
      const room = q.findRoomByPublicId.get(roomPublicId);
      if (!room) return;
      const participant = q.findParticipant.get(room.id, ws.deviceId);
      if (!participant) return;

      if (payload.type === 'typing:start') startTyping(ws, room, participant);
      else stopTypingSocket(ws, roomPublicId);
    };

    ws.on('message', onMessage);
    ws.on('close', () => stopAllForSocket(ws));
  });
}

module.exports = { installTypingServer };
