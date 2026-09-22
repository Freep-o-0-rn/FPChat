'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const history = fs.readFileSync(path.join(root, 'public/history174.js'), 'utf8').replace(/\r\n/g, '\n');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');
const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8').replace(/\r\n/g, '\n');

function functionSource(source, name) {
  const wrapped = '\n' + source;
  const match = new RegExp('\\n\\s*(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(wrapped);
  assert(match, 'function missing: ' + name);
  const start = Math.max(0, match.index - 1);
  const rest = source.slice(start + 1);
  const next = /\n\s*(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/g;
  next.lastIndex = 1;
  const found = next.exec(rest);
  return found ? rest.slice(0, found.index) : rest;
}

const page = functionSource(history, 'page');
const transaction = functionSource(history, 'transaction');
const load = functionSource(history, 'load');
const mounted = functionSource(history, 'mounted');
const legacyLoad = functionSource(app, 'loadOlderMessages');

// One normal owner/entry.
assert(indexHtml.includes("'app.js':['room-context170.js','lifecycle170.js','network171.js','message-store172.js','dom-lifecycle173.js','layer-manager173.js','work174.js','history174.js']"),
  'startup dependency no longer places FPHistory174 before app.js');
assert(indexHtml.includes("history.onload = loadContextThenApp174;"),
  'app startup no longer waits for successful history174 execution before continuing');
assert(mounted.includes("void load('older')"), 'normal top-scroll entry no longer delegates to FPHistory174.load(older)');
assert(mounted.includes("void load('newer')"), 'normal bottom-scroll entry no longer delegates to FPHistory174.load(newer)');
assert(legacyLoad.trim().startsWith("async function loadOlderMessages(){if(window.FPHistory174)return FPHistory174.load('older');"),
  'legacy older loader can run independently while FPHistory174 exists');

// Existing cursor contract.
assert(load.includes("const cursor=direction==='older'?history.nextCursor:history.newerCursor;"),
  'history load no longer uses the existing direction cursor');
assert(load.includes("{[direction==='older'?'before':'after']:String(cursor)}"),
  'history load changed the existing before/after cursor arguments');
assert(load.includes("history.nextCursor=Number(data.nextCursor)||cursor"),
  'older cursor fallback changed');
assert(load.includes("history.newerCursor=Number(data.nextCursor)||cursor"),
  'newer cursor fallback changed');

// Server order must be preserved: filter only, no sort/reverse before render/mount.
assert(load.includes("const unique=data.messages.filter(m=>!existing.has(String(m.id)));"),
  'page load no longer filters duplicates while preserving response order');
const uniqueToRender = load.slice(load.indexOf('const unique='), load.indexOf('const scratch=await render'));
assert(!/\.sort\s*\(|\.reverse\s*\(/.test(uniqueToRender),
  'page messages are reordered before render');
assert(load.includes("if(direction==='older')box.insertBefore(fragment,box.querySelector('.bubble-wrap.msg'));"),
  'older page mount position changed');
assert(load.includes("else box.appendChild(fragment);"),
  'newer page mount position changed');

// Stale-room cancellation.
assert(page.includes("if(!valid(view))throw new DOMException('Stale room','AbortError');"),
  'page no longer rejects a stale room before network');
assert(page.includes("if(!valid(view))throw new DOMException('Stale room','AbortError');"),
  'page stale-room guard missing');
assert(transaction.includes('history.request174?.abort();'),
  'new history transaction no longer cancels the previous request');
assert(transaction.includes("view.context?.signal.addEventListener('abort',cancel,{once:true});"),
  'RoomContext abort no longer cancels the active history transaction');
assert(transaction.includes('activeChatHistory===history&&history.request174===controller&&!controller.signal.aborted'),
  'transaction current() no longer binds result to current room/request');
assert(load.includes('if(!task.current())return false;'),
  'history load applies network result without current-room validation');

// One active page load under existing rules.
assert(load.includes('history.loading||scrollCoordinator.isOpening()'),
  'load no longer rejects while a history request/opening scroll is active');
assert(transaction.includes('history.loading=true;'),
  'transaction no longer marks the history request active');
assert(transaction.includes('history.request174=controller;'),
  'transaction no longer owns the single active request slot');
assert(transaction.includes("if(history.request174===controller){history.loading=false;history.request174=null;}"),
  'transaction finish no longer releases only its own active request slot');
assert(load.includes('finally{task.finish();}'),
  'ordinary page load no longer releases the active transaction in finally');

// page() still uses the transaction signal and the same page size.
assert(page.includes("limit:String(PAGE)"), 'history page size contract changed');
assert(page.includes("{cache:'no-store',signal}"), 'history fetch no longer uses its transaction AbortSignal');

console.log('PASS 178.4 normal scroll page entry belongs to FPHistory174');
console.log('PASS existing before/after cursor and response order are preserved');
console.log('PASS stale RoomContext/request is cancelled and rejected before mount');
console.log('PASS one history.request174/loading slot governs the ordinary page load');
console.log('PASS legacy loadOlderMessages cannot run independently while FPHistory174 exists');
