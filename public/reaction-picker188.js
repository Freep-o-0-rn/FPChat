/* Build 189.1: full reaction catalog picker UI worker.
   Lives only inside the existing message-context layer.
   FPReactionInteractionManager188 owns interaction semantics and mutation delegation.
   Build 189 adds viewport-safe adaptive positioning of the existing context cluster. */
(() => {
  if (window.FPReactionPicker188) return;

  const PANEL_CLASS = 'fp-reaction-picker188';
  const TOGGLE_CLASS = 'fp-reaction-picker-toggle188';
  const ITEM_CLASS = 'fp-reaction-picker-item188';
  const STYLE_ID = 'fp-reaction-picker188-style';
  const attached = new WeakMap();
  const SAFE_GAP_PX = 12;

  const CATEGORY_LABELS = Object.freeze({
    faces: 'Эмоции', hearts: 'Сердца', gestures: 'Жесты', symbols: 'Символы',
    objects: 'Объекты', food: 'Еда', animals: 'Животные', seasonal: 'Праздничные', other: 'Другие'
  });

  const stats = {
    attached: 0, opens: 0, closes: 0, renders: 0, renderedItems: 0,
    selections: 0, toggles: 0, adaptiveShifts: 0, lastShiftPx: 0,
    lastExpanded: false, lastToggleAt: 0
  };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${TOGGLE_CLASS}{appearance:none;width:36px;height:36px;flex:0 0 36px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:rgba(120,130,145,.13);color:var(--muted);cursor:pointer;touch-action:manipulation;transition:background .12s ease,transform .12s ease,color .12s ease}
      .${TOGGLE_CLASS}:hover{background:rgba(120,130,145,.20);color:var(--text)}
      .${TOGGLE_CLASS}:active{transform:scale(.92)}
      .${TOGGLE_CLASS}:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
      .fp-reaction-picker-chevron188{width:10px;height:10px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:translateY(-2px) rotate(45deg);transition:transform .16s ease}
      .${TOGGLE_CLASS}[aria-expanded='true'] .fp-reaction-picker-chevron188{transform:translateY(2px) rotate(225deg)}
      .${PANEL_CLASS}{width:min(336px,calc(100vw - 28px));max-height:min(310px,52vh);box-sizing:border-box;margin:-2px 6px 8px auto;padding:8px 8px 10px;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;border:1px solid rgba(255,255,255,.28);border-radius:20px;background:color-mix(in srgb,var(--panel) 91%,transparent);-webkit-backdrop-filter:blur(24px) saturate(1.24);backdrop-filter:blur(24px) saturate(1.24);box-shadow:0 16px 38px rgba(0,0,0,.27);pointer-events:auto;scrollbar-width:thin}
      .message-context-cluster.incoming .${PANEL_CLASS}{margin-left:6px;margin-right:auto}
      :root[data-theme='dark'] .${PANEL_CLASS}{border-color:rgba(255,255,255,.10);background:color-mix(in srgb,var(--panel) 94%,transparent)}
      .${PANEL_CLASS}[hidden]{display:none!important}
      .message-context-cluster.fp-reaction-adaptive189{will-change:transform;transition:transform .2s cubic-bezier(.2,.8,.2,1)}
      .fp-reaction-picker-section188 + .fp-reaction-picker-section188{margin-top:7px}
      .fp-reaction-picker-title188{padding:4px 5px 5px;color:var(--muted);font-size:11px;font-weight:700;line-height:1.2;letter-spacing:.02em;text-transform:uppercase}
      .fp-reaction-picker-grid188{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}
      .${ITEM_CLASS}{appearance:none;min-width:0;aspect-ratio:1;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:12px;background:transparent;color:inherit;font:inherit;font-size:25px;line-height:1;cursor:pointer;touch-action:manipulation;transition:background .1s ease,transform .1s ease}
      .${ITEM_CLASS}:hover{background:rgba(120,130,145,.13)}
      .${ITEM_CLASS}:active{transform:scale(.88)}
      .${ITEM_CLASS}.is-mine{background:var(--accent-soft)}
      .${ITEM_CLASS}:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
      .fp-reaction-picker-empty188{padding:16px 10px;color:var(--muted);text-align:center;font-size:13px}
      @media (max-width:900px){.${TOGGLE_CLASS}{width:34px;height:34px;flex-basis:34px}.${PANEL_CLASS}{width:min(336px,calc(100vw - 20px));max-height:min(300px,48vh);margin-right:8px}.message-context-cluster.incoming .${PANEL_CLASS}{margin-left:8px;margin-right:auto}}
      @media (max-width:360px){.fp-reaction-picker-grid188{grid-template-columns:repeat(6,minmax(0,1fr))}.${ITEM_CLASS}{font-size:24px}}
      @media (max-width:340px){.${TOGGLE_CLASS}{width:31px;height:34px;flex-basis:31px}}
      @media (prefers-reduced-motion:reduce){.${TOGGLE_CLASS},.fp-reaction-picker-chevron188,.${ITEM_CLASS},.message-context-cluster.fp-reaction-adaptive189{transition:none}}
    `;
    document.head.appendChild(style);
  }

  function enabledCatalog(catalog) {
    return (Array.isArray(catalog) ? catalog : []).filter((item) => item && item.enabled !== false && String(item.id || '').trim() && String(item.value || '').trim());
  }

  function categoryKey(value) { return String(value || 'other').trim().slice(0, 32) || 'other'; }

  function groupedCatalog(catalog) {
    const groups = [], byCategory = new Map();
    for (const reaction of enabledCatalog(catalog)) {
      const category = categoryKey(reaction.category);
      let group = byCategory.get(category);
      if (!group) {
        group = { category, label: CATEGORY_LABELS[category] || 'Другие', reactions: [] };
        byCategory.set(category, group); groups.push(group);
      }
      group.reactions.push(reaction);
    }
    return groups;
  }

  function bindActivation(button, activate) {
    let suppressClickUntil = 0;
    button.addEventListener('pointerup', (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); suppressClickUntil = Date.now() + 700; activate(event, true);
    });
    button.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation(); if (Date.now() < suppressClickUntil) return; activate(event, false);
    });
  }

  function renderVisual(button, reaction) {
    button.dataset.reactionType = String(reaction?.type || 'emoji');
    button.textContent = String(reaction?.value || '');
  }

  function syncSelectionForState(state, mineIds) {
    if (!state?.panel) return;
    const mine = mineIds instanceof Set ? mineIds : new Set(mineIds || []);
    state.panel.querySelectorAll(`.${ITEM_CLASS}[data-reaction-id]`).forEach((button) => {
      const selected = mine.has(String(button.dataset.reactionId || ''));
      button.classList.toggle('is-mine', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function render(state) {
    if (!state || state.rendered) return;
    state.rendered = true; stats.renders += 1;
    const groups = groupedCatalog(state.catalog);
    if (!groups.length) {
      const empty = document.createElement('div'); empty.className = 'fp-reaction-picker-empty188'; empty.textContent = 'Нет доступных реакций'; state.panel.appendChild(empty); return;
    }
    const fragment = document.createDocumentFragment();
    for (const group of groups) {
      const section = document.createElement('section'); section.className = 'fp-reaction-picker-section188'; section.dataset.category = group.category;
      const title = document.createElement('div'); title.className = 'fp-reaction-picker-title188'; title.textContent = group.label; section.appendChild(title);
      const grid = document.createElement('div'); grid.className = 'fp-reaction-picker-grid188'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', group.label);
      for (const reaction of group.reactions) {
        const button = document.createElement('button'); button.type = 'button'; button.className = ITEM_CLASS; button.dataset.reactionId = String(reaction.id || '');
        button.setAttribute('aria-label', `Реакция ${String(reaction.value || '')}`); button.setAttribute('aria-pressed', 'false'); renderVisual(button, reaction);
        bindActivation(button, (_event, fromMousePointer) => { stats.selections += 1; state.onSelect?.(reaction, { fromMousePointer: Boolean(fromMousePointer) }); });
        grid.appendChild(button); stats.renderedItems += 1;
      }
      section.appendChild(grid); fragment.appendChild(section);
    }
    state.panel.appendChild(fragment);
    syncSelectionForState(state, state.getMineIds?.() || new Set());
  }

  function viewportBounds() {
    const vv = window.visualViewport;
    const top = Math.max(0, Number(vv?.offsetTop || 0)) + SAFE_GAP_PX;
    const height = Math.max(0, Number(vv?.height || window.innerHeight));
    return { top, bottom: top - SAFE_GAP_PX + height - SAFE_GAP_PX };
  }

  function resetAdaptivePosition(state) {
    const cluster = state?.cluster;
    if (!cluster) return;
    state.shiftPx = 0;
    stats.lastShiftPx = 0;
    cluster.style.transform = '';
    cluster.classList.remove('fp-reaction-adaptive189');
  }

  function adaptExpandedPosition(state) {
    if (!state?.expanded || !state.cluster?.isConnected || !state.panel?.isConnected) return;
    const cluster = state.cluster;
    // Measure from the unshifted baseline so repeated opens/reflows never accumulate translation.
    cluster.style.transform = '';
    const rect = cluster.getBoundingClientRect();
    const bounds = viewportBounds();
    const overflowBottom = Math.max(0, rect.bottom - bounds.bottom);
    const availableUp = Math.max(0, rect.top - bounds.top);
    const shift = Math.ceil(Math.min(overflowBottom, availableUp));
    state.shiftPx = shift;
    stats.lastShiftPx = shift;
    if (shift > 0) {
      stats.adaptiveShifts += 1;
      cluster.classList.add('fp-reaction-adaptive189');
      cluster.style.transform = `translate3d(0, ${-shift}px, 0)`;
    } else {
      cluster.classList.remove('fp-reaction-adaptive189');
    }
  }

  function setExpanded(state, expanded) {
    if (!state) return false;
    const next = Boolean(expanded);
    if (next && !state.rendered) render(state);
    if (state.expanded === next) return next;
    state.expanded = next; state.panel.hidden = !next; state.toggle.setAttribute('aria-expanded', next ? 'true' : 'false'); state.strip.classList.toggle('is-picker-open', next);
    stats.toggles += 1; stats.lastExpanded = next; stats.lastToggleAt = Date.now();
    if (next) {
      stats.opens += 1; state.panel.scrollTop = 0;
      requestAnimationFrame(() => requestAnimationFrame(() => adaptExpandedPosition(state)));
    } else {
      stats.closes += 1; resetAdaptivePosition(state);
    }
    state.onExpandedChange?.(next, state.panel);
    return next;
  }

  function attach({ strip, clone, catalog, getMineIds, onSelect, onExpandedChange } = {}) {
    if (!(strip instanceof Element) || !(clone instanceof Element)) return null;
    const existing = attached.get(strip); if (existing) return existing.publicApi;
    ensureStyle();
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = TOGGLE_CLASS; toggle.setAttribute('aria-label', 'Все реакции'); toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span class="fp-reaction-picker-chevron188" aria-hidden="true"></span>';
    const panel = document.createElement('div'); panel.className = PANEL_CLASS; panel.hidden = true; panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', 'Все реакции');
    strip.appendChild(toggle); strip.insertAdjacentElement('afterend', panel);
    const state = { strip, clone, toggle, panel, cluster: strip.closest('.message-context-cluster'), catalog: enabledCatalog(catalog), getMineIds, onSelect, onExpandedChange, expanded: false, rendered: false, shiftPx: 0, publicApi: null };
    const publicApi = Object.freeze({ open: () => setExpanded(state, true), close: () => setExpanded(state, false), toggle: () => setExpanded(state, !state.expanded), isOpen: () => state.expanded, syncSelection: (mineIds) => syncSelectionForState(state, mineIds), panel, toggleButton: toggle });
    state.publicApi = publicApi; attached.set(strip, state); stats.attached += 1;
    let suppressSyntheticClickUntil = 0;
    toggle.addEventListener('pointerup', (event) => {
      if (!['mouse', 'touch', 'pen'].includes(event.pointerType) || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault(); event.stopPropagation(); suppressSyntheticClickUntil = Date.now() + 700; publicApi.toggle();
    });
    toggle.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); if (Date.now() < suppressSyntheticClickUntil) return; publicApi.toggle(); });
    return publicApi;
  }

  function syncSelection(strip, mineIds) {
    const state = attached.get(strip); if (!state) return false; syncSelectionForState(state, mineIds); return true;
  }

  window.FPReactionPicker188 = Object.freeze({ attach, syncSelection, snapshot: () => ({ owner: 'FPReactionPicker188', parentOwner: 'FPReactionInteractionManager188', ...stats }) });
  try {
    window.FPRuntime?.registerOwner?.('reaction-picker188', {
      role: 'reaction-catalog-ui-worker', mode: 'thin-worker', parentOwner: 'FPReactionInteractionManager188', layer: 'existing message-context only',
      catalogSource: 'FPReactionManager188', owns: 'expand button + lazy full-catalog DOM + adaptive context translation', transport: false, gestures: false, persistentState: false
    });
  } catch {}
})();
