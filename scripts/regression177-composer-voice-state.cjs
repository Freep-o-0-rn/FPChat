'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./browser-harness174.cjs');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const voiceSource = fs.readFileSync(path.join(root, 'public/voice.js'), 'utf8');
const typingSource = fs.readFileSync(path.join(root, 'public/typing.js'), 'utf8');

const syncStart=voiceSource.indexOf('  function syncComposer(form) {');
const syncEnd=voiceSource.indexOf('\n\n  function ensureComposer()',syncStart);
assert(syncStart>=0&&syncEnd>syncStart,'FPVoice syncComposer missing');
const syncBlock=voiceSource.slice(syncStart,syncEnd);
assert(syncBlock.includes('Boolean(recordingState || uploadInFlight || previewState)'),
  'voice busy state must include recording/upload/preview');
for(const forbidden of ['stopRecording(', 'clearPreview(', 'uploadAndSendVoice(', 'dispatchEvent(']){
  assert(!syncBlock.includes(forbidden),'syncComposer must not mutate active voice state: '+forbidden);
}

const composerStart=appSource.indexOf('const FPComposer177=Object.freeze({');
const composerEnd=appSource.indexOf('window.FPComposer177=FPComposer177;',composerStart);
const composerBlock=appSource.slice(composerStart,composerEnd);
const uiStart=composerBlock.indexOf('  syncUI(');
const uiEnd=composerBlock.indexOf('\n  },',uiStart);
const uiBlock=composerBlock.slice(uiStart,uiEnd);
assert(uiBlock.includes('return window.FPVoice?.syncComposer?.(form);'),
  'FPComposer177 syncUI must remain a thin FPVoice delegate');
assert(!uiBlock.includes('dispatchEvent('),'UI sync must not synthesize input');

const typingInputStart=typingSource.indexOf("  document.addEventListener('input'");
const typingInputEnd=typingSource.indexOf("  document.addEventListener('submit'",typingInputStart);
assert(typingInputStart>=0&&typingInputEnd>typingInputStart,'typing input listener missing');
const typingInputBlock=typingSource.slice(typingInputStart,typingInputEnd);
assert(typingInputBlock.includes('!event.isTrusted'),
  'typing owner must ignore synthetic input events');
assert(typingInputBlock.includes('pulseLocalTyping(event.target);'),
  'real input must retain existing typing path');

console.log('PASS syncComposer reads busy voice state without stop/clear/send side effects');
console.log('PASS FPComposer177 UI sync does not synthesize input');
console.log('PASS typing owner ignores synthetic input while retaining real input path');

run(async ({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(origin);
  await page.waitForFunction(() =>
    window.FPComposer177?.syncUI &&
    window.FPVoice?.syncComposer &&
    typeof openChat === 'function' &&
    !document.getElementById('bootHold152')
  );

  const room=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='177-voice-state';
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
    return data.publicId;
  });

  await page.evaluate(async roomId=>{showChatsList();await openChat(roomId);},room);
  await page.waitForSelector('#sendForm .fp-voice-record-btn');

  await page.evaluate(()=>{
    window.__fp17715Signals=[];
    window.__fp17715OriginalWsSend=WebSocket.prototype.send;
    WebSocket.prototype.send=function(payload){
      try{
        const parsed=JSON.parse(String(payload));
        if(parsed?.type==='typing:start'&&parsed?.activity==='typing'){
          window.__fp17715Signals.push({type:parsed.type,activity:parsed.activity,roomId:parsed.roomId});
        }
      }catch{}
      return window.__fp17715OriginalWsSend.call(this,payload);
    };
  });

  try {
    await page.evaluate(()=>{
      const input=document.getElementById('msgInput');
      input.value='synthetic restore';
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>window.__fp17715Signals.length),0,
      'synthetic input must not generate typing:start');

    await page.evaluate(()=>{
      const input=document.getElementById('msgInput');
      input.value='';
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });

    const input=page.locator('#msgInput');
    await input.focus();
    await page.keyboard.type('r');
    await page.waitForFunction(()=>window.__fp17715Signals.length>0);
    assert.equal(await page.evaluate(()=>window.__fp17715Signals.length),1,
      'real keyboard input must retain typing:start');

    await input.fill('');
    await page.waitForFunction(()=>document.getElementById('sendForm')?.classList.contains('fp-voice-mic-mode')===true);

    await page.evaluate(()=>{
      window.testAudio17715 ||= [];
      navigator.mediaDevices.getUserMedia=async()=>{
        const audio=new AudioContext();
        const oscillator=audio.createOscillator();
        const destination=audio.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        void audio.resume();
        window.testAudio17715.push({audio,oscillator,stream:destination.stream});
        return destination.stream;
      };
    });

    const syncMany=async(count=20)=>{
      await page.evaluate(n=>{
        const form=document.getElementById('sendForm');
        for(let i=0;i<n;i++)window.FPComposer177.syncUI(form);
      },count);
    };

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
      await syncMany();
      const active=await page.evaluate(()=>({
        recording:document.getElementById('sendForm')?.classList.contains('fp-voice-recording')===true,
        micDisabled:document.querySelector('.fp-voice-record-btn')?.disabled,
        micMode:document.getElementById('sendForm')?.classList.contains('fp-voice-mic-mode')===true
      }));
      assert.deepEqual(active,{recording:true,micDisabled:true,micMode:false},
        'UI sync must not stop active recording');

      await page.mouse.move(x,y-180,{steps:5});
      await page.mouse.up();
      await page.waitForSelector('#sendForm.fp-voice-locked');
      await page.waitForTimeout(850);
      await page.locator('.fp-voice-record-stop').click();
      await page.waitForSelector('#sendForm.fp-voice-previewing');
      await syncMany();

      const preview=await page.evaluate(()=>({
        previewing:document.getElementById('sendForm')?.classList.contains('fp-voice-previewing')===true,
        barHidden:document.querySelector('.fp-voice-preview-bar')?.classList.contains('hidden')===true,
        micDisabled:document.querySelector('.fp-voice-record-btn')?.disabled,
        micMode:document.getElementById('sendForm')?.classList.contains('fp-voice-mic-mode')===true
      }));
      assert.deepEqual(preview,{previewing:true,barHidden:false,micDisabled:true,micMode:false},
        'UI sync must not clear active preview');
    };

    await startVoice();
    await syncMany(30);
    assert.equal(await page.locator('#sendForm').evaluate(el=>el.classList.contains('fp-voice-recording')),true,
      'recording must survive repeated syncUI');
    await page.evaluate(()=>window.FPVoice.cancelRecording());
    await page.mouse.up();
    await page.waitForFunction(()=>!document.getElementById('sendForm')?.classList.contains('fp-voice-recording'));

    await voicePreview();
    await syncMany(30);
    assert.equal(await page.locator('#sendForm').evaluate(el=>el.classList.contains('fp-voice-previewing')),true,
      'preview must survive repeated syncUI');
    await page.evaluate(()=>window.FPVoice.clearPreview());
    await page.waitForFunction(()=>!document.getElementById('sendForm')?.classList.contains('fp-voice-previewing'));

    await voicePreview();
    let releaseUpload, markUploadStarted;
    const uploadGate=new Promise(resolve=>{releaseUpload=resolve;});
    const uploadStarted=new Promise(resolve=>{markUploadStarted=resolve;});
    await page.route('**/voice/upload',async route=>{
      const response=await route.fetch();
      markUploadStarted();
      await uploadGate;
      await route.fulfill({response});
    });

    try{
      await page.locator('.fp-voice-preview-send').click();
      await Promise.race([
        uploadStarted,
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('voice upload not reached')),5000))
      ]);
      await syncMany(40);

      const sending=await page.evaluate(()=>({
        previewing:document.getElementById('sendForm')?.classList.contains('fp-voice-previewing')===true,
        sending:document.getElementById('sendForm')?.classList.contains('fp-voice-preview-sending')===true,
        micDisabled:document.querySelector('.fp-voice-record-btn')?.disabled,
        micMode:document.getElementById('sendForm')?.classList.contains('fp-voice-mic-mode')===true
      }));
      assert.deepEqual(sending,{previewing:true,sending:true,micDisabled:true,micMode:false},
        'UI sync must not stop preview upload');

      releaseUpload();
      await page.waitForFunction(() =>
        !document.getElementById('sendForm')?.classList.contains('fp-voice-preview-sending') &&
        !document.getElementById('sendForm')?.classList.contains('fp-voice-previewing'),
        null,{timeout:6000}
      );
      await page.waitForFunction(()=>document.querySelector('.fp-voice-record-btn')?.disabled===false);
    } finally {
      releaseUpload();
      await page.unroute('**/voice/upload');
      await page.evaluate(()=>window.FPVoice.clearPreview());
    }

    assert.equal(await page.evaluate(()=>window.__fp17715Signals.length),1,
      'voice UI sync must not create extra text typing signals');

    console.log('PASS synthetic input does not emit typing while real keyboard input still does');
    console.log('PASS repeated UI sync does not stop active recording');
    console.log('PASS repeated UI sync does not clear voice preview');
    console.log('PASS repeated UI sync does not stop preview upload');
    console.log('PASS voice sync produces no artificial text typing');
  } finally {
    await page.evaluate(async()=>{
      if(window.__fp17715OriginalWsSend){
        WebSocket.prototype.send=window.__fp17715OriginalWsSend;
        delete window.__fp17715OriginalWsSend;
      }
      for(const {audio,oscillator,stream} of window.testAudio17715||[]){
        try{stream.getTracks().forEach(track=>track.stop());}catch{}
        try{oscillator.stop();}catch{}
        try{await audio.close();}catch{}
      }
    });
  }

  assert.deepEqual(errors,[]);
  console.log('PASS no uncaught browser errors');
}).catch(error=>{
  console.error(error?.stack||error);
  process.exitCode=1;
});
