/* Build 170: guarded media-send owner.
   Keeps the existing media preview/XHR progress/retry UX, but captures room/key/
   device before long encryption/upload awaits so navigation cannot redirect media. */
(() => {
  if (window.__fpMediaSend170Installed) return;
  window.__fpMediaSend170Installed = true;

  const contexts = window.FPRoomContext170;
  if (!contexts || typeof sendMediaFromPreview !== 'function') return;

  const legacySendMediaFromPreview = sendMediaFromPreview;

  async function encryptBlobForKey(key, blob) {
    if (!key) throw new Error('room key unavailable');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = await blob.arrayBuffer();
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    const out = new Uint8Array(iv.byteLength + cipher.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(cipher), iv.byteLength);
    return new Blob([out], { type: 'application/octet-stream' });
  }

  async function encryptTextForKey(key, text) {
    if (!key) throw new Error('room key unavailable');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(String(text || ''))
    );
    return { iv: b64.encode(iv), ciphertext: b64.encode(cipher) };
  }

  function currentContext() {
    const context = contexts.current();
    if (!context || !contexts.isCurrent(context)) return null;
    if (String(state?.roomId || '') !== context.roomId) return null;
    return context;
  }

  function safeProgress(node, value) {
    if (node?.isConnected) node.textContent = value;
  }

  sendMediaFromPreview = async function sendMediaFromPreview170(root) {
    if (!mediaPreviewState || mediaPreviewState.sending) return;
    const context = currentContext();
    if (!context) return legacySendMediaFromPreview.apply(this, arguments);

    const roomId = context.roomId;
    const persisted = STORAGE.get(STORAGE.roomState(roomId));
    const deviceId = String(persisted?.deviceId || '').trim();
    if (!deviceId || !context.key) return legacySendMediaFromPreview.apply(this, arguments);

    const preview = mediaPreviewState;
    const items = preview.items;
    const caption = String(preview.caption || '').trim();
    const draft = ensureDraftState(roomId);
    const replyToMessageId = draft.replyTo?.messageId || null;
    if (replyToMessageId) {
      try { markReplyTargetRead(replyToMessageId); } catch {}
    }

    const operation = contexts.beginOperation(roomId, 'media-send');
    preview.sending = true;
    const btn = root?.querySelector('.media-send-btn');
    const prog = root?.querySelector('.media-upload-progress');
    const total = items.length;

    try {
      for (let i = 0; i < total; i += 1) {
        const item = items[i];
        if (item.uploadedMedia) continue;
        if (btn?.isConnected) btn.textContent = '…';
        safeProgress(prog, `Загрузка ${Math.round((i / total) * 100)}%`);

        const encryptedFile = await encryptBlobForKey(context.key, item.file);
        const encryptedThumb = await encryptBlobForKey(context.key, item.thumbnailBlob);
        const nameEnc = await encryptTextForKey(context.key, item.file.name || 'media');
        const fd = new FormData();
        fd.append('deviceId', deviceId);
        fd.append('encryptedFile', encryptedFile, 'file.bin');
        fd.append('encryptedThumbnail', encryptedThumb, 'thumb.bin');
        fd.append('originalNameCiphertext', nameEnc.ciphertext);
        fd.append('originalNameIv', nameEnc.iv);
        fd.append('mimeType', item.file.type);
        fd.append('mediaKind', item.kind);
        fd.append('sizeBytes', String(item.file.size));
        fd.append('encryptedSizeBytes', String(encryptedFile.size));
        fd.append('thumbSizeBytes', String(item.thumbnailBlob.size));
        fd.append('thumbEncryptedSizeBytes', String(encryptedThumb.size));
        fd.append('width', String(item.width || 0));
        fd.append('height', String(item.height || 0));
        fd.append('durationSeconds', String(item.durationSeconds || 0));
        fd.append('fileOrder', String(i));

        try {
          item.uploadedMedia = await uploadEncryptedMediaXhr(roomId, deviceId, fd, (loaded, totalBytes) => {
            if (totalBytes) safeProgress(prog, `Загрузка ${Math.round(((i + loaded / totalBytes) / total) * 100)}%`);
          });
        } catch {
          const retry = confirm(`Не удалось загрузить файл ${i + 1} из ${total}. Повторить?`);
          if (retry) { i -= 1; continue; }
          preview.sending = false;
          contexts.finishOperation(operation, 'upload-failed');
          return;
        }
      }

      const connected = await ensureWsConnected(deviceId);
      if (!connected || !state.ws || state.ws.readyState !== WebSocket.OPEN || state.ws.deviceId !== deviceId) {
        alert('Нет соединения. Попробуйте обновить чат.');
        preview.sending = false;
        contexts.finishOperation(operation, 'connection-failed');
        return;
      }

      const enc = await encryptTextForKey(context.key, caption || '');
      const mediaIds = items.map((item) => item.uploadedMedia?.id).filter(Boolean);
      const notificationPreview = caption
        ? caption.slice(0, 80)
        : buildMediaFallbackText(items.map((item) => ({ media_kind: item.kind })), caption);

      try {
        state.ws.send(JSON.stringify({
          type: 'message:new',
          roomId,
          messageType: 'media',
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          notificationPreview,
          replyToMessageId,
          mediaIds
        }));
      } catch {
        alert('Не удалось отправить сообщение. Проверьте соединение.');
        preview.sending = false;
        contexts.finishOperation(operation, 'send-failed');
        return;
      }

      draft.replyTo = null;
      try { await clearDraftOnServer(roomId); } catch {}
      closeMediaPreviewModal();
      contexts.finishOperation(operation, 'sent');
    } catch (error) {
      preview.sending = false;
      contexts.finishOperation(operation, error?.name === 'AbortError' ? 'cancelled' : 'failed');
      alert('Не удалось отправить сообщение. Проверьте соединение.');
    }
  };
  sendMediaFromPreview.__fp170 = true;
  sendMediaFromPreview.__fpLegacy = legacySendMediaFromPreview;

  window.FPMediaSend170 = Object.freeze({ active: true });
  try {
    window.FPRuntime?.registerOwner?.('media-send170', {
      role: 'media-submit',
      mode: 'active-owner',
      transport: 'existing XHR upload + stable WS'
    });
  } catch {}
})();
