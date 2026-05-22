const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const webpush = require('web-push');
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
const app = express();
app.use(express.json({ limit: '128kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const socketsByRoom = new Map();

const q = {
  createRoom: db.prepare('INSERT INTO rooms (public_id) VALUES (?)'),
  findRoomByPublicId: db.prepare('SELECT * FROM rooms WHERE public_id = ?'),
  findRoomById: db.prepare('SELECT * FROM rooms WHERE id = ?'),
  createRecovery: db.prepare(`INSERT INTO recovery (room_id, recovery_salt, recovery_verifier, recovery_secret_iv, recovery_secret_ciphertext) VALUES (?, ?, ?, ?, ?)`),
  findRecoveryByPublicId: db.prepare(`SELECT rec.recovery_salt, rec.recovery_verifier, rec.recovery_secret_iv, rec.recovery_secret_ciphertext FROM recovery rec JOIN rooms room ON room.id = rec.room_id WHERE room.public_id = ?`),
  upsertParticipant: db.prepare(`INSERT INTO participants (room_id, display_name, device_id, last_seen_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(room_id, device_id) DO UPDATE SET display_name = excluded.display_name, last_seen_at = datetime('now')`),
  findParticipant: db.prepare('SELECT * FROM participants WHERE room_id = ? AND device_id = ?'),
  listMessages: db.prepare(`SELECT m.id, m.ciphertext, m.iv, m.status, m.created_at, m.delivered_at, m.read_at, p.display_name as sender_name, p.device_id as sender_device_id FROM messages m JOIN participants p ON p.id = m.sender_id WHERE m.room_id = ? ORDER BY m.id ASC`),
  createMessage: db.prepare(`INSERT INTO messages (room_id, sender_id, ciphertext, iv, status) VALUES (?, ?, ?, ?, 'sent')`),
  markDelivered: db.prepare(`UPDATE messages
    SET status = CASE WHEN status = 'sent' THEN 'delivered' ELSE status END,
        delivered_at = CASE WHEN status = 'sent' THEN datetime('now') ELSE delivered_at END
    WHERE id = ?`),
  markReadBulk: db.prepare(`UPDATE messages
    SET status = 'read',
        read_at = CASE WHEN read_at IS NULL THEN datetime('now') ELSE read_at END
    WHERE room_id = ? AND id = ? AND sender_id != ? AND status != 'read'`),
  upsertPushSub: db.prepare(`INSERT INTO push_subscriptions (room_id, device_id, endpoint, p256dh, auth, muted, show_text, hide_sender, updated_at) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT muted FROM push_subscriptions WHERE room_id=? AND device_id=? AND endpoint=?),0), ?, ?, datetime('now')) ON CONFLICT(room_id, device_id, endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, show_text=excluded.show_text, hide_sender=excluded.hide_sender, updated_at=datetime('now')`),
  updatePushSettings: db.prepare(`UPDATE push_subscriptions SET show_text=?, hide_sender=?, updated_at=datetime('now') WHERE room_id=? AND device_id=?`),
  mutePushRoom: db.prepare(`UPDATE push_subscriptions SET muted=?, updated_at=datetime('now') WHERE room_id=? AND device_id=?`),
  deletePushByDeviceRoom: db.prepare('DELETE FROM push_subscriptions WHERE device_id = ? AND room_id = ?'),
  deletePushByDevice: db.prepare('DELETE FROM push_subscriptions WHERE device_id = ?'),
  listPushForRoom: db.prepare(`SELECT ps.*, r.public_id as room_public_id, p.display_name as device_name FROM push_subscriptions ps JOIN rooms r ON r.id = ps.room_id JOIN participants p ON p.room_id = ps.room_id AND p.device_id = ps.device_id WHERE ps.room_id = ?`),
  deletePushById: db.prepare('DELETE FROM push_subscriptions WHERE id = ?')
};

function randomToken(length) { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let out = ''; while (out.length < length) out += alphabet[crypto.randomInt(0, alphabet.length)]; return out; }
function roomSockets(publicId) { if (!socketsByRoom.has(publicId)) socketsByRoom.set(publicId, new Set()); return socketsByRoom.get(publicId); }
function getBaseUrl(req) { if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/+$/, ''); const protocol = req.headers['x-forwarded-proto']?.split(',')[0].trim() || req.protocol; const host = req.headers['x-forwarded-host']?.split(',')[0].trim() || req.headers.host; return `${protocol}://${host}`; }
function pushOff(res) { return res.status(503).json({ ok: false, error: 'push disabled on server' }); }
function getRoomByInput(roomId) { return q.findRoomByPublicId.get(roomId) || q.findRoomById.get(Number(roomId)); }

app.get('/api/push/vapid-public-key', (req, res) => res.json(pushEnabled ? { enabled: true, publicKey: VAPID_PUBLIC_KEY } : { enabled: false }));
app.post('/api/push/subscribe', (req, res) => {
  if (!pushEnabled) return pushOff(res);
  const { roomId, deviceId, subscription, settings } = req.body || {};
  const room = getRoomByInput(roomId);
  if (!room) return res.status(404).json({ ok: false, error: 'room not found' });
  if (!q.findParticipant.get(room.id, deviceId)) return res.status(403).json({ ok: false, error: 'forbidden' });
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) return res.status(400).json({ ok: false, error: 'invalid subscription' });
  q.upsertPushSub.run(room.id, String(deviceId).slice(0, 64), endpoint, p256dh, auth, room.id, String(deviceId).slice(0, 64), endpoint, settings?.showText ? 1 : 0, settings?.hideSender ? 1 : 0);
  res.json({ ok: true });
});

app.post('/api/push/settings', (req, res) => {
  if (!pushEnabled) return pushOff(res);
  const room = getRoomByInput(req.body?.roomId); if (!room) return res.status(404).json({ ok: false, error: 'room not found' });
  const info = q.updatePushSettings.run(req.body?.showText ? 1 : 0, req.body?.hideSender ? 1 : 0, room.id, String(req.body?.deviceId || '').slice(0, 64));
  if (!info.changes) return res.status(404).json({ ok: false, error: 'subscription not found' });
  res.json({ ok: true });
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
    const roomSet = socketsByRoom.get(roomPublicId);
    const hasOpenSameRoom = roomSet && [...roomSet].some((sock) => sock.deviceId === sub.device_id && sock.roomPublicId === roomPublicId && sock.readyState === WebSocket.OPEN);
    if (hasOpenSameRoom) continue;
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
app.post('/api/rooms', (req, res) => { const publicId = randomToken(16); const { recoverySalt, recoveryVerifier, recoverySecretIv, recoverySecretCiphertext } = req.body || {}; if (!recoverySalt || !recoveryVerifier || !recoverySecretIv || !recoverySecretCiphertext) return res.status(400).json({ error: 'recovery verifier required' }); db.transaction(() => { const roomResult = q.createRoom.run(publicId); q.createRecovery.run(roomResult.lastInsertRowid, recoverySalt, recoveryVerifier, recoverySecretIv, recoverySecretCiphertext); })(); return res.json({ publicId, inviteLink: `${getBaseUrl(req)}/i/${publicId}` }); });
app.post('/api/rooms/:publicId/recover', (req, res) => { const { recoveryCode } = req.body || {}; if (!recoveryCode) return res.status(400).json({ error: 'recoveryCode required' }); const recovery = q.findRecoveryByPublicId.get(req.params.publicId); if (!recovery) return res.status(404).json({ error: 'room not found' }); const digest = crypto.createHash('sha256').update(`${String(recoveryCode)}:${recovery.recovery_salt}`).digest('base64'); if (digest !== recovery.recovery_verifier) return res.status(403).json({ error: 'invalid recovery code' }); return res.json({ recoverySalt: recovery.recovery_salt, recoverySecretIv: recovery.recovery_secret_iv, recoverySecretCiphertext: recovery.recovery_secret_ciphertext }); });
app.get('/i/:publicId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/chat/:publicId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/api/rooms/:publicId', (req, res) => { const room = q.findRoomByPublicId.get(req.params.publicId); if (!room) return res.status(404).json({ error: 'room not found' }); return res.json({ publicId: room.public_id, createdAt: room.created_at }); });
app.post('/api/rooms/:publicId/join', (req, res) => { const room = q.findRoomByPublicId.get(req.params.publicId); if (!room) return res.status(404).json({ error: 'room not found' }); const { displayName, deviceId } = req.body || {}; if (!displayName || !deviceId) return res.status(400).json({ error: 'displayName and deviceId required' }); q.upsertParticipant.run(room.id, String(displayName).slice(0, 48), String(deviceId).slice(0, 64)); const participant = q.findParticipant.get(room.id, deviceId); return res.json({ participant: { id: participant.id, displayName: participant.display_name, deviceId: participant.device_id }, messages: q.listMessages.all(room.id) }); });

const server = http.createServer(app); const wss = new WebSocket.Server({ server });
wss.on('connection', (ws, req) => { const url = new URL(req.url, `http://${APP_HOST}:${APP_PORT}`); const roomPublicId = url.searchParams.get('room'); const deviceId = url.searchParams.get('device'); if (!roomPublicId || !deviceId) return ws.close(); const room = q.findRoomByPublicId.get(roomPublicId); if (!room) return ws.close(); ws.roomPublicId = roomPublicId; ws.deviceId = deviceId; ws.roomId = room.id; const set = roomSockets(roomPublicId); set.add(ws);
  ws.on('message', async (raw) => { let payload; try { payload = JSON.parse(raw.toString()); } catch { return; }
    if (payload.type === 'message:new') { const sender = q.findParticipant.get(ws.roomId, ws.deviceId); if (!sender || !payload.ciphertext || !payload.iv) return; const result = q.createMessage.run(ws.roomId, sender.id, payload.ciphertext, payload.iv); const event = { type: 'message:new', message: { id: result.lastInsertRowid, ciphertext: payload.ciphertext, iv: payload.iv, status: 'sent', created_at: new Date().toISOString(), delivered_at: null, read_at: null, sender_name: sender.display_name, sender_device_id: sender.device_id } }; let deliveredNotified = false; for (const client of set) { if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify(event)); if (client !== ws) { const info = q.markDelivered.run(result.lastInsertRowid); if (info.changes && !deliveredNotified) { deliveredNotified = true; ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'message:status', messageId: result.lastInsertRowid, status: 'delivered', deliveredAt: new Date().toISOString() })); } } } }
      // notificationPreview is intentionally plaintext for push preview: privacy/usability tradeoff.
      const preview = typeof payload.notificationPreview === 'string' ? payload.notificationPreview.slice(0, 80) : '';
            const pushDelivered = await sendPushForMessage({ roomId: ws.roomId, roomPublicId, senderDeviceId: ws.deviceId, senderName: sender.display_name, preview });
      if (pushDelivered && !deliveredNotified) {
        const info = q.markDelivered.run(result.lastInsertRowid);
        if (info.changes && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'message:status', messageId: result.lastInsertRowid, status: 'delivered', deliveredAt: new Date().toISOString() }));
        }
      }
    }
    if (payload.type === 'message:read:bulk' && Array.isArray(payload.messageIds)) {
      const sender = q.findParticipant.get(ws.roomId, ws.deviceId);
      if (!sender) return;
      const ids = payload.messageIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
      if (!ids.length) return;
      for (const id of ids) {
        const info = q.markReadBulk.run(ws.roomId, id, sender.id);
        if (!info.changes) continue;
        const event = { type: 'message:status', messageId: id, status: 'read', readAt: new Date().toISOString() };
        for (const client of set) if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
      }
    }
  });


  ws.on('close', () => { set.delete(ws); if (set.size === 0) socketsByRoom.delete(roomPublicId); });
});

server.listen(APP_PORT, APP_HOST, () => console.log(`FPChat listening on http://${APP_HOST}:${APP_PORT}`));
