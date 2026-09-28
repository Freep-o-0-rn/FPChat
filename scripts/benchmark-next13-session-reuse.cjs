'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const Database=require('better-sqlite3');
const {run}=require('./browser-harness174.cjs');

const OUT=path.resolve(process.env.FPCHAT_NEXT13_OUTPUT||path.join(process.cwd(),'next13-output'));
fs.mkdirSync(OUT,{recursive:true});
const PAIRS=5;
const round=value=>Math.round(Number(value)*100)/100;
const stats=values=>{
  const clean=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  return{
    n:clean.length,
    raw:clean.map(round),
    median:round(clean[Math.floor(clean.length/2)]),
    min:round(clean[0]),
    max:round(clean.at(-1))
  };
};

run(async({browser,origin,errors,temp,root})=>{
  const setup=await browser.newPage({viewport:{width:1100,height:760}});
  setup.on('pageerror',e=>errors.push(e.message));
  setup.on('dialog',d=>d.dismiss());
  await setup.goto(origin);
  await setup.waitForFunction(()=>window.FPMediaSend170&&window.FPMessageStore172&&!document.getElementById('bootHold152'));

  const fixtures=await setup.evaluate(async count=>{
    const deviceId=getOrCreateDeviceId();
    const out=[];
    for(let index=0;index<count;index++){
      const secret='next13-bench-'+index;
      const key=await deriveKey(secret);
      const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
      const response=await fetch('/api/rooms',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({displayName:'Next13Bench',deviceId,roomSecret:secret,...recovery})
      });
      if(!response.ok)throw new Error('bench fixture '+index+' '+response.status);
      const data=await response.json();
      const encrypted=[];
      for(let i=0;i<12;i++)encrypted.push(await encryptText('next13 bench '+index+' '+i+' '+('payload '.repeat((i%4)+1)),key));
      out.push({name:'room-'+index,roomId:data.publicId,deviceId,secret,count:300,incoming:false,encrypted});
    }
    return out;
  },PAIRS);

  execFileSync(
    process.env.FPCHAT_TEST_NODE||process.execPath,
    [path.join(root,'scripts/seed-history174.cjs')],
    {input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures}),encoding:'utf8'}
  );
  await setup.close();

  const db=new Database(path.join(temp,'test.sqlite'));
  const view=db.prepare(
    "INSERT INTO chat_view_state(room_id,device_id,anchor_message_id,anchor_offset_px,at_bottom,updated_at) VALUES(?,?,NULL,0,1,datetime('now')) "+
    "ON CONFLICT(room_id,device_id) DO UPDATE SET anchor_message_id=NULL,anchor_offset_px=0,at_bottom=1,updated_at=datetime('now')"
  );
  for(const fixture of fixtures){
    const room=db.prepare('SELECT id FROM rooms WHERE public_id=?').get(fixture.roomId);
    view.run(room.id,fixture.deviceId);
  }

  const samples=[];
  for(let index=0;index<fixtures.length;index++){
    const fixture=fixtures[index];
    const page=await browser.newPage({viewport:{width:1100,height:760}});
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>d.dismiss());
    await page.addInitScript(({deviceId})=>{
      localStorage.setItem('fpchat:device-id',deviceId);
      localStorage.setItem('fpchat:nick','Next13Bench');
    },{deviceId:fixture.deviceId});
    await page.goto(origin);
    await page.waitForFunction(()=>window.FPMediaSend170&&window.FPMessageStore172&&!document.getElementById('bootHold152'));
    await page.evaluate(input=>{
      STORAGE.set(STORAGE.roomState(input.roomId),{deviceId:input.deviceId,secret:input.secret});
      const base=decryptText;
      decryptText=async function(){
        window.__next13BenchDecrypt=(window.__next13BenchDecrypt||0)+1;
        return base.apply(this,arguments);
      };
      window.__next13BenchDecrypt=0;
    },fixture);

    const measure=async label=>{
      await page.evaluate(()=>{window.__next13BenchDecrypt=0;});
      const result=await page.evaluate(async roomId=>{
        const started=performance.now();
        await openChat(roomId);
        return{
          openMs:performance.now()-started,
          decryptCalls:Number(window.__next13BenchDecrypt||0),
          mounted:document.querySelectorAll('#messages .bubble-wrap.msg').length,
          atBottom:isMessagesAtBottom(document.getElementById('messages')),
          renderedOnce:Boolean(FPMessageStore172.roomSnapshot(roomId)?.renderedOnce)
        };
      },fixture.roomId);
      samples.push({pair:index+1,label,...result});
      return result;
    };

    const first=await measure('first-open');
    if(first.decryptCalls<100)throw new Error('first open unexpectedly reused window for pair '+(index+1));
    if(first.mounted!==100||!first.atBottom)throw new Error('first open fixture mismatch for pair '+(index+1));

    await page.evaluate(()=>setView('chats'));
    await page.waitForTimeout(80);

    const repeat=await measure('repeat-open');
    if(repeat.decryptCalls!==0)throw new Error('repeat open did not reuse MessageStore for pair '+(index+1));
    if(repeat.mounted!==100||!repeat.atBottom||!repeat.renderedOnce)throw new Error('repeat fixture mismatch for pair '+(index+1));

    await page.close();
  }

  db.close();

  const first=samples.filter(row=>row.label==='first-open');
  const repeat=samples.filter(row=>row.label==='repeat-open');
  const report={
    schema:1,
    planItem:13,
    build:'190.2',
    runtimeSha:process.env.FPCHAT_RUNTIME_SHA||null,
    environment:'isolated Linux headless Chromium + local SQLite; no network throttling',
    pairs:PAIRS,
    fixture:{
      rooms:PAIRS,
      messagesPerRoom:300,
      initialTailMessages:100,
      samePageWithinEachPair:true,
      freshPageAcrossPairs:true,
      accessJoinRequiredOnBothOpens:true
    },
    firstOpen:{
      openMs:stats(first.map(row=>row.openMs)),
      decryptCalls:stats(first.map(row=>row.decryptCalls))
    },
    repeatOpen:{
      openMs:stats(repeat.map(row=>row.openMs)),
      decryptCalls:stats(repeat.map(row=>row.decryptCalls))
    },
    delta:{
      medianMs:round(stats(repeat.map(row=>row.openMs)).median-stats(first.map(row=>row.openMs)).median),
      medianPct:round((stats(repeat.map(row=>row.openMs)).median/stats(first.map(row=>row.openMs)).median-1)*100),
      decryptCallsMedian:stats(repeat.map(row=>row.decryptCalls)).median-stats(first.map(row=>row.decryptCalls)).median
    },
    samples,
    errors
  };
  fs.writeFileSync(path.join(OUT,'next13-session-reuse.json'),JSON.stringify(report,null,2)+'\n');
  console.log('NEXT13_RESULT '+JSON.stringify(report));
  if(errors.length)process.exitCode=1;
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
