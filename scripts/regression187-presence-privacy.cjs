'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  coarsePresenceState,
  createPresencePrivacy187
} = require('../src/presence-privacy187');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const rows = new Map([
  ['full-user', { show_online_status: 1, show_last_seen_exact: 1 }],
  ['approx-user', { show_online_status: 1, show_last_seen_exact: 0 }],
  ['private-exact-user', { show_online_status: 0, show_last_seen_exact: 1 }],
  ['private-approx-user', { show_online_status: 0, show_last_seen_exact: 0 }]
]);
const fakeDb = {
  prepare(sql) {
    assert.match(sql, /show_online_status/);
    assert.match(sql, /show_last_seen_exact/);
    return { get(deviceId) { return rows.get(String(deviceId)) || null; } };
  }
};

const privacy = createPresencePrivacy187(fakeDb);
const now = Date.parse('2026-09-25T12:00:00Z');
const ago = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
const item = (deviceId, online, lastSeenAt) => ({
  device_id: deviceId,
  online: online ? 1 : 0,
  last_seen_at: lastSeenAt
});
const iso = (value) => new Date(value).toISOString();

let projected = privacy.project(item('full-user', true, ago(1)), 'viewer-user', { nowMs: now, toIsoUtc: iso });
assert.deepEqual(projected, { online: true, lastSeenAt: null, presenceState: 'online' });

projected = privacy.project(item('full-user', false, ago(1)), 'viewer-user', { nowMs: now, toIsoUtc: iso });
assert.equal(projected.online, false);
assert.equal(projected.presenceState, 'exact');
assert.equal(projected.lastSeenAt, ago(1));

projected = privacy.project(item('approx-user', true, ago(10)), 'viewer-user', { nowMs: now, toIsoUtc: iso });
assert.deepEqual(projected, { online: true, lastSeenAt: null, presenceState: 'online' });

for (const [days, expected] of [[1, 'recently'], [4, 'week'], [10, 'month'], [31, 'long_ago']]) {
  projected = privacy.project(item('approx-user', false, ago(days)), 'viewer-user', { nowMs: now, toIsoUtc: iso });
  assert.equal(projected.online, false);
  assert.equal(projected.lastSeenAt, null);
  assert.equal(projected.presenceState, expected);
}

for (const deviceId of ['private-exact-user', 'private-approx-user']) {
  projected = privacy.project(item(deviceId, true, ago(40)), 'viewer-user', { nowMs: now, toIsoUtc: iso });
  assert.deepEqual(projected, { online: false, lastSeenAt: null, presenceState: 'recently' });

  projected = privacy.project(item(deviceId, false, ago(10)), 'viewer-user', { nowMs: now, toIsoUtc: iso });
  assert.deepEqual(projected, { online: false, lastSeenAt: null, presenceState: 'month' });
}

projected = privacy.project(item('full-user', true, ago(1)), 'viewer-user', { hidden: true, nowMs: now, toIsoUtc: iso });
assert.deepEqual(projected, {
  online: false,
  lastSeenAt: null,
  presenceState: 'unavailable',
  statusUnavailable: true
});

assert.equal(coarsePresenceState(ago(2.99), now), 'recently');
assert.equal(coarsePresenceState(ago(3), now), 'week');
assert.equal(coarsePresenceState(ago(7), now), 'month');
assert.equal(coarsePresenceState(ago(30), now), 'long_ago');

const username = read('src/username-server.js');
const blocks = read('src/user-blocks165.js');
const server = read('server.js');
const settings = read('public/settings-ui131.js');
const app = read('public/app.js');

assert(username.includes('show_online_status INTEGER NOT NULL DEFAULT 1'));
assert(username.includes('show_last_seen_exact INTEGER NOT NULL DEFAULT 1'));
assert(username.includes('onPrivacyChanged(deviceId, next, current)'));
assert(blocks.includes('presenceProjector'));
assert(blocks.includes('...projectPresence(item, viewerId, toIsoUtc)'));
assert(server.includes('const fpPresencePrivacy187 = createPresencePrivacy187(db);'));
assert(server.includes('onPrivacyChanged: broadcastPresenceForSubject'));
assert(server.includes("if (!force && fpPresencePrivacy187.settingsFor(subject.device_id).showOnlineStatus === false) return;"));
assert(server.includes('forcePrivacy: true'));
assert(server.includes('setParticipantOnline: db.prepare'));
assert(server.includes("online=1, last_seen_at=datetime('now')"));
assert(server.includes('setParticipantOffline: db.prepare'));
assert(server.includes("online=0, last_seen_at=datetime('now')"));
assert(settings.includes('id="fpPrivacyOnline187"'));
assert(settings.includes('id="fpPrivacyLastSeen187"'));
assert(settings.includes("'showOnlineStatus'"));
assert(settings.includes("'showLastSeenExact'"));
assert(app.includes("case 'recently':return 'был недавно'"));
assert(app.includes("case 'week':return 'был на этой неделе'"));
assert(app.includes("case 'month':return 'был в этом месяце'"));
assert(app.includes("case 'long_ago':return 'был давно'"));

const policy = read('src/presence-privacy187.js');
assert(!policy.includes('setInterval('));
assert(!policy.includes('setTimeout('));
assert(!policy.includes('WebSocket'));
assert(!policy.includes('fetch('));

console.log('PASS Build 187.1 presence privacy modes and architecture contract');
