'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createEncryptedUpload179}=require('../src/encrypted-upload179');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const server=read('server.js');
const app=read('public/app.js');

const image={id:11,room_id:7,status:'pending',media_kind:'image',server_filename:'media_image.bin',thumbnail_filename:'thumb_image.bin'};
const video={id:12,room_id:7,status:'pending',media_kind:'video',server_filename:'media_video.bin',thumbnail_filename:null};
const foreign={id:13,room_id:8,status:'pending',media_kind:'image',server_filename:'foreign.bin',thumbnail_filename:'foreign-thumb.bin'};
const cleaned=[];
const owner=createEncryptedUpload179({mediaKind:'image',persist:value=>value,cleanup:media=>{cleaned.push(media);return media.id;}});
assert.equal(owner.handles({mediaKind:'image',media:image}),true);
assert.equal(owner.handles({mediaKind:'video',media:video}),false);
assert.equal(owner.cleanup({mediaKind:'image',media:image}),11);
assert.deepEqual(cleaned,[image]);

const sentinelError=new Error('unlink sentinel');
const failing=createEncryptedUpload179({mediaKind:'image',persist:value=>value,cleanup(){throw sentinelError;}});
let caught=null;try{failing.cleanup({mediaKind:'image',media:image});}catch(error){caught=error;}
assert.strictEqual(caught,sentinelError,'cleanup wrapper changed error identity');

assert(server.includes("function cleanupPendingMediaFiles179(media) {\n  safeUnlink(media?.server_filename);\n  safeUnlink(media?.thumbnail_filename);\n}"),'legacy file cleanup delegate changed');
assert(server.includes("mediaKind: 'image',\n  persist: persistEncryptedMedia179,\n  cleanup: cleanupPendingMediaFiles179"),'image cleanup owner not wired');

const route="app.delete('/api/rooms/:publicId/media/pending', (req, res) => {";
const routeAt=server.indexOf(route);
const routeEnd=server.indexOf("\n});\n\napp.delete('/api/rooms/:publicId'",routeAt);
assert(routeAt>=0&&routeEnd>routeAt,'pending cancel route missing');
const cancel=server.slice(routeAt,routeEnd);
assert(cancel.includes("const room = q.findRoomByPublicId.get(req.params.publicId);"),'room lookup changed');
assert(cancel.includes("if (!q.findParticipant.get(room.id, deviceId)) return res.status(403).json({ ok: false, error: 'forbidden' });"),'participant guard changed');
assert(cancel.includes("if (pending?.room_id === room.id && pending.status === 'pending') mediaIds.push(pending.id);"),'uploadId room/status guard changed');
assert(cancel.includes("q.listPendingMediaByIds.all(room.id, JSON.stringify(mediaIds))"),'room-scoped row read changed');
assert(cancel.includes("const cleanupInput = { mediaKind: media.media_kind, media };"),'cleanup input missing');
assert(cancel.includes("if (fpEncryptedImageUpload179.handles(cleanupInput)) fpEncryptedImageUpload179.cleanup(cleanupInput);"),'image cancel not wrapped');
assert(cancel.includes("else cleanupPendingMediaFiles179(media);"),'non-image cleanup path changed');
assert(cancel.includes("q.deletePendingMediaByIds.run(room.id, JSON.stringify(mediaIds));"),'single room-scoped batch delete changed');
assert.equal((cancel.match(/deletePendingMediaByIds\.run/g)||[]).length,1,'cancel introduced a second DB delete');
assert(cancel.indexOf('q.listPendingMediaByIds.all')<cancel.indexOf('fpEncryptedImageUpload179.cleanup'),'file cleanup occurs before room-scoped row read');
assert(cancel.indexOf('fpEncryptedImageUpload179.cleanup')<cancel.indexOf('q.deletePendingMediaByIds.run'),'DB delete moved before file cleanup');

const staleAt=server.indexOf('function cleanupStalePendingMedia() {');
const staleEnd=server.indexOf('\n}',staleAt)+2;
const stale=server.slice(staleAt,staleEnd);
assert(stale.includes('q.listStalePendingMedia.all()'),'stale selection changed');
assert(stale.includes('fpEncryptedImageUpload179.cleanup(cleanupInput)'),'stale image cleanup not wrapped');
assert(stale.includes('else cleanupPendingMediaFiles179(media);'),'stale non-image cleanup changed');
assert(stale.includes('q.deletePendingMediaById.run(media.id);'),'stale DB delete changed');

const uploadRoute="app.post('/api/rooms/:publicId/media/upload'";
const uploadAt=server.indexOf(uploadRoute);
const uploadEnd=server.indexOf("\n});\napp.get('/api/media/:publicId/blob'",uploadAt);
const upload=server.slice(uploadAt,uploadEnd);
assert(upload.includes('if (req.aborted || res.destroyed) return;'),'interrupted-before-commit guard changed');
assert(upload.indexOf('if (req.aborted || res.destroyed) return;')<upload.indexOf('const persistenceInput = {'),'interrupted guard moved after persistence');
assert(upload.includes('const previousUpload = q.findMediaByPublicId.get(publicId);'),'unknown-client-commit recovery lookup changed');
assert(upload.includes('return res.json({ ok: true, media: mediaToDto(previousUpload, req) });'),'unknown-client-commit retry response changed');

assert(app.includes("await fetch(`/api/rooms/${roomId}/media/pending`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId,mediaIds,uploadIds})}).catch(()=>{});"),'client pending cleanup route/payload changed');

// Model the existing route admission rules: foreign-room image never reaches owner cleanup.
const requestedUploadIds=['foreign-upload'];
const lookup={'foreign-upload':foreign};
const roomId=7;
const admitted=[];
for(const uploadId of requestedUploadIds){const pending=lookup[uploadId];if(pending?.room_id===roomId&&pending.status==='pending')admitted.push(pending.id);}
assert.deepEqual(admitted,[],'foreign-room pending media was admitted to cleanup');

console.log('PASS 179.7 encrypted image cancel/cleanup is wrapped without changing DB delete ownership');
console.log('PASS 179.7 interrupted-before-commit and unknown-client server commit recovery contracts remain');
console.log('PASS 179.7 explicit cancel remains participant-guarded and room-scoped; foreign-room media is not admitted');
console.log('PASS 179.7 video/non-image cleanup remains on the old cleanup delegate');
