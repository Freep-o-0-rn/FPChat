'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const app=read('public/app.js');
const media=read('public/media-send170.js');

const managerStart=app.indexOf('class FPMediaManager177Class {');
const managerEnd=app.indexOf('\nconst FPMediaManager177 =',managerStart);
assert(managerStart>=0&&managerEnd>managerStart,'MediaManager177 class missing');
const managerBlock=app.slice(managerStart,managerEnd);
assert(managerBlock.includes('open(preview, mount)'),'MediaManager open command missing');
assert(managerBlock.includes('close(preview, unmount)'),'MediaManager close command missing');
assert(managerBlock.includes('cancel(preview, cancelWorker)'),'MediaManager cancel delegation missing');
assert(managerBlock.includes('target !== this.#activePreview'),'stale preview close guard missing');
assert(managerBlock.includes('current()'),'MediaManager current preview read missing');
for(const forbidden of [
  'createImageThumbBlob','createVideoThumbBlob','compressImageFile','encrypt',
  'uploadEncryptedMedia','fetch(','XMLHttpRequest','MediaRecorder',
  'URL.createObjectURL','URL.revokeObjectURL','sendMediaFromPreview'
]){
  assert(!managerBlock.includes(forbidden),'MediaManager took forbidden media implementation: '+forbidden);
}

const openStart=app.indexOf('async function openMediaPreviewFromFiles(rawFiles)');
const closeWorkerStart=app.indexOf('function closeMediaPreviewModalWorker177(preview)',openStart);
assert(openStart>=0&&closeWorkerStart>openStart,'existing preview open worker missing');
const openBlock=app.slice(openStart,closeWorkerStart);
assert(openBlock.includes('const view=captureRoomView170();'),'room-open guard changed');
assert(openBlock.includes('items.push({id:crypto.randomUUID(),file:f,kind:isVid?\'video\':\'image\''),
  'existing preview item creation/order changed');
assert(openBlock.includes("caption:'',sending:false,failedIndex:null"),'existing preview state shape changed');
assert(openBlock.includes('FPMediaManager177.open(preview,(next)=>{mediaPreviewState=next;renderMediaPreviewModal();})'),
  'preview open must delegate only final lifecycle mount');

const closeFacadeStart=app.indexOf('function closeMediaPreviewModal(preview=mediaPreviewState)',closeWorkerStart);
const renderStart=app.indexOf('function renderMediaPreviewModal()',closeFacadeStart);
assert(closeFacadeStart>closeWorkerStart&&renderStart>closeFacadeStart,'preview close/render boundaries changed');
const closeWorker=app.slice(closeWorkerStart,closeFacadeStart);
const closeFacade=app.slice(closeFacadeStart,renderStart);
assert(closeWorker.includes('mediaPreviewState!==preview'),'close worker must only unmount its exact preview');
assert(closeWorker.includes('URL.revokeObjectURL(i.objectUrl)'),'existing objectUrl close cleanup changed');
assert(closeWorker.includes('URL.revokeObjectURL(i.thumbnailObjectUrl)'),'existing thumbnail close cleanup changed');
assert(closeWorker.includes("root.innerHTML=''"),'existing preview DOM cleanup changed');
assert(closeFacade.includes('FPMediaManager177.close(preview,closeMediaPreviewModalWorker177)'),
  'close facade must delegate to MediaManager');
assert(app.includes("root.querySelector('.media-caption-input').oninput=e=>{preview.caption=e.target.value;};"),
  'caption behavior changed');
assert(app.includes('const draft=ensureDraftState(state.roomId)'),'existing reply draft path missing');
assert(media.includes('closeMediaPreviewModal(preview);'),
  'media executor must close the exact preview identity after send/cancel');

console.log('PASS MediaManager177 owns preview lifecycle plus generated thumbnail ObjectURL cleanup only');
console.log('PASS existing validation/thumb/caption/reply/ObjectURL workers remain outside MediaManager');
console.log('PASS close is scoped to the exact preview identity');

run(async({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(origin);
  await page.waitForFunction(() =>
    window.FPMediaManager177?.open &&
    window.FPMediaSend170?.active &&
    typeof openMediaPreviewFromFiles==='function' &&
    typeof openChat==='function' &&
    !document.getElementById('bootHold152')
  );

  const fixture=await page.evaluate(async()=>{
    const ids=[],deviceId=getOrCreateDeviceId();
    for(const suffix of ['a','b']){
      const secret='17722-'+suffix+'-'+crypto.randomUUID().replaceAll('-','');
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
      ids.push(data.publicId);
    }
    return {ids,deviceId};
  });
  const [roomA,roomB]=fixture.ids;

  const openRoom=async room=>{
    await page.evaluate(async roomId=>{showChatsList();await openChat(roomId);},room);
    await page.waitForSelector('#msgInput');
    await page.waitForFunction(roomId=>
      state.roomId===roomId &&
      Boolean(document.getElementById('sendForm')) &&
      Boolean(document.getElementById('mediaPreviewRoot')),
      room
    );
  };

  const makeFilesAndOpen=async names=>page.evaluate(async names=>{
    async function imageFile(name){
      const canvas=document.createElement('canvas');
      canvas.width=2;canvas.height=2;
      const ctx=canvas.getContext('2d');
      ctx.fillRect(0,0,2,2);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      return new File([blob],name,{type:'image/png'});
    }
    async function videoFile(name){
      const canvas=document.createElement('canvas');
      canvas.width=16;canvas.height=16;
      const ctx=canvas.getContext('2d');
      const stream=canvas.captureStream(10);
      const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp8')?'video/webm;codecs=vp8':'video/webm';
      const recorder=new MediaRecorder(stream,{mimeType:mime});
      const chunks=[];
      recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
      const stopped=new Promise(resolve=>recorder.onstop=resolve);
      recorder.start();
      ctx.fillRect(0,0,16,16);
      await new Promise(resolve=>setTimeout(resolve,180));
      recorder.stop();
      await stopped;
      stream.getTracks().forEach(track=>track.stop());
      return new File(chunks,name,{type:'video/webm'});
    }
    const files=[];
    for(const item of names){
      files.push(item.kind==='video'?await videoFile(item.name):await imageFile(item.name));
    }
    const result=await openMediaPreviewFromFiles(files);
    return {
      mounted:Boolean(result),
      same:result===mediaPreviewState&&result===window.FPMediaManager177.current(),
      roomId:mediaPreviewState?.roomId||'',
      names:(mediaPreviewState?.items||[]).map(item=>item.file.name),
      kinds:(mediaPreviewState?.items||[]).map(item=>item.kind),
      caption:mediaPreviewState?.caption||''
    };
  },names);

  await openRoom(roomA);
  await page.evaluate(room=>{
    const draft=ensureDraftState(room);
    draft.replyTo={messageId:1772201,author:'Reply A',preview:'Reply preview A',kind:'text'};
    updateReplyComposerBar();
  },roomA);

  const initial=await makeFilesAndOpen([
    {kind:'image',name:'01-photo.png'},
    {kind:'video',name:'02-video.webm'}
  ]);
  assert(initial.mounted&&initial.same,'MediaManager must mount the same prepared preview object');
  assert.equal(initial.roomId,roomA);
  assert.deepEqual(initial.names,['01-photo.png','02-video.webm'],'preview file order changed');
  assert.deepEqual(initial.kinds,['image','video'],'photo/video order changed');
  assert.equal(initial.caption,'','preview caption must start exactly as before');

  await page.locator('#mediaPreviewRoot .media-caption-input').fill('caption 177.22');
  const preserved=await page.evaluate(room=>({
    caption:mediaPreviewState?.caption||'',
    reply:ensureDraftState(room).replyTo,
    count:document.querySelectorAll('#mediaPreviewRoot .media-preview-item').length,
    active:window.FPMediaManager177.current()===mediaPreviewState
  }),roomA);
  assert.equal(preserved.caption,'caption 177.22','caption update changed');
  assert.equal(preserved.reply?.messageId,1772201,'opening/editing preview changed reply source');
  assert.equal(preserved.count,2,'preview DOM item count changed');
  assert.equal(preserved.active,true,'manager/current preview identity diverged');
  console.log('PASS photo/video preview keeps item order, caption and existing reply draft');

  const closeA=await page.evaluate(()=>closeMediaPreviewModal(window.FPMediaManager177.current()));
  assert.equal(closeA,true,'active preview close must delegate successfully');
  const closedA=await page.evaluate(()=>({
    state:mediaPreviewState,
    current:window.FPMediaManager177.current(),
    html:document.getElementById('mediaPreviewRoot')?.innerHTML||'',
    reply:ensureDraftState(state.roomId).replyTo
  }));
  assert.equal(closedA.state,null);
  assert.equal(closedA.current,null);
  assert.equal(closedA.html,'');
  assert.equal(closedA.reply?.messageId,1772201,'closing preview changed reply draft');
  console.log('PASS existing close clears the same preview without changing reply draft');

  // Stale A close must never unmount a newer B preview.
  await makeFilesAndOpen([{kind:'image',name:'stale-a.png'}]);
  await page.evaluate(()=>{window.__fp17722OldA=window.FPMediaManager177.current();});
  await openRoom(roomB);
  await page.evaluate(room=>{
    const draft=ensureDraftState(room);
    draft.replyTo={messageId:1772202,author:'Reply B',preview:'Reply preview B',kind:'text'};
    updateReplyComposerBar();
  },roomB);
  const openedB=await makeFilesAndOpen([
    {kind:'image',name:'b-photo.png'},
    {kind:'video',name:'b-video.webm'}
  ]);
  assert.equal(openedB.roomId,roomB);
  await page.locator('#mediaPreviewRoot .media-caption-input').fill('caption B');

  const staleClose=await page.evaluate(()=>closeMediaPreviewModal(window.__fp17722OldA));
  assert.equal(staleClose,false,'late close for preview A must be rejected after B becomes active');
  const bState=await page.evaluate(room=>({
    roomId:mediaPreviewState?.roomId||'',
    caption:mediaPreviewState?.caption||'',
    names:(mediaPreviewState?.items||[]).map(item=>item.file.name),
    currentSame:window.FPMediaManager177.current()===mediaPreviewState,
    visible:Boolean(document.querySelector('#mediaPreviewRoot .media-preview-overlay')),
    reply:ensureDraftState(room).replyTo
  }),roomB);
  assert.equal(bState.roomId,roomB);
  assert.equal(bState.caption,'caption B');
  assert.deepEqual(bState.names,['b-photo.png','b-video.webm']);
  assert.equal(bState.currentSame,true);
  assert.equal(bState.visible,true,'stale A close removed B preview DOM');
  assert.equal(bState.reply?.messageId,1772202,'stale A close changed B reply draft');
  console.log('PASS leaving A / late A close cannot close a newer preview in room B');

  await page.evaluate(()=>{
    closeMediaPreviewModal(window.FPMediaManager177.current());
    delete window.__fp17722OldA;
  });

  assert.deepEqual(errors,[]);
  console.log('PASS no uncaught browser errors');
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
