/* Build 188.1: reaction persistence/server contract.
   Reaction state is independent from MessageStore/history content. */
const { catalog, reactionById, isReactionEnabled, publicCatalog, REACTION_ID_RE } = require('./reactions-catalog188');
const { createReactionMutationArbiter188 } = require('./reaction-mutation-arbiter188');

function reactionError(code, status = 409, message = code) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function createMessageReactions188({
  db,
  q,
  sendToRoomParticipants = null,
  isRoomOpen = null,
  roomStatePayload = null,
  userBlocks = null,
  toIsoUtc = null
}) {
  if (!db || !q) throw new Error('reaction server dependencies are missing');

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      reaction_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(message_id, participant_id, reaction_id)
    );

    CREATE TABLE IF NOT EXISTS message_reaction_state (
      room_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(room_id, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_message_reactions_room_message
      ON message_reactions(room_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_message_reactions_message_reaction_created
      ON message_reactions(message_id, reaction_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_message_reactions_message_participant_created
      ON message_reactions(message_id, participant_id, created_at, id);
  `);

  const arbiter = createReactionMutationArbiter188();
  const findOwnReaction = db.prepare(`
    SELECT id, reaction_id, created_at
    FROM message_reactions
    WHERE room_id=? AND message_id=? AND participant_id=? AND reaction_id=?
  `);
  const listOwnReactions = db.prepare(`
    SELECT id, reaction_id, created_at
    FROM message_reactions
    WHERE room_id=? AND message_id=? AND participant_id=?
    ORDER BY id ASC
  `);
  const insertReaction = db.prepare(`
    INSERT INTO message_reactions (room_id, message_id, participant_id, reaction_id)
    VALUES (?, ?, ?, ?)
  `);
  const deleteReaction = db.prepare(`
    DELETE FROM message_reactions
    WHERE room_id=? AND message_id=? AND participant_id=? AND reaction_id=?
  `);
  const deleteReactionById = db.prepare('DELETE FROM message_reactions WHERE id=?');
  const bumpRevision = db.prepare(`
    INSERT INTO message_reaction_state (room_id, message_id, revision)
    VALUES (?, ?, 1)
    ON CONFLICT(room_id, message_id) DO UPDATE SET revision=message_reaction_state.revision+1
  `);
  const readRevision = db.prepare('SELECT revision FROM message_reaction_state WHERE room_id=? AND message_id=?');
  const groupedSummary = db.prepare(`
    SELECT reaction_id, COUNT(*) AS count, MIN(id) AS first_id
    FROM message_reactions
    WHERE room_id=? AND message_id=?
    GROUP BY reaction_id
    ORDER BY count DESC, first_id ASC, reaction_id ASC
  `);
  const smallPreviewRows = db.prepare(`
    SELECT r.reaction_id, r.participant_id, r.id
    FROM message_reactions r
    JOIN (
      SELECT reaction_id
      FROM message_reactions
      WHERE room_id=? AND message_id=?
      GROUP BY reaction_id
      HAVING COUNT(*) <= 2
    ) small ON small.reaction_id=r.reaction_id
    WHERE r.room_id=? AND r.message_id=?
    ORDER BY r.reaction_id ASC, r.id DESC
  `);
  const deleteReactionsForMessage = db.prepare('DELETE FROM message_reactions WHERE room_id=? AND message_id=?');
  const deleteStateForMessage = db.prepare('DELETE FROM message_reaction_state WHERE room_id=? AND message_id=?');
  const deleteReactionsForRoom = db.prepare('DELETE FROM message_reactions WHERE room_id=?');
  const deleteStateForRoom = db.prepare('DELETE FROM message_reaction_state WHERE room_id=?');

  let messageQueries = null;
  function ensureMessageQueries() {
    if (messageQueries) return messageQueries;
    const columns = db.prepare('PRAGMA table_info(messages)').all();
    if (!columns.some((column) => column.name === 'deleted_for_all')) {
      throw new Error('reaction routes require message actions schema');
    }
    messageQueries = {
      findMessage: db.prepare(`
        SELECT id, room_id, type, COALESCE(deleted_for_all,0) AS deleted_for_all
        FROM messages
        WHERE room_id=? AND id=?
      `),
      isHidden: db.prepare(`
        SELECT 1 AS yes
        FROM message_hidden
        WHERE room_id=? AND message_id=? AND device_id=?
      `)
    };
    return messageQueries;
  }

  function iso(value) {
    if (!value) return null;
    if (typeof toIsoUtc === 'function') return toIsoUtc(value);
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return `${text.replace(' ', 'T')}Z`;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function revisionFor(roomId, messageId) {
    return Math.max(0, Number(readRevision.get(roomId, messageId)?.revision || 0));
  }

  function catalogDto(reactionId) {
    const item = reactionById(reactionId);
    return item
      ? { reactionId: item.id, type: item.type, value: item.value }
      : { reactionId: String(reactionId), type: 'unknown', value: String(reactionId) };
  }

  function summary(roomId, messageId, viewerParticipantId = null) {
    const ownRows = viewerParticipantId ? listOwnReactions.all(roomId, messageId, viewerParticipantId) : [];
    const mine = new Set(ownRows.map((row) => String(row.reaction_id)));
    const previews = new Map();
    for (const row of smallPreviewRows.all(roomId, messageId, roomId, messageId)) {
      const id = String(row.reaction_id);
      let list = previews.get(id);
      if (!list) previews.set(id, list = []);
      list.push(Number(row.participant_id));
    }

    const reactions = groupedSummary.all(roomId, messageId).map((row) => {
      const reactionId = String(row.reaction_id);
      const count = Number(row.count || 0);
      return {
        ...catalogDto(reactionId),
        count,
        ...(viewerParticipantId ? { mine: mine.has(reactionId) } : {}),
        ...(count <= 2 ? { previewParticipantIds: previews.get(reactionId) || [] } : {})
      };
    });

    return {
      messageId: Number(messageId),
      reactionRevision: revisionFor(roomId, messageId),
      reactions,
      ...(viewerParticipantId ? {
        myReactions: ownRows.map((row) => ({ ...catalogDto(row.reaction_id), createdAt: iso(row.created_at) }))
      } : {}),
      catalogVersion: catalog.version
    };
  }

  function assertMutableMessage(roomId, messageId) {
    const mq = ensureMessageQueries();
    const row = mq.findMessage.get(roomId, messageId);
    if (!row || Number(row.deleted_for_all)) throw reactionError('MESSAGE_DELETED', 404, 'message not found');
    if (String(row.type || '') === 'system') throw reactionError('REACTION_MESSAGE_UNSUPPORTED', 409, 'system message does not support reactions');
    return row;
  }

  const mutationTx = db.transaction(({ roomId, messageId, participantId, reactionId, operation }) => {
    assertMutableMessage(roomId, messageId);
    const existing = findOwnReaction.get(roomId, messageId, participantId, reactionId);
    let changed = false;

    if (operation === 'add') {
      if (existing) return { changed: false };
      if (!isReactionEnabled(reactionId)) throw reactionError('REACTION_DISABLED', 409, 'reaction is disabled');
      const own = listOwnReactions.all(roomId, messageId, participantId);
      const removeCount = Math.max(0, own.length - catalog.maxPerParticipantPerMessage + 1);
      for (let i = 0; i < removeCount; i += 1) deleteReactionById.run(own[i].id);
      insertReaction.run(roomId, messageId, participantId, reactionId);
      changed = true;
    } else if (operation === 'remove') {
      changed = deleteReaction.run(roomId, messageId, participantId, reactionId).changes > 0;
    } else {
      throw reactionError('REACTION_OPERATION_INVALID', 400, 'invalid reaction operation');
    }

    if (changed) bumpRevision.run(roomId, messageId);
    return { changed };
  });

  function mutate({ roomId, messageId, participantId, reactionId, operation }) {
    const room = Number(roomId);
    const message = Number(messageId);
    const participant = Number(participantId);
    const id = String(reactionId || '').trim();
    if (!Number.isSafeInteger(room) || room <= 0 || !Number.isSafeInteger(message) || message <= 0 || !Number.isSafeInteger(participant) || participant <= 0) {
      throw reactionError('REACTION_TARGET_INVALID', 400, 'invalid reaction target');
    }
    if (!REACTION_ID_RE.test(id) || !reactionById(id)) throw reactionError('REACTION_UNKNOWN', 400, 'unknown reaction');
    const result = mutationTx({ roomId: room, messageId: message, participantId: participant, reactionId: id, operation });
    return {
      changed: Boolean(result.changed),
      ...summary(room, message, participant)
    };
  }

  function deleteForAll(roomId, messageId) {
    arbiter.cancelMessage(roomId, messageId, 'MESSAGE_DELETED');
    deleteReactionsForMessage.run(roomId, messageId);
    deleteStateForMessage.run(roomId, messageId);
  }

  function deleteRoom(roomId) {
    arbiter.cancelRoom(roomId, 'ROOM_DELETED');
    deleteReactionsForRoom.run(roomId);
    deleteStateForRoom.run(roomId);
  }

  function safeDevice(value) {
    return String(value || '').trim().slice(0, 64);
  }

  function safeMessageId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function authorize(req, res, operation) {
    const room = q.findRoomByPublicId.get(String(req.params.publicId || ''));
    if (!room) {
      res.status(404).json({ ok: false, code: 'ROOM_NOT_FOUND', error: 'room not found' });
      return null;
    }
    const deviceId = safeDevice(req.body?.deviceId || req.query?.deviceId);
    if (!deviceId) {
      res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'deviceId required' });
      return null;
    }
    const participant = q.findParticipant.get(room.id, deviceId);
    if (!participant) {
      res.status(403).json({ ok: false, code: 'ACCESS_REVOKED', error: 'forbidden' });
      return null;
    }
    if (typeof isRoomOpen === 'function' && !isRoomOpen(room)) {
      res.status(409).json({ ok: false, code: 'ROOM_CLOSED', error: 'room closed' });
      return null;
    }
    const messageId = safeMessageId(req.params.messageId);
    if (!messageId) {
      res.status(400).json({ ok: false, code: 'MESSAGE_ID_INVALID', error: 'invalid message id' });
      return null;
    }
    const mq = ensureMessageQueries();
    const message = mq.findMessage.get(room.id, messageId);
    if (!message || Number(message.deleted_for_all)) {
      res.status(404).json({ ok: false, code: 'MESSAGE_DELETED', error: 'message not found' });
      return null;
    }
    if (String(message.type || '') === 'system') {
      res.status(409).json({ ok: false, code: 'REACTION_MESSAGE_UNSUPPORTED', error: 'system message does not support reactions' });
      return null;
    }
    if (mq.isHidden.get(room.id, messageId, deviceId)) {
      res.status(409).json({ ok: false, code: 'MESSAGE_HIDDEN', error: 'message is hidden for this device' });
      return null;
    }
    if (operation === 'add') {
      const guard = userBlocks?.roomSendGuard?.(room.id, deviceId);
      if (guard && !guard.ok) {
        res.status(403).json({ ok: false, code: guard.code || 'REACTION_BLOCKED', error: 'blocked' });
        return null;
      }
    }
    return { room, deviceId, participant, messageId };
  }

  function installRoutes(app) {
    if (!app) throw new Error('reaction routes require express app');
    if (app.__fpReactions188Installed) return;
    ensureMessageQueries();
    app.__fpReactions188Installed = true;

    app.get('/api/reactions/catalog', (req, res) => res.json({ ok: true, ...publicCatalog() }));

    const handle = (operation) => async (req, res) => {
      const auth = authorize(req, res, operation);
      if (!auth) return;
      const reactionId = String(req.params.reactionId || '').trim();
      const catalogReaction = reactionById(reactionId);
      if (!REACTION_ID_RE.test(reactionId) || !catalogReaction) {
        return res.status(400).json({ ok: false, code: 'REACTION_UNKNOWN', error: 'unknown reaction' });
      }
      if (operation === 'add' && !catalogReaction.enabled) {
        return res.status(409).json({ ok: false, code: 'REACTION_DISABLED', error: 'reaction is disabled' });
      }
      const mutationId = String(req.body?.mutationId || '').trim().slice(0, 80) || null;
      try {
        const result = await arbiter.enqueue(auth.room.id, auth.messageId, () => {
          // The request may wait behind earlier mutations for this message.
          // Re-check mutable admission at execution time so a queued ADD cannot
          // bypass a room close, access revoke or a block that happened later.
          const latestRoom = q.findRoomById?.get?.(auth.room.id) || auth.room;
          if (typeof isRoomOpen === 'function' && !isRoomOpen(latestRoom)) {
            throw reactionError('ROOM_CLOSED', 409, 'room closed');
          }
          const activeParticipant = q.findParticipant.get(auth.room.id, auth.deviceId);
          if (!activeParticipant || Number(activeParticipant.id) !== Number(auth.participant.id)) {
            throw reactionError('ACCESS_REVOKED', 403, 'forbidden');
          }
          if (operation === 'add') {
            const guard = userBlocks?.roomSendGuard?.(auth.room.id, auth.deviceId);
            if (guard && !guard.ok) throw reactionError(guard.code || 'REACTION_BLOCKED', 403, 'blocked');
          }
          return mutate({
            roomId: auth.room.id,
            messageId: auth.messageId,
            participantId: auth.participant.id,
            reactionId,
            operation
          });
        });

        if (result.changed && typeof sendToRoomParticipants === 'function') {
          const neutral = summary(auth.room.id, auth.messageId, null);
          const mineAfter = result.myReactions.map((item) => item.reactionId);
          sendToRoomParticipants(auth.room.public_id, {
            type: 'reaction:update',
            roomId: auth.room.public_id,
            messageId: auth.messageId,
            reactionRevision: neutral.reactionRevision,
            reactions: neutral.reactions,
            catalogVersion: neutral.catalogVersion,
            changedParticipantId: Number(auth.participant.id),
            changedParticipantReactions: mineAfter
          });
        }

        return res.json({
          ok: true,
          changed: result.changed,
          mutationId,
          ...result,
          ...(typeof roomStatePayload === 'function' ? roomStatePayload(auth.room) : {})
        });
      } catch (error) {
        const status = Number(error?.status) || (error?.code === 'MESSAGE_DELETED' ? 404 : 409);
        return res.status(status).json({ ok: false, mutationId, code: error?.code || 'REACTION_FAILED', error: error?.message || 'reaction failed' });
      }
    };

    app.put('/api/rooms/:publicId/messages/:messageId/reactions/:reactionId', handle('add'));
    app.delete('/api/rooms/:publicId/messages/:messageId/reactions/:reactionId', handle('remove'));
  }

  function snapshot() {
    return {
      owner: 'FPMessageReactions188',
      catalogVersion: catalog.version,
      maxPerParticipantPerMessage: catalog.maxPerParticipantPerMessage,
      arbiter: arbiter.snapshot()
    };
  }

  return Object.freeze({
    catalog: publicCatalog,
    summary,
    mutate,
    deleteForAll,
    deleteRoom,
    installRoutes,
    snapshot,
    arbiter
  });
}

module.exports = { reactionError, createMessageReactions188 };
