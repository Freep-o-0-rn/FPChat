/* Build 120: compatibility glue for voice chat previews. */
(() => {
  const VOICE_PREVIEW = 'Голосовое сообщение';

  function isVoiceMessage(message) {
    const media = Array.isArray(message?.media) ? message.media : [];
    return message?.type === 'media' && media.length === 1 && String(media[0]?.media_kind || '') === 'audio';
  }

  const baseUpsertRoomMessage = typeof upsertRoomMessage === 'function' ? upsertRoomMessage : null;
  if (baseUpsertRoomMessage && !baseUpsertRoomMessage.__fpVoicePreviewWrapped) {
    const wrapped = function fpVoicePreviewUpsert(roomId, message, patch = {}) {
      if (isVoiceMessage(message) && !String(patch?.text || '').trim()) {
        patch = { ...patch, text: VOICE_PREVIEW };
      }
      return baseUpsertRoomMessage.call(this, roomId, message, patch);
    };
    wrapped.__fpVoicePreviewWrapped = true;
    try { upsertRoomMessage = wrapped; } catch {}
  }

  function repairCurrentChatPreview() {
    let roomId = '';
    try { roomId = String(state?.roomId || ''); } catch {}
    if (!roomId || typeof upsertChat !== 'function') return;
    const box = document.getElementById('messages');
    if (!box) return;
    const messages = box.querySelectorAll('.bubble-wrap.msg');
    const last = messages[messages.length - 1];
    if (!last?.classList.contains('fp-voice-message')) return;

    const chat = state.chats?.find?.((item) => item.roomId === roomId);
    if (String(chat?.lastMessage || '').trim() === VOICE_PREVIEW) return;
    const messageId = Number(last.dataset.messageId || last.dataset.id || 0);
    let sender = chat?.lastSender || '';
    try {
      const cached = Number.isSafeInteger(messageId) ? messageCache.get(messageId) : null;
      sender = cached?.author || sender;
    } catch {}
    upsertChat(roomId, {
      lastMessage: VOICE_PREVIEW,
      lastSender: sender,
      lastActivity: last.dataset.createdAt || chat?.lastActivity || new Date().toISOString()
    });
    try { renderChats(); } catch {}
  }

  const observer = new MutationObserver(() => repairCurrentChatPreview());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(repairCurrentChatPreview, 1000);
  repairCurrentChatPreview();
})();
