'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const voice=read('public/voice.js');
const manager=read('public/send-manager177.js');

const executorStart=voice.indexOf('  async function uploadAndSendVoice(data) {');
const executorEnd=voice.indexOf('\n  function dispatchReadyVoice177(data) {',executorStart);
assert(executorStart>=0&&executorEnd>executorStart,'existing ready-voice executor missing');
const executorBlock=voice.slice(executorStart,executorEnd);
assert(executorBlock.includes("contexts?.beginOperation?.(data.roomId, 'voice-send')"),'voice operation context changed');
assert(executorBlock.includes("fetch(\`/api/rooms/\${encodeURIComponent(data.roomId)}/voice/upload\`"),'voice upload source room changed');
assert(executorBlock.includes("roomId: data.roomId"),'final voice message source room changed');
assert(executorBlock.includes("startLocalActivity(data.roomId, 'audio')"),'voice send activity start changed');
assert(executorBlock.includes("stopLocalActivity('audio')"),'voice send activity stop changed');

const dispatchStart=voice.indexOf('  function dispatchReadyVoice177(data) {');
const dispatchEnd=voice.indexOf('\n  async function finalizeRecording(rec)',dispatchStart);
assert(dispatchStart>=0&&dispatchEnd>dispatchStart,'ready-voice dispatcher wrapper missing');
const dispatchBlock=voice.slice(dispatchStart,dispatchEnd);
assert(dispatchBlock.includes('const manager = window.FPSendManager177;'),'voice wrapper must resolve SendManager');
assert(dispatchBlock.includes('if (!manager?.dispatch) return false;'),'voice manager refusal must not fall back');
assert(dispatchBlock.includes('return manager.dispatch(() => uploadAndSendVoice(data));'),
  'dispatcher must receive exactly the existing ready-voice executor');
assert((dispatchBlock.match(/uploadAndSendVoice\(data\)/g)||[]).length===1,
  'voice wrapper must have exactly one executor call site');

const finalizeStart=voice.indexOf('  async function finalizeRecording(rec) {');
const finalizeEnd=voice.indexOf('\n  function showPreview(data)',finalizeStart);
const finalizeBlock=voice.slice(finalizeStart,finalizeEnd);
assert(finalizeBlock.includes('const sent = await dispatchReadyVoice177(data);'),
  'direct completed recording must use ready-voice dispatcher');
assert(!finalizeBlock.includes('await uploadAndSendVoice(data)'),
  'direct completed recording must not bypass dispatcher');
assert(finalizeBlock.includes('roomId: rec.roomId'),'prepared voice data must retain recording source room');
assert(finalizeBlock.includes('const blob = new Blob(rec.chunks'),'recording/blob preparation moved unexpectedly');
assert(finalizeBlock.includes('extractWaveformFromBlob(blob)'),'voice waveform preparation moved unexpectedly');

const previewStart=voice.indexOf('  async function sendPreview() {');
const previewEnd=voice.indexOf('\n  function handleVisibilityLoss()',previewStart);
const previewBlock=voice.slice(previewStart,previewEnd);
assert(previewBlock.includes('const sent = await dispatchReadyVoice177(preview);'),
  'preview send must use ready-voice dispatcher');
assert(!previewBlock.includes('await uploadAndSendVoice(preview)'),
  'preview send must not bypass dispatcher');
assert(manager.includes('return executor();'),'SendManager must remain stateless');

console.log('PASS only the ready-voice command is routed through SendManager');
console.log('PASS recording/blob/waveform preparation remains in the existing voice owner');
console.log('PASS upload/encryption/operation/activity remain inside uploadAndSendVoice');
console.log('PASS direct and preview send use one dispatcher adapter with no fallback');

run(async({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
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

  const rooms=await page.evaluate(async()=>{
    const ids=[],deviceId=getOrCreateDeviceId();
    for(const suffix of ['a','b']){
      const secret='177-voice-dispatch-'+suffix;
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
      ids.push(data.publicId);
    }
    return {ids,deviceId};
  });
  const [roomA,roomB]=rooms.ids;

  const open=async room=>{
    await page.evaluate(async roomId=>{showChatsList();await openChat(roomId);},room);
    await page.waitForSelector('#sendForm .fp-voice-record-btn',{state:'attached'});
  };

  await page.evaluate(()=>{
    window.testAudio17720 ||= [];
    navigator.mediaDevices.getUserMedia=async()=>{
      const audio=new AudioContext();
      const oscillator=audio.createOscillator();
      const destination=audio.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      void audio.resume();
      window.testAudio17720.push({audio,oscillator,stream:destination.stream});
      return destination.stream;
    };
    const original=window.FPSendManager177;
    window.__fp17720={dispatches:0,messages:[],manager:original,wsSend:WebSocket.prototype.send};
    window.FPSendManager177=Object.freeze({
      dispatch(executor){
        window.__fp17720.dispatches+=1;
        return original.dispatch(executor);
      }
    });
    WebSocket.prototype.send=function(payload){
      try{
        const parsed=JSON.parse(String(payload));
        if(parsed?.type==='message:new'&&parsed?.messageType==='media'){
          window.__fp17720.messages.push({
            roomId:String(parsed.roomId||''),
            mediaIds:[...(parsed.mediaIds||[])]
          });
        }
      }catch{}
      return window.__fp17720.wsSend.call(this,payload);
    };
  });

  const startVoice=async()=>{
    const mic=page.locator('.fp-voice-record-btn');
    const rect=await mic.boundingBox();
    assert(rect,'microphone missing before recording');
    const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    await page.mouse.move(x,y);
    await page.mouse.down();
    await page.waitForSelector('#sendForm.fp-voice-recording');
    return {x,y};
  };

  const voicePreview=async()=>{
    const {x,y}=await startVoice();
    await page.mouse.move(x,y-180,{steps:5});
    await page.mouse.up();
    await page.waitForSelector('#sendForm.fp-voice-locked');
    await page.waitForTimeout(850);
    await page.locator('.fp-voice-record-stop').click();
    await page.waitForSelector('#sendForm.fp-voice-previewing');
  };

  const readAudioMessages=async room=>page.evaluate(async roomId=>{
    const persisted=STORAGE.get(STORAGE.roomState(roomId));
    const response=await fetch(`/api/rooms/${roomId}/messages?deviceId=${encodeURIComponent(persisted.deviceId)}&limit=100`);
    if(!response.ok)throw new Error('messages '+response.status);
    const data=await response.json();
    return (data.messages||[]).filter(message=>
      message.type==='media' &&
      (message.media||[]).some(item=>String(item.media_kind||item.kind||'')==='audio')
    ).map(message=>({id:message.id,mediaCount:(message.media||[]).length}));
  },room);

  const waitForNewAudio=async(room,beforeIds)=>{
    for(let i=0;i<40;i++){
      const now=await readAudioMessages(room);
      const created=now.find(item=>!beforeIds.has(item.id));
      if(created)return created;
      await page.waitForTimeout(100);
    }
    return null;
  };

  try{
    // Direct send: release an unlocked recording. Gate upload, navigate A -> B, then finish.
    await open(roomA);
    const beforeDirect=new Set((await readAudioMessages(roomA)).map(item=>item.id));
    let releaseDirect,startedDirect;
    const directGate=new Promise(resolve=>{releaseDirect=resolve;});
    const directStarted=new Promise(resolve=>{startedDirect=resolve;});
    await page.route('**/voice/upload',async route=>{
      const response=await route.fetch();
      startedDirect();
      await directGate;
      await route.fulfill({response});
    });

    const {x,y}=await startVoice();
    await page.waitForTimeout(850);
    await page.mouse.move(x,y);
    await page.mouse.up();

    await Promise.race([
      directStarted,
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('direct voice upload not reached')),6000))
    ]);
    assert.equal(await page.evaluate(()=>window.__fp17720.dispatches),1,
      'direct ready voice must dispatch exactly once');

    await open(roomB);
    releaseDirect();
    const directCreated=await waitForNewAudio(roomA,beforeDirect);
    assert(directCreated,'direct voice message missing from source room A');
    assert.equal((await readAudioMessages(roomB)).length,0,
      'direct voice from A must not be saved in active room B');
    await page.unroute('**/voice/upload');

    // Preview send: prepared preview uses the same ready-voice dispatcher/executor.
    await open(roomA);
    await voicePreview();
    const beforePreview=new Set((await readAudioMessages(roomA)).map(item=>item.id));
    let releasePreview,startedPreview;
    const previewGate=new Promise(resolve=>{releasePreview=resolve;});
    const previewStarted=new Promise(resolve=>{startedPreview=resolve;});
    await page.route('**/voice/upload',async route=>{
      const response=await route.fetch();
      startedPreview();
      await previewGate;
      await route.fulfill({response});
    });

    await page.locator('.fp-voice-preview-send').click();
    await Promise.race([
      previewStarted,
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('preview voice upload not reached')),6000))
    ]);
    assert.equal(await page.evaluate(()=>window.__fp17720.dispatches),2,
      'preview ready voice must add exactly one dispatcher call');

    await open(roomB);
    releasePreview();
    const previewCreated=await waitForNewAudio(roomA,beforePreview);
    assert(previewCreated,'preview voice message missing from source room A');
    assert.equal((await readAudioMessages(roomB)).length,0,
      'preview voice from A must not be saved in active room B');
    await page.unroute('**/voice/upload');

    const outbound=await page.evaluate(()=>({
      dispatches:window.__fp17720.dispatches,
      messages:[...window.__fp17720.messages],
      activeRoom:state.roomId
    }));
    assert.equal(outbound.dispatches,2,'two ready-voice commands must produce exactly two dispatcher calls');
    assert.equal(outbound.messages.length,2,'direct and preview voice must each emit one final media message');
    assert(outbound.messages.every(item=>item.roomId===roomA),
      'all final voice messages must retain source room A');
    assert.equal(outbound.activeRoom,roomB,'voice completion must not navigate away from B');

    console.log('PASS direct ready voice dispatches once and completes in source room A after A -> B');
    console.log('PASS preview ready voice dispatches once through the same executor');
    console.log('PASS both final voice messages retain data.roomId and never land in room B');
  } finally {
    await page.evaluate(async()=>{
      if(window.__fp17720?.wsSend)WebSocket.prototype.send=window.__fp17720.wsSend;
      if(window.__fp17720?.manager)window.FPSendManager177=window.__fp17720.manager;
      try{window.FPVoice?.cancelRecording?.();}catch{}
      try{window.FPVoice?.clearPreview?.();}catch{}
      for(const {audio,oscillator,stream} of window.testAudio17720||[]){
        try{stream.getTracks().forEach(track=>track.stop());}catch{}
        try{oscillator.stop();}catch{}
        try{await audio.close();}catch{}
      }
      delete window.__fp17720;
    });
  }

  assert.deepEqual(errors,[]);
  console.log('PASS no uncaught browser errors');
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
