/* Build 184: presentation only. The existing message handler supplies progress;
   FPGesture135 still arbitrates input and app.js still executes reply. */
(() => {
  const baseClass = 'swipe-reply-icon fp-reply-indicator';

  function create() {
    const root = document.createElement('div');
    root.className = `${baseClass} fp-reply-hidden`;
    root.dataset.state = 'hidden';
    root.setAttribute('aria-hidden', 'true');
    const ripple = document.createElement('div');
    ripple.className = 'fp-reply-ripple';
    const circle = document.createElement('div');
    circle.className = 'fp-reply-circle';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'fp-reply-icon');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('focusable', 'false');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrow.setAttribute('d', 'M10 5 3 11l7 6v-4h4c3.5 0 5.5 1.5 7 5v-3c0-5-3-8-7-8h-4V5Z');
    icon.appendChild(arrow);
    circle.appendChild(icon);
    root.append(ripple, circle);
    return { root, circle, icon, ripple, state: 'hidden' };
  }

  function setState(visual, state) {
    if (visual.state === state) return;
    visual.root.classList.remove(`fp-reply-${visual.state}`);
    visual.root.classList.add(`fp-reply-${state}`);
    visual.root.dataset.state = state;
    visual.state = state;
  }

  function update(visual, progress, armed = false) {
    if (!visual) return;
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    // Keep the first 12% as an 8px dot, then grow to 36px without layout writes.
    const growth = Math.max(0, (p - 0.12) / 0.88);
    // Armed comes from the existing handler after it has obtained its lease.
    setState(visual, p === 0 ? 'hidden' : armed ? 'armed' : growth === 0 ? 'dot' : 'growing');
    visual.root.style.setProperty('--fp-reply-scale', String((8 + 28 * growth) / 36));
    visual.root.style.setProperty('--fp-reply-opacity', String(0.5 + 0.5 * growth));
    visual.root.style.setProperty('--fp-reply-icon-opacity', String(growth));
    visual.root.style.setProperty('--fp-reply-icon-scale', String(0.5 + 0.5 * growth));
  }

  function reset(visual, animate = false) {
    if (!visual) return;
    setState(visual, animate && visual.state !== 'hidden' ? 'cancel' : 'hidden');
    visual.root.style.setProperty('--fp-reply-scale', '0');
  }

  window.FPReplySwipeVisual184 = Object.freeze({ create, update, reset });
})();
