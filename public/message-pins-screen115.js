/* Build 170: pinned-messages screen with event-driven WebSocket tracking. */
(() => {
  const LONG_PRESS_MS = 450;
  const MOVE_CANCEL_PX = 12;
  const thumbCache = new Map();
  let view = null;
  let attachedWs = null;

  const numericId = (value) => {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };

  function currentRoomId() {
    try { return String(state?.roomId || ''); } catch { return ''; }
  }

  function roomDevice(roomId = currentRoomId()) {
    try { return String(STORAGE.get(STORAGE.roomState(roomId))?.deviceId || '').trim(); } catch { return ''; }
  }

  function mediaFallback(message, text = '') {
    const plain = String(text || '').trim();
    if (plain) return plain;
    const media = Array.isArray(message?.media) ? message.media : [];
    if (media.length > 1) return 'Альбом';
    if (media[0]?.media_kind === 'video') return 'Видео';
    if (media.length === 1) return 'Фото';
    return 'Медиа';
  }

  async function fetchPins(roomId) {
    const deviceId = roomDevice(roomId);
    if (!roomId || !deviceId) return [];
    const query = new URLSearchParams({ deviceId });
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/pins?${query}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('pins request failed');
    const data = await response.json();
    if (!data?.ok || !Array.isArray(data.pins)) throw new Error('invalid pins response');
    const pins = [];
    for (const raw of data.pins) {
      const message = raw?.message;
      const messageId = numericId(raw?.messageId || message?.id);
      if (!messageId || !message || message.type === 'system') continue;
      let text = '';
      try { text = await decryptRoomText(roomId, message); } catch {}
      const preview = message.type === 'media' ? mediaFallback(message, text) : (String(text || '').trim() || 'Сообщение недоступно');
      pins.push({ ...raw, messageId, message, preview, searchText: `${message.sender_name || ''} ${preview}`.toLocaleLowerCase('ru-RU') });
    }
    return pins.sort((a, b) => a.messageId - b.messageId);
  }

  function closeScreen() {
    closeActionSheet();
    document.querySelector('.fp-pins114-screen')?.remove();
    document.body.classList.remove('fp-pins114-open');
    view = null;
  }

  async function showInChat(messageId) {
    closeScreen();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (typeof findAndFocusReplyMessage === 'function') await findAndFocusReplyMessage(messageId);
  }

  function matchesSearch(pin) {
    return !view?.search || pin.searchText.includes(view.search);
  }

  function counts() {
    const pins = (view?.pins || []).filter(matchesSearch);
    return {
      all: pins.length,
      shared: pins.filter((pin) => pin.shared).length,
      personal: pins.filter((pin) => pin.personal).length
    };
  }

  function visiblePins() {
    const pins = (view?.pins || []).filter(matchesSearch);
    if (view?.filter === 'shared') return pins.filter((pin) => pin.shared);
    if (view?.filter === 'personal') return pins.filter((pin) => pin.personal);
    return pins;
  }

  function displayScope(pin) {
    if (view?.filter === 'personal') return 'personal';
    if (view?.filter === 'shared') return 'shared';
    return pin.shared ? 'shared' : 'personal';
  }

  function isMine(pin) {
    return String(pin?.message?.sender_device_id || '') === roomDevice(view?.roomId || currentRoomId());
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error || new Error('thumbnail reader failed'));
      reader.readAsDataURL(blob);
    });
  }

  async function stableThumbUrl(media, roomId) {
    const key = String(media?.public_id || media?.id || '');
    if (!key) return '';
    if (thumbCache.has(key)) return await thumbCache.get(key);

    const task = (async () => {
      if (media?.public_id && typeof decryptBlobWithIvPrefix === 'function') {
        const deviceId = roomDevice(roomId);
        if (deviceId) {
          const key=await getRoomKey(roomId);
          const plain=await readEncryptedMedia174(`/api/media/${encodeURIComponent(media.public_id)}/thumb?deviceId=${encodeURIComponent(deviceId)}`,'image/webp',key,{cache:'no-store'});
          return await blobToDataUrl(plain);
        }
      }

      if (typeof fetchMediaThumbUrl !== 'function') return '';
      const objectUrl = await fetchMediaThumbUrl(media);
      if (!objectUrl) return '';
      try {
        const response = await fetch(objectUrl);
        if (!response.ok) return objectUrl;
        return await blobToDataUrl(await response.blob());
      } finally {
        if (String(objectUrl).startsWith('blob:')) {
          try { URL.revokeObjectURL(objectUrl); } catch {}
        }
      }
    })().catch(() => '');

    thumbCache.set(key, task);
    const result = await task;
    if (!result) thumbCache.delete(key);
    return result;
  }

  function revealThumb(card, img) {
    if (!card?.isConnected || !img?.naturalWidth) return;
    img.hidden = false;
    card.querySelector('.fp-pins114-thumb-fallback')?.setAttribute('hidden', '');
  }

  async function loadThumb(pin, card) {
    const media = Array.isArray(pin?.message?.media) ? pin.message.media : [];
    const first = media[0];
    const img = card.querySelector('.fp-pins114-thumb-img');
    if (!first || !img) return;
    try {
      const url = await stableThumbUrl(first, view?.roomId || currentRoomId());
      if (!url || !card.isConnected) return;
      img.onload = () => revealThumb(card, img);
      img.onerror = () => {
        img.hidden = true;
        card.querySelector('.fp-pins114-thumb-fallback')?.removeAttribute('hidden');
      };
      img.src = url;
      if (img.complete && img.naturalWidth) revealThumb(card, img);
    } catch {}
  }

  function clearNativeSelection() {
    try {
      const selection = document.getSelection?.();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
    } catch {}
  }

  function bindCard(card, pin) {
    let timer = null;
    let x = 0;
    let y = 0;
    let moved = false;
    let longPressed = false;
    const cancel = () => { if (timer) clearTimeout(timer); timer = null; };

    card.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      x = touch.clientX; y = touch.clientY; moved = false; longPressed = false; cancel();
      timer = setTimeout(() => {
        if (moved || !card.isConnected) return;
        longPressed = true;
        card.dataset.suppressClickUntil = String(Date.now() + 650);
        clearNativeSelection();
        navigator.vibrate?.(10);
        openActionSheet(pin);
        requestAnimationFrame(clearNativeSelection);
      }, LONG_PRESS_MS);
    }, { passive: true });

    card.addEventListener('touchmove', (event) => {
      if (event.touches.length !== 1) { moved = true; cancel(); return; }
      const touch = event.touches[0];
      if (Math.hypot(touch.clientX - x, touch.clientY - y) > MOVE_CANCEL_PX) { moved = true; cancel(); }
    }, { passive: true });
    card.addEventListener('touchend', cancel, { passive: true });
    card.addEventListener('touchcancel', cancel, { passive: true });
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault(); event.stopPropagation();
      card.dataset.suppressClickUntil = String(Date.now() + 450);
      clearNativeSelection();
      openActionSheet(pin);
    });
    card.addEventListener('click', (event) => {
      if (longPressed || Date.now() < Number(card.dataset.suppressClickUntil || 0)) {
        event.preventDefault(); event.stopPropagation(); longPressed = false; return;
      }
      void showInChat(pin.messageId);
    });
  }

  function cardFor(pin) {
    const scope = displayScope(pin);
    const media = Array.isArray(pin.message?.media) ? pin.message.media : [];
    const first = media[0];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `fp-pins114-card${isMine(pin) ? ' mine' : ''}`;
    card.dataset.messageId = String(pin.messageId);
    const extra = media.length > 1 ? media.length - 1 : 0;
    const thumb = pin.message?.type === 'media' && first
      ? `<span class="fp-pins114-thumb"><img class="fp-pins114-thumb-img" alt="" draggable="false" hidden><span class="fp-pins114-thumb-fallback">${first.media_kind === 'video' ? '▶' : '▧'}</span>${first.media_kind === 'video' ? '<span class="fp-pins114-play">▶</span>' : ''}${extra ? `<span class="fp-pins114-extra">+${extra}</span>` : ''}</span>`
      : '';
    card.innerHTML = `<span class="fp-pins114-bubble"><span class="fp-pins114-author"></span><span class="fp-pins114-content">${thumb}<span class="fp-pins114-text"></span></span><span class="fp-pins114-meta"><span class="fp-pins114-badge ${scope}">${scope === 'personal' ? 'Личный' : 'Общий'}</span><span class="fp-pins114-time"></span></span></span>`;
    card.querySelector('.fp-pins114-author').textContent = pin.message?.sender_name || 'Неизвестно';
    card.querySelector('.fp-pins114-text').textContent = pin.preview;
    card.querySelector('.fp-pins114-time').textContent = typeof formatMessageTime === 'function' ? formatMessageTime(pin.message?.created_at) : '';
    bindCard(card, pin);
    if (thumb) void loadThumb(pin, card);
    return card;
  }

  function render() {
    const root = document.querySelector('.fp-pins114-screen');
    if (!root || !view) return;
    const pins = visiblePins();
    const c = counts();
    const heading = root.querySelector('.fp-pins114-heading');
    if (heading) heading.textContent = `Закреплено ${pins.length}`;
    root.querySelectorAll('[data-filter]').forEach((button) => {
      const key = button.dataset.filter;
      button.classList.toggle('active', key === view.filter);
      button.setAttribute('aria-selected', key === view.filter ? 'true' : 'false');
      const count = button.querySelector('.fp-pins114-tab-count');
      if (count) count.textContent = String(c[key] ?? 0);
    });
    const list = root.querySelector('.fp-pins114-list');
    list.replaceChildren();
    if (!pins.length) {
      const empty = document.createElement('div');
      empty.className = 'fp-pins114-empty';
      empty.textContent = 'Нет закреплённых сообщений';
      list.appendChild(empty);
      return;
    }
    pins.forEach((pin) => list.appendChild(cardFor(pin)));
  }

  async function refresh() {
    if (!view) return;
    try {
      view.pins = await fetchPins(view.roomId);
      render();
    } catch {}
  }

  async function openScreen() {
    const roomId = currentRoomId();
    if (!roomId) return;
    closeScreen();
    view = { roomId, filter: 'all', search: '', pins: [] };
    const root = document.createElement('div');
    root.className = 'fp-pins114-screen';
    root.innerHTML = '<div class="fp-pins114-panel"><div class="fp-pins114-header"><button type="button" class="fp-pins114-back" aria-label="Назад">←</button><div class="fp-pins114-heading">Закреплено 0</div><span></span></div><div class="fp-pins114-tabs" role="tablist"><button type="button" role="tab" data-filter="all"><span>Все</span><span class="fp-pins114-tab-count">0</span></button><button type="button" role="tab" data-filter="shared"><span>Общие</span><span class="fp-pins114-tab-count">0</span></button><button type="button" role="tab" data-filter="personal"><span>Личные</span><span class="fp-pins114-tab-count">0</span></button></div><div class="fp-pins114-search-wrap"><input class="fp-pins114-search" type="search" placeholder="Поиск в закреплённых" autocomplete="off"></div><div class="fp-pins114-list"></div></div>';
    document.body.appendChild(root);
    document.body.classList.add('fp-pins114-open');
    root.querySelector('.fp-pins114-back').addEventListener('click', closeScreen);
    root.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { if (view) { view.filter = button.dataset.filter || 'all'; render(); } }));
    root.querySelector('.fp-pins114-search').addEventListener('input', (event) => { if (view) { view.search = String(event.target.value || '').trim().toLocaleLowerCase('ru-RU'); render(); } });
    await refresh();
  }

  function closeActionSheet() {
    document.querySelector('.fp-pins114-action-overlay')?.remove();
  }

  function menuButton(label, action, danger = false) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.action = action; button.textContent = label;
    if (danger) button.classList.add('danger');
    return button;
  }

  function openActionSheet(pin) {
    if (!view) return;
    closeActionSheet();
    clearNativeSelection();
    const overlay = document.createElement('div');
    overlay.className = 'fp-pins114-action-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'fp-pins114-action-sheet';
    sheet.innerHTML = '<div class="fp-pins114-action-title">Закреплённое сообщение</div><div class="fp-pins114-action-list"></div>';
    const list = sheet.querySelector('.fp-pins114-action-list');
    list.appendChild(menuButton('Показать в чате', 'show'));
    if (pin.personal) list.appendChild(menuButton('Открепить у себя', 'unpin-personal'));
    if (pin.shared) list.appendChild(menuButton('Открепить у всех', 'unpin-shared'));
    list.appendChild(menuButton('Удалить у меня', 'delete-self', true));
    if (isMine(pin)) list.appendChild(menuButton('Удалить у всех', 'delete-all', true));
    list.appendChild(menuButton('Отмена', 'cancel'));
    overlay.appendChild(sheet); document.body.appendChild(overlay);
    requestAnimationFrame(clearNativeSelection);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeActionSheet(); });
    list.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
      const action = button.dataset.action;
      if (action === 'cancel') return closeActionSheet();
      if (action === 'show') return void showInChat(pin.messageId);
      if (action.startsWith('unpin-')) {
        list.querySelectorAll('button').forEach((node) => { node.disabled = true; });
        const ok = await unpin(pin.messageId, action.endsWith('personal') ? 'personal' : 'shared');
        if (ok) { closeActionSheet(); await refresh(); } else list.querySelectorAll('button').forEach((node) => { node.disabled = false; });
        return;
      }
      if (action === 'delete-self' || action === 'delete-all') openDeleteConfirm(pin, action === 'delete-all' ? 'all' : 'self');
    }));
  }

  async function unpin(messageId, scope) {
    if (!view) return false;
    const deviceId = roomDevice(view.roomId);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(view.roomId)}/messages/${messageId}/pins/${scope}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId })
      });
      return response.ok;
    } catch { return false; }
  }

  function openDeleteConfirm(pin, scope) {
    closeActionSheet();
    clearNativeSelection();
    const overlay = document.createElement('div');
    overlay.className = 'fp-pins114-delete-overlay';
    const all = scope === 'all';
    overlay.innerHTML = `<div class="fp-pins114-delete-dialog"><div class="fp-pins114-delete-title">${all ? 'Удалить сообщение у всех?' : 'Удалить сообщение у вас?'}</div><div class="fp-pins114-delete-text">${all ? 'Сообщение будет удалено для обоих участников. Отменить это действие нельзя.' : 'Сообщение исчезнет только у вас.'}</div><div class="fp-pins114-delete-actions"><button type="button" class="danger" data-confirm>${all ? 'Удалить у всех' : 'Удалить у меня'}</button><button type="button" data-cancel>Отмена</button></div></div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(clearNativeSelection);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    overlay.querySelector('[data-cancel]').addEventListener('click', close);
    overlay.querySelector('[data-confirm]').addEventListener('click', async () => {
      overlay.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      const ok = await deleteMessage(pin.messageId, scope);
      if (ok) { close(); await refresh(); }
      else { overlay.querySelectorAll('button').forEach((button) => { button.disabled = false; }); alert('Не удалось удалить сообщение.'); }
    });
  }

  async function deleteMessage(messageId, scope) {
    if (!view) return false;
    const deviceId = roomDevice(view.roomId);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(view.roomId)}/messages/${messageId}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, scope })
      });
      const data = await response.json().catch(() => null);
      return response.ok && data?.ok !== false;
    } catch { return false; }
  }

  function handleWs(event) {
    if (!view) return;
    let payload; try { payload = JSON.parse(event.data); } catch { return; }
    if (String(payload?.roomId || '') !== view.roomId) return;
    if (payload.type === 'pins:changed' || payload.type === 'message:edited' || payload.type === 'message:deleted') void refresh();
  }

  function attachWs() {
    const ws = state?.ws || null;
    if (ws === attachedWs) return;
    if (attachedWs) try { attachedWs.removeEventListener('message', handleWs); } catch {}
    attachedWs = ws;
    if (!ws) return;
    ws.addEventListener('message', handleWs);
  }

  function handleLifecycle170(event) {
    if (!view) return;
    const type = String(event?.detail?.lastType || '');
    if (type === 'foreground' || type === 'online' || type === 'pageshow') void refresh();
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('.chat-pin-all');
    if (!button) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void openScreen();
  }, true);

  document.addEventListener('selectstart', (event) => {
    if (event.target?.closest?.('.fp-pins114-card,.fp-pins114-action-overlay,.fp-pins114-delete-overlay')) event.preventDefault();
  }, true);

  document.addEventListener('dragstart', (event) => {
    if (event.target?.closest?.('.fp-pins114-card,.fp-pins114-action-overlay,.fp-pins114-delete-overlay')) event.preventDefault();
  }, true);

  document.addEventListener('contextmenu', (event) => {
    if (!event.target?.closest?.('.fp-pins114-action-overlay,.fp-pins114-delete-overlay')) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  document.addEventListener('selectionchange', () => {
    if (!document.querySelector('.fp-pins114-action-overlay,.fp-pins114-delete-overlay')) return;
    clearNativeSelection();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (document.querySelector('.fp-pins114-delete-overlay')) return document.querySelector('.fp-pins114-delete-overlay')?.remove();
    if (document.querySelector('.fp-pins114-action-overlay')) return closeActionSheet();
    if (view) { event.preventDefault(); closeScreen(); }
  }, true);

  window.addEventListener('fpchat:connection170', attachWs, { passive: true });
  window.addEventListener('fpchat:lifecycle170', handleLifecycle170, { passive: true });
  window.addEventListener('fpchat:room-open170', (event) => {
    const stage = event?.detail?.stage;
    const roomId = String(event?.detail?.roomId || '');
    if (stage === 'left') closeScreen();
    if (stage === 'ready' && view && view.roomId === roomId) void refresh();
  }, { passive: true });

  attachWs();
})();
