/* Build 165: small presentation bridge for build labels. */
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

  const observer = new MutationObserver(patchBuildLabels);
  observer.observe(document.body, { childList: true, subtree: true });
  patchBuildLabels();
})();
