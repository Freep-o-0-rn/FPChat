'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const actions = read('public/message-actions.js');
const index = read('public/index.html');

const start = actions.indexOf('function keepViewportWhileRemoving(box, el)');
const end = actions.indexOf('function clearReplyDraftIfNeeded', start);
assert(start >= 0 && end > start, 'keepViewportWhileRemoving missing');
const body = actions.slice(start, end);

assert(body.includes("const wasAtBottom = typeof isMessagesAtBottom === 'function' ? isMessagesAtBottom(box) : false;"), 'existing bottom decision changed');
assert(body.includes('const beforeHeight = box.scrollHeight;'), 'existing beforeHeight capture changed');
assert(body.includes('const beforeTop = box.scrollTop;'), 'existing beforeTop capture changed');
assert(body.includes('const wasAbove = elRect.bottom <= boxRect.top + 1;'), 'existing remove-above decision changed');

assert(body.includes('window.FPScroll173?.requestBottom(box);'), 'bottom path does not use FPScroll173');
assert(body.includes("window.FPScroll173?.write(box, beforeTop - removedHeight, 'auto');"), 'remove-above target/offset/behavior changed');
assert(body.includes('const removedHeight = Math.max(0, beforeHeight - box.scrollHeight);'), 'removed-height formula changed');

assert(!/box\.scrollTop\s*=/.test(body), 'direct message scrollTop writer remains in keepViewportWhileRemoving');
assert(!body.includes('scrollCoordinator.requestBottom('), 'message removal still bypasses public FPScroll173 bottom entry');
assert(!body.includes('scrollCoordinator.write('), 'message removal still bypasses public FPScroll173 write entry');

const appLoad = index.indexOf("script.src = `/app.js${buildSuffix}`");
const actionsLoad = index.indexOf("messageActions.src = `/message-actions.js${buildSuffix}`");
assert(appLoad >= 0 && actionsLoad > appLoad, 'message-actions load order no longer guarantees FPScroll173 is created first');

console.log('PASS 178.23 deletion bottom keeps the existing target through FPScroll173.requestBottom');
console.log('PASS 178.23 remove-above keeps beforeTop - removedHeight with behavior=auto through FPScroll173.write');
console.log('PASS 178.23 keepViewportWhileRemoving has no direct #messages scrollTop writer');
console.log('PASS 178.23 app.js loads before message-actions.js, so no replacement fallback owner was introduced');
