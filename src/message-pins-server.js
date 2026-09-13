/* Build 112: isolated hybrid message pins server layer. */
function installMessagePinsServer({
  app,
  db,
  q,
  socketsByDevice,
  sendWsJson,
  sendToRoomParticipants,
  toIsoUtc,
  isRoomOpen,
  roomStatePayload
}) {
  if (!app || !db || !q) throw new Error('message pins server dependencies are missing');

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_pins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('shared','personal')),
      owner_device_id TEXT NOT NULL DEFAULT '',
      pinned_by_device_id TEXT NOT NULL,
      pinned_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, message_id, scope, owner_device_id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_pins_room ON message_pins(room_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_message_pins_owner ON message_pins(room_id, owner_device_id, scope);
    CREATE TRIGGER IF NOT EXISTS trg_message_pins_deleted_all
      AFTER UPDATE OF deleted_for_all ON messages
      WHEN NEW.deleted_for_all = 1
      BEGIN
        DELETE FROM message_pins WHERE room_id = NEW.room_id AND message_id = NEW.id;
      END;
    CREATE TRIGGER IF NOT EXISTS trg_message_pins_message_deleted
      AFTER DELETE ON messages
      BEGIN
        DELETE FROM message_pins WHERE room_id = OLD.room_id AND message_id = OLD.id;
      END;
  `);

  const findParticipant = db.prepare('SELECT * FROM participants WHERE room_id=? AND device_id=? AND access_revoked=0');
  const findMessage = db.prepare(`
    SELECT m.id, m.type, m.client_message_id, m.ciphertext, m.iv, m.reply_to_message_id,
           m.status, m.event_type, m.event_actor_name, m.created_at, m.delivered_at, m.read_at,
           m.edited_at, m.deleted_for_all, m.deleted_at,
           p.display_name AS sender_name, p.device_id AS sender_device_id
      FROM messages m
      JOIN participants p ON p.id = m.sender_id
     WHERE m.id=? AND m.room_id=?
  `);
  const listAccessiblePins = db.prepare(`
    SELECT pin.id AS pin_id, pin.message_id, pin.scope, pin.owner_device_id,
           pin.pinned_by_device_id, pin.pinned_at,
           m.type, m.client_message_id, m.ciphertext, m.iv, m.reply_to_message_id,
           m.status, m.event_type, m.event_actor_name, m.created_at, m.delivered_at, m.read_at,
           m.edited_at, m.deleted_for_all, m.deleted_at,
           p.display_name AS sender_name, p.device_id AS sender_device_id
      FROM message_pins pin
      JOIN messages m ON m.id=pin.message_id AND m.room_id=pin.room_id
      JOIN participants p ON p.id=m.sender_id
     WHERE pin.room_id=?
       AND (pin.scope='shared' OR (pin.scope='personal' AND pin.owner_device_id=?))
       AND COALESCE(m.deleted_for_all,0)=0
       AND m.type!='system'
       AND NOT EXISTS (
         SELECT 1 FROM message_hidden h
          WHERE h.room_id=m.room_id AND h.message_id=m.id AND h.device_id=?
       )
     ORDER BY m.id ASC, pin.id ASC
  `);
  const findPin = db.prepare('SELECT * FROM message_pins WHERE room_id=? AND message_id=? AND scope=? AND owner_device_id=?');
  const createPin = db.prepare(`
    INSERT OR IGNORE INTO message_pins
      (room_id, message_id, scope, owner_device_id, pinned_by_device_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const touchPin = db.prepare(`
    UPDATE message_pins SET pinned_by_device_id=?, pinned_at=datetime('now')
     WHERE room_id=? AND message_id=? AND scope=? AND owner_device_id=?
  `);
  const removePin = db.prepare('DELETE FROM message_pins WHERE room_id=? AND message_id=? AND scope=? AND owner_device_id=?');
  const removePinsByScope = db.prepare('DELETE FROM message_pins WHERE room_id=? AND scope=? AND owner_device_id=?');
  const isHidden = db.prepare('SELECT 1 AS yes FROM message_hidden WHERE room_id=? AND message_id=? AND device_id=?');

  function safeDevice(value) {
    return String(value || '').trim().slice(0, 64);
  }

  function safeMessageId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function safeScope(value) {
    return value === 'personal' ? 'personal' : value === 'shared' ? 'shared' : null;
  }

  function authorize(req, res) {
    const room = q.findRoomByPublicId.get(String(req.params.publicId || ''));
    if (!room) {
      res.status(404).json({ ok: false, error: 'room not found' });
      return null;
    }
    const deviceId = safeDevice(req.body?.deviceId || req.query?.deviceId);
    if (!deviceId) {
      res.status(400).json({ ok: false, error: 'deviceId required' });
      return null;
    }
    const participant = findParticipant.get(room.id, deviceId);
    if (!participant) {
      res.status(403).json({ ok: false, error: 'forbidden', code: 'ACCESS_REVOKED' });
      return null;
    }
    return { room, deviceId, participant };
  }

  function mediaForMessage(messageId) {
    if (!q.listMediaByMessageId) return [];
    return q.listMediaByMessageId.all(messageId).map((media) => ({
      ...media,
      thumbnail_url: `/api/media/${media.public_id}/thumb`
    }));
  }

  function messageDto(row) {
    if (!row) return null;
    const type = row.type || 'text';
    return {
      id: Number(row.message_id || row.id),
      client_message_id: row.client_message_id || null,
      ciphertext: row.ciphertext,
      iv: row.iv,
      reply_to_message_id: row.reply_to_message_id ? Number(row.reply_to_message_id) : null,
      status: row.status,
      event_type: row.event_type || null,
      event_actor_name: row.event_actor_name || null,
      created_at: toIsoUtc(row.created_at),
      delivered_at: toIsoUtc(row.delivered_at),
      read_at: toIsoUtc(row.read_at),
      edited_at: toIsoUtc(row.edited_at),
      deleted_for_all: Boolean(row.deleted_for_all),
      deleted_at: toIsoUtc(row.deleted_at),
      sender_name: row.sender_name,
      sender_device_id: row.sender_device_id,
      type,
      media: type === 'media' ? mediaForMessage(Number(row.message_id || row.id)) : []
    };
  }

  function buildPins(roomId, deviceId) {
    const rows = listAccessiblePins.all(roomId, deviceId, deviceId);
    const byMessage = new Map();
    for (const row of rows) {
      const id = Number(row.message_id);
      let item = byMessage.get(id);
      if (!item) {
        item = {
          messageId: id,
          shared: false,
          personal: false,
          sharedPinnedAt: null,
          personalPinnedAt: null,
          sharedPinnedByDeviceId: null,
          personalPinnedByDeviceId: null,
          message: messageDto(row)
        };
        byMessage.set(id, item);
      }
      if (row.scope === 'shared') {
        item.shared = true;
        item.sharedPinnedAt = toIsoUtc(row.pinned_at);
        item.sharedPinnedByDeviceId = row.pinned_by_device_id || null;
      } else if (row.scope === 'personal') {
        item.personal = true;
        item.personalPinnedAt = toIsoUtc(row.pinned_at);
        item.personalPinnedByDeviceId = row.pinned_by_device_id || null;
      }
    }
    return [...byMessage.values()].sort((a, b) => a.messageId - b.messageId);
  }

  function sendToDevice(deviceId, payload) {
    const sockets = socketsByDevice?.get(deviceId);
    if (!sockets) return false;
    let sent = false;
    for (const ws of sockets) sent = sendWsJson(ws, payload) || sent;
    return sent;
  }

  function emitChanged(auth, messageId, scope, action) {
    const payload = {
      type: 'pins:changed',
      roomId: auth.room.public_id,
      messageId,
      scope,
      action,
      actorDeviceId: auth.deviceId
    };
    if (scope === 'personal') sendToDevice(auth.deviceId, payload);
    else sendToRoomParticipants(auth.room.public_id, payload);
  }

  app.get('/api/rooms/:publicId/pins', (req, res) => {
    const auth = authorize(req, res);
    if (!auth) return;
    return res.json({ ok: true, pins: buildPins(auth.room.id, auth.deviceId), ...roomStatePayload(auth.room) });
  });

  app.post('/api/rooms/:publicId/messages/:messageId/pins', (req, res) => {
    const auth = authorize(req, res);
    if (!auth) return;
    if (!isRoomOpen(auth.room)) return res.status(409).json({ ok: false, error: 'room closed', code: 'ROOM_CLOSED' });
    const messageId = safeMessageId(req.params.messageId);
    const scope = safeScope(req.body?.scope);
    if (!messageId || !scope) return res.status(400).json({ ok: false, error: 'invalid pin request' });
    const message = findMessage.get(messageId, auth.room.id);
    if (!message || message.deleted_for_all) return res.status(404).json({ ok: false, error: 'message not found' });
    if (message.type === 'system') return res.status(409).json({ ok: false, error: 'system message cannot be pinned' });
    if (isHidden.get(auth.room.id, messageId, auth.deviceId)) return res.status(409).json({ ok: false, error: 'message is hidden for this device' });

    const owner = scope === 'personal' ? auth.deviceId : '';
    const existed = findPin.get(auth.room.id, messageId, scope, owner);
    if (!existed) createPin.run(auth.room.id, messageId, scope, owner, auth.deviceId);
    else touchPin.run(auth.deviceId, auth.room.id, messageId, scope, owner);
    emitChanged(auth, messageId, scope, 'pinned');
    return res.json({ ok: true, scope, messageId, pins: buildPins(auth.room.id, auth.deviceId), ...roomStatePayload(auth.room) });
  });

  app.delete('/api/rooms/:publicId/messages/:messageId/pins/:scope', (req, res) => {
    const auth = authorize(req, res);
    if (!auth) return;
    if (!isRoomOpen(auth.room)) return res.status(409).json({ ok: false, error: 'room closed', code: 'ROOM_CLOSED' });
    const messageId = safeMessageId(req.params.messageId);
    const scope = safeScope(req.params.scope);
    if (!messageId || !scope) return res.status(400).json({ ok: false, error: 'invalid pin request' });
    const owner = scope === 'personal' ? auth.deviceId : '';
    removePin.run(auth.room.id, messageId, scope, owner);
    emitChanged(auth, messageId, scope, 'unpinned');
    return res.json({ ok: true, scope, messageId, pins: buildPins(auth.room.id, auth.deviceId), ...roomStatePayload(auth.room) });
  });

  app.delete('/api/rooms/:publicId/pins', (req, res) => {
    const auth = authorize(req, res);
    if (!auth) return;
    if (!isRoomOpen(auth.room)) return res.status(409).json({ ok: false, error: 'room closed', code: 'ROOM_CLOSED' });
    const scope = safeScope(req.body?.scope);
    if (!scope) return res.status(400).json({ ok: false, error: 'invalid pin scope' });
    const owner = scope === 'personal' ? auth.deviceId : '';
    removePinsByScope.run(auth.room.id, scope, owner);
    emitChanged(auth, null, scope, 'cleared');
    return res.json({ ok: true, scope, pins: buildPins(auth.room.id, auth.deviceId), ...roomStatePayload(auth.room) });
  });
}

module.exports = { installMessagePinsServer };
