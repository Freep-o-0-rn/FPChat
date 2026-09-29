'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {run}=require('./browser-harness174.cjs');

run(async({newClient,temp,root,errors})=>{
  const page=await newClient();
  await page.waitForFunction(()=>window.FPRuntime169?.loading&&window.FPReactionManager188&&window.FPReactionRenderer188&&window.__fpMediaGallery134Installed);

  const fixtures=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const out=[];
    for(const label of ['a','b']){
      const secret='next19-'+label+'-private';
      const key=await deriveKey(secret);
      const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
      const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:'Next19',deviceId,roomSecret:secret,...recovery})});
      if(!response.ok)throw Error('fixture create '+response.status);
      const data=await response.json();
      STORAGE.set(STORAGE.roomState(data.publicId),{deviceId,secret});
      upsertChat(data.publicId,{});
      out.push({label,roomId:data.publicId,deviceId,secret,count:260,incoming:false,encrypted:[await encryptText('next19-private-message',key)]});
    }
    return out;
  });
  execFileSync(process.execPath,[path.join(root,'scripts/seed-history174.cjs')],{input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures}),encoding:'utf8'});
  const [A,B]=fixtures;

  await page.evaluate(()=>FPRuntime169.loading.reset());

  // Interrupted A -> B uses the real room owner, with only a test delay inserted
  // through the existing FPNetwork171 middleware hook.
  await page.evaluate(roomId=>{
    window.__next19Dispose=FPNetwork171.use({
      id:'next19-join-delay',priority:50,source:'test',
      handler:async({input,init,next})=>{
        const url=new URL(typeof input==='string'?input:input.url,location.href);
        if(url.pathname===('/api/rooms/'+roomId+'/join'))await new Promise(r=>setTimeout(r,180));
        return next(input,init);
      }
    });
  },A.roomId);
  await page.evaluate(({a,b})=>{
    window.__next19OpenA=openChat(a);
    setTimeout(()=>{window.__next19OpenB=openChat(b);},25);
  },{a:A.roomId,b:B.roomId});
  await page.waitForFunction(roomId=>state.roomId===roomId&&document.querySelector('#messages .bubble-wrap.msg'),B.roomId,{timeout:20000});
  await page.evaluate(async()=>{try{await window.__next19OpenA;}catch{}try{await window.__next19OpenB;}catch{}window.__next19Dispose?.();delete window.__next19Dispose;});
  let report=await page.evaluate(()=>FPRuntime169.loading.report());
  assert.ok(report.records.some(r=>r.kind==='room'&&r.status==='cancelled'),'missing interrupted room attempt');
  assert.ok(report.records.some(r=>r.kind==='room'&&r.status==='ok'),'missing successful room attempt');

  // Repeat same room after leaving to list.
  await page.evaluate(async roomId=>{showChatsList();await openChat(roomId);},B.roomId);
  report=await page.evaluate(()=>FPRuntime169.loading.report());
  const rooms=report.records.filter(r=>r.kind==='room');
  assert.ok(rooms.some(r=>r.openKind==='repeat'),'repeat room attempt not tagged');
  const latestRoom=rooms.filter(r=>r.status==='ok').at(-1);
  assert.equal(typeof latestRoom.points['text-ready'],'number');
  assert.equal(typeof latestRoom.points['composer-ready'],'number');
  assert.equal(typeof latestRoom.points['scroll-ready'],'number');
  assert.ok(['ram-reuse','decrypt-render'].includes(latestRoom.messageSource));

  // Manual older-history load.
  const historyLoaded=await page.evaluate(()=>FPHistory174.load('older'));
  assert.equal(typeof historyLoaded,'boolean');
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='history'&&r.status!=='pending'));
  report=await page.evaluate(()=>FPRuntime169.loading.report());
  assert.ok(report.records.some(r=>r.kind==='history'&&['network','ram-pending'].includes(r.historySource)));

  // Text send through the real composer.
  await page.evaluate(()=>{
    const input=document.getElementById('msgInput');
    input.value='next19-private-send';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('sendForm').requestSubmit();
  });
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='send'&&r.status!=='pending'),null,{timeout:15000});
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='send'&&r.points['frame-opportunity']!==undefined),null,{timeout:5000});
  report=await page.evaluate(()=>FPRuntime169.loading.report());
  const send=report.records.filter(r=>r.kind==='send').at(-1);
  assert.equal(send.status,'ok');
  for(const phase of ['manager-ready','dom-ready','ack-ready'])assert.equal(typeof send.points[phase],'number',phase);
  assert.equal(typeof send.stagesMs.frameOpportunity,'number');
  assert.ok(send.outcome==='accepted'||send.outcome==='accepted-unmounted');

  const targetId=await page.evaluate(()=>{
    const rows=[...document.querySelectorAll('#messages .bubble-wrap.msg.mine')];
    return Number(rows.at(-1)?.dataset?.messageId||0);
  });
  assert.ok(targetId>0,'no target message for reaction');

  // Reaction through the real manager/renderer.
  await page.evaluate(async messageId=>{
    await FPReactionManager188.getQuickReactions();
    await FPReactionManager188.toggleReaction({roomId:state.roomId,messageId,reactionId:'heart',reaction:{reactionId:'heart',type:'emoji',value:'❤️',enabled:true}});
  },targetId);
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='reaction'&&r.status!=='pending'));
  await page.waitForTimeout(30);
  report=await page.evaluate(()=>FPRuntime169.loading.report());
  const reaction=report.records.filter(r=>r.kind==='reaction').at(-1);
  assert.equal(reaction.status,'ok');
  for(const phase of ['manager-ready','dom-ready','ack-ready'])assert.equal(typeof reaction.points[phase],'number',phase);
  assert.ok(reaction.points['final-ready']!==undefined||reaction.missing?.final);
  assert.ok(reaction.points['frame-opportunity']!==undefined||reaction.missing?.frameOpportunity);

  // Photo viewer with an already-ready preview and a real encrypted original read.
  const mediaBytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=120;canvas.height=90;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#295f9f';ctx.fillRect(0,0,120,90);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const encrypted=await encryptBlobWithIvPrefix(blob);
    const previewUrl=URL.createObjectURL(blob);
    window.__next19PreviewUrl=previewUrl;
    return b64.encode(await encrypted.arrayBuffer());
  });
  await page.route('**/api/media/next19-photo/blob**',route=>route.fulfill({status:200,contentType:'application/octet-stream',body:Buffer.from(mediaBytes,'base64')}));
  await page.evaluate(()=>{
    openMediaViewer([{public_id:'next19-photo',media_kind:'image',mime_type:'image/png',width:120,height:90}],0,{publicId:'next19-photo',url:window.__next19PreviewUrl,width:120,height:90});
  });
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='viewer'&&r.consumer==='gallery-current'&&r.status==='ok'),null,{timeout:15000});
  report=await page.evaluate(()=>FPRuntime169.loading.report());
  const viewer=report.records.filter(r=>r.kind==='viewer'&&r.consumer==='gallery-current').at(-1);
  assert.equal(typeof viewer.points['preview-ready'],'number');
  assert.equal(typeof viewer.points['original-ready'],'number');
  assert.ok(viewer.points['original-ready']>=viewer.points['preview-ready']);
  await page.locator('.media-viewer-close').click();

  // Real browser offline/online. Chromium may preserve the old socket; that must
  // be explicit rather than reported as a reconnect.
  await page.context().setOffline(true);
  await page.waitForTimeout(300);
  await page.context().setOffline(false);
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='connection'&&r.status!=='pending'),null,{timeout:20000});
  report=await page.evaluate(()=>FPRuntime169.loading.report());
  const connection=report.records.filter(r=>r.kind==='connection').at(-1);
  if(connection.oldSocketPreserved===true){
    assert.equal(connection.stagesMs.reconnect,null);
    assert.equal(connection.missing?.reconnect,'old-socket-preserved');
  }

  // Exercise the existing lifecycle subscriber without introducing another one.
  const canOverrideVisibility=await page.evaluate(()=>{
    try{
      Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
      document.dispatchEvent(new Event('visibilitychange'));
      return true;
    }catch{return false;}
  });
  if(canOverrideVisibility){
    await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='resume'&&r.status!=='pending'),null,{timeout:15000});
    report=await page.evaluate(()=>FPRuntime169.loading.report());
    const resume=report.records.filter(r=>r.kind==='resume').at(-1);
    assert.equal(typeof resume.points.visible,'number');
    assert.ok(resume.points['interface-ready']!==undefined||resume.missing?.interfaceReady);
    assert.ok(resume.points['sync-ready']!==undefined||resume.missing?.sync);
  }

  // Export through the existing Settings -> About button. Download must not reset.
  const before=await page.evaluate(()=>({
    report:FPRuntime169.loading.report(),
    roomState:STORAGE.get(STORAGE.roomState(state.roomId)),
    chats:JSON.stringify(state.chats)
  }));
  assert.equal(before.report.diagnosticsRevision,19);
  assert.equal(before.report.build,'190.2');
  assert.match(String(before.report.buildRevision||''),/^[a-f0-9]{40}$/i);
  assert.equal(before.report.limit,240);
  assert.equal(typeof before.report.dropped,'number');
  assert.equal(before.report.activeElementWatches,0);

  await page.evaluate(()=>{showChatsList();setView('settings');});
  await page.locator('[data-open="about"]').click();
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#fpLoadingExport186').click();
  const download=await downloadPromise;
  const downloaded=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  const afterDownload=await page.evaluate(()=>FPRuntime169.loading.report());
  assert.equal(afterDownload.records.length,before.report.records.length,'download cleared records');
  assert.equal(afterDownload.dropped,before.report.dropped,'download reset dropped counter');
  assert.equal(downloaded.diagnosticsRevision,19);
  assert.equal(downloaded.buildRevision,before.report.buildRevision);
  assert.equal(downloaded.records.length,before.report.records.length);

  const serialized=JSON.stringify(downloaded);
  for(const value of [A.roomId,B.roomId,A.deviceId,A.secret,B.secret,'next19-private-message','next19-private-send','/api/','blob:http'])assert.equal(serialized.includes(value),false,'private value leaked: '+value);

  // Reset only diagnostics; app data remains.
  await page.locator('#fpLoadingReset186').click();
  const afterReset=await page.evaluate(roomId=>({
    report:FPRuntime169.loading.report(),
    roomState:STORAGE.get(STORAGE.roomState(roomId)),
    chats:JSON.stringify(state.chats)
  }),B.roomId);
  assert.equal(afterReset.report.records.length,0);
  assert.ok(afterReset.report.boot?.points?.['boot-ready']>0);
  assert.ok(afterReset.roomState?.secret&&afterReset.roomState?.deviceId);
  assert.ok(afterReset.chats.length>2);

  assert.deepEqual(errors,[]);
  console.log('PASS next19 existing loading JSON contains bounded real-device action diagnostics');
}).catch(error=>{console.error(error);process.exitCode=1;});
