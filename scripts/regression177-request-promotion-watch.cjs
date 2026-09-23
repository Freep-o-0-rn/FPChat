'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const system = fs.readFileSync(path.join(root, 'public/chat-request-system147.js'), 'utf8').replace(/\r\n/g, '\n');
const owner = fs.readFileSync(path.join(root, 'public/chat-request-owner147.js'), 'utf8').replace(/\r\n/g, '\n');

assert(system.includes('const OUTGOING_WATCH_MS = 1500;'), 'fast outgoing request watch interval missing');
assert(system.includes("row?.direction === 'outgoing' && row?.status === 'pending'"), 'watch is not limited to outgoing pending requests');
assert(system.includes('void syncRequests().catch(() => {});'), 'watch does not re-run existing request reconciliation');
assert(system.includes("window.addEventListener('fpchat:chat-request-changed'"), 'new outgoing request does not start reconciliation promptly');
assert(system.includes('scheduleOutgoingWatch(rows);'), 'request sync does not maintain/stop the pending watch');
assert(owner.includes('window.FPChatRequestOwner147?.reconcile') === false, 'owner should not own request fetching');
assert(system.includes('window.FPChatRequestOwner147?.reconcile?.(rows);'), 'existing reconcile/promote path was bypassed');
assert(owner.includes('upsertChat(roomId, {});'), 'accepted outgoing room no longer promotes through existing chat list owner');
assert(owner.includes('STORAGE.set(STORAGE.roomState(roomId)'), 'accepted outgoing room local access is not persisted before list promotion');

console.log('PASS outgoing pending requests are watched only while needed');
console.log('PASS accepted state still flows through syncRequests -> reconcile -> promote -> upsertChat');
console.log('PASS chat list promotion uses the existing owner path without reload');
