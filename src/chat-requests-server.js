/* Build 146: isolated chat-request decisions over the existing FPChat room/invite flow.
   Requests never become a second room system: accept binds a normal /api/rooms invite,
   and the sender later consumes that invite through the existing invite/join endpoint. */
const crypto = require('crypto');
const { ensureUsernameProfileSchema } = require('./username-server');
const { validateUsernameSyntax } = require('./username-rules');
const { createSystemEventStore } = require('./system-events-server');

function safeDeviceId(value) {
  const text = String(value || '').trim();
  if (text.length < 8 || text.length > 128) return '';
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
}

function safeRequestId(value) {
  const text = String(value || '').trim();
  if (text.length < 16 || text.length > 96) return '';
  return /^[A-Za-z0-9_-]+$/.test(text) ? text : '';
}

function safeRoomPublicId(value) {
  const text = String(value || '').trim();
  if (text.length < 8 || text.length > 96) return '';
  return /^[A-Za-z0-9_-]+$/.test(text) ? text : '';
}

function safeInviteCode(value) {
  const text = String(value || '').trim();
  if (text.length < 16 || text.length > 96) return '';
  return /^[A-Za-z0-9_-]+$/.test(text) ? text : '';
}

function ensureChatRequestsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      sender_device_id TEXT NOT NULL,
      target_device_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      room_public_id TEXT,
      invite_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_request_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blocker_device_id TEXT NOT NULL,
      blocked_device_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(blocker_device_id, blocked_device_id)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_requests_sender
      ON chat_requests(sender_device_id, id DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_requests_target
      ON chat_requests(target_device_id, id DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_requests_pending_pair
      ON chat_requests(sender_device_id, target_device_id)
      WHERE status='pending';

    CREATE INDEX IF NOT EXISTS idx_chat_request_blocks_blocker
      ON chat_request_blocks(blocker_device_id, blocked_device_id);
  `);

  const columns = db.prepare('PRAGMA table_info(chat_requests)').all();
  if (!columns.some((column) => column.name === 'room_public_id')) {
    db.exec('ALTER TABLE chat_requests ADD COLUMN room_public_id TEXT');
  }
  if (!columns.some((column) => column.name === 'invite_code')) {
    db.exec('ALTER TABLE chat_requests ADD COLUMN invite_code TEXT');
  }
}

function installChatRequestsServer({ app, db, q: roomQ, isRoomOpen }) {
  if (!app || !db) throw new Error('chat request dependencies are missing');
  if (!roomQ?.findRoomByPublicId || !roomQ?.findInviteByCode || !roomQ?.findParticipant || !roomQ?.listParticipantsByRoom) {
    throw new Error('chat request room dependencies are missing');
  }
  if (app.__fpChatRequests146Installed) return;
  app.__fpChatRequests146Installed = true;

  ensureUsernameProfileSchema(db);
  ensureChatRequestsSchema(db);
  const systemEvents = createSystemEventStore(db);

  const rq = {
    profileByDevice: db.prepare(`
      SELECT device_id, username, username_normalized, display_name, role
      FROM user_profiles
      WHERE device_id=?
    `),
    profileByUsername: db.prepare(`
      SELECT device_id, username, username_normalized, display_name, role
      FROM user_profiles
      WHERE username_normalized=?
    `),
    pendingBetween: db.prepare(`
      SELECT public_id, sender_device_id, target_device_id, status, room_public_id, invite_code, created_at, updated_at
      FROM chat_requests
      WHERE status='pending'
        AND ((sender_device_id=? AND target_device_id=?)
          OR (sender_device_id=? AND target_device_id=?))
      ORDER BY id DESC
      LIMIT 1
    `),
    insert: db.prepare(`
      INSERT INTO chat_requests
        (public_id, sender_device_id, target_device_id, status)
      VALUES (?, ?, ?, 'pending')
    `),
    byPublicId: db.prepare(`
      SELECT public_id, sender_device_id, target_device_id, status, room_public_id, invite_code, created_at, updated_at
      FROM chat_requests
      WHERE public_id=?
    `),
    listByDevice: db.prepare(`
      SELECT public_id, sender_device_id, target_device_id, status, room_public_id, invite_code, created_at, updated_at
      FROM chat_requests
      WHERE sender_device_id=? OR target_device_id=?
      ORDER BY id DESC
      LIMIT ?
    `),
    acceptPending: db.prepare(`
      UPDATE chat_requests
      SET status='accepted', room_public_id=?, invite_code=?, updated_at=datetime('now')
      WHERE public_id=? AND target_device_id=? AND status='pending'
    `),
    rejectPending: db.prepare(`
      UPDATE chat_requests
      SET status='rejected', updated_at=datetime('now')
      WHERE public_id=? AND target_device_id=? AND status='pending'
    `),
    blockPending: db.prepare(`
      UPDATE chat_requests
      SET status='blocked', updated_at=datetime('now')
      WHERE public_id=? AND target_device_id=? AND status='pending'
    `),
    insertBlock: db.prepare(`
      INSERT OR IGNORE INTO chat_request_blocks
        (blocker_device_id, blocked_device_id)
      VALUES (?, ?)
    `),
    isBlocked: db.prepare(`
      SELECT 1 AS blocked
      FROM chat_request_blocks
      WHERE blocker_device_id=? AND blocked_device_id=?
      LIMIT 1
    `)
  };

  function resolveTarget(usernameValue) {
    const syntax = validateUsernameSyntax(usernameValue);
    if (!syntax.ok) return { ok: false, code: 'USERNAME_INVALID' };
    const profile = rq.profileByUsername.get(syntax.username);
    return profile
      ? { ok: true, username: syntax.username, profile }
      : { ok: false, code: 'TARGET_NOT_FOUND', username: syntax.username };
  }

  function publicProfile(profile) {
    if (!profile) return null;
    return {
      displayName: profile.display_name || profile.username || 'Пользователь FPChat',
      username: profile.username || null,
      role: profile.role || 'user'
    };
  }

  function pendingState(senderDeviceId, targetDeviceId) {
    const row = rq.pendingBetween.get(
      senderDeviceId,
      targetDeviceId,
      targetDeviceId,
      senderDeviceId
    );
    if (!row) return null;
    const outgoing = row.sender_device_id === senderDeviceId;
    return {
      requestId: row.public_id,
      direction: outgoing ? 'outgoing' : 'incoming',
      status: row.status,
      createdAt: row.created_at
    };
  }

  function effectiveStatus(row) {
    if (!row) return 'pending';
    if (row.status !== 'accepted' || !row.invite_code) return row.status;
    const invite = roomQ.findInviteByCode.get(row.invite_code);
    if (invite?.used_at && invite.used_by_device_id === row.sender_device_id) return 'connected';
    return 'accepted';
  }

  function requestDto(row, viewerDeviceId) {
    const direction = row.sender_device_id === viewerDeviceId ? 'outgoing' : 'incoming';
    const peerDeviceId = direction === 'outgoing' ? row.target_device_id : row.sender_device_id;
    const peer = publicProfile(rq.profileByDevice.get(peerDeviceId));
    let status = effectiveStatus(row);
    // Do not disclose a block to the blocked sender. From their side it is simply rejected.
    if (direction === 'outgoing' && status === 'blocked') status = 'rejected';
    return {
      requestId: row.public_id,
      direction,
      status,
      peer,
      roomPublicId: row.room_public_id || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function addResultEvent(row, eventType, statusForSender) {
    const targetProfile = rq.profileByDevice.get(row.target_device_id);
    const result = systemEvents.add({
      deviceId: row.sender_device_id,
      eventType,
      refType: 'chat_request',
      refId: row.public_id,
      dedupeKey: `chat-request-result:${row.public_id}:${eventType}`,
      payload: {
        requestId: row.public_id,
        status: statusForSender,
        target: publicProfile(targetProfile),
        roomPublicId: row.room_public_id || null
      }
    });
    if (!result.ok) throw new Error('failed to create chat request result event');
  }

  const createRequestTx = db.transaction((senderProfile, targetProfile) => {
    const existing = pendingState(senderProfile.device_id, targetProfile.device_id);
    if (existing) return { ok: false, existing };
    if (rq.isBlocked.get(targetProfile.device_id, senderProfile.device_id)) {
      return { ok: false, blocked: true };
    }

    const publicId = crypto.randomBytes(18).toString('base64url');
    rq.insert.run(publicId, senderProfile.device_id, targetProfile.device_id);
    const request = rq.byPublicId.get(publicId);

    const eventResult = systemEvents.add({
      deviceId: targetProfile.device_id,
      eventType: 'chat_request_received',
      refType: 'chat_request',
      refId: publicId,
      dedupeKey: `chat-request:${publicId}`,
      payload: {
        requestId: publicId,
        status: 'pending',
        sender: publicProfile(senderProfile)
      }
    });
    if (!eventResult.ok) throw new Error('failed to create system event');

    return { ok: true, request };
  });

  const acceptRequestTx = db.transaction((requestId, targetDeviceId, roomPublicId, inviteCode) => {
    const update = rq.acceptPending.run(roomPublicId, inviteCode, requestId, targetDeviceId);
    if (!update.changes) return { ok: false };
    const row = rq.byPublicId.get(requestId);
    addResultEvent(row, 'chat_request_accepted', 'accepted');
    return { ok: true, row };
  });

  const rejectRequestTx = db.transaction((requestId, targetDeviceId) => {
    const update = rq.rejectPending.run(requestId, targetDeviceId);
    if (!update.changes) return { ok: false };
    const row = rq.byPublicId.get(requestId);
    addResultEvent(row, 'chat_request_rejected', 'rejected');
    return { ok: true, row };
  });

  const blockRequestTx = db.transaction((requestId, targetDeviceId, senderDeviceId) => {
    const update = rq.blockPending.run(requestId, targetDeviceId);
    if (!update.changes) return { ok: false };
    rq.insertBlock.run(targetDeviceId, senderDeviceId);
    const row = rq.byPublicId.get(requestId);
    addResultEvent(row, 'chat_request_rejected', 'rejected');
    return { ok: true, row };
  });

  app.get('/api/chat-requests/status', (req, res) => {
    const deviceId = safeDeviceId(req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });

    const target = resolveTarget(req.query?.targetUsername);
    if (!target.ok) {
      const status = target.code === 'TARGET_NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ ok: false, code: target.code });
    }

    const senderProfile = rq.profileByDevice.get(deviceId);
    const isSelf = target.profile.device_id === deviceId;
    const pending = isSelf ? null : pendingState(deviceId, target.profile.device_id);
    const unavailable = !isSelf && Boolean(rq.isBlocked.get(target.profile.device_id, deviceId));

    return res.json({
      ok: true,
      senderHasProfile: Boolean(senderProfile?.username),
      isSelf,
      pending,
      canSend: Boolean(senderProfile?.username) && !isSelf && !pending && !unavailable
    });
  });

  app.get('/api/chat-requests/mine', (req, res) => {
    const deviceId = safeDeviceId(req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit) || 100));
    const requests = rq.listByDevice.all(deviceId, deviceId, limit).map((row) => requestDto(row, deviceId));
    return res.json({ ok: true, requests });
  });

  app.post('/api/chat-requests', (req, res) => {
    const senderDeviceId = safeDeviceId(req.body?.senderDeviceId);
    if (!senderDeviceId) {
      return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });
    }

    const senderProfile = rq.profileByDevice.get(senderDeviceId);
    if (!senderProfile?.username) {
      return res.status(409).json({
        ok: false,
        code: 'SENDER_PROFILE_REQUIRED',
        error: 'sender username profile required'
      });
    }

    const target = resolveTarget(req.body?.targetUsername);
    if (!target.ok) {
      const status = target.code === 'TARGET_NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ ok: false, code: target.code });
    }
    if (target.profile.device_id === senderDeviceId) {
      return res.status(400).json({ ok: false, code: 'CHAT_REQUEST_SELF' });
    }
    if (rq.isBlocked.get(target.profile.device_id, senderDeviceId)) {
      return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_NOT_AVAILABLE' });
    }

    try {
      const result = createRequestTx.immediate(senderProfile, target.profile);
      if (!result.ok && result.blocked) {
        return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_NOT_AVAILABLE' });
      }
      if (!result.ok && result.existing) {
        const outgoing = result.existing.direction === 'outgoing';
        return res.status(409).json({
          ok: false,
          code: outgoing ? 'CHAT_REQUEST_ALREADY_PENDING' : 'CHAT_REQUEST_INCOMING_PENDING',
          request: result.existing
        });
      }

      return res.status(201).json({
        ok: true,
        request: {
          id: result.request.public_id,
          status: result.request.status,
          targetUsername: target.profile.username,
          createdAt: result.request.created_at
        }
      });
    } catch (error) {
      if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
        const pending = pendingState(senderDeviceId, target.profile.device_id);
        return res.status(409).json({
          ok: false,
          code: 'CHAT_REQUEST_ALREADY_PENDING',
          request: pending
        });
      }
      console.error('Chat request create failed', error);
      return res.status(500).json({ ok: false, code: 'CHAT_REQUEST_CREATE_FAILED' });
    }
  });

  app.post('/api/chat-requests/:requestId/accept', (req, res) => {
    const requestId = safeRequestId(req.params.requestId);
    const targetDeviceId = safeDeviceId(req.body?.targetDeviceId);
    const roomPublicId = safeRoomPublicId(req.body?.roomPublicId);
    const inviteCode = safeInviteCode(req.body?.inviteCode);
    if (!requestId || !targetDeviceId || !roomPublicId || !inviteCode) {
      return res.status(400).json({ ok: false, code: 'CHAT_REQUEST_ACCEPT_FIELDS_REQUIRED' });
    }

    const current = rq.byPublicId.get(requestId);
    if (!current) return res.status(404).json({ ok: false, code: 'CHAT_REQUEST_NOT_FOUND' });
    if (current.target_device_id !== targetDeviceId) {
      return res.status(403).json({ ok: false, code: 'CHAT_REQUEST_FORBIDDEN' });
    }
    if (current.status !== 'pending') {
      return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ALREADY_RESOLVED', status: effectiveStatus(current) });
    }

    const room = roomQ.findRoomByPublicId.get(roomPublicId);
    if (!room || (typeof isRoomOpen === 'function' && !isRoomOpen(room))) {
      return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ROOM_INVALID' });
    }
    const targetParticipant = roomQ.findParticipant.get(room.id, targetDeviceId);
    if (!targetParticipant) {
      return res.status(403).json({ ok: false, code: 'CHAT_REQUEST_ROOM_OWNER_MISMATCH' });
    }
    const participants = roomQ.listParticipantsByRoom.all(room.id);
    if (participants.length !== 1 || participants[0].device_id !== targetDeviceId) {
      return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ROOM_NOT_FRESH' });
    }

    const invite = roomQ.findInviteByCode.get(inviteCode);
    if (!invite || Number(invite.room_id) !== Number(room.id) || invite.revoked || invite.used_at || !invite.room_secret) {
      return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_INVITE_INVALID' });
    }
    const expiresAt = new Date(`${String(invite.expires_at || '').replace(' ', 'T')}Z`).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_INVITE_EXPIRED' });
    }

    try {
      const result = acceptRequestTx.immediate(requestId, targetDeviceId, roomPublicId, inviteCode);
      if (!result.ok) {
        const latest = rq.byPublicId.get(requestId);
        return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ALREADY_RESOLVED', status: effectiveStatus(latest) });
      }
      return res.json({ ok: true, request: requestDto(result.row, targetDeviceId) });
    } catch (error) {
      console.error('Chat request accept failed', error);
      return res.status(500).json({ ok: false, code: 'CHAT_REQUEST_ACCEPT_FAILED' });
    }
  });

  app.post('/api/chat-requests/:requestId/reject', (req, res) => {
    const requestId = safeRequestId(req.params.requestId);
    const targetDeviceId = safeDeviceId(req.body?.targetDeviceId);
    if (!requestId || !targetDeviceId) {
      return res.status(400).json({ ok: false, code: 'CHAT_REQUEST_REJECT_FIELDS_REQUIRED' });
    }
    const current = rq.byPublicId.get(requestId);
    if (!current) return res.status(404).json({ ok: false, code: 'CHAT_REQUEST_NOT_FOUND' });
    if (current.target_device_id !== targetDeviceId) {
      return res.status(403).json({ ok: false, code: 'CHAT_REQUEST_FORBIDDEN' });
    }
    if (current.status !== 'pending') {
      return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ALREADY_RESOLVED', status: effectiveStatus(current) });
    }
    try {
      const result = rejectRequestTx.immediate(requestId, targetDeviceId);
      if (!result.ok) return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ALREADY_RESOLVED' });
      return res.json({ ok: true, request: requestDto(result.row, targetDeviceId) });
    } catch (error) {
      console.error('Chat request reject failed', error);
      return res.status(500).json({ ok: false, code: 'CHAT_REQUEST_REJECT_FAILED' });
    }
  });

  app.post('/api/chat-requests/:requestId/block', (req, res) => {
    const requestId = safeRequestId(req.params.requestId);
    const targetDeviceId = safeDeviceId(req.body?.targetDeviceId);
    if (!requestId || !targetDeviceId) {
      return res.status(400).json({ ok: false, code: 'CHAT_REQUEST_BLOCK_FIELDS_REQUIRED' });
    }
    const current = rq.byPublicId.get(requestId);
    if (!current) return res.status(404).json({ ok: false, code: 'CHAT_REQUEST_NOT_FOUND' });
    if (current.target_device_id !== targetDeviceId) {
      return res.status(403).json({ ok: false, code: 'CHAT_REQUEST_FORBIDDEN' });
    }
    if (current.status !== 'pending') {
      return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ALREADY_RESOLVED', status: effectiveStatus(current) });
    }
    try {
      const result = blockRequestTx.immediate(requestId, targetDeviceId, current.sender_device_id);
      if (!result.ok) return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ALREADY_RESOLVED' });
      return res.json({ ok: true, request: requestDto(result.row, targetDeviceId) });
    } catch (error) {
      console.error('Chat request block failed', error);
      return res.status(500).json({ ok: false, code: 'CHAT_REQUEST_BLOCK_FAILED' });
    }
  });

  app.post('/api/chat-requests/:requestId/claim', (req, res) => {
    const requestId = safeRequestId(req.params.requestId);
    const senderDeviceId = safeDeviceId(req.body?.senderDeviceId);
    if (!requestId || !senderDeviceId) {
      return res.status(400).json({ ok: false, code: 'CHAT_REQUEST_CLAIM_FIELDS_REQUIRED' });
    }
    const row = rq.byPublicId.get(requestId);
    if (!row) return res.status(404).json({ ok: false, code: 'CHAT_REQUEST_NOT_FOUND' });
    if (row.sender_device_id !== senderDeviceId) {
      return res.status(403).json({ ok: false, code: 'CHAT_REQUEST_FORBIDDEN' });
    }
    if (row.status !== 'accepted' || !row.room_public_id || !row.invite_code) {
      return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_NOT_ACCEPTED', status: effectiveStatus(row) });
    }

    const room = roomQ.findRoomByPublicId.get(row.room_public_id);
    if (!room || (typeof isRoomOpen === 'function' && !isRoomOpen(room))) {
      return res.status(410).json({ ok: false, code: 'CHAT_REQUEST_ROOM_CLOSED' });
    }
    const existingParticipant = roomQ.findParticipant.get(room.id, senderDeviceId);
    if (existingParticipant) {
      return res.json({ ok: true, alreadyJoined: true, roomPublicId: room.public_id });
    }

    const invite = roomQ.findInviteByCode.get(row.invite_code);
    if (!invite || Number(invite.room_id) !== Number(room.id) || invite.revoked || !invite.room_secret) {
      if (invite?.used_at && invite.used_by_device_id === senderDeviceId) {
        return res.json({ ok: true, alreadyJoined: true, roomPublicId: room.public_id });
      }
      return res.status(410).json({ ok: false, code: 'CHAT_REQUEST_INVITE_UNAVAILABLE' });
    }
    if (invite.used_at) {
      return res.status(410).json({ ok: false, code: 'CHAT_REQUEST_INVITE_UNAVAILABLE' });
    }
    const expiresAt = new Date(`${String(invite.expires_at || '').replace(' ', 'T')}Z`).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return res.status(410).json({ ok: false, code: 'CHAT_REQUEST_INVITE_EXPIRED' });
    }

    return res.json({
      ok: true,
      inviteCode: row.invite_code,
      roomPublicId: room.public_id
    });
  });
}

module.exports = {
  installChatRequestsServer,
  ensureChatRequestsSchema
};
