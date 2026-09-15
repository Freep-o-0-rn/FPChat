/* Build 166: safe presentation bridge for build labels and final system-card polish. */
(() => {
  if (window.__fpBuild165UiInstalled) return;
  window.__fpBuild165UiInstalled = true;

  const BUILD_LABEL = 'Build 166';

  function patchBuildLabels() {
    document.querySelectorAll('.fp-settings131-value').forEach((node) => {
      const current = String(node.textContent || '').trim();
      if (/^Build\s+\d+$/i.test(current) && current !== BUILD_LABEL) {
        node.textContent = BUILD_LABEL;
      }
    });
    const about = document.getElementById('fpVersion131');
    if (about && /Build\s+\d+/i.test(about.textContent || '')) {
      const next = String(about.textContent).replace(/Build\s+\d+/i, BUILD_LABEL);
      if (next !== about.textContent) about.textContent = next;
    }
  }

  function patchBlockedInviteCardText() {
    document.querySelectorAll('.fp-system145-event .fp-system145-request-text').forEach((node) => {
      const text = String(node.textContent || '');
      if (/Попытался присоединиться к вашему чату по invite-ссылке \d+ раз\./.test(text)) {
        const next = 'Повторно пытался присоединиться к вашему чату по invite-ссылке. Все попытки отклонены из-за блокировки.';
        if (text !== next) node.textContent = next;
      }
    });
  }

  function patchUi() {
    patchBuildLabels();
    patchBlockedInviteCardText();
  }

  const observer = new MutationObserver(patchUi);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  patchUi();
})();
