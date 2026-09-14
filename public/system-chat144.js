/* Build 144: client bridge for the isolated system-event channel.
   No chat row is rendered until a future feature creates system events. */
(() => {
  if (window.FPSystem144) return;

  function getDeviceId() {
    try {
      if (typeof getOrCreateDeviceId === 'function') return String(getOrCreateDeviceId() || '').trim();
    } catch {}
    return String(localStorage.getItem('fpchat:device-id') || '').trim();
  }

  async function getState() {
    const deviceId = getDeviceId();
    if (!deviceId) return { ok: false, hasEvents: false, total: 0, unread: 0 };
    const params = new URLSearchParams({ deviceId });
    const response = await fetch(`/api/system/state?${params.toString()}`, { cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error('system state unavailable');
    return data;
  }

  async function getEvents(limit = 50) {
    const deviceId = getDeviceId();
    if (!deviceId) return [];
    const params = new URLSearchParams({ deviceId, limit: String(Math.max(1, Math.min(100, Number(limit) || 50))) });
    const response = await fetch(`/api/system/events?${params.toString()}`, { cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error('system events unavailable');
    return Array.isArray(data.events) ? data.events : [];
  }

  async function markRead(ids) {
    const deviceId = getDeviceId();
    const clean = Array.from(new Set((Array.isArray(ids) ? ids : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)))
      .slice(0, 100);
    if (!deviceId || clean.length === 0) return { ok: true, updated: 0 };
    const response = await fetch('/api/system/events/read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, ids: clean })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error('system read update failed');
    return data;
  }

  window.FPSystem144 = Object.freeze({ getState, getEvents, markRead });
})();
