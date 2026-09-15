/* Build 156: isolated global-search usability layer. Existing search mechanics stay untouched. */
(() => {
  if (window.__fpGlobalSearch156Installed) return;
  window.__fpGlobalSearch156Installed = true;

  const search = document.getElementById('chatSearch');
  const searchTop = search?.closest?.('.chat-list-top');
  if (!search || !searchTop) return;

  const style = document.createElement('style');
  style.id = 'fpchat-global-search156-style';
  style.textContent = `
    .fp-global-search156-wrap{position:relative;display:flex;align-items:center;flex:1;min-width:0}
    .fp-global-search156-wrap #chatSearch{padding-right:44px}
    .fp-global-search156-clear{position:absolute;right:7px;top:50%;transform:translateY(-50%);width:30px;height:30px;padding:0;border:0;border-radius:50%;display:grid;place-items:center;background:transparent;color:color-mix(in srgb,var(--muted) 76%,transparent);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;transition:opacity .12s ease,background .12s ease,color .12s ease}
    .fp-global-search156-clear[hidden]{display:none!important}
    .fp-global-search156-clear:hover{color:var(--muted);background:rgba(120,130,145,.08)}
    .fp-global-search156-clear:active{background:rgba(120,130,145,.14)}
    .fp-global-search156-clear:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
    .fp-global-search156-clear svg{width:21px;height:21px;display:block}
    .fp-global-search156-clear circle{fill:currentColor}
    .fp-global-search156-clear path{fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round}
    .fp-global-search156-hint{padding:0 calc(14px + env(safe-area-inset-right)) 8px calc(14px + env(safe-area-inset-left));color:var(--muted);font-size:12px;line-height:1.3;opacity:.86;user-select:none;-webkit-user-select:none}
    .fp-global-search156-hint[hidden]{display:none!important}
    .fp-global-search156-hint b{font-weight:700;color:color-mix(in srgb,var(--muted) 82%,var(--text) 18%)}
    @media(max-width:900px){.fp-global-search156-clear{right:6px;width:32px;height:32px}.fp-global-search156-clear svg{width:22px;height:22px}}
  `;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'fp-global-search156-wrap';
  search.parentNode.insertBefore(wrap, search);
  wrap.appendChild(search);

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'fp-global-search156-clear';
  clearButton.setAttribute('aria-label', 'Очистить поиск');
  clearButton.setAttribute('title', 'Очистить поиск');
  clearButton.hidden = true;
  clearButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6"/></svg>';
  wrap.appendChild(clearButton);

  const hint = document.createElement('div');
  hint.className = 'fp-global-search156-hint';
  hint.innerHTML = '<b>@username</b> — поиск по пользователям';
  searchTop.insertAdjacentElement('afterend', hint);

  function sync() {
    const hasValue = search.value.length > 0;
    clearButton.hidden = !hasValue;
    hint.hidden = Boolean(search.value.trim());
  }

  function clearSearch(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (search.value) {
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('search', { bubbles: true }));
    }
    try { search.focus({ preventScroll: true }); }
    catch { search.focus(); }
    sync();
  }

  clearButton.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    clearSearch(event);
  });
  clearButton.addEventListener('click', clearSearch);
  search.addEventListener('input', sync);
  search.addEventListener('search', sync);
  sync();
})();
