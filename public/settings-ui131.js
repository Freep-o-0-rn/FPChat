/* Build 138: isolated Telegram-like settings UI over stable Build 129 mechanics. */
(() => {
  if (window.__fpSettings131LoaderStarted) return;
  window.__fpSettings131LoaderStarted = true;

  const BUILD = 138;
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
      appearance: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-.6-.5-1-1-1h-3.2a2.8 2.8 0 0 1-2.8-2.8V5c0-1.1-.9-2-2-2Z"/><path d="M7.5 10.5h.01M9.5 15h.01M6.5 14h.01"/></svg>',
      notifications: '<svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>',
      storage: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
      about: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 7h.01"/></svg>',
      back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
      next: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
      github: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0-2.85 17.54c.45.08.62-.2.62-.44v-1.73c-2.52.55-3.05-1.07-3.05-1.07-.41-1.05-1-1.33-1-1.33-.82-.56.06-.55.06-.55.91.06 1.39.94 1.39.94.81 1.38 2.12.98 2.64.75.08-.59.32-.98.57-1.21-2.01-.23-4.12-1-4.12-4.45 0-.98.35-1.79.93-2.42-.09-.23-.4-1.15.09-2.39 0 0 .76-.24 2.47.92A8.6 8.6 0 0 1 12 8.25a8.6 8.6 0 0 1 2.25.31c1.71-1.16 2.47-.92 2.47-.92.49 1.24.18 2.16.09 2.39.58.63.93 1.44.93 2.42 0 3.46-2.12 4.22-4.13 4.45.33.28.62.83.62 1.68v2.52c0 .24.17.52.62.44A9 9 0 0 0 12 3Z"/></svg>'
    };

    const themeValue = () => localStorage.getItem(STORAGE.theme) || 'auto';
    const themeLabel = () => ({ auto: 'Авто', light: 'Светлая', dark: 'Тёмная' }[themeValue()] || 'Авто');
    const notifLabel = () => state.notif?.enabled === false ? 'Выключены' : 'Включены';

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
        ${row('appearance', 'appearance', 'Оформление', '', themeLabel())}
        ${row('notifications', 'notifications', 'Уведомления', '', notifLabel())}
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

    function renderAppearance() {
      currentPage = 'appearance';
      const root = mount('Оформление', `<div class="fp-settings131-card"><label for="fpTheme131">Тема</label><select id="fpTheme131"><option value="auto">Авто</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select><p>Шрифты, размер текста, превью тем и собственные обои добавим позже.</p></div>`, renderMain);
      const select = root.querySelector('#fpTheme131');
      select.value = themeValue();
      select.onchange = () => applyTheme(select.value);
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
      fetch('/version.json', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((data) => {
        if (!data) return;
        const line = root.querySelector('#fpVersion131');
        if (line) line.textContent = `Версия ${data.version || '1.0.0'} · Build ${Number(data.build) || BUILD}`;
      }).catch(() => {});
    }

    function openPage(page) {
      if (page === 'profile') return renderProfile();
      if (page === 'appearance') return renderAppearance();
      if (page === 'notifications') return renderNotifications();
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
