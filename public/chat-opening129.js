/* Build 129: visual-only chat opening polish. Existing scroll/lazy-history mechanics stay untouched. */
(() => {
  if (window.__fpChatOpening129Installed) return;
  window.__fpChatOpening129Installed = true;

  const style = document.createElement('style');
  style.dataset.fpChatOpening129 = '1';
  style.textContent = `
    html.fp-chat-opening129 #messages {
      visibility: hidden !important;
    }
  `;
  document.head.appendChild(style);

  const baseRender = typeof renderChatView === 'function' ? renderChatView : null;
  if (!baseRender || baseRender.__fpChatOpening129Wrapped) return;

  let generation = 0;

  const wrapped = async function fpChatOpening129Render() {
    const token = ++generation;
    document.documentElement.classList.add('fp-chat-opening129');
    try {
      return await baseRender.apply(this, arguments);
    } finally {
      if (token !== generation) return;
      requestAnimationFrame(() => {
        if (token !== generation) return;
        document.documentElement.classList.remove('fp-chat-opening129');
      });
    }
  };

  wrapped.__fpChatOpening129Wrapped = true;
  wrapped.__fpChatOpening129Base = baseRender;
  try { renderChatView = wrapped; } catch {}
})();
