/* Build 181.5: service-worker display and click handoff for room and personal system notifications. */
const CACHE_NAME = 'fpchat-static-v1';
const MEDIA_CACHE_PREFIX = 'fpchat-media-v';
const VERSION_ENDPOINT = '/version.json';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME && !key.startsWith(MEDIA_CACHE_PREFIX)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname === VERSION_ENDPOINT) event.respondWith(fetch(event.request, { cache: 'no-store' }));
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {}
  const roomId = payload.roomId || payload?.data?.roomId || null;
  const target = payload.target || payload?.data?.target || (roomId ? 'room' : null);
  const systemEventId = Number(payload.systemEventId || payload?.data?.systemEventId || 0) || null;
  const url = payload.url || payload?.data?.url || '/';
  const tag = roomId
    ? `room-${roomId}`
    : (systemEventId ? `system-${systemEventId}` : 'fpchat-message');

  event.waitUntil((async () => {
    await self.registration.showNotification(payload.title || 'FPChat', {
      body: payload.body || (target === 'system' ? 'Новое системное уведомление' : 'Новое сообщение'),
      icon: payload.icon || '/icons/icon-192x192.png',
      badge: payload.badge || '/icons/icon-192x192.png',
      tag,
      renotify: true,
      data: {
        target,
        roomId,
        systemEventId,
        systemType: payload.systemType || null,
        refType: payload.refType || null,
        refId: payload.refId || null,
        url
      }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification?.data || {};
  const roomId = data.roomId || null;
  const url = data.url || '/';

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOriginClient = windows.find((client) => {
      try { return new URL(client.url).origin === self.location.origin; } catch { return false; }
    });

    if (sameOriginClient) {
      await sameOriginClient.focus();
      if (data.target === 'system') {
        sameOriginClient.postMessage({
          type: 'open-system',
          systemEventId: data.systemEventId || null,
          systemType: data.systemType || null,
          refType: data.refType || null,
          refId: data.refId || null
        });
        return;
      }
      if (roomId) sameOriginClient.postMessage({ type: 'open-chat', roomId });
      return;
    }

    if (clients.openWindow) await clients.openWindow(url || '/');
  })());
});
