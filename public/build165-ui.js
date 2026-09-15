/* Build 165: small presentation bridge for build labels and blocked-invite system text. */
(() => {
  if (window.__fpBuild165UiInstalled) return;
  window.__fpBuild165UiInstalled = true;

  function blockedInviteText(message) {
    const actor = String(message?.event_actor_name || message?.sender_name || 'Пользователь');
    return `${actor} попытался войти по приглашению. Вход отклонён из-за блокировки.`;
  }

  function installDecryptWrapper() {
    if (typeof decryptRoomText !== 'function' || decryptRoomText.__fpBuild165) return;
    const base = decryptRoomText;
    const wrapped = async function decryptRoomTextBuild165(roomId, message) {
      if (message?.type === 'system' && String(message?.event_type || '').startsWith('blocked_invite_attempt:')) {
        return blockedInviteText(message);
      }
      return base(roomId, message);
    };
    wrapped.__fpBuild165 = true;
    decryptRoomText = wrapped;
  }

  function patchBuildLabels() {
    document.querySelectorAll('.fp-settings131-value').forEach((node) => {
      if (/^Build\s+\d+$/i.test(String(node.textContent || '').trim())) node.textContent = 'Build 165';
    });
    const about = document.getElementById('fpVersion131');
    if (about && /Build\s+\d+/i.test(about.textContent || '')) {
      about.textContent = String(about.textContent).replace(/Build\s+\d+/i, 'Build 165');
    }
  }

  const observer = new MutationObserver(() => {
    installDecryptWrapper();
    patchBuildLabels();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const timer = setInterval(() => {
    installDecryptWrapper();
    patchBuildLabels();
    if (typeof decryptRoomText === 'function' && decryptRoomText.__fpBuild165) clearInterval(timer);
  }, 250);

  installDecryptWrapper();
  patchBuildLabels();
})();
