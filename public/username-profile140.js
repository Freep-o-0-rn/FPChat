/* Build 142: optional username/public-profile controls for Settings -> Profile.
   Keeps nickname autosave and existing settings/navigation mechanics intact. */
(() => {
  if (window.__fpUsernameProfile140Installed) return;
  window.__fpUsernameProfile140Installed = true;

  const STYLE_ID = 'fpchat-username140-style';
  const DEVICE_KEY = 'fpchat:device-id';
  const USERNAME_MIN = 5;
  const USERNAME_MAX = 32;
  const USERNAME_RE = /^[a-z0-9_]+$/;

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .fp-profile142-hero{display:flex;align-items:center;gap:14px;padding:14px 16px;margin-bottom:12px;border:1px solid rgba(120,130,145,.22);border-radius:18px;background:linear-gradient(180deg,rgba(51,144,236,.08),rgba(120,130,145,.035))}
      .fp-profile142-avatar{width:56px;height:56px;flex:0 0 56px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--accent);color:#fff;font-size:20px;font-weight:800;letter-spacing:.02em;box-shadow:0 4px 14px rgba(51,144,236,.22);user-select:none}
      .fp-profile142-copy{min-width:0;display:flex;flex-direction:column;gap:3px}
      .fp-profile142-name{font-size:18px;font-weight:750;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fp-profile142-handle{font-size:13px;line-height:1.35;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fp-profile142-service{display:none;width:max-content;margin-top:4px;padding:3px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:700}
      .fp-profile142-hero[data-role="service"] .fp-profile142-service{display:inline-flex}
      .fp-profile142-nick-card{margin-bottom:12px}
      .fp-profile142-nick-card label,.fp-username140-card label{font-weight:700}
      .fp-profile142-nick-card p{margin-top:8px!important}
      .fp-username140-card{margin-top:0}
      .fp-username140-input{display:flex;align-items:center;border:1px solid rgba(120,130,145,.34);border-radius:12px;background:rgba(120,130,145,.06);overflow:hidden;transition:border-color .16s,box-shadow .16s,opacity .16s}
      .fp-username140-input:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
      .fp-username140-card[data-role="service"] .fp-username140-input{opacity:.78}
      .fp-username140-prefix{padding:0 0 0 13px;color:var(--muted);font-weight:700;user-select:none}
      .fp-username140-input input{border:0!important;outline:0!important;box-shadow:none!important;background:transparent!important;padding-left:3px!important;height:44px}
      .fp-username140-status{min-height:20px;margin-top:7px;font-size:13px;line-height:20px;color:var(--muted)}
      .fp-username140-status.success{color:#3bc47d}
      .fp-username140-status.error{color:var(--danger)}
      .fp-username140-status.pending{color:var(--muted)}
      .fp-username140-status.service{color:var(--accent)}
      .fp-username140-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
      .fp-username140-actions .btn{height:40px;font-size:14px;padding:0 14px;border-radius:12px}
      .fp-username140-delete{color:var(--danger)!important;border-color:color-mix(in srgb,var(--danger) 38%,transparent)!important;background:var(--danger-soft)!important}
      .fp-username140-help{margin:8px 0 0!important;line-height:1.45}
      .fp-profile142-public-note{margin:7px 0 0!important;color:var(--muted);font-size:12px;line-height:1.45}
      @media(max-width:600px){
        .fp-profile142-hero{margin-left:0;margin-right:0;padding:13px 14px}
        .fp-profile142-avatar{width:52px;height:52px;flex-basis:52px}
        .fp-username140-actions .btn{width:100%}
      }
    `;
    document.head.appendChild(style);
  }

  function getDeviceId() {
    try {
      if (typeof getOrCreateDeviceId === 'function') return String(getOrCreateDeviceId() || '').trim();
    } catch {}
    let value = String(localStorage.getItem(DEVICE_KEY) || '').trim();
    if (!value && crypto?.randomUUID) {
      value = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, value);
    }
    return value;
  }

  function normalize(value) {
    return String(value || '').trim().replace(/^@/, '').toLowerCase();
  }

  function cleanDisplayName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 64);
  }

  function initials(value) {
    const parts = cleanDisplayName(value).split(' ').filter(Boolean);
    const text = parts.length > 1 ? `${parts[0][0] || ''}${parts[1][0] || ''}` : (parts[0] || 'FP').slice(0, 2);
    return text.toUpperCase() || 'FP';
  }

  function localValidation(value) {
    const username = normalize(value);
    if (!username) return { ok: false, username, empty: true };
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
      return { ok: false, username, message: `От ${USERNAME_MIN} до ${USERNAME_MAX} символов.` };
    }
    if (!USERNAME_RE.test(username)) {
      return { ok: false, username, message: 'Только латинские буквы, цифры и _.' };
    }
    return { ok: true, username };
  }

  function mount(root) {
    if (!root || root.dataset.username140Mounted === '1') return;
    root.dataset.username140Mounted = '1';

    const body = root.querySelector('.fp-settings131-body');
    const nickInput = root.querySelector('#fpNick131');
    const nickCard = nickInput?.closest?.('.fp-settings131-card');
    if (!body || !nickInput || !nickCard) return;

    nickCard.classList.add('fp-profile142-nick-card');

    const hero = document.createElement('div');
    hero.className = 'fp-profile142-hero';
    hero.dataset.role = 'user';
    hero.innerHTML = `
      <div class="fp-profile142-avatar" aria-hidden="true">FP</div>
      <div class="fp-profile142-copy">
        <div class="fp-profile142-name"></div>
        <div class="fp-profile142-handle">Username не установлен</div>
        <div class="fp-profile142-service">Служебный профиль</div>
      </div>
    `;
    body.insertBefore(hero, nickCard);

    const card = document.createElement('div');
    card.className = 'fp-settings131-card fp-username140-card';
    card.dataset.role = 'user';
    card.innerHTML = `
      <label for="fpUsername140">Username</label>
      <div class="fp-username140-input">
        <span class="fp-username140-prefix">@</span>
        <input id="fpUsername140" type="text" inputmode="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="${USERNAME_MAX}" placeholder="username">
      </div>
      <div id="fpUsernameStatus140" class="fp-username140-status"></div>
      <div class="fp-username140-actions">
        <button id="fpUsernameSave140" class="btn btn-primary" type="button" hidden>Сохранить username</button>
        <button id="fpUsernameDelete140" class="btn btn-secondary fp-username140-delete" type="button" hidden>Удалить username</button>
      </div>
      <p class="fp-username140-help">Username нужен только для поиска вас другими пользователями. Он необязателен.</p>
      <p class="fp-profile142-public-note">При наличии username ваш текущий ник используется как отображаемое имя в публичном профиле.</p>
    `;
    body.appendChild(card);

    const avatar = hero.querySelector('.fp-profile142-avatar');
    const heroName = hero.querySelector('.fp-profile142-name');
    const heroHandle = hero.querySelector('.fp-profile142-handle');
    const input = card.querySelector('#fpUsername140');
    const status = card.querySelector('#fpUsernameStatus140');
    const save = card.querySelector('#fpUsernameSave140');
    const remove = card.querySelector('#fpUsernameDelete140');
    const deviceId = getDeviceId();

    let currentUsername = null;
    let currentRole = 'user';
    let checkedUsername = null;
    let timer = 0;
    let sequence = 0;
    let nameSyncTimer = 0;
    let lastSyncedName = '';

    function currentNick() {
      return cleanDisplayName(nickInput.value || (typeof state !== 'undefined' ? state.nick : ''));
    }

    function updateHero() {
      const nick = currentNick() || 'Профиль';
      avatar.textContent = initials(nick);
      heroName.textContent = nick;
      heroHandle.textContent = currentUsername ? `@${currentUsername}` : 'Username не установлен';
      hero.dataset.role = currentRole;
      card.dataset.role = currentRole;
    }

    function setStatus(text, kind = '') {
      status.textContent = text || '';
      status.className = `fp-username140-status${kind ? ` ${kind}` : ''}`;
    }

    function renderActions() {
      const service = currentRole === 'service';
      input.readOnly = service;
      save.hidden = true;
      remove.hidden = service || !currentUsername;
      remove.textContent = currentUsername ? `Удалить @${currentUsername}` : 'Удалить username';
      if (service) setStatus('Служебный профиль. Username управляется только на сервере.', 'service');
      updateHero();
    }

    function resetSave() {
      checkedUsername = null;
      save.hidden = true;
      save.disabled = false;
    }

    async function syncDisplayName(force = false) {
      clearTimeout(nameSyncTimer);
      if (!deviceId || !currentUsername) return;
      const displayName = currentNick();
      if (!displayName || (!force && displayName === lastSyncedName)) return;
      try {
        const response = await fetch('/api/profile/display-name', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId, displayName })
        });
        const data = await response.json().catch(() => null);
        if (response.ok && data?.ok && data?.updated) lastSyncedName = displayName;
      } catch {}
    }

    function scheduleDisplayNameSync() {
      updateHero();
      clearTimeout(nameSyncTimer);
      if (!currentUsername) return;
      nameSyncTimer = setTimeout(() => syncDisplayName(false), 500);
    }

    nickInput.addEventListener('input', scheduleDisplayNameSync);
    nickInput.addEventListener('blur', () => {
      updateHero();
      if (currentUsername) syncDisplayName(false);
    });

    async function checkUsername() {
      if (currentRole === 'service') return;
      const seq = ++sequence;
      resetSave();
      const validation = localValidation(input.value);

      if (validation.empty) {
        setStatus(currentUsername ? `Текущий username: @${currentUsername}` : 'Введите username, чтобы проверить доступность.');
        return;
      }
      if (!validation.ok) {
        setStatus(validation.message, 'error');
        return;
      }
      if (validation.username === currentUsername) {
        setStatus(`✓ @${currentUsername} — ваш текущий username`, 'success');
        return;
      }

      setStatus('Проверяем доступность…', 'pending');
      try {
        const params = new URLSearchParams({ username: validation.username, deviceId });
        const response = await fetch(`/api/usernames/check?${params.toString()}`, { cache: 'no-store' });
        const data = await response.json().catch(() => null);
        if (seq !== sequence) return;

        if (!response.ok || !data?.ok) {
          if (data?.code === 'USERNAME_RESERVED') setStatus('Этот username зарезервирован.', 'error');
          else if (data?.code === 'USERNAME_INVALID') setStatus('Недопустимый username.', 'error');
          else setStatus('Не удалось проверить username.', 'error');
          return;
        }

        if (!data.available) {
          setStatus(`✕ @${validation.username} уже занят`, 'error');
          return;
        }

        checkedUsername = validation.username;
        setStatus(`✓ @${validation.username} свободен`, 'success');
        save.hidden = false;
      } catch {
        if (seq === sequence) setStatus('Не удалось проверить username.', 'error');
      }
    }

    function scheduleCheck() {
      if (currentRole === 'service') return;
      clearTimeout(timer);
      resetSave();
      const validation = localValidation(input.value);
      if (validation.empty) {
        setStatus(currentUsername ? `Текущий username: @${currentUsername}` : 'Введите username, чтобы проверить доступность.');
        return;
      }
      if (!validation.ok) {
        setStatus(validation.message, 'error');
        return;
      }
      if (validation.username === currentUsername) {
        setStatus(`✓ @${currentUsername} — ваш текущий username`, 'success');
        return;
      }
      setStatus('Проверим доступность после ввода…', 'pending');
      timer = setTimeout(checkUsername, 450);
    }

    input.addEventListener('input', scheduleCheck);

    save.addEventListener('click', async () => {
      if (currentRole === 'service') return;
      const wanted = normalize(input.value);
      if (!checkedUsername || wanted !== checkedUsername) return scheduleCheck();
      save.disabled = true;
      setStatus('Сохраняем username…', 'pending');
      try {
        const response = await fetch('/api/profile/username', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId, username: wanted, displayName: currentNick() })
        });
        const data = await response.json().catch(() => null);
        if (response.status === 409 || data?.code === 'USERNAME_TAKEN') {
          checkedUsername = null;
          save.hidden = true;
          setStatus(`✕ @${wanted} уже занят`, 'error');
          return;
        }
        if (data?.code === 'SERVICE_PROFILE_MANAGED_SERVER') {
          currentRole = 'service';
          renderActions();
          return;
        }
        if (!response.ok || !data?.ok) {
          setStatus(data?.code === 'USERNAME_RESERVED' ? 'Этот username зарезервирован.' : 'Не удалось сохранить username.', 'error');
          return;
        }
        currentUsername = normalize(data.username);
        currentRole = data.role || 'user';
        lastSyncedName = cleanDisplayName(data.displayName) || currentNick();
        input.value = currentUsername;
        checkedUsername = null;
        save.hidden = true;
        setStatus(`✓ @${currentUsername} сохранён`, 'success');
        renderActions();
      } catch {
        setStatus('Не удалось сохранить username.', 'error');
      } finally {
        save.disabled = false;
      }
    });

    remove.addEventListener('click', async () => {
      if (!currentUsername || currentRole === 'service') return;
      const deleting = currentUsername;
      const confirmed = window.confirm(`Удалить @${deleting}?\n\nПосле удаления другие пользователи не смогут найти вас по этому username.`);
      if (!confirmed) return;

      remove.disabled = true;
      setStatus('Удаляем username…', 'pending');
      try {
        const response = await fetch('/api/profile/username', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId })
        });
        const data = await response.json().catch(() => null);
        if (data?.code === 'SERVICE_PROFILE_MANAGED_SERVER') {
          currentRole = 'service';
          renderActions();
          return;
        }
        if (!response.ok || !data?.ok) {
          setStatus('Не удалось удалить username.', 'error');
          return;
        }
        currentUsername = null;
        currentRole = 'user';
        checkedUsername = null;
        lastSyncedName = '';
        input.value = '';
        save.hidden = true;
        renderActions();
        setStatus('Username удалён. Теперь вас нельзя найти по username.', 'success');
      } catch {
        setStatus('Не удалось удалить username.', 'error');
      } finally {
        remove.disabled = false;
      }
    });

    (async () => {
      updateHero();
      if (!deviceId) {
        input.disabled = true;
        setStatus('Не удалось определить это устройство.', 'error');
        return;
      }
      setStatus('Загружаем username…', 'pending');
      try {
        const params = new URLSearchParams({ deviceId });
        const response = await fetch(`/api/profile/username?${params.toString()}`, { cache: 'no-store' });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) throw new Error('load failed');
        currentUsername = data.username ? normalize(data.username) : null;
        currentRole = data.role === 'service' ? 'service' : 'user';
        lastSyncedName = cleanDisplayName(data.displayName);
        input.value = currentUsername || '';
        renderActions();
        if (currentRole !== 'service') {
          setStatus(currentUsername ? `✓ @${currentUsername} — ваш текущий username` : 'Введите username, чтобы проверить доступность.', currentUsername ? 'success' : '');
        }
        if (currentUsername && currentNick() && currentNick() !== lastSyncedName) syncDisplayName(true);
      } catch {
        setStatus('Не удалось загрузить username.', 'error');
      }
    })();
  }

  function scan() {
    document.querySelectorAll('.fp-settings131[data-page="profile"]').forEach(mount);
  }

  const host = document.getElementById('contentPane') || document.body;
  const observer = new MutationObserver(scan);
  observer.observe(host, { childList: true, subtree: true });
  scan();
})();
