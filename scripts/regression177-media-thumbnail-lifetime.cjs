'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const app=read('public/app.js');
const media=read('public/media-send170.js');
const voice=read('public/voice.js');

const managerStart=app.indexOf('class FPMediaManager177Class {');
const managerEnd=app.indexOf('\nconst FPMediaManager177 =',managerStart);
assert(managerStart>=0&&managerEnd>managerStart,'MediaManager177 class missing');
const manager=app.slice(managerStart,managerEnd);

assert(manager.includes('#previewThumbnailObjectUrls = new Set();'),'generated thumbnail registry missing');
assert(manager.includes('ownPreviewThumbnailObjectUrl(item)'),'generated thumbnail ownership entry missing');
assert(manager.includes('releasePreviewThumbnailObjectUrl(item)'),'generated thumbnail release entry missing');
assert(manager.includes('if (!url || url === item?.objectUrl) return false;'),
  'source/fallback alias must stay outside generated-thumbnail ownership');
assert(manager.includes('this.#previewThumbnailObjectUrls.delete(url);'),'thumbnail ownership must be released once');
assert(manager.includes('URL.revokeObjectURL(url);'),'MediaManager must perform generated thumbnail revoke');
assert(!manager.includes('URL.createObjectURL'),'MediaManager must not create thumbnail URLs');

assert(app.includes('FPMediaManager177.ownPreviewThumbnailObjectUrl(item);items.push(item);'),
  'existing preview worker must hand generated thumbnail cleanup ownership to MediaManager');
assert(app.includes('else FPMediaManager177.releasePreviewThumbnailObjectUrl(item);'),
  'stale preview preparation must release generated thumbnail through MediaManager');
assert(app.includes('if(item){FPMediaManager177.releasePreviewThumbnailObjectUrl(item);void deleteUploadedPendingMedia'),
  'item removal must release generated thumbnail through MediaManager after rerender');
assert(media.includes('window.FPMediaManager177?.releasePreviewThumbnailObjectUrl?.(item);'),
  'stale media-send preview release must delegate generated thumbnail cleanup');
assert(voice.includes('URL.revokeObjectURL(preview.url)'),
  'voice ObjectURL owner must remain unchanged');
assert(app.includes('async function loadViewerMedia(media,container)'),
  'existing media viewer path missing');
const viewerStart=app.indexOf('async function loadViewerMedia(media,container)');
const viewerEnd=app.indexOf('\n',viewerStart);
assert(!app.slice(viewerStart,viewerStart+1000).includes('FPMediaManager177'),
  'media viewer ObjectURL lifecycle must not be transferred in 177.24');

console.log('PASS only generated preview thumbnail ObjectURL cleanup is transferred');
console.log('PASS source preview, viewer and voice ObjectURL owners remain unchanged');
console.log('PASS stale preview/send cleanup uses the same thumbnail lifetime owner');

run(async({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(origin);
  await page.waitForFunction(() =>
    window.FPMediaManager177?.ownPreviewThumbnailObjectUrl &&
    typeof openMediaPreviewFromFiles==='function' &&
    typeof openChat==='function' &&
    !document.getElementById('bootHold152')
  );

  const fixture=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='17724-'+crypto.randomUUID().replaceAll('-','');
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
    return {roomId:data.publicId};
  });
  await page.evaluate(async room=>{showChatsList();await openChat(room);},fixture.roomId);
  await page.waitForSelector('#msgInput');

  await page.evaluate(()=>{
    window.__fp17724Revokes=[];
    window.__fp17724OriginalRevoke=URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL=function(url){
      const live=[...document.querySelectorAll('#mediaPreviewRoot img')].some(img=>img.isConnected&&img.src===url);
      window.__fp17724Revokes.push({url:String(url),live});
      return window.__fp17724OriginalRevoke(url);
    };
  });

  const makeFiles=async names=>page.evaluate(async names=>{
    const files=[];
    for(let i=0;i<names.length;i++){
      const canvas=document.createElement('canvas');
      canvas.width=8;canvas.height=8;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle=i%2?'#fff':'#000';
      ctx.fillRect(0,0,8,8);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      files.push(new File([blob],names[i],{type:'image/png'}));
    }
    const preview=await openMediaPreviewFromFiles(files);
    return preview.items.map(item=>({
      name:item.file.name,
      objectUrl:item.objectUrl,
      thumbnailObjectUrl:item.thumbnailObjectUrl,
      distinct:item.thumbnailObjectUrl!==item.objectUrl
    }));
  },names);

  try{
    const items=await makeFiles(['first.png','second.png']);
    assert.equal(items.length,2);
    assert(items.every(item=>item.distinct),'image preview must use generated thumbnail URLs in this scenario');

    const liveBefore=await page.evaluate(async urls=>{
      const result=[];
      for(const url of urls){
        const response=await fetch(url);
        result.push({url,status:response.status,size:(await response.blob()).size});
      }
      return result;
    },items.map(item=>item.thumbnailObjectUrl));
    assert(liveBefore.every(x=>x.status===200&&x.size>0),'live preview thumbnails must remain readable');

    const preRevokes=await page.evaluate(()=>window.__fp17724Revokes);
    assert(!preRevokes.some(e=>items.some(item=>item.thumbnailObjectUrl===e.url)),
      'generated thumbnail must not be revoked while preview is live');

    // Remove first item. renderMediaPreviewModal() runs before owner releases its generated thumbnail.
    await page.locator('[data-remove="0"]').click();
    await page.waitForFunction(()=>mediaPreviewState?.items?.length===1);
    const afterRemove=await page.evaluate(()=>({
      names:mediaPreviewState.items.map(item=>item.file.name),
      visible:[...document.querySelectorAll('#mediaPreviewRoot img')].map(img=>img.src),
      revokes:[...window.__fp17724Revokes]
    }));
    assert.deepEqual(afterRemove.names,['second.png'],'remaining preview order changed');
    const firstRevoke=afterRemove.revokes.find(e=>e.url===items[0].thumbnailObjectUrl);
    assert(firstRevoke,'removed thumbnail was not released');
    assert.equal(firstRevoke.live,false,'removed thumbnail was revoked before its last DOM consumer disappeared');
    assert(!afterRemove.revokes.some(e=>e.url===items[1].thumbnailObjectUrl),
      'remaining live thumbnail must not be revoked');
    assert(afterRemove.visible.includes(items[1].thumbnailObjectUrl),
      'remaining live preview lost its thumbnail');

    const remainingRead=await page.evaluate(async url=>{
      const response=await fetch(url);
      return {status:response.status,size:(await response.blob()).size};
    },items[1].thumbnailObjectUrl);
    assert.equal(remainingRead.status,200);
    assert(remainingRead.size>0);

    // Keep an unrelated viewer/player-style Blob URL alive; preview cleanup must not touch it.
    const unrelated=await page.evaluate(()=>{
      const url=URL.createObjectURL(new Blob([new Uint8Array([9,8,7,6])],{type:'image/png'}));
      const root=document.getElementById('mediaViewerRoot')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'mediaViewerRoot'}));
      root.innerHTML=`<img id="fp17724ViewerProbe" src="${url}">`;
      return url;
    });

    await page.evaluate(()=>closeMediaPreviewModal(mediaPreviewState));
    await page.waitForFunction(()=>mediaPreviewState===null&&!document.querySelector('#mediaPreviewRoot .media-preview-overlay'));

    const finalState=await page.evaluate(async({remaining,unrelated})=>{
      const revokes=[...window.__fp17724Revokes];
      let viewerReadable=false;
      try{
        const response=await fetch(unrelated);
        viewerReadable=response.ok&&(await response.blob()).size>0;
      }catch{}
      return {
        remainingRevoke:revokes.find(e=>e.url===remaining)||null,
        unrelatedRevoked:revokes.some(e=>e.url===unrelated),
        viewerConnected:Boolean(document.getElementById('fp17724ViewerProbe')?.isConnected),
        viewerReadable
      };
    },{remaining:items[1].thumbnailObjectUrl,unrelated});
    assert(finalState.remainingRevoke,'close must release remaining generated thumbnail');
    assert.equal(finalState.remainingRevoke.live,false,
      'close must unmount the last thumbnail consumer before revoke');
    assert.equal(finalState.unrelatedRevoked,false,'preview owner must not revoke viewer/unrelated ObjectURL');
    assert.equal(finalState.viewerConnected,true);
    assert.equal(finalState.viewerReadable,true,'live viewer/player-style consumer lost unrelated Blob URL');

    console.log('PASS live preview keeps generated thumbnail ObjectURLs readable');
    console.log('PASS removed item thumbnail is revoked only after its last DOM consumer is gone');
    console.log('PASS remaining preview thumbnail survives until full preview close');
    console.log('PASS full close unmounts before releasing the final generated thumbnail');
    console.log('PASS unrelated live viewer/player-style ObjectURL is not touched');

    await page.evaluate(url=>{
      try{window.__fp17724OriginalRevoke(url);}catch{}
      document.getElementById('mediaViewerRoot')?.replaceChildren();
    },unrelated);
  } finally {
    await page.evaluate(()=>{
      if(window.__fp17724OriginalRevoke)URL.revokeObjectURL=window.__fp17724OriginalRevoke;
      delete window.__fp17724OriginalRevoke;
      delete window.__fp17724Revokes;
    }).catch(()=>{});
  }

  assert.deepEqual(errors,[]);
  console.log('PASS no uncaught browser errors');
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
