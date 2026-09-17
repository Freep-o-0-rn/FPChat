/* Build 170: guarded text-send owner.
   Captures room/key/device before async work so a room switch cannot redirect an
   in-flight text send to another room. Existing retry/clientMessageId semantics
   remain unchanged. */
(() => {
  if (window.__fpTextSend170Installed) return;
  window.__fpTextSend170Installed = true;

  const contexts = window.FPRoomContext170;
  if (!contexts) return;

  const boundForms = new WeakMap();

  function roomStoredDevice(roomId) {
    try { return String(STORAGE.get(STORAGE.roomState(roomId))?.deviceId || '').trim(); }
    catch { return ''; }
  }

  async function encryptForKey(key, text) {
    if (!key) throw new Error('room key unavailable');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(text)
    );
    return { iv: b64.encode(iv), ciphertext: b64.encode(ciphertext) };
  }

  function currentFormContext(form) {
    const context = boundForms.get(form);
    if (!context || !contexts.isCurrent(context)) return null;
    if (String(state?.roomId || '') !== context.roomId) return null;
    return context;
  }

  function finish(operation, status) {
    try { contexts.finishOperation(operation, status); } catch {}
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget || this;
    const context = currentFormContext(form);
    if (!context) return;

    const input = form.querySelector('#msgInput') || document.getElementById('msgInput');
    const sendBtn = form.querySelector('#sendBtn') || document.getElementById('sendBtn');
    const text = String(input?.value || '').trim();
    if (!text) return;

    const roomId = context.roomId;
    const deviceId = roomStoredDevice(roomId) || String(activeChatDeviceId || '');
    if (!deviceId) return;

    const draft = ensureDraftState(roomId);
    const replyToMessageId = draft.replyTo?.messageId || null;
    if (replyToMessageId && contexts.isCurrent(context)) {
      // This call relies on active-room state, so perform it before any await.
      try { markReplyTargetRead(replyToMessageId); } catch {}
    }

    const operation = contexts.beginOperation(roomId, 'text-send');
    const senderName = String(state?.nick || '');

    try {
      const connected = await ensureWsConnected(deviceId);
      if (!connected || !state.ws || state.ws.readyState !== WebSocket.OPEN || state.ws.deviceId !== deviceId) {
        if (contexts.isCurrent(context)) alert('Нет соединения. Попробуйте обновить чат.');
        finish(operation, 'connection-failed');
        return;
      }

      // Use the immutable key captured by the room context, never state.key after
      // an await: state.key may already belong to another visible room.
      const encrypted = await encryptForKey(context.key, text);
      const clientMessageId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const outbound = {
        type: 'message:send',
        roomId,
        clientMessageId,
        ...encrypted,
        notificationPreview: text.slice(0, 80),
        replyToMessageId
      };
      const tempMessage = {
        id: clientMessageId,
        client_message_id: clientMessageId,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        reply_to_message_id: replyToMessageId,
        status: 'sending',
        created_at: createdAt,
        delivered_at: null,
        read_at: null,
        sender_name: senderName,
        sender_device_id: deviceId,
        type: 'text',
        media: []
      };

      const stillVisible = contexts.isCurrent(context) && String(state?.roomId || '') === roomId;
      const box = stillVisible ? document.getElementById('messages') : null;
      try {
        if (box) {
          appendDateSeparatorIfNeeded(box, createdAt);
          appendMessage(box, tempMessage, text, true, true);
        }
        upsertRoomMessage(roomId, tempMessage, { text, unread: 0 });
        if (!queuePendingTextSend(outbound)) throw new Error('queue');
      } catch {
        if (stillVisible) alert('Не удалось отправить сообщение. Проверьте соединение.');
        finish(operation, 'queue-failed');
        return;
      }

      // The send now belongs to roomId even if navigation happens while the
      // server-side draft clear is in flight.
      draft.text = '';
      draft.replyTo = null;
      try { await clearDraftOnServer(roomId); } catch {}

      if (contexts.isCurrent(context) && form.isConnected) {
        if (input) input.value = '';
        try { updateReplyComposerBar(); } catch {}
        if (sendBtn) sendBtn.disabled = !String(input?.value || '').trim();
        try { autoResizeMessageInput(input); } catch {}
      }

      finish(operation, 'queued');
    } catch (error) {
      finish(operation, error?.name === 'AbortError' ? 'cancelled' : 'failed');
      if (contexts.isCurrent(context)) alert('Не удалось отправить сообщение. Проверьте соединение.');
    }
  }

  function bindCurrentForm() {
    const form = document.getElementById('sendForm');
    const context = contexts.current();
    if (!form || !context || !contexts.isCurrent(context)) return false;
    if (boundForms.get(form) === context && form.onsubmit === submit) return true;

    // Keep the previous handler only for diagnostics/rollback inspection. It is
    // no longer independently assigned to the form after ownership transfer.
    if (!form.__fpLegacySubmit170 && typeof form.onsubmit === 'function') {
      Object.defineProperty(form, '__fpLegacySubmit170', {
        configurable: true,
        value: form.onsubmit
      });
    }

    boundForms.set(form, context);
    form.dataset.fpTextSend170 = String(context.generation);
    form.onsubmit = submit;
    return true;
  }

  window.addEventListener('fpchat:room-open170', (event) => {
    const stage = String(event?.detail?.stage || '');
    if (stage === 'ready') bindCurrentForm();
  }, { passive: true });
  window.addEventListener('fpchat:room-context-ended', () => {
    const form = document.getElementById('sendForm');
    if (form) delete form.dataset.fpTextSend170;
  }, { passive: true });

  // Build 170 layers can load after an initial room was already rendered.
  queueMicrotask(bindCurrentForm);

  window.FPTextSend170 = Object.freeze({ bindCurrentForm });
  try {
    window.FPRuntime?.registerOwner?.('text-send170', {
      role: 'text-submit',
      mode: 'active-owner',
      retryOwner: 'pendingTextSends/app.js'
    });
  } catch {}

  const currentScript = document.currentScript;
  const suffix = (() => {
    try { return new URL(currentScript?.src || '', location.href).search || '?v=170'; }
    catch { return '?v=170'; }
  })();
  if (!window.__fpMediaSend170Installed && !document.querySelector('script[data-fp-media-send170]')) {
    const script = document.createElement('script');
    script.src = `/media-send170.js${suffix}`;
    script.dataset.fpMediaSend170 = '1';
    document.body.appendChild(script);
  }
})();
