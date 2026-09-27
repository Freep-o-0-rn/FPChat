/* Build 189.11: system-event data and navigation facade.
   chat-request-system147 owns the single system-chat view for list and push entry. */
(() => {
  if (window.FPSystem144) return;

  const style = document.createElement('style');
  style.id = 'fpchat-system-chat145-style';
  style.textContent = `
    .fp-system145-host[hidden]{display:none!important}
    #fpSystemChatHost145:not([hidden]) + #emptyChats{display:none!important}
    .fp-system145-host{padding:0}
    .fp-system145-row{cursor:pointer;user-select:none}
    .fp-system145-row:active{transform:scale(.995)}
    .fp-system145-icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-right:5px;border-radius:50%;background:var(--accent);color:#fff;font-size:11px;font-weight:800;vertical-align:-2px}

    .fp-system145-overlay{position:fixed;inset:0;z-index:4550;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.5);backdrop-filter:blur(2px)}
    .fp-system145-sheet{width:min(560px,100%);height:min(720px,calc(100dvh - 40px));display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(120,130,145,.22);border-radius:22px;background:var(--panel);box-shadow:0 24px 70px rgba(0,0,0,.34)}
    .fp-system145-header{height:58px;flex:0 0 58px;display:grid;grid-template-columns:44px 1fr 44px;align-items:center;padding:0 10px;border-bottom:1px solid rgba(120,130,145,.16);box-sizing:border-box}
    .fp-system145-back{width:38px;height:38px;border:0;border-radius:50%;background:transparent;color:inherit;font-size:26px;line-height:1;cursor:pointer}
    .fp-system145-title{text-align:center;min-width:0}
    .fp-system145-title b{display:block;font-size:15px}
    .fp-system145-title span{display:block;margin-top:1px;color:var(--muted);font-size:11px}
    .fp-system145-feed{flex:1;overflow:auto;padding:16px 14px 24px;box-sizing:border-box;overscroll-behavior:contain}
    .fp-system145-empty{margin:28px auto;max-width:360px;padding:16px;border-radius:16px;background:rgba(120,130,145,.06);color:var(--muted);font-size:13px;line-height:1.5;text-align:center}
    .fp-system145-day{width:max-content;margin:7px auto 12px;padding:4px 9px;border-radius:999px;background:rgba(120,130,145,.12);color:var(--muted);font-size:11px;font-weight:700}
    .fp-system145-event{max-width:420px;margin:0 auto 12px;padding:13px 14px;border:1px solid rgba(120,130,145,.17);border-radius:16px;background:rgba(120,130,145,.055)}
    .fp-system145-request-head{display:flex;align-items:center;gap:11px}
    .fp-system145-avatar{width:42px;height:42px;flex:0 0 42px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--accent);color:#fff;font-size:14px;font-weight:800}
    .fp-system145-request-copy{min-width:0;flex:1}
    .fp-system145-request-copy b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}
    .fp-system145-request-copy span{display:block;margin-top:2px;color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fp-system145-request-text{margin-top:11px;font-size:13px;line-height:1.45}
    .fp-system145-request-state{display:inline-flex;margin-top:10px;padding:4px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:750}
    .fp-system145-event-time{margin-top:9px;color:var(--muted);font-size:10px;text-align:right}
    .fp-system145-generic{font-size:13px;line-height:1.5;color:var(--muted)}
    @media(max-width:600px){
      .fp-system145-overlay{padding:0;background:var(--panel);backdrop-filter:none}
      .fp-system145-sheet{width:100%;height:100dvh;max-height:none;border:0;border-radius:0;box-shadow:none;padding-top:env(safe-area-inset-top)}
      .fp-system145-header{height:54px;flex-basis:54px}
      .fp-system145-feed{padding-bottom:calc(24px + env(safe-area-inset-bottom))}
    }
  `;
  document.head.appendChild(style);

  const empty = document.getElementById('emptyChats');
  const search = document.getElementById('chatSearch');
  const chatList = document.getElementById('chatListPane');
  if (!empty || !chatList) return;

  const host = document.createElement('div');
  host.id = 'fpSystemChatHost145';
  host.className = 'fp-system145-host';
  host.hidden = true;
  empty.parentNode.insertBefore(host, empty);

  let cachedState = { ok: true, hasEvents: false, total: 0, unread: 0, latestAt: null };
  let latestEvent = null;
  let view = null;
  let refreshInFlight = null;

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

  function parseServerDate(value) {
    if (!value) return null;
    const text = String(value);
    const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
      ? new Date(text.replace(' ', 'T') + 'Z')
      : new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatTime(value) {
    const date = parseServerDate(value);
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatListTime(value) {
    try {
      if (typeof formatChatListTime === 'function') return formatChatListTime(value);
    } catch {}
    const date = parseServerDate(value);
    if (!date) return '';
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return formatTime(value);
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function previewFor(event) {
    if (event?.type === 'chat_request_received') {
      const sender = event.payload?.sender || {};
      const who = sender.displayName || (sender.username ? `@${sender.username}` : 'Пользователь');
      return `${who} хочет начать чат`;
    }
    return 'Новое системное уведомление';
  }

  function shouldShowHost() {
    const query = String(search?.value || '').trim();
    return Boolean(cachedState.hasEvents) && !query;
  }

  function renderHost() {
    if (!shouldShowHost()) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }

    host.hidden = false;
    const row = document.createElement('div');
    row.className = `chat-row fp-system145-row${Number(cachedState.unread || 0) > 0 ? ' unread' : ''}`;
    row.setAttribute('role', 'button');
    row.tabIndex = 0;

    const unread = Number(cachedState.unread || 0);
    const preview = previewFor(latestEvent);
    const time = formatListTime(latestEvent?.createdAt || cachedState.latestAt);
    row.innerHTML = `<div class="row-top"><div><div><strong><span class="fp-system145-icon">FP</span>FPChat</strong></div><div class="sys">Системный чат</div></div><div class="chat-row-meta">${unread > 0 ? `<span class="chat-unread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}<span class="chat-time">${time}</span></div></div><div class="row-top"><div class="last"></div></div>`;
    row.querySelector('.last').textContent = preview;
    row.onclick = () => void openSystemChat();
    row.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void openSystemChat();
      }
    };
    host.replaceChildren(row);
  }

  function openSystemChat(options = {}) {
    // The notification owner retains its target until the actionable view is ready.
    if (!view) return false;
    void view.open(options);
    return true;
  }

  function closeSystemChat() {
    view?.close();
  }

  function registerView(owner) {
    if (view || typeof owner?.open !== 'function' || typeof owner?.close !== 'function') return false;
    view = Object.freeze({ open: owner.open, close: owner.close });
    window.dispatchEvent(new Event('fpchat:system-ready181'));
    return true;
  }

  async function refresh() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const nextState = await getState();
        cachedState = nextState;
        latestEvent = nextState.hasEvents ? (await getEvents(1))[0] || null : null;
        renderHost();
        return nextState;
      } catch {
        return cachedState;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  search?.addEventListener('input', renderHost);
  window.addEventListener('focus', () => { if (document.visibilityState === 'visible') void refresh(); });
  window.addEventListener('pageshow', () => void refresh());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void refresh();
  }, 10000);

  window.FPSystem144 = Object.freeze({ getState, getEvents, markRead, refresh, open: openSystemChat, close: closeSystemChat, registerView });
  void refresh();
})();
