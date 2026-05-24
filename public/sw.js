const CACHE_NAME = 'fpchat-static-v1';
const VERSION_ENDPOINT = '/version.json';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
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
  const url = payload.url || payload?.data?.url || '/';
  event.waitUntil((async () => {
    if (typeof self.registration.setAppBadge === 'function' && Number.isFinite(payload.badgeCount)) {
      try { await self.registration.setAppBadge(payload.badgeCount); } catch {}
    }
    await self.registration.showNotification(payload.title || 'FPChat', {
      body: payload.body || 'Новое сообщение',
      icon: payload.icon || '/icons/icon-192x192.png',
      badge: payload.badge || '/icons/icon-192x192.png',
      tag: roomId ? `room-${roomId}` : 'fpchat-message',
      renotify: true,
      data: { roomId, url }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const roomId = event.notification?.data?.roomId || null;
  const url = event.notification?.data?.url || '/';
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOriginClient = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (sameOriginClient) {
      await sameOriginClient.focus();
      if (roomId) sameOriginClient.postMessage({ type: 'open-chat', roomId });
      return;
    }
    if (clients.openWindow) await clients.openWindow(roomId ? url : '/');
  })());
});