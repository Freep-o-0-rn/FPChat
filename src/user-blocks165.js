/* Build 165: canonical device-level user blocking for chats, presence and invites. */
const crypto = require('crypto');
const { ensureUsernameProfileSchema } = require('./username-server');
const { validateUsernameSyntax } = require('./username-rules');

function ensureUserBlocks165Schema(db) {
  ensureUsernameProfileSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_request_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT,
      blocker_device_id TEXT NOT NULL,
      blocked_device_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(blocker_device_id, blocked_device_id)
    );
    CREATE TABLE IF NOT EXISTS chat_request_pair_resets (
      sender_device_id TEXT NOT NULL,
      target_device_id TEXT NOT NULL,
      reset_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(sender_device_id, target_device_id)
    );
  `);
  const columns = db.prepare('PRAGMA table_info(chat_request_blocks)').all();
  if (!columns.some((column) => column.name === 'public_id')) {
    db.exec('ALTER TABLE chat_request_blocks ADD COLUMN public_id TEXT');
  }
  db.exec(`UPDATE chat_request_blocks SET public_id=lower(hex(randomblob(12))) WHERE public_id IS NULL OR public_id=''`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_request_blocks_public_id ON chat_request_blocks(public_id) WHERE public_id IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_request_blocks_pair ON chat_request_blocks(blocker_device_id, blocked_device_id)`);
}

function safeDeviceId(value) {
  const text = String(value || '').trim();
  if (text.length < 8 || text.length > 128) return '';
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
}
function safeRoomId(value) {
  const text = String(value || '').trim();
  return text.length >= 8 && text.length <= 96 && /^[A-Za-z0-9_-]+$/.test(text) ? text : '';
}
function safeBlockId(value) {
  const text = String(value || '').trim();
  return text.length >= 16 && text.length <= 128 && /^[A-Za-z0-9_-]+$/.test(text) ? text : '';
}
function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 64);
}

function createUserBlocks165(db, { presenceProjector = null } = {}) {
  if (!db) throw new Error('user blocks database is required');
  ensureUserBlocks165Schema(db);

  const q = {
    blockPair: db.prepare(`SELECT public_id, blocker_device_id, blocked_device_id, created_at FROM chat_request_blocks WHERE blocker_device_id=? AND blocked_device_id=? LIMIT 1`),
    blockById: db.prepare(`SELECT public_id, blocker_device_id, blocked_device_id, created_at FROM chat_request_blocks WHERE public_id=? AND blocker_device_id=? LIMIT 1`),
    allBlocks: db.prepare(`SELECT public_id, blocker_device_id, blocked_device_id FROM chat_request_blocks ORDER BY id ASC`),
    addBlock: db.prepare(`INSERT OR IGNORE INTO chat_request_blocks(public_id, blocker_device_id, blocked_device_id) VALUES(?,?,?)`),
    deleteBlock: db.prepare(`DELETE FROM chat_request_blocks WHERE public_id=? AND blocker_device_id=?`),
    pairReset: db.prepare(`INSERT INTO chat_request_pair_resets(sender_device_id,target_device_id,reset_at) VALUES(?,?,datetime('now')) ON CONFLICT(sender_device_id,target_device_id) DO UPDATE SET reset_at=datetime('now')`),
    profileByUsername: db.prepare(`
      SELECT p.device_id, p.username, p.role,
             COALESCE(NULLIF(i.display_name,''), NULLIF(p.display_name,'')) AS display_name
      FROM user_profiles p
      LEFT JOIN user_identities i ON i.device_id=p.device_id
      WHERE p.username_normalized=?
      LIMIT 1
    `),
    identityByDevice: db.prepare(`
      SELECT i.device_id,
             NULLIF(i.display_name,'') AS identity_name,
             NULLIF(p.display_name,'') AS profile_name,
             NULLIF(p.username,'') AS username,
             COALESCE(NULLIF(p.role,''),'user') AS role
      FROM user_identities i
      LEFT JOIN user_profiles p ON p.device_id=i.device_id
      WHERE i.device_id=?
      UNION ALL
      SELECT p.device_id, NULL AS identity_name, NULLIF(p.display_name,'') AS profile_name,
             NULLIF(p.username,'') AS username, COALESCE(NULLIF(p.role,''),'user') AS role
      FROM user_profiles p
      WHERE p.device_id=? AND NOT EXISTS(SELECT 1 FROM user_identities i2 WHERE i2.device_id=p.device_id)
      LIMIT 1
    `),
    roomByPublicId: db.prepare(`SELECT id, public_id, status FROM rooms WHERE public_id=? LIMIT 1`),
    peerAny: db.prepare(`
      SELECT id, room_id, display_name, device_id, online, last_seen_at, access_revoked
      FROM participants
      WHERE room_id=? AND device_id<>?
      ORDER BY access_revoked ASC, id ASC
      LIMIT 1
    `),
    peerActive: db.prepare(`
      SELECT id, room_id, display_name, device_id, online, last_seen_at, access_revoked
      FROM participants
      WHERE room_id=? AND device_id<>? AND access_revoked=0
      ORDER BY id ASC
      LIMIT 1
    `),
    participantAny: db.prepare(`SELECT id, room_id, display_name, device_id, online, last_seen_at, access_revoked FROM participants WHERE room_id=? AND device_id=? LIMIT 1`),
    sharedRooms: db.prepare(`
      SELECT DISTINCT r.public_id
      FROM participants a
      JOIN participants b ON b.room_id=a.room_id
      JOIN rooms r ON r.id=a.room_id
      WHERE a.device_id=? AND b.device_id=?
    `),
    upsertBlockedAttemptActor: db.prepare(`
      INSERT INTO participants (room_id, display_name, device_id, last_seen_at, online, updated_at, access_revoked, permanent_left_at)
      VALUES (?, ?, ?, datetime('now'), 0, datetime('now'), 1, datetime('now'))
      ON CONFLICT(room_id, device_id) DO UPDATE SET
        display_name=excluded.display_name,
        online=0,
        updated_at=datetime('now'),
        access_revoked=1,
        permanent_left_at=COALESCE(participants.permanent_left_at, datetime('now'))
    `),
    blockedAttemptActor: db.prepare(`SELECT id, device_id, display_name FROM participants WHERE room_id=? AND device_id=? LIMIT 1`),
    createBlockedInviteEvent: db.prepare(`
      INSERT OR IGNORE INTO messages
        (room_id, sender_id, ciphertext, iv, type, client_message_id, status, reply_to_message_id, event_type, event_actor_name)
      VALUES (?, ?, '', '', 'system', ?, 'sent', NULL, ?, ?)
    `),
    blockedInviteEvent: db.prepare(`
      SELECT m.id, m.type, m.client_message_id, m.ciphertext, m.iv, m.reply_to_message_id,
             m.status, m.event_type, m.event_actor_name, m.created_at, m.delivered_at, m.read_at,
             p.display_name AS sender_name, p.device_id AS sender_device_id
      FROM messages m
      JOIN participants p ON p.id=m.sender_id
      WHERE m.room_id=? AND m.event_type=? AND m.type='system'
      LIMIT 1
    `)
  };

  function currentIdentity(deviceId, fallbackName = '') {
    const id = safeDeviceId(deviceId);
    if (!id) return { deviceId: '', displayName: cleanName(fallbackName) || 'Пользователь FPChat', username: null, role: 'user' };
    const row = q.identityByDevice.get(id, id);
    return {
      deviceId: id,
      displayName: cleanName(row?.identity_name || row?.profile_name || fallbackName) || 'Пользователь FPChat',
      username: row?.username || null,
      role: row?.role || 'user'
    };
  }

  function relationship(a, b) {
    const first = safeDeviceId(a);
    const second = safeDeviceId(b);
    if (!first || !second || first === second) return { blockedByMe: null, blockedByPeer: null, communicationBlocked: false };
    const blockedByMe = q.blockPair.get(first, second) || null;
    const blockedByPeer = q.blockPair.get(second, first) || null;
    return { blockedByMe, blockedByPeer, communicationBlocked: Boolean(blockedByMe || blockedByPeer) };
  }

  function roomPeer(roomId, deviceId, { activeOnly = false } = {}) {
    const id = Number(roomId);
    const viewer = safeDeviceId(deviceId);
    if (!Number.isSafeInteger(id) || id <= 0 || !viewer) return null;
    const peer = (activeOnly ? q.peerActive : q.peerAny).get(id, viewer) || null;
    if (peer && String(peer.device_id || '').startsWith('blocked-attempt:')) return null;
    return peer;
  }

  function roomSendGuard(roomId, senderId) {
    const sender = safeDeviceId(senderId);
    if (!sender) return { ok: false, code: 'ACCESS_REVOKED' };
    const peer = roomPeer(roomId, sender, { activeOnly: true });
    if (!peer) return { ok: true, peer: null };
    const rel = relationship(sender, peer.device_id);
    if (rel.blockedByMe) return { ok: false, code: 'USER_BLOCKED_BY_YOU', blockId: rel.blockedByMe.public_id, peer };
    if (rel.blockedByPeer) return { ok: false, code: 'USER_BLOCKED_BY_PEER', peer };
    return { ok: true, peer };
  }

  function canViewerSeePresence(viewerId, subjectId) {
    const viewer = safeDeviceId(viewerId);
    const subject = safeDeviceId(subjectId);
    if (!viewer || !subject || viewer === subject) return true;
    return !q.blockPair.get(subject, viewer);
  }

  function defaultPresenceProjection(item, hidden, toIsoUtc) {
    return {
      online: hidden ? false : Boolean(item.online),
      lastSeenAt: hidden ? null : (typeof toIsoUtc === 'function' ? toIsoUtc(item.last_seen_at) : item.last_seen_at || null),
      ...(hidden ? { statusUnavailable: true, presenceState: 'unavailable' } : {})
    };
  }

  function projectPresence(item, viewerId, toIsoUtc) {
    const hidden = item?.device_id !== viewerId && !canViewerSeePresence(viewerId, item?.device_id);
    if (typeof presenceProjector === 'function') {
      const projected = presenceProjector(item, viewerId, { hidden, toIsoUtc });
      if (projected && typeof projected === 'object') return projected;
    }
    return defaultPresenceProjection(item, hidden, toIsoUtc);
  }

  function participantPresenceDto(item, viewerId, toIsoUtc) {
    return {
      deviceId: item.device_id,
      displayName: item.display_name,
      ...projectPresence(item, viewerId, toIsoUtc)
    };
  }

  function resolveUsername(value) {
    const parsed = validateUsernameSyntax(value);
    if (!parsed.ok) return null;
    return q.profileByUsername.get(parsed.username) || null;
  }

  function block(blockerId, blockedId) {
    const blocker = safeDeviceId(blockerId);
    const blocked = safeDeviceId(blockedId);
    if (!blocker || !blocked || blocker === blocked) return { ok: false, code: 'USER_BLOCK_INVALID' };
    let row = q.blockPair.get(blocker, blocked);
    if (!row) {
      q.addBlock.run(crypto.randomBytes(18).toString('base64url'), blocker, blocked);
      row = q.blockPair.get(blocker, blocked);
    }
    return { ok: true, block: row };
  }

  function unblock(blockId, blockerId) {
    const id = safeBlockId(blockId);
    const blocker = safeDeviceId(blockerId);
    if (!id || !blocker) return { ok: false, code: 'USER_BLOCK_INVALID' };
    const row = q.blockById.get(id, blocker);
    if (!row) return { ok: false, code: 'USER_BLOCK_NOT_FOUND' };
    const info = q.deleteBlock.run(id, blocker);
    if (!info.changes) return { ok: false, code: 'USER_BLOCK_NOT_FOUND' };
    q.pairReset.run(row.blocked_device_id, blocker);
    return { ok: true, block: row };
  }

  function inviteGuard(roomId, joinerId) {
    const joiner = safeDeviceId(joinerId);
    if (!joiner) return { ok: false, code: 'DEVICE_ID_REQUIRED' };
    const creator = roomPeer(roomId, joiner, { activeOnly: true }) || db.prepare(`SELECT id, room_id, display_name, device_id, online, last_seen_at, access_revoked FROM participants WHERE room_id=? AND access_revoked=0 ORDER BY id ASC LIMIT 1`).get(roomId);
    if (!creator || creator.device_id === joiner) return { ok: true, creator: creator || null };
    const creatorBlockedJoiner = q.blockPair.get(creator.device_id, joiner);
    if (creatorBlockedJoiner) return { ok: false, code: 'INVITE_BLOCKED_BY_CREATOR', creator, block: creatorBlockedJoiner };
    const joinerBlockedCreator = q.blockPair.get(joiner, creator.device_id);
    if (joinerBlockedCreator) return { ok: false, code: 'INVITE_CREATOR_BLOCKED_BY_YOU', creator, block: joinerBlockedCreator };
    return { ok: true, creator };
  }

  function noteBlockedInviteAttempt({ roomId, inviteId, joinerId, fallbackName = '' }) {
    const roomNumericId = Number(roomId);
    const inviteNumericId = Number(inviteId);
    const deviceId = safeDeviceId(joinerId);
    if (!Number.isSafeInteger(roomNumericId) || roomNumericId <= 0 || !Number.isSafeInteger(inviteNumericId) || inviteNumericId <= 0 || !deviceId) return { created: false, row: null };
    const creator = db.prepare(`SELECT id, device_id FROM participants WHERE room_id=? AND access_revoked=0 ORDER BY id ASC LIMIT 1`).get(roomNumericId);
    if (!creator) return { created: false, row: null };
    const identity = currentIdentity(deviceId, fallbackName);
    const actor = identity.username ? `${identity.displayName} (@${identity.username})` : identity.displayName;
    const fingerprint = crypto.createHash('sha256').update(deviceId).digest('hex').slice(0, 16);
    const actorDeviceId = `blocked-attempt:${fingerprint}`;
    q.upsertBlockedAttemptActor.run(roomNumericId, actor, actorDeviceId);
    const attemptActor = q.blockedAttemptActor.get(roomNumericId, actorDeviceId);
    if (!attemptActor) return { created: false, row: null };
    const eventType = `blocked_invite_attempt:${inviteNumericId}:${fingerprint}`;
    const clientKey = `system:${eventType}`;
    const result = q.createBlockedInviteEvent.run(roomNumericId, attemptActor.id, clientKey, eventType, actor);
    const row = q.blockedInviteEvent.get(roomNumericId, eventType) || null;
    return { created: Boolean(result.changes), row, actor, eventType };
  }

  function roomStatus(publicRoomId, viewerId, toIsoUtc) {
    const roomPublicId = safeRoomId(publicRoomId);
    const viewer = safeDeviceId(viewerId);
    if (!roomPublicId || !viewer) return { ok: false, code: 'USER_BLOCK_ROOM_FIELDS_REQUIRED' };
    const room = q.roomByPublicId.get(roomPublicId);
    if (!room) return { ok: false, code: 'ROOM_NOT_FOUND' };
    const viewerParticipant = q.participantAny.get(room.id, viewer);
    if (!viewerParticipant || Number(viewerParticipant.access_revoked)) return { ok: false, code: 'ACCESS_REVOKED' };
    const peer = roomPeer(room.id, viewer, { activeOnly: false });
    if (!peer) return { ok: true, roomPublicId, roomStatus: String(room.status || 'open'), peer: null, blockedByMe: false, blockId: null, communicationBlocked: false, presenceVisible: true, canSend: true };
    const rel = relationship(viewer, peer.device_id);
    const identity = currentIdentity(peer.device_id, peer.display_name);
    const presenceVisible = canViewerSeePresence(viewer, peer.device_id);
    const projectedPresence = projectPresence(peer, viewer, toIsoUtc);
    return {
      ok: true,
      roomPublicId,
      roomStatus: String(room.status || 'open'),
      peer: {
        deviceId: peer.device_id,
        displayName: identity.displayName,
        username: identity.username,
        ...projectedPresence
      },
      blockedByMe: Boolean(rel.blockedByMe),
      blockId: rel.blockedByMe?.public_id || null,
      communicationBlocked: rel.communicationBlocked,
      presenceVisible,
      canSend: !rel.communicationBlocked
    };
  }

  return { q, currentIdentity, relationship, roomPeer, roomSendGuard, canViewerSeePresence, participantPresenceDto, resolveUsername, block, unblock, inviteGuard, noteBlockedInviteAttempt, roomStatus };
}

function installUserBlocks165Server({ app, db, q: roomQ, socketsByDevice, sendWsJson, toIsoUtc, userBlocks }) {
  if (!app || !db || !roomQ || !socketsByDevice || !sendWsJson) throw new Error('user blocks server dependencies are missing');
  if (app.__fpUserBlocks165Installed) return;
  app.__fpUserBlocks165Installed = true;
  const blocks = userBlocks || createUserBlocks165(db);

  function notifyPair(a, b) {
    const first = safeDeviceId(a);
    const second = safeDeviceId(b);
    if (!first || !second) return;
    for (const room of blocks.q.sharedRooms.all(first, second)) {
      const payload = { type: 'user-block:changed', roomId: room.public_id };
      for (const id of [first, second]) {
        const sockets = socketsByDevice.get(id);
        if (!sockets) continue;
        for (const ws of sockets) sendWsJson(ws, payload);
      }
    }
  }

  const readSnapshot = () => new Map(blocks.q.allBlocks.all().map((row) => [row.public_id, row]));
  let snapshot = readSnapshot();
  const watcher = setInterval(() => {
    try {
      const next = readSnapshot();
      const touched = new Map();
      for (const [id, row] of next) if (!snapshot.has(id)) touched.set(`${row.blocker_device_id}:${row.blocked_device_id}`, row);
      for (const [id, row] of snapshot) if (!next.has(id)) touched.set(`${row.blocker_device_id}:${row.blocked_device_id}`, row);
      snapshot = next;
      for (const row of touched.values()) notifyPair(row.blocker_device_id, row.blocked_device_id);
    } catch (error) {
      console.error('User block watcher failed', error);
    }
  }, 1000);
  watcher.unref?.();

  function targetFromBody(body, viewerId) {
    if (body?.targetUsername) {
      const profile = blocks.resolveUsername(body.targetUsername);
      return profile?.device_id ? { deviceId: profile.device_id, profile } : null;
    }
    const publicRoomId = safeRoomId(body?.roomId);
    if (!publicRoomId) return null;
    const room = blocks.q.roomByPublicId.get(publicRoomId);
    if (!room) return null;
    const peer = blocks.roomPeer(room.id, viewerId, { activeOnly: false });
    return peer ? { deviceId: peer.device_id, peer, room } : null;
  }

  app.get('/api/user-blocks/status', (req, res) => {
    const id = safeDeviceId(req.query?.deviceId);
    if (!id) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });
    const profile = blocks.resolveUsername(req.query?.targetUsername);
    if (!profile) return res.status(404).json({ ok: false, code: 'TARGET_NOT_FOUND' });
    if (profile.device_id === id) return res.json({ ok: true, isSelf: true, blockedByMe: false, blockId: null });
    const own = blocks.relationship(id, profile.device_id).blockedByMe;
    return res.json({ ok: true, isSelf: false, blockedByMe: Boolean(own), blockId: own?.public_id || null });
  });

  app.get('/api/user-blocks/room-status', (req, res) => {
    const data = blocks.roomStatus(req.query?.roomId, req.query?.deviceId, toIsoUtc);
    if (!data.ok) {
      const status = data.code === 'ROOM_NOT_FOUND' ? 404 : data.code === 'ACCESS_REVOKED' ? 403 : 400;
      return res.status(status).json(data);
    }
    return res.json(data);
  });

  app.post('/api/user-blocks', (req, res) => {
    const id = safeDeviceId(req.body?.deviceId);
    if (!id) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });
    const target = targetFromBody(req.body, id);
    if (!target?.deviceId) return res.status(404).json({ ok: false, code: 'TARGET_NOT_FOUND' });
    const result = blocks.block(id, target.deviceId);
    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json({ ok: true, blockId: result.block.public_id });
  });

  app.delete('/api/user-blocks/:blockId', (req, res) => {
    const id = safeDeviceId(req.body?.deviceId);
    const result = blocks.unblock(req.params.blockId, id);
    if (!result.ok) return res.status(result.code === 'USER_BLOCK_NOT_FOUND' ? 404 : 400).json(result);
    return res.json({ ok: true });
  });

  return blocks;
}

module.exports = { ensureUserBlocks165Schema, createUserBlocks165, installUserBlocks165Server };
