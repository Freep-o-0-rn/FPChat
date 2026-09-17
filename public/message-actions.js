/* Build 170: isolated edit/delete actions with event-driven connection attachment.
   Does not replace FPChat send/read/unread/scroll logic. */
(() => {
  const ROOT = '.message-context-root';
  const MENU = '.message-context-menu';
  const COPY = '.message-context-copy';
  const HIDDEN_KEY = (roomId, deviceId) => `fpchat:hidden-messages:${roomId}:${deviceId}`;
  const DELETED_KEY = (roomId) => `fpchat:deleted-messages:${roomId}`;
  const CURSOR_KEY = (roomId, deviceId) => `fpchat:message-mutation-cursor:${roomId}:${deviceId}`;

  const hiddenByRoom = new Map();
  const deletedByRoom = new Map();
  let editState = null;
  let attachedWs = null;
  let syncTimer = null;
  let syncAllInFlight = null;
  let lastSyncStartedAt = 0;

  function numericId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function roomDevice(roomId = state?.roomId) {
    if (!roomId) return '';
    try {
      return String(STORAGE.get(STORAGE.roomState(roomId))?.deviceId || '').trim();
    } catch {
      return '';
    }
  }

  function loadIdSet(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      return new Set(Array.isArray(raw) ? raw.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : []);
    } catch {
      return new Set();
    }
  }

  function saveIdSet(key, set) {
    try { localStorage.setItem(key, JSON.stringify([...set].sort((a, b) => a - b))); } catch {}
  }

  function hiddenSet(roomId, deviceId = roomDevice(roomId)) {
    const key = `${roomId}:${deviceId}`;
    if (!hiddenByRoom.has(key)) hiddenByRoom.set(key, loadIdSet(HIDDEN_KEY(roomId, deviceId)));
    return hiddenByRoom.get(key);
  }

  function deletedSet(roomId) {
    if (!deletedByRoom.has(roomId)) deletedByRoom.set(roomId, loadIdSet(DELETED_KEY(roomId)));
    return deletedByRoom.get(roomId);
  }

  function mutationCursor(roomId, deviceId) {
    const value = Number(localStorage.getItem(CURSOR_KEY(roomId, deviceId)) || 0);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function saveMutationCursor(roomId, deviceId, cursor) {
    const value = Number(cursor);
    if (!Number.isSafeInteger(value) || value < 0) return;
    try { localStorage.setItem(CURSOR_KEY(roomId, deviceId), String(value)); } catch {}
  }

  function closeContext() {
    const root = document.querySelector(ROOT);
    const backdrop = root?.querySelector('.message-context-backdrop');
    if (backdrop) { backdrop.click(); return; }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  function contextInfo(root) {
    const clone = root?.querySelector(COPY);
    const menu = root?.querySelector(MENU);
    const messageId = numericId(clone?.dataset?.messageId || clone?.dataset?.id);
    if (!clone || !menu || !messageId) return null;
    const mine = clone.classList.contains('mine');
    const isMedia = Boolean(clone.querySelector('.media-grid'));
    const hasText = Boolean(clone.querySelector('.message-text'));
    return { root, clone, menu, messageId, mine, isText: hasText && !isMedia };
  }

  function actionButton(icon, label, name, handler, danger = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `message-context-action fp-message-action${danger ? ' fp-message-action-danger' : ''}`;
    button.dataset.fpMessageAction = name;
    button.innerHTML = `<span class="message-context-action-icon" aria-hidden="true">${icon}</span><span>${label}</span>`;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handler();
    });
    return button;
  }

  function decorateContext(root) {
    const info = contextInfo(root);
    if (!info) return;
    const { menu } = info;

    let edit = menu.querySelector('[data-fp-message-action="edit"]');
    if (info.mine && info.isText) {
      if (!edit) {
        edit = actionButton('✎', 'Редактировать', 'edit', () => beginEdit(info.messageId));
        const copy = [...menu.querySelectorAll('.message-context-action')].find((button) => /Копировать/i.test(button.textContent || ''));
        if (copy?.nextSibling) menu.insertBefore(edit, copy.nextSibling);
        else if (copy) copy.after(edit);
        else menu.prepend(edit);
      }
    } else {
      edit?.remove();
    }

    let remove = menu.querySelector('[data-fp-message-action="delete"]');
    if (!remove) {
      remove = actionButton('⌫', 'Удалить', 'delete', () => openDeleteDialog(info.messageId, info.mine), true);
      menu.appendChild(remove);
    } else if (remove !== menu.lastElementChild) {
      menu.appendChild(remove);
    }
  }

  function tombstoneCache(messageId, author = '') {
    if (typeof messageCache === 'undefined') return;
    const previous = messageCache.get(Number(messageId));
    messageCache.set(Number(messageId), {
      id: Number(messageId),
      author: previous?.author || author || 'Неизвестно',
      text: '',
      preview: 'Сообщение удалено',
      kind: 'deleted',
      deleted: true
    });
  }

  function markReplyBlocksDeleted(messageId) {
    document.querySelectorAll(`.reply-block[data-reply-message-id="${messageId}"]`).forEach((block) => {
      const preview = block.querySelector('.reply-block-preview');
      if (preview) preview.textContent = 'Сообщение удалено';
    });
  }

  function applyEditedLabel(el, editedAt = null) {
    if (!el) return;
    if (editedAt) el.dataset.editedAt = String(editedAt);
    if (!el.dataset.editedAt) return;
    const meta = el.querySelector('.meta');
    if (!meta || meta.querySelector('.message-edited-label')) return;
    const label = document.createElement('span');
    label.className = 'message-edited-label';
    label.textContent = 'изменено';
    meta.insertBefore(label, meta.firstChild);
  }

  function keepViewportWhileRemoving(box, el) {
    if (!box || !el) return;
    const wasAtBottom = typeof isMessagesAtBottom === 'function' ? isMessagesAtBottom(box) : false;
    const beforeHeight = box.scrollHeight;
    const beforeTop = box.scrollTop;
    const boxRect = box.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const wasAbove = elRect.bottom <= boxRect.top + 1;

    try { unreadVisibleObserver?.unobserve?.(el); } catch {}
    el.remove();
    if (typeof rebuildDateSeparators === 'function') rebuildDateSeparators(box);

    if (wasAtBottom) {
      if (typeof scrollCoordinator !== 'undefined') scrollCoordinator.requestBottom(box);
      else box.scrollTop = box.scrollHeight;
    } else if (wasAbove) {
      const removedHeight = Math.max(0, beforeHeight - box.scrollHeight);
      box.scrollTop = Math.max(0, beforeTop - removedHeight);
    }
  }

  function clearReplyDraftIfNeeded(roomId, messageId) {
    const draft = state?.drafts?.[roomId];
    if (!draft?.replyTo || Number(draft.replyTo.messageId) !== Number(messageId)) return;
    draft.replyTo = null;
    try { updateReplyComposerBar(); } catch {}
  }

  function applyDeletion(roomId, messageId, scope, { refreshPreview = true, author = '' } = {}) {
    const id = numericId(messageId);
    if (!roomId || !id) return;
    const deviceId = roomDevice(roomId);
    if (scope === 'self' && deviceId) {
      const set = hiddenSet(roomId, deviceId);
      set.add(id);
      saveIdSet(HIDDEN_KEY(roomId, deviceId), set);
    }
    if (scope === 'all') {
      const set = deletedSet(roomId);
      set.add(id);
      saveIdSet(DELETED_KEY(roomId), set);
    }

    if (editState?.roomId === roomId && editState.messageId === id) cancelEdit(true);
    tombstoneCache(id, author);
    markReplyBlocksDeleted(id);
    clearReplyDraftIfNeeded(roomId, id);

    if (String(state?.roomId || '') === String(roomId)) {
      const el = typeof findMessageElement === 'function' ? findMessageElement(id) : document.querySelector(`.bubble-wrap.msg[data-message-id="${id}"]`);
      const box = document.getElementById('messages');
      if (el && box?.contains(el)) keepViewportWhileRemoving(box, el);
      try {
        recomputePendingUnread();
        updateUnreadIndicators();
        updateReplyComposerBar();
      } catch {}
      const contextClone = document.querySelector(`${ROOT} ${COPY}[data-message-id="${id}"], ${ROOT} ${COPY}[data-id="${id}"]`);
      if (contextClone) closeContext();
    }

    if (refreshPreview) void refreshChatPreview(roomId, deviceId);
  }

  async function applyEdit(roomId, message, { refreshPreview = true } = {}) {
    if (!roomId || !message?.id) return;
    const id = numericId(message.id);
    if (!id) return;
    const deviceId = roomDevice(roomId);
    if (deviceId && hiddenSet(roomId, deviceId).has(id)) return;
    if (deletedSet(roomId).has(id) || message.deleted_for_all) return;

    let text;
    try {
      text = await decryptRoomText(roomId, message);
    } catch {
      return;
    }
    const preview = typeof makeReplyPreview === 'function' ? makeReplyPreview(text) : text.slice(0, 120);
    if (typeof messageCache !== 'undefined') {
      const previous = messageCache.get(id);
      messageCache.set(id, {
        id,
        author: message.sender_name || previous?.author || 'Неизвестно',
        text,
        preview,
        kind: 'text'
      });
    }

    if (String(state?.roomId || '') === String(roomId)) {
      const el = typeof findMessageElement === 'function' ? findMessageElement(id, message.client_message_id) : null;
      if (el) {
        const textEl = el.querySelector('.message-text');
        if (textEl) textEl.textContent = text;
        applyEditedLabel(el, message.edited_at || new Date().toISOString());
        try { refreshReplyBlocks(document.getElementById('messages')); } catch {}
      }
    }
    if (refreshPreview) void refreshChatPreview(roomId, deviceId);
  }

  async function refreshChatPreview(roomId, deviceId = roomDevice(roomId)) {
    if (!roomId || !deviceId) return;
    try {
      const query = new URLSearchParams({ deviceId });
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/message-actions/latest?${query}`, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      const message = data?.message || null;
      if (!message) {
        upsertChat(roomId, { lastMessage: '', lastSender: '' });
        return;
      }
      let text = '';
      if (message.type === 'system') {
        const actor = message.event_actor_name || message.sender_name || 'Участник';
        text = message.event_type === 'participant_joined' ? `${actor} присоединился к комнате` : message.event_type === 'participant_left' ? `${actor} покинул комнату` : 'Системное событие';
      } else {
        let plain = '';
        try { plain = await decryptRoomText(roomId, message); } catch {}
        if (message.type === 'media') {
          const media = Array.isArray(message.media) ? message.media : [];
          text = plain.trim() || (media.length > 1 ? 'Альбом' : media[0]?.media_kind === 'video' ? 'Видео' : 'Фото');
        } else {
          text = plain;
        }
      }
      upsertChat(roomId, {
        lastMessage: text,
        lastSender: message.sender_name || '',
        lastActivity: message.created_at || undefined
      });
    } catch {}
  }

  function installAppendWrapper() {
    if (typeof appendMessage !== 'function' || appendMessage.__fp108) return;
    const base = appendMessage;
    const wrapped = function fp108AppendMessage(box, message, text, mine, autoScroll = true) {
      const roomId = String(state?.roomId || '');
      const id = numericId(message?.id);
      const deviceId = roomDevice(roomId);
      if (id && roomId && ((deviceId && hiddenSet(roomId, deviceId).has(id)) || deletedSet(roomId).has(id) || message?.deleted_for_all)) {
        tombstoneCache(id, message?.sender_name || '');
        return;
      }
      const result = base.apply(this, arguments);
      if (id) {
        const el = typeof findMessageElement === 'function' ? findMessageElement(id, message?.client_message_id) : null;
        if (el && message?.edited_at) applyEditedLabel(el, message.edited_at);
        const replyId = numericId(message?.reply_to_message_id);
        if (el && replyId && ((deviceId && hiddenSet(roomId, deviceId).has(replyId)) || deletedSet(roomId).has(replyId))) {
          const preview = el.querySelector('.reply-block-preview');
          if (preview) preview.textContent = 'Сообщение удалено';
        }
      }
      return result;
    };
    wrapped.__fp108 = true;
    appendMessage = wrapped;
  }

  function installStatusWrapper() {
    if (typeof updateMessageStatusElement !== 'function' || updateMessageStatusElement.__fp108) return;
    const base = updateMessageStatusElement;
    const wrapped = function fp108UpdateMessageStatusElement(el, status) {
      const result = base.apply(this, arguments);
      applyEditedLabel(el);
      return result;
    };
    wrapped.__fp108 = true;
    updateMessageStatusElement = wrapped;
  }

  function editBar() {
    return document.getElementById('editComposerBar');
  }

  function renderEditBar() {
    const form = document.getElementById('sendForm');
    const view = form?.closest('.chat-view');
    if (!form || !view || !editState) return;
    view.classList.add('fp-editing-message');
    let bar = editBar();
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'editComposerBar';
      bar.className = 'edit-composer-bar';
      bar.innerHTML = '<div class="edit-composer-accent"></div><div class="edit-composer-content"><div class="edit-composer-title">Редактирование сообщения</div><div class="edit-composer-preview"></div></div><button type="button" class="edit-composer-close" aria-label="Отменить редактирование">×</button>';
      form.parentNode.insertBefore(bar, form);
      bar.querySelector('.edit-composer-close')?.addEventListener('click', () => cancelEdit(true));
    }
    const preview = bar.querySelector('.edit-composer-preview');
    if (preview) preview.textContent = editState.originalText;
  }

  function restoreComposer(snapshot, focus = false) {
    const input = document.getElementById('msgInput');
    const view = input?.closest('.chat-view');
    view?.classList.remove('fp-editing-message');
    editBar()?.remove();
    if (!input || !snapshot) return;
    input.value = snapshot.text || '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    try { autoResizeMessageInput(input); } catch {}
    if (focus) input.focus({ preventScroll: true });
  }

  function cancelEdit(restoreDraft = true) {
    if (!editState) return;
    const snapshot = editState.snapshot;
    editState = null;
    if (restoreDraft) restoreComposer(snapshot, false);
    else {
      document.querySelector('.chat-view')?.classList.remove('fp-editing-message');
      editBar()?.remove();
    }
  }

  function beginEdit(messageId) {
    const id = numericId(messageId);
    const roomId = String(state?.roomId || '');
    if (!id || !roomId) return;
    const el = typeof findMessageElement === 'function' ? findMessageElement(id) : null;
    if (!el?.classList.contains('mine') || el.querySelector('.media-grid')) return;
    const cached = messageCache?.get?.(id);
    const originalText = String(cached?.text ?? el.querySelector('.message-text')?.textContent ?? '').trim();
    if (!originalText) return;
    const input = document.getElementById('msgInput');
    if (!input) return;

    if (editState) cancelEdit(true);
    const draft = state?.drafts?.[roomId];
    editState = {
      roomId,
      messageId: id,
      originalText,
      snapshot: { text: input.value, replyTo: draft?.replyTo || null }
    };
    closeContext();
    input.value = originalText;
    try { autoResizeMessageInput(input); } catch {}
    const send = document.getElementById('sendBtn');
    if (send) send.disabled = !originalText.trim();
    renderEditBar();
    requestAnimationFrame(() => {
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  async function commitEdit() {
    if (!editState) return;
    const current = editState;
    const input = document.getElementById('msgInput');
    const send = document.getElementById('sendBtn');
    if (!input || String(state?.roomId || '') !== current.roomId) {
      cancelEdit(false);
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    if (text === current.originalText) {
      cancelEdit(true);
      return;
    }
    const deviceId = roomDevice(current.roomId);
    if (!deviceId) return;
    if (send) send.disabled = true;
    try {
      const encrypted = await encryptText(text);
      const response = await fetch(`/api/rooms/${encodeURIComponent(current.roomId)}/messages/${current.messageId}/edit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, ciphertext: encrypted.ciphertext, iv: encrypted.iv })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'edit failed');
      if (data.mutationId) saveMutationCursor(current.roomId, deviceId, Math.max(mutationCursor(current.roomId, deviceId), Number(data.mutationId)));
      if (data.message) await applyEdit(current.roomId, data.message);
      if (editState === current) cancelEdit(true);
    } catch {
      if (send) send.disabled = !input.value.trim();
      alert('Не удалось изменить сообщение. Проверьте соединение и попробуйте ещё раз.');
    }
  }

  function closeDeleteDialog() {
    document.querySelector('.message-delete-overlay')?.remove();
  }

  function openDeleteDialog(messageId, mine) {
    const id = numericId(messageId);
    const roomId = String(state?.roomId || '');
    if (!id || !roomId) return;
    closeContext();
    closeDeleteDialog();
    const overlay = document.createElement('div');
    overlay.className = 'message-delete-overlay';
    overlay.innerHTML = `<div class="message-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="messageDeleteTitle"><div class="message-delete-title" id="messageDeleteTitle">Удалить сообщение?</div><div class="message-delete-text">${mine ? 'Выберите, где удалить это сообщение.' : 'Сообщение будет удалено только у вас.'}</div><div class="message-delete-actions"><button type="button" data-delete-scope="self">Удалить у меня</button>${mine ? '<button type="button" class="danger" data-delete-scope="all">Удалить у всех</button>' : ''}<button type="button" class="cancel" data-delete-cancel>Отмена</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeDeleteDialog(); });
    overlay.querySelector('[data-delete-cancel]')?.addEventListener('click', closeDeleteDialog);
    overlay.querySelectorAll('[data-delete-scope]').forEach((button) => {
      button.addEventListener('click', async () => {
        const scope = button.dataset.deleteScope === 'all' ? 'all' : 'self';
        overlay.querySelectorAll('button').forEach((item) => { item.disabled = true; });
        await deleteMessage(roomId, id, scope, overlay);
      });
    });
  }

  async function deleteMessage(roomId, messageId, scope, overlay) {
    const deviceId = roomDevice(roomId);
    if (!deviceId) return;
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages/${messageId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, scope })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'delete failed');
      const actualScope = data.scope === 'all' ? 'all' : scope;
      if (data.mutationId) saveMutationCursor(roomId, deviceId, Math.max(mutationCursor(roomId, deviceId), Number(data.mutationId)));
      applyDeletion(roomId, messageId, actualScope);
      overlay?.remove();
    } catch {
      overlay?.querySelectorAll('button').forEach((item) => { item.disabled = false; });
      alert('Не удалось удалить сообщение. Проверьте соединение и попробуйте ещё раз.');
    }
  }

  async function fetchActionState(roomId, deviceId) {
    const query = new URLSearchParams({ deviceId });
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/message-actions/state?${query}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  function applyStateSnapshot(roomId, deviceId, data) {
    if (!data?.ok) return;
    const hidden = new Set((data.hiddenMessageIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0));
    const deleted = new Set((data.deletedForAllMessageIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0));
    hiddenByRoom.set(`${roomId}:${deviceId}`, hidden);
    deletedByRoom.set(roomId, deleted);
    saveIdSet(HIDDEN_KEY(roomId, deviceId), hidden);
    saveIdSet(DELETED_KEY(roomId), deleted);

    if (String(state?.roomId || '') === String(roomId)) {
      const box = document.getElementById('messages');
      if (box) {
        [...box.querySelectorAll('.bubble-wrap.msg')].forEach((el) => {
          const id = numericId(el.dataset.messageId || el.dataset.id);
          if (id && (hidden.has(id) || deleted.has(id))) {
            tombstoneCache(id, el.querySelector('b')?.textContent || '');
            keepViewportWhileRemoving(box, el);
          }
        });
        box.querySelectorAll('.reply-block[data-reply-message-id]').forEach((block) => {
          const id = numericId(block.dataset.replyMessageId);
          if (id && (hidden.has(id) || deleted.has(id))) {
            const preview = block.querySelector('.reply-block-preview');
            if (preview) preview.textContent = 'Сообщение удалено';
          }
        });
      }
    }
  }

  async function syncMutations(roomId, deviceId) {
    let cursor = mutationCursor(roomId, deviceId);
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ deviceId, after: String(cursor), limit: '200' });
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/message-actions/mutations?${query}`, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      if (!data?.ok) return;
      for (const mutation of data.mutations || []) {
        const id = numericId(mutation.messageId);
        if (!id) continue;
        if (mutation.kind === 'edited' && mutation.message) await applyEdit(roomId, mutation.message, { refreshPreview: false });
        if (mutation.kind === 'deleted_self') applyDeletion(roomId, id, 'self', { refreshPreview: false });
        if (mutation.kind === 'deleted_all') applyDeletion(roomId, id, 'all', { refreshPreview: false });
        cursor = Math.max(cursor, Number(mutation.id) || 0);
      }
      cursor = Math.max(cursor, Number(data.nextCursor) || cursor);
      saveMutationCursor(roomId, deviceId, cursor);
      if (!data.hasMore) break;
    }
  }

  async function syncRoom(roomId, deviceId = roomDevice(roomId)) {
    if (!roomId || !deviceId) return;
    try {
      const snapshot = await fetchActionState(roomId, deviceId);
      if (snapshot) applyStateSnapshot(roomId, deviceId, snapshot);
      if (String(state?.roomId || '') === String(roomId)) {
        try { rebuildDateSeparators(document.getElementById('messages')); } catch {}
      }
      await syncMutations(roomId, deviceId);
      await refreshChatPreview(roomId, deviceId);
      if (String(state?.roomId || '') === String(roomId)) {
        try {
          recomputePendingUnread();
          updateUnreadIndicators();
          updateReplyComposerBar();
        } catch {}
      }
    } catch {}
  }

  async function syncAllRooms({ force = false } = {}) {
    if (syncAllInFlight) return syncAllInFlight;
    const now = Date.now();
    if (!force && now - lastSyncStartedAt < 1500) return false;
    lastSyncStartedAt = now;
    syncAllInFlight = (async () => {
      const activeRoomId = String(state?.roomId || '');
      const rooms = [...new Set((state?.chats || []).map((chat) => String(chat?.roomId || '')).filter(Boolean))];
      rooms.sort((a, b) => (a === activeRoomId ? -1 : b === activeRoomId ? 1 : 0));
      for (const roomId of rooms) {
        const deviceId = roomDevice(roomId);
        if (deviceId) await syncRoom(roomId, deviceId);
      }
      return true;
    })().finally(() => { syncAllInFlight = null; });
    return syncAllInFlight;
  }

  function handleWsMessage(event) {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (!payload || !payload.roomId) return;
    const roomId = String(payload.roomId);
    const deviceId = roomDevice(roomId);
    if (payload.mutationId && deviceId) {
      saveMutationCursor(roomId, deviceId, Math.max(mutationCursor(roomId, deviceId), Number(payload.mutationId) || 0));
    }
    if (payload.type === 'message:edited' && payload.message) void applyEdit(roomId, payload.message);
    if (payload.type === 'message:deleted') applyDeletion(roomId, payload.messageId, payload.scope === 'all' ? 'all' : 'self');
  }

  function attachCurrentWs() {
    const ws = state?.ws || null;
    if (ws === attachedWs) return;
    if (attachedWs) {
      try { attachedWs.removeEventListener('message', handleWsMessage); } catch {}
    }
    attachedWs = ws;
    if (!ws) return;
    ws.addEventListener('message', handleWsMessage);
    ws.addEventListener('open', () => { void syncAllRooms(); }, { once: true });
    if (ws.readyState === WebSocket.OPEN) void syncAllRooms();
  }

  function handleLifecycle170(event) {
    const type = String(event?.detail?.lastType || '');
    if (type === 'foreground' || type === 'pageshow' || type === 'online') void syncAllRooms();
  }

  function handleRoomReady170(event) {
    if (event?.detail?.stage !== 'ready') return;
    const roomId = String(event.detail.roomId || state?.roomId || '');
    const deviceId = roomDevice(roomId);
    if (roomId && deviceId) void syncRoom(roomId, deviceId);
  }

  document.addEventListener('input', (event) => {
    if (!editState || event.target?.id !== 'msgInput') return;
    event.stopImmediatePropagation();
    const input = event.target;
    const send = document.getElementById('sendBtn');
    if (send) send.disabled = !input.value.trim();
    try { autoResizeMessageInput(input); } catch {}
  }, true);

  document.addEventListener('submit', (event) => {
    if (!editState || event.target?.id !== 'sendForm') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void commitEdit();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!editState || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelEdit(true);
  }, true);

  installAppendWrapper();
  installStatusWrapper();

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(ROOT)) decorateContext(node);
        node.querySelectorAll?.(ROOT).forEach(decorateContext);
        const root = node.closest?.(ROOT);
        if (root) decorateContext(root);
        if (node.id === 'messages' || node.querySelector?.('#messages')) {
          const roomId = String(state?.roomId || '');
          const deviceId = roomDevice(roomId);
          if (roomId && deviceId) void syncRoom(roomId, deviceId);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll(ROOT).forEach(decorateContext);

  window.addEventListener('fpchat:connection170', attachCurrentWs, { passive: true });
  window.addEventListener('fpchat:lifecycle170', handleLifecycle170, { passive: true });
  window.addEventListener('fpchat:room-open170', handleRoomReady170, { passive: true });

  attachCurrentWs();
  syncTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void syncAllRooms();
  }, 30000);
  void syncAllRooms({ force: true });
})();
