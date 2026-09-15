/* Build 165: small presentation bridge for build labels and final system-card polish. */
(() => {
  if (window.__fpBuild165UiInstalled) return;
  window.__fpBuild165UiInstalled = true;

  function patchBuildLabels() {
    document.querySelectorAll('.fp-settings131-value').forEach((node) => {
      if (/^Build\s+\d+$/i.test(String(node.textContent || '').trim())) node.textContent = 'Build 165';
    });
    const about = document.getElementById('fpVersion131');
    if (about && /Build\s+\d+/i.test(about.textContent || '')) {
      about.textContent = String(about.textContent).replace(/Build\s+\d+/i, 'Build 165');
    }
  }

  function patchBlockedInviteCardText() {
    document.querySelectorAll('.fp-system145-event .fp-system145-request-text').forEach((node) => {
      const text = String(node.textContent || '');
      if (/Попытался присоединиться к вашему чату по invite-ссылке \d+ раз\./.test(text)) {
        node.textContent = 'Повторно пытался присоединиться к вашему чату по invite-ссылке. Все попытки отклонены из-за блокировки.';
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
