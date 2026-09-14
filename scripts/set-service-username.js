/* Build 141: server-only assignment for protected/service usernames.
   Usage: node scripts/set-service-username.js <deviceId> <username>
*/
const path = require('path');
const Database = require('better-sqlite3');
const dotenv = require('dotenv');
const { ensureUsernameProfileSchema } = require('../src/username-server');
const { validateServiceUsername } = require('../src/username-rules');

dotenv.config();

const deviceId = String(process.argv[2] || '').trim();
const requested = String(process.argv[3] || '').trim();

function fail(message) {
  console.error(`[ERROR] ${message}`);
  process.exitCode = 1;
}

if (!deviceId || deviceId.length < 8 || deviceId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(deviceId)) {
  fail('Valid deviceId is required.');
  return;
}

const validation = validateServiceUsername(requested);
if (!validation.ok) {
  fail(validation.error || 'Invalid service username.');
  return;
}

const databasePath = path.resolve(process.env.DATABASE_PATH || './data/chat.sqlite');
const db = new Database(databasePath);

try {
  db.pragma('journal_mode = WAL');
  ensureUsernameProfileSchema(db);

  const findByUsername = db.prepare(`
    SELECT device_id, username, role
    FROM user_profiles
    WHERE username_normalized=?
  `);
  const owner = findByUsername.get(validation.username);
  if (owner && owner.device_id !== deviceId) {
    fail(`@${validation.username} already belongs to another device.`);
    return;
  }

  const upsert = db.prepare(`
    INSERT INTO user_profiles (device_id, username, username_normalized, role, updated_at)
    VALUES (?, ?, ?, 'service', datetime('now'))
    ON CONFLICT(device_id) DO UPDATE SET
      username=excluded.username,
      username_normalized=excluded.username_normalized,
      role='service',
      updated_at=datetime('now')
  `);

  try {
    upsert.run(deviceId, validation.username, validation.username);
  } catch (error) {
    if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
      fail(`@${validation.username} is already occupied.`);
      return;
    }
    throw error;
  }

  console.log(`[OK] @${validation.username} assigned to ${deviceId} as service profile.`);
  console.log(`Database: ${databasePath}`);
} finally {
  db.close();
}
