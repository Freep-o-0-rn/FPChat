/* Build 108: inject the isolated message-actions server layer without rewriting server.js. */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const target = path.resolve(__dirname, '..', 'server.js');
const originalJsLoader = Module._extensions['.js'];

Module._extensions['.js'] = function fpchatBuild108Loader(module, filename) {
  if (path.resolve(filename) !== target) return originalJsLoader(module, filename);

  // Restore Node's normal loader before compiling server.js so all of its own
  // dependencies load exactly as they did before Build 108.
  Module._extensions['.js'] = originalJsLoader;

  let source = fs.readFileSync(filename, 'utf8');
  const marker = '\ncleanupExpiredSoloRooms();\nsetInterval(cleanupExpiredSoloRooms, 10 * 60 * 1000);\nserver.listen(APP_PORT, APP_HOST, () => console.log(`FPChat listening on http://${APP_HOST}:${APP_PORT}`));';
  if (!source.includes(marker)) {
    throw new Error('FPChat Build 108 bootstrap: server.js startup marker was not found');
  }

  const install = `\nrequire('./src/message-actions-server').installMessageActionsServer({\n  app,\n  db,\n  q,\n  socketsByDevice,\n  sendWsJson,\n  sendToRoomParticipants,\n  broadcastUnreadState,\n  toIsoUtc,\n  safeUnlink,\n  isRoomOpen,\n  roomStatePayload\n});\n`;

  source = source.replace(marker, `${install}${marker}`);
  module._compile(source, filename);
};
