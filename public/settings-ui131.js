/* Build 164: isolated Telegram-like settings UI over stable Build 129 mechanics. */
(() => {
  if (window.__fpSettings131LoaderStarted) return;
  window.__fpSettings131LoaderStarted = true;

  const BUILD = '186.2';
  let attempts = 0;

  const boot = () => {
    const ready = typeof renderSettings === 'function'
      && typeof els !== 'undefined'
      && els?.content
      && document.getElementById('fpchat-settings-autosave-style');
    if (!ready) {
      if (attempts++ < 100) setTimeout(boot, 50);
      return;
    }
    if (window.__fpSettings131Installed) return;
    window.__fpSettings131Installed = true;

    const baseRenderSettings = renderSettings;
    let swipeCleanup = null;
    let currentPage = 'main';

    const icons = {
      profile: '<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"/></svg>',
      notifications: '<svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>',
      privacy: '<svg viewBox="0 0 24 24"><path d="M12 3 5.5 5.8v5.1c0 4.3 2.6 8.2 6.5 10.1 3.9-1.9 6.5-5.8 6.5-10.1V5.8L12 3Z"/><rect x="9" y="10.5" width="6" height="4.8" rx="1.2"/><path d="M10.5 10.5V9a1.5 1.5 0 0 1 3 0v1.5"/></svg>',
      blocked: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 9.2-5.9M16.5 15.5l4 4M20.5 15.5l-4 4"/></svg>',
      appearance: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-.6-.5-1-1-1h-3.2a2.8 2.8 0 0 1-2.8-2.8V5c0-1.1-.9-2-2-2Z"/><path d="M7.5 10.5h.01M9.5 15h.01M6.5 14h.01"/></svg>',
      storage: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
      about: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 7h.01"/></svg>',
      back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
      next: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
      github: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0-2.85 17.54c.45.08.62-.2.62-.44v-1.73c-2.52.55-3.05-1.07-3.05-1.07-.41-1.05-1-1.33-1-1.33-.82-.56.06-.55.06-.55.91.06 1.39.94 1.39.94.81 1.38 2.12.98 2.64.75.08-.59.32-.98.57-1.21-2.01-.23-4.12-1-4.12-4.45 0-.98.35-1.79.93-2.42-.09-.23-.4-1.15.09-2.39 0 0 .76-.24 2.47.92A8.6 8.6 0 0 1 12 8.25a8.6 8.6 0 0 1 2.25.31c1.71-1.16 2.47-.92 2.47-.92.49 1.24.18 2.16.09 2.39.58.63.93 1.44.93 2.42 0 3.46-2.12 4.22-4.13 4.45.33.28.62.83.62 1.68v2.52c0 .24.17.52.62.44A9 9 0 0 0 12 3Z"/></svg>'
    };

    const themeValue = () => localStorage.getItem(STORAGE.theme) || 'auto';
    const themeLabel = () => ({ auto: 'Авто', light: 'Светлая', dark: 'Тёмная' }[themeValue()] || 'Авто');
    const notifLabel = () => state.notif?.enabled === false ? 'Выключены' : 'Включены';

    function settingsDeviceId() {
      try {
        if (typeof getOrCreateDeviceId === 'function') return String(getOrCreateDeviceId() || '').trim();
      } catch {}
      return String(localStorage.getItem('fpchat:device-id') || '').trim();
    }

    function settingsInitials(value) {
      const clean = String(value || '').trim().replace(/\s+/g, ' ');
      const parts = clean.split(' ').filter(Boolean);
      const raw = parts.length > 1
        ? `${parts[0][0] || ''}${parts[1][0] || ''}`
        : (parts[0] || 'FP').slice(0, 2);
      return raw.toUpperCase() || 'FP';
    }

    function header(title) {
      return `<div class="fp-settings131-header"><button class="fp-settings131-back" type="button" aria-label="Назад">${icons.back}</button><h2>${safeText(title)}</h2><span></span></div>`;
    }

    function mount(title, html, onBack) {
      swipeCleanup?.();
      els.content.innerHTML = `<div class="fp-settings131" data-page="${currentPage}">${header(title)}<div class="fp-settings131-body">${html}</div></div>`;
      const root = els.content.querySelector('.fp-settings131');
      root.querySelector('.fp-settings131-back').onclick = onBack;
      blockNativeLongPress(root);
      swipeCleanup = () => {};
      return root;
    }

    function row(page, icon, title, subtitle = '', value = '') {
      return `<button class="fp-settings131-row" type="button" data-open="${page}"><span class="fp-settings131-icon ${icon}">${icons[icon]}</span><span class="fp-settings131-copy"><b>${safeText(title)}</b>${subtitle ? `<small>${safeText(subtitle)}</small>` : ''}</span><span class="fp-settings131-value">${safeText(value)}</span><span class="fp-settings131-next">${icons.next}</span></button>`;
    }

    function renderMain() {
      currentPage = 'main';
      const root = mount('Настройки', `<div class="fp-settings131-group">
        ${row('profile', 'profile', 'Профиль', state.nick || '')}
        ${row('notifications', 'notifications', 'Уведомления', '', notifLabel())}
        ${row('privacy', 'privacy', 'Конфиденциальность')}
        ${row('appearance', 'appearance', 'Оформление', '', themeLabel())}
        ${row('storage', 'storage', 'Данные и хранилище', 'Раздел в разработке')}
        ${row('about', 'about', 'О приложении', 'FPChat', `Build ${BUILD}`)}
      </div>`, () => setView('chats'));
      root.querySelectorAll('[data-open]').forEach((el) => el.onclick = () => openPage(el.dataset.open));
    }

    function renderProfile() {
      currentPage = 'profile';
      const root = mount('Профиль', `<div class="fp-settings131-card"><label for="fpNick131">Ваш ник</label><input id="fpNick131" value="${safeText(state.nick)}" autocomplete="nickname"><p>Изменения сохраняются автоматически.</p></div>`, renderMain);
      const input = root.querySelector('#fpNick131');
      input.oninput = () => {
        const value = input.value.trim();
        if (!value) return;
        state.nick = value;
        localStorage.setItem(STORAGE.nick, value);
      };
      input.onblur = () => { if (!input.value.trim()) input.value = state.nick; };
    }

    function renderNotifications() {
      currentPage = 'notifications';
      baseRenderSettings();
      const panel = els.content.querySelector('.panel');
      const section = [...(panel?.querySelectorAll('.settings-section') || [])]
        .find((el) => el.querySelector('h3')?.textContent?.trim() === 'Уведомления');
      if (!section) {
        mount('Уведомления', '<div class="fp-settings131-card"><p>Не удалось загрузить настройки уведомлений.</p></div>', renderMain);
        return;
      }
      section.remove();
      const root = mount('Уведомления', '<div id="fpNotifHost131"></div>', renderMain);
      root.querySelector('#fpNotifHost131').appendChild(section);
    }

    function renderPrivacy() {
      currentPage = 'privacy';
      const root = mount('Конфиденциальность', `<div class="fp-settings131-card fp-privacy155-card">
        <label class="fp-privacy155-option" for="fpPrivacySearch155">
          <span class="fp-privacy155-copy"><b>Разрешить поиск по @username</b><small>Другие пользователи смогут находить ваш профиль по точному @username.</small></span>
          <span class="fp-privacy155-switch"><input id="fpPrivacySearch155" type="checkbox" checked disabled><span class="fp-privacy155-track"></span></span>
        </label>
        <label class="fp-privacy155-option" for="fpPrivacyRequests155">
          <span class="fp-privacy155-copy"><b>Разрешить запросы на новый чат</b><small>Другие пользователи смогут отправлять вам запросы на новый приватный чат.</small></span>
          <span class="fp-privacy155-switch"><input id="fpPrivacyRequests155" type="checkbox" checked disabled><span class="fp-privacy155-track"></span></span>
        </label>
      </div>
      <div class="fp-settings131-group fp-privacy162-nav">
        ${row('blacklist', 'blocked', 'Чёрный список', 'Заблокированные пользователи')}
      </div>
      <div id="fpPrivacyStatus155" class="fp-privacy155-status">Загружаем настройки…</div>`, renderMain);

      const search = root.querySelector('#fpPrivacySearch155');
      const requests = root.querySelector('#fpPrivacyRequests155');
      const status = root.querySelector('#fpPrivacyStatus155');
      const deviceId = settingsDeviceId();
      let statusTimer = 0;

      root.querySelector('[data-open="blacklist"]').onclick = () => openPage('blacklist');

      const setBusy = (value) => {
        search.disabled = value;
        requests.disabled = value;
      };
      const setStatus = (text, kind = '') => {
        clearTimeout(statusTimer);
        status.textContent = text || '';
        status.className = `fp-privacy155-status${kind ? ` ${kind}` : ''}`;
      };
      const applyPrivacy = (data) => {
        search.checked = data?.allowUsernameSearch !== false;
        requests.checked = data?.allowChatRequests !== false;
      };

      async function saveToggle(input, field) {
        const wanted = input.checked;
        const previous = !wanted;
        setBusy(true);
        setStatus('Сохраняем…');
        try {
          const response = await fetch('/api/profile/privacy', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId, [field]: wanted })
          });
          const data = await response.json().catch(() => null);
          if (!response.ok || !data?.ok) throw new Error('privacy save failed');
          applyPrivacy(data);
          setStatus('Сохранено', 'success');
          statusTimer = setTimeout(() => {
            if (status.isConnected && status.textContent === 'Сохранено') setStatus('');
          }, 1200);
        } catch {
          input.checked = previous;
          setStatus('Не удалось сохранить настройку.', 'error');
        } finally {
          setBusy(false);
        }
      }

      search.addEventListener('change', () => saveToggle(search, 'allowUsernameSearch'));
      requests.addEventListener('change', () => saveToggle(requests, 'allowChatRequests'));

      (async () => {
        if (!deviceId) {
          setStatus('Не удалось определить это устройство.', 'error');
          return;
        }
        try {
          const params = new URLSearchParams({ deviceId });
          const response = await fetch(`/api/profile/privacy?${params.toString()}`, { cache: 'no-store' });
          const data = await response.json().catch(() => null);
          if (!response.ok || !data?.ok) throw new Error('privacy load failed');
          applyPrivacy(data);
          setStatus('');
          setBusy(false);
        } catch {
          setStatus('Не удалось загрузить настройки конфиденциальности.', 'error');
        }
      })();
    }

    function renderBlacklist() {
      currentPage = 'blacklist';
      const root = mount('Чёрный список', '<div id="fpBlacklist162" class="fp-blacklist162"><div class="fp-blacklist162-loading">Загружаем список…</div></div>', renderPrivacy);
      const host = root.querySelector('#fpBlacklist162');
      const deviceId = settingsDeviceId();

      const renderEmpty = () => {
        host.replaceChildren();
        const empty = document.createElement('div');
        empty.className = 'fp-blacklist162-empty';
        const title = document.createElement('b');
        title.textContent = 'Чёрный список пуст';
        const text = document.createElement('span');
        text.textContent = 'Здесь появятся пользователи, которых вы заблокировали в запросах на новый чат.';
        empty.append(title, text);
        host.appendChild(empty);
      };

      const removeBlock = async (item, blockId, button) => {
        if (!blockId || button.disabled) return;
        button.disabled = true;
        button.textContent = 'Разблокируем…';
        try {
          const response = await fetch(`/api/chat-requests/blocks/${encodeURIComponent(blockId)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId })
          });
          const data = await response.json().catch(() => null);
          if (!response.ok || !data?.ok) throw new Error('unblock failed');
          item.remove();
          try { window.dispatchEvent(new CustomEvent('fpchat:block-list-changed')); } catch {}
          if (!host.querySelector('.fp-blacklist162-item')) renderEmpty();
        } catch {
          button.disabled = false;
          button.textContent = 'Разблокировать';
          const error = item.querySelector('.fp-blacklist162-error');
          if (error) error.textContent = 'Не удалось разблокировать пользователя.';
        }
      };

      const renderBlocks = (blocks) => {
        host.replaceChildren();
        if (!blocks.length) return renderEmpty();
        const list = document.createElement('div');
        list.className = 'fp-blacklist162-list';
        for (const block of blocks) {
          const user = block?.user || {};
          const item = document.createElement('div');
          item.className = 'fp-blacklist162-item';

          const avatar = document.createElement('div');
          avatar.className = 'fp-blacklist162-avatar';
          avatar.textContent = settingsInitials(user.displayName || user.username);

          const copy = document.createElement('div');
          copy.className = 'fp-blacklist162-copy';
          const name = document.createElement('b');
          name.textContent = user.displayName || user.username || 'Пользователь FPChat';
          const error = document.createElement('small');
          error.className = 'fp-blacklist162-error';
          copy.appendChild(name);
          if (user.username) {
            const handle = document.createElement('span');
            handle.textContent = `@${user.username}`;
            copy.appendChild(handle);
          }
          copy.appendChild(error);

          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'fp-blacklist162-unblock';
          button.textContent = 'Разблокировать';
          button.onclick = () => void removeBlock(item, block.blockId, button);

          item.append(avatar, copy, button);
          list.appendChild(item);
        }
        host.appendChild(list);
      };

      (async () => {
        if (!deviceId) {
          host.innerHTML = '<div class="fp-blacklist162-empty"><b>Не удалось определить устройство</b><span>Откройте настройки повторно.</span></div>';
          return;
        }
        try {
          const response = await fetch(`/api/chat-requests/blocks?${new URLSearchParams({ deviceId }).toString()}`, { cache: 'no-store' });
          const data = await response.json().catch(() => null);
          if (!response.ok || !data?.ok) throw new Error('blacklist load failed');
          renderBlocks(Array.isArray(data.blocks) ? data.blocks : []);
        } catch {
          host.innerHTML = '<div class="fp-blacklist162-empty"><b>Не удалось загрузить чёрный список</b><span>Проверьте соединение и откройте раздел снова.</span></div>';
        }
      })();
    }

    function renderAppearance() {
      currentPage = 'appearance';
      const root = mount('Оформление', `<div class="fp-settings131-card"><label for="fpTheme131">Тема</label><select id="fpTheme131"><option value="auto">Авто</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select><p>Шрифты, размер текста, превью тем и собственные обои добавим позже.</p></div>`, renderMain);
      const select = root.querySelector('#fpTheme131');
      select.value = themeValue();
      select.onchange = () => applyTheme(select.value);
    }

    function renderStorage() {
      currentPage = 'storage';
      mount('Данные и хранилище', '<div class="fp-settings131-card fp-settings131-dev"><div><b>Раздел в разработке</b><span>Настройки данных и очистки хранилища появятся позже.</span></div></div>', renderMain);
    }

    function renderAbout() {
      currentPage = 'about';
      baseRenderSettings();
      const panel = els.content.querySelector('.panel');
      const install = [...(panel?.querySelectorAll('.settings-section') || [])]
        .find((el) => el.querySelector('h3')?.textContent?.trim() === 'Установка приложения');
      install?.remove();
      panel?.querySelector('#settingsVersion')?.remove();

      const root = mount('О приложении', `<div class="fp-settings131-card"><div class="fp-settings131-about"><div class="fp-settings131-logo">FP</div><b>FPChat</b><span id="fpVersion131">Версия 1.0.0 · Build ${BUILD}</span></div><div id="fpInstallHost131"></div><a class="fp-settings131-link" href="https://github.com/Freep-o-0-rn/FPChat" target="_blank" rel="noopener noreferrer">${icons.github}<span>GitHub проекта</span></a></div>`, renderMain);
      if (install) root.querySelector('#fpInstallHost131').appendChild(install);
      const loading186 = window.FPRuntime169?.loading;
      if (loading186) {
        const diagnostics = document.createElement('div');
        diagnostics.className = 'fp-settings131-card';
        diagnostics.innerHTML = '<b>Диагностика загрузки</b><p>Сохраняет время загрузки и типы ошибок текущего запуска. Без содержимого переписки и медиа. Отчёт никуда не отправляется автоматически.</p><button id="fpLoadingExport186" class="btn btn-secondary" type="button">Скачать отчёт загрузки</button><button id="fpLoadingReset186" class="btn btn-secondary" type="button">Очистить замеры</button><p id="fpLoadingStatus186" role="status"></p>';
        root.querySelector('.fp-settings131-body').appendChild(diagnostics);
        diagnostics.querySelector('#fpLoadingExport186').onclick = () => {
          try { loading186.download(); diagnostics.querySelector('#fpLoadingStatus186').textContent = 'Отчёт подготовлен для сохранения.'; }
          catch { diagnostics.querySelector('#fpLoadingStatus186').textContent = 'Не удалось сохранить отчёт. Попробуйте ещё раз.'; }
        };
        diagnostics.querySelector('#fpLoadingReset186').onclick = () => {
          loading186.reset(); diagnostics.querySelector('#fpLoadingStatus186').textContent = 'Замеры чатов и медиа очищены. Время запуска сохранено.';
        };
      }
      fetch('/version.json', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((data) => {
        if (!data) return;
        const line = root.querySelector('#fpVersion131');
        if (line) { const build=String(data.build ?? '').trim(); line.textContent = `Версия ${data.version || '1.0.0'} · Build ${/^\d+(?:\.\d+)*$/.test(build) ? build : BUILD}`; }
      }).catch(() => {});
    }

    function openPage(page) {
      if (page === 'profile') return renderProfile();
      if (page === 'notifications') return renderNotifications();
      if (page === 'privacy') return renderPrivacy();
      if (page === 'blacklist') return renderBlacklist();
      if (page === 'appearance') return renderAppearance();
      if (page === 'storage') return renderStorage();
      if (page === 'about') return renderAbout();
      renderMain();
    }

    function blockNativeLongPress(root) {
      root.addEventListener('contextmenu', (e) => {
        if (e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
      }, true);
      root.addEventListener('dragstart', (e) => {
        if (!e.target.closest('input,textarea,[contenteditable="true"]')) e.preventDefault();
      }, true);
    }

    function installBackSwipe(root, goBack) {
      if (typeof PointerEvent === 'undefined') return () => {};
      const EDGE_PX = 32;
      let gesture = null;
      let suppressClickUntil = 0;
      const editable = (t) => Boolean(t.closest('input,textarea,select,[contenteditable="true"]'));

      const down = (e) => {
        if (e.pointerType === 'mouse' || e.button !== 0 || editable(e.target) || e.clientX > EDGE_PX) return;
        gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), mode: null, dx: 0 };
        try { root.setPointerCapture(e.pointerId); } catch {}
      };
      const move = (e) => {
        if (!gesture || gesture.id !== e.pointerId) return;
        const dx = e.clientX - gesture.x;
        const dy = e.clientY - gesture.y;
        if (!gesture.mode && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
          gesture.mode = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.15 ? 'back' : 'other';
        }
        if (gesture.mode !== 'back') return;
        e.preventDefault();
        e.stopPropagation();
        gesture.dx = Math.max(0, dx);
        const w = Math.max(1, root.clientWidth);
        const x = Math.min(gesture.dx, w * .88);
        root.style.transform = `translate3d(${x}px,0,0)`;
        root.style.opacity = String(Math.max(.72, 1 - x / w * .22));
      };
      const finish = (e, cancelled) => {
        if (!gesture || gesture.id !== e.pointerId) return;
        const velocity = gesture.dx / Math.max(1, performance.now() - gesture.t);
        const commit = !cancelled && gesture.mode === 'back' && (gesture.dx >= 82 || (gesture.dx >= 46 && velocity >= .55));
        try { root.releasePointerCapture(e.pointerId); } catch {}
        gesture = null;
        root.classList.add('fp-settings131-anim');
        if (!commit) {
          root.style.transform = '';
          root.style.opacity = '';
          setTimeout(() => root.classList.remove('fp-settings131-anim'), 180);
          return;
        }
        suppressClickUntil = Date.now() + 450;
        root.style.transform = 'translate3d(105%,0,0)';
        root.style.opacity = '.7';
        setTimeout(goBack, 135);
      };
      const up = (e) => finish(e, false);
      const cancel = (e) => finish(e, true);
      const click = (e) => {
        if (Date.now() < suppressClickUntil) {
          e.preventDefault();
          e.stopPropagation();
        }
      };

      root.addEventListener('pointerdown', down, { passive: true });
      root.addEventListener('pointermove', move, { passive: false });
      root.addEventListener('pointerup', up, { passive: true });
      root.addEventListener('pointercancel', cancel, { passive: true });
      root.addEventListener('click', click, true);
      return () => {
        root.removeEventListener('pointerdown', down);
        root.removeEventListener('pointermove', move);
        root.removeEventListener('pointerup', up);
        root.removeEventListener('pointercancel', cancel);
        root.removeEventListener('click', click, true);
      };
    }

    renderSettings = function renderSettings131() { renderMain(); };
  };

  boot();
})();
