'use strict';

const assert=require('node:assert/strict');
const express=require('express');
const Database=require('better-sqlite3');
const {installMessagePinsServer}=require('../src/message-pins-server');

const DEV_A='device-A-1792';
const DEV_B='device-B-1792';
const DEV_REVOKED='device-revoked-1792';
const DEV_UNKNOWN='device-unknown-1792';

function clone(value){return JSON.parse(JSON.stringify(value));}
function toIsoUtc(value){
  if(!value)return null;
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))return value.replace(' ','T')+'Z';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?null:date.toISOString();
}
function normalizePinsBody(body){
  const copy=clone(body);
  for(const pin of copy.pins||[]){
    if(pin.sharedPinnedAt)pin.sharedPinnedAt='<time>';
    if(pin.personalPinnedAt)pin.personalPinnedAt='<time>';
  }
  return copy;
}

async function main(){
  const db=new Database(':memory:');
  db.exec(`
    CREATE TABLE rooms (
      id INTEGER PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, closed_at TEXT, created_at TEXT
    );
    CREATE TABLE participants (
      id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL, display_name TEXT NOT NULL, device_id TEXT NOT NULL,
      access_revoked INTEGER NOT NULL DEFAULT 0, online INTEGER NOT NULL DEFAULT 0, last_seen_at TEXT, updated_at TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL, sender_id INTEGER NOT NULL, ciphertext TEXT NOT NULL, iv TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text', client_message_id TEXT, reply_to_message_id INTEGER, status TEXT NOT NULL DEFAULT 'sent',
      event_type TEXT, event_actor_name TEXT, created_at TEXT NOT NULL, delivered_at TEXT, read_at TEXT, edited_at TEXT,
      deleted_for_all INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
    );
    CREATE TABLE message_hidden (
      id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL, message_id INTEGER NOT NULL, device_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(room_id,message_id,device_id)
    );
  `);

  const insertRoom=db.prepare('INSERT INTO rooms(id,public_id,status,closed_at,created_at) VALUES(?,?,?,?,?)');
  insertRoom.run(1,'room-open','open',null,'2026-09-22 10:00:00');
  insertRoom.run(2,'room-closed','closed','2026-09-22 11:00:00','2026-09-22 10:00:00');
  insertRoom.run(3,'room-other','open',null,'2026-09-22 10:00:00');

  const insertParticipant=db.prepare('INSERT INTO participants(id,room_id,display_name,device_id,access_revoked,online,last_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  insertParticipant.run(1,1,'Alice',DEV_A,0,1,'2026-09-22 12:00:00','2026-09-22 12:00:00');
  insertParticipant.run(2,1,'Bob',DEV_B,0,1,'2026-09-22 12:00:00','2026-09-22 12:00:00');
  insertParticipant.run(3,1,'Revoked',DEV_REVOKED,1,0,'2026-09-22 12:00:00','2026-09-22 12:00:00');
  insertParticipant.run(4,2,'Alice',DEV_A,0,1,'2026-09-22 12:00:00','2026-09-22 12:00:00');
  insertParticipant.run(5,3,'Alice',DEV_A,0,1,'2026-09-22 12:00:00','2026-09-22 12:00:00');

  const insertMessage=db.prepare(`INSERT INTO messages
    (id,room_id,sender_id,ciphertext,iv,type,client_message_id,status,event_type,event_actor_name,created_at,deleted_for_all,deleted_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertMessage.run(101,1,1,'cipher-101','iv-101','text','c101','sent',null,null,'2026-09-22 12:00:00',0,null);
  insertMessage.run(102,1,2,'cipher-102','iv-102','text','c102','sent',null,null,'2026-09-22 12:01:00',0,null);
  insertMessage.run(103,1,1,'','','system','sys103','sent','participant_joined','Alice','2026-09-22 12:02:00',0,null);
  insertMessage.run(104,1,1,'','','text','c104','sent',null,null,'2026-09-22 12:03:00',1,'2026-09-22 12:04:00');
  insertMessage.run(105,1,1,'cipher-105','iv-105','text','c105','sent',null,null,'2026-09-22 12:05:00',0,null);
  insertMessage.run(201,3,5,'cipher-201','iv-201','text','c201','sent',null,null,'2026-09-22 12:06:00',0,null);
  db.prepare('INSERT INTO message_hidden(room_id,message_id,device_id) VALUES(?,?,?)').run(1,105,DEV_A);

  const q={
    findRoomByPublicId:db.prepare('SELECT * FROM rooms WHERE public_id=?'),
  };
  const socketsByDevice=new Map();
  const socketA1={name:'A1'};
  const socketA2={name:'A2'};
  const socketB={name:'B1'};
  socketsByDevice.set(DEV_A,new Set([socketA1,socketA2]));
  socketsByDevice.set(DEV_B,new Set([socketB]));
  let deviceEvents=[];
  let roomEvents=[];
  const sendWsJson=(ws,payload)=>{deviceEvents.push({socket:ws.name,payload:clone(payload)});return true;};
  const sendToRoomParticipants=(roomId,payload)=>{roomEvents.push({roomId,payload:clone(payload)});return true;};
  const isRoomOpen=room=>Boolean(room&&String(room.status||'open').toLowerCase()==='open');
  const roomStatePayload=room=>({roomStatus:String(room?.status||'open').toLowerCase(),closedAt:toIsoUtc(room?.closed_at)});

  const app=express();
  app.use(express.json());
  installMessagePinsServer({app,db,q,socketsByDevice,sendWsJson,sendToRoomParticipants,toIsoUtc,isRoomOpen,roomStatePayload});

  const server=await new Promise((resolve,reject)=>{
    const srv=app.listen(0,'127.0.0.1',()=>resolve(srv));
    srv.once('error',reject);
  });
  const address=server.address();
  const base=`http://127.0.0.1:${address.port}`;

  async function request(method,path,body){
    const options={method,headers:{}};
    if(body!==undefined){options.headers['content-type']='application/json';options.body=JSON.stringify(body);}
    const response=await fetch(base+path,options);
    const text=await response.text();
    return {status:response.status,body:text?JSON.parse(text):null};
  }
  const rows=()=>db.prepare('SELECT room_id,message_id,scope,owner_device_id,pinned_by_device_id FROM message_pins ORDER BY room_id,message_id,scope,owner_device_id').all();
  const clearEvents=()=>{deviceEvents=[];roomEvents=[];};
  const expectNoEffects=(beforeRows)=>{assert.deepEqual(rows(),beforeRows);assert.deepEqual(deviceEvents,[]);assert.deepEqual(roomEvents,[]);};

  try{
    assert(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='message_pins'").get(),'message_pins schema was not installed');

    let before=rows();
    let r=await request('GET',`/api/rooms/missing/pins?deviceId=${DEV_A}`);
    assert.equal(r.status,404);
    assert.deepEqual(r.body,{ok:false,error:'room not found'});
    expectNoEffects(before);

    clearEvents(); before=rows();
    r=await request('GET','/api/rooms/room-open/pins');
    assert.equal(r.status,400);
    assert.deepEqual(r.body,{ok:false,error:'deviceId required'});
    expectNoEffects(before);

    clearEvents(); before=rows();
    r=await request('GET',`/api/rooms/room-open/pins?deviceId=${DEV_UNKNOWN}`);
    assert.equal(r.status,403);
    assert.deepEqual(r.body,{ok:false,error:'forbidden',code:'ACCESS_REVOKED'});
    expectNoEffects(before);

    clearEvents(); before=rows();
    r=await request('GET',`/api/rooms/room-open/pins?deviceId=${DEV_REVOKED}`);
    assert.equal(r.status,403);
    assert.deepEqual(r.body,{ok:false,error:'forbidden',code:'ACCESS_REVOKED'});
    expectNoEffects(before);

    clearEvents(); before=rows();
    r=await request('POST','/api/rooms/room-closed/messages/101/pins',{deviceId:DEV_A,scope:'shared'});
    assert.equal(r.status,409);
    assert.deepEqual(r.body,{ok:false,error:'room closed',code:'ROOM_CLOSED'});
    expectNoEffects(before);

    clearEvents(); before=rows();
    r=await request('POST','/api/rooms/room-open/messages/101/pins',{deviceId:DEV_A,scope:'bad'});
    assert.equal(r.status,400);
    assert.deepEqual(r.body,{ok:false,error:'invalid pin request'});
    expectNoEffects(before);

    clearEvents(); before=rows();
    r=await request('POST','/api/rooms/room-open/messages/999/pins',{deviceId:DEV_A,scope:'shared'});
    assert.equal(r.status,404);
    assert.deepEqual(r.body,{ok:false,error:'message not found'});
    expectNoEffects(before);

    clearEvents(); before=rows();
    r=await request('POST','/api/rooms/room-open/messages/104/pins',{deviceId:DEV_A,scope:'shared'});
    assert.equal(r.status,404);
    assert.deepEqual(r.body,{ok:false,error:'message not found'});
    expectNoEffects(before);

    clearEvents(); before=rows();
    r=await request('POST','/api/rooms/room-open/messages/103/pins',{deviceId:DEV_A,scope:'shared'});
    assert.equal(r.status,409);
    assert.deepEqual(r.body,{ok:false,error:'system message cannot be pinned'});
    expectNoEffects(before);

    clearEvents(); before=rows();
    r=await request('POST','/api/rooms/room-open/messages/105/pins',{deviceId:DEV_A,scope:'personal'});
    assert.equal(r.status,409);
    assert.deepEqual(r.body,{ok:false,error:'message is hidden for this device'});
    expectNoEffects(before);

    clearEvents();
    r=await request('POST','/api/rooms/room-open/messages/101/pins',{deviceId:DEV_A,scope:'shared'});
    assert.equal(r.status,200);
    assert.deepEqual(normalizePinsBody(r.body),{
      ok:true,scope:'shared',messageId:101,
      pins:[{
        messageId:101,shared:true,personal:false,sharedPinnedAt:'<time>',personalPinnedAt:null,
        sharedPinnedByDeviceId:DEV_A,personalPinnedByDeviceId:null,
        message:{id:101,client_message_id:'c101',ciphertext:'cipher-101',iv:'iv-101',reply_to_message_id:null,status:'sent',event_type:null,event_actor_name:null,created_at:'2026-09-22T12:00:00Z',delivered_at:null,read_at:null,edited_at:null,deleted_for_all:false,deleted_at:null,sender_name:'Alice',sender_device_id:DEV_A,type:'text',media:[]}
      }],
      roomStatus:'open',closedAt:null
    });
    assert.deepEqual(rows(),[{room_id:1,message_id:101,scope:'shared',owner_device_id:'',pinned_by_device_id:DEV_A}]);
    assert.deepEqual(deviceEvents,[]);
    assert.deepEqual(roomEvents,[{roomId:'room-open',payload:{type:'pins:changed',roomId:'room-open',messageId:101,scope:'shared',action:'pinned',actorDeviceId:DEV_A}}]);

    clearEvents();
    r=await request('POST','/api/rooms/room-open/messages/101/pins',{deviceId:DEV_A,scope:'personal'});
    assert.equal(r.status,200);
    const personalBody=normalizePinsBody(r.body);
    assert.equal(personalBody.pins.length,1);
    assert.equal(personalBody.pins[0].shared,true);
    assert.equal(personalBody.pins[0].personal,true);
    assert.equal(personalBody.pins[0].personalPinnedAt,'<time>');
    assert.equal(personalBody.pins[0].personalPinnedByDeviceId,DEV_A);
    assert.deepEqual(rows(),[
      {room_id:1,message_id:101,scope:'personal',owner_device_id:DEV_A,pinned_by_device_id:DEV_A},
      {room_id:1,message_id:101,scope:'shared',owner_device_id:'',pinned_by_device_id:DEV_A}
    ]);
    assert.deepEqual(roomEvents,[]);
    assert.deepEqual(deviceEvents,[
      {socket:'A1',payload:{type:'pins:changed',roomId:'room-open',messageId:101,scope:'personal',action:'pinned',actorDeviceId:DEV_A}},
      {socket:'A2',payload:{type:'pins:changed',roomId:'room-open',messageId:101,scope:'personal',action:'pinned',actorDeviceId:DEV_A}}
    ]);

    clearEvents();
    r=await request('GET',`/api/rooms/room-open/pins?deviceId=${DEV_B}`);
    assert.equal(r.status,200);
    assert.equal(r.body.pins.length,1);
    assert.equal(r.body.pins[0].shared,true);
    assert.equal(r.body.pins[0].personal,false);
    assert.deepEqual(deviceEvents,[]);
    assert.deepEqual(roomEvents,[]);

    clearEvents();
    r=await request('GET',`/api/rooms/room-open/pins?deviceId=${DEV_A}`);
    assert.equal(r.status,200);
    assert.equal(r.body.pins.length,1);
    assert.equal(r.body.pins[0].shared,true);
    assert.equal(r.body.pins[0].personal,true);

    clearEvents();
    r=await request('POST','/api/rooms/room-open/messages/101/pins',{deviceId:DEV_A,scope:'personal'});
    assert.equal(r.status,200);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM message_pins WHERE room_id=1 AND message_id=101 AND scope='personal' AND owner_device_id=?").get(DEV_A).n,1);
    assert.equal(deviceEvents.length,2,'touching an existing personal pin still emits to every socket of the owner device');
    assert.deepEqual(roomEvents,[]);

    clearEvents();
    r=await request('DELETE','/api/rooms/room-open/messages/101/pins/personal',{deviceId:DEV_A});
    assert.equal(r.status,200);
    assert.equal(r.body.ok,true);
    assert.equal(r.body.scope,'personal');
    assert.equal(r.body.messageId,101);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM message_pins WHERE room_id=1 AND message_id=101 AND scope='personal' AND owner_device_id=?").get(DEV_A).n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM message_pins WHERE room_id=1 AND message_id=101 AND scope='shared'").get().n,1);
    assert.deepEqual(roomEvents,[]);
    assert.deepEqual(deviceEvents.map(x=>x.payload),[
      {type:'pins:changed',roomId:'room-open',messageId:101,scope:'personal',action:'unpinned',actorDeviceId:DEV_A},
      {type:'pins:changed',roomId:'room-open',messageId:101,scope:'personal',action:'unpinned',actorDeviceId:DEV_A}
    ]);

    clearEvents();
    r=await request('DELETE','/api/rooms/room-open/messages/101/pins/personal',{deviceId:DEV_A});
    assert.equal(r.status,200);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM message_pins WHERE room_id=1 AND message_id=101 AND scope='personal' AND owner_device_id=?").get(DEV_A).n,0);
    assert.equal(deviceEvents.length,2,'idempotent unpin still emits the existing pins:changed contract');

    clearEvents();
    await request('POST','/api/rooms/room-open/messages/102/pins',{deviceId:DEV_A,scope:'personal'});
    clearEvents();
    await request('POST','/api/rooms/room-open/messages/102/pins',{deviceId:DEV_B,scope:'personal'});
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM message_pins WHERE room_id=1 AND message_id=102 AND scope='personal'").get().n,2);
    clearEvents();
    r=await request('DELETE','/api/rooms/room-open/pins',{deviceId:DEV_A,scope:'personal'});
    assert.equal(r.status,200);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM message_pins WHERE room_id=1 AND scope='personal' AND owner_device_id=?").get(DEV_A).n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM message_pins WHERE room_id=1 AND scope='personal' AND owner_device_id=?").get(DEV_B).n,1);
    assert.deepEqual(roomEvents,[]);
    assert.equal(deviceEvents.length,2);
    assert.deepEqual(deviceEvents[0].payload,{type:'pins:changed',roomId:'room-open',messageId:null,scope:'personal',action:'cleared',actorDeviceId:DEV_A});

    clearEvents();
    await request('POST','/api/rooms/room-open/messages/102/pins',{deviceId:DEV_A,scope:'shared'});
    clearEvents();
    await request('POST','/api/rooms/room-other/messages/201/pins',{deviceId:DEV_A,scope:'shared'});
    clearEvents();
    r=await request('DELETE','/api/rooms/room-open/pins',{deviceId:DEV_A,scope:'shared'});
    assert.equal(r.status,200);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM message_pins WHERE room_id=1 AND scope='shared'").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM message_pins WHERE room_id=3 AND scope='shared'").get().n,1,'shared clear escaped its room');
    assert.deepEqual(deviceEvents,[]);
    assert.deepEqual(roomEvents,[{roomId:'room-open',payload:{type:'pins:changed',roomId:'room-open',messageId:null,scope:'shared',action:'cleared',actorDeviceId:DEV_A}}]);

    clearEvents(); before=rows();
    r=await request('DELETE','/api/rooms/room-open/pins',{deviceId:DEV_A,scope:'bad'});
    assert.equal(r.status,400);
    assert.deepEqual(r.body,{ok:false,error:'invalid pin scope'});
    expectNoEffects(before);

    clearEvents();
    await request('POST','/api/rooms/room-open/messages/101/pins',{deviceId:DEV_A,scope:'shared'});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM message_pins WHERE room_id=1 AND message_id=101').get().n,1);
    db.prepare('UPDATE messages SET deleted_for_all=1 WHERE id=101').run();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM message_pins WHERE room_id=1 AND message_id=101').get().n,0,'deleted_for_all trigger failed');

    clearEvents();
    await request('POST','/api/rooms/room-open/messages/102/pins',{deviceId:DEV_A,scope:'shared'});
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM message_pins WHERE room_id=1 AND message_id=102').get().n>=1);
    db.prepare('DELETE FROM messages WHERE id=102').run();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM message_pins WHERE room_id=1 AND message_id=102').get().n,0,'message delete trigger failed');

    console.log('PASS 179.2 message pins HTTP success/error status and body contract');
    console.log('PASS 179.2 personal/shared pins persist with existing owner and room scoping');
    console.log('PASS 179.2 personal WS events stay device-scoped; shared WS events stay room-scoped');
    console.log('PASS 179.2 deleted_for_all/message-delete triggers remove pin rows');
  } finally {
    await new Promise(resolve=>server.close(resolve));
    db.close();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
