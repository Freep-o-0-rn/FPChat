/* Build 165: private system-chat events for blocked invite attempts. */
const crypto = require('crypto');
const { ensureSystemEventsSchema } = require('./system-events-server');
const { ensureUsernameProfileSchema } = require('./username-server');

function safeDeviceId(value) {
  const text = String(value || '').trim();
  if (text.length < 8 || text.length > 128) return '';
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 64);
}

function parsePayload(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function createBlockedInviteEventStore(db, { userBlocks } = {}) {
  if (!db) throw new Error('blocked invite event database is required');
  if (!userBlocks?.relationship) throw new Error('blocked invite event block-state owner is required');
  ensureUsernameProfileSchema(db);
  ensureSystemEventsSchema(db);

  const q = {
    creator: db.prepare(`
      SELECT p.device_id, p.display_name, r.public_id AS room_public_id
      FROM participants p
      JOIN rooms r ON r.id=p.room_id
      WHERE p.room_id=? AND p.access_revoked=0
      ORDER BY p.id ASC
      LIMIT 1
    `),

    identity: db.prepare(`
      SELECT i.device_id,
             NULLIF(i.display_name,'') AS identity_name,
             NULLIF(p.display_name,'') AS profile_name,
             NULLIF(p.username,'') AS username
      FROM user_identities i
      LEFT JOIN user_profiles p ON p.device_id=i.device_id
      WHERE i.device_id=?
      UNION ALL
      SELECT p.device_id,
             NULL AS identity_name,
             NULLIF(p.display_name,'') AS profile_name,
             NULLIF(p.username,'') AS username
      FROM user_profiles p
      WHERE p.device_id=?
        AND NOT EXISTS(SELECT 1 FROM user_identities i2 WHERE i2.device_id=p.device_id)
      LIMIT 1
    `),
    byDedupe: db.prepare(`
      SELECT id, payload_json, created_at
      FROM system_events
      WHERE device_id=? AND dedupe_key=?
      LIMIT 1
    `),
    insert: db.prepare(`
      INSERT OR IGNORE INTO system_events
        (device_id, event_type, ref_type, ref_id, dedupe_key, payload_json, read_at, created_at)
      VALUES (?, 'blocked_invite_attempt', 'room', NULL, ?, ?, NULL, datetime('now'))
    `),
    update: db.prepare(`
      UPDATE system_events
      SET event_type='blocked_invite_attempt',
          ref_type='room',
          ref_id=NULL,
          payload_json=?,
          read_at=NULL,
          created_at=datetime('now')
      WHERE id=? AND device_id=?
    `)
  };

  function identityFor(deviceId, fallbackName = '') {
    const id = safeDeviceId(deviceId);
    const row = id ? q.identity.get(id, id) : null;
    return {
      deviceId: id,
      displayName: cleanName(row?.identity_name || row?.profile_name || fallbackName) || 'Пользователь FPChat',
      username: row?.username || null
    };
  }

  function note({ roomId, joinerId, fallbackName = '' }) {
    const numericRoomId = Number(roomId);
    const blockedDeviceId = safeDeviceId(joinerId);
    if (!Number.isSafeInteger(numericRoomId) || numericRoomId <= 0 || !blockedDeviceId) {
      return { ok: false, code: 'BLOCKED_INVITE_EVENT_INVALID' };
    }

    const creator = q.creator.get(numericRoomId);
    if (!creator?.device_id || creator.device_id === blockedDeviceId) {
      return { ok: false, code: 'BLOCKED_INVITE_EVENT_CREATOR_MISSING' };
    }

    const block = userBlocks.relationship(creator.device_id, blockedDeviceId).blockedByMe;
    if (!block?.public_id) {
      return { ok: false, code: 'BLOCKED_INVITE_EVENT_BLOCK_MISSING' };
    }

    const actor = identityFor(blockedDeviceId, fallbackName);
    const fingerprint = crypto.createHash('sha256').update(blockedDeviceId).digest('hex').slice(0, 20);
    const dedupeKey = `blocked-invite:${creator.room_public_id}:${fingerprint}`;
    const nowIso = new Date().toISOString();

    const transaction = db.transaction(() => {
      let existing = q.byDedupe.get(creator.device_id, dedupeKey);
      let previous = parsePayload(existing?.payload_json) || {};
      let attemptCount = Math.max(0, Number(previous.attemptCount) || 0) + 1;
      const payload = {
        roomPublicId: creator.room_public_id,
        actor: {
          deviceId: actor.deviceId,
          displayName: actor.displayName,
          username: actor.username
        },
        blockId: block.public_id,
        attemptCount,
        firstAttemptAt: previous.firstAttemptAt || existing?.created_at || nowIso,
        lastAttemptAt: nowIso
      };

      if (!existing) {
        q.insert.run(creator.device_id, dedupeKey, JSON.stringify(payload));
        existing = q.byDedupe.get(creator.device_id, dedupeKey);
        if (!existing) return { ok: false, code: 'BLOCKED_INVITE_EVENT_INSERT_FAILED' };
        // A concurrent insert is unlikely in the single Node process, but if it
        // happened, preserve the already stored count instead of overwriting it.
        const stored = parsePayload(existing.payload_json) || payload;
        attemptCount = Math.max(1, Number(stored.attemptCount) || 1);
        return { ok: true, inserted: true, eventId: Number(existing.id), attemptCount, payload: stored };
      }

      q.update.run(JSON.stringify(payload), existing.id, creator.device_id);
      return { ok: true, inserted: false, eventId: Number(existing.id), attemptCount, payload };
    });

    return transaction.immediate();
  }

  return { note };
}

module.exports = { createBlockedInviteEventStore };
