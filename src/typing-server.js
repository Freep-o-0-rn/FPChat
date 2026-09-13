/* Build 120: transient typing, media-upload and voice activity transport. No persistence. */
function installTypingServer({ wss, q, sendToRoomParticipants, isRoomOpen }) {
  if (!wss || !q || !sendToRoomParticipants) throw new Error('typing server dependencies are missing');
  if (wss.__fpTypingInstalled) return;
  wss.__fpTypingInstalled = true;

  const TIMEOUT_MS = 7000;
  const rooms = new Map();
  const allowedActivities = new Set(['typing', 'photo', 'video', 'media', 'recording_audio', 'audio']);

  function getRoomMap(roomPublicId) {
    let roomMap = rooms.get(roomPublicId);
    if (!roomMap) {
      roomMap = new Map();
      rooms.set(roomPublicId, roomMap);
    }
    return roomMap;
  }

  function safeActivity(value, fallback = '') {
    const activity = String(value || '');
    if (allowedActivities.has(activity)) return activity;
    return fallback;
  }

  function broadcast(roomPublicId, deviceId, displayName, activity = '') {
    sendToRoomParticipants(roomPublicId, {
      type: 'typing:update',
      roomId: roomPublicId,
      deviceId,
      displayName: displayName || '',
      typing: Boolean(activity),
      activity: activity || null
    }, deviceId);
  }

  function cleanupEntry(roomPublicId, deviceId, entry, emitStop) {
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    const roomMap = rooms.get(roomPublicId);
    roomMap?.delete(deviceId);
    if (roomMap && roomMap.size === 0) rooms.delete(roomPublicId);
    if (emitStop) broadcast(roomPublicId, deviceId, entry.displayName, '');
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

  function startActivity(ws, room, participant, activity) {
    if (!room || !participant || !activity || !isRoomOpen?.(room)) return;
    if (ws.visible !== true || ws.activeRoomId !== room.public_id) return;

    const roomMap = getRoomMap(room.public_id);
    let entry = roomMap.get(ws.deviceId);
    if (!entry) {
      entry = { displayName: participant.display_name || '', sockets: new Set(), timer: null, activity };
      roomMap.set(ws.deviceId, entry);
    }
    entry.displayName = participant.display_name || entry.displayName || '';
    entry.activity = activity;
    entry.sockets.add(ws);
    armTimeout(room.public_id, ws.deviceId, entry);

    // Every heartbeat also refreshes the peer's client-side TTL.
    broadcast(room.public_id, ws.deviceId, entry.displayName, activity);
  }

  function stopActivitySocket(ws, roomPublicId, expectedActivity = '') {
    const roomMap = rooms.get(roomPublicId);
    const entry = roomMap?.get(ws.deviceId);
    if (!entry) return;
    if (expectedActivity && entry.activity !== expectedActivity) return;
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
      stopActivitySocket(ws, roomPublicId);
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
        if (targetRoom) stopActivitySocket(ws, targetRoom);
        return;
      }

      const isStart = payload.type === 'typing:start' || payload.type === 'activity:start';
      const isStop = payload.type === 'typing:stop' || payload.type === 'activity:stop';
      if (!isStart && !isStop) return;

      const roomPublicId = String(payload.roomId || '').slice(0, 64);
      if (!roomPublicId) return;
      const room = q.findRoomByPublicId.get(roomPublicId);
      if (!room) return;
      const participant = q.findParticipant.get(room.id, ws.deviceId);
      if (!participant) return;

      if (isStart) {
        const activity = payload.type === 'typing:start'
          ? 'typing'
          : safeActivity(payload.activity);
        if (activity) startActivity(ws, room, participant, activity);
        return;
      }

      const expectedActivity = payload.type === 'typing:stop'
        ? 'typing'
        : safeActivity(payload.activity);
      stopActivitySocket(ws, roomPublicId, expectedActivity);
    };

    ws.on('message', onMessage);
    ws.on('close', () => stopAllForSocket(ws));
  });
}

module.exports = { installTypingServer };
