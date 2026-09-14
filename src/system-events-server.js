/* Build 144: isolated system-event foundation for future service notifications and chat requests.
   This is deliberately separate from rooms/messages so existing chat semantics stay untouched. */
function safeDeviceId(value) {
  const text = String(value || '').trim();
  if (text.length < 8 || text.length > 128) return '';
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
}

function ensureSystemEventsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ref_type TEXT,
      ref_id TEXT,
      dedupe_key TEXT,
      payload_json TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_system_events_device_id
      ON system_events(device_id, id DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_system_events_device_dedupe
      ON system_events(device_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL;
  `);
}

function createSystemEventStore(db) {
  ensureSystemEventsSchema(db);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO system_events
      (device_id, event_type, ref_type, ref_id, dedupe_key, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const list = db.prepare(`
    SELECT id, event_type, ref_type, ref_id, payload_json, read_at, created_at
    FROM system_events
    WHERE device_id=?
    ORDER BY id DESC
    LIMIT ?
  `);
  const state = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread,
      MAX(created_at) AS latest_at
    FROM system_events
    WHERE device_id=?
  `);
  const markRead = db.prepare(`
    UPDATE system_events
    SET read_at=COALESCE(read_at, datetime('now'))
    WHERE device_id=? AND id IN (SELECT value FROM json_each(?))
  `);

  return {
    add({ deviceId, eventType, refType = null, refId = null, dedupeKey = null, payload = null }) {
      const device = safeDeviceId(deviceId);
      const type = String(eventType || '').trim().slice(0, 64);
      if (!device || !type) return { ok: false };
      const payloadJson = payload == null ? null : JSON.stringify(payload);
      const result = insert.run(
        device,
        type,
        refType ? String(refType).slice(0, 64) : null,
        refId == null ? null : String(refId).slice(0, 128),
        dedupeKey ? String(dedupeKey).slice(0, 160) : null,
        payloadJson
      );
      return { ok: true, inserted: Number(result.changes || 0) > 0 };
    },
    list(deviceId, limit = 50) {
      const device = safeDeviceId(deviceId);
      if (!device) return [];
      const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
      return list.all(device, safeLimit);
    },
    state(deviceId) {
      const device = safeDeviceId(deviceId);
      if (!device) return { total: 0, unread: 0, latest_at: null };
      return state.get(device) || { total: 0, unread: 0, latest_at: null };
    },
    markRead(deviceId, ids) {
      const device = safeDeviceId(deviceId);
      const cleanIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)))
        .slice(0, 100);
      if (!device || cleanIds.length === 0) return { changes: 0 };
      const result = markRead.run(device, JSON.stringify(cleanIds));
      return { changes: Number(result.changes || 0) };
    }
  };
}

function parsePayload(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function installSystemEventsServer({ app, db }) {
  if (!app || !db) throw new Error('system events dependencies are missing');
  if (app.__fpSystemEvents144Installed) return;
  app.__fpSystemEvents144Installed = true;

  const store = createSystemEventStore(db);

  app.get('/api/system/state', (req, res) => {
    const deviceId = safeDeviceId(req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });
    const row = store.state(deviceId);
    return res.json({
      ok: true,
      hasEvents: Number(row.total || 0) > 0,
      total: Number(row.total || 0),
      unread: Number(row.unread || 0),
      latestAt: row.latest_at || null
    });
  });

  app.get('/api/system/events', (req, res) => {
    const deviceId = safeDeviceId(req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });
    const rows = store.list(deviceId, req.query?.limit).map((row) => ({
      id: Number(row.id),
      type: row.event_type,
      refType: row.ref_type || null,
      refId: row.ref_id || null,
      payload: parsePayload(row.payload_json),
      createdAt: row.created_at,
      readAt: row.read_at || null
    }));
    return res.json({ ok: true, events: rows });
  });

  app.patch('/api/system/events/read', (req, res) => {
    const deviceId = safeDeviceId(req.body?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED' });
    const result = store.markRead(deviceId, req.body?.ids);
    return res.json({ ok: true, updated: result.changes });
  });
}

module.exports = {
  installSystemEventsServer,
  ensureSystemEventsSchema,
  createSystemEventStore
};
