/* Build 111: stable isolated multiple-message selection layer.
   Uses the existing Build 108 delete API; does not replace message transport,
   unread/read, lazy history, scroll coordinator or swipe/reply logic. */
(() => {
  const ROOT = '.message-context-root';
  const MENU = '.message-context-menu';
  const COPY = '.message-context-copy';
  const MESSAGE = '#messages .bubble-wrap.msg:not(.system-event-wrap)';
  const MESSAGE_LOCAL = '.bubble-wrap.msg:not(.system-event-wrap)';
  const MODE_CLASS = 'fp-message-selection-open';
  const VIEW_CLASS = 'fp-selection-mode';
  const EDGE_BACK_PX = 32;
  const EDGE_BACK_TRIGGER_PX = 78;
  const MOVE_CANCEL_PX = 12;

  let selection = null;
  let touchGesture = null;
  let suppressClickUntil = 0;

  function numericId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function currentRoomId() {
    try { return String(typeof state !== 'undefined' ? state?.roomId || '' : ''); } catch { return ''; }
  }

  function currentDeviceId(roomId = currentRoomId()) {
    if (!roomId || typeof STORAGE === 'undefined') return '';
    try { return String(STORAGE.get(STORAGE.roomState(roomId))?.deviceId || '').trim(); } catch { return ''; }
  }

  function messageId(el) {
    return numericId(el?.dataset?.messageId || el?.dataset?.id);
  }

  function messageElement(id) {
    if (!id) return null;
    return [...document.querySelectorAll(MESSAGE)].find((el) => messageId(el) === Number(id)) || null;
  }

  function isSelectableMessage(el) {
    return Boolean(
      el?.matches?.(MESSAGE_LOCAL) &&
      document.getElementById('messages')?.contains(el) &&
      messageId(el)
    );
  }

  function closeContext(root = document.querySelector(ROOT)) {
    const backdrop = root?.querySelector('.message-context-backdrop');
    if (backdrop) {
      backdrop.click();
      return;
    }
    root?.remove();
    document.body.classList.remove('message-context-open');
  }

  function createActionButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'message-context-action fp-message-select-action';
    button.dataset.fpMessageAction = 'select';
    button.innerHTML = '<span class="message-context-action-icon" aria-hidden="true">✓</span><span>Выбрать</span>';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const root = button.closest(ROOT);
      const clone = root?.querySelector(COPY);
      const id = messageId(clone);
      if (!id || !clone || clone.classList.contains('system-event-wrap')) return;
      const mine = clone.classList.contains('mine');
      closeContext(root);
      requestAnimationFrame(() => startSelection(id, mine));
    });
    return button;
  }

  function decorateContext(root) {
    if (!(root instanceof Element) || selection) return;
    const menu = root.querySelector(MENU);
    const clone = root.querySelector(COPY);
    if (!menu || !clone || !messageId(clone) || clone.classList.contains('system-event-wrap')) return;

    let select = menu.querySelector('[data-fp-message-action="select"]');
    if (!select) {
      select = createActionButton();
      menu.appendChild(select);
    }

    const remove = menu.querySelector('[data-fp-message-action="delete"]');
    if (remove && select.nextElementSibling !== remove) menu.insertBefore(select, remove);
  }

  function syncMessageVisual(el) {
    if (!selection || !isSelectableMessage(el)) return;
    const id = messageId(el);
    const selected = Boolean(id && selection.ids.has(id));
    el.classList.toggle('message-selection-selected', selected);
    el.querySelector(':scope > .message-selection-check')?.classList.toggle('selected', selected);
  }

  function ensureCheck(el) {
    if (!isSelectableMessage(el)) return;
    let check = el.querySelector(':scope > .message-selection-check');
    if (!check) {
      check = document.createElement('span');
      check.className = 'message-selection-check';
      check.setAttribute('aria-hidden', 'true');
      check.innerHTML = '<span class="message-selection-check-mark">✓</span>';
      el.appendChild(check);
    }
    syncMessageVisual(el);
  }

  function decorateMessages(root = document) {
    if (!selection) return;
    if (root instanceof Element && isSelectableMessage(root)) ensureCheck(root);
    root.querySelectorAll?.(MESSAGE_LOCAL).forEach((el) => { if (isSelectableMessage(el)) ensureCheck(el); });
  }

  function selectionCountLabel(count) {
    return `Выбрано ${count}`;
  }

  function ensureTopBar() {
    if (!selection) return null;
    const header = document.querySelector('.chat-view .chat-header');
    if (!header) return null;
    let bar = header.querySelector(':scope > .message-selection-topbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'message-selection-topbar';
      bar.innerHTML = '<button type="button" class="message-selection-close" aria-label="Отменить выбор">×</button><div class="message-selection-count">Выбрано 0</div><button type="button" class="message-selection-cancel">Отмена</button>';
      header.appendChild(bar);
      bar.querySelector('.message-selection-close')?.addEventListener('click', exitSelection);
      bar.querySelector('.message-selection-cancel')?.addEventListener('click', exitSelection);
    }
    return bar;
  }

  function ensureBottomBar() {
    if (!selection) return null;
    const form = document.getElementById('sendForm');
    const host = form?.parentElement;
    if (!form || !host) return null;
    let bar = host.querySelector(':scope > .message-selection-bottombar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'message-selection-bottombar';
      bar.innerHTML = '<button type="button" class="message-selection-delete" aria-label="Удалить выбранные сообщения"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 12H8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"/></svg><span>Удалить</span></button>';
      host.insertBefore(bar, form);
      bar.querySelector('.message-selection-delete')?.addEventListener('click', openBulkDeleteDialog);
    }
    return bar;
  }

  function updateBars() {
    if (!selection) return;
    const count = selection.ids.size;
    const top = ensureTopBar();
    const bottom = ensureBottomBar();
    const countEl = top?.querySelector('.message-selection-count');
    const label = selectionCountLabel(count);
    if (countEl && countEl.textContent !== label) countEl.textContent = label;
    const deleteButton = bottom?.querySelector('.message-selection-delete');
    const disabled = count === 0 || selection.busy;
    if (deleteButton && deleteButton.disabled !== disabled) deleteButton.disabled = disabled;
  }

  function updateAllVisuals() {
    if (!selection) return;
    decorateMessages(document);
    document.querySelectorAll(MESSAGE).forEach(syncMessageVisual);
    updateBars();
  }

  function startSelection(id, mine) {
    const roomId = currentRoomId();
    const numeric = numericId(id);
    const original = messageElement(numeric);
    if (!roomId || !numeric || !original) return;
    if (selection) exitSelection();

    selection = {
      roomId,
      ids: new Set([numeric]),
      mineById: new Map([[numeric, Boolean(mine)]]),
      busy: false
    };

    document.body.classList.add(MODE_CLASS);
    document.querySelector('.chat-view')?.classList.add(VIEW_CLASS);
    updateAllVisuals();
  }

  function closeBulkDeleteDialog() {
    document.querySelector('.message-selection-delete-overlay')?.remove();
  }

  function removeSelectionUi() {
    document.body.classList.remove(MODE_CLASS);
    document.querySelector('.chat-view')?.classList.remove(VIEW_CLASS);
    document.querySelectorAll('.message-selection-topbar,.message-selection-bottombar').forEach((el) => el.remove());
    document.querySelectorAll('.message-selection-check').forEach((el) => el.remove());
    document.querySelectorAll('.message-selection-selected').forEach((el) => el.classList.remove('message-selection-selected'));
    closeBulkDeleteDialog();
  }

  function exitSelection() {
    if (!selection) return;
    selection = null;
    touchGesture = null;
    removeSelectionUi();
  }

  function toggleMessage(el) {
    if (!selection || !isSelectableMessage(el) || selection.busy) return;
    const id = messageId(el);
    if (!id) return;
    if (selection.ids.has(id)) {
      selection.ids.delete(id);
      selection.mineById.delete(id);
    } else {
      selection.ids.add(id);
      selection.mineById.set(id, el.classList.contains('mine'));
    }
    syncMessageVisual(el);
    updateBars();
    navigator.vibrate?.(7);
  }

  function russianMessages(count) {
    const n10 = count % 10;
    const n100 = count % 100;
    if (n10 === 1 && n100 !== 11) return 'сообщение';
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'сообщения';
    return 'сообщений';
  }

  function openBulkDeleteDialog() {
    if (!selection || selection.busy || selection.ids.size === 0) return;
    closeBulkDeleteDialog();
    const ids = [...selection.ids];
    const allMine = ids.every((id) => selection.mineById.get(id) === true);
    const count = ids.length;
    const overlay = document.createElement('div');
    overlay.className = 'message-delete-overlay message-selection-delete-overlay';
    overlay.innerHTML = `<div class="message-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="messageSelectionDeleteTitle"><div class="message-delete-title" id="messageSelectionDeleteTitle">Удалить ${count} ${russianMessages(count)}?</div><div class="message-delete-text">${allMine ? 'Выберите, где удалить выбранные сообщения.' : 'Среди выбранных есть чужие сообщения, поэтому удалить их можно только у себя.'}</div><div class="message-delete-actions"><button type="button" data-selection-delete-scope="self">Удалить у меня</button>${allMine ? '<button type="button" class="danger" data-selection-delete-scope="all">Удалить у всех</button>' : ''}<button type="button" class="cancel" data-selection-delete-cancel>Отмена</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay && !selection?.busy) closeBulkDeleteDialog();
    });
    overlay.querySelector('[data-selection-delete-cancel]')?.addEventListener('click', () => {
      if (!selection?.busy) closeBulkDeleteDialog();
    });
    overlay.querySelectorAll('[data-selection-delete-scope]').forEach((button) => {
      button.addEventListener('click', () => {
        const scope = button.dataset.selectionDeleteScope === 'all' ? 'all' : 'self';
        void performBulkDelete(scope, overlay);
      });
    });
  }

  async function deleteOne(roomId, deviceId, id, scope) {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, scope })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'delete failed');
    return data;
  }

  async function performBulkDelete(scope, overlay) {
    if (!selection || selection.busy) return;
    const current = selection;
    const roomId = current.roomId;
    const deviceId = currentDeviceId(roomId);
    if (!deviceId) return;
    const ids = [...current.ids];
    if (!ids.length) return;
    if (scope === 'all' && !ids.every((id) => current.mineById.get(id) === true)) return;

    current.busy = true;
    overlay?.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    updateBars();
    const failed = [];

    for (const id of ids) {
      try {
        await deleteOne(roomId, deviceId, id, scope);
        if (selection === current) {
          current.ids.delete(id);
          current.mineById.delete(id);
        }
      } catch {
        failed.push(id);
      }
    }

    if (selection !== current) return;
    current.busy = false;
    closeBulkDeleteDialog();

    if (!failed.length) {
      exitSelection();
      return;
    }

    updateAllVisuals();
    alert(`Не удалось удалить ${failed.length} ${russianMessages(failed.length)}. Проверьте соединение и попробуйте ещё раз.`);
  }

  function handleSelectionTouchStart(event) {
    if (!selection || event.touches?.length !== 1) return;
    const messages = document.getElementById('messages');
    if (!messages?.contains(event.target)) return;
    const touch = event.touches[0];
    const message = event.target?.closest?.(MESSAGE_LOCAL);
    touchGesture = {
      message: isSelectableMessage(message) ? message : null,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      moved: false,
      edgeBack: touch.clientX <= EDGE_BACK_PX
    };
    event.stopImmediatePropagation();
  }

  function handleSelectionTouchMove(event) {
    if (!selection || !touchGesture || event.touches?.length !== 1) return;
    const touch = event.touches[0];
    touchGesture.lastX = touch.clientX;
    touchGesture.lastY = touch.clientY;
    const dx = touch.clientX - touchGesture.startX;
    const dy = touch.clientY - touchGesture.startY;
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) touchGesture.moved = true;
    if (touchGesture.edgeBack && dx > 10 && Math.abs(dx) > Math.abs(dy) && event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleSelectionTouchEnd(event) {
    if (!selection || !touchGesture) return;
    const gesture = touchGesture;
    touchGesture = null;
    const dx = gesture.lastX - gesture.startX;
    const dy = gesture.lastY - gesture.startY;

    if (gesture.edgeBack && dx >= EDGE_BACK_TRIGGER_PX && Math.abs(dx) > Math.abs(dy) * 1.1) {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
      suppressClickUntil = Date.now() + 500;
      exitSelection();
      return;
    }

    if (!gesture.moved && gesture.message) {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
      suppressClickUntil = Date.now() + 500;
      toggleMessage(gesture.message);
      return;
    }

    event.stopImmediatePropagation();
  }

  document.addEventListener('touchstart', handleSelectionTouchStart, { capture: true, passive: true });
  document.addEventListener('touchmove', handleSelectionTouchMove, { capture: true, passive: false });
  document.addEventListener('touchend', handleSelectionTouchEnd, { capture: true, passive: false });
  document.addEventListener('touchcancel', (event) => {
    if (!selection || !touchGesture) return;
    touchGesture = null;
    event.stopImmediatePropagation();
  }, { capture: true, passive: true });

  document.addEventListener('contextmenu', (event) => {
    if (!selection) return;
    const message = event.target?.closest?.(MESSAGE_LOCAL);
    if (!isSelectableMessage(message)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('click', (event) => {
    if (!selection) return;
    const message = event.target?.closest?.(MESSAGE_LOCAL);
    if (!isSelectableMessage(message)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (Date.now() < suppressClickUntil) return;
    toggleMessage(message);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!selection || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    exitSelection();
  }, true);

  const observer = new MutationObserver((records) => {
    let selectionChanged = false;

    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(ROOT)) decorateContext(node);
        node.querySelectorAll?.(ROOT).forEach(decorateContext);
        const root = node.closest?.(ROOT);
        if (root) decorateContext(root);

        if (selection) {
          if (isSelectableMessage(node)) ensureCheck(node);
          node.querySelectorAll?.(MESSAGE_LOCAL).forEach((el) => { if (isSelectableMessage(el)) ensureCheck(el); });
        }
      }

      if (!selection) continue;
      for (const node of record.removedNodes) {
        if (!(node instanceof Element)) continue;
        const candidates = [];
        if (node.matches?.(MESSAGE_LOCAL)) candidates.push(node);
        node.querySelectorAll?.(MESSAGE_LOCAL).forEach((el) => candidates.push(el));
        for (const el of candidates) {
          const id = messageId(el);
          if (!id || !selection.ids.has(id) || messageElement(id)) continue;
          selection.ids.delete(id);
          selection.mineById.delete(id);
          selectionChanged = true;
        }
      }
    }

    if (!selection) return;
    if (currentRoomId() !== selection.roomId || !document.querySelector('.chat-view')) {
      exitSelection();
      return;
    }
    if (selectionChanged) updateBars();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.querySelectorAll(ROOT).forEach(decorateContext);
})();
