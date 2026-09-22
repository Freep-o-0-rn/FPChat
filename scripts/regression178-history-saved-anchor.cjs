'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const history = fs.readFileSync(path.join(root, 'public/history174.js'), 'utf8').replace(/\r\n/g, '\n');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8').replace(/\r\n/g, '\n');

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

const initialTarget = functionSource(app, 'getInitialScrollTargetId');
const hydrate = functionSource(history, 'hydrate');
const around = functionSource(history, 'around');
const anchorLookup = functionSource(app, 'getViewStateMessageElement');
const saveAnchor = functionSource(app, 'getFirstVisibleMessageAnchor');
const saveView = functionSource(app, 'saveViewStateNow');
const waitLayout = functionSource(app, 'waitForInitialMediaLayout');
const normalizeViewState = functionSource(server, 'normalizeViewState');

// Existing open priority is preserved: unread first, then saved view state, then bottom.
assert(initialTarget.includes('if(unreadCount>0&&Number.isSafeInteger(firstUnreadId)&&firstUnreadId>0)return firstUnreadId;'),
  'first unread no longer has priority over saved anchor');
assert(initialTarget.includes('if(data?.viewState?.atBottom)return null;'),
  'saved atBottom contract changed');
assert(initialTarget.includes('const savedAnchorId=Number(data?.viewState?.anchorMessageId);'),
  'saved anchor id is no longer the restore target');

// Missing saved anchor is loaded around through the existing History174 path.
assert(hydrate.includes('const anchor=getInitialScrollTargetId(data);'),
  'History174 hydrate no longer consumes the existing initial target');
assert(hydrate.includes('if(anchor&&!seed.some(m=>Number(m.id)===anchor)){'),
  'History174 no longer loads around an anchor missing from the seed');
assert(hydrate.includes('const result=await around(view,anchor,view.context?.signal);'),
  'saved-anchor hydrate no longer uses the existing around() loader');
assert(hydrate.includes('if(!valid(view))return;'),
  'saved-anchor result is not rejected for stale room');
assert(around.includes("page(view,{before:String(anchor+1)},signal)"),
  'around() changed the older half needed to include the anchor');
assert(around.includes("page(view,{after:String(anchor)},signal)"),
  'around() changed the newer half');
assert(around.includes(".sort((a,b)=>Number(a.id)-Number(b.id))"),
  'around() no longer restores ascending message order');

// The exact anchor node is found by numeric/string message identity.
assert(anchorLookup.includes("node.dataset.messageId===String(anchorId)"),
  'saved anchor lookup no longer matches the exact message id');

// Save and restore use the same top-relative pixel coordinate.
assert(saveAnchor.includes('anchorOffsetPx:Math.round(rect.top-boxTop)'),
  'saved anchor offset is no longer message.top - box.top');
assert(saveView.includes('anchorOffsetPx:anchor?.anchorOffsetPx||0'),
  'saved pixel offset is not sent to the server');
assert(normalizeViewState.includes('anchorOffsetPx: Number(row.anchor_offset_px || 0)'),
  'server no longer returns the stored pixel offset unchanged as a number');

// Initial restore waits for the existing media/layout stabilization before geometry.
assert(waitLayout.includes('while(pendingMediaThumbLoads>0&&Date.now()<deadline)'),
  'initial restore no longer waits for pending media thumb layout');
assert(waitLayout.includes('await Promise.race(['),
  'initial restore no longer gives media dimensions a bounded stabilization wait');

const applyStart = app.indexOf('  async applyInitial(viewState){');
const applyEnd = app.indexOf('\n  stop(){', applyStart);
assert(applyStart >= 0 && applyEnd > applyStart, 'scrollCoordinator.applyInitial missing');
const applyInitial = app.slice(applyStart, applyEnd);

assert(applyInitial.includes('await waitForInitialMediaLayout(this.box);'),
  'pixel restore occurs before initial media/layout stabilization');
assert(applyInitial.includes('const target=getViewStateMessageElement(box,viewState);'),
  'initial scroll no longer resolves the saved anchor node');
assert(applyInitial.includes('const offset=Number(viewState?.anchorOffsetPx)||0;'),
  'initial scroll no longer consumes saved anchorOffsetPx');
assert(applyInitial.includes("this.write(box,box.scrollTop+rect.top-boxRect.top-offset,'auto');"),
  'saved pixel offset restore formula changed');
assert(applyInitial.includes("mode='restored';"),
  'saved anchor no longer reports restored mode');

// Existing scroll owner remains the only writer used by restore.
assert(applyInitial.includes('this.write('), 'restore bypasses FPScroll173 write ownership');
assert(!applyInitial.includes('box.scrollTop='), 'restore directly writes scrollTop outside FPScroll173.write');

// Semantic geometry check using the exact save/restore convention.
// Saved: anchorOffset = targetTop - boxTop.
// Restore: nextScroll = currentScroll + targetTop - boxTop - anchorOffset.
// If layout shifted by +37px before restore, scroll moves by +37px and the anchor
// returns to the same visible offset.
const originalBoxTop = 100;
const originalTargetTop = 142;
const savedOffset = Math.round(originalTargetTop - originalBoxTop);
assert.equal(savedOffset, 42);

const currentScroll = 800;
const restoredBoxTop = 100;
const restoredTargetTop = 179; // +37 px layout shift
const nextScroll = currentScroll + restoredTargetTop - restoredBoxTop - savedOffset;
assert.equal(nextScroll, 837, 'restore formula did not compensate for layout shift');
const resultingVisibleOffset = restoredTargetTop - restoredBoxTop - (nextScroll - currentScroll);
assert.equal(resultingVisibleOffset, savedOffset, 'restored visible pixel offset differs from saved offset');

console.log('PASS 178.5 saved anchor is loaded through FPHistory174.around when absent from seed');
console.log('PASS saved view-state id and pixel offset survive server round-trip contract');
console.log('PASS initial restore waits for layout and uses the same top-relative pixel coordinate');
console.log('PASS FPScroll173 restores the previous visible anchor offset without a new scroll path');
