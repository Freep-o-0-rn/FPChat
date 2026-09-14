/* Build 147: SQLite store for username chat requests. */
const crypto = require('crypto');
const { ensureUsernameProfileSchema } = require('./username-server');
const { createSystemEventStore } = require('./system-events-server');

function utcMs(value) {
  if (!value) return NaN;
  const text = String(value);
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text);
}
function utcIso(value) {
  const ms = utcMs(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
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
      expires_at TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_chat_requests_sender ON chat_requests(sender_device_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_requests_target ON chat_requests(target_device_id, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_requests_pending_pair
      ON chat_requests(sender_device_id, target_device_id) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS idx_chat_request_blocks_pair
      ON chat_request_blocks(blocker_device_id, blocked_device_id);
  `);
  const columns = db.prepare('PRAGMA table_info(chat_requests)').all();
  for (const [name, type] of [['room_public_id', 'TEXT'], ['invite_code', 'TEXT'], ['expires_at', 'TEXT']]) {
    if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE chat_requests ADD COLUMN ${name} ${type}`);
  }
  db.exec(`UPDATE chat_requests SET expires_at=COALESCE(expires_at, datetime(created_at, '+24 hours')) WHERE expires_at IS NULL`);
}

function createChatRequestStore(db) {
  ensureUsernameProfileSchema(db);
  ensureChatRequestsSchema(db);
  const events = createSystemEventStore(db);
  const fields = 'public_id, sender_device_id, target_device_id, status, room_public_id, invite_code, expires_at, created_at, updated_at';
  const q = {
    profileByDevice: db.prepare('SELECT device_id, username, username_normalized, display_name, role FROM user_profiles WHERE device_id=?'),
    profileByUsername: db.prepare('SELECT device_id, username, username_normalized, display_name, role FROM user_profiles WHERE username_normalized=?'),
    byId: db.prepare(`SELECT ${fields} FROM chat_requests WHERE public_id=?`),
    byRoom: db.prepare(`SELECT ${fields} FROM chat_requests WHERE room_public_id=? ORDER BY id DESC LIMIT 1`),
    pendingBetween: db.prepare(`SELECT ${fields} FROM chat_requests WHERE status='pending' AND ((sender_device_id=? AND target_device_id=?) OR (sender_device_id=? AND target_device_id=?)) ORDER BY id DESC LIMIT 1`),
    listByDevice: db.prepare(`SELECT ${fields} FROM chat_requests WHERE sender_device_id=? OR target_device_id=? ORDER BY id DESC LIMIT ?`),
    listPending: db.prepare(`SELECT ${fields} FROM chat_requests WHERE status='pending' ORDER BY id ASC`),
    insert: db.prepare(`INSERT INTO chat_requests(public_id,sender_device_id,target_device_id,status,room_public_id,invite_code,expires_at) VALUES(?,?,?,'pending',?,?,?)`),
    accept: db.prepare(`UPDATE chat_requests SET status='accepted',updated_at=datetime('now') WHERE public_id=? AND target_device_id=? AND status='pending'`),
    reject: db.prepare(`UPDATE chat_requests SET status='rejected',updated_at=datetime('now') WHERE public_id=? AND target_device_id=? AND status='pending'`),
    block: db.prepare(`UPDATE chat_requests SET status='blocked',updated_at=datetime('now') WHERE public_id=? AND target_device_id=? AND status='pending'`),
    expire: db.prepare(`UPDATE chat_requests SET status='expired',updated_at=datetime('now') WHERE public_id=? AND status='pending'`),
    addBlock: db.prepare(`INSERT OR IGNORE INTO chat_request_blocks(blocker_device_id,blocked_device_id) VALUES(?,?)`),
    blocked: db.prepare(`SELECT 1 AS blocked FROM chat_request_blocks WHERE blocker_device_id=? AND blocked_device_id=? LIMIT 1`)
  };

  const publicProfile = (profile) => profile ? ({
    displayName: profile.display_name || profile.username || 'Пользователь FPChat',
    username: profile.username || null,
    role: profile.role || 'user'
  }) : null;

  function pendingBetween(a, b) {
    const row = q.pendingBetween.get(a, b, b, a);
    if (!row) return null;
    return {
      requestId: row.public_id,
      direction: row.sender_device_id === a ? 'outgoing' : 'incoming',
      status: 'pending', roomPublicId: row.room_public_id || null,
      expiresAt: utcIso(row.expires_at), createdAt: row.created_at
    };
  }
  function dto(row, viewer) {
    const direction = row.sender_device_id === viewer ? 'outgoing' : 'incoming';
    const peerId = direction === 'outgoing' ? row.target_device_id : row.sender_device_id;
    const status = row.status === 'blocked' && direction === 'outgoing' ? 'rejected' : row.status;
    return { requestId: row.public_id, direction, status, peer: publicProfile(q.profileByDevice.get(peerId)), roomPublicId: row.room_public_id || null, expiresAt: utcIso(row.expires_at), createdAt: row.created_at, updatedAt: row.updated_at };
  }
  function resultEvent(row, type, status) {
    const target = publicProfile(q.profileByDevice.get(row.target_device_id));
    const result = events.add({ deviceId: row.sender_device_id, eventType: type, refType: 'chat_request', refId: row.public_id, dedupeKey: `chat-request-result:${row.public_id}:${type}`, payload: { requestId: row.public_id, status, target, roomPublicId: row.room_public_id || null, expiresAt: utcIso(row.expires_at) } });
    if (!result.ok) throw new Error('chat request result event failed');
  }
  function expiredEvents(row) {
    const common = { requestId: row.public_id, status: 'expired', roomPublicId: row.room_public_id || null, expiresAt: utcIso(row.expires_at) };
    const sender = events.add({ deviceId: row.sender_device_id, eventType: 'chat_request_expired', refType: 'chat_request', refId: row.public_id, dedupeKey: `chat-request-expired:${row.public_id}:sender`, payload: { ...common, target: publicProfile(q.profileByDevice.get(row.target_device_id)) } });
    const target = events.add({ deviceId: row.target_device_id, eventType: 'chat_request_expired', refType: 'chat_request', refId: row.public_id, dedupeKey: `chat-request-expired:${row.public_id}:target`, payload: { ...common, sender: publicProfile(q.profileByDevice.get(row.sender_device_id)) } });
    if (!sender.ok || !target.ok) throw new Error('chat request expiration event failed');
  }

  const tx = {
    create: db.transaction((sender, target, roomId, inviteCode, expiresAt) => {
      const existing = pendingBetween(sender.device_id, target.device_id);
      if (existing) return { ok: false, existing };
      if (q.blocked.get(target.device_id, sender.device_id)) return { ok: false, blocked: true };
      if (q.byRoom.get(roomId)) return { ok: false, roomBound: true };
      const id = crypto.randomBytes(18).toString('base64url');
      q.insert.run(id, sender.device_id, target.device_id, roomId, inviteCode, expiresAt);
      const row = q.byId.get(id);
      const event = events.add({ deviceId: target.device_id, eventType: 'chat_request_received', refType: 'chat_request', refId: id, dedupeKey: `chat-request:${id}`, payload: { requestId: id, status: 'pending', sender: publicProfile(sender), expiresAt: utcIso(expiresAt) } });
      if (!event.ok) throw new Error('chat request event failed');
      return { ok: true, row };
    }),
    accept: db.transaction((id, targetId) => { const r = q.accept.run(id, targetId); if (!r.changes) return { ok: false }; const row = q.byId.get(id); resultEvent(row, 'chat_request_accepted', 'accepted'); return { ok: true, row }; }),
    reject: db.transaction((id, targetId) => { const r = q.reject.run(id, targetId); if (!r.changes) return { ok: false }; const row = q.byId.get(id); resultEvent(row, 'chat_request_rejected', 'rejected'); return { ok: true, row }; }),
    block: db.transaction((id, targetId, senderId) => { const r = q.block.run(id, targetId); if (!r.changes) return { ok: false }; q.addBlock.run(targetId, senderId); const row = q.byId.get(id); resultEvent(row, 'chat_request_rejected', 'rejected'); return { ok: true, row }; }),
    expire: db.transaction((id) => { const r = q.expire.run(id); if (!r.changes) return { ok: false }; const row = q.byId.get(id); expiredEvents(row); return { ok: true, row }; })
  };

  return { q, tx, publicProfile, pendingBetween, dto, utcMs, utcIso };
}

module.exports = { ensureChatRequestsSchema, createChatRequestStore, utcMs, utcIso };
