/* Build 101: stabilization patch for the isolated message context layer.
   Keeps the build-100 context implementation intact and fixes only overlay hit-testing,
   media dragging/layout stability and native drag behavior. */
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

  disableNativeMediaDrag(document);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        disableNativeMediaDrag(node);
        if (node.matches(ROOT_SELECTOR)) lockContextGeometry(node);
        node.querySelectorAll?.(ROOT_SELECTOR).forEach(lockContextGeometry);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.querySelectorAll(ROOT_SELECTOR).forEach(lockContextGeometry);
})();
