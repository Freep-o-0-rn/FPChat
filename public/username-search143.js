/* Build 143: exact @username lookup layered over the existing chat search.
   Existing local chat filtering remains untouched. */
(() => {
  if (window.__fpUsernameSearch143Installed) return;
  window.__fpUsernameSearch143Installed = true;

  const search = document.getElementById('chatSearch');
  const chatList = document.getElementById('chatListPane');
  const searchTop = search?.closest?.('.chat-list-top');
  if (!search || !chatList || !searchTop) return;

  const style = document.createElement('style');
  style.id = 'fpchat-username-search143-style';
  style.textContent = `
    .fp-username-search143{padding:8px 10px 0}
    .fp-username-search143[hidden]{display:none!important}
    .fp-username-search143:not([hidden]) ~ #emptyChats{display:none!important}
    .fp-username-search143-label{padding:2px 4px 7px;color:var(--muted);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
    .fp-username-search143-card{display:flex;align-items:center;gap:12px;width:100%;padding:12px 13px;border:1px solid rgba(120,130,145,.2);border-radius:15px;background:rgba(120,130,145,.055);box-sizing:border-box}
    .fp-username-search143-avatar{width:44px;height:44px;flex:0 0 44px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--accent);color:#fff;font-size:15px;font-weight:800;user-select:none}
    .fp-username-search143-copy{min-width:0;display:flex;flex-direction:column;gap:2px;flex:1}
    .fp-username-search143-name{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fp-username-search143-handle{font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fp-username-search143-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:3px}
    .fp-username-search143-badge{display:inline-flex;width:max-content;padding:2px 7px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:10px;font-weight:750}
    .fp-username-search143-state{padding:11px 13px;border:1px solid rgba(120,130,145,.16);border-radius:13px;color:var(--muted);font-size:13px;line-height:1.35;background:rgba(120,130,145,.035)}
    .fp-username-search143-state.error{color:var(--danger)}
  `;
  document.head.appendChild(style);

  const host = document.createElement('div');
  host.className = 'fp-username-search143';
  host.hidden = true;
  searchTop.insertAdjacentElement('afterend', host);

  let timer = 0;
  let requestSeq = 0;

  function getDeviceId() {
    try {
      if (typeof getOrCreateDeviceId === 'function') return String(getOrCreateDeviceId() || '').trim();
    } catch {}
    return String(localStorage.getItem('fpchat:device-id') || '').trim();
  }

  function normalizeQuery(value) {
    const raw = String(value || '').trim();
    if (!raw.startsWith('@')) return null;
    return raw.slice(1).toLowerCase();
  }

  function validSyntax(username) {
    return /^[a-z0-9_]{5,32}$/.test(username || '');
  }

  function initials(value) {
    const clean = String(value || '').trim().replace(/\s+/g, ' ');
    const parts = clean.split(' ').filter(Boolean);
    const raw = parts.length > 1
      ? `${parts[0][0] || ''}${parts[1][0] || ''}`
      : (parts[0] || 'FP').slice(0, 2);
    return raw.toUpperCase() || 'FP';
  }

  function clear() {
    requestSeq += 1;
    clearTimeout(timer);
    host.hidden = true;
    host.replaceChildren();
  }

  function renderState(text, error = false) {
    host.hidden = false;
    host.replaceChildren();
    const label = document.createElement('div');
    label.className = 'fp-username-search143-label';
    label.textContent = 'Глобальный поиск';
    const state = document.createElement('div');
    state.className = `fp-username-search143-state${error ? ' error' : ''}`;
    state.textContent = text;
    host.append(label, state);
  }

  function renderUser(user) {
    host.hidden = false;
    host.replaceChildren();

    const label = document.createElement('div');
    label.className = 'fp-username-search143-label';
    label.textContent = 'Глобальный поиск';

    const card = document.createElement('div');
    card.className = 'fp-username-search143-card';

    const avatar = document.createElement('div');
    avatar.className = 'fp-username-search143-avatar';
    avatar.textContent = initials(user.displayName);

    const copy = document.createElement('div');
    copy.className = 'fp-username-search143-copy';

    const name = document.createElement('div');
    name.className = 'fp-username-search143-name';
    name.textContent = user.displayName || 'Пользователь FPChat';

    const handle = document.createElement('div');
    handle.className = 'fp-username-search143-handle';
    handle.textContent = `@${user.username}`;

    const badges = document.createElement('div');
    badges.className = 'fp-username-search143-badges';
    if (user.role === 'service') {
      const badge = document.createElement('span');
      badge.className = 'fp-username-search143-badge';
      badge.textContent = 'Служебный профиль';
      badges.appendChild(badge);
    }
    if (user.isSelf) {
      const badge = document.createElement('span');
      badge.className = 'fp-username-search143-badge';
      badge.textContent = 'Это вы';
      badges.appendChild(badge);
    }

    copy.append(name, handle);
    if (badges.childElementCount) copy.appendChild(badges);
    card.append(avatar, copy);
    host.append(label, card);
  }

  async function lookup(username, seq) {
    renderState(`Ищем @${username}…`);
    try {
      const params = new URLSearchParams({ username });
      const deviceId = getDeviceId();
      if (deviceId) params.set('deviceId', deviceId);
      const response = await fetch(`/api/users/by-username?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (seq !== requestSeq) return;

      if (!response.ok || !data?.ok) {
        renderState('Не удалось выполнить поиск.', true);
        return;
      }
      if (!data.found || !data.user) {
        renderState(`Пользователь @${username} не найден.`);
        return;
      }
      renderUser(data.user);
    } catch {
      if (seq === requestSeq) renderState('Не удалось выполнить поиск.', true);
    }
  }

  function onInput() {
    clearTimeout(timer);
    const username = normalizeQuery(search.value);
    if (username === null) return clear();

    const seq = ++requestSeq;
    if (!username) {
      renderState('Введите полный @username.');
      return;
    }
    if (!validSyntax(username)) {
      renderState('Для глобального поиска введите полный @username: 5–32 символа, латинские буквы, цифры и _.');
      return;
    }

    renderState(`Ищем @${username}…`);
    timer = setTimeout(() => lookup(username, seq), 300);
  }

  search.addEventListener('input', onInput);
  search.addEventListener('search', onInput);
  onInput();
})();
