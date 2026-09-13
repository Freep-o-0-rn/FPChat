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
      status TEXT NOT NULL DEFAULT 'open',
      closed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      device_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      online INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      access_revoked INTEGER NOT NULL DEFAULT 0,
      permanent_left_at TEXT,
      UNIQUE(room_id, device_id),
      FOREIGN KEY(room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      client_message_id TEXT,
      reply_to_message_id INTEGER,
      status TEXT NOT NULL DEFAULT 'sent',
      event_type TEXT,
      event_actor_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivered_at TEXT,
      read_at TEXT,
      FOREIGN KEY(room_id) REFERENCES rooms(id),
      FOREIGN KEY(sender_id) REFERENCES participants(id),
      FOREIGN KEY(reply_to_message_id) REFERENCES messages(id)
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      ciphertext TEXT,
      iv TEXT,
      reply_to_message_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, device_id),
      FOREIGN KEY(room_id) REFERENCES rooms(id),
      FOREIGN KEY(reply_to_message_id) REFERENCES messages(id)
    );

    CREATE TABLE IF NOT EXISTS chat_view_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      anchor_message_id INTEGER,
      anchor_offset_px INTEGER NOT NULL DEFAULT 0,
      at_bottom INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, device_id),
      FOREIGN KEY(room_id) REFERENCES rooms(id),
      FOREIGN KEY(anchor_message_id) REFERENCES messages(id)
    );

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      room_id INTEGER NOT NULL,
      message_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      file_order INTEGER NOT NULL DEFAULT 0,
      server_filename TEXT NOT NULL,
      thumbnail_filename TEXT,
      original_name_ciphertext TEXT,
      original_name_iv TEXT,
      mime_type TEXT NOT NULL,
      media_kind TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      encrypted_size_bytes INTEGER NOT NULL,
      thumb_size_bytes INTEGER,
      thumb_encrypted_size_bytes INTEGER,
      width INTEGER,
      height INTEGER,
      duration_seconds REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(room_id) REFERENCES rooms(id),
      FOREIGN KEY(message_id) REFERENCES messages(id)
    );

    CREATE TABLE IF NOT EXISTS recovery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      device_id TEXT,
      recovery_salt TEXT NOT NULL,
      recovery_verifier TEXT NOT NULL,
      recovery_secret_iv TEXT,
      recovery_secret_ciphertext TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, device_id),
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
      notify_system_events INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, device_id, endpoint),
      FOREIGN KEY(room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS push_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, message_id, device_id),
      FOREIGN KEY(room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_code TEXT NOT NULL UNIQUE,
      room_id INTEGER NOT NULL,
      room_secret TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      used_by_device_id TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(room_id) REFERENCES rooms(id)
    );
  `);

  const roomColumns = db.prepare('PRAGMA table_info(rooms)').all();
  if (!roomColumns.some((column) => column.name === 'status')) db.exec("ALTER TABLE rooms ADD COLUMN status TEXT NOT NULL DEFAULT 'open'");
  if (!roomColumns.some((column) => column.name === 'closed_at')) db.exec('ALTER TABLE rooms ADD COLUMN closed_at TEXT');
  db.exec("UPDATE rooms SET status = 'open' WHERE status IS NULL OR status = ''");

  const recoveryColumns = db.prepare('PRAGMA table_info(recovery)').all();
  if (!recoveryColumns.some((column) => column.name === 'recovery_secret_iv')) db.exec('ALTER TABLE recovery ADD COLUMN recovery_secret_iv TEXT');
  if (!recoveryColumns.some((column) => column.name === 'recovery_secret_ciphertext')) db.exec('ALTER TABLE recovery ADD COLUMN recovery_secret_ciphertext TEXT');
  if (!recoveryColumns.some((column) => column.name === 'revoked')) db.exec('ALTER TABLE recovery ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0');
  if (!recoveryColumns.some((column) => column.name === 'revoked_at')) db.exec('ALTER TABLE recovery ADD COLUMN revoked_at TEXT');

  const participantColumns = db.prepare('PRAGMA table_info(participants)').all();
  if (!participantColumns.some((column) => column.name === 'online')) db.exec("ALTER TABLE participants ADD COLUMN online INTEGER NOT NULL DEFAULT 0");
  if (!participantColumns.some((column) => column.name === 'updated_at')) {
    db.exec('ALTER TABLE participants ADD COLUMN updated_at TEXT');
    db.exec("UPDATE participants SET updated_at = datetime('now') WHERE updated_at IS NULL");
  }
  if (!participantColumns.some((column) => column.name === 'access_revoked')) db.exec('ALTER TABLE participants ADD COLUMN access_revoked INTEGER NOT NULL DEFAULT 0');
  if (!participantColumns.some((column) => column.name === 'permanent_left_at')) db.exec('ALTER TABLE participants ADD COLUMN permanent_left_at TEXT');

  const messageColumns = db.prepare('PRAGMA table_info(messages)').all();
  if (!messageColumns.some((column) => column.name === 'reply_to_message_id')) db.exec('ALTER TABLE messages ADD COLUMN reply_to_message_id INTEGER');
  if (!messageColumns.some((column) => column.name === 'type')) db.exec("ALTER TABLE messages ADD COLUMN type TEXT NOT NULL DEFAULT 'text'");
  if (!messageColumns.some((column) => column.name === 'client_message_id')) db.exec('ALTER TABLE messages ADD COLUMN client_message_id TEXT');
  if (!messageColumns.some((column) => column.name === 'event_type')) db.exec('ALTER TABLE messages ADD COLUMN event_type TEXT');
  if (!messageColumns.some((column) => column.name === 'event_actor_name')) db.exec('ALTER TABLE messages ADD COLUMN event_actor_name TEXT');

  const viewStateColumns = db.prepare('PRAGMA table_info(chat_view_state)').all();
  if (!viewStateColumns.some((column) => column.name === 'at_bottom')) db.exec('ALTER TABLE chat_view_state ADD COLUMN at_bottom INTEGER NOT NULL DEFAULT 0');

  const pushColumns = db.prepare('PRAGMA table_info(push_subscriptions)').all();
  if (!pushColumns.some((column) => column.name === 'notify_system_events')) db.exec('ALTER TABLE push_subscriptions ADD COLUMN notify_system_events INTEGER NOT NULL DEFAULT 1');

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_room_sender_client_id ON messages(room_id, sender_id, client_message_id) WHERE client_message_id IS NOT NULL');
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_system_event_once ON messages(room_id, sender_id, event_type) WHERE type = 'system' AND event_type IS NOT NULL");
  db.exec('CREATE INDEX IF NOT EXISTS idx_participants_room_access ON participants(room_id, access_revoked)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_recovery_room_device_revoked ON recovery(room_id, device_id, revoked)');

  db.exec('DELETE FROM push_subscriptions WHERE id NOT IN (SELECT MAX(id) FROM push_subscriptions GROUP BY room_id, device_id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_room_device ON push_subscriptions(room_id, device_id)');

  return db;
}

module.exports = { createDb };
