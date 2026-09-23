'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const app=read('public/app.js');
const voice=read('public/voice.js');
const dom=read('public/dom-lifecycle173.js');

const managerStart=app.indexOf('class FPMediaManager177Class {');
const managerEnd=app.indexOf('\nconst FPMediaManager177 =',managerStart);
assert(managerStart>=0&&managerEnd>managerStart,'MediaManager177 class missing');
const manager=app.slice(managerStart,managerEnd);

assert(manager.includes('#voiceUiByForm = new WeakMap();'),'voice UI per-form registry missing');
assert(manager.includes('mountVoiceUI(form, mountWorker)'),'voice UI mount delegation missing');
assert(manager.includes('unmountVoiceUI(form, unmountWorker)'),'voice UI unmount delegation missing');
assert(manager.includes('isVoiceUiMounted(form)'),'voice UI mounted identity query missing');
for(const forbidden of [
  'MediaRecorder','getUserMedia','beginPressRecording','stopRecording','clearPreview',
  'sendPreview','togglePreviewPlayback','recordingState','previewState','uploadInFlight'
]){
  assert(!manager.includes(forbidden),'MediaManager took voice implementation ownership: '+forbidden);
}

assert(!voice.includes('boundComposers'),'old independent composer mount guard must be removed');
assert(voice.includes('function mountComposerVoiceUi177(form)'),'existing voice UI mount worker missing');
assert(voice.includes('return manager.mountVoiceUI(form, mountComposerVoiceUi177);'),
  'ensureComposer must delegate mount to MediaManager');
assert(voice.includes('return manager.unmountVoiceUI(form, unmountComposerVoiceUi177);'),
  'voice UI unmount must delegate to MediaManager');
assert(voice.includes("window.FPDOM173.on('composer', 'mounted', ({ node }) => ensureComposer(node));"),
  'voice UI must use existing FPDOM173 composer mount event');
assert(voice.includes("window.FPDOM173.on('composer', 'unmounted', ({ node }) => unmountComposer(node));"),
  'voice UI must use existing FPDOM173 composer unmount event');
assert(dom.includes("composer: '#sendForm'"),'FPDOM173 composer lifecycle contract changed');

const mountStart=voice.indexOf('  function mountComposerVoiceUi177(form) {');
const unmountStart=voice.indexOf('\n  function unmountComposerVoiceUi177(',mountStart);
assert(mountStart>=0&&unmountStart>mountStart,'voice mount worker boundary missing');
const mount=voice.slice(mountStart,unmountStart);

for(const required of [
  "mic.addEventListener('pointerdown'",
  'void beginPressRecording(event, form, mic);',
  "stopRecording('cancel');",
  "stopRecording('preview');",
  "stopRecording('send');",
  'void togglePreviewPlayback();',
  'clearPreview(true);',
  'void sendPreview();',
  'cyclePlaybackSpeed();',
  'bindWaveformSeek('
]){
  assert(mount.includes(required),'existing voice handler missing from voice.js mount worker: '+required);
}
assert(!manager.includes("addEventListener('pointerdown'"),'MediaManager must not bind voice press');
assert(voice.includes('recorder = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 }) : new MediaRecorder(stream);'),
  'MediaRecorder construction path changed');

console.log('PASS MediaManager177 owns only exact-form voice UI mount/unmount delegation');
console.log('PASS press/lock/stop/preview/cancel handlers remain implemented in voice.js');
console.log('PASS MediaRecorder/recording/upload state remains outside MediaManager');
console.log('PASS existing FPDOM173 owns composer lifecycle events; no new observer is introduced');

run(async({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(origin);
  await page.waitForFunction(() =>
    window.FPMediaManager177?.mountVoiceUI &&
    window.FPVoice &&
    window.FPDOM173 &&
    typeof openChat==='function' &&
    !document.getElementById('bootHold152')
  );

  const fixture=await page.evaluate(async()=>{
    const ids=[],deviceId=getOrCreateDeviceId();
    for(const suffix of ['a','b']){
      const secret='17725-'+suffix+'-'+crypto.randomUUID().replaceAll('-','');
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
    return {ids};
  });
  const [roomA,roomB]=fixture.ids;

  await page.evaluate(()=>{
    window.__fp17725RecorderCount=0;
    window.__fp17725NativeMediaRecorder=window.MediaRecorder;
    const Native=window.MediaRecorder;
    function CountingMediaRecorder(...args){
      window.__fp17725RecorderCount+=1;
      return new Native(...args);
    }
    CountingMediaRecorder.isTypeSupported=(...args)=>Native.isTypeSupported(...args);
    window.MediaRecorder=CountingMediaRecorder;

    window.testAudio17725 ||= [];
    navigator.mediaDevices.getUserMedia=async()=>{
      const audio=new AudioContext();
      const oscillator=audio.createOscillator();
      const destination=audio.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      void audio.resume();
      window.testAudio17725.push({audio,oscillator,stream:destination.stream});
      return destination.stream;
    };
  });

  const openRoom=async room=>{
    await page.evaluate(async roomId=>{showChatsList();await openChat(roomId);},room);
    await page.waitForSelector('#sendForm .fp-voice-record-btn');
    await page.waitForFunction(roomId=>{
      const form=document.getElementById('sendForm');
      return state.roomId===roomId &&
        Boolean(form) &&
        window.FPMediaManager177.isVoiceUiMounted(form) &&
        form.querySelectorAll('.fp-voice-record-btn').length===1 &&
        form.querySelectorAll('.fp-voice-recording-bar').length===1 &&
        form.querySelectorAll('.fp-voice-preview-bar').length===1;
    },room);
  };

  try{
    await openRoom(roomA);
    await page.evaluate(()=>{window.__fp17725OldForm=document.getElementById('sendForm');});

    const initialCounts=await page.evaluate(()=>({
      mic:document.querySelectorAll('#sendForm .fp-voice-record-btn').length,
      recording:document.querySelectorAll('#sendForm .fp-voice-recording-bar').length,
      preview:document.querySelectorAll('#sendForm .fp-voice-preview-bar').length,
      mounted:window.FPMediaManager177.isVoiceUiMounted(document.getElementById('sendForm'))
    }));
    assert.deepEqual(initialCounts,{mic:1,recording:1,preview:1,mounted:true});

    // Existing press -> lock -> stop -> preview -> cancel handlers, one recorder session.
    const mic=page.locator('#sendForm .fp-voice-record-btn');
    const rect=await mic.boundingBox();
    assert(rect,'voice mic missing');
    const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    await page.mouse.move(x,y);
    await page.mouse.down();
    await page.waitForSelector('#sendForm.fp-voice-recording');
    assert.equal(await page.evaluate(()=>window.__fp17725RecorderCount),1,
      'one press session must construct exactly one MediaRecorder');

    await page.mouse.move(x,y-180,{steps:6});
    await page.waitForSelector('#sendForm.fp-voice-locked');
    await page.mouse.up();
    assert.equal(await page.evaluate(()=>window.__fp17725RecorderCount),1,
      'locking must not construct another MediaRecorder');

    await page.waitForTimeout(850);
    await page.locator('#sendForm .fp-voice-record-stop').click();
    await page.waitForSelector('#sendForm.fp-voice-previewing');
    assert.equal(await page.evaluate(()=>window.__fp17725RecorderCount),1,
      'stop/preview must retain the same MediaRecorder session');

    const previewVisible=await page.evaluate(()=>({
      previewing:document.getElementById('sendForm')?.classList.contains('fp-voice-previewing')===true,
      deleteVisible:Boolean(document.querySelector('#sendForm .fp-voice-preview-delete')),
      sendVisible:Boolean(document.querySelector('#sendForm .fp-voice-preview-send'))
    }));
    assert.deepEqual(previewVisible,{previewing:true,deleteVisible:true,sendVisible:true});

    await page.locator('#sendForm .fp-voice-preview-delete').click();
    await page.waitForFunction(()=>!document.getElementById('sendForm')?.classList.contains('fp-voice-previewing'));
    assert.equal(await page.evaluate(()=>window.__fp17725RecorderCount),1,
      'preview cancel must not construct another MediaRecorder');
    console.log('PASS press -> lock -> stop -> preview -> cancel uses one MediaRecorder and existing handlers');

    // Existing DOM lifecycle unmounts A, then B gets exactly one fresh UI set.
    await page.evaluate(()=>showChatsList());
    await page.waitForFunction(()=>!document.getElementById('sendForm'));
    await page.waitForFunction(()=>!window.FPMediaManager177.isVoiceUiMounted(window.__fp17725OldForm));
    const oldAfterUnmount=await page.evaluate(()=>({
      mounted:window.FPMediaManager177.isVoiceUiMounted(window.__fp17725OldForm),
      mic:window.__fp17725OldForm.querySelectorAll('.fp-voice-record-btn').length,
      recording:window.__fp17725OldForm.querySelectorAll('.fp-voice-recording-bar').length,
      preview:window.__fp17725OldForm.querySelectorAll('.fp-voice-preview-bar').length
    }));
    assert.deepEqual(oldAfterUnmount,{mounted:false,mic:0,recording:0,preview:0},
      'voice UI unmount worker must release only the old form UI');

    await openRoom(roomB);
    const bState=await page.evaluate(()=>({
      activeRoom:state.roomId,
      mounted:window.FPMediaManager177.isVoiceUiMounted(document.getElementById('sendForm')),
      mic:document.querySelectorAll('#sendForm .fp-voice-record-btn').length,
      recording:document.querySelectorAll('#sendForm .fp-voice-recording-bar').length,
      preview:document.querySelectorAll('#sendForm .fp-voice-preview-bar').length,
      recorderCount:window.__fp17725RecorderCount
    }));
    assert.equal(bState.activeRoom,roomB);
    assert.deepEqual(
      {mounted:bState.mounted,mic:bState.mic,recording:bState.recording,preview:bState.preview},
      {mounted:true,mic:1,recording:1,preview:1}
    );
    assert.equal(bState.recorderCount,1,'mounting room B must not create MediaRecorder');

    // A stale lifecycle event cannot affect B because manager keys exact form identity.
    const stale=await page.evaluate(()=>{
      let called=false;
      const result=window.FPMediaManager177.unmountVoiceUI(window.__fp17725OldForm,()=>{called=true;return true;});
      const current=document.getElementById('sendForm');
      return {
        result,called,
        bMounted:window.FPMediaManager177.isVoiceUiMounted(current),
        bMic:current.querySelectorAll('.fp-voice-record-btn').length
      };
    });
    assert.deepEqual(stale,{result:false,called:false,bMounted:true,bMic:1});
    console.log('PASS composer unmount removes only old voice UI; room B mounts one independent UI set');
    console.log('PASS stale A unmount cannot remove room B voice UI');

    assert.deepEqual(errors,[]);
    console.log('PASS no uncaught browser errors');
  } finally {
    await page.evaluate(async()=>{
      try{window.FPVoice?.cancelRecording?.();}catch{}
      try{window.FPVoice?.clearPreview?.();}catch{}
      if(window.__fp17725NativeMediaRecorder)window.MediaRecorder=window.__fp17725NativeMediaRecorder;
      delete window.__fp17725NativeMediaRecorder;
      delete window.__fp17725RecorderCount;
      delete window.__fp17725OldForm;
      for(const {audio,oscillator,stream} of window.testAudio17725||[]){
        try{stream.getTracks().forEach(track=>track.stop());}catch{}
        try{oscillator.stop();}catch{}
        try{await audio.close();}catch{}
      }
    }).catch(()=>{});
  }
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
