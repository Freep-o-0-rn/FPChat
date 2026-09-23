'use strict';
// Only used with the browser harness's temporary SQLite, never the working DB.
const fs=require('node:fs');
const Database=require('better-sqlite3');
const {database,fixtures}=JSON.parse(fs.readFileSync(0,'utf8'));
if(!database.includes('fpchat-174-'))throw Error('Expected isolated test database');
const db=new Database(database);
const insert=db.prepare('INSERT INTO messages(room_id,sender_id,ciphertext,iv,status,reply_to_message_id,created_at) VALUES(?,?,?,?,?,?,?)');
const output=[];
db.transaction(()=>{
  for(const fixture of fixtures){
    const room=db.prepare('SELECT id FROM rooms WHERE public_id=?').get(fixture.roomId);
    let sender=db.prepare('SELECT id FROM participants WHERE room_id=? AND device_id=?').get(room.id,fixture.deviceId).id;
    if(fixture.incoming)sender=Number(db.prepare('INSERT INTO participants(room_id,device_id,display_name) VALUES(?,?,?)').run(room.id,'test-peer-'+fixture.roomId,'Test Peer').lastInsertRowid);
    const ids=[];
    for(let i=0;i<fixture.count;i++){
      const payload=fixture.encrypted[i%fixture.encrypted.length];
      const status=fixture.incoming&&i>=200?'sent':'read';
      ids.push(Number(insert.run(room.id,sender,payload.ciphertext,payload.iv,status,i===fixture.count-1?ids[20]||null:null,new Date(Date.UTC(2026,8,1)+i*60000).toISOString()).lastInsertRowid));
    }
    output.push({roomId:fixture.roomId,first:ids[0],last:ids.at(-1),replySource:ids[20],firstUnread:fixture.incoming?ids[200]:null});
  }
})();
db.close();console.log(JSON.stringify(output));
