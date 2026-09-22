'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const media=read('public/media-send170.js');
const manager=read('public/send-manager177.js');
const app=read('public/app.js');
const voice=read('public/voice.js');

const executeStart=media.indexOf('  function executeMediaFromPreview170(root) {');
const executeEnd=media.indexOf('\n  function dispatchMediaFromPreview170(root)',executeStart);
assert(executeStart>=0&&executeEnd>executeStart,'existing media entry executor missing');
const executeBlock=media.slice(executeStart,executeEnd);
assert(executeBlock.includes('preview.sending || preview.cancelled || preview.committed'),'media duplicate/cancel guard changed');
assert(executeBlock.includes("contexts.beginOperation(context.roomId, 'media-send')"),'media operation context changed');
assert(executeBlock.includes('preview.task = send(preview, context, root, preview.operation);'),'existing media worker handoff changed');

const dispatchStart=media.indexOf('  function dispatchMediaFromPreview170(root) {');
const dispatchEnd=media.indexOf('\n\n  sendMediaFromPreview = dispatchMediaFromPreview170;',dispatchStart);
assert(dispatchStart>=0&&dispatchEnd>dispatchStart,'media dispatcher wrapper missing');
const dispatchBlock=media.slice(dispatchStart,dispatchEnd);
assert(dispatchBlock.includes('const manager = window.FPSendManager177;'),'media wrapper must resolve SendManager');
assert(dispatchBlock.includes('if (!manager?.dispatch) return false;'),'media manager refusal must not fall back');
assert(dispatchBlock.includes('return manager.dispatch(() => executeMediaFromPreview170(root));'),
  'dispatcher must receive exactly the existing media entry executor');
assert((dispatchBlock.match(/executeMediaFromPreview170\(root\)/g)||[]).length===1,
  'media wrapper must have exactly one executor call site');
assert(media.includes('sendMediaFromPreview = dispatchMediaFromPreview170;'),'global media entry must be the dispatcher wrapper');

assert(manager.includes('return executor();'),'SendManager must remain stateless');
assert(media.includes('item.uploadId ||= crypto.randomUUID().replaceAll'), 'stable media uploadId changed');
assert(media.includes("confirm(`Не удалось загрузить файл"),'existing media retry prompt changed');
assert(media.includes('{signal:operation.signal}'),'media upload AbortSignal changed');
assert(media.includes("type:'message:new',roomId,messageType:'media'"),'final media message send changed');
assert(!voice.includes('FPSendManager177'),'voice must remain direct in 177.19');

assert(app.includes("accept='image/*,video/*'"),'attachment input scope changed');
assert(app.includes("const isImg=ALLOWED_IMAGE_TYPES.has(type)||type.startsWith('image/');"),'image file path changed');
assert(app.includes("const isVid=ALLOWED_VIDEO_TYPES.has(type)||type.startsWith('video/');"),'video file path changed');
assert(app.includes('if(!isImg&&!isVid)continue'),'unsupported file filter changed');
assert(app.includes("root.querySelector('.media-send-btn').onclick=()=>sendMediaFromPreview(root);"),
  'media preview must keep one existing send-button entry');
assert((media.match(/FPSendManager177/g)||[]).length>=1,'media must use SendManager');
assert((media.match(/manager\.dispatch/g)||[]).length===1,'photo/album/video must share one dispatcher adapter');

console.log('PASS one media preview entry dispatches exactly one existing media executor');
console.log('PASS media uploadId/retry/cancel/operation/message worker remains unchanged');
console.log('PASS photo/album/video share one executor and one dispatcher adapter');
console.log('PASS generic document/file path remains unsupported and is not invented');
console.log('PASS voice is not transferred in 177.19');

run(async({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(origin);
  await page.waitForFunction(() =>
    window.FPSendManager177?.dispatch &&
    window.FPMediaSend170?.active &&
    typeof renderMediaPreviewModal==='function' &&
    typeof openChat==='function' &&
    !document.getElementById('bootHold152')
  );

  const fixture=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='177-media-dispatch';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})
    });
    if(!response.ok)throw new Error('room fixture failed: '+response.status);
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

  await page.evaluate(()=>{
    window.__fp17719={messages:[],originalSend:WebSocket.prototype.send};
    WebSocket.prototype.send=function(payload){
      try{
        const parsed=JSON.parse(String(payload));
        if(parsed?.type==='message:new'&&parsed?.messageType==='media'){
          window.__fp17719.messages.push({
            roomId:String(parsed.roomId||''),
            mediaIds:[...(parsed.mediaIds||[])],
            replyToMessageId:parsed.replyToMessageId||null
          });
        }
      }catch{}
      return window.__fp17719.originalSend.call(this,payload);
    };
  });

  const createPreview=async kinds=>page.evaluate(kinds=>{
    if(mediaPreviewState)closeMediaPreviewModal();
    const items=kinds.map((kind,index)=>{
      const type=kind==='video'?'video/mp4':'image/jpeg';
      const ext=kind==='video'?'mp4':'jpg';
      const file=new File([new Uint8Array([1,2,3,index])],`${kind}-${index}.${ext}`,{type});
      const thumbnailBlob=new Blob([new Uint8Array([4,5,index])],{type:'application/octet-stream'});
      return {
        id:crypto.randomUUID(),
        file,
        kind,
        objectUrl:URL.createObjectURL(file),
        thumbnailBlob,
        thumbnailObjectUrl:URL.createObjectURL(thumbnailBlob),
        width:1,
        height:1,
        durationSeconds:kind==='video'?1:0,
        uploadedMedia:null,
        uploadError:null
      };
    });
    mediaPreviewState={roomId:state.roomId,items,caption:'',sending:false,failedIndex:null};
    renderMediaPreviewModal();
    return mediaPreviewState.items.length;
  },kinds);

  const readMediaMessages=async()=>page.evaluate(async room=>{
    const persisted=STORAGE.get(STORAGE.roomState(room));
    const response=await fetch(`/api/rooms/${room}/messages?deviceId=${encodeURIComponent(persisted.deviceId)}&limit=100`);
    if(!response.ok)throw new Error('messages '+response.status);
    const data=await response.json();
    return (data.messages||[]).filter(message=>message.type==='media').map(message=>({
      id:message.id,
      media:(message.media||[]).map(item=>({kind:item.media_kind||item.kind||null,id:item.id||null}))
    }));
  },fixture.roomId);

  const sendScenario=async(kinds,label)=>{
    const before=await readMediaMessages();
    const beforeIds=new Set(before.map(item=>item.id));
    const count=await createPreview(kinds);
    assert.equal(count,kinds.length,label+' preview item count');
    await page.locator('#mediaPreviewRoot .media-send-btn').click();
    await page.waitForFunction(()=>mediaPreviewState===null,null,{timeout:10000});

    let created=null;
    for(let i=0;i<40;i++){
      const now=await readMediaMessages();
      created=now.find(item=>!beforeIds.has(item.id))||null;
      if(created)break;
      await page.waitForTimeout(100);
    }
    assert(created,label+' media message missing');
    assert.equal(created.media.length,kinds.length,label+' media count mismatch');
    assert.deepEqual(created.media.map(item=>item.kind),kinds,label+' media kind mismatch');
    return created;
  };

  try{
    const photo=await sendScenario(['image'],'single photo');
    assert.equal(photo.media.length,1);

    const album=await sendScenario(['image','image'],'album');
    assert.equal(album.media.length,2);

    const video=await sendScenario(['video'],'video');
    assert.equal(video.media.length,1);

    const sent=await page.evaluate(()=>window.__fp17719.messages);
    assert.equal(sent.length,3,'photo/album/video must each create one final media message');
    assert(sent.every(item=>item.roomId===fixture.roomId),'all media messages must stay in the source room');
    assert.deepEqual(sent.map(item=>item.mediaIds.length),[1,2,1],
      'single photo/album/video must keep their mediaIds shape');

    const unsupported=await page.evaluate(async()=>{
      const file=new File([new Uint8Array([1,2,3])],'document.pdf',{type:'application/pdf'});
      await openMediaPreviewFromFiles([file]);
      return {
        preview:Boolean(mediaPreviewState),
        accept:document.getElementById('mediaFileInput')?.getAttribute('accept')||''
      };
    });
    assert.equal(unsupported.preview,false,'generic PDF must not enter current media preview path');
    assert.equal(unsupported.accept,'image/*,video/*','attachment input must remain image/video only');

    console.log('PASS single photo sends through dispatcher and existing media executor');
    console.log('PASS album sends through the same dispatcher adapter as one media message');
    console.log('PASS video sends through the same dispatcher adapter as one media message');
    console.log('PASS current unsupported generic file is rejected before media send path');
  } finally {
    await page.evaluate(async()=>{
      if(window.__fp17719?.originalSend)WebSocket.prototype.send=window.__fp17719.originalSend;
      if(mediaPreviewState)await window.FPMediaSend170?.cancelPreview?.(mediaPreviewState);
      delete window.__fp17719;
    });
  }

  assert.deepEqual(errors,[]);
  console.log('PASS no uncaught browser errors');
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
