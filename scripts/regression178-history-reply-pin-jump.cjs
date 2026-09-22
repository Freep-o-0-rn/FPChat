'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');
const history = fs.readFileSync(path.join(root, 'public/history174.js'), 'utf8').replace(/\r\n/g, '\n');
const pins = fs.readFileSync(path.join(root, 'public/message-pins.js'), 'utf8').replace(/\r\n/g, '\n');
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

const replyJump = functionSource(app, 'findAndFocusReplyMessage');
const historyUntil = functionSource(app, 'loadHistoryUntilMessage');
const pinJump = functionSource(pins, 'jumpToMessage');
const pinCycle = functionSource(pins, 'jumpToNextPinnedMessage');
const historyJump = functionSource(history, 'jump');
const jumpWindow = functionSource(history, 'jumpWindow');
const transaction = functionSource(history, 'transaction');
const around = functionSource(history, 'around');

assert(replyJump.includes('if(!target)target=await loadHistoryUntilMessage(messageId);'),
  'reply jump no longer delegates a missing target to loadHistoryUntilMessage');
assert(historyUntil.includes("if(window.FPHistory174)return FPHistory174.jump(Number(messageId));"),
  'reply history jump can bypass FPHistory174 while the owner exists');
assert(replyJump.includes('if(!isRoomViewCurrent170(view))return;'),
  'reply jump can focus a result from a stale room');
assert(replyJump.includes('scrollCoordinator.focus(target)'),
  'reply jump changed its existing final focus behavior');

assert(pinCycle.includes('await jumpToMessage(pin.messageId);'),
  'pin-bar cycle no longer delegates to the common pin jump');
assert(pins.includes("item.addEventListener('click', () => void jumpToMessage(pin.messageId));"),
  'pins screen no longer delegates to the common pin jump');
assert(pinJump.includes("if (typeof findAndFocusReplyMessage === 'function')"),
  'pin jump no longer prefers the existing common reply/history helper');
assert(pinJump.includes('await findAndFocusReplyMessage(messageId);'),
  'pin jump no longer converges on the existing reply/history path');

for (const forbidden of ['fetch(', 'new AbortController', 'request174', 'history.loading', 'nextCursor', 'newerCursor']) {
  assert(!pinJump.includes(forbidden), 'pin jump introduced independent history ownership: ' + forbidden);
}

const appScriptPos = indexHtml.indexOf('script.src = \`/app.js\${buildSuffix}\`;');
const pinsScriptPos = indexHtml.indexOf('messagePins.src = \`/message-pins.js\${buildSuffix}\`;');
assert(appScriptPos >= 0 && pinsScriptPos > appScriptPos,
  'message-pins.js is no longer loaded after app.js in the normal startup chain');

assert(historyJump.includes('return jumpWindow(anchor);'),
  'FPHistory174.jump(anchor) no longer delegates to jumpWindow');
assert(jumpWindow.includes('const view=captureRoomView170(),task=transaction(history,view);'),
  'history jump created a path outside the existing transaction owner');
assert(jumpWindow.includes('const data=await around(view,anchor,task.signal);'),
  'history jump no longer uses the existing around loader and transaction signal');
assert(jumpWindow.includes('if(!task.current())return null;'),
  'history jump applies stale-room/request results');
assert(jumpWindow.includes('finally{task.finish();}'),
  'history jump does not release the shared transaction slot');
assert(transaction.includes('history.request174?.abort();'),
  'jump transaction no longer cancels the previous active history request');
assert(transaction.includes('history.request174=controller;'),
  'jump transaction no longer uses the same single history.request174 slot');
assert(transaction.includes('history.loading=true;'),
  'jump transaction no longer uses the same history.loading ownership');
assert(transaction.includes("view.context?.signal.addEventListener('abort',cancel,{once:true});"),
  'jump transaction is detached from RoomContext cancellation');

assert(around.includes("page(view,{before:String(anchor+1)},signal)"),
  'jump older-side loading changed');
assert(around.includes("page(view,{after:String(anchor)},signal)"),
  'jump newer-side loading changed');

console.log('PASS 178.6 reply jump delegates missing targets to FPHistory174.jump');
console.log('PASS pin bar and pins screen both converge on the same reply/history jump helper');
console.log('PASS pin jump owns no fetch, AbortController, cursor or second history queue');
console.log('PASS reply and pin jumps share FPHistory174 transaction/request174 and RoomContext cancellation');
