/* Build 147: sender creates and owns the hidden ordinary room before a username request is sent. */
(() => {
  if (window.FPChatRequestOwner147) return;
  const KEY = 'fpchat:chat-request-pending-rooms:v1';
  const baseFetch = window.fetch.bind(window);

  const readAll = () => {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  };
  const writeAll = (value) => {
    try { localStorage.setItem(KEY, JSON.stringify(value || {})); return true; }
    catch { return false; }
  };
  const get = (roomId) => roomId ? readAll()[String(roomId)] || null : null;
  const put = (roomId, patch) => {
    if (!roomId) return false;
    const all = readAll();
    all[String(roomId)] = { ...(all[String(roomId)] || {}), ...(patch || {}), roomId: String(roomId) };
    return writeAll(all);
  };
  const remove = (roomId) => {
    if (!roomId) return false;
    const all = readAll();
    if (!Object.prototype.hasOwnProperty.call(all, String(roomId))) return true;
    delete all[String(roomId)];
    return writeAll(all);
  };
  const notifyChanged = () => {
    try { window.dispatchEvent(new CustomEvent('fpchat:chat-request-changed')); } catch {}
  };

  function nick() {
    try { if (typeof state !== 'undefined' && state?.nick) return String(state.nick).trim(); } catch {}
    try { return String(localStorage.getItem('fpchat:nick') || '').trim() || 'Пользователь FPChat'; }
    catch { return 'Пользователь FPChat'; }
  }
  function inviteCode(link) {
    try {
      if (typeof parseInviteInput === 'function') {
        const parsed = parseInviteInput(link);
        if (parsed?.inviteCode) return parsed.inviteCode;
      }
    } catch {}
    try { return new URL(link, location.origin).pathname.match(/^\/i\/([A-Z0-9]{16,64})$/i)?.[1] || ''; }
    catch { return ''; }
  }
  async function deleteRoom(room) {
    if (!room?.roomId || !room?.deviceId) return false;
    try {
      const response = await baseFetch(`/api/rooms/${encodeURIComponent(room.roomId)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: room.deviceId })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) return false;
      remove(room.roomId);
      return true;
    } catch { return false; }
  }
  async function createHiddenRoom(senderDeviceId) {
    if (typeof generateRecoveryCode !== 'function' || typeof buildRecoveryPayload !== 'function') throw new Error('room crypto unavailable');
    const secret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const recoveryCode = generateRecoveryCode();
    const recovery = await buildRecoveryPayload(recoveryCode, secret);
    const response = await baseFetch('/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: nick(), deviceId: senderDeviceId, roomSecret: secret, recoverySalt: recovery.recoverySalt, recoveryVerifier: recovery.recoveryVerifier, recoverySecretIv: recovery.recoverySecretIv, recoverySecretCiphertext: recovery.recoverySecretCiphertext })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok || !data.publicId || !data.inviteLink) throw new Error('hidden room create failed');
    const code = inviteCode(data.inviteLink);
    const room = { roomId: data.publicId, deviceId: senderDeviceId, secret, recoveryCode, inviteCode: code, inviteLink: data.inviteLink, inviteExpiresAt: data.inviteExpiresAt || null, createdAt: new Date().toISOString() };
    if (!code || !put(room.roomId, room)) {
      await deleteRoom(room);
      throw new Error('pending room storage failed');
    }
    return room;
  }
  function isChatRequestPost(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
    return url === '/api/chat-requests' && method === 'POST' && init?.body;
  }

  window.fetch = async function fpchatRequestOwnerFetch(input, init) {
    if (!isChatRequestPost(input, init)) return baseFetch(input, init);
    let body;
    try { body = JSON.parse(init.body); } catch { return baseFetch(input, init); }
    if (!body?.senderDeviceId || !body?.targetUsername || body.roomPublicId || body.inviteCode) return baseFetch(input, init);

    const room = await createHiddenRoom(String(body.senderDeviceId));
    const next = { ...body, roomPublicId: room.roomId, inviteCode: room.inviteCode };
    let response;
    try {
      response = await baseFetch(input, { ...init, body: JSON.stringify(next) });
    } catch (error) {
      await deleteRoom(room);
      throw error;
    }
    if (!response.ok) {
      await deleteRoom(room);
      return response;
    }
    try {
      const clone = response.clone();
      const data = await clone.json();
      if (data?.ok && data?.request) {
        put(room.roomId, { ...room, requestId: data.request.id || null, targetUsername: body.targetUsername, inviteExpiresAt: data.request.expiresAt || room.inviteExpiresAt || null });
        notifyChanged();
      }
    } catch {}
    return response;
  };

  function localActive(roomId) {
    try { return Boolean(STORAGE?.get?.(STORAGE.roomState(roomId))?.secret); }
    catch { return false; }
  }
  function promote(request) {
    if (request?.direction !== 'outgoing' || request?.status !== 'accepted' || !request.roomPublicId) return false;
    const roomId = String(request.roomPublicId);
    if (localActive(roomId)) { remove(roomId); return false; }
    const pending = get(roomId);
    if (!pending?.secret || !pending?.deviceId || !pending?.recoveryCode || typeof upsertChat !== 'function') return false;
    try {
      STORAGE.set(STORAGE.roomState(roomId), { secret: pending.secret, deviceId: pending.deviceId, recoveryCode: pending.recoveryCode, inviteLink: pending.inviteLink || null, inviteExpiresAt: pending.inviteExpiresAt || request.expiresAt || null });
      upsertChat(roomId, {});
      if (state?.notif?.enabled && typeof syncRoomPushSubscription === 'function') syncRoomPushSubscription(roomId).catch(() => {});
      const code = pending.recoveryCode;
      remove(roomId);
      if (code && typeof showRecoveryCodeModal === 'function') setTimeout(() => { try { showRecoveryCodeModal(code); } catch {} }, 0);
      return true;
    } catch { return false; }
  }
  function reconcile(requests) {
    for (const request of requests || []) {
      if (request?.direction !== 'outgoing' || !request.roomPublicId) continue;
      if (request.status === 'accepted') promote(request);
      else if (request.status !== 'pending') remove(request.roomPublicId);
    }
  }

  window.FPChatRequestOwner147 = Object.freeze({ readAll, get, put, remove, promote, reconcile });
})();
