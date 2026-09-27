'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');

const gallery = read('public/media-gallery134.js');
const galleryCss = read('public/media-gallery134.css');
const app = read('public/app.js');
const styles = read('public/styles.css');
const mediaSend = read('public/media-send170.js');
const network = read('public/network171.js');
const server = read('server.js');
const docs = read('docs/Build190_MediaSwipePreview.md');

assert.match(gallery,/const deferredClaim = Boolean\(event\.target\?\.closest\?\.\('video,\.fp-gallery134-video-gesture190'\)\)/,
  'video and its picture gesture surface must use deferred claim');
assert.match(gallery,/function claimGesture190\(g\)/,'Build 190 claim helper missing');
assert.match(gallery,/if \(!claimGesture190\(g\)\) return;/,'axis-locked drag must claim through FPGesture135');
assert.match(gallery,/if \(!g\.deferredClaim\) \{[\s\S]*?setPointerCapture\(pointerId\)/,
  'deferred video drag must avoid pointer capture while photo gestures retain it');
assert.match(gallery,/arbiter\.watchAction\('viewer:interaction'/,'gallery must still watch existing gesture arbiter');
assert.match(gallery,/admission\/claim FPGesture135; viewer lifetime FPMediaManager177/,
  'runtime owner map must name existing arbiter/lifecycle owners');
assert.doesNotMatch(gallery,/closest\?\.\('button,video,input,a'\)/,
  'video must not remain excluded from viewer gesture admission');
assert.match(galleryCss,/\.media-viewer-content video \{[\s\S]*?touch-action: none;/,
  'direct video surface must keep pointer stream for the admitted viewer drag');
assert.match(gallery,/fp-gallery134-video-gesture190/,'active video picture gesture surface missing');
assert.match(galleryCss,/\.fp-gallery134-video-gesture190 \{[\s\S]*?inset: 0 0 54px;[\s\S]*?touch-action: none;/,
  'picture gesture surface must leave the native control strip uncovered');

const managerStart = app.indexOf('class FPMediaManager177Class {');
const managerEnd = app.indexOf('\nconst FPMediaManager177 =',managerStart);
assert(managerStart >= 0 && managerEnd > managerStart,'FPMediaManager177 missing');
const manager = app.slice(managerStart,managerEnd);
for (const forbidden of ['createVideoThumbBlob','createVideoPlaceholderThumbBlob','readEncryptedMedia174']) {
  assert(!manager.includes(forbidden),'MediaManager177 illegally absorbed thumbnail/codec/network worker: '+forbidden);
}

assert.match(app,/if\(!dec\?\.size\)throw new Error\('empty media thumbnail'\)/,
  'primary thumb must reject zero plaintext');
assert.match(app,/consumer:'chat-thumbnail-fallback'/,'video fallback diagnostic consumer missing');
assert.match(app,/readEncryptedMedia174\(\`\/api\/media\/\$\{media\.public_id\}\/blob/,
  'fallback must stay on existing encrypted media read path');
assert.match(app,/function createVideoPlaceholderThumbBlob\(\)/,'valid placeholder fallback missing');
assert.match(app,/requestVideoFrameCallback/,'video frame readiness should use requestVideoFrameCallback when available');
assert.match(app,/waitFor\(\['seeked','loadeddata'\]/,'video thumbnail must wait for seek/data readiness');
assert.match(app,/if\(!thumbnailBlob\?\.size\)throw new Error\('video thumbnail empty'\)/,
  'video thumbnail must reject zero blob');
assert.doesNotMatch(app,/new Blob\(\[\],\s*\{type:'image\/webp'\}\)/,
  'zero-byte WebP fallback must not survive Build 190');
assert.match(app,/async function mountChatMediaThumb190/,'chat thumbnail mount/fallback worker missing');
assert.match(app,/img\.dataset\.fpFallback190==='1'/,'video fallback must be single-shot per tile');

assert.match(app,/item\.media_kind==='video'\?'<span class="media-video-badge" aria-hidden="true"><\/span>':''/,
  'Build 190.2 message renderer must create the play badge only for video tiles');
assert.doesNotMatch(app,/media-video-badge[^>]*>▶<\/span>/,
  'Build 190.2 must not depend on a font/emoji play glyph');
assert.match(styles,/\.media-video-badge\s*\{[\s\S]*?width:32px;[\s\S]*?height:32px;[\s\S]*?backdrop-filter:blur\(6px\);[\s\S]*?pointer-events:none;/,
  'Build 190.2 Telegram-like circular badge presentation missing');
assert.match(styles,/\.media-video-badge::before\s*\{[\s\S]*?border-left:9px solid #fff;/,
  'Build 190.2 CSS play triangle missing');
assert.match(styles,/\.media-tile:active \.media-video-badge\{transform:scale\(\.94\)\}/,
  'Build 190.2 pressed feedback missing');
assert.match(styles,/\.media-video-badge\.hidden\{display:none\}/,
  'Build 190.2 hidden badge guard missing');

assert.match(mediaSend,/if \(!item\.thumbnailBlob\?\.size\)/,
  'FPMediaSend170 must reject an empty prepared thumbnail');
assert.match(mediaSend,/role:'media-submit'/,'existing media submit owner must remain');
assert.match(mediaSend,/transport:'FPNetwork171\.upload \+ stable WS'/,
  'upload must remain owned by FPNetwork171 + stable WS');

assert.match(server,/thumbSizeBytes <= 0/,'server must reject zero plaintext thumbnail');
assert.match(server,/Number\(encryptedThumb\.size \|\| 0\) <= 28/,
  'server must reject AES-GCM payload that can only represent empty plaintext');

assert.match(network,/role: 'fetch-xhr-cache-owner'/,'FPNetwork171 must remain network/cache owner');
assert.match(docs,/FPGesture135/);
assert.match(docs,/FPMediaManager177/);
assert.match(docs,/FPMediaSend170/);
assert.match(docs,/FPNetwork171/);

console.log('PASS Build 190 owner/arbiter contract');
console.log('PASS Build 190 video swipe deferred claim contract');
console.log('PASS Build 190 thumbnail generation/fallback/upload invariants');
console.log('PASS Build 190.2 video-only play badge presentation contract');
