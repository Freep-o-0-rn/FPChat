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
    const output=[];
    for(const name of ['a','b','old','stale']){
      const secret='next12-'+name;
      const key=await deriveKey(secret);
      const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
      const response=await fetch('/api/rooms',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({displayName:'Next12',deviceId,roomSecret:secret,...recovery})
      });
      if(!response.ok)throw new Error('fixture room '+name+' '+response.status);
      const data=await response.json();
      const encrypted=[];
      for(let i=0;i<12;i++)encrypted.push(await encryptText('next12 '+name+' '+i+' '+('payload '.repeat((i%4)+1)),key));
      output.push({name,roomId:data.publicId,deviceId,secret,count:name==='a'?700:650,incoming:true,encrypted});
    }
    return output;
  });
  const seeded=JSON.parse(execFileSync(
    process.env.FPCHAT_TEST_NODE||process.execPath,
    [path.join(root,'scripts/seed-history174.cjs')],
    {input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures}),encoding:'utf8'}
  ));
  await setup.close();

  const byName=Object.fromEntries(fixtures.map((fixture,index)=>[fixture.name,{...fixture,...seeded[index]}]));
  const db=new Database(path.join(temp,'test.sqlite'));
  db.pragma('busy_timeout = 5000');

  function roomState(name){
    const fixture=byName[name];
    const room=db.prepare('SELECT id FROM rooms WHERE public_id=?').get(fixture.roomId);
    const me=db.prepare('SELECT id FROM participants WHERE room_id=? AND device_id=?').get(room.id,fixture.deviceId);
    const ids=db.prepare('SELECT id FROM messages WHERE room_id=? ORDER BY id ASC').all(room.id).map(row=>Number(row.id));
    return{...fixture,dbRoomId:Number(room.id),participantId:Number(me.id),ids};
  }
  const A=roomState('a'),B=roomState('b'),OLD=roomState('old'),STALE=roomState('stale');

  const upsertView=db.prepare(
    "INSERT INTO chat_view_state(room_id,device_id,anchor_message_id,anchor_offset_px,at_bottom,updated_at) VALUES(?,?,?,?,?,datetime('now')) "+
    "ON CONFLICT(room_id,device_id) DO UPDATE SET anchor_message_id=excluded.anchor_message_id,anchor_offset_px=excluded.anchor_offset_px,at_bottom=excluded.at_bottom,updated_at=datetime('now')"
  );
  const markAllRead=db.prepare("UPDATE messages SET status='read',delivered_at=COALESCE(delivered_at,datetime('now')),read_at=COALESCE(read_at,datetime('now')) WHERE room_id=?");

  // A keeps its seeded first unread at index 200 and also has an older saved
  // reading anchor. The saved non-bottom position must win: new unread must
  // not yank a user away from old history.
  A.savedAnchor=A.ids[100];
  A.unread=A.ids[200];
  upsertView.run(A.dbRoomId,A.deviceId,A.savedAnchor,13,0);

  // B is the saved-position path.
  markAllRead.run(B.dbRoomId);
  B.savedAnchor=B.ids[250];
  upsertView.run(B.dbRoomId,B.deviceId,B.savedAnchor,17,0);

  // OLD simulates a server that ignores the new request field.
  markAllRead.run(OLD.dbRoomId);
  OLD.savedAnchor=OLD.ids[250];
  upsertView.run(OLD.dbRoomId,OLD.deviceId,OLD.savedAnchor,19,0);

  // STALE retains a raw view-state row pointing at a deleted-for-all message.
  markAllRead.run(STALE.dbRoomId);
  STALE.savedAnchor=STALE.ids[250];
  upsertView.run(STALE.dbRoomId,STALE.deviceId,STALE.savedAnchor,11,0);
  db.prepare("UPDATE messages SET deleted_for_all=1,deleted_at=datetime('now') WHERE id=? AND room_id=?")
    .run(STALE.savedAnchor,STALE.dbRoomId);

  const deviceId=A.deviceId;
  const roomStateInput=Object.fromEntries(
    [A,B,OLD,STALE].map(item=>[item.roomId,{deviceId:item.deviceId,secret:item.secret}])
  );

  const page=await newClient(async p=>{
    await p.addInitScript(({deviceId})=>{
      localStorage.setItem('fpchat:device-id',deviceId);
      localStorage.setItem('fpchat:nick','Next12');
    },{deviceId});
  });

  await page.evaluate(states=>{
    for(const [roomId,value] of Object.entries(states))STORAGE.set(STORAGE.roomState(roomId),value);
    window.__next12RoomEvents=[];
    window.addEventListener('fpchat:room-open170',event=>window.__next12RoomEvents.push({...event.detail}));
  },roomStateInput);

  const requests=[];
  page.on('request',request=>{
    let url;
    try{url=new URL(request.url());}catch{return;}
    if(!url.pathname.includes('/api/rooms/'))return;
    if(!url.pathname.endsWith('/join')&&!url.pathname.endsWith('/messages'))return;
    requests.push({
      method:request.method(),
      url:request.url(),
      path:url.pathname,
      before:url.searchParams.get('before'),
      after:url.searchParams.get('after'),
      limit:url.searchParams.get('limit'),
      reactions:url.searchParams.get('reactions'),
      postData:request.postData()
    });
  });
  const clearRequests=()=>{requests.length=0;};
  const roomRequests=roomId=>requests.filter(row=>row.path.includes('/api/rooms/'+roomId+'/'));

  async function openAndInspect(item,target,expectTail=false){
    clearRequests();
    const started=Date.now();
    await page.evaluate(roomId=>openChat(roomId),item.roomId);
    const elapsedMs=Date.now()-started;
    await page.waitForTimeout(80);
    const state=await page.evaluate(({roomId,target,last})=>{
      const box=document.getElementById('messages');
      return{
        stateRoomId:window.state?.roomId||state.roomId,
        contextRoomId:window.FPRoomContext170?.current?.()?.roomId||null,
        targetMounted:target?Boolean(findMessageElement(target)):null,
        lastMounted:Boolean(findMessageElement(last)),
        hasMore:Boolean(activeChatHistory?.hasMore),
        hasNewer:Boolean(activeChatHistory?.hasNewer),
        oldest:Number(activeChatHistory?.nextCursor)||null,
        newest:Number(activeChatHistory?.newerCursor)||null,
        mounted:box?.querySelectorAll('.bubble-wrap.msg').length||0
      };
    },{roomId:item.roomId,target,last:item.last});
    assert.equal(state.stateRoomId,item.roomId);
    assert.equal(state.contextRoomId,item.roomId);
    if(target)assert.equal(state.targetMounted,true,'target not mounted for '+item.name);
    if(expectTail)assert.equal(state.lastMounted,true,'tail not mounted for '+item.name);
    return{elapsedMs,state,requests:roomRequests(item.roomId)};
  }

  // 1. Current server + saved old-history position + unread: the saved
  // non-bottom anchor wins, so new unread does not yank the reader away.
  let result=await openAndInspect(A,A.savedAnchor,false);
  let rows=result.requests;
  const joinA=rows.find(row=>row.path.endsWith('/join'));
  assert.ok(joinA,'A join missing');
  assert.equal(JSON.parse(joinA.postData||'{}').initialWindow,true,'client did not opt into initial window');
  assert.equal(rows.some(row=>row.before===String(A.savedAnchor+1)),false,'A redundantly fetched before saved anchor');
  assert.equal(rows.some(row=>row.after===String(A.savedAnchor)),false,'A redundantly fetched after saved anchor');
  assert.equal(result.state.lastMounted,false,'A unexpectedly mounted latest tail instead of saved old-history window');
  assert.equal(result.state.hasNewer,true,'A saved window lost newer continuation');

  // 2. Current server + saved anchor: no client around requests; both history
  // directions remain loadable through the existing FPHistory174 owner.
  result=await openAndInspect(B,B.savedAnchor,false);
  rows=result.requests;
  assert.equal(rows.some(row=>row.before===String(B.savedAnchor+1)),false,'B redundantly fetched before saved anchor');
  assert.equal(rows.some(row=>row.after===String(B.savedAnchor)),false,'B redundantly fetched after saved anchor');
  assert.equal(result.state.lastMounted,false,'B unexpectedly mounted latest tail instead of saved window');
  assert.equal(result.state.hasMore,true);
  assert.equal(result.state.hasNewer,true);

  clearRequests();
  const cursors=await page.evaluate(()=>({older:Number(activeChatHistory?.nextCursor)||null,newer:Number(activeChatHistory?.newerCursor)||null}));
  assert.ok(cursors.older>0&&cursors.newer>0,'initial window cursors missing');
  const loaded=await page.evaluate(async()=>{
    const older=await FPHistory174.load('older');
    const newer=await FPHistory174.load('newer');
    return{older,newer,history:{hasMore:Boolean(activeChatHistory?.hasMore),hasNewer:Boolean(activeChatHistory?.hasNewer)}};
  });
  assert.equal(loaded.older,true,'older history did not load');
  assert.equal(loaded.newer,true,'newer history did not load');
  rows=roomRequests(B.roomId);
  assert.ok(rows.some(row=>row.before===String(cursors.older)),'older load did not use existing before cursor');
  assert.ok(rows.some(row=>row.after===String(cursors.newer)),'newer load did not use existing after cursor');

  // 3. Old-server compatibility: strip the opt-in field on the wire. The
  // current server then executes the exact legacy join branch, and the client
  // falls back to its existing around() requests.
  let oldServerSawOptIn=false;
  await page.route('**/api/rooms/'+OLD.roomId+'/join',async route=>{
    const request=route.request();
    const body=JSON.parse(request.postData()||'{}');
    oldServerSawOptIn=body.initialWindow===true;
    delete body.initialWindow;
    await route.continue({postData:JSON.stringify(body)});
  });
  result=await openAndInspect(OLD,OLD.savedAnchor,false);
  assert.equal(oldServerSawOptIn,true,'client did not send opt-in to old-server simulation');
  rows=result.requests;
  assert.ok(rows.some(row=>row.before===String(OLD.savedAnchor+1)),'old server fallback did not request older side');
  assert.ok(rows.some(row=>row.after===String(OLD.savedAnchor)),'old server fallback did not request newer side');
  assert.equal(result.state.hasNewer,true,'old server fallback lost newer history');
  await page.unroute('**/api/rooms/'+OLD.roomId+'/join');

  // 4. Server rejected stale/deleted saved anchor and returned tail mode.
  // Client must honor that fallback instead of retrying the stale anchor.
  result=await openAndInspect(STALE,null,true);
  rows=result.requests;
  assert.equal(rows.some(row=>row.before===String(STALE.savedAnchor+1)),false,'stale anchor caused redundant before request');
  assert.equal(rows.some(row=>row.after===String(STALE.savedAnchor)),false,'stale anchor caused redundant after request');
  assert.equal(result.state.hasNewer,false,'tail fallback still reports newer history');

  // 5. A -> B -> A with the first A join intentionally delayed. RoomContext
  // must abort/ignore the stale generations and leave only the final A view.
  let delayedA=0;
  await page.route('**/api/rooms/'+A.roomId+'/join',async route=>{
    delayedA++;
    if(delayedA===1)await new Promise(resolve=>setTimeout(resolve,350));
    try{await route.continue();}catch{}
  });
  await page.evaluate(()=>{window.__next12RoomEvents.length=0;});
  const aba=await page.evaluate(async({a,b,aTarget,bTarget})=>{
    const first=openChat(a);
    await new Promise(resolve=>setTimeout(resolve,25));
    const second=openChat(b);
    await new Promise(resolve=>setTimeout(resolve,25));
    const third=openChat(a);
    await Promise.allSettled([first,second,third]);
    await new Promise(resolve=>setTimeout(resolve,80));
    return{
      stateRoomId:state.roomId,
      contextRoomId:FPRoomContext170.current()?.roomId||null,
      aMounted:Boolean(findMessageElement(aTarget)),
      bMounted:Boolean(findMessageElement(bTarget)),
      events:[...window.__next12RoomEvents]
    };
  },{a:A.roomId,b:B.roomId,aTarget:A.savedAnchor,bTarget:B.savedAnchor});
  assert.equal(aba.stateRoomId,A.roomId,JSON.stringify(aba));
  assert.equal(aba.contextRoomId,A.roomId,JSON.stringify(aba));
  assert.equal(aba.aMounted,true,JSON.stringify(aba));
  assert.equal(aba.bMounted,false,JSON.stringify(aba));
  const started=aba.events.filter(event=>event.stage==='started');
  assert.ok(started.length>=3,'A-B-A transitions not observed');
  const latestGeneration=Math.max(...started.map(event=>Number(event.generation)||0));
  const finalGeneration=Number(await page.evaluate(()=>FPRoomContext170.current()?.generation||0));
  assert.equal(finalGeneration,latestGeneration,'final room context is not latest generation');
  await page.unroute('**/api/rooms/'+A.roomId+'/join');

  db.close();
  assert.deepEqual(errors,[]);
  console.log('PASS item 12 current server keeps saved old-history position ahead of unread fallback and avoids client before+after hydration');
  console.log('PASS item 12 FPHistory174 continues older/newer from server-provided cursors');
  console.log('PASS item 12 old-server legacy join falls back to existing client around requests');
  console.log('PASS item 12 deleted/stale anchor server tail fallback is honored without retry');
  console.log('PASS item 12 A->B->A keeps the latest RoomContext generation and final A DOM');
}).catch(error=>{console.error(error);process.exitCode=1;});
