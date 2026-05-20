const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const { createDb } = require('./src/db');

dotenv.config();

const APP_HOST = process.env.APP_HOST || '127.0.0.1';
const APP_PORT = Number(process.env.APP_PORT || 3010);
const DATABASE_PATH = process.env.DATABASE_PATH || './data/chat.sqlite';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';

const db = createDb(DATABASE_PATH);
const app = express();
app.use(express.json({ limit: '128kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const socketsByRoom = new Map();

const q = {
  createRoom: db.prepare('INSERT INTO rooms (public_id) VALUES (?)'),
  findRoomByPublicId: db.prepare('SELECT * FROM rooms WHERE public_id = ?'),
  createRecovery: db.prepare(`
    INSERT INTO recovery (room_id, recovery_salt, recovery_verifier, recovery_secret_iv, recovery_secret_ciphertext)
    VALUES (?, ?, ?, ?, ?)
  `),
  findRecoveryByPublicId: db.prepare(`
    SELECT rec.recovery_salt, rec.recovery_verifier, rec.recovery_secret_iv, rec.recovery_secret_ciphertext
    FROM recovery rec
    JOIN rooms room ON room.id = rec.room_id
    WHERE room.public_id = ?
  `),
  upsertParticipant: db.prepare(`
    INSERT INTO participants (room_id, display_name, device_id, last_seen_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(room_id, device_id)
    DO UPDATE SET display_name = excluded.display_name, last_seen_at = datetime('now')
  `),
  findParticipant: db.prepare('SELECT * FROM participants WHERE room_id = ? AND device_id = ?'),
  listMessages: db.prepare(`
    SELECT m.id, m.ciphertext, m.iv, m.status, m.created_at, m.delivered_at, m.read_at,
           p.display_name as sender_name, p.device_id as sender_device_id
    FROM messages m
    JOIN participants p ON p.id = m.sender_id
    WHERE m.room_id = ?
    ORDER BY m.id ASC
  `),
  createMessage: db.prepare(`
    INSERT INTO messages (room_id, sender_id, ciphertext, iv, status)
    VALUES (?, ?, ?, ?, 'sent')
  `),
  updateDelivered: db.prepare("UPDATE messages SET status = 'delivered', delivered_at = datetime('now') WHERE id = ?"),
  updateRead: db.prepare("UPDATE messages SET status = 'read', read_at = datetime('now') WHERE id = ?")
};

function randomToken(length) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  while (out.length < length) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

function roomSockets(publicId) {
  if (!socketsByRoom.has(publicId)) socketsByRoom.set(publicId, new Set());
  return socketsByRoom.get(publicId);
}

function getBaseUrl(req) {
  if (PUBLIC_BASE_URL) {
    return PUBLIC_BASE_URL.replace(/\/+$/, '');
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const protocol = forwardedProto ? String(forwardedProto).split(',')[0].trim() : req.protocol;
  const host = forwardedHost ? String(forwardedHost).split(',')[0].trim() : req.headers.host;

  return `${protocol}://${host}`;
}

app.post('/api/rooms', (req, res) => {
  const publicId = randomToken(16);
  const { recoverySalt, recoveryVerifier, recoverySecretIv, recoverySecretCiphertext } = req.body || {};

  if (!recoverySalt || !recoveryVerifier || !recoverySecretIv || !recoverySecretCiphertext) {
    return res.status(400).json({ error: 'recovery verifier required' });
  }

  const tx = db.transaction(() => {
    const roomResult = q.createRoom.run(publicId);
    q.createRecovery.run(roomResult.lastInsertRowid, recoverySalt, recoveryVerifier, recoverySecretIv, recoverySecretCiphertext);
  });
  tx();

  const inviteLink = `${getBaseUrl(req)}/i/${publicId}`;
  return res.json({ publicId, inviteLink });
});

app.post('/api/rooms/:publicId/recover', async (req, res) => {
  const { recoveryCode } = req.body || {};
  if (!recoveryCode) return res.status(400).json({ error: 'recoveryCode required' });

  const recovery = q.findRecoveryByPublicId.get(req.params.publicId);
  if (!recovery) return res.status(404).json({ error: 'room not found' });

  const digest = crypto
    .createHash('sha256')
    .update(`${String(recoveryCode)}:${recovery.recovery_salt}`)
    .digest('base64');

  if (digest !== recovery.recovery_verifier) {
    return res.status(403).json({ error: 'invalid recovery code' });
  }

  return res.json({
    recoverySalt: recovery.recovery_salt,
    recoverySecretIv: recovery.recovery_secret_iv,
    recoverySecretCiphertext: recovery.recovery_secret_ciphertext
  });
});

app.get('/i/:publicId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/chat/:publicId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/rooms/:publicId', (req, res) => {
  const room = q.findRoomByPublicId.get(req.params.publicId);
  if (!room) return res.status(404).json({ error: 'room not found' });
  return res.json({ publicId: room.public_id, createdAt: room.created_at });
});

app.post('/api/rooms/:publicId/join', (req, res) => {
  const room = q.findRoomByPublicId.get(req.params.publicId);
  if (!room) return res.status(404).json({ error: 'room not found' });

  const { displayName, deviceId } = req.body || {};
  if (!displayName || !deviceId) return res.status(400).json({ error: 'displayName and deviceId required' });

  q.upsertParticipant.run(room.id, String(displayName).slice(0, 48), String(deviceId).slice(0, 64));
  const participant = q.findParticipant.get(room.id, deviceId);
  const messages = q.listMessages.all(room.id);

  return res.json({
    participant: { id: participant.id, displayName: participant.display_name, deviceId: participant.device_id },
    messages
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${APP_HOST}:${APP_PORT}`);
  const roomPublicId = url.searchParams.get('room');
  const deviceId = url.searchParams.get('device');
  if (!roomPublicId || !deviceId) return ws.close();

  const room = q.findRoomByPublicId.get(roomPublicId);
  if (!room) return ws.close();

  ws.roomPublicId = roomPublicId;
  ws.deviceId = deviceId;
  ws.roomId = room.id;

  const set = roomSockets(roomPublicId);
  set.add(ws);

  ws.on('message', (raw) => {
    let payload;
    try { payload = JSON.parse(raw.toString()); } catch { return; }

    if (payload.type === 'message:new') {
      const sender = q.findParticipant.get(ws.roomId, ws.deviceId);
      if (!sender) return;
      if (!payload.ciphertext || !payload.iv) return;

      const result = q.createMessage.run(ws.roomId, sender.id, payload.ciphertext, payload.iv);
      const event = {
        type: 'message:new',
        message: {
          id: result.lastInsertRowid,
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          status: 'sent',
          created_at: new Date().toISOString(),
          delivered_at: null,
          read_at: null,
          sender_name: sender.display_name,
          sender_device_id: sender.device_id
        }
      };

      for (const client of set) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(event));
          if (client !== ws) q.updateDelivered.run(result.lastInsertRowid);
        }
      }
    }

    if (payload.type === 'message:read' && payload.messageId) {
      q.updateRead.run(payload.messageId);
      const event = { type: 'message:status', messageId: payload.messageId, status: 'read', readAt: new Date().toISOString() };
      for (const client of set) {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
      }
    }
  });

  ws.on('close', () => {
    set.delete(ws);
    if (set.size === 0) socketsByRoom.delete(roomPublicId);
  });
});

server.listen(APP_PORT, APP_HOST, () => {
  console.log(`FPChat listening on http://${APP_HOST}:${APP_PORT}`);
});
