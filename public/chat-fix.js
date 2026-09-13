/* Build 102: normal chat composer stabilization.
   Does not change autosizing while text is present; it only restores the empty composer
   after a successful send/programmatic clear, which is unreliable on iOS Safari/PWA. */
(() => {
  const BOUND_INPUT = 'fpChatFixBound';
  const BOUND_FORM = 'fpChatFixSubmitBound';

  function collapseEmptyComposer(input) {
    if (!input || !input.isConnected || input.value !== '') return false;

    const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight) || 22;
    input.style.height = `${lineHeight}px`;
    input.style.overflowY = 'hidden';
    input.scrollTop = 0;

    const wrap = input.closest('.composer-input-wrap');
    if (wrap) {
      /* Remove only accidental inline geometry. CSS min-height remains untouched. */
      wrap.style.removeProperty('height');
      wrap.style.removeProperty('max-height');
    }
    return true;
  }

  function settleEmptyComposer(input) {
    if (!collapseEmptyComposer(input)) return;

    /* WebKit can keep the old textarea layout for one or two frames after value=''. */
    requestAnimationFrame(() => {
      collapseEmptyComposer(input);
      requestAnimationFrame(() => collapseEmptyComposer(input));
    });
    setTimeout(() => collapseEmptyComposer(input), 80);
    setTimeout(() => collapseEmptyComposer(input), 220);
  }

  function bindComposer(input) {
    if (!input || input.dataset[BOUND_INPUT] === '1') return;
    input.dataset[BOUND_INPUT] = '1';

    /* Existing autosize logic remains responsible while there is text. */
    input.addEventListener('input', () => {
      if (input.value === '') settleEmptyComposer(input);
    });

    const form = input.closest('#sendForm');
    if (form && form.dataset[BOUND_FORM] !== '1') {
      form.dataset[BOUND_FORM] = '1';
      form.addEventListener('submit', () => {
        if (!input.value.trim()) return;

        /* app.js clears the value only after the message has entered the send queue.
           We never collapse while any text remains, so failed sends keep the current UI. */
        const delays = [0, 30, 90, 180, 350, 700];
        for (const delay of delays) {
          setTimeout(() => {
            if (input.value === '') settleEmptyComposer(input);
          }, delay);
        }
      });
    }

    if (input.value === '') settleEmptyComposer(input);
  }

  function scan() {
    bindComposer(document.getElementById('msgInput'));
  }

  scan();

  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
})();
