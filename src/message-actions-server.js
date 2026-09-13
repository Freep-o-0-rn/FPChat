/* Build 108: isolated message edit/delete server layer.
   Extends existing FPChat message queries without changing transport semantics. */

function installMessageActionsServer({
  app,
  db,
  q,
  socketsByDevice,
  sendWsJson,
  sendToRoomParticipants,
  broadcastUnreadState,
  toIsoUtc,
  safeUnlink,
  isRoomOpen,
  roomStatePayload
}) {
  if (!app || !db || !q) throw new Error('message actions server dependencies are missing');

  const columns = db.prepare('PRAGMA table_info(messages)').all();
  if (!columns.some((column) => column.name === 'edited_at')) db.exec('ALTER TABLE messages ADD COLUMN edited_at TEXT');
  if (!columns.some((column) => column.name === 'deleted_for_all')) db.exec('ALTER TABLE messages ADD COLUMN deleted_for_all INTEGER NOT NULL DEFAULT 0');
  if (!columns.some((column) => column.name === 'deleted_at')) db.exec('ALTER TABLE messages ADD COLUMN deleted_at TEXT');
  db.exec("UPDATE messages SET deleted_for_all=0 WHERE deleted_for_all IS NULL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_hidden (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, message_id, device_id)
    );

    CREATE TABLE IF NOT EXISTS message_mutations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      mutation_type TEXT NOT NULL,
      target_device_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_message_hidden_room_device ON message_hidden(room_id, device_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_message_hidden_message ON message_hidden(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_mutations_room_id ON message_mutations(room_id, id);
  `);

  const SELECT_108 = `SELECT m.id, m.type, m.client_message_id, m.ciphertext, m.iv, m.reply_to_message_id, m.status, m.event_type, m.event_actor_name, m.created_at, m.delivered_at, m.read_at, m.edited_at, m.deleted_for_all, m.deleted_at, p.display_name as sender_name, p.device_id as sender_device_id FROM messages m JOIN participants p ON p.id = m.sender_id`;

  q.listMessagesLatest = db.prepare(`${SELECT_108} WHERE m.room_id=? AND COALESCE(m.deleted_for_all,0)=0 ORDER BY m.id DESC LIMIT ?`);
  q.listMessagesBefore = db.prepare(`${SELECT_108} WHERE m.room_id=? AND m.id<? AND COALESCE(m.deleted_for_all,0)=0 ORDER BY m.id DESC LIMIT ?`);
  q.listMessagesAfter = db.prepare(`${SELECT_108} WHERE m.room_id=? AND m.id>? AND COALESCE(m.deleted_for_all,0)=0 ORDER BY m.id ASC LIMIT ?`);
  q.findMessageById = db.prepare(`${SELECT_108} WHERE m.id=? AND m.room_id=?`);
  q.findMessageByClientId = db.prepare(`${SELECT_108} WHERE m.room_id=? AND m.sender_id=? AND m.client_message_id=? AND COALESCE(m.deleted_for_all,0)=0`);
  q.findMessageInRoom = db.prepare('SELECT id FROM messages WHERE id=? AND room_id=? AND COALESCE(deleted_for_all,0)=0');
  q.findMessageForRead = db.prepare("SELECT id, sender_id, client_message_id, status, read_at FROM messages WHERE id=? AND room_id=? AND COALESCE(deleted_for_all,0)=0");
  q.markDelivered = db.prepare("UPDATE messages SET status=CASE WHEN status='sent' THEN 'delivered' ELSE status END, delivered_at=CASE WHEN status='sent' THEN datetime('now') ELSE delivered_at END WHERE id=? AND status='sent' AND COALESCE(deleted_for_all,0)=0");

  const participantDevice = db.prepare('SELECT device_id FROM participants WHERE id=? AND room_id=?');
  const countUnread = db.prepare(`SELECT COUNT(*) AS count FROM messages m WHERE m.room_id=? AND m.sender_id!=? AND m.status!='read' AND COALESCE(m.deleted_for_all,0)=0 AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.room_id=m.room_id AND h.message_id=m.id AND h.device_id=?)`);
  const firstUnread = db.prepare(`SELECT m.id FROM messages m WHERE m.room_id=? AND m.sender_id!=? AND m.status!='read' AND COALESCE(m.deleted_for_all,0)=0 AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.room_id=m.room_id AND h.message_id=m.id AND h.device_id=?) ORDER BY m.id ASC LIMIT 1`);
  q.countUnreadForParticipant = {
    get(roomId, participantId) {
      const deviceId = participantDevice.get(participantId, roomId)?.device_id || '';
      return countUnread.get(roomId, participantId, deviceId);
    }
  };
  q.findFirstUnreadForParticipant = {
    get(roomId, participantId) {
      const deviceId = participantDevice.get(participantId, roomId)?.device_id || '';
      return firstUnread.get(roomId, participantId, deviceId);
    }
  };

  const markRead = db.prepare(`UPDATE messages SET status='read', delivered_at=CASE WHEN delivered_at IS NULL THEN datetime('now') ELSE delivered_at END, read_at=CASE WHEN read_at IS NULL THEN datetime('now') ELSE read_at END WHERE room_id=? AND id=? AND sender_id!=? AND status!='read' AND COALESCE(deleted_for_all,0)=0 AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.room_id=messages.room_id AND h.message_id=messages.id AND h.device_id=?)`);
  q.markReadBulk = {
    run(roomId, messageId, readerId) {
      const deviceId = participantDevice.get(readerId, roomId)?.device_id || '';
      return markRead.run(roomId, messageId, readerId, deviceId);
    }
  };

  const oldDeleteMessagesByRoomId = q.deleteMessagesByRoomId;
  const deleteHiddenByRoom = db.prepare('DELETE FROM message_hidden WHERE room_id=?');
  const deleteMutationsByRoom = db.prepare('DELETE FROM message_mutations WHERE room_id=?');
  q.deleteMessagesByRoomId = {
    run(roomId) {
      deleteHiddenByRoom.run(roomId);
      deleteMutationsByRoom.run(roomId);
      return oldDeleteMessagesByRoomId.run(roomId);
    }
  };

  const findParticipant = db.prepare('SELECT * FROM participants WHERE room_id=? AND device_id=? AND access_revoked=0');
  const findMessage = db.prepare(`${SELECT_108} WHERE m.id=? AND m.room_id=?`);
  const isHidden = db.prepare('SELECT 1 AS yes FROM message_hidden WHERE room_id=? AND message_id=? AND device_id=?');
  const hideMessage = db.prepare('INSERT OR IGNORE INTO message_hidden (room_id, message_id, device_id) VALUES (?, ?, ?)');
  const deleteHiddenForMessage = db.prepare('DELETE FROM message_hidden WHERE room_id=? AND message_id=?');
  const listHiddenForDevice = db.prepare('SELECT message_id FROM message_hidden WHERE room_id=? AND device_id=? ORDER BY message_id ASC');
  const listDeletedForAll = db.prepare('SELECT id FROM messages WHERE room_id=? AND COALESCE(deleted_for_all,0)=1 ORDER BY id ASC');
  const createMutation = db.prepare('INSERT INTO message_mutations (room_id, message_id, mutation_type, target_device_id) VALUES (?, ?, ?, ?)');
  const listMutations = db.prepare(`SELECT id, message_id, mutation_type, target_device_id, created_at FROM message_mutations WHERE room_id=? AND id>? AND (target_device_id IS NULL OR target_device_id=?) ORDER BY id ASC LIMIT ?`);
  const maxMutationForDevice = db.prepare(`SELECT MAX(id) AS id FROM message_mutations WHERE room_id=? AND (target_device_id IS NULL OR target_device_id=?)`);
  const updateText = db.prepare("UPDATE messages SET ciphertext=?, iv=?, edited_at=datetime('now') WHERE id=? AND room_id=? AND sender_id=? AND type='text' AND COALESCE(deleted_for_all,0)=0");
  const deleteForAll = db.prepare("UPDATE messages SET ciphertext='', iv='', deleted_for_all=1, deleted_at=COALESCE(deleted_at, datetime('now')) WHERE id=? AND room_id=? AND sender_id=? AND COALESCE(deleted_for_all,0)=0");
  const listMessageMediaFiles = db.prepare('SELECT server_filename, thumbnail_filename FROM media WHERE room_id=? AND message_id=?');
  const deleteMessageMedia = db.prepare('DELETE FROM media WHERE room_id=? AND message_id=?');
  const deletePushDeliveriesForMessage = db.prepare('DELETE FROM push_deliveries WHERE room_id=? AND message_id=?');
  const clearViewAnchorsForMessage = db.prepare("UPDATE chat_view_state SET anchor_message_id=NULL, anchor_offset_px=0, at_bottom=0, updated_at=datetime('now') WHERE room_id=? AND anchor_message_id=?");
  const clearViewAnchorForDeviceMessage = db.prepare("UPDATE chat_view_state SET anchor_message_id=NULL, anchor_offset_px=0, at_bottom=0, updated_at=datetime('now') WHERE room_id=? AND device_id=? AND anchor_message_id=?");
  const clearDraftRepliesForMessage = db.prepare("UPDATE drafts SET reply_to_message_id=NULL, updated_at=datetime('now') WHERE room_id=? AND reply_to_message_id=?");
  const clearDraftReplyForDeviceMessage = db.prepare("UPDATE drafts SET reply_to_message_id=NULL, updated_at=datetime('now') WHERE room_id=? AND device_id=? AND reply_to_message_id=?");
  const latestVisible = db.prepare(`${SELECT_108} WHERE m.room_id=? AND COALESCE(m.deleted_for_all,0)=0 AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.room_id=m.room_id AND h.message_id=m.id AND h.device_id=?) ORDER BY m.id DESC LIMIT 1`);

  function safeDevice(value) {
    return String(value || '').trim().slice(0, 64);
  }

  function safeMessageId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function messageDto(row, includeMedia = false) {
    if (!row) return null;
    const dto = {
      id: Number(row.id),
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
      type: row.type || 'text',
      media: []
    };
    if (includeMedia && dto.type === 'media' && !dto.deleted_for_all) {
      dto.media = q.listMediaByMessageId.all(dto.id).map((media) => ({
        ...media,
        thumbnail_url: `/api/media/${media.public_id}/thumb`
      }));
    }
    return dto;
  }

  function sendToDevice(deviceId, payload) {
    const sockets = socketsByDevice?.get(deviceId);
    if (!sockets) return false;
    let sent = false;
    for (const ws of sockets) sent = sendWsJson(ws, payload) || sent;
    return sent;
  }

  function authorize(req, res) {
    const room = q.findRoomByPublicId.get(req.params.publicId);
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

  app.get('/api/rooms/:publicId/message-actions/state', (req, res) => {
    const auth = authorize(req, res);
    if (!auth) return;
    const hiddenMessageIds = listHiddenForDevice.all(auth.room.id, auth.deviceId).map((row) => Number(row.message_id));
    const deletedForAllMessageIds = listDeletedForAll.all(auth.room.id).map((row) => Number(row.id));
    const mutationCursor = Number(maxMutationForDevice.get(auth.room.id, auth.deviceId)?.id || 0);
    return res.json({ ok: true, hiddenMessageIds, deletedForAllMessageIds, mutationCursor, ...roomStatePayload(auth.room) });
  });

  app.get('/api/rooms/:publicId/message-actions/mutations', (req, res) => {
    const auth = authorize(req, res);
    if (!auth) return;
    const after = Math.max(0, Number.parseInt(req.query?.after || '0', 10) || 0);
    const limit = Math.max(1, Math.min(200, Number.parseInt(req.query?.limit || '200', 10) || 200));
    const rows = listMutations.all(auth.room.id, after, auth.deviceId, limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const mutations = page.map((row) => {
      const item = {
        id: Number(row.id),
        messageId: Number(row.message_id),
        kind: row.mutation_type,
        targetDeviceId: row.target_device_id || null,
        createdAt: toIsoUtc(row.created_at),
        message: null
      };
      if (item.kind === 'edited') {
        const current = findMessage.get(item.messageId, auth.room.id);
        if (current && !current.deleted_for_all) item.message = messageDto(current, false);
      }
      return item;
    });
    const nextCursor = mutations.length ? mutations[mutations.length - 1].id : after;
    return res.json({ ok: true, mutations, hasMore, nextCursor, ...roomStatePayload(auth.room) });
  });

  app.get('/api/rooms/:publicId/message-actions/latest', (req, res) => {
    const auth = authorize(req, res);
    if (!auth) return;
    const row = latestVisible.get(auth.room.id, auth.deviceId);
    return res.json({ ok: true, message: row ? messageDto(row, true) : null, ...roomStatePayload(auth.room) });
  });

  app.put('/api/rooms/:publicId/messages/:messageId/edit', (req, res) => {
    const auth = authorize(req, res);
    if (!auth) return;
    if (!isRoomOpen(auth.room)) return res.status(409).json({ ok: false, error: 'room closed', code: 'ROOM_CLOSED' });
    const messageId = safeMessageId(req.params.messageId);
    if (!messageId) return res.status(400).json({ ok: false, error: 'invalid message id' });
    const row = findMessage.get(messageId, auth.room.id);
    if (!row || row.deleted_for_all) return res.status(404).json({ ok: false, error: 'message not found' });
    if (row.sender_device_id !== auth.deviceId) return res.status(403).json({ ok: false, error: 'only own message can be edited' });
    if (row.type !== 'text') return res.status(409).json({ ok: false, error: 'only text message can be edited' });
    if (isHidden.get(auth.room.id, messageId, auth.deviceId)) return res.status(409).json({ ok: false, error: 'message is hidden for this device' });
    const ciphertext = String(req.body?.ciphertext || '');
    const iv = String(req.body?.iv || '');
    if (!ciphertext || !iv) return res.status(400).json({ ok: false, error: 'ciphertext and iv required' });

    let mutationId = null;
    const editTx = db.transaction(() => {
      const changed = updateText.run(ciphertext, iv, messageId, auth.room.id, auth.participant.id);
      if (!changed.changes) return false;
      mutationId = Number(createMutation.run(auth.room.id, messageId, 'edited', null).lastInsertRowid);
      return true;
    });
    if (!editTx()) return res.status(409).json({ ok: false, error: 'message could not be edited' });

    const updated = findMessage.get(messageId, auth.room.id);
    const message = messageDto(updated, false);
    const payload = { type: 'message:edited', roomId: auth.room.public_id, messageId, mutationId, message };
    sendToRoomParticipants(auth.room.public_id, payload);
    return res.json({ ok: true, mutationId, message, ...roomStatePayload(auth.room) });
  });

  app.delete('/api/rooms/:publicId/messages/:messageId', (req, res) => {
    const auth = authorize(req, res);
    if (!auth) return;
    const messageId = safeMessageId(req.params.messageId);
    if (!messageId) return res.status(400).json({ ok: false, error: 'invalid message id' });
    const row = findMessage.get(messageId, auth.room.id);
    if (!row) return res.status(404).json({ ok: false, error: 'message not found' });
    if (row.type === 'system') return res.status(409).json({ ok: false, error: 'system message cannot be deleted' });
    const scope = req.body?.scope === 'all' ? 'all' : 'self';

    if (scope === 'self') {
      if (row.deleted_for_all) return res.json({ ok: true, scope: 'all', alreadyDeleted: true, messageId });
      const hidden = hideMessage.run(auth.room.id, messageId, auth.deviceId);
      let mutationId = null;
      if (hidden.changes) {
        clearViewAnchorForDeviceMessage.run(auth.room.id, auth.deviceId, messageId);
        clearDraftReplyForDeviceMessage.run(auth.room.id, auth.deviceId, messageId);
        mutationId = Number(createMutation.run(auth.room.id, messageId, 'deleted_self', auth.deviceId).lastInsertRowid);
      }
      const payload = { type: 'message:deleted', roomId: auth.room.public_id, messageId, scope: 'self', mutationId };
      sendToDevice(auth.deviceId, payload);
      broadcastUnreadState(auth.room);
      return res.json({ ok: true, scope: 'self', mutationId, messageId, ...roomStatePayload(auth.room) });
    }

    if (row.sender_device_id !== auth.deviceId) return res.status(403).json({ ok: false, error: 'only own message can be deleted for all' });
    if (row.deleted_for_all) return res.json({ ok: true, scope: 'all', alreadyDeleted: true, messageId });

    const mediaFiles = listMessageMediaFiles.all(auth.room.id, messageId);
    let mutationId = null;
    const deleteTx = db.transaction(() => {
      const changed = deleteForAll.run(messageId, auth.room.id, auth.participant.id);
      if (!changed.changes) return false;
      deleteMessageMedia.run(auth.room.id, messageId);
      deleteHiddenForMessage.run(auth.room.id, messageId);
      deletePushDeliveriesForMessage.run(auth.room.id, messageId);
      clearViewAnchorsForMessage.run(auth.room.id, messageId);
      clearDraftRepliesForMessage.run(auth.room.id, messageId);
      mutationId = Number(createMutation.run(auth.room.id, messageId, 'deleted_all', null).lastInsertRowid);
      return true;
    });
    if (!deleteTx()) return res.status(409).json({ ok: false, error: 'message could not be deleted' });

    for (const media of mediaFiles) {
      safeUnlink(media.server_filename);
      safeUnlink(media.thumbnail_filename);
    }
    const payload = { type: 'message:deleted', roomId: auth.room.public_id, messageId, scope: 'all', mutationId };
    sendToRoomParticipants(auth.room.public_id, payload);
    broadcastUnreadState(auth.room);
    return res.json({ ok: true, scope: 'all', mutationId, messageId, ...roomStatePayload(auth.room) });
  });
}

module.exports = { installMessageActionsServer };
