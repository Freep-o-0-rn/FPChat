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
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
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

  const reactionColumns = db.prepare('PRAGMA table_info(message_reactions)').all();
  if (!reactionColumns.some((column) => column.name === 'first_seen_at')) {
    db.exec('ALTER TABLE message_reactions ADD COLUMN first_seen_at TEXT');
    db.exec('UPDATE message_reactions SET first_seen_at=created_at WHERE first_seen_at IS NULL');
  }

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
  const firstSeenForReaction = db.prepare(`
    SELECT MIN(COALESCE(first_seen_at, created_at)) AS first_seen_at
    FROM message_reactions
    WHERE room_id=? AND message_id=? AND reaction_id=?
  `);
  const insertReaction = db.prepare(`
    INSERT INTO message_reactions (room_id, message_id, participant_id, reaction_id, first_seen_at)
    VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))
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
    SELECT reaction_id, COUNT(*) AS count, MIN(COALESCE(first_seen_at, created_at)) AS first_seen_at
    FROM message_reactions
    WHERE room_id=? AND message_id=?
    GROUP BY reaction_id
    ORDER BY count DESC, first_seen_at ASC, reaction_id ASC
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
  const bulkSummaryRows = db.prepare(`
    WITH requested(message_id) AS (
      SELECT DISTINCT CAST(value AS INTEGER)
      FROM json_each(?)
      WHERE CAST(value AS INTEGER) > 0
    ),
    ranked AS (
      SELECT
        r.message_id,
        r.reaction_id,
        r.participant_id,
        r.id,
        r.created_at,
        COALESCE(r.first_seen_at, r.created_at) AS first_seen_at,
        COUNT(*) OVER (PARTITION BY r.message_id, r.reaction_id) AS reaction_count,
        ROW_NUMBER() OVER (PARTITION BY r.message_id, r.reaction_id ORDER BY r.id DESC) AS preview_rank
      FROM message_reactions r
      JOIN requested req ON req.message_id=r.message_id
      WHERE r.room_id=?
    ),
    groups AS (
      SELECT
        message_id,
        reaction_id,
        MAX(reaction_count) AS count,
        MIN(first_seen_at) AS group_first_seen,
        MAX(CASE WHEN participant_id=? THEN 1 ELSE 0 END) AS mine,
        MAX(CASE WHEN participant_id=? THEN created_at ELSE NULL END) AS my_created_at,
        MAX(CASE WHEN reaction_count<=2 AND preview_rank=1 THEN participant_id ELSE NULL END) AS preview_1,
        MAX(CASE WHEN reaction_count<=2 AND preview_rank=2 THEN participant_id ELSE NULL END) AS preview_2
      FROM ranked
      GROUP BY message_id, reaction_id
    )
    SELECT
      req.message_id,
      COALESCE(state.revision,0) AS reaction_revision,
      groups.reaction_id,
      groups.count,
      groups.group_first_seen,
      groups.mine,
      groups.my_created_at,
      groups.preview_1,
      groups.preview_2
    FROM requested req
    LEFT JOIN message_reaction_state state
      ON state.room_id=? AND state.message_id=req.message_id
    LEFT JOIN groups
      ON groups.message_id=req.message_id
    WHERE COALESCE(state.revision,0)>0 OR groups.reaction_id IS NOT NULL
    ORDER BY req.message_id ASC, groups.count DESC, groups.group_first_seen ASC, groups.reaction_id ASC
  `);

  // Build 188.6: Reaction Details is a read-only, keyset-paged projection.
  // It does not change reaction mutation/history ownership.
  const DETAILS_PAGE_SIZE = 30;
  const detailsTabCounts = db.prepare(`
    SELECT reaction_id, COUNT(*) AS count, MIN(COALESCE(first_seen_at, created_at)) AS first_seen_at
    FROM message_reactions
    WHERE room_id=? AND message_id=?
    GROUP BY reaction_id
    ORDER BY count DESC, first_seen_at ASC, reaction_id ASC
  `);
  const detailsAllCount = db.prepare(`
    SELECT COUNT(DISTINCT participant_id) AS count
    FROM message_reactions
    WHERE room_id=? AND message_id=?
  `);
  const detailsAllPage = db.prepare(`
    WITH latest AS (
      SELECT
        r.participant_id,
        r.created_at AS latest_created_at,
        r.id AS latest_id,
        ROW_NUMBER() OVER (
          PARTITION BY r.participant_id
          ORDER BY r.created_at DESC, r.id DESC
        ) AS rn
      FROM message_reactions r
      WHERE r.room_id=? AND r.message_id=?
    )
    SELECT
      latest.participant_id,
      latest.latest_created_at,
      latest.latest_id,
      p.display_name,
      p.device_id,
      NULLIF(profile.username,'') AS profile_username,
      COALESCE(NULLIF(identity.display_name,''), NULLIF(profile.display_name,''), NULLIF(p.display_name,'')) AS profile_display_name,
      COALESCE(NULLIF(profile.role,''),'user') AS profile_role,
      COALESCE(privacy.allow_username_search,1) AS allow_username_search
    FROM latest
    JOIN participants p ON p.id=latest.participant_id
    LEFT JOIN user_profiles profile ON profile.device_id=p.device_id
    LEFT JOIN user_identities identity ON identity.device_id=p.device_id
    LEFT JOIN user_privacy_settings privacy ON privacy.device_id=p.device_id
    WHERE latest.rn=1
      AND (
        ? IS NULL
        OR latest.latest_created_at < ?
        OR (latest.latest_created_at = ? AND latest.latest_id < ?)
        OR (latest.latest_created_at = ? AND latest.latest_id = ? AND latest.participant_id < ?)
      )
    ORDER BY latest.latest_created_at DESC, latest.latest_id DESC, latest.participant_id DESC
    LIMIT ?
  `);
  const detailsReactionPage = db.prepare(`
    SELECT
      r.participant_id,
      r.created_at AS latest_created_at,
      r.id AS latest_id,
      p.display_name,
      p.device_id,
      NULLIF(profile.username,'') AS profile_username,
      COALESCE(NULLIF(identity.display_name,''), NULLIF(profile.display_name,''), NULLIF(p.display_name,'')) AS profile_display_name,
      COALESCE(NULLIF(profile.role,''),'user') AS profile_role,
      COALESCE(privacy.allow_username_search,1) AS allow_username_search
    FROM message_reactions r
    JOIN participants p ON p.id=r.participant_id
    LEFT JOIN user_profiles profile ON profile.device_id=p.device_id
    LEFT JOIN user_identities identity ON identity.device_id=p.device_id
    LEFT JOIN user_privacy_settings privacy ON privacy.device_id=p.device_id
    WHERE r.room_id=? AND r.message_id=? AND r.reaction_id=?
      AND (
        ? IS NULL
        OR r.created_at < ?
        OR (r.created_at = ? AND r.id < ?)
        OR (r.created_at = ? AND r.id = ? AND r.participant_id < ?)
      )
    ORDER BY r.created_at DESC, r.id DESC, r.participant_id DESC
    LIMIT ?
  `);
  const detailsParticipantReactions = db.prepare(`
    SELECT participant_id, reaction_id, created_at, id
    FROM message_reactions
    WHERE room_id=? AND message_id=?
      AND participant_id IN (
        SELECT CAST(value AS INTEGER) FROM json_each(?)
      )
    ORDER BY participant_id ASC, created_at DESC, id DESC
  `);

  function encodeDetailsCursor(row) {
    if (!row) return null;
    const payload = JSON.stringify({
      t: String(row.latest_created_at || ''),
      i: Number(row.latest_id || 0),
      p: Number(row.participant_id || 0)
    });
    return Buffer.from(payload, 'utf8').toString('base64url');
  }

  function decodeDetailsCursor(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (raw.length > 256 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw reactionError('REACTION_DETAILS_CURSOR_INVALID', 400, 'invalid details cursor');
    try {
      const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
      const t = String(parsed?.t || '');
      const i = Number(parsed?.i);
      const p = Number(parsed?.p);
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)
        || !Number.isSafeInteger(i) || i <= 0
        || !Number.isSafeInteger(p) || p <= 0) {
        throw new Error('invalid');
      }
      return { t, i, p };
    } catch {
      throw reactionError('REACTION_DETAILS_CURSOR_INVALID', 400, 'invalid details cursor');
    }
  }

  function detailsProfile(row, viewerDeviceId) {
    const viewer = String(viewerDeviceId || '');
    const subject = String(row?.device_id || '');
    const username = String(row?.profile_username || '').trim();
    const isSelf = Boolean(viewer && subject && viewer === subject);
    const privacyAllows = Number(row?.allow_username_search ?? 1) !== 0;
    const blockedByPeer = !isSelf && Boolean(userBlocks?.relationship?.(viewer, subject)?.blockedByPeer);
    if (!username || (!isSelf && (!privacyAllows || blockedByPeer))) return null;
    return {
      username,
      displayName: String(row?.profile_display_name || row?.display_name || 'Пользователь FPChat'),
      role: row?.profile_role === 'service' ? 'service' : 'user',
      isSelf,
      avatarUrl: null
    };
  }

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
      `),
      listVisibleMessageIds: db.prepare(`
        SELECT m.id
        FROM messages m
        WHERE m.room_id=?
          AND m.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
          AND COALESCE(m.deleted_for_all,0)=0
          AND m.type!='system'
          AND NOT EXISTS (
            SELECT 1 FROM message_hidden h
            WHERE h.room_id=m.room_id AND h.message_id=m.id AND h.device_id=?
          )
        ORDER BY m.id ASC
        LIMIT 300
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

  function summariesForMessages(roomId, messageIds, viewerParticipantId = null) {
    const room = Number(roomId);
    const viewer = Number(viewerParticipantId);
    if (!Number.isSafeInteger(room) || room <= 0) return [];
    const ids = [...new Set((Array.isArray(messageIds) ? messageIds : [])
      .map(Number)
      .filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 300);
    if (!ids.length) return [];

    const viewerId = Number.isSafeInteger(viewer) && viewer > 0 ? viewer : 0;
    const rows = bulkSummaryRows.all(JSON.stringify(ids), room, viewerId, viewerId, room);
    const byMessage = new Map();

    for (const row of rows) {
      const messageId = Number(row.message_id);
      let item = byMessage.get(messageId);
      if (!item) {
        item = {
          messageId,
          reactionRevision: Math.max(0, Number(row.reaction_revision || 0)),
          reactions: [],
          myReactions: [],
          catalogVersion: catalog.version
        };
        byMessage.set(messageId, item);
      }
      if (!row.reaction_id) continue;

      const reactionId = String(row.reaction_id);
      const count = Math.max(0, Number(row.count || 0));
      const mine = Number(row.mine || 0) > 0;
      const previewParticipantIds = count <= 2
        ? [row.preview_1, row.preview_2].map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
        : [];
      item.reactions.push({
        ...catalogDto(reactionId),
        count,
        mine,
        ...(count <= 2 ? { previewParticipantIds } : {})
      });
      if (mine) {
        item.myReactions.push({
          ...catalogDto(reactionId),
          createdAt: iso(row.my_created_at)
        });
      }
    }

    for (const item of byMessage.values()) {
      item.myReactions.sort((a, b) => {
        const left = Date.parse(a.createdAt || '') || 0;
        const right = Date.parse(b.createdAt || '') || 0;
        return left - right || String(a.reactionId).localeCompare(String(b.reactionId));
      });
    }

    return ids.map((id) => byMessage.get(id)).filter(Boolean);
  }

  function reactionDetailsPage({ roomId, messageId, viewerParticipantId, viewerDeviceId, reactionId = null, cursor = null, expectedRevision = null }) {
    const room = Number(roomId);
    const message = Number(messageId);
    const viewerParticipant = Number(viewerParticipantId);
    const tabReactionId = reactionId == null || reactionId === '' || reactionId === 'all' ? null : String(reactionId).trim();
    if (!Number.isSafeInteger(room) || room <= 0 || !Number.isSafeInteger(message) || message <= 0
      || !Number.isSafeInteger(viewerParticipant) || viewerParticipant <= 0) {
      throw reactionError('REACTION_DETAILS_TARGET_INVALID', 400, 'invalid reaction details target');
    }
    if (tabReactionId && (!REACTION_ID_RE.test(tabReactionId) || !reactionById(tabReactionId))) {
      throw reactionError('REACTION_UNKNOWN', 400, 'unknown reaction');
    }
    const decodedCursor = decodeDetailsCursor(cursor);
    const wantedRevision = expectedRevision == null || expectedRevision === ''
      ? null
      : Number(expectedRevision);
    if (wantedRevision != null && (!Number.isSafeInteger(wantedRevision) || wantedRevision < 0)) {
      throw reactionError('REACTION_DETAILS_REVISION_INVALID', 400, 'invalid reaction revision');
    }

    const tx = db.transaction(() => {
      const revision = revisionFor(room, message);
      if (wantedRevision != null && wantedRevision !== revision) {
        const error = reactionError('REACTION_DETAILS_STALE', 409, 'reaction details changed');
        error.reactionRevision = revision;
        throw error;
      }

      const tabs = detailsTabCounts.all(room, message).map((row) => ({
        ...catalogDto(row.reaction_id),
        count: Math.max(0, Number(row.count || 0))
      }));
      const allCount = Math.max(0, Number(detailsAllCount.get(room, message)?.count || 0));
      const cursorArgs = decodedCursor
        ? [decodedCursor.t, decodedCursor.t, decodedCursor.t, decodedCursor.i, decodedCursor.t, decodedCursor.i, decodedCursor.p]
        : [null, null, null, 0, null, 0, 0];

      const rawRows = tabReactionId
        ? detailsReactionPage.all(room, message, tabReactionId, ...cursorArgs, DETAILS_PAGE_SIZE + 1)
        : detailsAllPage.all(room, message, ...cursorArgs, DETAILS_PAGE_SIZE + 1);
      const hasMore = rawRows.length > DETAILS_PAGE_SIZE;
      const pageRows = rawRows.slice(0, DETAILS_PAGE_SIZE);
      const participantIds = pageRows.map((row) => Number(row.participant_id)).filter((id) => Number.isSafeInteger(id) && id > 0);
      const allParticipantReactions = participantIds.length
        ? detailsParticipantReactions.all(room, message, JSON.stringify(participantIds))
        : [];
      const reactionsByParticipant = new Map();
      for (const row of allParticipantReactions) {
        const participantId = Number(row.participant_id);
        let list = reactionsByParticipant.get(participantId);
        if (!list) reactionsByParticipant.set(participantId, list = []);
        list.push({
          ...catalogDto(row.reaction_id),
          createdAt: iso(row.created_at)
        });
      }

      const rows = pageRows.map((row) => {
        const participantId = Number(row.participant_id);
        const allReactions = reactionsByParticipant.get(participantId) || [];
        const reactions = tabReactionId
          ? allReactions.filter((reaction) => reaction.reactionId === tabReactionId)
          : allReactions;
        return {
          participantId,
          displayName: String(row.display_name || 'Пользователь FPChat'),
          avatarUrl: null,
          isSelf: Number(viewerParticipant) === participantId,
          profile: detailsProfile(row, viewerDeviceId),
          reactions,
          lastReactionAt: iso(row.latest_created_at)
        };
      });
      return {
        reactionRevision: revision,
        tab: tabReactionId || 'all',
        tabs: {
          allCount,
          reactions: tabs
        },
        rows,
        hasMore,
        nextCursor: hasMore ? encodeDetailsCursor(pageRows[pageRows.length - 1]) : null,
        pageSize: DETAILS_PAGE_SIZE,
        catalogVersion: catalog.version
      };
    });

    return tx();
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
      const firstSeenAt = firstSeenForReaction.get(roomId, messageId, reactionId)?.first_seen_at || null;
      insertReaction.run(roomId, messageId, participantId, reactionId, firstSeenAt);
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

    app.get('/api/rooms/:publicId/messages/:messageId/reactions/details', (req, res) => {
      const room = q.findRoomByPublicId.get(String(req.params.publicId || ''));
      if (!room) return res.status(404).json({ ok: false, code: 'ROOM_NOT_FOUND', error: 'room not found' });
      const deviceId = safeDevice(req.query?.deviceId);
      if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'deviceId required' });
      const participant = q.findParticipant.get(room.id, deviceId);
      if (!participant) return res.status(403).json({ ok: false, code: 'ACCESS_REVOKED', error: 'forbidden' });

      const messageId = safeMessageId(req.params.messageId);
      if (!messageId) return res.status(400).json({ ok: false, code: 'MESSAGE_ID_INVALID', error: 'invalid message id' });
      const mq = ensureMessageQueries();
      const message = mq.findMessage.get(room.id, messageId);
      if (!message || Number(message.deleted_for_all)) {
        return res.status(404).json({ ok: false, code: 'MESSAGE_DELETED', error: 'message not found' });
      }
      if (String(message.type || '') === 'system') {
        return res.status(409).json({ ok: false, code: 'REACTION_MESSAGE_UNSUPPORTED', error: 'system message does not support reactions' });
      }
      if (mq.isHidden.get(room.id, messageId, deviceId)) {
        return res.status(404).json({ ok: false, code: 'MESSAGE_HIDDEN', error: 'message is hidden for this device' });
      }

      try {
        const page = reactionDetailsPage({
          roomId: room.id,
          messageId,
          viewerParticipantId: participant.id,
          viewerDeviceId: deviceId,
          reactionId: req.query?.reactionId || 'all',
          cursor: req.query?.cursor || null,
          expectedRevision: req.query?.revision ?? null
        });
        return res.json({
          ok: true,
          messageId,
          ...page,
          ...(typeof roomStatePayload === 'function' ? roomStatePayload(room) : {})
        });
      } catch (error) {
        const status = Number(error?.status) || 409;
        return res.status(status).json({
          ok: false,
          code: error?.code || 'REACTION_DETAILS_FAILED',
          error: error?.message || 'reaction details failed',
          ...(error?.reactionRevision != null ? { reactionRevision: Number(error.reactionRevision) } : {})
        });
      }
    });

    app.post('/api/rooms/:publicId/reactions/summary', (req, res) => {
      const room = q.findRoomByPublicId.get(String(req.params.publicId || ''));
      if (!room) return res.status(404).json({ ok: false, code: 'ROOM_NOT_FOUND', error: 'room not found' });
      const deviceId = safeDevice(req.body?.deviceId);
      if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'deviceId required' });
      const participant = q.findParticipant.get(room.id, deviceId);
      if (!participant) return res.status(403).json({ ok: false, code: 'ACCESS_REVOKED', error: 'forbidden' });
      const requested = [...new Set((Array.isArray(req.body?.messageIds) ? req.body.messageIds : [])
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 300);
      if (!requested.length) return res.json({ ok: true, reactionSummaries: [], catalogVersion: catalog.version });

      const mq = ensureMessageQueries();
      const visibleIds = mq.listVisibleMessageIds.all(room.id, JSON.stringify(requested), deviceId).map((row) => Number(row.id));
      const reactionSummaries = summariesForMessages(room.id, visibleIds, participant.id);
      return res.json({
        ok: true,
        reactionSummaries,
        catalogVersion: catalog.version,
        ...(typeof roomStatePayload === 'function' ? roomStatePayload(room) : {})
      });
    });

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
    summariesForMessages,
    reactionDetailsPage,
    mutate,
    deleteForAll,
    deleteRoom,
    installRoutes,
    snapshot,
    arbiter
  });
}

module.exports = { reactionError, createMessageReactions188 };
