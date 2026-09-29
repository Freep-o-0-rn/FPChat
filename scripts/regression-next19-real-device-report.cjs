'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {run}=require('./browser-harness174.cjs');

run(async({newClient,errors,temp,root})=>{
  const page=await newClient();
  await page.waitForFunction(()=>window.FPRuntime169?.loading&&window.FPNetwork171&&window.FPConnection170&&window.FPHistory174&&window.__fpSettings131Installed,null,{timeout:30000});

  const fixtures=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    async function create(name,count){
      const secret='next19-'+name+'-'+crypto.randomUUID();
      const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
      const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:'Next19',deviceId,roomSecret:secret,...recovery})});
      if(!response.ok)throw Error('room create '+response.status);
      const data=await response.json();
      STORAGE.set(STORAGE.roomState(data.publicId),{deviceId,secret});
      upsertChat(data.publicId,{});
      const key=await deriveKey(secret);
      const encrypted=[];
      for(let i=0;i<8;i++)encrypted.push(await encryptText('seed-'+name+'-'+i,key));
      return{name,roomId:data.publicId,deviceId,secret,count,incoming:false,encrypted};
    }
    return [await create('a',420),await create('b',30)];
  });

  execFileSync(process.env.FPCHAT_TEST_NODE||process.execPath,[path.join(root,'scripts/seed-history174.cjs')],{
    input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures}),encoding:'utf8'
  });

  const [A,B]=fixtures;

  // Interrupted A -> B through the existing FPNetwork171 middleware contract.
  await page.evaluate(roomId=>{
    let releaseResolve,seenResolve;
    const gate=new Promise(resolve=>{releaseResolve=resolve;});
    const seen=new Promise(resolve=>{seenResolve=resolve;});
    window.__next19Hold={seen,release:()=>releaseResolve()};
    window.__next19Dispose=FPNetwork171.use({
      id:'next19-room-switch',
      priority:50,
      source:'test',
      handler:({input,init,next})=>{
        const raw=typeof input==='string'?input:input?.url;
        const url=new URL(raw,location.href);
        const method=String(init?.method||input?.method||'GET').toUpperCase();
        if(method==='POST'&&url.pathname===('/api/rooms/'+roomId+'/join')){
          seenResolve();
          return gate.then(()=>next(input,init));
        }
        return next(input,init);
      }
    });
    void openChat(roomId);
  },A.roomId);
  await page.evaluate(()=>window.__next19Hold.seen);
  await page.evaluate(roomId=>openChat(roomId),B.roomId);
  await page.evaluate(()=>window.__next19Hold.release());
  await page.waitForTimeout(200);
  await page.evaluate(()=>{try{window.__next19Dispose?.();}catch{}delete window.__next19Dispose;delete window.__next19Hold;});

  // Successful A open, old-history load, send, reaction and repeat open.
  await page.evaluate(roomId=>openChat(roomId),A.roomId);
  await page.waitForFunction(roomId=>state.roomId===roomId&&document.getElementById('sendForm')&&window.FPConnection170?.snapshot?.().open===true,A.roomId,{timeout:30000});

  await page.evaluate(()=>window.FPHistory174.load('older'));
  await page.waitForFunction(()=>window.FPRuntime169.loading.report().records.some(r=>r.kind==='history'&&r.status!=='pending'),null,{timeout:15000});

  const sendText='NEXT19_PRIVATE_TEXT_DO_NOT_EXPORT';
  await page.evaluate(value=>{
    const input=document.getElementById('msgInput');
    input.value=value;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('sendForm').requestSubmit();
  },sendText);
  await page.waitForFunction(()=>window.FPRuntime169.loading.report().records.some(r=>r.kind==='send'&&r.points['ack-ready']!==undefined&&r.status!=='pending'),null,{timeout:20000});

  const messageId=await page.evaluate(value=>{
    const row=[...document.querySelectorAll('#messages > .bubble-wrap.msg')].find(node=>node.querySelector('.message-text')?.textContent===value);
    return Number(row?.dataset?.messageId||row?.dataset?.id||0)||null;
  },sendText);
  assert.ok(messageId,'sent message did not receive numeric id');

  await page.waitForFunction(()=>window.FPReactionManager188&&window.FPReactionRenderer188,null,{timeout:15000});
  await page.evaluate(async messageId=>{
    await FPReactionManager188.toggleReaction({
      roomId:state.roomId,
      messageId,
      reactionId:'heart',
      reaction:{reactionId:'heart',type:'emoji',value:'❤️',enabled:true}
    });
  },messageId);
  await page.waitForFunction(()=>window.FPRuntime169.loading.report().records.some(r=>r.kind==='reaction'&&r.points['ack-ready']!==undefined&&r.status!=='pending'),null,{timeout:15000});

  // Preserved old socket: real browser offline -> online transition. This
  // must not be manufactured by the diagnostics layer.
  await page.context().setOffline(true);
  await page.waitForFunction(()=>window.FPLifecycle170?.snapshot?.().online===false,null,{timeout:5000});
  await page.waitForTimeout(500);
  await page.context().setOffline(false);
  await page.waitForFunction(()=>window.FPLifecycle170?.snapshot?.().online===true,null,{timeout:5000});
  await page.waitForFunction(()=>window.FPRuntime169.loading.report().records.some(r=>r.kind==='connection'&&r.result==='preserved-live-socket'),null,{timeout:10000});

  // Confirmed break: the test closes the real current socket; reconnect remains
  // entirely owned by existing connection/lifecycle/sync paths.
  await page.evaluate(()=>{
    const socket=FPConnection170.current();
    if(!socket||socket.readyState!==WebSocket.OPEN)throw Error('no open socket');
    if(!FPConnection170.requestClose(socket))throw Error('socket close request rejected');
  });
  await page.waitForFunction(()=>window.FPRuntime169.loading.report().records.some(r=>r.kind==='connection'&&r.points['break-confirmed']!==undefined),null,{timeout:8000});
  console.log('NEXT19_CONNECTION_BREAK '+JSON.stringify(await page.evaluate(()=>({owner:FPConnection170.snapshot(),records:FPRuntime169.loading.report().records.filter(r=>r.kind==='connection')}))));
  await page.waitForFunction(()=>window.FPRuntime169.loading.report().records.some(r=>r.kind==='connection'&&r.points['break-confirmed']!==undefined&&r.points['reconnect-open']!==undefined),null,{timeout:20000});
  console.log('NEXT19_CONNECTION_OPEN '+JSON.stringify(await page.evaluate(()=>({owner:FPConnection170.snapshot(),records:FPRuntime169.loading.report().records.filter(r=>r.kind==='connection')}))));
  await page.waitForFunction(()=>window.FPRuntime169.loading.report().records.some(r=>r.kind==='connection'&&r.points['break-confirmed']!==undefined&&r.result==='reconnected'),null,{timeout:60000});

  // Reopen the same room once more so repeated/RAM tags are observable.
  await page.evaluate(()=>showChatsList());
  await page.evaluate(roomId=>openChat(roomId),A.roomId);
  await page.waitForFunction(roomId=>state.roomId===roomId&&document.getElementById('sendForm'),A.roomId,{timeout:20000});

  const beforeExport=await page.evaluate(()=>window.FPRuntime169.loading.report());
  assert.equal(beforeExport.schema,2);
  assert.equal(beforeExport.build,'190.2');
  assert.match(String(beforeExport.appRevision||''),/^[a-f0-9]{40}$/i);
  assert.equal(beforeExport.limit,240);
  assert.ok(Number.isInteger(beforeExport.dropped)&&beforeExport.dropped>=0);
  assert.ok(beforeExport.records.some(r=>r.kind==='room'&&r.repeated===true),'repeat room open missing');
  assert.ok(beforeExport.records.some(r=>r.kind==='room'&&r.source==='ram-reuse'),'RAM reuse tag missing');
  assert.ok(beforeExport.records.some(r=>r.kind==='room'&&r.restore),'scroll restore outcome missing');
  assert.ok(beforeExport.records.some(r=>r.kind==='history'&&['network-history','ram-reuse'].includes(r.source)),'history attempt missing');
  const send=beforeExport.records.find(r=>r.kind==='send'&&r.points['ack-ready']!==undefined);
  assert.ok(send,'send attempt missing');
  for(const stage of ['optimistic-ready','dom-ready','ack-ready','outcome-ready'])assert.notEqual(send.points[stage],undefined,'send '+stage+' missing');
  assert.equal(send.result,'ok');
  const reaction=beforeExport.records.find(r=>r.kind==='reaction'&&r.points['ack-ready']!==undefined);
  assert.ok(reaction,'reaction attempt missing');
  for(const stage of ['optimistic-ready','dom-ready','ack-ready','outcome-ready'])assert.notEqual(reaction.points[stage],undefined,'reaction '+stage+' missing');
  assert.equal(reaction.result,'ok');
  const preserved=beforeExport.records.find(r=>r.kind==='connection'&&r.result==='preserved-live-socket');
  assert.ok(preserved,'preserved live socket attempt missing');
  assert.equal(preserved.points['reconnect-open'],undefined);
  assert.equal(preserved.missing['reconnect-open'],'no-break-old-socket-preserved');
  const reconnected=beforeExport.records.find(r=>r.kind==='connection'&&r.result==='reconnected');
  assert.ok(reconnected,'confirmed reconnect attempt missing');
  for(const stage of ['break-confirmed','reconnect-open','sync-ready'])assert.notEqual(reconnected.points[stage],undefined,'connection '+stage+' missing');

  // Existing Settings -> About -> Download button, not a test-only export path.
  await page.evaluate(()=>renderSettings());
  await page.click('[data-open="about"]');
  await page.waitForSelector('#fpLoadingExport186');

  async function downloadReport(){
    const pending=page.waitForEvent('download');
    await page.click('#fpLoadingExport186');
    const download=await pending;
    const file=await download.path();
    return JSON.parse(fs.readFileSync(file,'utf8'));
  }
  const first=await downloadReport();
  const firstCount=first.records.length;
  const second=await downloadReport();
  assert.ok(second.records.length>=firstCount,'download cleared measurements');

  const serialized=JSON.stringify(second);
  assert.equal(serialized.includes(A.roomId),false,'room id leaked');
  assert.equal(serialized.includes(B.roomId),false,'room id leaked');
  assert.equal(serialized.includes(A.deviceId),false,'device id leaked');
  assert.equal(serialized.includes(sendText),false,'message text leaked');
  assert.equal(serialized.includes('/api/rooms/'),false,'URL leaked');
  assert.equal(serialized.includes('"heart"'),false,'reaction id leaked');

  // Existing clear button must clear only diagnostics, not app data.
  const roomStateBefore=await page.evaluate(roomId=>STORAGE.get(STORAGE.roomState(roomId)),A.roomId);
  await page.click('#fpLoadingReset186');
  const afterReset=await page.evaluate(roomId=>({
    report:FPRuntime169.loading.report(),
    roomState:STORAGE.get(STORAGE.roomState(roomId))
  }),A.roomId);
  assert.deepEqual(afterReset.roomState,roomStateBefore,'diagnostic reset changed app room data');
  assert.equal(afterReset.report.records.length,0,'diagnostic reset did not clear bounded records');

  assert.deepEqual(errors,[]);
  console.log('Item 19 existing loading-report download regression: PASS');
}).catch(error=>{console.error(error);process.exitCode=1;});
