'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const server=read('server.js');
const dbSource=read('src/db.js');
const diag=read('scripts/diagnose179-history-db.cjs');

const messageSelect="SELECT m.id, m.type, m.client_message_id, m.ciphertext, m.iv, m.reply_to_message_id, m.status, m.event_type, m.event_actor_name, m.created_at, m.delivered_at, m.read_at, p.display_name as sender_name, p.device_id as sender_device_id FROM messages m JOIN participants p ON p.id = m.sender_id";
assert(server.includes('const MESSAGE_SELECT = `'+messageSelect+'`;'),'MESSAGE_SELECT changed');
assert(server.includes("listMessagesLatest: db.prepare(`${MESSAGE_SELECT} WHERE m.room_id=? ORDER BY m.id DESC LIMIT ?`)"),'latest SQL changed');
assert(server.includes("listMessagesBefore: db.prepare(`${MESSAGE_SELECT} WHERE m.room_id=? AND m.id<? ORDER BY m.id DESC LIMIT ?`)"),'before SQL changed');
assert(server.includes("listMediaByMessageId: db.prepare(`SELECT id, public_id, mime_type, media_kind, size_bytes, encrypted_size_bytes, width, height, duration_seconds, file_order FROM media WHERE message_id=? ORDER BY file_order ASC, id ASC`)"),'media hydration SQL changed');

const historyStart=server.indexOf('function getMessageHistoryPage(roomId, beforeCursor = null, limit = HISTORY_PAGE_SIZE) {');
const historyEnd=server.indexOf('\n}',historyStart)+2;
const history=server.slice(historyStart,historyEnd);
for(const token of [
 'const safeLimit = normalizeHistoryLimit(limit);',
 '? q.listMessagesLatest.all(roomId, safeLimit + 1)',
 ': q.listMessagesBefore.all(roomId, beforeCursor, safeLimit + 1);',
 'const hasMore = rows.length > safeLimit;',
 'const pageRows = rows.slice(0, safeLimit).reverse();',
 'const messages = serializeMessages(pageRows);'
]){assert(history.includes(token),'history order/parameter contract changed: '+token);}
assert(!history.includes('db.transaction'),'history page unexpectedly gained explicit transaction');

const hydrateStart=server.indexOf('function hydrateMessages(messages) {');
const hydrateEnd=server.indexOf('\n}',hydrateStart)+2;
const hydrate=server.slice(hydrateStart,hydrateEnd);
assert(hydrate.includes("m.type === 'media' ? q.listMediaByMessageId.all(m.id)"),'media N+1 hydration contract changed');
assert(!hydrate.includes('db.transaction'),'hydrate unexpectedly gained explicit transaction');

const normalizeStart=server.indexOf('function normalizeHistoryLimit(value) {');
const normalizeEnd=server.indexOf('\n}',normalizeStart)+2;
const normalize=server.slice(normalizeStart,normalizeEnd);
assert(normalize.includes('return Math.max(1, Math.min(HISTORY_PAGE_SIZE, parsed));'),'limit clamp changed');
assert(server.includes('const HISTORY_PAGE_SIZE = 100;'),'history page max/default changed');

assert(diag.includes("new Database(resolved,{readonly:true,fileMustExist:true})"),'diagnostic DB is not readonly');
assert(diag.includes("db.pragma('query_only = ON')"),'diagnostic query_only guard missing');
assert(diag.includes("const txBefore=db.inTransaction;"),'transaction boundary diagnostic missing');
assert(diag.includes("const txAfterPage=db.inTransaction;"),'page transaction boundary diagnostic missing');
assert(diag.includes("const txAfterHydration=db.inTransaction;"),'hydration transaction boundary diagnostic missing');
assert(diag.includes("EXPLAIN QUERY PLAN"),'query plan diagnostic missing');

for(const forbidden of ['INSERT INTO','UPDATE messages','DELETE FROM','CREATE TABLE','CREATE INDEX','ALTER TABLE','DROP TABLE']){
  assert(!diag.includes(forbidden),'read-only diagnostic contains write/schema SQL: '+forbidden);
}

assert(dbSource.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_room_sender_client_id ON messages(room_id, sender_id, client_message_id)'),'current message index inventory changed');
assert(dbSource.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_system_event_once ON messages(room_id, sender_id, event_type)'),'current system-event index inventory changed');
assert(!dbSource.includes('CREATE INDEX IF NOT EXISTS idx_messages_room_id'),'179.8 unexpectedly added dedicated history index');
assert(!dbSource.includes('CREATE INDEX IF NOT EXISTS idx_media_message'),'179.8 unexpectedly added dedicated media hydration index');

console.log('PASS 179.8 history latest/before SQL, parameters and execution order are frozen');
console.log('PASS 179.8 media hydration N+1 and explicit transaction boundary are documented');
console.log('PASS 179.8 diagnostic is readonly/query_only and schema is unchanged');
