'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const nodeCrypto=require('node:crypto');
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

  // 2) Cancel while the existing network owner has an active upload promise.
  await resetDraft(1772302);
  assert((await openPhoto('cancel-during-upload.png')).active);
  await page.evaluate(()=>{
    const original=window.FPNetwork171;
    window.__fp17723OriginalNetwork=original;
    window.__fp17723UploadStubActive=false;
    window.__fp17723UploadStubAborted=false;
    window.FPNetwork171=Object.freeze({
      ...original,
      upload({signal}={}){
        window.__fp17723UploadStubActive=true;
        return new Promise((resolve,reject)=>{
          const abort=()=>{
            window.__fp17723UploadStubAborted=true;
            reject(new DOMException('Upload aborted','AbortError'));
          };
          if(signal?.aborted){abort();return;}
          signal?.addEventListener('abort',abort,{once:true});
        });
      }
    });
  });
  await page.locator('#mediaPreviewRoot .media-send-btn').click();
  await page.waitForFunction(()=>window.__fp17723UploadStubActive===true);
  const duringSnapshot=await page.evaluate(()=>({
    uploadId:mediaPreviewState?.items?.[0]?.uploadId||'',
    operation:Boolean(mediaPreviewState?.operation),
    sending:Boolean(mediaPreviewState?.sending)
  }));
  assert(duringSnapshot.uploadId,'stable uploadId missing during upload');
  assert.equal(duringSnapshot.operation,true);
  assert.equal(duringSnapshot.sending,true);
  await page.evaluate(()=>window.FPMediaSend170.cancelPreview(mediaPreviewState));
  await waitPreviewGone();
  const duringAbort=await page.evaluate(()=>window.__fp17723UploadStubAborted===true);
  assert.equal(duringAbort,true,'cancel during upload must abort through the existing operation signal');
  assert(cleanupRequests.some(body=>Array.isArray(body.uploadIds)&&body.uploadIds.includes(duringSnapshot.uploadId)),
    'cancel during upload must use existing pending cleanup with the stable uploadId');
  await page.evaluate(()=>{
    if(window.__fp17723OriginalNetwork)window.FPNetwork171=window.__fp17723OriginalNetwork;
    delete window.__fp17723OriginalNetwork;
    delete window.__fp17723UploadStubActive;
    delete window.__fp17723UploadStubAborted;
  });
  console.log('PASS cancel during upload aborts existing operation and runs stable-uploadId cleanup');

  // 3) Reproduce the client state after server commit but before upload response is accepted:
  // the server owns a pending row for item.uploadId, while preview.uploadedMedia is still null.
  await resetDraft(1772303);
  assert((await openPhoto('cancel-after-server-commit.png')).active);
  const committedUploadId=nodeCrypto.randomBytes(16).toString('hex');
  await page.evaluate(uploadId=>{
    mediaPreviewState.items[0].uploadId=uploadId;
  },committedUploadId);

  const fd=new FormData();
  fd.append('deviceId',fixture.deviceId);
  fd.append('uploadId',committedUploadId);
  fd.append('originalNameCiphertext','');
  fd.append('originalNameIv','');
  fd.append('mimeType','image/png');
  fd.append('mediaKind','image');
  fd.append('sizeBytes','4');
  fd.append('encryptedSizeBytes','4');
  fd.append('thumbSizeBytes','0');
  fd.append('thumbEncryptedSizeBytes','0');
  fd.append('width','4');
  fd.append('height','4');
  fd.append('durationSeconds','0');
  fd.append('fileOrder','0');
  fd.append('encryptedFile',new Blob([new Uint8Array([1,2,3,4])],{type:'application/octet-stream'}),'file.bin');

  const commitResponse=await fetch(`${origin}/api/rooms/${encodeURIComponent(fixture.roomId)}/media/upload`,{
    method:'POST',
    body:fd
  });
  assert.equal(commitResponse.status,200,'server pending-media fixture commit failed');
  const committedServerData=await commitResponse.json();
  assert.equal(committedServerData?.media?.public_id||committedServerData?.media?.publicId||committedUploadId,committedUploadId,
    'server fixture must use the client uploadId identity');

  const committedSnapshot=await page.evaluate(()=>({
    uploadId:mediaPreviewState?.items?.[0]?.uploadId||'',
    uploadedMedia:mediaPreviewState?.items?.[0]?.uploadedMedia||null,
    roomId:mediaPreviewState?.roomId||''
  }));
  assert.equal(committedSnapshot.uploadId,committedUploadId);
  assert.equal(committedSnapshot.uploadedMedia,null,
    'preview must represent the pre-response state even though server commit exists');

  const blobBefore=await fetch(`${origin}/api/media/${encodeURIComponent(committedUploadId)}/blob?deviceId=${encodeURIComponent(fixture.deviceId)}`);
  assert.equal(blobBefore.status,200,
    'server pending media row/blob must exist before preview accepts a response');

  await page.evaluate(()=>window.FPMediaSend170.cancelPreview(mediaPreviewState));
  await waitPreviewGone();

  let blobAfterStatus=200;
  for(let i=0;i<30;i++){
    const response=await fetch(`${origin}/api/media/${encodeURIComponent(committedUploadId)}/blob?deviceId=${encodeURIComponent(fixture.deviceId)}`);
    blobAfterStatus=response.status;
    if(blobAfterStatus===404)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(blobAfterStatus,404,
    'cancel after server commit but before accepted response must delete pending server media');
  assert(cleanupRequests.some(body=>Array.isArray(body.uploadIds)&&body.uploadIds.includes(committedUploadId)),
    'post-commit cancel must clean by uploadId while uploadedMedia is still null');
  assert.equal(await page.evaluate(()=>ensureDraftState(state.roomId).replyTo?.messageId||null),1772303,
    'post-commit cancel must preserve the existing reply draft');
  console.log('PASS cancel after server commit/before accepted response removes orphan pending media by uploadId');

  page.off('request',onCleanupRequest);

  assert.deepEqual(errors,[]);
  console.log('PASS existing cancel cleanup semantics remain intact in all three timing windows');
  console.log('PASS no uncaught browser errors');
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
