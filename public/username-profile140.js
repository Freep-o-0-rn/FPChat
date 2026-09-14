/* Build 140: optional username controls for Settings -> Profile.
   Adds UI only; nickname autosave and existing settings navigation stay intact. */
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
      .fp-username140-card{margin-top:12px}
      .fp-username140-input{display:flex;align-items:center;border:1px solid rgba(120,130,145,.34);border-radius:12px;background:rgba(120,130,145,.06);overflow:hidden;transition:border-color .16s,box-shadow .16s}
      .fp-username140-input:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
      .fp-username140-prefix{padding:0 0 0 13px;color:var(--muted);font-weight:700;user-select:none}
      .fp-username140-input input{border:0!important;outline:0!important;box-shadow:none!important;background:transparent!important;padding-left:3px!important;height:44px}
      .fp-username140-status{min-height:20px;margin-top:7px;font-size:13px;line-height:20px;color:var(--muted)}
      .fp-username140-status.success{color:#3bc47d}
      .fp-username140-status.error{color:var(--danger)}
      .fp-username140-status.pending{color:var(--muted)}
      .fp-username140-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
      .fp-username140-actions .btn{height:40px;font-size:14px;padding:0 13px}
      .fp-username140-delete{color:var(--danger)!important;border-color:color-mix(in srgb,var(--danger) 45%,transparent)!important;background:var(--danger-soft)!important}
      .fp-username140-help{margin:8px 0 0!important}
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
    if (!body) return;

    const card = document.createElement('div');
    card.className = 'fp-settings131-card fp-username140-card';
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
    `;
    body.appendChild(card);

    const input = card.querySelector('#fpUsername140');
    const status = card.querySelector('#fpUsernameStatus140');
    const save = card.querySelector('#fpUsernameSave140');
    const remove = card.querySelector('#fpUsernameDelete140');
    const deviceId = getDeviceId();

    let currentUsername = null;
    let checkedUsername = null;
    let timer = 0;
    let sequence = 0;

    function setStatus(text, kind = '') {
      status.textContent = text || '';
      status.className = `fp-username140-status${kind ? ` ${kind}` : ''}`;
    }

    function renderDelete() {
      remove.hidden = !currentUsername;
      remove.textContent = currentUsername ? `Удалить @${currentUsername}` : 'Удалить username';
    }

    function resetSave() {
      checkedUsername = null;
      save.hidden = true;
      save.disabled = false;
    }

    async function checkUsername() {
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
      const wanted = normalize(input.value);
      if (!checkedUsername || wanted !== checkedUsername) return scheduleCheck();
      save.disabled = true;
      setStatus('Сохраняем username…', 'pending');
      try {
        const response = await fetch('/api/profile/username', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId, username: wanted })
        });
        const data = await response.json().catch(() => null);
        if (response.status === 409 || data?.code === 'USERNAME_TAKEN') {
          checkedUsername = null;
          save.hidden = true;
          setStatus(`✕ @${wanted} уже занят`, 'error');
          return;
        }
        if (!response.ok || !data?.ok) {
          setStatus(data?.code === 'USERNAME_RESERVED' ? 'Этот username зарезервирован.' : 'Не удалось сохранить username.', 'error');
          return;
        }
        currentUsername = normalize(data.username);
        input.value = currentUsername;
        checkedUsername = null;
        save.hidden = true;
        setStatus(`✓ @${currentUsername} сохранён`, 'success');
        renderDelete();
      } catch {
        setStatus('Не удалось сохранить username.', 'error');
      } finally {
        save.disabled = false;
      }
    });

    remove.addEventListener('click', async () => {
      if (!currentUsername) return;
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
        if (!response.ok || !data?.ok) {
          setStatus('Не удалось удалить username.', 'error');
          return;
        }
        currentUsername = null;
        checkedUsername = null;
        input.value = '';
        save.hidden = true;
        renderDelete();
        setStatus('Username удалён. Теперь вас нельзя найти по username.', 'success');
      } catch {
        setStatus('Не удалось удалить username.', 'error');
      } finally {
        remove.disabled = false;
      }
    });

    (async () => {
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
        input.value = currentUsername || '';
        renderDelete();
        setStatus(currentUsername ? `✓ @${currentUsername} — ваш текущий username` : 'Введите username, чтобы проверить доступность.', currentUsername ? 'success' : '');
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
