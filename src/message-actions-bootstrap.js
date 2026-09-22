/* Build 168: inject isolated server feature layers plus canonical user-block guards. */
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
    `  const safeDeviceId = String(deviceId).slice(0, 64);\n  const safeName = String(displayName).slice(0, 48);\n  if (!safeDeviceId) return res.status(400).json({ error: 'deviceId required' });\n  if (q.findParticipantAny.get(room.id, safeDeviceId)) return res.status(409).json({ error: 'device already belongs to room' });`,
    `  const safeDeviceId = String(deviceId).slice(0, 64);\n  const safeName = String(displayName).slice(0, 48);\n  if (!safeDeviceId) return res.status(400).json({ error: 'deviceId required' });\n  const inviteBlock165 = fpUserBlocks165.inviteGuard(room.id, safeDeviceId);\n  if (!inviteBlock165.ok) {\n    if (inviteBlock165.code === 'INVITE_BLOCKED_BY_CREATOR') {\n      try {\n        fpBlockedInviteEvents165.note({ roomId: room.id, joinerId: safeDeviceId, fallbackName: safeName });\n      } catch (error) {\n        console.error('Blocked invite system event failed', error);\n      }\n      return res.status(403).json({ ok: false, error: 'Вход недоступен: пользователь вас заблокировал.', code: inviteBlock165.code });\n    }\n    return res.status(403).json({ ok: false, error: 'Сначала разблокируйте пользователя.', code: inviteBlock165.code });\n  }\n  if (q.findParticipantAny.get(room.id, safeDeviceId)) return res.status(409).json({ error: 'device already belongs to room' });`,
    'invite block guard'
  );

  const marker = '\ncleanupExpiredSoloRooms();\nsetInterval(cleanupExpiredSoloRooms, 10 * 60 * 1000);\nserver.listen(APP_PORT, APP_HOST, () => console.log(`FPChat listening on http://${APP_HOST}:${APP_PORT}`));';
  if (!source.includes(marker)) {
    throw new Error('FPChat Build 165 bootstrap: server startup marker was not found');
  }

  const install = `\nrequire('./src/typing-server').installTypingServer({\n  wss,\n  q,\n  sendToRoomParticipants,\n  isRoomOpen,\n  userBlocks: fpUserBlocks165\n});\n\nrequire('./src/username-server').installUsernameServer({\n  app,\n  db\n});\n\nrequire('./src/system-events-server').installSystemEventsServer({\n  app,\n  db\n});\n\nrequire('./src/storage-stats168').installStorageStats168({\n  app,\n  db\n});\n\nrequire('./src/user-blocks165').installUserBlocks165Server({\n  app,\n  db,\n  q,\n  socketsByDevice,\n  sendWsJson,\n  toIsoUtc,\n  userBlocks: fpUserBlocks165\n});\n\nrequire('./src/user-block-event-actions165').installUserBlockEventActions165({\n  app,\n  userBlocks: fpUserBlocks165\n});\n\nrequire('./src/chat-requests-server147').installChatRequestsServer({\n  app,\n  db,\n  q,\n  isRoomOpen,\n  removeRoomCascade\n});\n\nrequire('./src/voice-server').installVoiceServer({\n  app,\n  db,\n  q,\n  upload,\n  UPLOAD_DIR,\n  fs,\n  path,\n  randomToken,\n  safeUnlink,\n  isRoomOpen,\n  userBlocks: fpUserBlocks165\n});\n`;

  source = source.replace(marker, `${install}${marker}`);
  module._compile(source, filename);
};
