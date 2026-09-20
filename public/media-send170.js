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

  function releasePreview(preview) {
    for (const item of preview.items) {
      try { URL.revokeObjectURL(item.objectUrl); } catch {}
      try { URL.revokeObjectURL(item.thumbnailObjectUrl); } catch {}
    }
  }

  async function cancelPreview(preview = mediaPreviewState) {
    if (!preview) return;
    if (!preview.committed) {
      preview.cancelled = true;
      if (preview.operation) contexts.cancelOperation(preview.operation, 'user-cancelled');
    }
    if (mediaPreviewState === preview) closeMediaPreviewModal();
    await preview.task?.catch(() => {});
    if (!preview.committed) await deleteUploadedPendingMedia(preview.items, preview.roomId);
  }

  async function send(preview, context, root, operation) {
    const roomId = context.roomId;
    const deviceId = String(STORAGE.get(STORAGE.roomState(roomId))?.deviceId || '');
    const items = [...preview.items];
    const draft = ensureDraftState(roomId);
    const draftText = draft.text, draftReply = draft.replyTo;
    const replyToMessageId = draftReply?.messageId || null;
    if (replyToMessageId) markReplyTargetRead(replyToMessageId);
    const btn = root?.querySelector('.media-send-btn');
    const prog = root?.querySelector('.media-upload-progress');
    const captionInput = root?.querySelector('.media-caption-input');
    const controls = [...root?.querySelectorAll('.media-item-remove,.media-send-btn') || []];
    controls.forEach(node => { node.disabled = true; });
    const guard = () => { if (operation.signal.aborted || preview.cancelled) throw new DOMException('Media cancelled', 'AbortError'); };
    const total = items.length;
    let status = 'failed';
    try {
      for (let i = 0; i < total; i++) {
        guard();
        const item = items[i];
        if (item.uploadedMedia) continue;
        if (btn?.isConnected) btn.textContent = '…';
        safeProgress(prog, `Загрузка ${Math.round(i / total * 100)}%`);
        const encryptedFile = await encryptBlobForKey(context.key, item.file); guard();
        const encryptedThumb = await encryptBlobForKey(context.key, item.thumbnailBlob); guard();
        const nameEnc = await encryptTextForKey(context.key, item.file.name || 'media'); guard();
        item.uploadId ||= crypto.randomUUID().replaceAll('-', '');
        const fd = new FormData();
        for (const [key, value] of Object.entries({deviceId, uploadId:item.uploadId,
          originalNameCiphertext:nameEnc.ciphertext, originalNameIv:nameEnc.iv,
          mimeType:item.file.type, mediaKind:item.kind, sizeBytes:item.file.size,
          encryptedSizeBytes:encryptedFile.size, thumbSizeBytes:item.thumbnailBlob.size,
          thumbEncryptedSizeBytes:encryptedThumb.size, width:item.width || 0,
          height:item.height || 0, durationSeconds:item.durationSeconds || 0, fileOrder:i})) fd.append(key, String(value));
        fd.append('encryptedFile', encryptedFile, 'file.bin');
        fd.append('encryptedThumbnail', encryptedThumb, 'thumb.bin');
        try {
          item.uploadedMedia = await uploadEncryptedMediaXhr(roomId, deviceId, fd, (loaded, bytes) => {
            if (!operation.signal.aborted && bytes) safeProgress(prog, `Загрузка ${Math.round((i + loaded / bytes) / total * 100)}%`);
          }, {signal:operation.signal});
          guard();
        } catch (error) {
          guard();
          if (error.name === 'AbortError') throw error;
          if (mediaPreviewState === preview && confirm(`Не удалось загрузить файл ${i + 1} из ${total}. Повторить?`)) { i--; continue; }
          status = 'upload-failed';return;
        }
      }
      const connected = await ensureWsConnected(deviceId); guard();
      if (!connected || !state.ws || state.ws.readyState !== WebSocket.OPEN || state.ws.deviceId !== deviceId) {
        if (mediaPreviewState === preview) alert('Нет соединения. Попробуйте обновить чат.');
        status = 'connection-failed';return;
      }
      // The caption remains editable throughout upload, as in the original UX.
      // Freeze only the final encryption/send step so the visible text is exact.
      if (captionInput) captionInput.readOnly = true;
      const caption = String(preview.caption || '').trim();
      const enc = await encryptTextForKey(context.key, caption); guard();
      state.ws.send(JSON.stringify({type:'message:new',roomId,messageType:'media',
        ciphertext:enc.ciphertext,iv:enc.iv,replyToMessageId,
        notificationPreview:caption ? caption.slice(0,80) : buildMediaFallbackText(items.map(item=>({media_kind:item.kind})),caption),
        mediaIds:items.map(item=>item.uploadedMedia.id)}));
      preview.committed = true;
      status = 'sent';
      if (draft.text === draftText && draft.replyTo === draftReply) {
        try { await clearDraftOnServer(roomId); } catch {}
      }
      if (mediaPreviewState === preview) closeMediaPreviewModal();
      else releasePreview(preview);
    } catch (error) {
      status = error.name === 'AbortError' ? 'cancelled' : 'failed';
      if (status !== 'cancelled' && mediaPreviewState === preview) alert('Не удалось отправить сообщение. Проверьте соединение.');
    } finally {
      preview.sending = false;
      controls.forEach(node => { node.disabled = false; });
      if (captionInput) captionInput.readOnly = false;
      if (btn?.isConnected) btn.textContent = '➤';
      if (operation.signal.aborted && !preview.committed) await deleteUploadedPendingMedia(items, roomId, deviceId);
      contexts.finishOperation(operation, status);
      preview.operation = null;
    }
  }

  sendMediaFromPreview = function sendMediaFromPreview170(root) {
    const preview = mediaPreviewState;
    if (!preview || preview.sending || preview.cancelled || preview.committed) return;
    const context = currentContext();
    if (!context || preview.roomId && preview.roomId !== context.roomId) return;
    if (!context.key || !STORAGE.get(STORAGE.roomState(context.roomId))?.deviceId) return;
    preview.roomId = context.roomId;
    preview.sending = true;
    preview.operation = contexts.beginOperation(context.roomId, 'media-send');
    preview.task = send(preview, context, root, preview.operation);
    return preview.task;
  };
  sendMediaFromPreview.__fp170 = true;
  sendMediaFromPreview.__fpLegacy = legacySendMediaFromPreview;
  window.FPMediaSend170 = Object.freeze({active:true, cancelPreview});
  window.dispatchEvent(new Event('fpchat:send-owners-ready174'));
  try { window.FPRuntime?.registerOwner?.('media-send170', {role:'media-submit',mode:'active-owner',transport:'FPNetwork171.upload + stable WS'}); } catch {}
})();
