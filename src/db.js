const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function createDb(databasePath) {
  const resolved = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      device_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, device_id),
      FOREIGN KEY(room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivered_at TEXT,
      read_at TEXT,
      FOREIGN KEY(room_id) REFERENCES rooms(id),
      FOREIGN KEY(sender_id) REFERENCES participants(id)
    );

    CREATE TABLE IF NOT EXISTS recovery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL UNIQUE,
      recovery_salt TEXT NOT NULL,
      recovery_verifier TEXT NOT NULL,
      recovery_secret_iv TEXT,
      recovery_secret_ciphertext TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(room_id) REFERENCES rooms(id)
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      muted INTEGER NOT NULL DEFAULT 0,
      show_text INTEGER NOT NULL DEFAULT 0,
      hide_sender INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, device_id, endpoint),
      FOREIGN KEY(room_id) REFERENCES rooms(id)
    );
  `);
  const recoveryColumns = db.prepare('PRAGMA table_info(recovery)').all();
  if (!recoveryColumns.some((column) => column.name === 'recovery_secret_iv')) db.exec('ALTER TABLE recovery ADD COLUMN recovery_secret_iv TEXT');
  if (!recoveryColumns.some((column) => column.name === 'recovery_secret_ciphertext')) db.exec('ALTER TABLE recovery ADD COLUMN recovery_secret_ciphertext TEXT');

  const participantColumns = db.prepare('PRAGMA table_info(participants)').all();
  if (!participantColumns.some((column) => column.name === 'online')) db.exec("ALTER TABLE participants ADD COLUMN online INTEGER NOT NULL DEFAULT 0");
  if (!participantColumns.some((column) => column.name === 'updated_at')) db.exec("ALTER TABLE participants ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");

  return db;
}

module.exports = { createDb };
