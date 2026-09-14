/* Build 145: isolated chat-request transport.
   Requests are separate from rooms/messages. No room is created until a later explicit accept action. */
const crypto = require('crypto');
const { ensureUsernameProfileSchema } = require('./username-server');
const { validateUsernameSyntax } = require('./username-rules');
const { createSystemEventStore } = require('./system-events-server');

function safeDeviceId(value) {
  const text = String(value || '').trim();
  if (text.length < 8 || text.length > 128) return '';
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
}

function ensureChatRequestsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      sender_device_id TEXT NOT NULL,
      target_device_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_requests_sender
      ON chat_requests(sender_device_id, id DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_requests_target
      ON chat_requests(target_device_id, id DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_requests_pending_pair
      ON chat_requests(sender_device_id, target_device_id)
      WHERE status='pending';
  `);
}

function installChatRequestsServer({ app, db }) {
  if (!app || !db) throw new Error('chat request dependencies are missing');
  if (app.__fpChatRequests145Installed) return;
  app.__fpChatRequests145Installed = true;

  ensureUsernameProfileSchema(db);
  ensureChatRequestsSchema(db);
  const systemEvents = createSystemEventStore(db);

  const q = {
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
      SELECT public_id, sender_device_id, target_device_id, status, created_at
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
      SELECT public_id, sender_device_id, target_device_id, status, created_at, updated_at
      FROM chat_requests
      WHERE public_id=?
    `)
  };

  function resolveTarget(usernameValue) {
    const syntax = validateUsernameSyntax(usernameValue);
    if (!syntax.ok) return { ok: false, code: 'USERNAME_INVALID' };
    const profile = q.profileByUsername.get(syntax.username);
    return profile
      ? { ok: true, username: syntax.username, profile }
      : { ok: false, code: 'TARGET_NOT_FOUND', username: syntax.username };
  }

  function pendingState(senderDeviceId, targetDeviceId) {
    const row = q.pendingBetween.get(
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

  const createRequestTx = db.transaction((senderProfile, targetProfile) => {
    const existing = pendingState(senderProfile.device_id, targetProfile.device_id);
    if (existing) return { ok: false, existing };

    const publicId = crypto.randomBytes(18).toString('base64url');
    q.insert.run(publicId, senderProfile.device_id, targetProfile.device_id);
    const request = q.byPublicId.get(publicId);

    const eventResult = systemEvents.add({
      deviceId: targetProfile.device_id,
      eventType: 'chat_request_received',
      refType: 'chat_request',
      refId: publicId,
      dedupeKey: `chat-request:${publicId}`,
      payload: {
        requestId: publicId,
        status: 'pending',
        sender: {
          displayName: senderProfile.display_name || senderProfile.username || 'Пользователь FPChat',
          username: senderProfile.username,
          role: senderProfile.role || 'user'
        }
      }
    });
    if (!eventResult.ok) throw new Error('failed to create system event');

    return { ok: true, request };
  });

  app.get('/api/chat-requests/status', (req, res) => {
    const deviceId = safeDeviceId(req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });

    const target = resolveTarget(req.query?.targetUsername);
    if (!target.ok) {
      const status = target.code === 'TARGET_NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ ok: false, code: target.code });
    }

    const senderProfile = q.profileByDevice.get(deviceId);
    const isSelf = target.profile.device_id === deviceId;
    const pending = isSelf ? null : pendingState(deviceId, target.profile.device_id);

    return res.json({
      ok: true,
      senderHasProfile: Boolean(senderProfile?.username),
      isSelf,
      pending,
      canSend: Boolean(senderProfile?.username) && !isSelf && !pending
    });
  });

  app.post('/api/chat-requests', (req, res) => {
    const senderDeviceId = safeDeviceId(req.body?.senderDeviceId);
    if (!senderDeviceId) {
      return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });
    }

    const senderProfile = q.profileByDevice.get(senderDeviceId);
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

    try {
      const result = createRequestTx.immediate(senderProfile, target.profile);
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
}

module.exports = {
  installChatRequestsServer,
  ensureChatRequestsSchema
};
