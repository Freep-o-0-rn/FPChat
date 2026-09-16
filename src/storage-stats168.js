/* Build 168: authenticated-by-device media inventory for local cache accounting.
   Returns metadata only; media blobs are never downloaded by this endpoint. */
function installStorageStats168({ app, db }) {
  if (!app || !db) throw new Error('storage stats dependencies are missing');
  if (app.__fpStorageStats168Installed) return;
  app.__fpStorageStats168Installed = true;

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_media_room_message_168 ON media(room_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_participants_device_room_168 ON participants(device_id, room_id);
  `);

  const messageColumns = db.prepare('PRAGMA table_info(messages)').all();
  const hasDeletedForAll = messageColumns.some((column) => column.name === 'deleted_for_all');
  const deletedPredicate = hasDeletedForAll ? 'AND COALESCE(msg.deleted_for_all,0)=0' : '';

  const listMedia = db.prepare(`
    SELECT
      med.id,
      med.public_id,
      med.media_kind,
      med.mime_type,
      med.size_bytes,
      med.encrypted_size_bytes,
      med.thumb_size_bytes,
      med.thumb_encrypted_size_bytes,
      med.thumbnail_filename,
      med.created_at
    FROM media med
    JOIN participants p
      ON p.room_id=med.room_id
     AND p.device_id=?
     AND COALESCE(p.access_revoked,0)=0
     AND p.permanent_left_at IS NULL
    JOIN messages msg
      ON msg.id=med.message_id
     AND msg.room_id=med.room_id
    WHERE med.message_id IS NOT NULL
      AND med.id>?
      ${deletedPredicate}
    ORDER BY med.id ASC
    LIMIT ?
  `);

  function safeDevice(value) {
    const text = String(value || '').trim().slice(0, 64);
    return /^[0-9a-f-]{16,64}$/i.test(text) ? text : '';
  }

  function safeLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 500;
    return Math.max(50, Math.min(1000, Math.floor(parsed)));
  }

  app.get('/api/storage/media-inventory', (req, res) => {
    const deviceId = safeDevice(req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, error: 'deviceId required' });

    const cursor = Math.max(0, Number(req.query?.cursor || 0) || 0);
    const limit = safeLimit(req.query?.limit);
    const rows = listMedia.all(deviceId, cursor, limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items = page.map((row) => ({
      id: Number(row.id),
      public_id: String(row.public_id || ''),
      media_kind: String(row.media_kind || 'file'),
      mime_type: String(row.mime_type || 'application/octet-stream'),
      size_bytes: Math.max(0, Number(row.size_bytes || 0) || 0),
      encrypted_size_bytes: Math.max(0, Number(row.encrypted_size_bytes || 0) || 0),
      thumb_size_bytes: Math.max(0, Number(row.thumb_size_bytes || 0) || 0),
      thumb_encrypted_size_bytes: Math.max(0, Number(row.thumb_encrypted_size_bytes || 0) || 0),
      has_thumbnail: Boolean(row.thumbnail_filename),
      created_at: row.created_at || null
    }));

    const nextCursor = items.length ? Number(items[items.length - 1].id) : cursor;
    return res.json({ ok: true, items, hasMore, nextCursor });
  });
}

module.exports = { installStorageStats168 };
