/* Build 162: @username requests with privacy, anti-spam, blacklist and duplicate-chat guard. */
const { validateUsernameSyntax } = require('./username-rules');
const { ensureUserPrivacySchema } = require('./username-server');
const { createChatRequestStore, ensureChatRequestsSchema, utcMs } = require('./chat-requests-store147');

const cleanId = (value, min = 8, max = 128) => {
  const text = String(value || '').trim();
  return text.length >= min && text.length <= max && /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
};
const cleanToken = (value, min = 16, max = 96) => {
  const text = String(value || '').trim();
  return text.length >= min && text.length <= max && /^[A-Za-z0-9_-]+$/.test(text) ? text : '';
};
const cleanRoomList = (value) => {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw.map((item) => cleanToken(item, 8)).filter(Boolean))].slice(0, 100);
};

function installChatRequestsServer({ app, db, q: roomQ, isRoomOpen, removeRoomCascade }) {
  if (!app || !db || typeof removeRoomCascade !== 'function') throw new Error('chat request dependencies are missing');
  for (const key of ['findRoomByPublicId', 'findInviteByCode', 'findParticipant', 'listParticipantsByRoom', 'findRecoveryByRoomDevice']) {
    if (!roomQ?.[key]) throw new Error(`chat request room dependency is missing: ${key}`);
  }
  if (app.__fpChatRequests147Installed) return;
  app.__fpChatRequests147Installed = true;

  ensureUserPrivacySchema(db);
  const privacyByDevice = db.prepare(`
    SELECT allow_chat_requests
    FROM user_privacy_settings
    WHERE device_id=?
  `);
  const allowsChatRequests = (deviceId) => Number(privacyByDevice.get(deviceId)?.allow_chat_requests ?? 1) !== 0;

  const store = createChatRequestStore(db);
  const { q, tx } = store;

  function resolveTarget(value) {
    const parsed = validateUsernameSyntax(value);
    if (!parsed.ok) return { ok: false, code: 'USERNAME_INVALID' };
    const profile = q.profileByUsername.get(parsed.username);
    return profile ? { ok: true, profile } : { ok: false, code: 'TARGET_NOT_FOUND' };
  }
  const roomFor = (row) => row?.room_public_id ? roomQ.findRoomByPublicId.get(row.room_public_id) : null;
  const targetJoined = (row) => { const room = roomFor(row); return Boolean(room && roomQ.findParticipant.get(room.id, row.target_device_id)); };
  const antiSpamJson = (guard) => ({
    ok: false,
    code: guard.code,
    retryAfterSeconds: guard.retryAfterSeconds,
    retryAt: guard.retryAt,
    ...(Number.isFinite(guard.rejectCount) ? { rejectCount: guard.rejectCount } : {}),
    ...(Number.isFinite(guard.limit) ? { limit: guard.limit } : {}),
    ...(Number.isFinite(guard.windowSeconds) ? { windowSeconds: guard.windowSeconds } : {})
  });

  function findExistingListedChat(senderId, targetId, listedRoomIds) {
    for (const publicId of cleanRoomList(listedRoomIds)) {
      const room = roomQ.findRoomByPublicId.get(publicId);
      if (!room || (typeof isRoomOpen === 'function' && !isRoomOpen(room))) continue;
      if (!roomQ.findParticipant.get(room.id, senderId)) continue;
      if (!roomQ.findParticipant.get(room.id, targetId)) continue;
      return room.public_id;
    }
    return null;
  }

  function removePendingRoom(row) {
    const room = roomFor(row);
    if (!room) return true;
    const participants = roomQ.listParticipantsByRoom.all(room.id);
    if (participants.some((p) => p.device_id === row.target_device_id)) return false;
    if (participants.length !== 1 || participants[0].device_id !== row.sender_device_id) return false;
    removeRoomCascade(room.id);
    return true;
  }

  function shouldExpire(row) {
    if (!row || row.status !== 'pending') return false;
    if (!Number.isFinite(utcMs(row.expires_at)) || utcMs(row.expires_at) <= Date.now()) return true;
    const room = roomFor(row);
    if (!room || (typeof isRoomOpen === 'function' && !isRoomOpen(room))) return true;
    if (!roomQ.findParticipant.get(room.id, row.sender_device_id)) return true;
    const invite = row.invite_code ? roomQ.findInviteByCode.get(row.invite_code) : null;
    if (!invite || Number(invite.room_id) !== Number(room.id) || invite.revoked) return true;
    if (invite.used_at) return invite.used_by_device_id !== row.target_device_id;
    if (!invite.room_secret) return true;
    return !Number.isFinite(utcMs(invite.expires_at)) || utcMs(invite.expires_at) <= Date.now();
  }

  function finalizeJoined(row) {
    if (!row || row.status !== 'pending' || !targetJoined(row)) return false;
    return Boolean(tx.accept.immediate(row.public_id, row.target_device_id).ok);
  }

  function reconcile() {
    for (const row of q.listPending.all()) {
      try {
        if (finalizeJoined(row) || !shouldExpire(row)) continue;
        const result = tx.expire.immediate(row.public_id);
        if (result.ok) {
          try { removePendingRoom(result.row); } catch (error) { console.error('Chat request expired-room cleanup failed', error); }
        }
      } catch (error) { console.error('Chat request reconcile failed', error); }
    }
  }

  function validateSenderRoom(senderId, publicId, inviteCode) {
    const room = roomQ.findRoomByPublicId.get(publicId);
    if (!room || (typeof isRoomOpen === 'function' && !isRoomOpen(room))) return { ok: false, code: 'CHAT_REQUEST_ROOM_INVALID' };
    if (!roomQ.findParticipant.get(room.id, senderId)) return { ok: false, code: 'CHAT_REQUEST_ROOM_OWNER_MISMATCH' };
    const participants = roomQ.listParticipantsByRoom.all(room.id);
    if (participants.length !== 1 || participants[0].device_id !== senderId) return { ok: false, code: 'CHAT_REQUEST_ROOM_NOT_FRESH' };
    if (!roomQ.findRecoveryByRoomDevice.get(room.id, senderId)) return { ok: false, code: 'CHAT_REQUEST_RECOVERY_MISSING' };
    if (q.byRoom.get(publicId)) return { ok: false, code: 'CHAT_REQUEST_ROOM_ALREADY_BOUND' };
    const invite = roomQ.findInviteByCode.get(inviteCode);
    if (!invite || Number(invite.room_id) !== Number(room.id) || invite.revoked || invite.used_at || !invite.room_secret) return { ok: false, code: 'CHAT_REQUEST_INVITE_INVALID' };
    if (!Number.isFinite(utcMs(invite.expires_at)) || utcMs(invite.expires_at) <= Date.now()) return { ok: false, code: 'CHAT_REQUEST_INVITE_EXPIRED' };
    return { ok: true, room, invite };
  }

  reconcile();
  const timer = setInterval(reconcile, 30000);
  timer.unref?.();

  app.get('/api/chat-requests/status', (req, res) => {
    reconcile();
    const deviceId = cleanId(req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });
    const target = resolveTarget(req.query?.targetUsername);
    if (!target.ok) return res.status(target.code === 'TARGET_NOT_FOUND' ? 404 : 400).json({ ok: false, code: target.code });
    const sender = q.profileByDevice.get(deviceId);
    const isSelf = target.profile.device_id === deviceId;
    const existingChatRoomId = isSelf ? null : findExistingListedChat(deviceId, target.profile.device_id, req.query?.listedRooms);
    const pending = isSelf || existingChatRoomId ? null : store.pendingBetween(deviceId, target.profile.device_id);
    const blockedByTarget = !isSelf && Boolean(q.blocked.get(target.profile.device_id, deviceId));
    const yourBlock = !isSelf ? q.blockRecord.get(deviceId, target.profile.device_id) : null;
    const targetAllowsRequests = isSelf || allowsChatRequests(target.profile.device_id);
    const baseCanSend = Boolean(sender?.username) && !isSelf && !existingChatRoomId && !pending && !blockedByTarget && !yourBlock && targetAllowsRequests;
    const restriction = baseCanSend ? store.sendGuard(deviceId, target.profile.device_id) : null;
    return res.json({
      ok: true,
      senderHasProfile: Boolean(sender?.username),
      isSelf,
      existingChatRoomId,
      pending,
      youBlockedTarget: Boolean(yourBlock),
      blockId: yourBlock?.public_id || null,
      canSend: baseCanSend && Boolean(restriction?.ok),
      restriction: restriction && !restriction.ok ? antiSpamJson(restriction) : null
    });
  });

  app.get('/api/chat-requests/blocks', (req, res) => {
    const deviceId = cleanId(req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });
    const blocks = q.listBlocks.all(deviceId).slice(0, 250).map(store.blockDto);
    return res.json({ ok: true, blocks });
  });

  app.delete('/api/chat-requests/blocks/:blockId', (req, res) => {
    const deviceId = cleanId(req.body?.deviceId);
    const blockId = cleanToken(req.params.blockId, 16, 128);
    if (!deviceId || !blockId) return res.status(400).json({ ok: false, code: 'CHAT_REQUEST_UNBLOCK_FIELDS_REQUIRED' });
    try {
      const result = tx.unblock.immediate(blockId, deviceId);
      if (!result.ok) return res.status(404).json({ ok: false, code: 'CHAT_REQUEST_BLOCK_NOT_FOUND' });
      return res.json({ ok: true });
    } catch (error) {
      console.error('Chat request unblock failed', error);
      return res.status(500).json({ ok: false, code: 'CHAT_REQUEST_UNBLOCK_FAILED' });
    }
  });

  app.get('/api/chat-requests/mine', (req, res) => {
    reconcile();
    const deviceId = cleanId(req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit) || 100));
    return res.json({ ok: true, requests: q.listByDevice.all(deviceId, deviceId, limit).map((row) => store.dto(row, deviceId)) });
  });

  app.post('/api/chat-requests', (req, res) => {
    reconcile();
    const senderId = cleanId(req.body?.senderDeviceId);
    const roomId = cleanToken(req.body?.roomPublicId, 8);
    const inviteCode = cleanToken(req.body?.inviteCode);
    if (!senderId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });
    if (!roomId || !inviteCode) return res.status(400).json({ ok: false, code: 'CHAT_REQUEST_ROOM_REQUIRED' });
    const sender = q.profileByDevice.get(senderId);
    if (!sender?.username) return res.status(409).json({ ok: false, code: 'SENDER_PROFILE_REQUIRED' });
    const target = resolveTarget(req.body?.targetUsername);
    if (!target.ok) return res.status(target.code === 'TARGET_NOT_FOUND' ? 404 : 400).json({ ok: false, code: target.code });
    if (target.profile.device_id === senderId) return res.status(400).json({ ok: false, code: 'CHAT_REQUEST_SELF' });

    const existingChatRoomId = findExistingListedChat(senderId, target.profile.device_id, req.body?.listedRoomIds);
    if (existingChatRoomId) return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_EXISTING_CHAT', roomPublicId: existingChatRoomId });

    const yourBlock = q.blockRecord.get(senderId, target.profile.device_id);
    if (yourBlock) return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_BLOCKED_BY_YOU', blockId: yourBlock.public_id });
    if (!allowsChatRequests(target.profile.device_id)) return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_NOT_AVAILABLE' });
    if (q.blocked.get(target.profile.device_id, senderId)) return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_NOT_AVAILABLE' });
    const existing = store.pendingBetween(senderId, target.profile.device_id);
    if (existing) return res.status(409).json({ ok: false, code: existing.direction === 'outgoing' ? 'CHAT_REQUEST_ALREADY_PENDING' : 'CHAT_REQUEST_INCOMING_PENDING', request: existing });
    const guard = store.sendGuard(senderId, target.profile.device_id);
    if (!guard.ok) return res.status(429).json(antiSpamJson(guard));
    const binding = validateSenderRoom(senderId, roomId, inviteCode);
    if (!binding.ok) return res.status(409).json({ ok: false, code: binding.code });
    try {
      const result = tx.create.immediate(sender, target.profile, roomId, inviteCode, binding.invite.expires_at);
      if (!result.ok) {
        if (result.blocked) return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_NOT_AVAILABLE' });
        if (result.antiSpam) return res.status(429).json(antiSpamJson(result.antiSpam));
        if (result.roomBound) return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ROOM_ALREADY_BOUND' });
        if (result.existing) return res.status(409).json({ ok: false, code: result.existing.direction === 'outgoing' ? 'CHAT_REQUEST_ALREADY_PENDING' : 'CHAT_REQUEST_INCOMING_PENDING', request: result.existing });
      }
      return res.status(201).json({ ok: true, request: { id: result.row.public_id, status: result.row.status, targetUsername: target.profile.username, roomPublicId: result.row.room_public_id, expiresAt: store.utcIso(result.row.expires_at), createdAt: result.row.created_at } });
    } catch (error) {
      console.error('Chat request create failed', error);
      return res.status(500).json({ ok: false, code: 'CHAT_REQUEST_CREATE_FAILED' });
    }
  });

  app.post('/api/chat-requests/:requestId/claim', (req, res) => {
    reconcile();
    const id = cleanToken(req.params.requestId);
    const targetId = cleanId(req.body?.targetDeviceId);
    if (!id || !targetId) return res.status(400).json({ ok: false, code: 'CHAT_REQUEST_CLAIM_FIELDS_REQUIRED' });
    const row = q.byId.get(id);
    if (!row) return res.status(404).json({ ok: false, code: 'CHAT_REQUEST_NOT_FOUND' });
    if (row.target_device_id !== targetId) return res.status(403).json({ ok: false, code: 'CHAT_REQUEST_FORBIDDEN' });
    if (row.status === 'accepted' && targetJoined(row)) return res.json({ ok: true, alreadyJoined: true, roomPublicId: row.room_public_id });
    if (row.status !== 'pending') return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ALREADY_RESOLVED', status: store.dto(row, targetId).status });
    const room = roomFor(row);
    if (!room || (typeof isRoomOpen === 'function' && !isRoomOpen(room))) return res.status(410).json({ ok: false, code: 'CHAT_REQUEST_ROOM_CLOSED' });
    if (roomQ.findParticipant.get(room.id, targetId)) {
      tx.accept.immediate(id, targetId);
      return res.json({ ok: true, alreadyJoined: true, roomPublicId: row.room_public_id });
    }
    const participants = roomQ.listParticipantsByRoom.all(room.id);
    if (participants.length !== 1 || participants[0].device_id !== row.sender_device_id) return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ROOM_NOT_FRESH' });
    const invite = roomQ.findInviteByCode.get(row.invite_code);
    if (!invite || Number(invite.room_id) !== Number(room.id) || invite.revoked || invite.used_at || !invite.room_secret) return res.status(410).json({ ok: false, code: 'CHAT_REQUEST_INVITE_UNAVAILABLE' });
    if (utcMs(invite.expires_at) <= Date.now()) { reconcile(); return res.status(410).json({ ok: false, code: 'CHAT_REQUEST_INVITE_EXPIRED' }); }
    return res.json({ ok: true, inviteCode: row.invite_code, roomPublicId: room.public_id, expiresAt: store.utcIso(row.expires_at) });
  });

  app.post('/api/chat-requests/:requestId/complete', (req, res) => {
    reconcile();
    const id = cleanToken(req.params.requestId);
    const targetId = cleanId(req.body?.targetDeviceId);
    if (!id || !targetId) return res.status(400).json({ ok: false, code: 'CHAT_REQUEST_COMPLETE_FIELDS_REQUIRED' });
    let row = q.byId.get(id);
    if (!row) return res.status(404).json({ ok: false, code: 'CHAT_REQUEST_NOT_FOUND' });
    if (row.target_device_id !== targetId) return res.status(403).json({ ok: false, code: 'CHAT_REQUEST_FORBIDDEN' });
    if (row.status === 'accepted') return res.json({ ok: true, request: store.dto(row, targetId) });
    if (row.status !== 'pending') return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ALREADY_RESOLVED', status: store.dto(row, targetId).status });
    if (!targetJoined(row)) return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_JOIN_NOT_COMPLETED' });
    try {
      const result = tx.accept.immediate(id, targetId);
      row = result.ok ? result.row : q.byId.get(id);
      if (row?.status !== 'accepted') return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ALREADY_RESOLVED' });
      return res.json({ ok: true, request: store.dto(row, targetId) });
    } catch (error) { console.error('Chat request complete failed', error); return res.status(500).json({ ok: false, code: 'CHAT_REQUEST_COMPLETE_FAILED' }); }
  });

  for (const action of ['reject', 'block']) {
    app.post(`/api/chat-requests/:requestId/${action}`, (req, res) => {
      reconcile();
      const id = cleanToken(req.params.requestId);
      const targetId = cleanId(req.body?.targetDeviceId);
      if (!id || !targetId) return res.status(400).json({ ok: false, code: `CHAT_REQUEST_${action.toUpperCase()}_FIELDS_REQUIRED` });
      const current = q.byId.get(id);
      if (!current) return res.status(404).json({ ok: false, code: 'CHAT_REQUEST_NOT_FOUND' });
      if (current.target_device_id !== targetId) return res.status(403).json({ ok: false, code: 'CHAT_REQUEST_FORBIDDEN' });
      if (current.status !== 'pending') return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ALREADY_RESOLVED', status: store.dto(current, targetId).status });
      try {
        const result = action === 'block' ? tx.block.immediate(id, targetId, current.sender_device_id) : tx.reject.immediate(id, targetId);
        if (!result.ok) return res.status(409).json({ ok: false, code: 'CHAT_REQUEST_ALREADY_RESOLVED' });
        removePendingRoom(result.row);
        return res.json({ ok: true, request: store.dto(result.row, targetId) });
      } catch (error) {
        console.error(`Chat request ${action} failed`, error);
        return res.status(500).json({ ok: false, code: `CHAT_REQUEST_${action.toUpperCase()}_FAILED` });
      }
    });
  }
}

module.exports = { installChatRequestsServer, ensureChatRequestsSchema };
