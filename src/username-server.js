/* Build 164: device identity is stored independently from optional @username. */
const {
  validatePublicUsername,
  validateUsernameSyntax
} = require('./username-rules');

function ensureUsernameProfileSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      device_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL UNIQUE,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_identities (
      device_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const columns = db.prepare('PRAGMA table_info(user_profiles)').all();
  if (!columns.some((column) => column.name === 'display_name')) {
    db.exec('ALTER TABLE user_profiles ADD COLUMN display_name TEXT');
  }
  if (!columns.some((column) => column.name === 'role')) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }
  db.exec("UPDATE user_profiles SET role='user' WHERE role IS NULL OR role=''");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_username_normalized
      ON user_profiles(username_normalized);
  `);

  // Build 164 migration: preserve existing display names before @username can be deleted.
  db.exec(`
    INSERT OR IGNORE INTO user_identities (device_id, display_name, created_at, updated_at)
    SELECT device_id, display_name, COALESCE(created_at, datetime('now')), COALESCE(updated_at, datetime('now'))
    FROM user_profiles
    WHERE display_name IS NOT NULL AND trim(display_name)<>''
  `);
}

function ensureUserPrivacySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_privacy_settings (
      device_id TEXT PRIMARY KEY,
      allow_username_search INTEGER NOT NULL DEFAULT 1,
      allow_chat_requests INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function privacyDto(row) {
  return {
    allowUsernameSearch: row ? Number(row.allow_username_search) !== 0 : true,
    allowChatRequests: row ? Number(row.allow_chat_requests) !== 0 : true
  };
}

function installUsernameServer({ app, db }) {
  if (!app || !db) throw new Error('username server dependencies are missing');
  if (app.__fpUsername140Installed) return;
  app.__fpUsername140Installed = true;

  ensureUsernameProfileSchema(db);
  ensureUserPrivacySchema(db);

  const q = {
    findByDevice: db.prepare(`
      SELECT p.device_id, p.username, p.username_normalized,
             COALESCE(NULLIF(i.display_name,''), NULLIF(p.display_name,'')) AS display_name,
             p.role, p.created_at, p.updated_at
      FROM user_profiles p
      LEFT JOIN user_identities i ON i.device_id=p.device_id
      WHERE p.device_id=?
    `),
    findByUsername: db.prepare(`
      SELECT p.device_id, p.username, p.username_normalized,
             COALESCE(NULLIF(i.display_name,''), NULLIF(p.display_name,'')) AS display_name,
             p.role
      FROM user_profiles p
      LEFT JOIN user_identities i ON i.device_id=p.device_id
      WHERE p.username_normalized=?
    `),
    identityByDevice: db.prepare(`
      SELECT device_id, display_name, created_at, updated_at
      FROM user_identities
      WHERE device_id=?
    `),
    upsertIdentity: db.prepare(`
      INSERT INTO user_identities (device_id, display_name, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(device_id) DO UPDATE SET
        display_name=excluded.display_name,
        updated_at=datetime('now')
    `),
    privacyByDevice: db.prepare(`
      SELECT allow_username_search, allow_chat_requests
      FROM user_privacy_settings
      WHERE device_id=?
    `),
    upsertPrivacy: db.prepare(`
      INSERT INTO user_privacy_settings (device_id, allow_username_search, allow_chat_requests, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(device_id) DO UPDATE SET
        allow_username_search=excluded.allow_username_search,
        allow_chat_requests=excluded.allow_chat_requests,
        updated_at=datetime('now')
    `),
    upsertPublic: db.prepare(`
      INSERT INTO user_profiles (device_id, username, username_normalized, display_name, role, updated_at)
      VALUES (?, ?, ?, ?, 'user', datetime('now'))
      ON CONFLICT(device_id) DO UPDATE SET
        username=excluded.username,
        username_normalized=excluded.username_normalized,
        display_name=excluded.display_name,
        role='user',
        updated_at=datetime('now')
    `),
    updateProfileDisplayName: db.prepare(`
      UPDATE user_profiles
      SET display_name=?, updated_at=datetime('now')
      WHERE device_id=?
    `),
    removeUsername: db.prepare('DELETE FROM user_profiles WHERE device_id=?')
  };

  const saveUsername = db.transaction((deviceId, username, displayName) => {
    const profile = q.findByDevice.get(deviceId);
    if (profile?.role === 'service') return { ok: false, serviceManaged: true };

    const owner = q.findByUsername.get(username);
    if (owner && owner.device_id !== deviceId) return { ok: false, taken: true };

    const identity = q.identityByDevice.get(deviceId);
    const publicName = displayName || identity?.display_name || profile?.display_name || null;
    if (publicName) q.upsertIdentity.run(deviceId, publicName);
    q.upsertPublic.run(deviceId, username, username, publicName);
    return { ok: true, displayName: publicName };
  });

  const saveDisplayName = db.transaction((deviceId, displayName) => {
    q.upsertIdentity.run(deviceId, displayName);
    const profile = q.findByDevice.get(deviceId);
    if (profile) q.updateProfileDisplayName.run(displayName, deviceId);
    return profile;
  });

  function safeDeviceId(value) {
    const text = String(value || '').trim();
    if (text.length < 8 || text.length > 128) return '';
    return /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
  }

  function safeDisplayName(value) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text || text.length > 64) return '';
    return text;
  }

  app.get('/api/profile/username', (req, res) => {
    const deviceId = safeDeviceId(req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'valid deviceId required' });
    const row = q.findByDevice.get(deviceId);
    const identity = q.identityByDevice.get(deviceId);
    return res.json({
      ok: true,
      username: row?.username || null,
      displayName: identity?.display_name || row?.display_name || null,
      role: row?.role || 'user'
    });
  });

  app.get('/api/profile/privacy', (req, res) => {
    const deviceId = safeDeviceId(req.query?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'valid deviceId required' });
    return res.json({ ok: true, ...privacyDto(q.privacyByDevice.get(deviceId)) });
  });

  app.patch('/api/profile/privacy', (req, res) => {
    const deviceId = safeDeviceId(req.body?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'valid deviceId required' });

    const hasSearch = typeof req.body?.allowUsernameSearch === 'boolean';
    const hasRequests = typeof req.body?.allowChatRequests === 'boolean';
    if (!hasSearch && !hasRequests) {
      return res.status(400).json({ ok: false, code: 'PRIVACY_FIELDS_REQUIRED', error: 'privacy boolean required' });
    }

    const current = privacyDto(q.privacyByDevice.get(deviceId));
    const next = {
      allowUsernameSearch: hasSearch ? req.body.allowUsernameSearch : current.allowUsernameSearch,
      allowChatRequests: hasRequests ? req.body.allowChatRequests : current.allowChatRequests
    };
    q.upsertPrivacy.run(deviceId, next.allowUsernameSearch ? 1 : 0, next.allowChatRequests ? 1 : 0);
    return res.json({ ok: true, ...next });
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

  // Exact public lookup only. No directory, prefix search or target device id is exposed.
  app.get('/api/users/by-username', (req, res) => {
    const validation = validateUsernameSyntax(req.query?.username);
    if (!validation.ok) {
      return res.status(400).json({
        ok: false,
        found: false,
        code: validation.code,
        error: validation.error
      });
    }

    const viewerDeviceId = safeDeviceId(req.query?.deviceId);
    const profile = q.findByUsername.get(validation.username);
    if (!profile) return res.json({ ok: true, found: false });

    const isSelf = Boolean(viewerDeviceId && profile.device_id === viewerDeviceId);
    const privacy = privacyDto(q.privacyByDevice.get(profile.device_id));
    if (!isSelf && !privacy.allowUsernameSearch) return res.json({ ok: true, found: false });

    return res.json({
      ok: true,
      found: true,
      user: {
        username: profile.username,
        displayName: profile.display_name || 'Пользователь FPChat',
        role: profile.role === 'service' ? 'service' : 'user',
        isSelf
      }
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

    const requestedDisplayName = safeDisplayName(req.body?.displayName);

    try {
      const result = saveUsername(deviceId, validation.username, requestedDisplayName);
      if (!result.ok && result.serviceManaged) {
        return res.status(403).json({ ok: false, code: 'SERVICE_PROFILE_MANAGED_SERVER', error: 'service profile is managed on server' });
      }
      if (!result.ok && result.taken) {
        return res.status(409).json({ ok: false, code: 'USERNAME_TAKEN', error: 'username already taken' });
      }
      return res.json({
        ok: true,
        username: validation.username,
        displayName: result.displayName || null,
        role: 'user'
      });
    } catch (error) {
      if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
        return res.status(409).json({ ok: false, code: 'USERNAME_TAKEN', error: 'username already taken' });
      }
      console.error('Username save failed', error);
      return res.status(500).json({ ok: false, code: 'USERNAME_SAVE_FAILED', error: 'username save failed' });
    }
  });

  app.patch('/api/profile/display-name', (req, res) => {
    const deviceId = safeDeviceId(req.body?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'valid deviceId required' });

    const displayName = safeDisplayName(req.body?.displayName);
    if (!displayName) {
      return res.status(400).json({ ok: false, code: 'DISPLAY_NAME_INVALID', error: 'valid displayName required' });
    }

    const profile = saveDisplayName(deviceId, displayName);
    return res.json({
      ok: true,
      updated: true,
      profile: Boolean(profile),
      displayName,
      username: profile?.username || null,
      role: profile?.role || 'user'
    });
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

    q.removeUsername.run(deviceId);
    const identity = q.identityByDevice.get(deviceId);
    return res.json({
      ok: true,
      removed: Boolean(previous),
      username: previous?.username || null,
      displayName: identity?.display_name || previous?.display_name || null
    });
  });
}

module.exports = { installUsernameServer, ensureUsernameProfileSchema, ensureUserPrivacySchema };
