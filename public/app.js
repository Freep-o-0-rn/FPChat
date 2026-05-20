const STORAGE = {
  roomState(roomId) { return `fpchat:room:${roomId}`; },
  activeChatsKey: 'fpchat:active-chats',
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  get(k) { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; },
  setActiveChats(items) { this.set(this.activeChatsKey, items); },
  getActiveChats() { return this.get(this.activeChatsKey) || []; }
};

const els = {
  createView: document.getElementById('createView'),
  createRoomBtn: document.getElementById('createRoomBtn'),
  createdResult: document.getElementById('createdResult'),
  inviteLink: document.getElementById('inviteLink'),
  recoveryCode: document.getElementById('recoveryCode'),
  goToChatBtn: document.getElementById('goToChatBtn'),
  activeChatsList: document.getElementById('activeChatsList'),
  joinView: document.getElementById('joinView'),
  roomLabel: document.getElementById('roomLabel'),
  displayNameInput: document.getElementById('displayNameInput'),
  joinBtn: document.getElementById('joinBtn'),
  joinGoToChatBtn: document.getElementById('joinGoToChatBtn'),
  chatView: document.getElementById('chatView'),
  chatRoomId: document.getElementById('chatRoomId'),
  messages: document.getElementById('messages'),
  sendForm: document.getElementById('sendForm'),
  messageInput: document.getElementById('messageInput')
};

let state = { roomId: null, secret: null, ws: null, me: null, key: null };

function upsertActiveChat(roomId, patch = {}) {
  const chats = STORAGE.getActiveChats();
  const now = new Date().toISOString();
  const index = chats.findIndex(item => item.roomId === roomId);
  const existing = index >= 0 ? chats[index] : { roomId, createdAt: now };
  const next = { ...existing, ...patch, roomId, lastOpenedAt: patch.lastOpenedAt || now };
  if (index >= 0) chats[index] = next; else chats.unshift(next);
  STORAGE.setActiveChats(chats.slice(0, 100));
}

function renderActiveChats() {
  const chats = STORAGE.getActiveChats();
  if (!chats.length) {
    els.activeChatsList.textContent = 'На этом устройстве пока нет активных чатов';
    return;
  }
  els.activeChatsList.innerHTML = '';
  chats
    .slice()
    .sort((a, b) => new Date(b.lastOpenedAt || 0) - new Date(a.lastOpenedAt || 0))
    .forEach(chat => {
      const row = document.createElement('div');
      row.className = 'chat-row';
      const title = chat.nickname ? `${chat.nickname} (${chat.roomId.slice(0, 8)}...)` : chat.roomId;
      const lastOpen = chat.lastOpenedAt ? new Date(chat.lastOpenedAt).toLocaleString() : '—';
      const lastMessage = chat.lastMessage || '—';
      row.innerHTML = `<div><div><strong>${title}</strong></div><div class="chat-meta">Последнее открытие: ${lastOpen}</div><div class="chat-meta">Последнее сообщение: ${lastMessage}</div></div>`;
      const btn = document.createElement('button');
      btn.textContent = 'Открыть чат';
      btn.addEventListener('click', () => {
        window.location.href = `/chat/${chat.roomId}`;
      });
      row.appendChild(btn);
      els.activeChatsList.appendChild(row);
    });
}

const b64 = {
  encode: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  decode: (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0))
};

async function deriveKey(secret) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('fpchat-room-salt-v1'), iterations: 150000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function randomRoomSecret() { return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''); }
function randomDeviceId() { return crypto.randomUUID(); }
function randomRecoveryCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }).map(() => a[Math.floor(Math.random() * a.length)]).join('');
  return `R-${part()}-${part()}-${part()}-${part()}-${part()}`;
}

async function hashRecovery(recoveryCode) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const input = new TextEncoder().encode(recoveryCode + ':' + b64.encode(salt));
  const digest = await crypto.subtle.digest('SHA-256', input);
  return { recoverySalt: b64.encode(salt), recoveryVerifier: b64.encode(digest) };
}

async function encryptText(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, state.key, new TextEncoder().encode(text));
  return { iv: b64.encode(iv), ciphertext: b64.encode(ciphertext) };
}

async function decryptText(iv, ciphertext) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.decode(iv) }, state.key, b64.decode(ciphertext));
  return new TextDecoder().decode(plain);
}

function renderMessage(item, decrypted, mine) {
  const div = document.createElement('div');
  div.className = 'msg';
  div.dataset.id = item.id;
  div.innerHTML = `<div><b>${item.sender_name}</b>: ${decrypted}</div>
    <div class="meta">${new Date(item.created_at).toLocaleString()} · ${item.status}${mine ? ' (you)' : ''}</div>`;
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function parseInvite() {
  const m = location.pathname.match(/^\/i\/([A-Z0-9]{16})$/);
  if (!m) return null;
  const roomId = m[1];
  const secret = location.hash ? location.hash.slice(1) : null;
  if (secret) history.replaceState({}, '', `/i/${roomId}`);
  return { roomId, secret };
}

function parseChatPath() {
  const m = location.pathname.match(/^\/chat\/([A-Z0-9]{16})$/);
  if (!m) return null;
  return { roomId: m[1] };
}

async function initFromInvite() {
  const invite = parseInvite();
  const directChat = parseChatPath();
  if (!invite && !directChat) return;

  state.roomId = invite?.roomId || directChat.roomId;
  const stored = STORAGE.get(STORAGE.roomState(state.roomId));
  state.secret = invite?.secret || stored?.secret;
  if (!state.secret) return alert('Нет секрета для расшифровки invite-ссылки');
  STORAGE.set(STORAGE.roomState(state.roomId), { ...stored, secret: state.secret, deviceId: stored?.deviceId || randomDeviceId() });
  state.key = await deriveKey(state.secret);
  els.createView.classList.add('hidden');
  els.joinView.classList.remove('hidden');
  els.roomLabel.textContent = `Комната: ${state.roomId}`;
}

async function createRoom() {
  const secret = randomRoomSecret();
  const recoveryCode = randomRecoveryCode();
  const { recoverySalt, recoveryVerifier } = await hashRecovery(recoveryCode);
  const res = await fetch('/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recoverySalt, recoveryVerifier })
  });
  const data = await res.json();
  const invite = `${data.inviteLink}#${secret}`;

  els.createdResult.classList.remove('hidden');
  els.inviteLink.value = invite;
  els.recoveryCode.textContent = recoveryCode;

  STORAGE.set(STORAGE.roomState(data.publicId), { secret, deviceId: randomDeviceId() });
  upsertActiveChat(data.publicId);
  renderActiveChats();

  els.goToChatBtn.onclick = () => {
    window.location.href = `/chat/${data.publicId}`;
  };
}

async function joinRoom() {
  const displayName = els.displayNameInput.value.trim();
  if (!displayName) return;

  const persisted = STORAGE.get(STORAGE.roomState(state.roomId));
  const deviceId = persisted?.deviceId || randomDeviceId();
  STORAGE.set(STORAGE.roomState(state.roomId), { ...persisted, deviceId, secret: state.secret });

  const res = await fetch(`/api/rooms/${state.roomId}/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName, deviceId })
  });
  const data = await res.json();
  state.me = data.participant;
  upsertActiveChat(state.roomId, { nickname: displayName });
  renderActiveChats();
  els.joinGoToChatBtn.classList.remove('hidden');
  els.joinGoToChatBtn.onclick = () => { window.location.href = `/chat/${state.roomId}`; };

  els.joinView.classList.add('hidden');
  els.chatView.classList.remove('hidden');
  els.chatRoomId.textContent = state.roomId;
  els.messages.innerHTML = '';

  for (const message of data.messages) {
    const txt = await decryptText(message.iv, message.ciphertext).catch(() => '[cannot decrypt]');
    renderMessage(message, txt, message.sender_device_id === deviceId);
  }

  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${wsProtocol}//${location.host}?room=${state.roomId}&device=${encodeURIComponent(deviceId)}`);
  state.ws.onmessage = async (ev) => {
    const payload = JSON.parse(ev.data);
    if (payload.type === 'message:new') {
      const txt = await decryptText(payload.message.iv, payload.message.ciphertext).catch(() => '[cannot decrypt]');
      renderMessage(payload.message, txt, payload.message.sender_device_id === deviceId);
      upsertActiveChat(state.roomId, { lastMessage: txt, nickname: state.me?.displayName || displayName });
      renderActiveChats();
      if (payload.message.sender_device_id !== deviceId) {
        state.ws.send(JSON.stringify({ type: 'message:read', messageId: payload.message.id }));
      }
    }
    if (payload.type === 'message:status') {
      const msg = els.messages.querySelector(`.msg[data-id="${payload.messageId}"] .meta`);
      if (msg) msg.textContent = `${msg.textContent.split(' · ')[0]} · ${payload.status}`;
    }
  };
}

renderActiveChats();
els.createRoomBtn.addEventListener('click', createRoom);
els.joinBtn.addEventListener('click', joinRoom);
els.sendForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = els.messageInput.value.trim();
  if (!text || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const enc = await encryptText(text);
  state.ws.send(JSON.stringify({ type: 'message:new', ...enc }));
  els.messageInput.value = '';
});

initFromInvite();