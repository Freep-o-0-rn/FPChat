/* Build 164: SQLite store for username chat requests, anti-spam and blacklist state. */
const crypto = require('crypto');
const { ensureUsernameProfileSchema } = require('./username-server');
const { createSystemEventStore } = require('./system-events-server');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const REJECTION_RESET_MS = 7 * DAY;
const REJECTION_COOLDOWNS_MS = [MINUTE, 15 * MINUTE, 60 * MINUTE, 24 * 60 * MINUTE];
const RATE_LIMITS = [
  { windowMs: MINUTE, limit: 3 },
  { windowMs: 10 * MINUTE, limit: 8 },
  { windowMs: 60 * MINUTE, limit: 20 }
];

function utcMs(value) {
  if (!value) return NaN;
  const text = String(value);
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text);
}
function utcIso(value) {
  const ms = utcMs(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function retryPayload(code, retryAtMs, extra = {}) {
  const retryAfterSeconds = Math.max(1, Math.ceil((retryAtMs - Date.now()) / 1000));
  return { ok: false, code, retryAfterSeconds, retryAt: new Date(retryAtMs).toISOString(), ...extra };
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
    CREATE INDEX IF NOT EXISTS idx_chat_requests_sender ON chat_requests(sender_device_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_requests_target ON chat_requests(target_device_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_requests_sender_created ON chat_requests(sender_device_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_requests_pair_status ON chat_requests(sender_device_id, target_device_id, status, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_requests_pending_pair
      ON chat_requests(sender_device_id, target_device_id) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS idx_chat_request_blocks_pair
      ON chat_request_blocks(blocker_device_id, blocked_device_id);
  `);

  const requestColumns = db.prepare('PRAGMA table_info(chat_requests)').all();
  for (const [name, type] of [['room_public_id', 'TEXT'], ['invite_code', 'TEXT'], ['expires_at', 'TEXT']]) {
    if (!requestColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE chat_requests ADD COLUMN ${name} ${type}`);
  }
  db.exec(`UPDATE chat_requests SET expires_at=COALESCE(expires_at, datetime(created_at, '+24 hours')) WHERE expires_at IS NULL`);

  const blockColumns = db.prepare('PRAGMA table_info(chat_request_blocks)').all();
  if (!blockColumns.some((column) => column.name === 'public_id')) db.exec('ALTER TABLE chat_request_blocks ADD COLUMN public_id TEXT');
  db.exec(`UPDATE chat_request_blocks SET public_id=lower(hex(randomblob(12))) WHERE public_id IS NULL OR public_id=''`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_request_blocks_public_id ON chat_request_blocks(public_id) WHERE public_id IS NOT NULL`);
}

function createChatRequestStore(db) {
  ensureUsernameProfileSchema(db);
  ensureChatRequestsSchema(db);
  const events = createSystemEventStore(db);
  const fields = 'public_id, sender_device_id, target_device_id, status, room_public_id, invite_code, expires_at, created_at, updated_at';
  const q = {
    profileByDevice: db.prepare(`
      SELECT p.device_id, p.username, p.username_normalized,
             COALESCE(NULLIF(i.display_name,''), NULLIF(p.display_name,'')) AS display_name,
             p.role
      FROM user_profiles p
      LEFT JOIN user_identities i ON i.device_id=p.device_id
      WHERE p.device_id=?
    `),
    profileByUsername: db.prepare(`
      SELECT p.device_id, p.username, p.username_normalized,
             COALESCE(NULLIF(i.display_name,''), NULLIF(p.display_name,'')) AS display_name,
             p.role
      FROM user_profiles p
      LEFT JOIN user_identities i ON i.device_id=p.device_id
      WHERE p.username_normalized=?
    `),
    byId: db.prepare(`SELECT ${fields} FROM chat_requests WHERE public_id=?`),
    byRoom: db.prepare(`SELECT ${fields} FROM chat_requests WHERE room_public_id=? ORDER BY id DESC LIMIT 1`),
    pendingBetween: db.prepare(`SELECT ${fields} FROM chat_requests WHERE status='pending' AND ((sender_device_id=? AND target_device_id=?) OR (sender_device_id=? AND target_device_id=?)) ORDER BY id DESC LIMIT 1`),
    listByDevice: db.prepare(`SELECT ${fields} FROM chat_requests WHERE sender_device_id=? OR target_device_id=? ORDER BY id DESC LIMIT ?`),
    listPending: db.prepare(`SELECT ${fields} FROM chat_requests WHERE status='pending' ORDER BY id ASC`),
    rejectionHistory: db.prepare(`SELECT status, updated_at FROM chat_requests WHERE sender_device_id=? AND target_device_id=? AND status IN ('rejected','accepted') ORDER BY id DESC LIMIT 32`),
    outgoingRecent: db.prepare(`SELECT created_at FROM chat_requests WHERE sender_device_id=? AND created_at >= datetime('now','-1 hour') ORDER BY id ASC`),
    pairReset: db.prepare(`SELECT reset_at FROM chat_request_pair_resets WHERE sender_device_id=? AND target_device_id=?`),
    upsertPairReset: db.prepare(`INSERT INTO chat_request_pair_resets(sender_device_id,target_device_id,reset_at) VALUES(?,?,datetime('now')) ON CONFLICT(sender_device_id,target_device_id) DO UPDATE SET reset_at=datetime('now')`),
    insert: db.prepare(`INSERT INTO chat_requests(public_id,sender_device_id,target_device_id,status,room_public_id,invite_code,expires_at) VALUES(?,?,?,'pending',?,?,?)`),
    accept: db.prepare(`UPDATE chat_requests SET status='accepted',updated_at=datetime('now') WHERE public_id=? AND target_device_id=? AND status='pending'`),
    reject: db.prepare(`UPDATE chat_requests SET status='rejected',updated_at=datetime('now') WHERE public_id=? AND target_device_id=? AND status='pending'`),
    block: db.prepare(`UPDATE chat_requests SET status='blocked',updated_at=datetime('now') WHERE public_id=? AND target_device_id=? AND status='pending'`),
    expire: db.prepare(`UPDATE chat_requests SET status='expired',updated_at=datetime('now') WHERE public_id=? AND status='pending'`),
    addBlock: db.prepare(`INSERT OR IGNORE INTO chat_request_blocks(public_id,blocker_device_id,blocked_device_id) VALUES(?,?,?)`),
    blocked: db.prepare(`SELECT 1 AS blocked FROM chat_request_blocks WHERE blocker_device_id=? AND blocked_device_id=? LIMIT 1`),
    blockRecord: db.prepare(`SELECT public_id, blocker_device_id, blocked_device_id, created_at FROM chat_request_blocks WHERE blocker_device_id=? AND blocked_device_id=? LIMIT 1`),
    blockById: db.prepare(`SELECT public_id, blocker_device_id, blocked_device_id, created_at FROM chat_request_blocks WHERE public_id=? AND blocker_device_id=? LIMIT 1`),
    listBlocks: db.prepare(`
      SELECT b.public_id, b.blocked_device_id, b.created_at,
             NULLIF(p.username,'') AS username,
             COALESCE(
               NULLIF(i.display_name,''),
               NULLIF(p.display_name,''),
               json_extract(se.payload_json,'$.sender.displayName')
             ) AS display_name,
             COALESCE(NULLIF(p.role,''),'user') AS role
      FROM chat_request_blocks b
      LEFT JOIN user_identities i ON i.device_id=b.blocked_device_id
      LEFT JOIN user_profiles p ON p.device_id=b.blocked_device_id
      LEFT JOIN chat_requests cr ON cr.id=(
        SELECT MAX(cr2.id)
        FROM chat_requests cr2
        WHERE cr2.sender_device_id=b.blocked_device_id
          AND cr2.target_device_id=b.blocker_device_id
          AND cr2.status='blocked'
      )
      LEFT JOIN system_events se
        ON se.device_id=b.blocker_device_id
       AND se.event_type='chat_request_received'
       AND se.ref_type='chat_request'
       AND se.ref_id=cr.public_id
      WHERE b.blocker_device_id=?
      ORDER BY b.id DESC
    `),
    deleteBlock: db.prepare(`DELETE FROM chat_request_blocks WHERE public_id=? AND blocker_device_id=?`)
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

  function rejectionState(senderId, targetId, nowMs = Date.now()) {
    const rows = q.rejectionHistory.all(senderId, targetId);
    const resetMs = utcMs(q.pairReset.get(senderId, targetId)?.reset_at);
    if (!rows.length || rows[0].status !== 'rejected') return { rejectCount: 0, active: false };
    const lastRejectedMs = utcMs(rows[0].updated_at);
    if (!Number.isFinite(lastRejectedMs) || (Number.isFinite(resetMs) && lastRejectedMs <= resetMs) || nowMs - lastRejectedMs >= REJECTION_RESET_MS) {
      return { rejectCount: 0, active: false };
    }
    let rejectCount = 0;
    let newerRejectedMs = null;
    for (const row of rows) {
      if (row.status === 'accepted') break;
      if (row.status !== 'rejected') continue;
      const rejectedMs = utcMs(row.updated_at);
      if (!Number.isFinite(rejectedMs)) break;
      if (Number.isFinite(resetMs) && rejectedMs <= resetMs) break;
      if (newerRejectedMs !== null && newerRejectedMs - rejectedMs >= REJECTION_RESET_MS) break;
      rejectCount += 1;
      newerRejectedMs = rejectedMs;
    }
    if (!rejectCount) return { rejectCount: 0, active: false };
    const durationMs = REJECTION_COOLDOWNS_MS[Math.min(rejectCount, REJECTION_COOLDOWNS_MS.length) - 1];
    const cooldownUntilMs = lastRejectedMs + durationMs;
    return {
      rejectCount,
      active: cooldownUntilMs > nowMs,
      lastRejectedAt: new Date(lastRejectedMs).toISOString(),
      cooldownUntil: new Date(cooldownUntilMs).toISOString(),
      retryAfterSeconds: cooldownUntilMs > nowMs ? Math.max(1, Math.ceil((cooldownUntilMs - nowMs) / 1000)) : 0
    };
  }

  function rateLimitState(senderId, nowMs = Date.now()) {
    const timestamps = q.outgoingRecent.all(senderId)
      .map((row) => utcMs(row.created_at))
      .filter(Number.isFinite);
    let retryAtMs = 0;
    let matchedRule = null;
    for (const rule of RATE_LIMITS) {
      const cutoff = nowMs - rule.windowMs;
      const recent = timestamps.filter((value) => value > cutoff);
      if (recent.length < rule.limit) continue;
      const candidate = recent[recent.length - rule.limit] + rule.windowMs;
      if (candidate > retryAtMs) {
        retryAtMs = candidate;
        matchedRule = rule;
      }
    }
    if (!matchedRule || retryAtMs <= nowMs) return { active: false };
    return {
      active: true,
      retryAt: new Date(retryAtMs).toISOString(),
      retryAfterSeconds: Math.max(1, Math.ceil((retryAtMs - nowMs) / 1000)),
      limit: matchedRule.limit,
      windowSeconds: Math.round(matchedRule.windowMs / 1000)
    };
  }

  function sendGuard(senderId, targetId, nowMs = Date.now()) {
    const rejection = rejectionState(senderId, targetId, nowMs);
    if (rejection.active) return retryPayload('CHAT_REQUEST_COOLDOWN', Date.parse(rejection.cooldownUntil), { rejectCount: rejection.rejectCount });
    const rate = rateLimitState(senderId, nowMs);
    if (rate.active) return retryPayload('CHAT_REQUEST_RATE_LIMIT', Date.parse(rate.retryAt), { limit: rate.limit, windowSeconds: rate.windowSeconds });
    return { ok: true, rejectCount: rejection.rejectCount };
  }

  function dto(row, viewer) {
    const direction = row.sender_device_id === viewer ? 'outgoing' : 'incoming';
    const peerId = direction === 'outgoing' ? row.target_device_id : row.sender_device_id;
    const status = row.status === 'blocked' && direction === 'outgoing' ? 'rejected' : row.status;
    return { requestId: row.public_id, direction, status, peer: publicProfile(q.profileByDevice.get(peerId)), roomPublicId: row.room_public_id || null, expiresAt: utcIso(row.expires_at), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  function blockDto(row) {
    return {
      blockId: row.public_id,
      blockedAt: utcIso(row.created_at),
      user: {
        displayName: row.display_name || row.username || 'Пользователь FPChat',
        username: row.username || null,
        role: row.role || 'user'
      }
    };
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
      const guard = sendGuard(sender.device_id, target.device_id);
      if (!guard.ok) return { ok: false, antiSpam: guard };
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
    block: db.transaction((id, targetId, senderId) => {
      const r = q.block.run(id, targetId);
      if (!r.changes) return { ok: false };
      q.addBlock.run(crypto.randomBytes(18).toString('base64url'), targetId, senderId);
      const row = q.byId.get(id);
      resultEvent(row, 'chat_request_rejected', 'rejected');
      return { ok: true, row };
    }),
    unblock: db.transaction((blockId, blockerId) => {
      const block = q.blockById.get(blockId, blockerId);
      if (!block) return { ok: false };
      const deleted = q.deleteBlock.run(blockId, blockerId);
      if (!deleted.changes) return { ok: false };
      q.upsertPairReset.run(block.blocked_device_id, blockerId);
      return { ok: true, block };
    }),
    expire: db.transaction((id) => { const r = q.expire.run(id); if (!r.changes) return { ok: false }; const row = q.byId.get(id); expiredEvents(row); return { ok: true, row }; })
  };

  return { q, tx, publicProfile, pendingBetween, rejectionState, rateLimitState, sendGuard, dto, blockDto, utcMs, utcIso };
}

module.exports = { ensureChatRequestsSchema, createChatRequestStore, utcMs, utcIso };
