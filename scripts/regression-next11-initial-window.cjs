'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const Database=require('better-sqlite3');
const {run}=require('./browser-harness174.cjs');

const idsOf=data=>(Array.isArray(data?.messages)?data.messages:[]).map(message=>Number(message.id));
const ascending=ids=>ids.every((id,index)=>index===0||ids[index-1]<id);

run(async({newClient,errors,temp,root})=>{
  const page=await newClient();

  const fixture=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='next11-initial-window';
    const key=await deriveKey(secret);
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:'Next11',deviceId,roomSecret:secret,...recovery})
    });
    if(!response.ok)throw new Error('fixture room '+response.status);
    const data=await response.json();
    const encrypted=[];
    for(let i=0;i<12;i++)encrypted.push(await encryptText('next11 '+i+' '+('payload '.repeat((i%4)+1)),key));
    return{roomId:data.publicId,deviceId,secret,count:500,incoming:true,encrypted};
  });

  const seeded=JSON.parse(execFileSync(
    process.env.FPCHAT_TEST_NODE||process.execPath,
    [path.join(root,'scripts/seed-history174.cjs')],
    {input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures:[fixture]}),encoding:'utf8'}
  ))[0];

  const db=new Database(path.join(temp,'test.sqlite'));
  db.pragma('busy_timeout = 5000');
  const room=db.prepare('SELECT id FROM rooms WHERE public_id=?').get(fixture.roomId);
  const me=db.prepare('SELECT id FROM participants WHERE room_id=? AND device_id=?').get(room.id,fixture.deviceId);
  const messageIds=db.prepare('SELECT id FROM messages WHERE room_id=? ORDER BY id ASC').all(room.id).map(row=>Number(row.id));
  assert.equal(messageIds.length,500);

  const join=async(body={})=>page.evaluate(async input=>{
    const response=await fetch('/api/rooms/'+input.roomId+'/join',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:'Next11',deviceId:input.deviceId,...input.body})
    });
    let data=null;
    try{data=await response.json();}catch{}
    return{status:response.status,data};
  },{roomId:fixture.roomId,deviceId:fixture.deviceId,body});

  const history=async(params)=>page.evaluate(async input=>{
    const query=new URLSearchParams({deviceId:input.deviceId,...input.params});
    const response=await fetch('/api/rooms/'+input.roomId+'/messages?'+query.toString());
    return{status:response.status,data:await response.json()};
  },{roomId:fixture.roomId,deviceId:fixture.deviceId,params});

  // 1. Backward compatibility: no opt-in flag keeps the legacy latest-page response.
  let result=await join();
  assert.equal(result.status,200);
  assert.equal(Object.hasOwn(result.data,'initialWindow'),false,'legacy join gained initialWindow metadata');
  assert.equal(Object.hasOwn(result.data,'hasNewer'),false,'legacy join gained hasNewer');
  assert.equal(Object.hasOwn(result.data,'newerCursor'),false,'legacy join gained newerCursor');
  assert.equal(result.data.messages.length,100);
  assert.deepEqual(idsOf(result.data),messageIds.slice(-100),'legacy join no longer returns latest 100');
  assert.equal(result.data.hasMore,true);
  assert.equal(Number(result.data.nextCursor),messageIds[400]);
  assert.equal(Number(result.data.firstUnreadMessageId),messageIds[200]);
  assert.equal(Number(result.data.unreadCount),300);

  // 2. Opt-in window: first unread has priority over a saved anchor.
  const savedAnchor=messageIds[120];
  db.prepare(
    "INSERT INTO chat_view_state(room_id,device_id,anchor_message_id,anchor_offset_px,at_bottom,updated_at) VALUES(?,?,?,?,0,datetime('now')) "+
    "ON CONFLICT(room_id,device_id) DO UPDATE SET anchor_message_id=excluded.anchor_message_id,anchor_offset_px=excluded.anchor_offset_px,at_bottom=0,updated_at=datetime('now')"
  ).run(room.id,fixture.deviceId,savedAnchor,17);

  result=await join({initialWindow:true});
  assert.equal(result.status,200);
  assert.equal(result.data.initialWindow?.version,1);
  assert.equal(result.data.initialWindow?.mode,'around');
  assert.equal(result.data.initialWindow?.source,'first-unread');
  assert.equal(Number(result.data.initialWindow?.targetMessageId),messageIds[200]);
  assert.equal(Number(result.data.firstUnreadMessageId),messageIds[200]);
  assert.equal(Number(result.data.unreadCount),300);
  assert.ok(result.data.messages.length>=100&&result.data.messages.length<=200,'unbounded initial unread window');
  assert.ok(idsOf(result.data).includes(messageIds[200]),'first unread missing from initial window');
  assert.equal(ascending(idsOf(result.data)),true,'initial unread window is not ascending');
  assert.equal(result.data.hasMore,true);
  assert.equal(result.data.hasNewer,true);
  assert.equal(Number(result.data.initialWindow?.latestMessage?.id),messageIds.at(-1),'latest metadata lost');
  assert.ok(!idsOf(result.data).includes(messageIds.at(-1)),'tail leaked into non-tail unread window');

  // Existing cursor directions must continue from both sides of the returned window.
  const older=await history({before:String(result.data.nextCursor),limit:'100',reactions:'1'});
  assert.equal(older.status,200);
  assert.ok(older.data.messages.length>0,'older cursor did not continue');
  assert.ok(idsOf(older.data).every(id=>id<Number(result.data.nextCursor)),'older cursor crossed initial window');

  const newer=await history({after:String(result.data.newerCursor),limit:'100',reactions:'1'});
  assert.equal(newer.status,200);
  assert.ok(newer.data.messages.length>0,'newer cursor did not continue');
  assert.ok(idsOf(newer.data).every(id=>id>Number(result.data.newerCursor)),'newer cursor crossed initial window');

  // 3. With no unread, saved anchor becomes the target.
  db.prepare("UPDATE messages SET status='read',delivered_at=COALESCE(delivered_at,datetime('now')),read_at=COALESCE(read_at,datetime('now')) WHERE room_id=?").run(room.id);
  result=await join({initialWindow:true});
  assert.equal(result.status,200);
  assert.equal(result.data.unreadCount,0);
  assert.equal(result.data.firstUnreadMessageId,null);
  assert.equal(result.data.initialWindow?.mode,'around');
  assert.equal(result.data.initialWindow?.source,'saved-anchor');
  assert.equal(Number(result.data.initialWindow?.targetMessageId),savedAnchor);
  assert.ok(idsOf(result.data).includes(savedAnchor),'saved anchor missing from initial window');
  assert.ok(!idsOf(result.data).includes(messageIds.at(-1)),'tail leaked into saved-anchor window');

  // 4. Missing stale anchor must fall back to the legacy tail safely.
  const missingAnchor=messageIds.at(-1)+999999;
  db.prepare("UPDATE chat_view_state SET anchor_message_id=?,anchor_offset_px=17,at_bottom=0,updated_at=datetime('now') WHERE room_id=? AND device_id=?")
    .run(missingAnchor,room.id,fixture.deviceId);
  result=await join({initialWindow:true});
  assert.equal(result.status,200);
  assert.equal(result.data.initialWindow?.mode,'tail');
  assert.equal(result.data.initialWindow?.source,'tail');
  assert.equal(result.data.initialWindow?.targetMessageId,null);
  assert.deepEqual(idsOf(result.data),messageIds.slice(-100),'missing anchor fallback is not current tail');

  // 5. A deleted-for-all stale anchor is unavailable and also falls back to tail.
  const deletedAnchor=messageIds[140];
  db.prepare("UPDATE chat_view_state SET anchor_message_id=?,anchor_offset_px=9,at_bottom=0,updated_at=datetime('now') WHERE room_id=? AND device_id=?")
    .run(deletedAnchor,room.id,fixture.deviceId);
  db.prepare("UPDATE messages SET deleted_for_all=1,deleted_at=datetime('now') WHERE id=? AND room_id=?").run(deletedAnchor,room.id);
  result=await join({initialWindow:true});
  assert.equal(result.status,200);
  assert.equal(result.data.initialWindow?.mode,'tail');
  assert.equal(result.data.initialWindow?.targetMessageId,null);
  assert.equal(idsOf(result.data).includes(deletedAnchor),false,'deleted stale anchor returned as target');

  // 6. Deleted unread is ignored by the existing unread queries; the next visible unread wins.
  db.prepare("UPDATE messages SET status='read',delivered_at=COALESCE(delivered_at,datetime('now')),read_at=COALESCE(read_at,datetime('now')) WHERE room_id=?").run(room.id);
  const unreadOne=messageIds[220],unreadTwo=messageIds[221];
  db.prepare("UPDATE messages SET status='sent',delivered_at=NULL,read_at=NULL WHERE id IN (?,?)").run(unreadOne,unreadTwo);
  db.prepare("UPDATE messages SET deleted_for_all=1,deleted_at=datetime('now') WHERE id=? AND room_id=?").run(unreadOne,room.id);
  result=await join({initialWindow:true});
  assert.equal(result.status,200);
  assert.equal(result.data.unreadCount,1);
  assert.equal(Number(result.data.firstUnreadMessageId),unreadTwo);
  assert.equal(result.data.initialWindow?.source,'first-unread');
  assert.equal(Number(result.data.initialWindow?.targetMessageId),unreadTwo);
  assert.ok(idsOf(result.data).includes(unreadTwo),'next non-deleted unread was not selected');

  // 7. Access check remains ahead of initial-window work.
  const denied=await page.evaluate(async input=>{
    const response=await fetch('/api/rooms/'+input.roomId+'/join',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:'Denied',deviceId:'00000000-0000-4000-8000-000000000999',initialWindow:true})
    });
    return{status:response.status,data:await response.json()};
  },{roomId:fixture.roomId});
  assert.equal(denied.status,403);
  assert.equal(denied.data.code,'ACCESS_REVOKED');

  db.close();
  assert.deepEqual(errors,[]);
  console.log('PASS next-plan item 11 legacy join remains latest-page compatible without initialWindow');
  console.log('PASS initialWindow chooses first unread before saved anchor and returns bounded before/after window');
  console.log('PASS initialWindow preserves older/newer cursor continuation');
  console.log('PASS missing/deleted saved anchors fall back to tail');
  console.log('PASS deleted unread is excluded and access checks still reject revoked/unknown devices');
  console.log('NOTE client openChat does not request initialWindow yet; item 12 was not started');
}).catch(error=>{console.error(error);process.exitCode=1;});
