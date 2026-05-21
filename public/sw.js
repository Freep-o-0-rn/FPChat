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