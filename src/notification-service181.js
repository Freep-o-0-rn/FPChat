/* Build 181.3: server owner for Web Push delivery and device-level notification registration. */
function safeDeviceId181(value) {
  const text = String(value || '').trim();
  if (text.length < 8 || text.length > 128) return '';
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
}

function ensureNotificationSchema181(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL UNIQUE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      hide_sender INTEGER NOT NULL DEFAULT 0,
      notify_system_events INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_push_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      system_event_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(system_event_id, device_id)
    );

    CREATE INDEX IF NOT EXISTS idx_device_push_endpoint181
      ON device_push_subscriptions(endpoint);

    CREATE INDEX IF NOT EXISTS idx_system_push_device181
      ON system_push_deliveries(device_id, system_event_id);
  `);
}

function createNotificationService181({ db, q, webpush, pushEnabled, hasVisibleRoomSocketForDevice }) {
  if (!db || !q || !webpush) throw new Error('notification service dependencies are missing');
  ensureNotificationSchema181(db);

  const deviceQ = {
    upsert: db.prepare(`
      INSERT INTO device_push_subscriptions
        (device_id, endpoint, p256dh, auth, hide_sender, notify_system_events, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(device_id) DO UPDATE SET
        endpoint=excluded.endpoint,
        p256dh=excluded.p256dh,
        auth=excluded.auth,
        hide_sender=excluded.hide_sender,
        notify_system_events=excluded.notify_system_events,
        updated_at=datetime('now')
    `),
    deleteEndpointOtherDevice: db.prepare('DELETE FROM device_push_subscriptions WHERE endpoint=? AND device_id!=?'),
    updateSettings: db.prepare(`
      UPDATE device_push_subscriptions
      SET hide_sender=?, notify_system_events=?, updated_at=datetime('now')
      WHERE device_id=?
    `),
    deleteByDevice: db.prepare('DELETE FROM device_push_subscriptions WHERE device_id=?'),
    deleteById: db.prepare('DELETE FROM device_push_subscriptions WHERE id=?'),
    byDevice: db.prepare('SELECT * FROM device_push_subscriptions WHERE device_id=?'),
    claimSystem: db.prepare('INSERT OR IGNORE INTO system_push_deliveries(system_event_id, device_id) VALUES(?, ?)'),
    releaseSystem: db.prepare('DELETE FROM system_push_deliveries WHERE system_event_id=? AND device_id=?'),
    systemEventById: db.prepare(`
      SELECT id, device_id, event_type, ref_type, ref_id, payload_json
      FROM system_events
      WHERE id=? AND device_id=?
    `)
  };

  function parseSubscription(subscription) {
    const endpoint = String(subscription?.endpoint || '').trim();
    const p256dh = String(subscription?.keys?.p256dh || '').trim();
    const auth = String(subscription?.keys?.auth || '').trim();
    if (!endpoint || !p256dh || !auth) return null;
    if (endpoint.length > 4096 || p256dh.length > 1024 || auth.length > 1024) return null;
    return { endpoint, p256dh, auth };
  }

  function registerDevice({ deviceId, subscription, settings }) {
    const device = safeDeviceId181(deviceId);
    const parsed = parseSubscription(subscription);
    if (!device || !parsed) return { ok: false, code: !device ? 'DEVICE_ID_REQUIRED' : 'INVALID_SUBSCRIPTION' };
    deviceQ.deleteEndpointOtherDevice.run(parsed.endpoint, device);
    deviceQ.upsert.run(
      device,
      parsed.endpoint,
      parsed.p256dh,
      parsed.auth,
      settings?.hideSender ? 1 : 0,
      settings?.notifySystemEvents === false ? 0 : 1
    );
    return { ok: true };
  }

  function updateDeviceSettings({ deviceId, hideSender, notifySystemEvents }) {
    const device = safeDeviceId181(deviceId);
    if (!device) return { ok: false, code: 'DEVICE_ID_REQUIRED' };
    const info = deviceQ.updateSettings.run(
      hideSender ? 1 : 0,
      notifySystemEvents === false ? 0 : 1,
      device
    );
    return { ok: true, updated: Number(info.changes || 0) > 0 };
  }

  function unregisterDevice(deviceId) {
    const device = safeDeviceId181(deviceId);
    if (!device) return { ok: false, code: 'DEVICE_ID_REQUIRED' };
    const info = deviceQ.deleteByDevice.run(device);
    return { ok: true, updated: Number(info.changes || 0) > 0 };
  }

  function installDeviceRoutes({ app, pushOff }) {
    app.post('/api/push/device/subscribe', (req, res) => {
      if (!pushEnabled) return pushOff(res);
      const result = registerDevice({
        deviceId: req.body?.deviceId,
        subscription: req.body?.subscription,
        settings: req.body?.settings
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json({ ok: true });
    });

    app.post('/api/push/device/settings', (req, res) => {
      if (!pushEnabled) return pushOff(res);
      const result = updateDeviceSettings(req.body || {});
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    });

    app.post('/api/push/device/unsubscribe', (req, res) => {
      if (!pushEnabled) return pushOff(res);
      const result = unregisterDevice(req.body?.deviceId);
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    });
  }

  async function sendRoomMessage({ roomId, messageId, roomPublicId, senderDeviceId, senderName, preview }) {
    if (!pushEnabled) return false;
    const safeMessageId = Number(messageId);
    if (!Number.isSafeInteger(safeMessageId) || safeMessageId <= 0) return false;
    let delivered = false;
    for (const sub of q.listPushForRoom.all(roomId)) {
      if (sub.device_id === senderDeviceId || sub.muted) continue;
      if (hasVisibleRoomSocketForDevice(sub.device_id, roomPublicId)) continue;
      const claim = q.claimPushDelivery.run(roomId, safeMessageId, sub.device_id);
      if (!claim.changes) continue;
      const privateBody = sub.hide_sender ? 'Новое сообщение' : `${senderName}: новое сообщение`;
      const shownPreview = sub.show_text && preview
        ? (sub.hide_sender ? preview : `${senderName}: ${preview}`)
        : privateBody;
      const payload = JSON.stringify({
        type: 'message',
        category: 'message',
        roomId: roomPublicId,
        url: `/chat/${roomPublicId}`,
        title: 'FPChat',
        body: shownPreview
      });
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        delivered = true;
      } catch (error) {
        q.deletePushDelivery.run(roomId, safeMessageId, sub.device_id);
        if (error?.statusCode === 404 || error?.statusCode === 410) q.deletePushById.run(sub.id);
        else console.warn(`Push send failed for room ${roomPublicId}: ${error?.statusCode || 'error'}`);
      }
    }
    return delivered;
  }

  function roomSystemBody(message, hideActor) {
    const actor = hideActor ? 'Участник' : String(message?.event_actor_name || message?.sender_name || 'Участник');
    if (message?.event_type === 'participant_joined') return `${actor} присоединился к комнате`;
    if (message?.event_type === 'participant_left') return `${actor} покинул комнату`;
    return 'Системное событие';
  }

  async function sendRoomSystemEvent(room, message) {
    if (!pushEnabled || !room || !message) return false;
    const safeMessageId = Number(message.id);
    if (!Number.isSafeInteger(safeMessageId) || safeMessageId <= 0) return false;
    let delivered = false;
    for (const sub of q.listPushForRoom.all(room.id)) {
      if (sub.device_id === message.sender_device_id || sub.muted || !sub.notify_system_events) continue;
      if (hasVisibleRoomSocketForDevice(sub.device_id, room.public_id)) continue;
      const claim = q.claimPushDelivery.run(room.id, safeMessageId, sub.device_id);
      if (!claim.changes) continue;
      const payload = JSON.stringify({
        type: 'system',
        category: 'system',
        roomId: room.public_id,
        url: `/chat/${room.public_id}`,
        title: 'FPChat',
        body: roomSystemBody(message, Boolean(sub.hide_sender))
      });
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        delivered = true;
      } catch (error) {
        q.deletePushDelivery.run(room.id, safeMessageId, sub.device_id);
        if (error?.statusCode === 404 || error?.statusCode === 410) q.deletePushById.run(sub.id);
        else console.warn(`System push failed for room ${room.public_id}: ${error?.statusCode || 'error'}`);
      }
    }
    return delivered;
  }

  function personalSystemBody(event, hideSender) {
    const payload = event?.payload || {};
    if (event?.eventType === 'chat_request_received') {
      if (hideSender) return 'Новый запрос на чат';
      const sender = payload.sender || {};
      const who = sender.displayName || (sender.username ? `@${sender.username}` : 'Пользователь');
      return `${who} хочет начать чат`;
    }
    if (event?.eventType === 'chat_request_accepted') {
      if (hideSender) return 'Запрос на чат принят';
      const target = payload.target || {};
      const who = target.displayName || (target.username ? `@${target.username}` : 'Пользователь');
      return `${who} принял запрос на чат`;
    }
    if (event?.eventType === 'chat_request_rejected') return 'Запрос на чат отклонён';
    if (event?.eventType === 'chat_request_expired') return 'Срок запроса на чат истёк';
    return 'Новое системное уведомление';
  }

  async function sendPersonalSystemEvent(event) {
    if (!pushEnabled) return false;
    const systemEventId = Number(event?.id);
    const deviceId = safeDeviceId181(event?.deviceId);
    if (!Number.isSafeInteger(systemEventId) || systemEventId <= 0 || !deviceId) return false;

    // The observer runs after the synchronous add call. Re-read the row so a
    // rolled-back outer transaction can never produce a push.
    const durable = deviceQ.systemEventById.get(systemEventId, deviceId);
    if (!durable) return false;
    let durablePayload = null;
    try { durablePayload = durable.payload_json ? JSON.parse(durable.payload_json) : null; } catch {}
    const durableEvent = {
      id: Number(durable.id),
      deviceId: durable.device_id,
      eventType: durable.event_type,
      refType: durable.ref_type || null,
      refId: durable.ref_id || null,
      payload: durablePayload
    };

    const sub = deviceQ.byDevice.get(deviceId);
    if (!sub || !sub.notify_system_events) return false;
    const claim = deviceQ.claimSystem.run(systemEventId, deviceId);
    if (!claim.changes) return false;
    const payload = JSON.stringify({
      type: 'system',
      category: 'system',
      target: 'system',
      systemEventId,
      systemType: String(durableEvent.eventType || '').slice(0, 64) || null,
      refType: durableEvent.refType,
      refId: durableEvent.refId,
      url: `/?systemEvent=${encodeURIComponent(systemEventId)}`,
      title: 'FPChat',
      body: personalSystemBody(durableEvent, Boolean(sub.hide_sender))
    });
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      return true;
    } catch (error) {
      deviceQ.releaseSystem.run(systemEventId, deviceId);
      if (error?.statusCode === 404 || error?.statusCode === 410) deviceQ.deleteById.run(sub.id);
      else console.warn(`Personal system push failed for event ${systemEventId}: ${error?.statusCode || 'error'}`);
      return false;
    }
  }

  return Object.freeze({
    installDeviceRoutes,
    registerDevice,
    updateDeviceSettings,
    unregisterDevice,
    sendRoomMessage,
    sendRoomSystemEvent,
    sendPersonalSystemEvent,
    owner: 'NotificationService181'
  });
}

module.exports = { createNotificationService181, ensureNotificationSchema181 };
