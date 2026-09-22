'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const app=read('public/app.js');
const media=read('public/media-send170.js');
const network=read('public/network171.js');
const server=read('server.js');

const managerStart=app.indexOf('class FPMediaManager177Class {');
const managerEnd=app.indexOf('\nconst FPMediaManager177 =',managerStart);
assert(managerStart>=0&&managerEnd>managerStart,'MediaManager177 class missing');
const managerBlock=app.slice(managerStart,managerEnd);
assert(managerBlock.includes('cancel(preview, cancelWorker)'),'MediaManager cancel command missing');
assert(managerBlock.includes("if (!target || typeof cancelWorker !== 'function') return false;"),
  'MediaManager cancel refusal changed');
assert(managerBlock.includes('return cancelWorker(target);'),
  'MediaManager cancel must call only the existing worker');
for(const forbidden of [
  'preview.cancelled = true','cancelOperation(','deleteUploadedPendingMedia',
  'uploadId','AbortController','XMLHttpRequest','fetch(','encrypt'
]){
  assert(!managerBlock.includes(forbidden),'MediaManager took cancel implementation ownership: '+forbidden);
}

const workerStart=media.indexOf('  async function cancelPreviewWorker177(');
const workerEnd=media.indexOf('\n  function cancelPreview(',workerStart);
assert(workerStart>=0&&workerEnd>workerStart,'existing cancel worker missing');
const workerBlock=media.slice(workerStart,workerEnd);
for(const required of [
  'preview.cancelled = true',
  "contexts.cancelOperation(preview.operation, 'user-cancelled')",
  'if (mediaPreviewState === preview) closeMediaPreviewModal(preview);',
  'await preview.task?.catch(() => {});',
  'await deleteUploadedPendingMedia(preview.items, preview.roomId);'
]){
  assert(workerBlock.includes(required),'existing cancel cleanup changed: '+required);
}

const facadeStart=media.indexOf('  function cancelPreview(preview = mediaPreviewState) {',workerEnd);
const facadeEnd=media.indexOf('\n\n  async function send(',facadeStart);
assert(facadeStart>=0&&facadeEnd>facadeStart,'cancel facade missing');
const facadeBlock=media.slice(facadeStart,facadeEnd);
assert(facadeBlock.includes('const manager = window.FPMediaManager177;'),'cancel facade must resolve MediaManager');
assert(facadeBlock.includes('if (!manager?.cancel) return false;'),'cancel facade must not bypass MediaManager');
assert(facadeBlock.includes('return manager.cancel(preview, cancelPreviewWorker177);'),
  'cancel facade must delegate exactly the old worker');

assert(media.includes('if (operation.signal.aborted && !preview.committed) await deleteUploadedPendingMedia(items, roomId, deviceId);'),
  'existing send-finally abort cleanup changed');
assert(network.includes('try { xhr.abort(); } catch {}'),'existing XHR AbortSignal bridge changed');
assert(server.includes('// Once the pending media row is committed, keep it independent of response delivery.'),
  'server pending-media response-loss contract missing');
assert(server.includes("app.delete('/api/rooms/:publicId/media/pending'"),
  'existing pending-media cleanup endpoint missing');

console.log('PASS MediaManager177 wraps cancel without taking cleanup/encryption/upload ownership');
console.log('PASS existing cancel worker keeps operation abort, exact close, task wait and pending cleanup');
console.log('PASS existing XHR AbortSignal and server pending-media cleanup contracts remain unchanged');

run(async({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(origin);
  await page.waitForFunction(() =>
    window.FPMediaManager177?.cancel &&
    window.FPMediaSend170?.cancelPreview &&
    typeof openMediaPreviewFromFiles==='function' &&
    typeof openChat==='function' &&
    !document.getElementById('bootHold152')
  );

  const fixture=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='17723-'+crypto.randomUUID().replaceAll('-','');
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})
    });
    if(!response.ok)throw new Error('room fixture failed '+response.status);
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
    upsertChat(data.publicId,{});
    return {roomId:data.publicId,deviceId};
  });

  await page.evaluate(async room=>{showChatsList();await openChat(room);},fixture.roomId);
  await page.waitForSelector('#msgInput');
  await page.waitForFunction(room=>
    state.roomId===room &&
    Boolean(document.getElementById('mediaPreviewRoot')) &&
    Boolean(document.getElementById('sendForm')),
    fixture.roomId
  );

  const openPhoto=async name=>page.evaluate(async name=>{
    const canvas=document.createElement('canvas');
    canvas.width=4;canvas.height=4;
    const ctx=canvas.getContext('2d');
    ctx.fillRect(0,0,4,4);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const file=new File([blob],name,{type:'image/png'});
    const preview=await openMediaPreviewFromFiles([file]);
    return {
      mounted:Boolean(preview),
      active:preview===mediaPreviewState&&preview===window.FPMediaManager177.current(),
      name:preview?.items?.[0]?.file?.name||''
    };
  },name);

  const waitPreviewGone=()=>page.waitForFunction(()=>
    mediaPreviewState===null &&
    window.FPMediaManager177.current()===null &&
    !document.querySelector('#mediaPreviewRoot .media-preview-overlay')
  );

  const resetDraft=async messageId=>page.evaluate(({roomId,messageId})=>{
    const draft=ensureDraftState(roomId);
    draft.replyTo={messageId,author:'Reply',preview:'keep reply',kind:'text'};
    updateReplyComposerBar();
  },{roomId:fixture.roomId,messageId});

  // 1) Cancel before encryption/send starts.
  await resetDraft(1772301);
  assert((await openPhoto('cancel-before-encryption.png')).active);
  await page.locator('#mediaPreviewRoot .media-caption-input').fill('caption before cancel');
  let uploadRequests=0;
  await page.route('**/media/upload',async route=>{uploadRequests+=1;await route.continue();});
  const beforeCancel=await page.evaluate(()=>({
    sending:mediaPreviewState?.sending,
    operation:Boolean(mediaPreviewState?.operation),
    caption:mediaPreviewState?.caption||'',
    reply:ensureDraftState(state.roomId).replyTo?.messageId||null
  }));
  assert.deepEqual(beforeCancel,{
    sending:false,operation:false,caption:'caption before cancel',reply:1772301
  });
  await page.evaluate(()=>window.FPMediaSend170.cancelPreview(mediaPreviewState));
  await waitPreviewGone();
  assert.equal(uploadRequests,0,'cancel before encryption must not start media upload');
  assert.equal(await page.evaluate(()=>ensureDraftState(state.roomId).replyTo?.messageId||null),1772301,
    'cancel before encryption must preserve existing reply draft');
  await page.unroute('**/media/upload');
  console.log('PASS cancel before encryption closes the same preview without starting upload');

  // Observe the existing cleanup transport externally, without replacing app fetch ownership.
  const cleanupRequests=[];
  const onCleanupRequest=request=>{
    if(!request.url().includes('/media/pending')||request.method()!=='DELETE')return;
    try{cleanupRequests.push(JSON.parse(request.postData()||'{}'));}catch{}
  };
  page.on('request',onCleanupRequest);

  // 2) Cancel while upload is in flight, before server commit.
  await resetDraft(1772302);
  assert((await openPhoto('cancel-during-upload.png')).active);
  let duringStarted;
  const duringReady=new Promise(resolve=>{duringStarted=resolve;});
  await page.route('**/media/upload',async route=>{
    duringStarted();
    await new Promise(resolve=>setTimeout(resolve,250));
    try{await route.abort('aborted');}catch{}
  });
  await page.locator('#mediaPreviewRoot .media-send-btn').click();
  await Promise.race([
    duringReady,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('in-flight media upload not reached')),6000))
  ]);
  const duringIdentity=await page.evaluate(()=>({
    uploadId:mediaPreviewState?.items?.[0]?.uploadId||'',
    operation:Boolean(mediaPreviewState?.operation),
    sending:Boolean(mediaPreviewState?.sending)
  }));
  assert(duringIdentity.uploadId,'stable uploadId missing during upload');
  assert.equal(duringIdentity.operation,true);
  assert.equal(duringIdentity.sending,true);
  const duringCancel=page.evaluate(()=>window.FPMediaSend170.cancelPreview(mediaPreviewState));
  await Promise.race([
    duringCancel,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('cancel during upload did not settle')),5000))
  ]);
  await waitPreviewGone();
  await page.unroute('**/media/upload');
  assert(cleanupRequests.some(body=>Array.isArray(body.uploadIds)&&body.uploadIds.includes(duringIdentity.uploadId)),
    'cancel during upload must use existing pending cleanup with the stable uploadId');
  console.log('PASS cancel during upload aborts existing operation and runs stable-uploadId cleanup');

  // 3) Server has committed pending media, but response is still withheld from XHR.
  await resetDraft(1772303);
  assert((await openPhoto('cancel-after-server-commit.png')).active);
  let releaseResponse,markCommitted;
  const responseGate=new Promise(resolve=>{releaseResponse=resolve;});
  const committedReady=new Promise(resolve=>{markCommitted=resolve;});
  await page.route('**/media/upload',async route=>{
    const response=await route.fetch();
    markCommitted();
    await responseGate;
    try{await route.fulfill({response});}catch{}
  });
  await page.locator('#mediaPreviewRoot .media-send-btn').click();
  await Promise.race([
    committedReady,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('server-committed upload not reached')),6000))
  ]);

  const committedIdentity=await page.evaluate(()=>({
    uploadId:mediaPreviewState?.items?.[0]?.uploadId||'',
    uploadedMedia:mediaPreviewState?.items?.[0]?.uploadedMedia||null,
    roomId:mediaPreviewState?.roomId||''
  }));
  assert(committedIdentity.uploadId,'uploadId missing after server commit');
  assert.equal(committedIdentity.uploadedMedia,null,
    'browser must not receive upload response before cancellation point');

  const blobBefore=await page.evaluate(async({uploadId,deviceId})=>{
    const response=await fetch(`/api/media/${encodeURIComponent(uploadId)}/blob?deviceId=${encodeURIComponent(deviceId)}`);
    return response.status;
  },{uploadId:committedIdentity.uploadId,deviceId:fixture.deviceId});
  assert.equal(blobBefore,200,'server pending media row/blob must exist before response delivery');

  const cancelPromise=page.evaluate(()=>window.FPMediaSend170.cancelPreview(mediaPreviewState));
  releaseResponse();
  await cancelPromise;
  await waitPreviewGone();
  await page.unroute('**/media/upload');

  let blobAfter=200;
  for(let i=0;i<30;i++){
    blobAfter=await page.evaluate(async({uploadId,deviceId})=>{
      const response=await fetch(`/api/media/${encodeURIComponent(uploadId)}/blob?deviceId=${encodeURIComponent(deviceId)}`);
      return response.status;
    },{uploadId:committedIdentity.uploadId,deviceId:fixture.deviceId});
    if(blobAfter===404)break;
    await page.waitForTimeout(100);
  }
  assert.equal(blobAfter,404,
    'cancel after server commit but before upload response must delete the pending server media');
  assert(cleanupRequests.some(body=>Array.isArray(body.uploadIds)&&body.uploadIds.includes(committedIdentity.uploadId)),
    'post-commit cancel must clean by uploadId when uploadedMedia response was never observed');
  assert.equal(await page.evaluate(()=>ensureDraftState(state.roomId).replyTo?.messageId||null),1772303,
    'post-commit upload cancel must preserve the existing reply draft');
  console.log('PASS cancel after server commit/before response removes orphan pending media by uploadId');

  page.off('request',onCleanupRequest);

  assert.deepEqual(errors,[]);
  console.log('PASS existing cancel cleanup semantics remain intact in all three timing windows');
  console.log('PASS no uncaught browser errors');
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
