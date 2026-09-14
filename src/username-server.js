/* Build 140: optional device-scoped username registry.
   Isolated from rooms, participants, messages, invites and recovery. */
function installUsernameServer({ app, db }) {
  if (!app || !db) throw new Error('username server dependencies are missing');
  if (app.__fpUsername140Installed) return;
  app.__fpUsername140Installed = true;

  const USERNAME_MIN = 5;
  const USERNAME_MAX = 32;
  const USERNAME_RE = /^[a-z0-9_]+$/;
  const RESERVED = new Set([
    'admin',
    'administrator',
    'api',
    'fpchat',
    'mod',
    'moderator',
    'official',
    'root',
    'security',
    'support',
    'system'
  ]);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      device_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_username_normalized
      ON user_profiles(username_normalized);
  `);

  const q = {
    findByDevice: db.prepare(`
      SELECT device_id, username, username_normalized, created_at, updated_at
      FROM user_profiles
      WHERE device_id=?
    `),
    findByUsername: db.prepare(`
      SELECT device_id, username, username_normalized
      FROM user_profiles
      WHERE username_normalized=?
    `),
    upsert: db.prepare(`
      INSERT INTO user_profiles (device_id, username, username_normalized, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(device_id) DO UPDATE SET
        username=excluded.username,
        username_normalized=excluded.username_normalized,
        updated_at=datetime('now')
    `),
    remove: db.prepare('DELETE FROM user_profiles WHERE device_id=?')
  };

  const saveUsername = db.transaction((deviceId, username) => {
    const owner = q.findByUsername.get(username);
    if (owner && owner.device_id !== deviceId) return { ok: false, taken: true };
    q.upsert.run(deviceId, username, username);
    return { ok: true };
  });

  function safeDeviceId(value) {
    const text = String(value || '').trim();
    if (text.length < 8 || text.length > 128) return '';
    return /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
  }

  function normalizeUsername(value) {
    let text = String(value || '').trim();
    if (text.startsWith('@')) text = text.slice(1);
    return text.toLowerCase();
  }

  function validateUsername(value) {
    const username = normalizeUsername(value);
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX || !USERNAME_RE.test(username)) {
      return {
        ok: false,
        username,
        code: 'USERNAME_INVALID',
        error: `username must be ${USERNAME_MIN}-${USERNAME_MAX} characters: a-z, 0-9 or _`
      };
    }
    if (RESERVED.has(username)) {
      return { ok: false, username, code: 'USERNAME_RESERVED', error: 'username is reserved' };
    }
    return { ok: true, username };
  }

  app.get('/api/profile/username', (req, res) => {
    const deviceId = safeDeviceId(req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'valid deviceId required' });
    const row = q.findByDevice.get(deviceId);
    return res.json({ ok: true, username: row?.username || null });
  });

  app.get('/api/usernames/check', (req, res) => {
    const validation = validateUsername(req.query?.username);
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

    const validation = validateUsername(req.body?.username);
    if (!validation.ok) {
      return res.status(400).json({ ok: false, code: validation.code, error: validation.error });
    }

    try {
      const result = saveUsername(deviceId, validation.username);
      if (!result.ok && result.taken) {
        return res.status(409).json({ ok: false, code: 'USERNAME_TAKEN', error: 'username already taken' });
      }
      return res.json({ ok: true, username: validation.username });
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
    q.remove.run(deviceId);
    return res.json({ ok: true, removed: Boolean(previous), username: previous?.username || null });
  });
}

module.exports = { installUsernameServer };
