/* Build 113: isolated hybrid shared/personal message pins layer. */
(() => {
  const ROOT = '.message-context-root';
  const MENU = '.message-context-menu';
  const COPY = '.message-context-copy';
  const ACTION = 'pin';
  const pinsByRoom = new Map();
  const syncByRoom = new Map();
  let attachedWs = null;
  let scrollRaf = 0;
  let screenState = null;

  function numericId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function roomId() {
    try { return String(state?.roomId || ''); } catch { return ''; }
  }

  function roomDevice(id = roomId()) {
    if (!id) return '';
    try { return String(STORAGE.get(STORAGE.roomState(id))?.deviceId || '').trim(); } catch { return ''; }
  }

  function closeContext(root = document.querySelector(ROOT)) {
    const backdrop = root?.querySelector('.message-context-backdrop');
    if (backdrop) backdrop.click();
    else {
      root?.remove();
      document.body.classList.remove('message-context-open');
    }
  }

  function pinForMessage(id = roomId(), messageId) {
    return (pinsByRoom.get(id) || []).find((pin) => Number(pin.messageId) === Number(messageId)) || null;
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

  async function hydratePins(id, rawPins) {
    const hydrated = [];
    for (const raw of Array.isArray(rawPins) ? rawPins : []) {
      const message = raw?.message;
      const messageId = numericId(raw?.messageId || message?.id);
      if (!messageId || !message || message.type === 'system') continue;
      let text = '';
      try { text = await decryptRoomText(id, message); } catch { text = ''; }
      const preview = message.type === 'media'
        ? mediaFallback(message, text)
        : (String(text || '').trim() || 'Сообщение недоступно');
      hydrated.push({
        ...raw,
        messageId,
        message,
        text,
        preview,
        searchText: `${message.sender_name || ''} ${preview}`.toLocaleLowerCase('ru-RU')
      });
    }
    hydrated.sort((a, b) => a.messageId - b.messageId);
    return hydrated;
  }

  async function setPins(id, rawPins) {
    const pins = await hydratePins(id, rawPins);
    pinsByRoom.set(id, pins);
    if (roomId() === id) {
      renderPinBar();
      if (screenState?.roomId === id) renderPinsScreen();
      refreshOpenContextPinAction();
    }
    return pins;
  }

  async function fetchPins(id = roomId()) {
    const deviceId = roomDevice(id);
    if (!id || !deviceId) return [];
    if (syncByRoom.has(id)) return syncByRoom.get(id);
    const task = (async () => {
      try {
        const query = new URLSearchParams({ deviceId });
        const response = await fetch(`/api/rooms/${encodeURIComponent(id)}/pins?${query}`, { cache: 'no-store' });
        if (!response.ok) return pinsByRoom.get(id) || [];
        const data = await response.json().catch(() => null);
        if (!data?.ok) return pinsByRoom.get(id) || [];
        return await setPins(id, data.pins);
      } catch {
        return pinsByRoom.get(id) || [];
      } finally {
        syncByRoom.delete(id);
      }
    })();
    syncByRoom.set(id, task);
    return task;
  }

  function scopeLabel(scope) {
    return scope === 'personal' ? 'Личный' : 'Общий';
  }

  function displayScope(pin, filter = 'all') {
    if (filter === 'personal') return 'personal';
    if (filter === 'shared') return 'shared';
    return pin?.shared ? 'shared' : 'personal';
  }

  function firstVisibleMessageId() {
    const box = document.getElementById('messages');
    if (!box) return null;
    const boxRect = box.getBoundingClientRect();
    const messages = [...box.querySelectorAll('.bubble-wrap.msg[data-message-id],.bubble-wrap.msg[data-id]')];
    for (const message of messages) {
      const rect = message.getBoundingClientRect();
      if (rect.bottom >= boxRect.top + 4) return numericId(message.dataset.messageId || message.dataset.id);
    }
    const last = messages[messages.length - 1];
    return numericId(last?.dataset?.messageId || last?.dataset?.id);
  }

  function activePin(pins) {
    if (!pins.length) return null;
    const topId = firstVisibleMessageId();
    if (!topId) return pins[pins.length - 1];
    let selected = pins[0];
    for (const pin of pins) {
      if (pin.messageId <= topId) selected = pin;
      else break;
    }
    return selected;
  }

  function pinCycleSignature(pins) {
    return pins.map((pin) => String(pin.messageId)).join(',');
  }

  async function jumpToNextPinnedMessage(bar) {
    const id = roomId();
    const pins = pinsByRoom.get(id) || [];
    if (!id || !bar || !pins.length) return;

    const signature = pinCycleSignature(pins);
    let index = Number(bar.dataset.pinCycleNextIndex);
    const sameCycle = bar.dataset.pinCycleSignature === signature && Number.isInteger(index) && index >= 0 && index < pins.length;
    if (!sameCycle) index = pins.length - 1;

    const pin = pins[index];
    bar.dataset.pinCycleSignature = signature;
    bar.dataset.pinCycleNextIndex = String(index > 0 ? index - 1 : pins.length - 1);
    await jumpToMessage(pin.messageId);
  }

  function renderPinBar() {
    const id = roomId();
    const view = document.querySelector('.chat-view');
    const box = document.getElementById('messages');
    if (!id || !view || !box) {
      document.querySelector('.chat-pin-bar')?.remove();
      return;
    }
    const pins = pinsByRoom.get(id) || [];
    if (!pins.length) {
      view.querySelector('.chat-pin-bar')?.remove();
      return;
    }
    const pin = activePin(pins) || pins[0];
    let bar = view.querySelector(':scope > .chat-pin-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'chat-pin-bar';
      bar.innerHTML = '<button type="button" class="chat-pin-main"><span class="chat-pin-rail" aria-hidden="true"></span><span class="chat-pin-copy"><span class="chat-pin-title"></span><span class="chat-pin-preview"></span></span></button><button type="button" class="chat-pin-all" aria-label="Все закреплённые сообщения"><span class="chat-pin-stack" aria-hidden="true">▤</span><span class="chat-pin-count"></span></button>';
      view.insertBefore(bar, box);
      bar.querySelector('.chat-pin-main')?.addEventListener('click', () => {
        void jumpToNextPinnedMessage(bar);
      });
      bar.querySelector('.chat-pin-all')?.addEventListener('click', openPinsScreen);
    }
    const effective = displayScope(pin);
    bar.dataset.messageId = String(pin.messageId);
    const title = bar.querySelector('.chat-pin-title');
    const preview = bar.querySelector('.chat-pin-preview');
    const count = bar.querySelector('.chat-pin-count');
    const nextTitle = `Закреплённое сообщение · ${scopeLabel(effective)}`;
    if (title && title.textContent !== nextTitle) title.textContent = nextTitle;
    if (preview && preview.textContent !== pin.preview) preview.textContent = pin.preview;
    if (count && count.textContent !== String(pins.length)) count.textContent = String(pins.length);
    bar.classList.toggle('is-personal', effective === 'personal');
  }

  function bindPinScroll() {
    const box = document.getElementById('messages');
    if (!box || box.dataset.fpPinsScroll === '1') return;
    box.dataset.fpPinsScroll = '1';
    box.addEventListener('scroll', () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        renderPinBar();
      });
    }, { passive: true });
  }

  async function jumpToMessage(messageId) {
    closePinsScreen();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (typeof findAndFocusReplyMessage === 'function') {
      await findAndFocusReplyMessage(messageId);
      renderPinBar();
      return;
    }
    const target = document.querySelector(`.msg[data-message-id="${messageId}"]`);
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }

  function createPinAction() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'message-context-action fp-message-pin-action';
    button.dataset.fpMessageAction = ACTION;
    button.innerHTML = '<span class="message-context-action-icon" aria-hidden="true">📌</span><span>Закрепить</span>';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const root = button.closest(ROOT);
      const clone = root?.querySelector(COPY);
      const messageId = numericId(clone?.dataset?.messageId || clone?.dataset?.id);
      if (!messageId) return;
      closeContext(root);
      requestAnimationFrame(() => openPinDialog(messageId));
    });
    return button;
  }

  function refreshPinAction(root) {
    const clone = root?.querySelector(COPY);
    const button = root?.querySelector('[data-fp-message-action="pin"]');
    if (!clone || !button) return;
    const id = numericId(clone.dataset.messageId || clone.dataset.id);
    const pin = pinForMessage(roomId(), id);
    const label = button.querySelector('span:last-child');
    const next = pin ? 'Управление закрепом' : 'Закрепить';
    if (label && label.textContent !== next) label.textContent = next;
  }

  function decorateContext(root) {
    if (!(root instanceof Element)) return;
    const menu = root.querySelector(MENU);
    const clone = root.querySelector(COPY);
    const id = numericId(clone?.dataset?.messageId || clone?.dataset?.id);
    if (!menu || !clone || !id || clone.classList.contains('system-event-wrap')) return;
    let button = menu.querySelector('[data-fp-message-action="pin"]');
    if (!button) {
      button = createPinAction();
      const anchor = menu.querySelector('[data-fp-message-action="select"],[data-fp-message-action="delete"]');
      if (anchor) menu.insertBefore(button, anchor);
      else menu.appendChild(button);
    }
    refreshPinAction(root);
  }

  function refreshOpenContextPinAction() {
    document.querySelectorAll(ROOT).forEach(refreshPinAction);
  }

  function closePinDialog() {
    document.querySelector('.message-pin-overlay')?.remove();
  }

  function openPinDialog(messageId) {
    const id = roomId();
    if (!id || !numericId(messageId)) return;
    closePinDialog();
    const pin = pinForMessage(id, messageId);
    const overlay = document.createElement('div');
    overlay.className = 'message-pin-overlay';
    overlay.innerHTML = `<div class="message-pin-dialog" role="dialog" aria-modal="true"><div class="message-pin-title">Закрепить сообщение</div><div class="message-pin-text">Общий закреп видят оба участника. Личный закреп виден только вам.</div><div class="message-pin-actions"><button type="button" data-pin-scope="shared" data-pin-action="${pin?.shared ? 'remove' : 'add'}">${pin?.shared ? 'Открепить у всех' : 'Закрепить у всех'}</button><button type="button" data-pin-scope="personal" data-pin-action="${pin?.personal ? 'remove' : 'add'}">${pin?.personal ? 'Открепить у себя' : 'Закрепить у себя'}</button><button type="button" class="cancel" data-pin-cancel>Отмена</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closePinDialog(); });
    overlay.querySelector('[data-pin-cancel]')?.addEventListener('click', closePinDialog);
    overlay.querySelectorAll('[data-pin-scope]').forEach((button) => {
      button.addEventListener('click', async () => {
        overlay.querySelectorAll('button').forEach((item) => { item.disabled = true; });
        const scope = button.dataset.pinScope === 'personal' ? 'personal' : 'shared';
        const action = button.dataset.pinAction === 'remove' ? 'remove' : 'add';
        const ok = await mutatePin(id, messageId, scope, action);
        if (ok) closePinDialog();
        else overlay.querySelectorAll('button').forEach((item) => { item.disabled = false; });
      });
    });
  }

  async function mutatePin(id, messageId, scope, action) {
    const deviceId = roomDevice(id);
    if (!deviceId) return false;
    const remove = action === 'remove';
    const url = remove
      ? `/api/rooms/${encodeURIComponent(id)}/messages/${messageId}/pins/${scope}`
      : `/api/rooms/${encodeURIComponent(id)}/messages/${messageId}/pins`;
    try {
      const response = await fetch(url, {
        method: remove ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(remove ? { deviceId } : { deviceId, scope })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'pin failed');
      await setPins(id, data.pins || []);
      return true;
    } catch {
      alert('Не удалось изменить закреп. Проверьте соединение и попробуйте ещё раз.');
      return false;
    }
  }

  function closePinsScreen() {
    document.querySelector('.message-pins-screen')?.remove();
    screenState = null;
    document.body.classList.remove('message-pins-screen-open');
  }

  function openPinsScreen() {
    const id = roomId();
    if (!id) return;
    closePinsScreen();
    screenState = { roomId: id, filter: 'all', search: '', filterOpen: false };
    const screen = document.createElement('div');
    screen.className = 'message-pins-screen';
    screen.innerHTML = '<div class="message-pins-panel"><div class="message-pins-header"><button type="button" class="message-pins-close" aria-label="Закрыть">←</button><div class="message-pins-heading">Закреплено 0</div><button type="button" class="message-pins-filter" aria-label="Фильтр">Все ▾</button></div><div class="message-pins-filter-menu hidden"><button type="button" data-filter="all">Все</button><button type="button" data-filter="shared">Общие</button><button type="button" data-filter="personal">Личные</button></div><div class="message-pins-search-wrap"><input type="search" class="message-pins-search" placeholder="Поиск в закреплённых" autocomplete="off"></div><div class="message-pins-list"></div></div>';
    document.body.appendChild(screen);
    document.body.classList.add('message-pins-screen-open');
    screen.querySelector('.message-pins-close')?.addEventListener('click', closePinsScreen);
    screen.querySelector('.message-pins-filter')?.addEventListener('click', () => {
      if (!screenState) return;
      screenState.filterOpen = !screenState.filterOpen;
      screen.querySelector('.message-pins-filter-menu')?.classList.toggle('hidden', !screenState.filterOpen);
    });
    screen.querySelectorAll('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!screenState) return;
        screenState.filter = button.dataset.filter || 'all';
        screenState.filterOpen = false;
        renderPinsScreen();
      });
    });
    screen.querySelector('.message-pins-search')?.addEventListener('input', (event) => {
      if (!screenState) return;
      screenState.search = String(event.target.value || '').trim().toLocaleLowerCase('ru-RU');
      renderPinsScreen();
    });
    renderPinsScreen();
  }

  function filteredPins() {
    if (!screenState) return [];
    const pins = pinsByRoom.get(screenState.roomId) || [];
    return pins.filter((pin) => {
      if (screenState.filter === 'shared' && !pin.shared) return false;
      if (screenState.filter === 'personal' && !pin.personal) return false;
      if (screenState.search && !pin.searchText.includes(screenState.search)) return false;
      return true;
    });
  }

  function renderPinsScreen() {
    const screen = document.querySelector('.message-pins-screen');
    if (!screen || !screenState) return;
    const pins = filteredPins();
    const heading = screen.querySelector('.message-pins-heading');
    const filterButton = screen.querySelector('.message-pins-filter');
    const menu = screen.querySelector('.message-pins-filter-menu');
    const list = screen.querySelector('.message-pins-list');
    const labels = { all: 'Все', shared: 'Общие', personal: 'Личные' };
    const headingText = `Закреплено ${pins.length}`;
    if (heading && heading.textContent !== headingText) heading.textContent = headingText;
    if (filterButton) filterButton.textContent = `${labels[screenState.filter] || 'Все'} ▾`;
    menu?.classList.toggle('hidden', !screenState.filterOpen);
    screen.querySelectorAll('[data-filter]').forEach((button) => button.classList.toggle('active', button.dataset.filter === screenState.filter));
    if (!list) return;
    list.replaceChildren();
    if (!pins.length) {
      const empty = document.createElement('div');
      empty.className = 'message-pins-empty';
      empty.textContent = 'Нет закреплённых сообщений';
      list.appendChild(empty);
      return;
    }
    for (const pin of pins) {
      const scope = displayScope(pin, screenState.filter);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'message-pin-item';
      item.dataset.messageId = String(pin.messageId);
      const typeIcon = pin.message?.type === 'media' ? (pin.message.media?.[0]?.media_kind === 'video' ? '▶' : '▧') : '';
      item.innerHTML = `<span class="message-pin-item-side"></span><span class="message-pin-item-body"><span class="message-pin-item-top"><span class="message-pin-badge ${scope}">${scopeLabel(scope)}</span><span class="message-pin-author"></span><span class="message-pin-time"></span></span><span class="message-pin-item-preview"><span class="message-pin-type-icon">${typeIcon}</span><span class="message-pin-preview-text"></span></span></span>`;
      const author = item.querySelector('.message-pin-author');
      const time = item.querySelector('.message-pin-time');
      const preview = item.querySelector('.message-pin-preview-text');
      if (author) author.textContent = pin.message?.sender_name || 'Неизвестно';
      if (time) time.textContent = typeof formatMessageTime === 'function' ? formatMessageTime(pin.message?.created_at) : '';
      if (preview) preview.textContent = pin.preview;
      item.addEventListener('click', () => void jumpToMessage(pin.messageId));
      list.appendChild(item);
    }
  }

  function handleWsMessage(event) {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (!payload || typeof payload !== 'object') return;
    const id = String(payload.roomId || '');
    if (!id || id !== roomId()) return;
    if (payload.type === 'pins:changed' || payload.type === 'message:edited' || payload.type === 'message:deleted') void fetchPins(id);
  }

  function attachCurrentWs() {
    const ws = state?.ws;
    if (!ws || ws === attachedWs) return;
    if (attachedWs) {
      try { attachedWs.removeEventListener('message', handleWsMessage); } catch {}
    }
    attachedWs = ws;
    ws.addEventListener('message', handleWsMessage);
    ws.addEventListener('open', () => { const id = roomId(); if (id) void fetchPins(id); }, { once: true });
    if (ws.readyState === WebSocket.OPEN) { const id = roomId(); if (id) void fetchPins(id); }
  }

  function syncCurrentChat() {
    const id = roomId();
    if (!id || !document.querySelector('.chat-view')) return;
    bindPinScroll();
    void fetchPins(id);
  }

  const observer = new MutationObserver((records) => {
    let chatAdded = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(ROOT)) decorateContext(node);
        node.querySelectorAll?.(ROOT).forEach(decorateContext);
        const root = node.closest?.(ROOT);
        if (root) decorateContext(root);
        if (node.matches('.chat-view,#messages') || node.querySelector?.('.chat-view,#messages')) chatAdded = true;
      }
    }
    if (chatAdded) syncCurrentChat();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncCurrentChat();
  });
  window.addEventListener('online', syncCurrentChat);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && screenState) {
      event.preventDefault();
      closePinsScreen();
    }
  }, true);

  attachCurrentWs();
  setInterval(attachCurrentWs, 500);
  document.querySelectorAll(ROOT).forEach(decorateContext);
  syncCurrentChat();
})();