'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const Database=require('better-sqlite3');
const {run}=require('./browser-harness174.cjs');

run(async({newClient,errors,temp,root})=>{
  const setup=await newClient();
  const fixtures=await setup.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const specs=[
      {name:'reuse',count:450,incoming:false},
      {name:'position',count:450,incoming:false},
      {name:'unread',count:450,incoming:true},
      {name:'revoked',count:260,incoming:false}
    ];
    const out=[];
    for(const spec of specs){
      const secret='next13-'+spec.name;
      const key=await deriveKey(secret);
      const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
      const response=await fetch('/api/rooms',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({displayName:'Next13',deviceId,roomSecret:secret,...recovery})
      });
      if(!response.ok)throw new Error('fixture room '+spec.name+' '+response.status);
      const data=await response.json();
      const encrypted=[];
      for(let i=0;i<12;i++)encrypted.push(await encryptText('next13 '+spec.name+' '+i+' '+('payload '.repeat((i%4)+1)),key));
      out.push({...spec,roomId:data.publicId,deviceId,secret,encrypted});
    }
    return out;
  });

  const seeded=JSON.parse(execFileSync(
    process.env.FPCHAT_TEST_NODE||process.execPath,
    [path.join(root,'scripts/seed-history174.cjs')],
    {input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures}),encoding:'utf8'}
  ));
  await setup.close();

  const db=new Database(path.join(temp,'test.sqlite'));
  db.pragma('busy_timeout = 5000');

  function roomInfo(name){
    const index=fixtures.findIndex(item=>item.name===name);
    const fixture=fixtures[index];
    const room=db.prepare('SELECT id FROM rooms WHERE public_id=?').get(fixture.roomId);
    const me=db.prepare('SELECT id FROM participants WHERE room_id=? AND device_id=?').get(room.id,fixture.deviceId);
    const ids=db.prepare('SELECT id FROM messages WHERE room_id=? ORDER BY id ASC').all(room.id).map(row=>Number(row.id));
    return{...fixture,...seeded[index],dbRoomId:Number(room.id),participantId:Number(me.id),ids};
  }

  const REUSE=roomInfo('reuse');
  const POSITION=roomInfo('position');
  const UNREAD=roomInfo('unread');
  const REVOKED=roomInfo('revoked');

  const upsertView=db.prepare(
    "INSERT INTO chat_view_state(room_id,device_id,anchor_message_id,anchor_offset_px,at_bottom,updated_at) VALUES(?,?,?,?,?,datetime('now')) "+
    "ON CONFLICT(room_id,device_id) DO UPDATE SET anchor_message_id=excluded.anchor_message_id,anchor_offset_px=excluded.anchor_offset_px,at_bottom=excluded.at_bottom,updated_at=datetime('now')"
  );
  upsertView.run(REUSE.dbRoomId,REUSE.deviceId,null,0,1);
  POSITION.savedAnchor=POSITION.ids[250];
  upsertView.run(POSITION.dbRoomId,POSITION.deviceId,POSITION.savedAnchor,17,0);
  upsertView.run(UNREAD.dbRoomId,UNREAD.deviceId,null,0,0);
  upsertView.run(REVOKED.dbRoomId,REVOKED.deviceId,null,0,1);

  const page=await newClient(async p=>{
    await p.addInitScript(({deviceId})=>{
      localStorage.setItem('fpchat:device-id',deviceId);
      localStorage.setItem('fpchat:nick','Next13');
    },{deviceId:REUSE.deviceId});
  });

  await page.evaluate(states=>{
    for(const [roomId,value] of Object.entries(states))STORAGE.set(STORAGE.roomState(roomId),value);
  },Object.fromEntries([REUSE,POSITION,UNREAD,REVOKED].map(item=>[
    item.roomId,{deviceId:item.deviceId,secret:item.secret}
  ])));

  const requests=[];
  page.on('request',request=>{
    let url;
    try{url=new URL(request.url());}catch{return;}
    if(request.method()==='POST'&&/\/api\/rooms\/[^/]+\/join$/.test(url.pathname)){
      requests.push({roomId:url.pathname.split('/')[3],method:'POST',postData:request.postData()});
    }
  });

  const waitStore=async(predicate,arg,timeout=5000)=>{
    await page.waitForFunction(({predicate,arg})=>{
      const fn=(0,eval)('('+predicate+')');
      return fn(arg);
    },{predicate:predicate.toString(),arg},{timeout});
  };

  async function open(item){
    const before=requests.length;
    await page.evaluate(roomId=>openChat(roomId),item.roomId);
    const joins=requests.slice(before).filter(row=>row.roomId===item.roomId);
    assert.equal(joins.length,1,'reopen must still perform exactly one access-check join for '+item.name);
    return page.evaluate(()=>({
      roomId:state.roomId,
      contextRoomId:FPRoomContext170.current()?.roomId||null,
      store:FPMessageStore172.roomSnapshot(state.roomId),
      atBottom:isMessagesAtBottom(document.getElementById('messages')),
      unread:Number(activeChatHistory?.unreadCount||0),
      firstUnread:Number(activeChatHistory?.firstUnreadMessageId)||null,
      mounted:[...document.querySelectorAll('#messages .bubble-wrap.msg')].map(el=>Number(el.dataset.messageId)).filter(Number.isFinite)
    }));
  }

  async function leave(){
    await page.evaluate(()=>setView('chats'));
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(()=>state.roomId),null);
  }

  await page.evaluate(()=>{
    if(!window.__next13DecryptWrapped){
      const base=decryptText;
      decryptText=async function(){
        window.__next13DecryptCalls=(window.__next13DecryptCalls||0)+1;
        return base.apply(this,arguments);
      };
      window.__next13DecryptWrapped=true;
      window.__next13DecryptCalls=0;
    }
  });
  const resetDecrypt=()=>page.evaluate(()=>{window.__next13DecryptCalls=0;});
  const decryptCalls=()=>page.evaluate(()=>Number(window.__next13DecryptCalls||0));

  // 1. Warm same-session tail window.
  let opened=await open(REUSE);
  assert.equal(opened.roomId,REUSE.roomId);
  assert.equal(opened.store.renderedOnce,true);
  assert.equal(opened.atBottom,true);
  assert.ok((await decryptCalls())>=100,'first open unexpectedly reused RAM');
  await leave();

  // 2. Edit while on the chat list. Do not write MessageStore directly: the
  // current WS/message-actions synchronization must update canonical RAM state.
  const editId=REUSE.ids.at(-20);
  const editedText='next13 edited while on list';
  const editResult=await page.evaluate(async input=>{
    const key=await getRoomKey(input.roomId,input.secret);
    const enc=await encryptText(input.text,key);
    const response=await fetch('/api/rooms/'+input.roomId+'/messages/'+input.messageId+'/edit',{
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({deviceId:input.deviceId,ciphertext:enc.ciphertext,iv:enc.iv})
    });
    return{status:response.status,data:await response.json()};
  },{roomId:REUSE.roomId,secret:REUSE.secret,deviceId:REUSE.deviceId,messageId:editId,text:editedText});
  assert.equal(editResult.status,200);

  try{
    await waitStore(text=>FPMessageStore172.get(text.roomId,text.messageId)?.text===text.value,{roomId:REUSE.roomId,messageId:editId,value:editedText},1800);
  }catch{
    // Force the already-existing lifecycle synchronization; no test-only state
    // injection into MessageStore is allowed.
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('fpchat:lifecycle170',{detail:{lastType:'foreground'}})));
    await waitStore(text=>FPMessageStore172.get(text.roomId,text.messageId)?.text===text.value,{roomId:REUSE.roomId,messageId:editId,value:editedText},5000);
  }
  assert.equal(await page.evaluate(({roomId,id})=>FPMessageStore172.get(roomId,id)?.lastSource,{roomId:REUSE.roomId,id:editId}),'edit');

  await resetDecrypt();
  opened=await open(REUSE);
  assert.equal(opened.atBottom,true);
  assert.equal(await decryptCalls(),0,'unchanged same-session window was decrypted again instead of reused');
  const editedDom=await page.evaluate(id=>findMessageElement(id)?.querySelector('.message-text')?.textContent||'',editId);
  assert.equal(editedDom,editedText,'canonical edit was not reused on reopen');
  await leave();

  // 3. Delete-for-all while on the list. Tail membership changes by one id, so
  // the full-window reuse contract must reject the incomplete RAM window and use
  // the existing decrypt/render path rather than guessing.
  const deleteId=REUSE.ids.at(-10);
  const deleteResult=await page.evaluate(async input=>{
    const response=await fetch('/api/rooms/'+input.roomId+'/messages/'+input.messageId,{
      method:'DELETE',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({deviceId:input.deviceId,scope:'all'})
    });
    return{status:response.status,data:await response.json()};
  },{roomId:REUSE.roomId,deviceId:REUSE.deviceId,messageId:deleteId});
  assert.equal(deleteResult.status,200);
  try{
    await waitStore(x=>Boolean(FPMessageStore172.get(x.roomId,x.messageId)?.deleted),{roomId:REUSE.roomId,messageId:deleteId},1800);
  }catch{
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('fpchat:lifecycle170',{detail:{lastType:'foreground'}})));
    await waitStore(x=>Boolean(FPMessageStore172.get(x.roomId,x.messageId)?.deleted),{roomId:REUSE.roomId,messageId:deleteId},5000);
  }

  await resetDecrypt();
  opened=await open(REUSE);
  assert.equal(opened.mounted.includes(deleteId),false,'deleted-for-all message reappeared after reopen');
  assert.equal(await page.evaluate(id=>Boolean(findMessageElement(id)),deleteId),false);
  assert.equal(await page.evaluate(({roomId,id})=>Boolean(FPMessageStore172.get(roomId,id)?.deleted),{roomId:REUSE.roomId,id:deleteId}),true);

  // A full window is reusable only when every server-selected message has a
  // safe canonical record. One unknown id must reject the whole reuse attempt.
  const insufficient=await page.evaluate(roomId=>FPMessageStore172.reuseWindow(roomId,[{
    id:999999999,
    iv:'missing',
    ciphertext:'missing',
    status:'read',
    created_at:'2026-09-28T00:00:00.000Z',
    sender_name:'Nobody',
    sender_device_id:'missing',
    type:'text',
    media:[]
  }])===null,REUSE.roomId);
  assert.equal(insufficient,true,'incomplete RAM data was accepted as a reusable window');
  await leave();

  // 4. Saved reading position remains server-authoritative. Warm the room,
  // leave after saving its actual visible anchor, then reopen and compare offset.
  await resetDecrypt();
  opened=await open(POSITION);
  assert.ok(opened.mounted.includes(POSITION.savedAnchor),'saved anchor missing on first position open');
  const saved=await page.evaluate(async targetId=>{
    const el=findMessageElement(targetId);
    if(!el)throw new Error('position target missing');
    FPScroll173.focus(el,'auto',21);
    await saveViewStateNow();
    const box=document.getElementById('messages');
    const anchor=getFirstVisibleMessageAnchor(box);
    return anchor;
  },POSITION.ids[270]);
  assert.ok(saved?.anchorMessageId,'no reading position saved');
  await leave();

  const dbView=db.prepare('SELECT anchor_message_id,anchor_offset_px,at_bottom FROM chat_view_state WHERE room_id=? AND device_id=?').get(POSITION.dbRoomId,POSITION.deviceId);
  assert.equal(Number(dbView.at_bottom),0);
  assert.ok(Number(dbView.anchor_message_id)>0);

  await resetDecrypt();
  opened=await open(POSITION);
  const restored=await page.evaluate(anchorId=>{
    const box=document.getElementById('messages');
    const el=findMessageElement(anchorId);
    if(!box||!el)return null;
    return Math.round(el.getBoundingClientRect().top-box.getBoundingClientRect().top);
  },Number(dbView.anchor_message_id));
  assert.notEqual(restored,null,'saved reading anchor was not mounted on reopen');
  assert.ok(Math.abs(restored-Number(dbView.anchor_offset_px))<=3,'saved reading offset was not restored');
  await leave();

  // 5. Unread target remains join-authoritative even when MessageStore already
  // holds an earlier window.
  opened=await open(UNREAD);
  assert.ok(opened.firstUnread,'initial unread target missing');
  await leave();
  const unreadBefore=db.prepare(
    "SELECT COUNT(*) count FROM messages WHERE room_id=? AND sender_id!=? AND status!='read' AND COALESCE(deleted_for_all,0)=0"
  ).get(UNREAD.dbRoomId,UNREAD.participantId);
  await resetDecrypt();
  opened=await open(UNREAD);
  assert.ok(opened.firstUnread===null||opened.mounted.includes(opened.firstUnread),'reopen did not honor current first-unread target');
  assert.ok(opened.unread<=Number(unreadBefore.count),'client reused a larger stale unread count');
  await leave();

  // 6. Access is never inferred from RAM. Warm a room, revoke access in DB,
  // then reopen. Join must reject before any stored window can render.
  await resetDecrypt();
  opened=await open(REVOKED);
  assert.equal(opened.store.renderedOnce,true);
  await leave();
  db.prepare('UPDATE participants SET access_revoked=1 WHERE id=?').run(REVOKED.participantId);
  const beforeJoinCount=requests.length;
  await resetDecrypt();
  await page.evaluate(roomId=>openChat(roomId),REVOKED.roomId);
  await page.waitForTimeout(100);
  assert.equal(requests.slice(beforeJoinCount).filter(row=>row.roomId===REVOKED.roomId).length,1,'revoked reopen skipped join access check');
  assert.equal(await page.evaluate(()=>state.roomId),null,'revoked room became active from RAM');
  assert.equal(await decryptCalls(),0,'revoked room decrypted/rendered cached messages');
  assert.equal(await page.evaluate(roomId=>Boolean(STORAGE.get(STORAGE.roomState(roomId))),REVOKED.roomId),false,'revoked local room state was not removed');

  db.close();
  assert.deepEqual(errors,[]);
  console.log('PASS item 13 reuses a fully matching previously-rendered MessageStore window only after join access check');
  console.log('PASS item 13 existing WS/lifecycle sync updates edits while on the list and canonical edit renders without repeat decrypt');
  console.log('PASS item 13 delete tombstones survive reopen; incomplete RAM windows are rejected and first-open fallback remains intact');
  console.log('PASS item 13 saved reading position remains server/view-state + FPScroll authoritative');
  console.log('PASS item 13 unread target/count are refreshed by join rather than RAM metadata');
  console.log('PASS item 13 revoked access performs join, renders nothing from MessageStore, and removes local room access');
}).catch(error=>{console.error(error);process.exitCode=1;});
