/* Build 104: stabilization patch for the isolated message context layer.
   Keeps the build-100 context implementation intact, preserves the build-101 geometry fixes,
   and makes build-103 image-save progress distinguish preparation from confirmed completion. */
(() => {
  const ROOT_SELECTOR = '.message-context-root';
  const COPY_SELECTOR = '.message-context-copy';

  function readMessageId(element) {
    return String(element?.dataset?.messageId || element?.dataset?.id || '').trim();
  }

  function numberPx(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function disableNativeMediaDrag(root = document) {
    root.querySelectorAll?.('.bubble-wrap.msg img, .bubble-wrap.msg video, .bubble-wrap.msg .media-tile, .message-context-root img, .message-context-root video, .message-context-root .media-tile')
      .forEach((element) => {
        element.draggable = false;
        element.setAttribute('draggable', 'false');
      });
  }

  function findOriginalMessage(messageId, clone) {
    if (!messageId) return null;
    return [...document.querySelectorAll('#messages .bubble-wrap.msg')]
      .find((element) => element !== clone && readMessageId(element) === messageId) || null;
  }

  function lockContextGeometry(root) {
    if (!root?.isConnected || root.dataset.fpContextGeometryLocked === '1') return;
    const clone = root.querySelector(COPY_SELECTOR);
    if (!clone) return;

    disableNativeMediaDrag(root);

    const original = findOriginalMessage(readMessageId(clone), clone);
    const originalBubble = original?.querySelector('.bubble');
    const cloneBubble = clone.querySelector('.bubble');
    if (!originalBubble || !cloneBubble) {
      root.dataset.fpContextGeometryLocked = '1';
      return;
    }

    const originalBubbleRect = originalBubble.getBoundingClientRect();
    const cloneStyle = getComputedStyle(clone);
    const horizontalPadding = numberPx(cloneStyle.paddingLeft) + numberPx(cloneStyle.paddingRight);
    const availableWidth = Math.max(1, clone.getBoundingClientRect().width - horizontalPadding);
    const bubbleWidth = Math.min(originalBubbleRect.width, availableWidth);

    if (Number.isFinite(bubbleWidth) && bubbleWidth > 0) {
      cloneBubble.style.setProperty('width', `${bubbleWidth}px`, 'important');
      cloneBubble.style.setProperty('max-width', `${bubbleWidth}px`, 'important');
      cloneBubble.style.setProperty('flex', `0 0 ${bubbleWidth}px`, 'important');
    }

    const originalGrid = original.querySelector('.media-grid');
    const cloneGrid = clone.querySelector('.media-grid');
    if (originalGrid && cloneGrid && bubbleWidth > 0) {
      const bubbleStyle = getComputedStyle(cloneBubble);
      const innerWidth = Math.max(1,
        bubbleWidth - numberPx(bubbleStyle.paddingLeft) - numberPx(bubbleStyle.paddingRight));
      const originalGridWidth = originalGrid.getBoundingClientRect().width;
      const gridWidth = Math.min(originalGridWidth, innerWidth);
      if (Number.isFinite(gridWidth) && gridWidth > 0) {
        cloneGrid.style.setProperty('width', `${gridWidth}px`, 'important');
        cloneGrid.style.setProperty('max-width', `${gridWidth}px`, 'important');
        cloneGrid.style.setProperty('min-width', '0', 'important');
      }
    }

    root.dataset.fpContextGeometryLocked = '1';
  }

  function closeThroughExistingContextHandler(root) {
    const backdrop = root?.querySelector('.message-context-backdrop');
    if (!backdrop) return;
    // The build-100 backdrop owns the real closeContext() call, including scroll restore.
    // Reuse it instead of duplicating context state outside its private closure.
    backdrop.click();
  }

  // In build 100 the cloned .bubble-wrap spans the whole context column, so visually empty
  // space beside a large bubble still intercepted taps. Treat every tap outside the visible
  // bubble/menu as backdrop without changing scrolling or the internal context state.
  document.addEventListener('click', (event) => {
    const root = event.target?.closest?.(ROOT_SELECTOR);
    if (!root) return;
    if (event.target.closest('.message-context-menu')) return;
    if (event.target.closest('.message-context-copy .bubble')) return;

    const backdrop = root.querySelector('.message-context-backdrop');
    if (event.target === backdrop) return; // let the original listener handle the real backdrop

    event.preventDefault();
    event.stopImmediatePropagation();
    closeThroughExistingContextHandler(root);
  }, true);

  // Images inside a message are content, not draggable browser objects.
  document.addEventListener('dragstart', (event) => {
    if (!event.target?.closest?.('.bubble-wrap.msg, .message-context-root')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  let browserDownloadHandoffUntil = 0;

  function markBrowserDownloadHandoff(event) {
    const link = event.target?.closest?.('a[download]');
    if (!link) return;
    const filename = String(link.download || '');
    if (!filename.startsWith('FPChat-')) return;
    browserDownloadHandoffUntil = Date.now() + 2000;
  }

  function normalizeSaveProgress(progress) {
    if (!(progress instanceof Element) || !progress.matches('.media-save-progress')) return;

    const currentLabel = String(progress.getAttribute('aria-label') || '');
    if (currentLabel.startsWith('Сохранение фото:')) {
      progress.setAttribute('aria-label', currentLabel.replace('Сохранение фото:', 'Подготовка фото:'));
    } else if (currentLabel === 'Сохранение фото') {
      progress.setAttribute('aria-label', 'Подготовка фото');
    }

    if (progress.classList.contains('is-error')) {
      progress.setAttribute('aria-label', 'Не удалось подготовить фото');
      return;
    }

    if (!progress.classList.contains('is-success')) return;

    if (Date.now() <= browserDownloadHandoffUntil) {
      browserDownloadHandoffUntil = 0;
      const host = progress.closest('.media-tile');
      progress.remove();
      host?.classList.remove('media-save-progress-host');
      return;
    }

    // Keep the check mark only when the native share API reports a successful action.
    // A plain browser download has no reliable completion/cancel callback and is handled above.
    progress.setAttribute('aria-label', 'Действие сохранения завершено');
  }

  document.addEventListener('click', markBrowserDownloadHandoff, true);

  disableNativeMediaDrag(document);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        if (record.target.matches('.media-save-progress')) normalizeSaveProgress(record.target);
        continue;
      }

      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        disableNativeMediaDrag(node);
        if (node.matches(ROOT_SELECTOR)) lockContextGeometry(node);
        node.querySelectorAll?.(ROOT_SELECTOR).forEach(lockContextGeometry);
        if (node.matches('.media-save-progress')) normalizeSaveProgress(node);
        node.querySelectorAll?.('.media-save-progress').forEach(normalizeSaveProgress);
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'aria-label']
  });

  document.querySelectorAll(ROOT_SELECTOR).forEach(lockContextGeometry);
  document.querySelectorAll('.media-save-progress').forEach(normalizeSaveProgress);
})();
