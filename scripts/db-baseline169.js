/* Build 169: read-only SQLite baseline report.
   Prints aggregate counts and query plans only; no message/user contents. */
'use strict';

require('dotenv').config();
const path = require('node:path');
const Database = require('better-sqlite3');

const databasePath = path.resolve(process.env.DATABASE_PATH || './data/chat.sqlite');
let db;
try {
  db = new Database(databasePath, { readonly: true, fileMustExist: true });
} catch (error) {
  console.error(`[FPDiag169] cannot open database read-only: ${error?.message || error}`);
  process.exitCode = 1;
  return;
}

function elapsedMs(fn) {
  const started = process.hrtime.bigint();
  const value = fn();
  const ended = process.hrtime.bigint();
  return { value, ms: Math.round(Number(ended - started) / 1e5) / 10 };
}

function existingTables() {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
}

function explain(sql, params) {
  try {
    return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => String(row.detail || ''));
  } catch (error) {
    return [`ERROR: ${error?.message || error}`];
  }
}

try {
  const tables = existingTables();
  const aggregateTables = ['rooms', 'participants', 'messages', 'media', 'recovery', 'push_subscriptions', 'invites', 'chat_request_blocks'];
  const counts = {};
  const countTimingsMs = {};
  for (const table of aggregateTables) {
    if (!tables.has(table)) continue;
    const result = elapsedMs(() => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0));
    counts[table] = result.value;
    countTimingsMs[table] = result.ms;
  }

  const indexes = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY tbl_name,name").all();
  const report = {
    tag: 'FPChatDb169',
    at: new Date().toISOString(),
    databaseFile: path.basename(databasePath),
    counts,
    countTimingsMs,
    indexes,
    queryPlans: {
      historyLatest: explain('SELECT id FROM messages WHERE room_id=? ORDER BY id DESC LIMIT ?', [1, 101]),
      historyBefore: explain('SELECT id FROM messages WHERE room_id=? AND id<? ORDER BY id DESC LIMIT ?', [1, 1000000000, 101]),
      historyAfter: explain('SELECT id FROM messages WHERE room_id=? AND id>? ORDER BY id ASC LIMIT ?', [1, 0, 101]),
      mediaByMessage: explain('SELECT id FROM media WHERE message_id=? ORDER BY file_order,id', [1])
    }
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}
