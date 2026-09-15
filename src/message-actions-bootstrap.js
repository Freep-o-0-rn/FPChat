/* Build 165: inject isolated server feature layers plus canonical user-block guards. */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const target = path.resolve(__dirname, '..', 'server.js');
const originalJsLoader = Module._extensions['.js'];

Module._extensions['.js'] = function fpchatBuild165Loader(module, filename) {
  if (path.resolve(filename) !== target) return originalJsLoader(module, filename);

  Module._extensions['.js'] = originalJsLoader;

  let source = fs.readFileSync(filename, 'utf8');

  function replaceOnce(marker, replacement, label) {
    if (!source.includes(marker)) throw new Error(`FPChat Build 165 bootstrap: ${label} marker was not found`);
    source = source.replace(marker, replacement);
  }

  function replaceAllChecked(marker, replacement, expected, label) {
    const count = source.split(marker).length - 1;
    if (count !== expected) throw new Error(`FPChat Build 165 bootstrap: ${label} expected ${expected} markers, found ${count}`);
    source = source.split(marker).join(replacement);
  }

  replaceOnce(
    "const db = createDb(DATABASE_PATH);",
    "const db = createDb(DATABASE_PATH);\nconst fpUserBlocks165 = require('./src/user-blocks165').createUserBlocks165(db);",
    'database user-block initialization'
  );

  replaceOnce(
    "  if (message?.event_type === SYSTEM_LEFT) return `${actor} покинул комнату`;\n  return 'Системное событие';",
    "  if (message?.event_type === SYSTEM_LEFT) return `${actor} покинул комнату`;\n  if (String(message?.event_type || '').startsWith('blocked_invite_attempt:')) return `${actor} попытался войти по приглашению. Вход отклонён из-за блокировки.`;\n  return 'Системное событие';",
    'system event text'
  );

  const participantMap = `const participants = q.listParticipantsByRoom.all(room.id).map((item) => ({\n    deviceId: item.device_id,\n    displayName: item.display_name,\n    online: Boolean(item.online),\n    lastSeenAt: toIsoUtc(item.last_seen_at)\n  }));`;
  replaceAllChecked(
    participantMap,
    `const participants = q.listParticipantsByRoom.all(room.id).map((item) =>\n    fpUserBlocks165.participantPresenceDto(item, safeDeviceId, toIsoUtc)\n  );`,
    2,
    'participant presence response'
  );

  replaceOnce(
    `function broadcastPresenceUpdate(roomPublicId, payload) {\n  sendToRoomParticipants(roomPublicId, { type: 'presence:update', roomId: roomPublicId, ...payload });\n}`,
    `function broadcastPresenceUpdate(roomPublicId, payload) {\n  const room = q.findRoomByPublicId.get(roomPublicId);\n  if (!room || !payload?.deviceId) return;\n  const event = { type: 'presence:update', roomId: roomPublicId, ...payload };\n  for (const participant of q.listParticipantsByRoom.all(room.id)) {\n    if (!fpUserBlocks165.canViewerSeePresence(participant.device_id, payload.deviceId)) continue;\n    const sockets = socketsByDevice.get(participant.device_id);\n    if (!sockets) continue;\n    for (const client of sockets) sendWsJson(client, event);\n  }\n}`,
    'presence broadcaster'
  );

  replaceOnce(
    `  const sender = q.findParticipant.get(room.id, ws.deviceId);\n  if (!sender) return sendMessageRejected(ws, room, clientMessageId, 'forbidden', 'ACCESS_REVOKED');\n  if (!isRoomOpen(room)) return sendMessageRejected(ws, room, clientMessageId, 'room closed', 'ROOM_CLOSED');`,
    `  const sender = q.findParticipant.get(room.id, ws.deviceId);\n  if (!sender) return sendMessageRejected(ws, room, clientMessageId, 'forbidden', 'ACCESS_REVOKED');\n  if (!isRoomOpen(room)) return sendMessageRejected(ws, room, clientMessageId, 'room closed', 'ROOM_CLOSED');\n  const blockGuard165 = fpUserBlocks165.roomSendGuard(room.id, ws.deviceId);\n  if (!blockGuard165.ok) return sendMessageRejected(ws, room, clientMessageId, 'blocked', blockGuard165.code);`,
    'text message block guard'
  );

  replaceOnce(
    `      if (!isRoomOpen(room)) {\n        sendMessageRejected(ws, room, null, 'room closed', 'ROOM_CLOSED');\n        return;\n      }\n      const ciphertext = String(payload.ciphertext || '');`,
    `      if (!isRoomOpen(room)) {\n        sendMessageRejected(ws, room, null, 'room closed', 'ROOM_CLOSED');\n        return;\n      }\n      const blockGuard165 = fpUserBlocks165.roomSendGuard(room.id, ws.deviceId);\n      if (!blockGuard165.ok) {\n        sendMessageRejected(ws, room, null, 'blocked', blockGuard165.code);\n        return;\n      }\n      const ciphertext = String(payload.ciphertext || '');`,
    'legacy/media message block guard'
  );

  replaceOnce(
    `  const deviceId = String(req.body?.deviceId || '').slice(0, 64);\n  if (!q.findParticipant.get(room.id, deviceId)) return res.status(403).json({ ok: false, error: 'forbidden' });\n  if (!isRoomOpen(room)) return res.status(409).json({ ok: false, error: 'room closed', code: 'ROOM_CLOSED' });\n  const mimeType = String(req.body?.mimeType || '');`,
    `  const deviceId = String(req.body?.deviceId || '').slice(0, 64);\n  if (!q.findParticipant.get(room.id, deviceId)) return res.status(403).json({ ok: false, error: 'forbidden' });\n  if (!isRoomOpen(room)) return res.status(409).json({ ok: false, error: 'room closed', code: 'ROOM_CLOSED' });\n  const blockGuard165 = fpUserBlocks165.roomSendGuard(room.id, deviceId);\n  if (!blockGuard165.ok) return res.status(403).json({ ok: false, error: 'blocked', code: blockGuard165.code });\n  const mimeType = String(req.body?.mimeType || '');`,
    'media upload block guard'
  );

  replaceOnce(
    `  const safeDeviceId = String(deviceId).slice(0, 64);\n  const safeName = String(displayName).slice(0, 48);\n  if (!safeDeviceId) return res.status(400).json({ error: 'deviceId required' });\n  if (q.findParticipantAny.get(room.id, safeDeviceId)) return res.status(409).json({ error: 'device already belongs to room' });`,
    `  const safeDeviceId = String(deviceId).slice(0, 64);\n  const safeName = String(displayName).slice(0, 48);\n  if (!safeDeviceId) return res.status(400).json({ error: 'deviceId required' });\n  const inviteBlock165 = fpUserBlocks165.inviteGuard(room.id, safeDeviceId);\n  if (!inviteBlock165.ok) {\n    if (inviteBlock165.code === 'INVITE_BLOCKED_BY_CREATOR') {\n      const attempt165 = fpUserBlocks165.noteBlockedInviteAttempt({ roomId: room.id, inviteId: invite.id, joinerId: safeDeviceId, fallbackName: safeName });\n      if (attempt165.created && attempt165.row) {\n        const event165 = messageToDto(attempt165.row);\n        broadcastRoomMessage(room, event165, safeDeviceId);\n        broadcastUnreadState(room);\n        void sendPushForSystemEvent(room, event165);\n      }\n      return res.status(403).json({ ok: false, error: 'Вход недоступен: пользователь вас заблокировал.', code: inviteBlock165.code });\n    }\n    return res.status(403).json({ ok: false, error: 'Сначала разблокируйте пользователя.', code: inviteBlock165.code });\n  }\n  if (q.findParticipantAny.get(room.id, safeDeviceId)) return res.status(409).json({ error: 'device already belongs to room' });`,
    'invite block guard'
  );

  const marker = '\ncleanupExpiredSoloRooms();\nsetInterval(cleanupExpiredSoloRooms, 10 * 60 * 1000);\nserver.listen(APP_PORT, APP_HOST, () => console.log(`FPChat listening on http://${APP_HOST}:${APP_PORT}`));';
  if (!source.includes(marker)) {
    throw new Error('FPChat Build 165 bootstrap: server startup marker was not found');
  }

  const install = `\nrequire('./src/message-actions-server').installMessageActionsServer({\n  app,\n  db,\n  q,\n  socketsByDevice,\n  sendWsJson,\n  sendToRoomParticipants,\n  broadcastUnreadState,\n  toIsoUtc,\n  safeUnlink,\n  isRoomOpen,\n  roomStatePayload\n});\n\nrequire('./src/message-pins-server').installMessagePinsServer({\n  app,\n  db,\n  q,\n  socketsByDevice,\n  sendWsJson,\n  sendToRoomParticipants,\n  toIsoUtc,\n  isRoomOpen,\n  roomStatePayload\n});\n\nrequire('./src/typing-server').installTypingServer({\n  wss,\n  q,\n  sendToRoomParticipants,\n  isRoomOpen,\n  userBlocks: fpUserBlocks165\n});\n\nrequire('./src/username-server').installUsernameServer({\n  app,\n  db\n});\n\nrequire('./src/system-events-server').installSystemEventsServer({\n  app,\n  db\n});\n\nrequire('./src/user-blocks165').installUserBlocks165Server({\n  app,\n  db,\n  q,\n  socketsByDevice,\n  sendWsJson,\n  toIsoUtc,\n  userBlocks: fpUserBlocks165\n});\n\nrequire('./src/chat-requests-server147').installChatRequestsServer({\n  app,\n  db,\n  q,\n  isRoomOpen,\n  removeRoomCascade\n});\n\nrequire('./src/voice-server').installVoiceServer({\n  app,\n  db,\n  q,\n  upload,\n  UPLOAD_DIR,\n  fs,\n  path,\n  randomToken,\n  safeUnlink,\n  isRoomOpen,\n  userBlocks: fpUserBlocks165\n});\n`;

  source = source.replace(marker, `${install}${marker}`);
  module._compile(source, filename);
};
