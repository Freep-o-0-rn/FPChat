const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const webpush = require('web-push');
const fs = require('fs');
const multer = require('multer');
const { createDb } = require('./src/db');

dotenv.config();

const APP_HOST = process.env.APP_HOST || '127.0.0.1';
const APP_PORT = Number(process.env.APP_PORT || 3010);
const DATABASE_PATH = process.env.DATABASE_PATH || './data/chat.sqlite';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('Push notifications disabled: VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is missing');
}

const db = createDb(DATABASE_PATH);
const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 110 * 1024 * 1024 } });
const app = express();
app.use(express.json({ limit: '128kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const socketsByDevice = new Map();

const q = {
  createRoom: db.prepare('INSERT INTO rooms (public_id) VALUES (?)'),
  findRoomByPublicId: db.prepare('SELECT * FROM rooms WHERE public_id = ?'),
  findRoomById: db.prepare('SELECT * FROM rooms WHERE id = ?'),
  createRecovery: db.prepare(`INSERT INTO recovery (room_id, device_id, recovery_salt, recovery_verifier, recovery_secret_iv, recovery_secret_ciphertext) VALUES (?, ?, ?, ?, ?, ?)`),
  upsertRecovery: db.prepare(`INSERT INTO recovery (room_id, device_id, recovery_salt, recovery_verifier, recovery_secret_iv, recovery_secret_ciphertext) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(room_id, device_id) DO UPDATE SET recovery_salt = excluded.recovery_salt, recovery_verifier = excluded.recovery_verifier, recovery_secret_iv = excluded.recovery_secret_iv, recovery_secret_ciphertext = excluded.recovery_secret_ciphertext`),
  listRecoveriesByRoomId: db.prepare(`SELECT * FROM recovery WHERE room_id = ? ORDER BY id ASC`),
  findRecoveryByRoomDevice: db.prepare(`SELECT rec.id FROM recovery rec WHERE rec.room_id = ? AND rec.device_id = ?`),
  listRecoveriesWithRooms: db.prepare(`SELECT room.public_id, rec.device_id, rec.recovery_salt, rec.recovery_verifier, rec.recovery_secret_iv, rec.recovery_secret_ciphertext FROM recovery rec JOIN rooms room ON room.id = rec.room_id`),
  upsertParticipant: db.prepare(`INSERT INTO participants (room_id, display_name, device_id, last_seen_at, online, updated_at) VALUES (?, ?, ?, datetime('now'), 0, datetime('now')) ON CONFLICT(room_id, device_id) DO UPDATE SET display_name = excluded.display_name, last_seen_at = datetime('now'), updated_at = datetime('now')`),
  listParticipantsByRoom: db.prepare(`SELECT device_id, display_name, online, last_seen_at FROM participants WHERE room_id = ? ORDER BY id ASC`),
  setParticipantOnline: db.prepare(`UPDATE participants SET online = 1, last_seen_at = datetime('now'), updated_at = datetime('now') WHERE room_id = ? AND device_id = ?`),
  setParticipantOffline: db.prepare(`UPDATE participants SET online = 0, last_seen_at = datetime('now'), updated_at = datetime('now') WHERE room_id = ? AND device_id = ?`),
  findParticipant: db.prepare('SELECT * FROM participants WHERE room_id = ? AND device_id = ?'),
  listParticipantRoomsByDevice: db.prepare(`SELECT p.room_id, p.device_id, p.display_name, p.online, p.last_seen_at, r.public_id AS room_public_id FROM participants p JOIN rooms r ON r.id = p.room_id WHERE p.device_id = ?`),
  listMessages: db.prepare(`SELECT m.id, m.type, m.ciphertext, m.iv, m.reply_to_message_id, m.status, m.created_at, m.delivered_at, m.read_at, p.display_name as sender_name, p.device_id as sender_device_id FROM messages m JOIN participants p ON p.id = m.sender_id WHERE m.room_id = ? ORDER BY m.id ASC`),
  createMessage: db.prepare(`INSERT INTO messages (room_id, sender_id, ciphertext, iv, type, status, reply_to_message_id) VALUES (?, ?, ?, ?, ?, 'sent', ?)`),
  findMessageInRoom: db.prepare('SELECT id FROM messages WHERE id = ? AND room_id = ?'),
  findDraftByRoomDevice: db.prepare(`SELECT ciphertext, iv, reply_to_message_id, updated_at FROM drafts WHERE room_id = ? AND device_id = ?`),
  findViewStateByRoomDevice: db.prepare(`SELECT anchor_message_id, anchor_offset_px, updated_at FROM chat_view_state WHERE room_id = ? AND device_id = ?`),
  upsertViewState: db.prepare(`INSERT INTO chat_view_state (room_id, device_id, anchor_message_id, anchor_offset_px, updated_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(room_id, device_id) DO UPDATE SET anchor_message_id=excluded.anchor_message_id, anchor_offset_px=excluded.anchor_offset_px, updated_at=datetime('now')`),
  upsertDraft: db.prepare(`INSERT INTO drafts (room_id, device_id, ciphertext, iv, reply_to_message_id, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(room_id, device_id) DO UPDATE SET ciphertext=excluded.ciphertext, iv=excluded.iv, reply_to_message_id=excluded.reply_to_message_id, updated_at=datetime('now')`),
  deleteDraftByRoomDevice: db.prepare(`DELETE FROM drafts WHERE room_id = ? AND device_id = ?`),
  markDelivered: db.prepare(`UPDATE messages
    SET status = CASE WHEN status = 'sent' THEN 'delivered' ELSE status END,
        delivered_at = CASE WHEN status = 'sent' THEN datetime('now') ELSE delivered_at END
    WHERE id = ?`),
  markReadBulk: db.prepare(`UPDATE messages
    SET status = 'read',
        read_at = CASE WHEN read_at IS NULL THEN datetime('now') ELSE read_at END
    WHERE room_id = ? AND id = ? AND sender_id != ? AND status != 'read'`),
  upsertPushSub: db.prepare(`INSERT INTO push_subscriptions (room_id, device_id, endpoint, p256dh, auth, muted, show_text, hide_sender, updated_at) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT muted FROM push_subscriptions WHERE room_id=? AND device_id=? AND endpoint=?),0), ?, ?, datetime('now')) ON CONFLICT(room_id, device_id, endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, show_text=excluded.show_text, hide_sender=excluded.hide_sender, updated_at=datetime('now')`),
  deletePushByRoomEndpointOtherDevice: db.prepare('DELETE FROM push_subscriptions WHERE room_id = ? AND endpoint = ? AND device_id != ?'),
  updatePushSettings: db.prepare(`UPDATE push_subscriptions SET show_text=?, hide_sender=?, updated_at=datetime('now') WHERE room_id=? AND device_id=?`),
  mutePushRoom: db.prepare(`UPDATE push_subscriptions SET muted=?, updated_at=datetime('now') WHERE room_id=? AND device_id=?`),
  deletePushByDeviceRoom: db.prepare('DELETE FROM push_subscriptions WHERE device_id = ? AND room_id = ?'),
  deletePushByDevice: db.prepare('DELETE FROM push_subscriptions WHERE device_id = ?'),
  listPushForRoom: db.prepare(`SELECT ps.*, r.public_id as room_public_id, p.display_name as device_name FROM push_subscriptions ps JOIN rooms r ON r.id = ps.room_id JOIN participants p ON p.room_id = ps.room_id AND p.device_id = ps.device_id WHERE ps.room_id = ?`),
  deletePushById: db.prepare('DELETE FROM push_subscriptions WHERE id = ?'),
  createInvite: db.prepare(`INSERT INTO invites (invite_code, room_id, room_secret, expires_at) VALUES (?, ?, ?, datetime('now', '+24 hours'))`),
  findInviteByCode: db.prepare(`SELECT * FROM invites WHERE invite_code = ?`),
  consumeInvite: db.prepare(`UPDATE invites SET used_at = datetime('now'), used_by_device_id = ?, room_secret = NULL WHERE id = ? AND used_at IS NULL AND revoked = 0 AND expires_at > datetime('now') AND room_secret IS NOT NULL`),
  listExpiredSoloInviteRooms: db.prepare(`SELECT i.room_id FROM invites i WHERE i.expires_at <= datetime('now') AND i.used_at IS NULL AND (SELECT COUNT(*) FROM participants p WHERE p.room_id = i.room_id) < 2`),
  deletePushByRoomId: db.prepare('DELETE FROM push_subscriptions WHERE room_id = ?'),
  createMedia: db.prepare(`INSERT INTO media (public_id, room_id, status, file_order, server_filename, thumbnail_filename, original_name_ciphertext, original_name_iv, mime_type, media_kind, size_bytes, encrypted_size_bytes, thumb_size_bytes, thumb_encrypted_size_bytes, width, height, duration_seconds) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  listMediaByMessageId: db.prepare(`SELECT id, public_id, mime_type, media_kind, size_bytes, encrypted_size_bytes, width, height, duration_seconds, file_order FROM media WHERE message_id = ? ORDER BY file_order ASC, id ASC`),
  listPendingMediaByIds: db.prepare(`SELECT * FROM media WHERE room_id = ? AND id IN (SELECT value FROM json_each(?)) ORDER BY file_order ASC, id ASC`),
  attachMediaToMessage: db.prepare(`UPDATE media SET status='attached', message_id=?, updated_at=datetime('now') WHERE id=? AND room_id=? AND status='pending' AND message_id IS NULL`),
  findMediaByPublicId: db.prepare(`SELECT * FROM media WHERE public_id=?`),
  deletePendingMediaByIds: db.prepare(`DELETE FROM media WHERE room_id=? AND status='pending' AND id IN (SELECT value FROM json_each(?))`),
  listStalePendingMedia: db.prepare(`SELECT * FROM media WHERE status='pending' AND created_at < datetime('now', '-24 hours')`),
  deletePendingMediaById: db.prepare(`DELETE FROM media WHERE id=? AND status='pending'`),
  listMediaFilesByRoomId: db.prepare(`SELECT server_filename, thumbnail_filename FROM media WHERE room_id=?`),
  deleteMediaByRoomId: db.prepare('DELETE FROM media WHERE room_id = ?'),
  deleteMessagesByRoomId: db.prepare('DELETE FROM messages WHERE room_id = ?'),
  deleteParticipantsByRoomId: db.prepare('DELETE FROM participants WHERE room_id = ?'),
  deleteViewStateByRoomId: db.prepare('DELETE FROM chat_view_state WHERE room_id = ?'),
  deleteRecoveryByRoomId: db.prepare('DELETE FROM recovery WHERE room_id = ?'),
  deleteInvitesByRoomId: db.prepare('DELETE FROM invites WHERE room_id = ?'),
  deleteRoomById: db.prepare('DELETE FROM rooms WHERE id = ?')
};

function randomToken(length) { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let out = ''; while (out.length < length) out += alphabet[crypto.randomInt(0, alphabet.length)]; return out; }
function getDeviceSockets(deviceId) {
  if (!socketsByDevice.has(deviceId)) socketsByDevice.set(deviceId, new Set());
  return socketsByDevice.get(deviceId);
}
function getBaseUrl(req) { if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/+$/, ''); const protocol = req.headers['x-forwarded-proto']?.split(',')[0].trim() || req.protocol; const host = req.headers['x-forwarded-host']?.split(',')[0].trim() || req.headers.host; return `${protocol}://${host}`; }
function pushOff(res) { return res.status(503).json({ ok: false, error: 'push disabled on server' }); }
function getRoomByInput(roomId) { return q.findRoomByPublicId.get(roomId) || q.findRoomById.get(Number(roomId)); }
function hydrateMessages(messages) {
  return messages.map((m) => ({ ...m, media: m.type === 'media' ? q.listMediaByMessageId.all(m.id).map((item) => ({ ...item, thumbnail_url: `/api/media/${item.public_id}/thumb` })) : [] }));
}
function normalizeViewState(row) {
  if (!row) return null;
  return {
    anchorMessageId: row.anchor_message_id ? Number(row.anchor_message_id) : null,
    anchorOffsetPx: Number(row.anchor_offset_px || 0),
    updatedAt: toIsoUtc(row.updated_at)
  };
}
function toIsoUtc(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return value.replace(' ', 'T') + 'Z';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

app.get('/api/push/vapid-public-key', (req, res) => res.json(pushEnabled ? { enabled: true, publicKey: VAPID_PUBLIC_KEY } : { enabled: false }));
app.post('/api/push/subscribe', (req, res) => {
  if (!pushEnabled) return pushOff(res);
  const { roomId, deviceId, subscription, settings } = req.body || {};
  const room = getRoomByInput(roomId);
  if (!room) return res.status(404).json({ ok: false, error: 'room not found' });
  const safeDeviceId = String(deviceId || '').slice(0, 64);
  if (!safeDeviceId) return res.status(400).json({ ok: false, error: 'deviceId required' });
  if (!q.findParticipant.get(room.id, safeDeviceId)) return res.status(403).json({ ok: false, error: 'forbidden' });
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) return res.status(400).json({ ok: false, error: 'invalid subscription' });
  q.deletePushByRoomEndpointOtherDevice.run(room.id, endpoint, safeDeviceId);
  q.upsertPushSub.run(room.id, safeDeviceId, endpoint, p256dh, auth, room.id, safeDeviceId, endpoint, settings?.showText ? 1 : 0, settings?.hideSender ? 1 : 0);
  res.json({ ok: true });
});

app.post('/api/push/settings', (req, res) => {
  if (!pushEnabled) return pushOff(res);
  const room = getRoomByInput(req.body?.roomId); if (!room) return res.status(404).json({ ok: false, error: 'room not found' });
  const info = q.updatePushSettings.run(req.body?.showText ? 1 : 0, req.body?.hideSender ? 1 : 0, room.id, String(req.body?.deviceId || '').slice(0, 64));
  res.json({ ok: true, updated: info.changes>0 });
});

app.post('/api/push/mute-room', (req, res) => {
  if (!pushEnabled) return pushOff(res);
  const room = getRoomByInput(req.body?.roomId); if (!room) return res.status(404).json({ ok: false, error: 'room not found' });
  q.mutePushRoom.run(req.body?.muted ? 1 : 0, room.id, String(req.body?.deviceId || '').slice(0, 64));
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  if (!pushEnabled) return pushOff(res);
  const deviceId = String(req.body?.deviceId || '').slice(0, 64); if (!deviceId) return res.status(400).json({ ok: false, error: 'deviceId required' });
  if (req.body?.roomId) { const room = getRoomByInput(req.body.roomId); if (!room) return res.status(404).json({ ok: false, error: 'room not found' }); q.deletePushByDeviceRoom.run(deviceId, room.id); }
  else q.deletePushByDevice.run(deviceId);
  res.json({ ok: true });
});

async function sendPushForMessage({ roomId, roomPublicId, senderDeviceId, senderName, preview }) {
  if (!pushEnabled) return;
  const subs = q.listPushForRoom.all(roomId);
  let delivered = false;
  for (const sub of subs) {
    if (sub.device_id === senderDeviceId || sub.muted) continue;
    if (hasVisibleSocketForDevice(sub.device_id)) continue;
    const privateBody = sub.hide_sender ? 'Новое сообщение' : `${senderName}: новое сообщение`;
    const shownPreview = sub.show_text && preview ? (sub.hide_sender ? preview : `${senderName}: ${preview}`) : privateBody;
    const payload = JSON.stringify({ type: 'message', roomId: roomPublicId, url: `/chat/${roomPublicId}`, title: 'FPChat', body: shownPreview });
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      delivered = true;
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) q.deletePushById.run(sub.id);
      else console.warn(`Push send failed for room ${roomPublicId}: ${err?.statusCode || 'error'}`);
    }
  }
  return delivered;
}

// existing endpoints below ...
const removeRoomCascade = db.transaction((roomId) => {
  for (const item of q.listMediaFilesByRoomId.all(roomId)) { safeUnlink(item.server_filename); safeUnlink(item.thumbnail_filename); }
  q.deleteMediaByRoomId.run(roomId);
  q.deletePushByRoomId.run(roomId);
  q.deleteViewStateByRoomId.run(roomId);
  q.deleteMessagesByRoomId.run(roomId);
  q.deleteParticipantsByRoomId.run(roomId);
  q.deleteRecoveryByRoomId.run(roomId);
  q.deleteInvitesByRoomId.run(roomId);
  q.deleteRoomById.run(roomId);
});
function mediaToDto(media, req) {
  return { id: media.id, public_id: media.public_id, mime_type: media.mime_type, media_kind: media.media_kind, size_bytes: media.size_bytes, encrypted_size_bytes: media.encrypted_size_bytes, width: media.width, height: media.height, duration_seconds: media.duration_seconds, file_order: media.file_order, thumbnail_url: media.thumbnail_filename ? `${getBaseUrl(req)}/api/media/${media.public_id}/thumb` : null };
}
function safeUnlink(file){if(!file)return;try{fs.unlinkSync(path.join(UPLOAD_DIR,file));}catch{}}
function cleanupStalePendingMedia(){const rows=q.listStalePendingMedia.all();for(const m of rows){safeUnlink(m.server_filename);safeUnlink(m.thumbnail_filename);q.deletePendingMediaById.run(m.id);}}
function cleanupExpiredSoloRooms() {
  const rows = q.listExpiredSoloInviteRooms.all();
  for (const row of rows) removeRoomCascade(row.room_id);
}
cleanupStalePendingMedia();
setInterval(cleanupStalePendingMedia, 45 * 60 * 1000);
app.post('/api/rooms', (req, res) => {
  const publicId = randomToken(16);
  const inviteCode = randomToken(24);
  const { displayName, deviceId, roomSecret, recoverySalt, recoveryVerifier, recoverySecretIv, recoverySecretCiphertext } = req.body || {};
  if (!displayName || !deviceId || !roomSecret) return res.status(400).json({ error: 'displayName, deviceId, roomSecret required' });
  if (!recoverySalt || !recoveryVerifier || !recoverySecretIv || !recoverySecretCiphertext) return res.status(400).json({ error: 'recovery verifier required' });
  const safeDeviceId = String(deviceId).slice(0, 64);
  const safeName = String(displayName).slice(0, 48);
  let roomId;
  db.transaction(() => {
    const roomResult = q.createRoom.run(publicId);
    roomId = roomResult.lastInsertRowid;
    q.createRecovery.run(roomId, safeDeviceId, recoverySalt, recoveryVerifier, recoverySecretIv, recoverySecretCiphertext);
    q.upsertParticipant.run(roomId, safeName, safeDeviceId);
    q.createInvite.run(inviteCode, roomId, String(roomSecret));
  })();
  const invite = q.findInviteByCode.get(inviteCode);
  const participant = q.findParticipant.get(roomId, safeDeviceId);
  return res.json({ ok: true, publicId, inviteLink: `${getBaseUrl(req)}/i/${inviteCode}`, inviteExpiresAt: toIsoUtc(invite.expires_at), participant: { id: participant.id, displayName: participant.display_name, deviceId: participant.device_id } });
});

app.post('/api/rooms/:publicId/recovery', (req, res) => {
  const room = q.findRoomByPublicId.get(req.params.publicId);
  if (!room) return res.status(404).json({ ok: false, error: 'room not found' });
  const { deviceId, recoverySalt, recoveryVerifier, recoverySecretIv, recoverySecretCiphertext } = req.body || {};
  const safeDeviceId = String(deviceId || '').slice(0, 64);
  if (!safeDeviceId || !recoverySalt || !recoveryVerifier || !recoverySecretIv || !recoverySecretCiphertext) {
    return res.status(400).json({ ok: false, error: 'recovery fields required' });
  }
  const participant = q.findParticipant.get(room.id, safeDeviceId);
  if (!participant) return res.status(403).json({ ok: false, error: 'forbidden' });
  q.upsertRecovery.run(room.id, safeDeviceId, recoverySalt, recoveryVerifier, recoverySecretIv, recoverySecretCiphertext);
  return res.json({ ok: true });
});

app.post('/api/recover', (req, res) => {
  const { recoveryCode, deviceIds } = req.body || {};
  if (!recoveryCode) return res.status(400).json({ error: 'recoveryCode required' });
  const safeDeviceIds = Array.isArray(deviceIds) ? [...new Set(deviceIds.map((id) => String(id || '').slice(0, 64)).filter(Boolean))] : [];
  if (safeDeviceIds.length === 0) return res.status(403).json({ error: 'recovery only allowed from existing participant device' });
  const recoveries = q.listRecoveriesWithRooms.all();
  for (const recovery of recoveries) {
    const digest = crypto.createHash('sha256').update(`${String(recoveryCode)}:${recovery.recovery_salt}`).digest('base64');
    if (digest !== recovery.recovery_verifier) continue;
    const room = q.findRoomByPublicId.get(recovery.public_id);
    const participant = q.listParticipantsByRoom.all(room.id).find((p) => safeDeviceIds.includes(p.device_id));
    if (!participant) return res.status(403).json({ error: 'recovery only allowed from existing participant device' });
    return res.json({
      publicId: recovery.public_id,
      deviceId: participant.device_id,
      recoverySalt: recovery.recovery_salt,
      recoverySecretIv: recovery.recovery_secret_iv,
      recoverySecretCiphertext: recovery.recovery_secret_ciphertext
    });
  }
  return res.status(403).json({ error: 'invalid recovery code' });
});
app.post('/api/rooms/:publicId/recover', (req, res) => { const { recoveryCode, deviceIds } = req.body || {}; if (!recoveryCode) return res.status(400).json({ error: 'recoveryCode required' }); const room = q.findRoomByPublicId.get(req.params.publicId); if (!room) return res.status(404).json({ error: 'room not found' }); const safeDeviceIds = Array.isArray(deviceIds) ? [...new Set(deviceIds.map((id) => String(id || '').slice(0, 64)).filter(Boolean))] : []; if (!safeDeviceIds.length) return res.status(403).json({ error: 'recovery only allowed from existing participant device' }); const hasParticipant = q.listParticipantsByRoom.all(room.id).some((p) => safeDeviceIds.includes(p.device_id)); if (!hasParticipant) return res.status(403).json({ error: 'recovery only allowed from existing participant device' }); const recoveries = q.listRecoveriesByRoomId.all(room.id); let matchedRecovery = null; for (const recovery of recoveries) { const digest = crypto.createHash('sha256').update(`${String(recoveryCode)}:${recovery.recovery_salt}`).digest('base64'); if (digest === recovery.recovery_verifier) { matchedRecovery = recovery; break; } } if (!matchedRecovery) return res.status(403).json({ error: 'invalid recovery code' }); return res.json({ recoverySalt: matchedRecovery.recovery_salt, recoverySecretIv: matchedRecovery.recovery_secret_iv, recoverySecretCiphertext: matchedRecovery.recovery_secret_ciphertext }); });
app.post('/api/invites/:inviteCode/join', (req, res) => { const { displayName, deviceId } = req.body || {}; if (!displayName || !deviceId) return res.status(400).json({ error: 'displayName and deviceId required' }); const invite = q.findInviteByCode.get(req.params.inviteCode); if (!invite) return res.status(404).json({ error: 'invite not found' }); if (invite.revoked || invite.used_at || !invite.room_secret) return res.status(410).json({ error: 'invite expired or used' }); if (new Date(`${invite.expires_at.replace(' ', 'T')}Z`).getTime() <= Date.now()) { cleanupExpiredSoloRooms(); return res.status(410).json({ error: 'invite expired or used' }); } const room = q.findRoomById.get(invite.room_id); if (!room) return res.status(404).json({ error: 'room not found' }); if (q.listParticipantsByRoom.all(room.id).length >= 2) return res.status(409).json({ error: 'room is full' }); const safeDeviceId = String(deviceId).slice(0, 64); const safeName = String(displayName).slice(0, 48); const roomSecret = invite.room_secret; const tx = db.transaction(() => { const info = q.consumeInvite.run(safeDeviceId, invite.id); if (!info.changes) return false; q.upsertParticipant.run(room.id, safeName, safeDeviceId); return true; }); if (!tx()) return res.status(410).json({ error: 'invite expired or used' }); const participant = q.findParticipant.get(room.id, safeDeviceId); const participants = q.listParticipantsByRoom.all(room.id).map((item) => ({ deviceId: item.device_id, displayName: item.display_name, online: Boolean(item.online), lastSeenAt: toIsoUtc(item.last_seen_at) })); const messages = hydrateMessages(q.listMessages.all(room.id)).map((m) => ({ ...m, created_at: toIsoUtc(m.created_at), delivered_at: toIsoUtc(m.delivered_at), read_at: toIsoUtc(m.read_at) })); const viewState = normalizeViewState(q.findViewStateByRoomDevice.get(room.id, safeDeviceId)); return res.json({ ok: true, publicId: room.public_id, roomSecret, participant: { id: participant.id, displayName: participant.display_name, deviceId: participant.device_id }, participants, messages, viewState }); });
app.get('/i/:publicId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/chat/:publicId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/api/rooms/:publicId', (req, res) => { const room = q.findRoomByPublicId.get(req.params.publicId); if (!room) return res.status(404).json({ error: 'room not found' }); return res.json({ publicId: room.public_id, createdAt: room.created_at }); });
app.post('/api/rooms/:publicId/join', (req, res) => { const room = q.findRoomByPublicId.get(req.params.publicId); if (!room) return res.status(404).json({ error: 'room not found' }); const { displayName, deviceId } = req.body || {}; if (!displayName || !deviceId) return res.status(400).json({ error: 'displayName and deviceId required' }); const safeDeviceId = String(deviceId).slice(0, 64); const participant = q.findParticipant.get(room.id, safeDeviceId); if (!participant) return res.status(403).json({ error: 'forbidden' }); q.upsertParticipant.run(room.id, String(displayName).slice(0, 48), safeDeviceId); const updated = q.findParticipant.get(room.id, safeDeviceId); const participants = q.listParticipantsByRoom.all(room.id).map((item) => ({ deviceId: item.device_id, displayName: item.display_name, online: Boolean(item.online), lastSeenAt: toIsoUtc(item.last_seen_at) })); const messages = hydrateMessages(q.listMessages.all(room.id)).map((m) => ({ ...m, created_at: toIsoUtc(m.created_at), delivered_at: toIsoUtc(m.delivered_at), read_at: toIsoUtc(m.read_at) })); const viewState = normalizeViewState(q.findViewStateByRoomDevice.get(room.id, safeDeviceId)); return res.json({ participant: { id: updated.id, displayName: updated.display_name, deviceId: updated.device_id }, participants, messages, viewState }); });

app.get('/api/rooms/:publicId/view-state', (req, res) => {
  const room = q.findRoomByPublicId.get(req.params.publicId);
  if (!room) return res.status(404).json({ ok: false, error: 'room not found' });
  const safeDeviceId = String(req.query?.deviceId || '').slice(0, 64);
  if (!safeDeviceId) return res.status(400).json({ ok: false, error: 'deviceId required' });
  if (!q.findParticipant.get(room.id, safeDeviceId)) return res.status(403).json({ ok: false, error: 'forbidden' });
  return res.json({ ok: true, viewState: normalizeViewState(q.findViewStateByRoomDevice.get(room.id, safeDeviceId)) });
});
app.put('/api/rooms/:publicId/view-state', (req, res) => {
  const room = q.findRoomByPublicId.get(req.params.publicId);
  if (!room) return res.status(404).json({ ok: false, error: 'room not found' });
  const safeDeviceId = String(req.body?.deviceId || '').slice(0, 64);
  if (!safeDeviceId) return res.status(400).json({ ok: false, error: 'deviceId required' });
  if (!q.findParticipant.get(room.id, safeDeviceId)) return res.status(403).json({ ok: false, error: 'forbidden' });
  let anchorMessageId = Number(req.body?.anchorMessageId ?? req.body?.anchor_message_id);
  if (!Number.isInteger(anchorMessageId) || anchorMessageId <= 0 || !q.findMessageInRoom.get(anchorMessageId, room.id)) anchorMessageId = null;
  const anchorOffsetPx = Math.max(-100000, Math.min(100000, Number.parseInt(req.body?.anchorOffsetPx ?? req.body?.anchor_offset_px ?? 0, 10) || 0));
  q.upsertViewState.run(room.id, safeDeviceId, anchorMessageId, anchorOffsetPx);
  return res.json({ ok: true });
});

app.get('/api/rooms/:publicId/draft', (req, res) => {
  const room = q.findRoomByPublicId.get(req.params.publicId);
  if (!room) return res.status(404).json({ ok: false, error: 'room not found' });
  const safeDeviceId = String(req.query?.deviceId || '').slice(0, 64);
  if (!safeDeviceId) return res.status(400).json({ ok: false, error: 'deviceId required' });
  if (!q.findParticipant.get(room.id, safeDeviceId)) return res.status(403).json({ ok: false, error: 'forbidden' });
  const draft = q.findDraftByRoomDevice.get(room.id, safeDeviceId);
  return res.json({ ok: true, draft: draft ? { ...draft, updated_at: toIsoUtc(draft.updated_at) } : null });
});
app.put('/api/rooms/:publicId/draft', (req, res) => {
  const room = q.findRoomByPublicId.get(req.params.publicId);
  if (!room) return res.status(404).json({ ok: false, error: 'room not found' });
  const safeDeviceId = String(req.body?.deviceId || '').slice(0, 64);
  if (!safeDeviceId) return res.status(400).json({ ok: false, error: 'deviceId required' });
  if (!q.findParticipant.get(room.id, safeDeviceId)) return res.status(403).json({ ok: false, error: 'forbidden' });
  const ciphertext = req.body?.ciphertext || null;
  const iv = req.body?.iv || null;
  const rawReplyId = req.body?.replyToMessageId ?? req.body?.reply_to_message_id;
  let replyToMessageId = Number(rawReplyId);
  if (!Number.isInteger(replyToMessageId) || replyToMessageId <= 0 || !q.findMessageInRoom.get(replyToMessageId, room.id)) replyToMessageId = null;
  if (ciphertext && !iv) return res.status(400).json({ ok: false, error: 'iv required when ciphertext exists' });
  if (!ciphertext && !replyToMessageId) { q.deleteDraftByRoomDevice.run(room.id, safeDeviceId); return res.json({ ok: true, deleted: true }); }
  q.upsertDraft.run(room.id, safeDeviceId, ciphertext, iv, replyToMessageId);
  return res.json({ ok: true });
});
app.delete('/api/rooms/:publicId/draft', (req, res) => {
  const room = q.findRoomByPublicId.get(req.params.publicId);
  if (!room) return res.status(404).json({ ok: false, error: 'room not found' });
  const safeDeviceId = String(req.body?.deviceId || '').slice(0, 64);
  if (!safeDeviceId) return res.status(400).json({ ok: false, error: 'deviceId required' });
  if (!q.findParticipant.get(room.id, safeDeviceId)) return res.status(403).json({ ok: false, error: 'forbidden' });
  q.deleteDraftByRoomDevice.run(room.id, safeDeviceId);
  return res.json({ ok: true });
});

function sendToRoomParticipants(roomPublicId, payload, exceptDeviceId = null) {
  const room = q.findRoomByPublicId.get(roomPublicId);
  if (!room) return;
  const participants = q.listParticipantsByRoom.all(room.id);
  const event = JSON.stringify(payload);
  for (const participant of participants) {
    if (exceptDeviceId && participant.device_id === exceptDeviceId) continue;
    const sockets = socketsByDevice.get(participant.device_id);
    if (!sockets) continue;
    for (const client of sockets) {
      if (client.readyState === WebSocket.OPEN) client.send(event);
    }
  }
}

function broadcastPresenceUpdate(roomPublicId, payload) { sendToRoomParticipants(roomPublicId, { type: 'presence:update', ...payload }); }
function hasVisibleSocketForDevice(deviceId) {
  const sockets = socketsByDevice.get(deviceId);
  if (!sockets) return false;
  for (const client of sockets) {
    if (client.readyState === WebSocket.OPEN && client.visible === true) return true;
  }
  return false;
}

function unregisterWsFromAllDevices(ws) {
  if (!ws?.deviceIds || !(ws.deviceIds instanceof Set)) return;
  for (const boundDeviceId of ws.deviceIds) {
    const bucket = socketsByDevice.get(boundDeviceId);
    if (!bucket) continue;
    bucket.delete(ws);
    if (bucket.size === 0) socketsByDevice.delete(boundDeviceId);
  }
}

function broadcastPresenceOfflineToParticipantRooms(deviceId) {
  const participantRooms = q.listParticipantRoomsByDevice.all(deviceId);
  for (const participant of participantRooms) {
    broadcastPresenceUpdate(participant.room_public_id, {
      deviceId: participant.device_id,
      displayName: participant.display_name,
      online: false,
      lastSeenAt: toIsoUtc(participant.last_seen_at)
    });
  }
}

app.post('/api/rooms/:publicId/media/upload', upload.fields([{ name: 'encryptedFile', maxCount: 1 }, { name: 'encryptedThumbnail', maxCount: 1 }]), (req, res) => {
  const room = q.findRoomByPublicId.get(req.params.publicId); if (!room) return res.status(404).json({ ok: false, error: 'room not found' });
  const deviceId = String(req.body?.deviceId || '').slice(0, 64); if (!q.findParticipant.get(room.id, deviceId)) return res.status(403).json({ ok: false, error: 'forbidden' });
  const mimeType = String(req.body?.mimeType || ''); const mediaKind = String(req.body?.mediaKind || '');
  const allowed = new Set(['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']);
  if (!allowed.has(mimeType)) return res.status(400).json({ ok: false, error: 'mime not allowed' });
  if (!['image','video'].includes(mediaKind)) return res.status(400).json({ ok: false, error: 'mediaKind invalid' });
  const sizeBytes = Number(req.body?.sizeBytes || 0); if (mediaKind === 'image' && sizeBytes > 10*1024*1024) return res.status(400).json({ ok:false,error:'image too large' }); if (mediaKind === 'video' && sizeBytes > 100*1024*1024) return res.status(400).json({ ok:false,error:'video too large' });
  const encryptedFile = req.files?.encryptedFile?.[0]; if (!encryptedFile) return res.status(400).json({ ok:false,error:'encryptedFile required' });
  const encryptedThumb = req.files?.encryptedThumbnail?.[0] || null;
  const publicId = randomToken(24);
  const serverFilename = `media_${publicId}.bin`; const thumbFilename = encryptedThumb ? `thumb_${publicId}.bin` : null;
  fs.writeFileSync(path.join(UPLOAD_DIR, serverFilename), encryptedFile.buffer); if (encryptedThumb) fs.writeFileSync(path.join(UPLOAD_DIR, thumbFilename), encryptedThumb.buffer);
  const info = q.createMedia.run(publicId, room.id, Number(req.body?.fileOrder || 0), serverFilename, thumbFilename, req.body?.originalNameCiphertext || null, req.body?.originalNameIv || null, mimeType, mediaKind, sizeBytes, Number(req.body?.encryptedSizeBytes || encryptedFile.size), Number(req.body?.thumbSizeBytes || 0) || null, Number(req.body?.thumbEncryptedSizeBytes || 0) || null, Number(req.body?.width || 0) || null, Number(req.body?.height || 0) || null, Number(req.body?.durationSeconds || 0) || null);
  const media = q.findMediaByPublicId.get(publicId);
  return res.json({ ok: true, media: mediaToDto(media, req) });
});
app.get('/api/media/:publicId/blob', (req,res)=>{ const media=q.findMediaByPublicId.get(req.params.publicId); if(!media) return res.status(404).end(); const deviceId=String(req.query.deviceId||'').slice(0,64); if(!q.findParticipant.get(media.room_id,deviceId)) return res.status(403).end(); const filePath=path.join(UPLOAD_DIR, media.server_filename); if(!fs.existsSync(filePath)) return res.status(404).end(); res.setHeader('Content-Type','application/octet-stream'); res.sendFile(filePath);});
app.get('/api/media/:publicId/thumb', (req,res)=>{ const media=q.findMediaByPublicId.get(req.params.publicId); if(!media||!media.thumbnail_filename) return res.status(404).end(); const deviceId=String(req.query.deviceId||'').slice(0,64); if(!q.findParticipant.get(media.room_id,deviceId)) return res.status(403).end(); const filePath=path.join(UPLOAD_DIR, media.thumbnail_filename); if(!fs.existsSync(filePath)) return res.status(404).end(); res.setHeader('Content-Type','application/octet-stream'); res.sendFile(filePath);});
app.delete('/api/rooms/:publicId/media/pending', (req,res)=>{ const room=q.findRoomByPublicId.get(req.params.publicId); if(!room) return res.status(404).json({ok:false,error:'room not found'}); const deviceId=String(req.body?.deviceId||'').slice(0,64); if(!q.findParticipant.get(room.id,deviceId)) return res.status(403).json({ok:false,error:'forbidden'}); const mediaIds=Array.isArray(req.body?.mediaIds)?req.body.mediaIds.map(Number).filter(Boolean):[]; const rows=q.listPendingMediaByIds.all(room.id, JSON.stringify(mediaIds)); for(const m of rows){safeUnlink(m.server_filename);safeUnlink(m.thumbnail_filename);} q.deletePendingMediaByIds.run(room.id, JSON.stringify(mediaIds)); res.json({ok:true,deleted:rows.length});});


const server = http.createServer(app); const wss = new WebSocket.Server({ server });
wss.on('connection', (ws, req) => { const url = new URL(req.url, `http://${APP_HOST}:${APP_PORT}`); const deviceId = url.searchParams.get('device'); if (!deviceId) return ws.close(); ws.deviceId = deviceId; ws.deviceIds = new Set([deviceId]); ws.visible = false; ws.activeRoomId = null; ws.subscribedRooms = new Set(); const participantRooms = q.listParticipantRoomsByDevice.all(ws.deviceId); for (const participant of participantRooms) ws.subscribedRooms.add(participant.room_public_id); const set = getDeviceSockets(deviceId); set.add(ws);
  for (const participant of participantRooms) {
    q.setParticipantOnline.run(participant.room_id, ws.deviceId);
    broadcastPresenceUpdate(participant.room_public_id, {
      deviceId: participant.device_id,
      displayName: participant.display_name,
      online: true,
      lastSeenAt: toIsoUtc(participant.last_seen_at)
    });
  }
  ws.on('message', async (raw) => { let payload; try { payload = JSON.parse(raw.toString()); } catch { return; }
    if (payload.type === 'client:state') { ws.activeRoomId = payload.activeRoomId || null; ws.visible = Boolean(payload.visible); return; }
    if (payload.type === 'message:new') { const room = q.findRoomByPublicId.get(String(payload.roomId || '')); if (!room) return; const sender = q.findParticipant.get(room.id, ws.deviceId); if (!sender || !payload.ciphertext || !payload.iv) return; const rawReplyId = payload.replyToMessageId ?? payload.reply_to_message_id; let replyToMessageId = Number(rawReplyId); if (!Number.isInteger(replyToMessageId) || replyToMessageId <= 0 || !q.findMessageInRoom.get(replyToMessageId, room.id)) replyToMessageId = null; const msgType = payload.messageType === 'media' ? 'media' : 'text'; let mediaItems = []; if (msgType === 'media') { const ids = Array.isArray(payload.mediaIds) ? payload.mediaIds.map(Number).filter(Boolean) : []; if (!ids.length) return; mediaItems = q.listPendingMediaByIds.all(room.id, JSON.stringify(ids)); if (mediaItems.length !== ids.length || mediaItems.some((m) => m.status !== 'pending' || m.message_id !== null)) return; } const result = q.createMessage.run(room.id, sender.id, payload.ciphertext, payload.iv, msgType, replyToMessageId); const event = { type: 'message:new', roomId: room.public_id, message: { id: result.lastInsertRowid, ciphertext: payload.ciphertext, iv: payload.iv, reply_to_message_id: replyToMessageId, status: 'sent', created_at: new Date().toISOString(), delivered_at: null, read_at: null, sender_name: sender.display_name, sender_device_id: sender.device_id, type: msgType, media: [] } }; if (msgType === 'media') { for (const media of mediaItems) { q.attachMediaToMessage.run(result.lastInsertRowid, media.id, room.id); } event.message.media = q.listMediaByMessageId.all(result.lastInsertRowid).map((m) => ({ ...m, thumbnail_url: `${PUBLIC_BASE_URL || ''}/api/media/${m.public_id}/thumb` })); } let deliveredNotified = false; const participants = q.listParticipantsByRoom.all(room.id); for (const p of participants) { const sockets = socketsByDevice.get(p.device_id); if (!sockets) continue; for (const client of sockets) { if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify(event)); if (client.deviceId !== ws.deviceId) { const info = q.markDelivered.run(result.lastInsertRowid); if (info.changes && !deliveredNotified) { deliveredNotified = true; ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'message:status', roomId: room.public_id, messageId: result.lastInsertRowid, status: 'delivered', deliveredAt: new Date().toISOString() })); } } } } }
      // notificationPreview is intentionally plaintext for push preview: privacy/usability tradeoff.
      const preview = typeof payload.notificationPreview === 'string' ? payload.notificationPreview.slice(0, 80) : '';
            const pushDelivered = await sendPushForMessage({ roomId: room.id, roomPublicId: room.public_id, senderDeviceId: ws.deviceId, senderName: sender.display_name, preview });
      if (pushDelivered && !deliveredNotified) {
        const info = q.markDelivered.run(result.lastInsertRowid);
        if (info.changes && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'message:status', roomId: room.public_id, messageId: result.lastInsertRowid, status: 'delivered', deliveredAt: new Date().toISOString() }));
        }
      }
    }
    if (payload.type === 'message:read:bulk' && Array.isArray(payload.messageIds)) {
      const room = q.findRoomByPublicId.get(String(payload.roomId || '')); if (!room) return;
      const sender = q.findParticipant.get(room.id, ws.deviceId);
      if (!sender) return;
      const ids = payload.messageIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
      if (!ids.length) return;
      for (const id of ids) {
        const info = q.markReadBulk.run(room.id, id, sender.id);
        if (!info.changes) continue;
        const event = { type: 'message:status', roomId: room.public_id, messageId: id, status: 'read', readAt: new Date().toISOString() };
        sendToRoomParticipants(room.public_id, event);
      }
    }
  });


  ws.on('close', () => {
    unregisterWsFromAllDevices(ws);
    const stillOnline = socketsByDevice.has(ws.deviceId) && [...socketsByDevice.get(ws.deviceId)].some((sock) => sock.readyState === WebSocket.OPEN);
    if (!stillOnline) {
      const participantRoomsOnClose = q.listParticipantRoomsByDevice.all(ws.deviceId);
      for (const participant of participantRoomsOnClose) q.setParticipantOffline.run(participant.room_id, ws.deviceId);
      broadcastPresenceOfflineToParticipantRooms(ws.deviceId);
    }
  });
});

cleanupExpiredSoloRooms();
setInterval(cleanupExpiredSoloRooms, 10 * 60 * 1000);
server.listen(APP_PORT, APP_HOST, () => console.log(`FPChat listening on http://${APP_HOST}:${APP_PORT}`));
