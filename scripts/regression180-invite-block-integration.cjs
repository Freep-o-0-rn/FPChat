'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const Database=require('better-sqlite3');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const CREATOR='creator-1803';
const JOINER='joiner-1803';

function freePort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const port=server.address().port;
      server.close(error=>error?reject(error):resolve(port));
    });
  });
}

async function request(base,method,pathname,body){
  const options={method,headers:{}};
  if(body!==undefined){
    options.headers['content-type']='application/json';
    options.body=JSON.stringify(body);
  }
  const response=await fetch(base+pathname,options);
  const text=await response.text();
  let parsed=null;
  try{parsed=text?JSON.parse(text):null;}catch{parsed=text;}
  return {status:response.status,body:parsed};
}

async function main(){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fpchat-1803-'));
  const dbPath=path.join(temp,'chat.sqlite');
  const uploadDir=path.join(temp,'uploads');
  fs.mkdirSync(uploadDir,{recursive:true});
  const port=await freePort();
  const base=`http://127.0.0.1:${port}`;
  const env={
    ...process.env,
    APP_HOST:'127.0.0.1',
    APP_PORT:String(port),
    DATABASE_PATH:dbPath,
    FPCHAT_UPLOAD_DIR:uploadDir,
    PUBLIC_BASE_URL:'',
    VAPID_PUBLIC_KEY:'',
    VAPID_PRIVATE_KEY:''
  };

  const child=spawn(process.execPath,['server.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let stdout='';
  let stderr='';
  let readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const timeout=setTimeout(()=>readyReject(new Error('server startup timeout\n'+stdout+'\n'+stderr)),10000);
  child.stdout.on('data',chunk=>{
    stdout+=chunk.toString();
    if(stdout.includes('FPChat listening on'))readyResolve();
  });
  child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  child.once('exit',(code,signal)=>{
    if(!stdout.includes('FPChat listening on'))readyReject(new Error(`server exited before ready code=${code} signal=${signal}\n${stderr}`));
  });

  let db=null;
  try{
    await ready;
    clearTimeout(timeout);

    const create=await request(base,'POST','/api/rooms',{
      displayName:'Creator',
      deviceId:CREATOR,
      roomSecret:'room-secret-1803',
      recoverySalt:'salt-1803',
      recoveryVerifier:'verifier-1803',
      recoverySecretIv:'iv-1803',
      recoverySecretCiphertext:'cipher-1803'
    });
    assert.equal(create.status,200,'room creation failed: '+JSON.stringify(create.body));
    assert.equal(create.body.ok,true);
    assert.equal(create.body.participant.deviceId,CREATOR);

    const roomPublicId=String(create.body.publicId);
    const inviteUrl=new URL(create.body.inviteLink);
    const inviteCode=inviteUrl.pathname.split('/').filter(Boolean).pop();
    assert(inviteCode,'invite code missing');

    db=new Database(dbPath);
    const room=db.prepare('SELECT id,public_id FROM rooms WHERE public_id=?').get(roomPublicId);
    assert(room?.id,'room row missing');
    const inviteStmt=db.prepare('SELECT id,room_id,room_secret,used_at,used_by_device_id,revoked FROM invites WHERE invite_code=?');
    const participantCount=db.prepare('SELECT COUNT(*) AS count FROM participants WHERE room_id=? AND access_revoked=0');
    const joinerParticipant=db.prepare('SELECT id,device_id FROM participants WHERE room_id=? AND device_id=?');
    const joinedEvents=db.prepare("SELECT id,event_type,sender_id,client_message_id FROM messages WHERE room_id=? AND event_type='participant_joined' AND type='system' ORDER BY id ASC");
    const blockedEvents=db.prepare("SELECT id,device_id,event_type,dedupe_key,payload_json,read_at FROM system_events WHERE device_id=? AND event_type='blocked_invite_attempt' ORDER BY id ASC");

    const beforeInvite=inviteStmt.get(inviteCode);
    assert.equal(beforeInvite.room_id,room.id);
    assert.equal(beforeInvite.used_at,null);
    assert.equal(beforeInvite.used_by_device_id,null);
    assert.equal(beforeInvite.revoked,0);
    assert.equal(participantCount.get(room.id).count,1);

    db.prepare('INSERT INTO chat_request_blocks(public_id,blocker_device_id,blocked_device_id) VALUES(?,?,?)')
      .run('block-1803-creator-joiner',CREATOR,JOINER);

    const blocked1=await request(base,'POST',`/api/invites/${inviteCode}/join`,{displayName:'Joiner',deviceId:JOINER});
    assert.equal(blocked1.status,403);
    assert.deepEqual(blocked1.body,{ok:false,error:'Вход недоступен: пользователь вас заблокировал.',code:'INVITE_BLOCKED_BY_CREATOR'});

    let invite=inviteStmt.get(inviteCode);
    assert.equal(invite.used_at,null,'blocked join consumed invite');
    assert.equal(invite.used_by_device_id,null,'blocked join assigned invite consumer');
    assert.ok(invite.room_secret,'blocked join cleared invite secret');
    assert.equal(participantCount.get(room.id).count,1,'blocked join granted room access');
    assert.equal(joinerParticipant.get(room.id,JOINER),undefined,'blocked join inserted participant');
    assert.equal(joinedEvents.all(room.id).length,0,'blocked join created participant_joined event');

    let events=blockedEvents.all(CREATOR);
    assert.equal(events.length,1,'first blocked join must create exactly one private system event');
    const firstEventId=events[0].id;
    const firstDedupe=events[0].dedupe_key;
    let payload=JSON.parse(events[0].payload_json);
    assert.equal(payload.attemptCount,1);
    assert.equal(payload.actor.deviceId,JOINER);
    assert.equal(payload.roomPublicId,roomPublicId);
    assert.equal(payload.blockId,'block-1803-creator-joiner');

    const blocked2=await request(base,'POST',`/api/invites/${inviteCode}/join`,{displayName:'Joiner Again',deviceId:JOINER});
    assert.equal(blocked2.status,403);
    assert.equal(blocked2.body.code,'INVITE_BLOCKED_BY_CREATOR');

    invite=inviteStmt.get(inviteCode);
    assert.equal(invite.used_at,null,'repeated blocked join consumed invite');
    assert.equal(invite.used_by_device_id,null);
    assert.ok(invite.room_secret);
    assert.equal(participantCount.get(room.id).count,1,'repeated blocked join granted access');
    assert.equal(joinerParticipant.get(room.id,JOINER),undefined);

    events=blockedEvents.all(CREATOR);
    assert.equal(events.length,1,'repeated blocked join duplicated system event row');
    assert.equal(events[0].id,firstEventId,'repeated blocked join replaced event identity');
    assert.equal(events[0].dedupe_key,firstDedupe,'repeated blocked join changed dedupe key');
    payload=JSON.parse(events[0].payload_json);
    assert.equal(payload.attemptCount,2,'repeated blocked join did not increment attemptCount');
    assert.equal(payload.actor.deviceId,JOINER);
    assert.equal(events[0].read_at,null,'repeated attempt must leave event unread');

    db.prepare('DELETE FROM chat_request_blocks WHERE blocker_device_id=? AND blocked_device_id=?').run(CREATOR,JOINER);

    const normal=await request(base,'POST',`/api/invites/${inviteCode}/join`,{displayName:'Joiner',deviceId:JOINER});
    assert.equal(normal.status,200,'normal join failed after unblock: '+JSON.stringify(normal.body));
    assert.equal(normal.body.ok,true);
    assert.equal(normal.body.publicId,roomPublicId);
    assert.equal(normal.body.participant.deviceId,JOINER);

    invite=inviteStmt.get(inviteCode);
    assert.ok(invite.used_at,'normal join did not consume invite');
    assert.equal(invite.used_by_device_id,JOINER);
    assert.equal(invite.room_secret,null,'normal join did not clear server invite secret');
    assert.equal(participantCount.get(room.id).count,2,'normal join did not grant exactly one participant');
    assert.ok(joinerParticipant.get(room.id,JOINER),'normal join participant missing');
    let joinEvents=joinedEvents.all(room.id);
    assert.equal(joinEvents.length,1,'normal join must create exactly one participant_joined event');

    const participantId=joinerParticipant.get(room.id,JOINER).id;
    assert.equal(joinEvents[0].sender_id,participantId,'participant_joined event actor changed');

    const duplicate=await request(base,'POST',`/api/invites/${inviteCode}/join`,{displayName:'Joiner duplicate',deviceId:JOINER});
    assert.equal(duplicate.status,410);
    assert.deepEqual(duplicate.body,{error:'invite expired or used'});
    assert.equal(participantCount.get(room.id).count,2,'repeated normal join duplicated participant');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM participants WHERE room_id=? AND device_id=?').get(room.id,JOINER).count,1,'joiner participant row duplicated');
    joinEvents=joinedEvents.all(room.id);
    assert.equal(joinEvents.length,1,'repeated normal join duplicated participant_joined event');

    events=blockedEvents.all(CREATOR);
    assert.equal(events.length,1,'successful/duplicate normal join modified blocked-attempt event row count');
    assert.equal(JSON.parse(events[0].payload_json).attemptCount,2,'successful join modified blocked attempt counter');

    console.log('PASS 180.3 blocked join returns 403 without consuming invite or granting access');
    console.log('PASS 180.3 repeated blocked join updates one deduped private event from attemptCount 1 to 2');
    console.log('PASS 180.3 normal join consumes invite once, grants one participant and creates one participant_joined event');
    console.log('PASS 180.3 repeated normal join returns 410 and duplicates neither participant nor joined system event');
  } finally {
    clearTimeout(timeout);
    if(db){try{db.close();}catch{}}
    if(!child.killed)child.kill();
    await new Promise(resolve=>{
      if(child.exitCode!==null||child.signalCode!==null)return resolve();
      child.once('exit',resolve);
      setTimeout(resolve,1500);
    });
    fs.rmSync(temp,{recursive:true,force:true});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
