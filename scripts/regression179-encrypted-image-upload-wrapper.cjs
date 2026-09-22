'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createEncryptedUpload179}=require('../src/encrypted-upload179');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const server=read('server.js');
const app=read('public/app.js');
const network=read('public/network171.js');

const fileBuffer=Buffer.from([0,1,2,3,254,255]);
const thumbBuffer=Buffer.from([11,12,13]);
const input={mediaKind:'image',publicId:'0123456789abcdef0123456789abcdef',encryptedFile:{buffer:fileBuffer,size:fileBuffer.length},encryptedThumb:{buffer:thumbBuffer,size:thumbBuffer.length}};
let seen=null;
const sentinel={ok:true};
const owner=createEncryptedUpload179({mediaKind:'image',persist(value){seen=value;return sentinel;}});
assert.equal(owner.handles(input),true);
assert.equal(owner.handles({...input,mediaKind:'video'}),false);
assert.strictEqual(owner.save(input),sentinel);
assert.strictEqual(seen,input);
assert.strictEqual(seen.encryptedFile.buffer,fileBuffer);
assert.strictEqual(seen.encryptedThumb.buffer,thumbBuffer);

const sentinelError=new Error('storage sentinel');
const failing=createEncryptedUpload179({mediaKind:'image',persist(){throw sentinelError;}});
let caught=null;try{failing.save(input);}catch(error){caught=error;}
assert.strictEqual(caught,sentinelError,'wrapper changed persistence error identity');

const promised=Promise.resolve(sentinel);
const asyncOwner=createEncryptedUpload179({mediaKind:'image',persist(){return promised;}});
assert.strictEqual(asyncOwner.save(input),promised,'wrapper changed delegate promise identity');

const route="app.post('/api/rooms/:publicId/media/upload', upload.fields([{ name: 'encryptedFile', maxCount: 1 }, { name: 'encryptedThumbnail', maxCount: 1 }]), (req, res) => {";
assert(server.includes(route),'route/multipart signature changed');
assert(server.includes("mediaKind: 'image',\n  persist: persistEncryptedMedia179"),'image wrapper owner missing');
assert(server.includes("const media = fpEncryptedImageUpload179.handles(persistenceInput)\n    ? fpEncryptedImageUpload179.save(persistenceInput)\n    : persistEncryptedMedia179(persistenceInput);"),'image-only delegation changed');

const hs=server.indexOf('function persistEncryptedMedia179({');
const he=server.indexOf('\n}\n\nconst fpEncryptedImageUpload179',hs)+2;
assert(hs>=0&&he>hs,'persist delegate missing');
const helper=server.slice(hs,he);
assert(helper.includes('const serverFilename = `media_${publicId}.bin`;'),'file naming changed');
assert(helper.includes('const thumbFilename = encryptedThumb ? `thumb_${publicId}.bin` : null;'),'thumb naming changed');
assert(helper.includes('fs.writeFileSync(path.join(UPLOAD_DIR, serverFilename), encryptedFile.buffer);'),'file bytes write changed');
assert(helper.includes('if (encryptedThumb) fs.writeFileSync(path.join(UPLOAD_DIR, thumbFilename), encryptedThumb.buffer);'),'thumb bytes write changed');
assert(helper.includes('return q.findMediaByPublicId.get(publicId);'),'post-commit lookup changed');

const createOrder=[
 'publicId,','room.id,','Number(req.body?.fileOrder || 0),','serverFilename,','thumbFilename,',
 'req.body?.originalNameCiphertext || null,','req.body?.originalNameIv || null,','mimeType,','mediaKind,','sizeBytes,',
 'Number(req.body?.encryptedSizeBytes || encryptedFile.size),','Number(req.body?.thumbSizeBytes || 0) || null,',
 'Number(req.body?.thumbEncryptedSizeBytes || 0) || null,','Number(req.body?.width || 0) || null,',
 'Number(req.body?.height || 0) || null,','Number(req.body?.durationSeconds || 0) || null'
];
let pos=-1;for(const token of createOrder){const at=helper.indexOf(token,pos+1);assert(at>pos,'DB payload/order changed at '+token);pos=at;}

const routeAt=server.indexOf(route);
const duplicateAt=server.indexOf('const previousUpload = q.findMediaByPublicId.get(publicId);',routeAt);
const abortAt=server.indexOf('if (req.aborted || res.destroyed) return;',routeAt);
const persistAt=server.indexOf('const persistenceInput = {',routeAt);
const responseAt=server.indexOf('return res.json({ ok: true, media: mediaToDto(media, req) });',routeAt);
assert(routeAt>=0&&duplicateAt>routeAt&&abortAt>duplicateAt&&persistAt>abortAt&&responseAt>persistAt,'route order changed');
assert(server.includes('return res.json({ ok: true, media: mediaToDto(previousUpload, req) });'),'duplicate-upload response changed');

for(const field of [
 "fd.append('deviceId',persisted.deviceId)",
 "fd.append('encryptedFile',encryptedFile,'file.bin')",
 "fd.append('encryptedThumbnail',encryptedThumb,'thumb.bin')",
 "fd.append('originalNameCiphertext',nameEnc.ciphertext)",
 "fd.append('originalNameIv',nameEnc.iv)",
 "fd.append('mimeType',item.file.type)",
 "fd.append('mediaKind',item.kind)",
 "fd.append('sizeBytes',String(item.file.size))",
 "fd.append('encryptedSizeBytes',String(encryptedFile.size))",
 "fd.append('thumbSizeBytes',String(item.thumbnailBlob.size))",
 "fd.append('thumbEncryptedSizeBytes',String(encryptedThumb.size))",
 "fd.append('width',String(item.width||0))",
 "fd.append('height',String(item.height||0))",
 "fd.append('durationSeconds',String(item.durationSeconds||0))",
 "fd.append('fileOrder',String(i))"
]) assert(app.includes(field),'client payload changed: '+field);

assert(app.includes('FPNetwork171.upload({url:`/api/rooms/${roomId}/media/upload`,body:formData,signal,onProgress})'),'client route/body/progress delegation changed');
assert(network.includes("xhr.upload.addEventListener('progress', (event) => {"),'XHR progress listener changed');
assert(network.includes('onProgress(event.loaded, event.total, event.lengthComputable, event);'),'progress callback arguments changed');

console.log('PASS 179.6 image persistence wrapper is pass-through; video uses old delegate directly');
console.log('PASS 179.6 encrypted bytes, filenames, DB payload/order, errors and response contract are unchanged');
console.log('PASS 179.6 route, FormData payload and XHR progress contract are unchanged');
