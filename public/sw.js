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

  if (requestUrl.pathname === VERSION_ENDPOINT) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
});

self.addEventListener('push', (event) => {
  let payload = { title: 'FPChat', body: 'Новое сообщение', data: { url: '/' } };
  try {
    const parsed = event.data ? event.data.json() : null;
    if (parsed) payload = { ...payload, ...parsed, data: { url: parsed.url || '/', ...(parsed.data || {}) } };
  } catch {}
  event.waitUntil((async () => {
    if (typeof self.registration.setAppBadge === 'function' && Number.isFinite(payload.badgeCount)) {
      try { await self.registration.setAppBadge(payload.badgeCount); } catch {}
    }
    await self.registration.showNotification(payload.title || 'FPChat', {
      body: payload.body || 'Новое сообщение',
      icon: payload.icon || '/icons/icon.svg',
      badge: payload.badge || '/icons/icon.svg',
      data: payload.data || { url: '/' }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetPath = event.notification?.data?.url || '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if ('focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(targetPath);
  }));
});