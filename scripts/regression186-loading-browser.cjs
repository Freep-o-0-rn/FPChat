'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const {run} = require('./browser-harness174.cjs');

run(async ({newClient, temp, root, errors}) => {
  let passed = 0;
  const pass = name => { passed++; console.log('PASS 186 ' + name); };
  const page = await newClient();
  await page.waitForFunction(() => window.FPRuntime169?.loading && window.__fpStorage167CacheFixInstalled && window.__fpMediaGallery134Installed);
  const report = () => page.evaluate(() => FPRuntime169.loading.report());
  const boot = (await report()).boot;
  assert.ok(boot.points['loader-start'] < boot.points['core-ready']);
  assert.ok(boot.points['core-ready'] <= boot.points['boot-ready']);
  assert.equal(boot.completed['core-wait-end'], true);
  assert.equal(boot.completed['layers-end'], true);
  assert.equal(boot.completed['assets-end'], true);
  assert.ok((await report()).startupResources.js.count>0);
  pass('boot stages retain their real order and readiness outcomes');

  const fixtures = await page.evaluate(async () => {
    const deviceId = getOrCreateDeviceId();
    const make = async (suffix,count) => {
      const secret = 'private-test-secret-186-'+suffix;
      const key = await deriveKey(secret), recovery = await buildRecoveryPayload(generateRecoveryCode(), secret);
      const response = await fetch('/api/rooms', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})});
      if (!response.ok) throw Error('Fixture room creation failed');
      const data = await response.json();
      STORAGE.set(STORAGE.roomState(data.publicId), {secret,deviceId}); upsertChat(data.publicId, {});
      return {roomId:data.publicId,deviceId,secret,count,incoming:false,encrypted:[await encryptText('private-test-message-186-'+suffix,key)]};
    };
    return [await make('primary',3),await make('history',230)];
  });
  const [fixture,historyFixture]=fixtures;
  execFileSync(process.execPath,[path.join(root,'scripts/seed-history174.cjs')],{input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures}),encoding:'utf8'});
  await page.evaluate(async roomId => { FPRuntime169.loading.reset(); await openChat(roomId); },fixture.roomId);
  await page.waitForFunction(() => FPRuntime169.loading.report().records.some(r => r.kind === 'room' && r.points['visible-frame'] !== undefined));
  let room = (await report()).records.find(r => r.kind === 'room');
  assert.equal(room.status,'ok');
  assert.equal(room.counts.messages,3);
  for (const phase of ['key-start','key-ready','join-start','join-ready','history-ready','render-start','first-message-mounted','text-ready','draft-ready','composer-ready','scroll-ready','messages-revealed']) assert.equal(typeof room.points[phase],'number',phase);
  assert.ok(room.points['first-message-mounted'] <= room.points['text-ready']);
  assert.ok(room.points['text-ready'] <= room.points['messages-revealed']);
  assert.ok(room.points['layout-wait-end']>=room.points['layout-thumbs-wait-end']);
  assert.equal(room.counts.pendingThumbnailsAtLayoutWaitEnd,0);
  assert.equal(room.openType,'ordinary'); assert.equal(room.messageSource,'load');
  assert.ok(room.metrics.textReadyMs!==null&&room.metrics.composerReadyMs!==null&&room.metrics.positionReadyMs!==null);
  pass('real room entry measures key, join, history, text, draft, composer, restore and source');

  await page.evaluate(()=>showChatsList());
  await page.evaluate(async roomId=>{FPRuntime169.loading.reset();await openChat(roomId);},fixture.roomId);
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='room'&&r.status==='ok'));
  room=(await report()).records.find(r=>r.kind==='room');
  assert.equal(room.openType,'repeat'); assert.equal(room.messageSource,'ram');
  assert.ok(room.metrics.textReadyMs!==null&&room.metrics.composerReadyMs!==null&&room.metrics.positionReadyMs!==null);
  pass('repeat room open is distinguished from ordinary open and full MessageStore RAM reuse is explicit');

  await page.evaluate(()=>showChatsList());
  await page.evaluate(async roomId=>{FPRuntime169.loading.reset();await openChat(roomId);},historyFixture.roomId);
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='room'&&r.status==='ok'));
  await page.evaluate(()=>FPRuntime169.loading.reset());
  const olderLoaded=await page.evaluate(()=>FPHistory174.load('older'));
  assert.equal(olderLoaded,true);
  const historyRecord=(await report()).records.find(r=>r.kind==='history');
  assert.ok(historyRecord); assert.equal(historyRecord.direction,'older'); assert.equal(historyRecord.historySource,'network'); assert.equal(historyRecord.status,'ok');
  assert.ok(historyRecord.metrics.responseMs!==null&&historyRecord.metrics.renderMs!==null&&historyRecord.metrics.positionRestoreMs!==null);
  pass('older-history network attempt records response, render and anchor restoration separately');

  await page.evaluate(()=>showChatsList());
  await page.evaluate(async roomId=>{FPRuntime169.loading.reset();await openChat(roomId);},fixture.roomId);

  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width=128; canvas.height=96;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#2977bb'; ctx.fillRect(0,0,128,96);
    const webp=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp'));
    const good=await encryptBlobWithIvPrefix(webp);
    const invalidImage=await encryptBlobWithIvPrefix(new Blob(['not an image']));
    window.audit186 = {room:state.roomId,deviceId:getOrCreateDeviceId()};
    return {good:b64.encode(await good.arrayBuffer()),invalidImage:b64.encode(await invalidImage.arrayBuffer())};
  });
  const hits = new Map();
  await page.route('**/api/media/audit186-*/**', async route => {
    const url = new URL(route.request().url()), id = url.pathname.split('/')[3];
    hits.set(id,(hits.get(id)||0)+1);
    if(id.includes('network-error'))return route.abort('failed');
    const http = /http-(403|404|500)/.exec(id);
    if(http)return route.fulfill({status:Number(http[1]),body:'fixture'});
    if(id.includes('slow'))await new Promise(resolve=>setTimeout(resolve,180));
    const body = id.includes('crypto-error') ? Buffer.alloc(48) : Buffer.from(id.includes('element-error')?bytes.invalidImage:bytes.good,'base64');
    return route.fulfill({status:200,contentType:'application/octet-stream',body});
  });
  const read = id => page.evaluate(async id => {
    const blob = await readEncryptedMedia174(`/api/media/${id}/thumb?deviceId=${audit186.deviceId}`,'image/webp',state.key,{fpConsumer186:'chat-thumbnail'});
    await FPNetwork171.waitForMediaCacheIdle();
    return blob.size;
  },id);
  await page.evaluate(()=>FPRuntime169.loading.reset());
  assert.ok(await read('audit186-cache') > 0);
  let media=(await report()).records.find(r=>r.kind==='media');
  assert.equal(media.cache,'miss'); assert.equal(media.status,'ok'); assert.ok(media.bytes>0);
  for(const phase of ['queue-start','slot-ready','cache-start','cache-ready','network-start','response-ready','body-start','body-ready','buffer-start','buffer-ready','decrypt-start','decrypt-ready'])assert.equal(typeof media.points[phase],'number',phase);
  const cold={...media.stagesMs};
  await read('audit186-cache');
  media=(await report()).records.filter(r=>r.kind==='media').at(-1);
  assert.equal(media.cache,'hit'); assert.equal(media.points['network-start'],undefined); assert.equal(hits.get('audit186-cache'),1);
  const warm={...media.stagesMs};
  pass('cold miss and encrypted disk-cache hit are distinguished without extra requests');

  await page.evaluate(async () => {
    FPRuntime169.loading.reset();
    const original=readEncryptedMedia174(`/api/media/audit186-slow-original/blob?deviceId=${audit186.deviceId}`,'image/webp',state.key);
    const controller=new AbortController();
    const cancelled=readEncryptedMedia174('/api/media/audit186-queued-abort/thumb','image/webp',state.key,{signal:controller.signal}).catch(e=>e.name);
    const thumb=readEncryptedMedia174('/api/media/audit186-after-original/thumb','image/webp',state.key);
    controller.abort();
    if(await cancelled!=='AbortError')throw Error('Expected queue cancellation');
    await Promise.all([original,thumb]);
  });
  let list=(await report()).records;
  assert.equal(list.length,3);
  assert.equal(list[1].status,'cancelled'); assert.equal(list[1].error.stage,'queue');
  assert.ok(list[2].stagesMs.queue>=140,JSON.stringify(list[2]));
  assert.equal(hits.has('audit186-queued-abort'),false);
  assert.equal(await page.evaluate(()=>FPNetwork171.snapshot().mediaBudget.reservedSlots),0);
  pass('weighted queue wait and queued abort are measured; lease budget is unchanged');

  for(const [id,stage,category,status] of [
    ['audit186-http-403','response','http',403],['audit186-http-404','response','http',404],['audit186-http-500','response','http',500],
    ['audit186-network-error','fetch','network-or-type',undefined],['audit186-crypto-error','decrypt','crypto',200]
  ]) {
    await page.evaluate(()=>FPRuntime169.loading.reset());
    await assert.rejects(read(id));
    const item=(await report()).records.find(r=>r.kind==='media');
    assert.equal(item.status,'error'); assert.equal(item.error.stage,stage); assert.equal(item.error.category,category);
    if(status)assert.equal(item.httpStatus,status);
  }
  pass('HTTP 403/404/500, transport and AES-GCM failures keep distinct safe categories');
  await page.evaluate(async()=>{
    FPRuntime169.loading.reset();
    try{await readEncryptedMedia174('/api/media/audit186-body-error/thumb','image/webp',state.key,{},()=>{throw new TypeError('private-test-body-error');});}catch{}
  });
  assert.equal((await report()).records[0].error.stage,'body');
  assert.equal(await page.evaluate(()=>FPNetwork171.snapshot().mediaBudget.reservedSlots),0);
  pass('body-read failure is recorded and still releases its network slot');

  const append = id => page.evaluate(id=>{
    const media={public_id:id,media_kind:'image',mime_type:'image/webp',width:128,height:96};
    window.audit186MessageSeq=(window.audit186MessageSeq||900186)+1;
    appendMessage(document.getElementById('messages'),{id:window.audit186MessageSeq,created_at:new Date().toISOString(),type:'media',status:'read',sender_device_id:getOrCreateDeviceId(),sender_name:'fixture',media:[media]},'',true,false);
  },id);
  await page.evaluate(()=>FPRuntime169.loading.reset());
  await append('audit186-render');
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.consumer==='chat-thumbnail'&&r.points['paint-opportunity']!==undefined));
  media=(await report()).records.find(r=>r.consumer==='chat-thumbnail');
  assert.ok(media.points['element-ready']>=media.points['decrypt-ready']); assert.equal(media.status,'ok');
  await append('audit186-element-error');
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.error?.stage==='element'));
  pass('real chat thumbnails record element readiness and invalid-image errors');

  await page.evaluate(()=>FPRuntime169.loading.reset());
  await append('audit186-progressive');
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.consumer==='chat-thumbnail'&&r.status==='ok'));
  await page.locator('#messages .media-tile').last().click();
  await page.waitForFunction(()=>{
    const rows=FPRuntime169.loading.report().records.filter(r=>r.kind==='viewer'&&r.consumer==='gallery-current');
    return rows.some(r=>r.variant==='preview'&&r.status==='ok')&&rows.some(r=>r.variant==='original'&&r.status==='ok');
  });
  let progressiveRows=(await report()).records.filter(r=>r.kind==='viewer'&&r.consumer==='gallery-current');
  const previewRecord=progressiveRows.find(r=>r.variant==='preview'),originalRecord=progressiveRows.find(r=>r.variant==='original');
  assert.ok(previewRecord.metrics.previewReadyMs!==null); assert.equal(previewRecord.metrics.originalReadyMs,undefined);
  assert.ok(originalRecord.metrics.originalReadyMs!==null);
  assert.ok(previewRecord.metrics.frameOpportunityMs!==null);
  await page.locator('.media-viewer-close').click();
  pass('progressive photo exports separate preview and original readiness without duplicating media I/O stages');

  await page.evaluate(()=>{
    FPRuntime169.loading.reset();
    openMediaViewer(['prev','current','next'].map(id=>({public_id:'audit186-gallery-'+id,media_kind:'image',mime_type:'image/webp'})),1);
  });
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='viewer'&&r.consumer==='gallery-current'&&r.status==='ok'));
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.filter(r=>r.kind==='media'&&r.status==='ok').length===3);
  list=(await report()).records;
  assert.ok(list.some(r=>r.kind==='gallery-history'&&r.counts.pages>=1));
  assert.equal(list.filter(r=>r.kind==='media'&&r.consumer==='gallery-current').length,1);
  assert.equal(list.filter(r=>r.kind==='media'&&r.consumer==='gallery-neighbor').length,2);
  assert.ok(list.filter(r=>r.kind==='media').every(r=>Number.isSafeInteger(r.parent)));
  await page.locator('.media-viewer-close').click();
  await page.evaluate(()=>openMediaViewer(['prev','current','next'].map(id=>({public_id:'audit186-gallery-'+id,media_kind:'image',mime_type:'image/webp'})),1));
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.cache==='ram-hit'&&r.consumer==='gallery-current'&&r.status==='ok'));
  assert.equal(hits.get('audit186-gallery-current'),1);
  await page.locator('.media-viewer-close').click();
  pass('gallery current/neighbor, history scan and RAM reuse are separate observations');

  await page.evaluate(()=>FPRuntime169.loading.reset());
  await append('audit186-item19-photo');
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.consumer==='chat-thumbnail'&&r.status==='ok'));
  await page.locator('#messages .media-tile').last().click();
  await page.waitForFunction(()=>{
    const rows=FPRuntime169.loading.report().records.filter(r=>r.kind==='viewer'&&r.consumer==='gallery-current');
    return rows.some(r=>r.variant==='preview'&&r.status==='ok')&&rows.some(r=>r.variant==='original'&&r.status==='ok');
  });
  await page.locator('.media-viewer-close').click();
  await page.waitForFunction(()=>window.FPReactionManager188&&window.FPReactionRenderer188&&document.getElementById('sendForm'));
  await page.locator('#msgInput').fill('private-test-send-186');
  await page.locator('#sendForm').evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='send'&&r.status==='ok'));
  let sendRecord=(await report()).records.find(r=>r.kind==='send');
  assert.ok(sendRecord.metrics.optimisticMs!==null&&sendRecord.metrics.domChangeMs!==null&&sendRecord.metrics.ackMs!==null&&sendRecord.metrics.finalDomMs!==null);
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.find(r=>r.kind==='send')?.metrics?.frameOpportunityMs!==null);
  sendRecord=(await report()).records.find(r=>r.kind==='send');
  assert.ok(sendRecord.metrics.frameOpportunityMs!==null);
  const sentMessageId=await page.evaluate(()=>{
    const row=[...document.querySelectorAll('#messages > .bubble-wrap.msg.mine')].reverse().find(node=>Number(node.dataset.messageId)>0);
    return Number(row?.dataset.messageId)||null;
  });
  assert.ok(Number.isSafeInteger(sentMessageId)&&sentMessageId>0);
  await page.evaluate(async messageId=>{
    await FPReactionManager188.getQuickReactions();
    await FPReactionManager188.toggleReaction({roomId:state.roomId,messageId,reactionId:'heart',reaction:{reactionId:'heart',type:'emoji',value:'❤️',enabled:true}});
  },sentMessageId);
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='reaction'&&r.status==='ok'));
  let reactionRecord=(await report()).records.find(r=>r.kind==='reaction');
  assert.ok(reactionRecord.metrics.optimisticMs!==null&&reactionRecord.metrics.domChangeMs!==null&&reactionRecord.metrics.ackMs!==null&&reactionRecord.metrics.finalDomMs!==null);
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.find(r=>r.kind==='reaction')?.metrics?.frameOpportunityMs!==null);
  reactionRecord=(await report()).records.find(r=>r.kind==='reaction');
  assert.ok(reactionRecord.metrics.frameOpportunityMs!==null);
  await page.evaluate(async messageId=>{
    await FPReactionManager188.toggleReaction({roomId:state.roomId,messageId,reactionId:'heart',reaction:{reactionId:'heart',type:'emoji',value:'❤️',enabled:true}});
  },sentMessageId);
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.filter(r=>r.kind==='reaction'&&r.status==='ok').length>=2);
  pass('send and repeated reaction attempts keep manager, DOM, rAF opportunity, ACK and final outcome separate');

  await page.evaluate(()=>showChatsList());
  await page.evaluate(roomId=>{
    window.__item19DelayDispose=FPNetwork171.use({
      id:'item19-room-delay',priority:50,source:'test',
      handler:async({input,init,next})=>{
        const url=new URL(typeof input==='string'?input:input?.url,location.href);
        if(url.pathname===('/api/rooms/'+roomId+'/join'))await new Promise(resolve=>setTimeout(resolve,180));
        return next(input,init);
      }
    });
  },fixture.roomId);
  const aPromise=page.evaluate(roomId=>openChat(roomId),fixture.roomId);
  await page.waitForTimeout(25);
  await page.evaluate(roomId=>openChat(roomId),historyFixture.roomId);
  await aPromise;
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='room'&&r.status==='cancelled')&&FPRuntime169.loading.report().records.some(r=>r.kind==='room'&&r.status==='ok'));
  await page.evaluate(()=>{try{window.__item19DelayDispose?.();}catch{}delete window.__item19DelayDispose;});
  const switchReport=await report();
  assert.ok(switchReport.records.some(r=>r.kind==='room'&&r.status==='cancelled'));
  assert.ok(switchReport.records.some(r=>r.kind==='room'&&r.status==='ok'));
  const item19OlderLoaded=await page.evaluate(()=>FPHistory174.load('older'));
  assert.equal(item19OlderLoaded,true);
  assert.ok((await report()).records.some(r=>r.kind==='history'&&r.status==='ok'));
  pass('A to B interruption keeps separate cancelled/successful room attempts without stale completion');

  await page.evaluate(async roomId=>{showChatsList();await openChat(roomId);},fixture.roomId);
  await page.context().setOffline(true);
  await page.waitForFunction(()=>navigator.onLine===false&&FPRuntime169.loading.report().records.some(r=>r.kind==='connection'));
  await page.waitForTimeout(100);
  await page.context().setOffline(false);
  await page.waitForFunction(()=>navigator.onLine!==false&&FPRuntime169.loading.report().records.some(r=>r.kind==='connection'&&r.status!=='pending'),null,{timeout:20000});
  const connectionRecord=(await report()).records.find(r=>r.kind==='connection');
  assert.ok(['socket-preserved','reconnected'].includes(connectionRecord.outcome),JSON.stringify(connectionRecord));
  if(connectionRecord.outcome==='socket-preserved'){
    assert.equal(connectionRecord.metrics.reconnectMs,null);
    assert.equal(connectionRecord.metrics.missing.reconnectMs,'socket-preserved');
  }else{
    assert.ok(connectionRecord.metrics.reconnectMs!==null);
    assert.ok(connectionRecord.metrics.syncReadyMs!==null);
  }
  pass('offline/online exports confirmed reconnect only after close, otherwise reconnect is null with socket-preserved reason');

  await page.evaluate(()=>{
    const own=Object.getOwnPropertyDescriptor(Document.prototype,'visibilityState')||Object.getOwnPropertyDescriptor(document,'visibilityState');
    window.__item19VisibilityRestore=()=>{try{delete document.visibilityState;}catch{} if(own&&own.configurable)Object.defineProperty(document,'visibilityState',own);};
    window.__item19Visibility='hidden';
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__item19Visibility});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(30);
  await page.evaluate(()=>{window.__item19Visibility='visible';document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>FPRuntime169.loading.report().records.some(r=>r.kind==='resume'&&r.status!=='pending'),null,{timeout:15000});
  const resumeRecord=(await report()).records.find(r=>r.kind==='resume');
  assert.ok(resumeRecord.metrics.uiReadyMs!==null&&resumeRecord.metrics.syncReadyMs!==null);
  await page.evaluate(()=>{try{window.__item19VisibilityRestore?.();}catch{}delete window.__item19VisibilityRestore;delete window.__item19Visibility;});
  pass('background-return hook separates visible UI readiness from existing sync completion; CI simulation is not physical mobile acceptance');

  await page.evaluate(()=>{showChatsList();setView('settings');});
  await page.locator('[data-open="about"]').click();
  const item19DownloadPromise=page.waitForEvent('download');
  await page.locator('#fpLoadingExport186').click();
  const item19Download=await item19DownloadPromise;
  const item19Json=JSON.parse(fs.readFileSync(await item19Download.path(),'utf8'));
  assert.equal(item19Json.schemaRevision,19);
  assert.ok(item19Json.buildIdentity&&/^[a-f0-9]{40}$/i.test(String(item19Json.buildIdentity.appRevision||'')));
  for(const kind of ['room','history','send','reaction','connection','resume'])assert.ok(item19Json.records.some(r=>r.kind===kind),'download missing '+kind);
  assert.ok(item19Json.records.some(r=>r.kind==='viewer'&&r.variant==='preview'));
  assert.ok(item19Json.records.some(r=>r.kind==='viewer'&&r.variant==='original'));
  assert.equal(item19Json.records.some(r=>JSON.stringify(r).includes('private-test-send-186')),false);
  const recordsBeforeSecondDownload=(await report()).records.length;
  const secondDownloadPromise=page.waitForEvent('download');
  await page.locator('#fpLoadingExport186').click();
  await secondDownloadPromise;
  assert.equal((await report()).records.length,recordsBeforeSecondDownload);
  pass('existing About download button exports item19 schema and repeated download does not clear measurements');

  await page.evaluate(async roomId=>{setView('chats');await openChat(roomId);},fixture.roomId);

    const unmountedTrace=await page.evaluate(async()=>{
    const node=document.createElement('div');node.className='bubble-wrap msg';
    const img=document.createElement('img');node.appendChild(img);document.getElementById('messages').appendChild(node);
    await new Promise(requestAnimationFrame);
    const trace=FPRuntime169.loading.begin('media',{endpoint:'thumb'});
    FPRuntime169.loading.watchElement(trace,img);
    node.remove();return trace.id;
  });
  await page.waitForFunction(id=>FPRuntime169.loading.report().records.find(r=>r.id===id)?.status==='cancelled',unmountedTrace);
  assert.equal((await report()).activeElementWatches,0);
  pass('existing DOM lifecycle cancels unmounted element observations and releases listeners');

  const privateReport=JSON.stringify(await report());
  for(const value of [fixture.roomId,historyFixture.roomId,fixture.deviceId,fixture.secret,historyFixture.secret,'private-test-message-186','private-test-send-186','audit186-gallery','/api/','blob:http','private-test-body-error'])assert.equal(privateReport.includes(value),false,'report leaked '+value);
  const beforeDisabled=await page.evaluate(()=>({fetch:window.fetch===FPNetwork171.fetch,scroll:document.getElementById('messages').scrollTop}));
  await page.evaluate(()=>FPRuntime169.loading.setEnabled(false));
  assert.ok(await read('audit186-disabled')>0); assert.equal((await report()).records.length,0);
  assert.equal(await page.evaluate(()=>document.getElementById('messages').scrollTop),beforeDisabled.scroll);
  await page.evaluate(()=>FPRuntime169.loading.setEnabled(true));
  pass('report contains no private fixture data; disabling collection preserves media reads and scroll');

  await page.evaluate(()=>{
    const d=FPRuntime169.loading;
    for(let i=0;i<300;i++){const token=d.begin('media',{roomId:'private-room',consumer:'other',endpoint:'thumb'});d.step(token,'secret-phase','private-value');d.finish(token);}
  });
  let bounded=await report(); assert.equal(bounded.records.length,240); assert.equal(bounded.dropped,60);
  assert.equal(JSON.stringify(bounded).includes('private-room'),false);
  await page.evaluate(()=>{showChatsList();setView('settings');});
  await page.locator('[data-open="about"]').click();
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#fpLoadingExport186').click();
  const download=await downloadPromise;
  const downloaded=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.equal(download.suggestedFilename(),`FPChat-${downloaded.build}-loading.json`);
  assert.equal(downloaded.build,'190.3'); assert.equal(downloaded.records.length,240);
  await page.locator('#fpLoadingReset186').click();
  assert.equal((await report()).records.length,0); assert.ok((await report()).boot.points['boot-ready']>0);
  pass('bounded journal, phone-accessible JSON export and reset preserve startup evidence');

  const timeoutPage=await newClient(async p=>{
    await p.addInitScript(()=>Object.defineProperty(window,'__fpSystemUi148Installed',{configurable:true,get:()=>false,set:()=>{}}));
  });
  const timedOut=await timeoutPage.evaluate(()=>FPRuntime169.loading.report().boot);
  assert.equal(timedOut.completed['layers-end'],false);
  assert.ok(timedOut.points['layers-end']-timedOut.points['layers-start']>=6900);
  await timeoutPage.close();
  pass('an optional-layer timeout is reported as incomplete, not falsely ready');

  console.log(JSON.stringify({suite:'186.5 loading',passed,environment:'Linux Chromium; isolated synthetic encrypted WebP; not physical mobile acceptance',cold,warm,errors}));
  assert.deepEqual(errors,[]);
}).catch(error=>{console.error(error);process.exitCode=1;});
