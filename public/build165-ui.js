/* Build 167: safe presentation bridge, explicit blocked-voice feedback and storage layer loader. */
(() => {
  if (window.__fpBuild165UiInstalled) return;
  window.__fpBuild165UiInstalled = true;

  const BUILD_LABEL = 'Build 167';
  const currentScript = document.currentScript;
  const storageSuffix = (() => {
    try { return new URL(currentScript?.src || '', window.location.href).search || '?v=167'; }
    catch { return '?v=167'; }
  })();
  let voiceBlockNoticeUntil = 0;
  let voiceNoticeTimer = 0;

  function patchBuildLabels() {
    document.querySelectorAll('.fp-settings131-value').forEach((node) => {
      const current = String(node.textContent || '').trim();
      if (/^Build\s+\d+$/i.test(current) && current !== BUILD_LABEL) {
        node.textContent = BUILD_LABEL;
      }
    });
    const about = document.getElementById('fpVersion131');
    if (about && /Build\s+\d+/i.test(about.textContent || '')) {
      const next = String(about.textContent).replace(/Build\s+\d+/i, BUILD_LABEL);
      if (next !== about.textContent) about.textContent = next;
    }
  }

  function patchBlockedInviteCardText() {
    document.querySelectorAll('.fp-system145-event .fp-system145-request-text').forEach((node) => {
      const text = String(node.textContent || '');
      if (/Попытался присоединиться к вашему чату по invite-ссылке \d+ раз\./.test(text)) {
        const next = 'Повторно пытался присоединиться к вашему чату по invite-ссылке. Все попытки отклонены из-за блокировки.';
        if (text !== next) node.textContent = next;
      }
    });
  }

  function patchUi() {
    patchBuildLabels();
    patchBlockedInviteCardText();
  }

  function blockedByPeerInCurrentRoom() {
    const line = document.getElementById('presenceLine');
    return Boolean(line && /Статус недоступен/i.test(String(line.textContent || '')));
  }

  function showVoiceBlockNotice(code = 'USER_BLOCKED_BY_PEER') {
    const text = code === 'USER_BLOCKED_BY_YOU'
      ? 'Голосовое не отправлено: сначала разблокируйте пользователя.'
      : 'Голосовое не отправлено: пользователь вас заблокировал.';
    voiceBlockNoticeUntil = Date.now() + 3000;

    const form = document.getElementById('sendForm');
    const host = form?.parentElement || document.querySelector('.chat-view');
    if (!host) {
      window.alert(text);
      return;
    }

    clearTimeout(voiceNoticeTimer);
    let bar = document.getElementById('fpVoiceBlockWarning166');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'fpVoiceBlockWarning166';
      bar.className = 'fp-block165-warning';
      if (form?.parentElement === host) host.insertBefore(bar, form);
      else host.appendChild(bar);
    }
    bar.textContent = text;
    bar.hidden = false;
    voiceNoticeTimer = setTimeout(() => bar?.remove(), 5000);
  }

  function blockVoiceUiEvent(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.fp-voice-record-btn,.fp-voice-record-send,.fp-voice-preview-send')) return;
    if (!blockedByPeerInCurrentRoom()) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    showVoiceBlockNotice('USER_BLOCKED_BY_PEER');
  }

  document.addEventListener('pointerdown', blockVoiceUiEvent, true);
  document.addEventListener('click', blockVoiceUiEvent, true);

  if (!window.__fpVoiceBlockFetch166Wrapped) {
    window.__fpVoiceBlockFetch166Wrapped = true;
    const baseFetch = window.fetch.bind(window);
    window.fetch = async function fpVoiceBlockFetch166(input, init) {
      const response = await baseFetch(input, init);
      try {
        const url = typeof input === 'string' ? input : String(input?.url || '');
        if (response.status === 403 && /\/api\/rooms\/[^/]+\/voice\/upload(?:\?|$)/.test(url)) {
          const data = await response.clone().json().catch(() => null);
          if (data?.code === 'USER_BLOCKED_BY_PEER' || data?.code === 'USER_BLOCKED_BY_YOU') {
            showVoiceBlockNotice(data.code);
          }
        }
      } catch {}
      return response;
    };
  }

  if (!window.__fpVoiceBlockAlert166Wrapped) {
    window.__fpVoiceBlockAlert166Wrapped = true;
    const baseAlert = window.alert.bind(window);
    window.alert = function fpVoiceBlockAlert166(message) {
      const text = String(message || '');
      if (Date.now() < voiceBlockNoticeUntil && /^Не удалось отправить голосовое сообщение\./.test(text)) return;
      return baseAlert(message);
    };
  }

  const loadStorageCacheFix = () => {
    if (document.querySelector('script[data-fp-storage167-cache-fix]')) return;
    const fix = document.createElement('script');
    fix.src = `/storage167-cache-fix.js${storageSuffix}`;
    fix.dataset.fpStorage167CacheFix = '1';
    document.body.appendChild(fix);
  };

  const loadStorageClearGuard = () => {
    if (document.querySelector('script[data-fp-storage167-clear-guard]')) {
      if (window.FPStorage167ClearGuard) loadStorageCacheFix();
      else document.querySelector('script[data-fp-storage167-clear-guard]')?.addEventListener('load', loadStorageCacheFix, { once: true });
      return;
    }
    const guard = document.createElement('script');
    guard.src = `/storage167-clear-guard.js${storageSuffix}`;
    guard.dataset.fpStorage167ClearGuard = '1';
    guard.onload = loadStorageCacheFix;
    document.body.appendChild(guard);
  };

  if (!document.querySelector('script[data-fp-storage167]')) {
    const storage = document.createElement('script');
    storage.src = `/storage167.js${storageSuffix}`;
    storage.dataset.fpStorage167 = '1';
    storage.onload = loadStorageClearGuard;
    document.body.appendChild(storage);
  } else if (window.FPStorage167) {
    loadStorageClearGuard();
  } else {
    const storage = document.querySelector('script[data-fp-storage167]');
    storage?.addEventListener('load', loadStorageClearGuard, { once: true });
  }

  const observer = new MutationObserver(patchUi);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  patchUi();
})();
