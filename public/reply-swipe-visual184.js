/* Build 184.1 — Reply Swipe Visual Foundation
   Visual layer only. Does not own gesture, threshold or reply execution.
*/
(() => {
  function createReplySwipeVisual() {
    const root = document.createElement('div');
    root.className = 'fp-reply-indicator fp-reply-hidden';

    const ripple = document.createElement('div');
    ripple.className = 'fp-reply-ripple';

    const circle = document.createElement('div');
    circle.className = 'fp-reply-circle';

    const icon = document.createElement('div');
    icon.className = 'fp-reply-icon';
    icon.textContent = '↩';

    circle.appendChild(icon);
    root.appendChild(ripple);
    root.appendChild(circle);

    return { root, ripple, circle, icon };
  }

  function updateReplySwipeVisual(visual, dx) {
    if (!visual) return;
    if (Math.abs(dx) < 5) {
      resetReplySwipeVisual(visual);
      return;
    }
    visual.root.classList.remove('fp-reply-hidden');
  }

  function resetReplySwipeVisual(visual) {
    if (!visual) return;
    visual.root.className = 'fp-reply-indicator fp-reply-hidden';
  }

  window.FPReplySwipeVisual184 = {
    create: createReplySwipeVisual,
    update: updateReplySwipeVisual,
    reset: resetReplySwipeVisual
  };
})();
