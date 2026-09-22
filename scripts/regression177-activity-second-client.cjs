'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const manager=read('public/send-manager177.js');
const typing=read('public/typing.js');
const voice=read('public/voice.js');
const typingServer=read('src/typing-server.js');

for(const forbidden of ['activity:start','activity:stop','typing:start','typing:stop','startLocalActivity','stopLocalActivity']){
  assert(!manager.includes(forbidden),'SendManager must remain activity-blind: '+forbidden);
}
assert(typing.includes('const STOP_DELAY_MS = 3000;'),'text activity idle timing changed');
assert(typing.includes('const MEDIA_STOP_GRACE_MS = 280;'),'media stop grace changed');
assert(typing.includes("const renderedLabel = line.querySelector('.fp-typing-label');"),
  'remote activity owner must validate that its visible label still exists');
assert(typing.includes('renderedLabel?.textContent === label'),
  'remote activity idempotence must not trust stale class/data metadata alone');
assert(typing.includes("this.addEventListener('loadend', finish, { once: true });"),'media success cleanup changed');
assert(typing.includes("this.addEventListener('abort', finish, { once: true });"),'media cancel cleanup changed');
assert(typing.includes("this.addEventListener('error', finish, { once: true });"),'media error cleanup changed');
assert(typing.includes("this.addEventListener('timeout', finish, { once: true });"),'media timeout cleanup changed');
assert(voice.includes("startLocalActivity(roomId, 'recording_audio');"),'voice recording activity start changed');
assert(voice.includes("stopLocalActivity('recording_audio');"),'voice recording activity stop changed');
assert(voice.includes("startLocalActivity(data.roomId, 'audio');"),'voice send activity start changed');
assert(voice.includes("stopLocalActivity('audio');"),'voice send activity stop changed');
assert(typingServer.includes("if (payload.type === 'message:send' || payload.type === 'message:new')"),
  'server success activity cleanup changed');
assert(typingServer.includes("ws.on('close', () => stopAllForSocket(ws));"),
  'server socket-close activity cleanup changed');

console.log('PASS SendManager remains activity-blind');
console.log('PASS text/media/voice existing activity start/stop owners and timing constants remain unchanged');
console.log('PASS server success/socket-close activity cleanup remains unchanged');

run(async({browser,origin,errors})=>{
  const ctxA=await browser.newContext({viewport:{width:390,height:844}});
  const ctxB=await browser.newContext({viewport:{width:390,height:844}});
  const a=await ctxA.newPage();
  const b=await ctxB.newPage();
  for(const page of [a,b]){
    page.setDefaultTimeout(10000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.dismiss());
    await page.goto(origin);
    await page.waitForFunction(() =>
      window.FPSendManager177?.dispatch &&
      window.FPVoice &&
      typeof openChat==='function' &&
      !document.getElementById('bootHold152')
    );
  }

  await a.evaluate(()=>{state.nick='Sender17721';localStorage.setItem(STORAGE.nick,state.nick);});
  await b.evaluate(()=>{state.nick='Receiver17721';localStorage.setItem(STORAGE.nick,state.nick);});

  const created=await a.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='17721-'+crypto.randomUUID().replaceAll('-','');
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})
    });
    if(!response.ok)throw new Error('room create failed: '+response.status);
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId,inviteLink:data.inviteLink,inviteExpiresAt:data.inviteExpiresAt});
    upsertChat(data.publicId,{});
    return {roomId:data.publicId,inviteLink:data.inviteLink,deviceId};
  });
  assert(created.inviteLink,'invite link missing');

  const joined=await b.evaluate(async inviteLink=>{
    const inviteCode=String(inviteLink).split('/i/')[1]?.split(/[?#]/)[0]||'';
    const deviceId=getOrCreateDeviceId();
    const response=await fetch('/api/invites/'+encodeURIComponent(inviteCode)+'/join',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:state.nick,deviceId})
    });
    if(!response.ok)throw new Error('invite join failed: '+response.status);
    const data=await response.json();
    if(!data?.ok||!data.publicId||!data.roomSecret)throw new Error('invalid join payload');
    STORAGE.set(STORAGE.roomState(data.publicId),{secret:data.roomSecret,deviceId});
    upsertChat(data.publicId,{});
    return {roomId:data.publicId,deviceId};
  },created.inviteLink);
  assert.equal(joined.roomId,created.roomId);

  for(const page of [a,b]){
    await page.evaluate(async room=>{showChatsList();await openChat(room);},created.roomId);
    await page.waitForSelector('#sendForm');
    await page.waitForFunction(room=>state.roomId===room&&state.ws?.readyState===WebSocket.OPEN,created.roomId);
  }

  await b.evaluate(roomId=>{
    window.__fp17721Events=[];
    window.__fp17721Room=roomId;
    state.ws.addEventListener('message',event=>{
      try{
        const payload=JSON.parse(event.data);
        if(payload?.type==='typing:update'&&payload.roomId===window.__fp17721Room){
          window.__fp17721Events.push({
            at:performance.now(),
            typing:Boolean(payload.typing),
            activity:String(payload.activity||''),
            deviceId:String(payload.deviceId||'')
          });
        }
      }catch{}
    });
  },created.roomId);

  const remote=async()=>b.evaluate(()=>({
    active:document.getElementById('presenceLine')?.classList.contains('fp-typing-active')===true,
    activity:document.getElementById('presenceLine')?.dataset.fpActivity||'',
    label:document.querySelector('#presenceLine .fp-typing-label')?.textContent||'',
    events:[...(window.__fp17721Events||[])]
  }));

  const clearEvents=()=>b.evaluate(()=>{window.__fp17721Events=[];});
  const waitRemote=async activity=>{
    await b.waitForFunction(expected=>{
      const line=document.getElementById('presenceLine');
      return line?.classList.contains('fp-typing-active')===true && line.dataset.fpActivity===expected;
    },activity,{timeout:5000});
  };
  const waitClear=async()=>{
    const started=Date.now();
    await b.waitForFunction(()=>{
      const line=document.getElementById('presenceLine');
      return !line?.classList.contains('fp-typing-active');
    },null,{timeout:2500});
    return Date.now()-started;
  };

  const reopenA=async()=>{
    await a.evaluate(async room=>{showChatsList();await openChat(room);},created.roomId);
    await a.waitForSelector('#sendForm');
    await a.waitForFunction(()=>state.ws?.readyState===WebSocket.OPEN);
  };

  const createMediaPreview=async kind=>a.evaluate(kind=>{
    if(mediaPreviewState)closeMediaPreviewModal();
    const type=kind==='video'?'video/mp4':'image/jpeg';
    const ext=kind==='video'?'mp4':'jpg';
    const file=new File([new Uint8Array([1,2,3,4])],'activity.'+ext,{type});
    const thumb=new Blob([new Uint8Array([5,6,7])],{type:'application/octet-stream'});
    const item={
      id:crypto.randomUUID(),
      file,
      kind,
      objectUrl:URL.createObjectURL(file),
      thumbnailBlob:thumb,
      thumbnailObjectUrl:URL.createObjectURL(thumb),
      width:1,height:1,durationSeconds:kind==='video'?1:0,
      uploadedMedia:null,uploadError:null
    };
    const preview={roomId:state.roomId,items:[item],caption:'',sending:false,failedIndex:null};
    window.FPMediaManager177.open(preview,next=>{mediaPreviewState=next;renderMediaPreviewModal();});
  },kind);

  await a.evaluate(()=>{
    window.testAudio17721 ||= [];
    window.__fp17721Outgoing=[];
    window.__fp17721OriginalSend=WebSocket.prototype.send;
    WebSocket.prototype.send=function(payload){
      try{
        const parsed=JSON.parse(String(payload));
        if(['activity:start','activity:stop','typing:start','typing:stop','message:new','message:send'].includes(parsed?.type)){
          window.__fp17721Outgoing.push({at:performance.now(),type:parsed.type,activity:String(parsed.activity||''),roomId:String(parsed.roomId||'')});
        }
      }catch{}
      return window.__fp17721OriginalSend.call(this,payload);
    };
    navigator.mediaDevices.getUserMedia=async()=>{
      const audio=new AudioContext();
      const oscillator=audio.createOscillator();
      const destination=audio.createMediaStreamDestination();
      oscillator.connect(destination);oscillator.start();void audio.resume();
      window.testAudio17721.push({audio,oscillator,stream:destination.stream});
      return destination.stream;
    };
  });

  const startVoice=async()=>{
    const mic=a.locator('.fp-voice-record-btn');
    const rect=await mic.boundingBox();
    assert(rect,'voice microphone missing');
    const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    await a.mouse.move(x,y);await a.mouse.down();
    await a.waitForSelector('#sendForm.fp-voice-recording');
    return {x,y};
  };

  try{
    // MEDIA success
    await clearEvents();
    await createMediaPreview('image');
    let releaseMediaSuccess,mediaSuccessStarted;
    const mediaSuccessGate=new Promise(resolve=>{releaseMediaSuccess=resolve;});
    const mediaSuccessReady=new Promise(resolve=>{mediaSuccessStarted=resolve;});
    await a.route('**/media/upload',async route=>{
      mediaSuccessStarted();
      await mediaSuccessGate;
      await route.continue();
    });
    await a.locator('#mediaPreviewRoot .media-send-btn').click();
    await Promise.race([mediaSuccessReady,new Promise((_,reject)=>setTimeout(()=>reject(new Error('media success upload not reached')),5000))]);
    await waitRemote('photo');
    releaseMediaSuccess();
    await a.waitForFunction(()=>mediaPreviewState===null,null,{timeout:8000});
    const mediaSuccessStop=await waitClear();
    assert(mediaSuccessStop<2500,'media success activity waited for safety timeout');
    await a.unroute('**/media/upload');
    console.log('PASS second client: photo upload start and success clear preserve existing media activity timing');

    // MEDIA cancel/abort
    await clearEvents();
    await createMediaPreview('image');
    let mediaCancelStarted;
    const mediaCancelReady=new Promise(resolve=>{mediaCancelStarted=resolve;});
    await a.route('**/media/upload',async route=>{
      mediaCancelStarted();
      await new Promise(resolve=>setTimeout(resolve,5000));
      try{await route.continue();}catch{}
    });
    await a.locator('#mediaPreviewRoot .media-send-btn').click();
    await Promise.race([mediaCancelReady,new Promise((_,reject)=>setTimeout(()=>reject(new Error('media cancel upload not reached')),5000))]);
    await waitRemote('photo');
    await a.evaluate(async()=>{if(mediaPreviewState)await window.FPMediaSend170.cancelPreview(mediaPreviewState);});
    const mediaCancelStop=await waitClear();
    assert(mediaCancelStop<2500,'media cancel activity waited for safety timeout');
    await a.unroute('**/media/upload');
    console.log('PASS second client: media cancel/abort clears prior photo activity');

    // MEDIA error
    await clearEvents();
    await createMediaPreview('image');
    let mediaErrorStarted;
    const mediaErrorReady=new Promise(resolve=>{mediaErrorStarted=resolve;});
    await a.route('**/media/upload',async route=>{
      mediaErrorStarted();
      await new Promise(resolve=>setTimeout(resolve,150));
      await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'17721 media error'})});
    });
    await a.locator('#mediaPreviewRoot .media-send-btn').click();
    await Promise.race([mediaErrorReady,new Promise((_,reject)=>setTimeout(()=>reject(new Error('media error upload not reached')),5000))]);
    await waitRemote('photo');
    const mediaErrorStop=await waitClear();
    assert(mediaErrorStop<2500,'media error activity waited for safety timeout');
    await a.unroute('**/media/upload');
    if(await a.evaluate(()=>Boolean(mediaPreviewState))) await a.evaluate(()=>window.FPMediaSend170.cancelPreview(mediaPreviewState));
    console.log('PASS second client: media upload error clears prior photo activity');

    // VOICE cancel
    await clearEvents();
    await startVoice();
    await waitRemote('recording_audio');
    assert.equal((await remote()).label,'записывает аудио…');
    await a.evaluate(()=>window.FPVoice.cancelRecording());
    await a.mouse.up();
    const voiceCancelStop=await waitClear();
    assert(voiceCancelStop<2500,'voice recording cancel waited for safety timeout');
    console.log('PASS second client: voice recording start and cancel clear recording_audio');

    // VOICE success: recording_audio -> audio -> clear
    await clearEvents();
    let releaseVoiceSuccess,voiceSuccessStarted;
    const voiceSuccessGate=new Promise(resolve=>{releaseVoiceSuccess=resolve;});
    const voiceSuccessReady=new Promise(resolve=>{voiceSuccessStarted=resolve;});
    await a.route('**/voice/upload',async route=>{
      const response=await route.fetch();
      voiceSuccessStarted();
      await voiceSuccessGate;
      await route.fulfill({response});
    });
    const direct=await startVoice();
    await waitRemote('recording_audio');
    await a.waitForTimeout(850);
    await a.mouse.move(direct.x,direct.y);await a.mouse.up();
    await Promise.race([voiceSuccessReady,new Promise((_,reject)=>setTimeout(()=>reject(new Error('voice success upload not reached')),6000))]);
    await waitRemote('audio');
    const voiceSuccessRemote=await remote();
    if(voiceSuccessRemote.label!=='загружает аудио…'){
      const outgoing=await a.evaluate(()=>window.__fp17721Outgoing||[]);
      console.log('DIAG voice-success remote='+JSON.stringify(voiceSuccessRemote));
      console.log('DIAG voice-success outgoing='+JSON.stringify(outgoing));
    }
    assert.equal(voiceSuccessRemote.label,'загружает аудио…');
    releaseVoiceSuccess();
    const voiceSuccessStop=await waitClear();
    assert(voiceSuccessStop<2500,'voice success audio activity waited for safety timeout');
    await a.unroute('**/voice/upload');
    console.log('PASS second client: voice success transitions recording_audio -> audio -> clear');

    // VOICE error: recording_audio -> audio -> clear through executor finally.
    await clearEvents();
    let voiceErrorStarted;
    const voiceErrorReady=new Promise(resolve=>{voiceErrorStarted=resolve;});
    await a.route('**/voice/upload',async route=>{
      voiceErrorStarted();
      await new Promise(resolve=>setTimeout(resolve,150));
      await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'17721 voice error'})});
    });
    const failed=await startVoice();
    await waitRemote('recording_audio');
    await a.waitForTimeout(850);
    await a.mouse.move(failed.x,failed.y);await a.mouse.up();
    await Promise.race([voiceErrorReady,new Promise((_,reject)=>setTimeout(()=>reject(new Error('voice error upload not reached')),6000))]);
    await waitRemote('audio');
    const voiceErrorStop=await waitClear();
    assert(voiceErrorStop<2500,'voice error audio activity waited for safety timeout');
    await a.unroute('**/voice/upload');
    await a.evaluate(()=>window.FPVoice.clearPreview());
    console.log('PASS second client: voice upload error clears audio through existing finally');

    // TEXT success
    await clearEvents();
    await a.locator('#msgInput').focus();
    await a.keyboard.type('text success');
    await waitRemote('typing');
    assert.equal((await remote()).label,'печатает…');
    await a.locator('#sendBtn').click();
    const textSuccessStop=await waitClear();
    assert(textSuccessStop<2500,'text success activity waited for safety timeout');
    console.log('PASS second client: text start and success clear use existing immediate submit/server stop');

    // TEXT cancel: clearing the real input immediately sends typing:stop.
    await clearEvents();
    await a.locator('#msgInput').fill('');
    await a.locator('#msgInput').focus();
    await a.keyboard.type('text cancel');
    await waitRemote('typing');
    await a.locator('#msgInput').fill('');
    const textCancelStop=await waitClear();
    assert(textCancelStop<2500,'text cancel activity waited for safety timeout');
    console.log('PASS second client: text cancel clears existing typing state');

    // TEXT error/disconnect: unexpected socket close is cleared by the server socket owner.
    await clearEvents();
    await a.locator('#msgInput').focus();
    await a.keyboard.type('text disconnect');
    await waitRemote('typing');
    await a.evaluate(()=>{
      const ws=state.ws;
      window.__fp17721Reconnect=window.FPConnection170?.ensureConnected;
      try{ws?.close?.(4001,'17721-test-error');}catch{}
    });
    const textErrorStop=await waitClear();
    assert(textErrorStop<2500,'text socket error activity waited for safety timeout');
    await reopenA();
    await a.locator('#msgInput').fill('');
    console.log('PASS second client: text socket error clears server activity without safety timeout');

    const events=await b.evaluate(()=>window.__fp17721Events||[]);
    assert(events.some(event=>event.activity==='typing'&&event.typing===true),'second client never received typing start');
    assert(events.some(event=>event.typing===false),'second client never received an explicit/server stop update');

    assert.deepEqual(errors,[]);
    console.log('PASS second client activity stream contains starts and explicit/server stops');
    console.log('PASS no activity scenario waited for the 7–7.5s safety timeout');
    console.log('PASS no uncaught browser errors');
  } finally {
    await Promise.allSettled([
      a.unroute('**/media/upload'),
      a.unroute('**/voice/upload')
    ]);
    await a.evaluate(async()=>{
      try{window.FPVoice?.cancelRecording?.();}catch{}
      try{window.FPVoice?.clearPreview?.();}catch{}
      try{if(mediaPreviewState)await window.FPMediaSend170?.cancelPreview?.(mediaPreviewState);}catch{}
      if(window.__fp17721OriginalSend)WebSocket.prototype.send=window.__fp17721OriginalSend;
      delete window.__fp17721OriginalSend;
      for(const {audio,oscillator,stream} of window.testAudio17721||[]){
        try{stream.getTracks().forEach(track=>track.stop());}catch{}
        try{oscillator.stop();}catch{}
        try{await audio.close();}catch{}
      }
    }).catch(()=>{});
    await ctxA.close();
    await ctxB.close();
  }
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
