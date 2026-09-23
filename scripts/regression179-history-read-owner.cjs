'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHistoryRead179}=require('../src/history-read179');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const server=read('server.js');
const adapter=read('src/history-read179.js');
const dbSource=read('src/db.js');

let inTx=false;
let txCount=0;
const calls=[];
const fakeDb={
  transaction(fn){
    return (...args)=>{
      assert.equal(inTx,false,'nested/unexpected history transaction');
      txCount+=1;
      inTx=true;
      try{return fn(...args);}finally{inTx=false;}
    };
  }
};
const latest={all(...args){assert.equal(inTx,true,'latest SELECT outside transaction');calls.push(['latest',...args]);return [{id:5,type:'media'},{id:4,type:'text'},{id:3,type:'media'}];}};
const before={all(...args){assert.equal(inTx,true,'before SELECT outside transaction');calls.push(['before',...args]);return [{id:9,type:'text'},{id:8,type:'media'},{id:7,type:'text'}];}};
const media={all(messageId){assert.equal(inTx,true,'media SELECT outside transaction');calls.push(['media',messageId]);return [{id:messageId*10,public_id:'m'+messageId}];}};
const owner=createHistoryRead179({db:fakeDb,listMessagesLatest:latest,listMessagesBefore:before});
function serialize(rows){
  assert.equal(inTx,true,'serialize/hydrate callback outside transaction');
  return rows.map(row=>({...row,media:row.type==='media'?media.all(row.id):[]}));
}

let result=owner.readPage({roomId:21,beforeCursor:null,safeLimit:2,serializeMessages:serialize});
assert.equal(txCount,1,'latest page must use exactly one transaction');
assert.deepEqual(calls,[['latest',21,3],['media',5]],'latest SQL/parameter/order changed');
assert.deepEqual(result.messages.map(x=>x.id),[4,5],'latest reverse/order changed');
assert.equal(result.hasMore,true);
assert.equal(result.nextCursor,4);
assert.equal(inTx,false,'transaction leaked after latest read');

calls.length=0;
result=owner.readPage({roomId:21,beforeCursor:10,safeLimit:2,serializeMessages:serialize});
assert.equal(txCount,2,'before page must add exactly one transaction');
assert.deepEqual(calls,[['before',21,10,3],['media',8]],'before SQL/parameter/order changed');
assert.deepEqual(result.messages.map(x=>x.id),[8,9],'before reverse/order changed');
assert.equal(result.hasMore,true);
assert.equal(result.nextCursor,8);
assert.equal(inTx,false,'transaction leaked after before read');

const messageSelect="SELECT m.id, m.type, m.client_message_id, m.ciphertext, m.iv, m.reply_to_message_id, m.status, m.event_type, m.event_actor_name, m.created_at, m.delivered_at, m.read_at, p.display_name as sender_name, p.device_id as sender_device_id FROM messages m JOIN participants p ON p.id = m.sender_id";
assert(server.includes('const MESSAGE_SELECT = `'+messageSelect+'`;'),'MESSAGE_SELECT changed');
assert(server.includes("listMessagesLatest: db.prepare(`${MESSAGE_SELECT} WHERE m.room_id=? ORDER BY m.id DESC LIMIT ?`)"),'latest prepared SQL changed');
assert(server.includes("listMessagesBefore: db.prepare(`${MESSAGE_SELECT} WHERE m.room_id=? AND m.id<? ORDER BY m.id DESC LIMIT ?`)"),'before prepared SQL changed');
assert(server.includes("listMediaByMessageId: db.prepare(`SELECT id, public_id, mime_type, media_kind, size_bytes, encrypted_size_bytes, width, height, duration_seconds, file_order FROM media WHERE message_id=? ORDER BY file_order ASC, id ASC`)"),'media prepared SQL changed');

assert(server.includes("const fpHistoryRead179 = createHistoryRead179({\n  db,\n  listMessagesLatest: q.listMessagesLatest,\n  listMessagesBefore: q.listMessagesBefore\n});"),'history owner wiring changed');
assert(server.includes("return fpHistoryRead179.readPage({ roomId, beforeCursor, safeLimit, serializeMessages });"),'history page no longer delegates to owner');
assert(server.includes("m.type === 'media' ? q.listMediaByMessageId.all(m.id)"),'existing media N+1 query path changed');

for(const forbidden of ['db.prepare(', 'new Database', 'CREATE TABLE', 'CREATE INDEX', 'ALTER TABLE', 'cache', 'Map(', 'Set(']){
  assert(!adapter.includes(forbidden),'thin adapter gained forbidden ownership/capability: '+forbidden);
}
assert.equal((adapter.match(/db\.transaction\(/g)||[]).length,1,'adapter must define exactly one transaction boundary');
assert(adapter.includes('listMessagesLatest.all(roomId, safeLimit + 1)'),'latest parameters changed in adapter');
assert(adapter.includes('listMessagesBefore.all(roomId, beforeCursor, safeLimit + 1)'),'before parameters changed in adapter');
assert(adapter.includes('rows.slice(0, safeLimit).reverse()'),'page order changed in adapter');
assert(adapter.includes('serializeMessages(pageRows)'),'existing serializer/hydrator must run inside transaction');

assert(!dbSource.includes('CREATE INDEX IF NOT EXISTS idx_messages_room_id'),'179.9 added history schema/index');
assert(!dbSource.includes('CREATE INDEX IF NOT EXISTS idx_media_message'),'179.9 added media schema/index');

console.log('PASS 179.9 history read has one thin owner and one transaction per page');
console.log('PASS 179.9 latest/before/media prepared SQL and parameter order are unchanged');
console.log('PASS 179.9 existing media N+1 runs inside the same read transaction');
console.log('PASS 179.9 no ORM, pool, cache or schema/index was added');
