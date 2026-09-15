/* Build 162: live countdown for server-enforced @username request cooldowns. */
(() => {
  if (window.__fpChatRequestCooldown160Installed) return;
  window.__fpChatRequestCooldown160Installed = true;

  const baseFetch = window.fetch.bind(window);
  const restrictions = new Map();
  let tickTimer = 0;
  let refreshPromise = null;

  const normalizeUsername = (value) => String(value || '').trim().replace(/^@/, '').toLowerCase();

  function getDeviceId() {
    try {
      if (typeof getOrCreateDeviceId === 'function') return String(getOrCreateDeviceId() || '').trim();
    } catch {}
    try { return String(localStorage.getItem('fpchat:device-id') || '').trim(); }
    catch { return ''; }
  }

  function listedRoomIds() {
    try {
      if (typeof state !== 'undefined' && Array.isArray(state?.chats)) {
        return [...new Set(state.chats.map((chat) => String(chat?.roomId || '').trim()).filter(Boolean))].slice(0, 100);
      }
    } catch {}
    return [];
  }

  function requestMeta(input, init) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      if (!raw) return null;
      const url = new URL(raw, location.origin);
      if (url.origin !== location.origin) return null;
      const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();

      if (url.pathname === '/api/chat-requests/status' && method === 'GET') {
        const username = normalizeUsername(url.searchParams.get('targetUsername'));
        return username ? { kind: 'status', username } : null;
      }

      if (url.pathname === '/api/chat-requests' && method === 'POST') {
        if (typeof init?.body !== 'string') return null;
        const body = JSON.parse(init.body);
        const username = normalizeUsername(body?.targetUsername);
        return username ? { kind: 'send', username } : null;
      }
    } catch {}
    return null;
  }

  function parseRestriction(value) {
    if (!value || !['CHAT_REQUEST_COOLDOWN', 'CHAT_REQUEST_RATE_LIMIT'].includes(value.code)) return null;
    const seconds = Number(value.retryAfterSeconds);
    let until = Number.isFinite(seconds) && seconds > 0 ? Date.now() + Math.ceil(seconds) * 1000 : NaN;
    if (!Number.isFinite(until)) until = Date.parse(value.retryAt || '');
    if (!Number.isFinite(until) || until <= Date.now()) return null;
    return { code: value.code, until };
  }

  function currentProfile() {
    const overlay = document.querySelector('.fp-profile144-overlay');
    if (!overlay) return null;
    const handle = overlay.querySelector('.fp-profile144-handle');
    const button = overlay.querySelector('.fp-profile145-request');
    const status = overlay.querySelector('.fp-profile145-status');
    const unblock = overlay.querySelector('.fp-profile162-unblock');
    const username = normalizeUsername(handle?.textContent);
    if (!username || !button || !status) return null;
    return { overlay, username, button, status, unblock };
  }

  function formatRemaining(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) return `${hours} ч ${minutes} мин ${seconds} сек`;
    if (minutes > 0) return `${minutes} мин ${seconds} сек`;
    return `${seconds} сек`;
  }

  function restrictionText(restriction, remaining) {
    const time = formatRemaining(remaining);
    return restriction.code === 'CHAT_REQUEST_RATE_LIMIT'
      ? `Новый запрос можно отправить через ${time}.`
      : `Повторный запрос можно отправить через ${time}.`;
  }

  function setButton(button, text, disabled = true) {
    if (!button) return;
    button.disabled = disabled;
    if (button.textContent !== text) button.textContent = text;
  }

  function clearButtonAction(button) {
    if (!button) return;
    delete button.dataset.fpAction;
    delete button.dataset.roomId;
  }

  function setStatus(status, text) {
    if (!status) return;
    if (status.textContent !== text) status.textContent = text;
    status.className = 'fp-profile145-status';
  }

  function startTicker() {
    if (tickTimer) return;
    tickTimer = setInterval(renderCurrent, 1000);
  }

  function stopTicker() {
    if (!tickTimer) return;
    clearInterval(tickTimer);
    tickTimer = 0;
  }

  async function refreshCurrent(username) {
    if (refreshPromise) return refreshPromise;
    const deviceId = getDeviceId();
    if (!deviceId) return;

    refreshPromise = (async () => {
      const profile = currentProfile();
      if (profile?.username === username) {
        clearButtonAction(profile.button);
        setButton(profile.button, 'Проверяем…', true);
        setStatus(profile.status, 'Проверяем, можно ли снова отправить запрос…');
      }
      try {
        const params = new URLSearchParams({ deviceId, targetUsername: username });
        const rooms = listedRoomIds();
        if (rooms.length) params.set('listedRooms', rooms.join(','));
        const response = await baseFetch(`/api/chat-requests/status?${params.toString()}`, { cache: 'no-store' });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) return;

        const next = parseRestriction(data.restriction);
        if (next) {
          restrictions.set(username, next);
          startTicker();
          renderCurrent();
          return;
        }

        restrictions.delete(username);
        const current = currentProfile();
        if (!current || current.username !== username) return;
        clearButtonAction(current.button);

        if (current.unblock) {
          current.unblock.hidden = !data.youBlockedTarget;
          if (data.youBlockedTarget && data.blockId) current.unblock.dataset.blockId = data.blockId;
          else delete current.unblock.dataset.blockId;
        }

        if (data.existingChatRoomId) {
          setButton(current.button, 'Открыть чат', false);
          current.button.dataset.fpAction = 'open-chat';
          current.button.dataset.roomId = data.existingChatRoomId;
          setStatus(current.status, 'У вас уже есть активный чат с этим пользователем.');
        } else if (data.pending?.direction === 'outgoing') {
          setButton(current.button, 'Запрос уже отправлен', true);
          setStatus(current.status, 'Запрос ожидает ответа пользователя.');
        } else if (data.pending?.direction === 'incoming') {
          setButton(current.button, 'Есть входящий запрос', true);
          setStatus(current.status, 'Этот пользователь уже отправил вам запрос. Откройте системный чат.');
        } else if (data.youBlockedTarget) {
          setButton(current.button, 'Запросы заблокированы', true);
          setStatus(current.status, 'Пользователь находится в вашем чёрном списке.');
        } else if (data.canSend) {
          setButton(current.button, 'Отправить запрос на чат', false);
          setStatus(current.status, 'Пользователь получит запрос в системном чате.');
        } else {
          setButton(current.button, 'Запрос недоступен', true);
          setStatus(current.status, 'Запрос этому пользователю сейчас недоступен.');
        }
      } catch {}
      finally {
        refreshPromise = null;
        if (!restrictions.size) stopTicker();
      }
    })();

    return refreshPromise;
  }

  function renderCurrent() {
    const profile = currentProfile();
    if (!profile) {
      if (!restrictions.size) stopTicker();
      return;
    }

    const restriction = restrictions.get(profile.username);
    if (!restriction) return;

    const remaining = restriction.until - Date.now();
    if (remaining <= 0) {
      restrictions.delete(profile.username);
      if (!restrictions.size) stopTicker();
      void refreshCurrent(profile.username);
      return;
    }

    clearButtonAction(profile.button);
    setButton(profile.button, 'Запрос недоступен', true);
    setStatus(profile.status, restrictionText(restriction, remaining));
  }

  function remember(username, value) {
    const restriction = parseRestriction(value);
    if (restriction) {
      restrictions.set(username, restriction);
      startTicker();
      setTimeout(renderCurrent, 0);
    } else if (username) {
      restrictions.delete(username);
      if (!restrictions.size) stopTicker();
    }
  }

  async function inspectResponse(meta, response) {
    if (!meta || !response) return;
    try {
      const data = await response.clone().json();
      if (meta.kind === 'status') {
        remember(meta.username, data?.restriction);
      } else if (meta.kind === 'send') {
        if (!response.ok) remember(meta.username, data);
        else remember(meta.username, null);
      }
    } catch {}
  }

  window.fetch = async function fpChatCooldownFetch(input, init) {
    const meta = requestMeta(input, init);
    const response = await baseFetch(input, init);
    if (meta) void inspectResponse(meta, response);
    return response;
  };

  const observer = new MutationObserver(() => {
    const profile = currentProfile();
    if (profile && restrictions.has(profile.username)) renderCurrent();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderCurrent();
  });
})();
