/* Build 141: optional device-scoped username registry.
   Isolated from rooms, participants, messages, invites and recovery. */
const {
  validatePublicUsername
} = require('./username-rules');

function ensureUsernameProfileSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      device_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const columns = db.prepare('PRAGMA table_info(user_profiles)').all();
  if (!columns.some((column) => column.name === 'role')) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }
  db.exec("UPDATE user_profiles SET role='user' WHERE role IS NULL OR role=''");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_username_normalized
      ON user_profiles(username_normalized);
  `);
}

function installUsernameServer({ app, db }) {
  if (!app || !db) throw new Error('username server dependencies are missing');
  if (app.__fpUsername140Installed) return;
  app.__fpUsername140Installed = true;

  ensureUsernameProfileSchema(db);

  const q = {
    findByDevice: db.prepare(`
      SELECT device_id, username, username_normalized, role, created_at, updated_at
      FROM user_profiles
      WHERE device_id=?
    `),
    findByUsername: db.prepare(`
      SELECT device_id, username, username_normalized, role
      FROM user_profiles
      WHERE username_normalized=?
    `),
    upsertPublic: db.prepare(`
      INSERT INTO user_profiles (device_id, username, username_normalized, role, updated_at)
      VALUES (?, ?, ?, 'user', datetime('now'))
      ON CONFLICT(device_id) DO UPDATE SET
        username=excluded.username,
        username_normalized=excluded.username_normalized,
        role='user',
        updated_at=datetime('now')
    `),
    remove: db.prepare('DELETE FROM user_profiles WHERE device_id=?')
  };

  const saveUsername = db.transaction((deviceId, username) => {
    const profile = q.findByDevice.get(deviceId);
    if (profile?.role === 'service') return { ok: false, serviceManaged: true };

    const owner = q.findByUsername.get(username);
    if (owner && owner.device_id !== deviceId) return { ok: false, taken: true };
    q.upsertPublic.run(deviceId, username, username);
    return { ok: true };
  });

  function safeDeviceId(value) {
    const text = String(value || '').trim();
    if (text.length < 8 || text.length > 128) return '';
    return /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
  }

  app.get('/api/profile/username', (req, res) => {
    const deviceId = safeDeviceId(req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'valid deviceId required' });
    const row = q.findByDevice.get(deviceId);
    return res.json({
      ok: true,
      username: row?.username || null,
      role: row?.role || 'user'
    });
  });

  app.get('/api/usernames/check', (req, res) => {
    const validation = validatePublicUsername(req.query?.username);
    if (!validation.ok) {
      return res.status(400).json({
        ok: false,
        available: false,
        code: validation.code,
        error: validation.error
      });
    }

    const deviceId = safeDeviceId(req.query?.deviceId);
    const owner = q.findByUsername.get(validation.username);
    const current = Boolean(owner && deviceId && owner.device_id === deviceId);
    return res.json({
      ok: true,
      username: validation.username,
      available: !owner || current,
      current
    });
  });

  app.put('/api/profile/username', (req, res) => {
    const deviceId = safeDeviceId(req.body?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'valid deviceId required' });

    const existing = q.findByDevice.get(deviceId);
    if (existing?.role === 'service') {
      return res.status(403).json({
        ok: false,
        code: 'SERVICE_PROFILE_MANAGED_SERVER',
        error: 'service profile is managed on server'
      });
    }

    const validation = validatePublicUsername(req.body?.username);
    if (!validation.ok) {
      return res.status(400).json({ ok: false, code: validation.code, error: validation.error });
    }

    try {
      const result = saveUsername(deviceId, validation.username);
      if (!result.ok && result.serviceManaged) {
        return res.status(403).json({ ok: false, code: 'SERVICE_PROFILE_MANAGED_SERVER', error: 'service profile is managed on server' });
      }
      if (!result.ok && result.taken) {
        return res.status(409).json({ ok: false, code: 'USERNAME_TAKEN', error: 'username already taken' });
      }
      return res.json({ ok: true, username: validation.username, role: 'user' });
    } catch (error) {
      if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
        return res.status(409).json({ ok: false, code: 'USERNAME_TAKEN', error: 'username already taken' });
      }
      console.error('Username save failed', error);
      return res.status(500).json({ ok: false, code: 'USERNAME_SAVE_FAILED', error: 'username save failed' });
    }
  });

  app.delete('/api/profile/username', (req, res) => {
    const deviceId = safeDeviceId(req.body?.deviceId || req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'valid deviceId required' });

    const previous = q.findByDevice.get(deviceId);
    if (previous?.role === 'service') {
      return res.status(403).json({
        ok: false,
        code: 'SERVICE_PROFILE_MANAGED_SERVER',
        error: 'service profile is managed on server'
      });
    }

    q.remove.run(deviceId);
    return res.json({ ok: true, removed: Boolean(previous), username: previous?.username || null });
  });
}

module.exports = { installUsernameServer, ensureUsernameProfileSchema };
