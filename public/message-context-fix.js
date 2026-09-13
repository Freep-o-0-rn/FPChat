/* Build 105: stabilization patch for the isolated message context layer.
   Keeps the build-100 context implementation intact, preserves the build-101 geometry fixes,
   and fixes build-104 image-save progress on iOS. */
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
    backdrop.click();
  }

  document.addEventListener('click', (event) => {
    const root = event.target?.closest?.(ROOT_SELECTOR);
    if (!root) return;
    if (event.target.closest('.message-context-menu')) return;
    if (event.target.closest('.message-context-copy .bubble')) return;

    const backdrop = root.querySelector('.message-context-backdrop');
    if (event.target === backdrop) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    closeThroughExistingContextHandler(root);
  }, true);

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

  function setAriaLabel(element, value) {
    if (!element || element.getAttribute('aria-label') === value) return;
    element.setAttribute('aria-label', value);
  }

  function removeProgress(progress) {
    if (!(progress instanceof Element) || !progress.isConnected) return;
    const host = progress.closest('.media-tile');
    progress.remove();
    if (!host?.querySelector('.media-save-progress')) {
      host?.classList.remove('media-save-progress-host');
    }
  }

  function normalizeSaveProgress(progress) {
    if (!(progress instanceof Element) || !progress.matches('.media-save-progress')) return;

    const currentLabel = String(progress.getAttribute('aria-label') || '');
    let normalizedLabel = currentLabel;

    if (currentLabel.startsWith('Сохранение фото:')) {
      normalizedLabel = currentLabel.replace('Сохранение фото:', 'Подготовка фото:');
    } else if (currentLabel === 'Сохранение фото') {
      normalizedLabel = 'Подготовка фото';
    }

    setAriaLabel(progress, normalizedLabel);

    if (progress.classList.contains('is-error')) {
      setAriaLabel(progress, 'Не удалось подготовить фото');
      return;
    }

    if (progress.classList.contains('is-success')) {
      if (Date.now() <= browserDownloadHandoffUntil) {
        browserDownloadHandoffUntil = 0;
        removeProgress(progress);
        return;
      }
      setAriaLabel(progress, 'Действие сохранения завершено');
      return;
    }

    // The ring represents only download/decryption preparation. Once preparation
    // reaches 100%, remove it before control is handed to the iOS share/save UI.
    // This also prevents a WebKit share promise from leaving a permanent spinner.
    if (normalizedLabel === 'Подготовка фото: 100%') {
      queueMicrotask(() => removeProgress(progress));
    }
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
