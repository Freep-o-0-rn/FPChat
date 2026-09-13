/* Build 120: isolated encrypted voice-message upload endpoint. */
function installVoiceServer({ app, q, upload, UPLOAD_DIR, fs, path, randomToken, safeUnlink, isRoomOpen }) {
  if (!app || !q || !upload || !UPLOAD_DIR || !fs || !path || !randomToken) {
    throw new Error('voice server dependencies are missing');
  }
  if (app.__fpVoiceInstalled) return;
  app.__fpVoiceInstalled = true;

  const MAX_VOICE_BYTES = 25 * 1024 * 1024;
  const MIN_DURATION_SECONDS = 0.65;
  const MAX_DURATION_SECONDS = 600.5;

  function safeDevice(value) {
    return String(value || '').trim().slice(0, 64);
  }

  function safeAudioMime(value) {
    const mime = String(value || '').trim().toLowerCase().slice(0, 128);
    if (!mime) return '';
    const base = mime.split(';')[0].trim();
    const allowed = new Set([
      'audio/webm',
      'audio/ogg',
      'audio/mp4',
      'audio/mpeg',
      'audio/aac',
      'audio/x-m4a',
      'audio/wav'
    ]);
    return allowed.has(base) ? mime : '';
  }

  app.post('/api/rooms/:publicId/voice/upload', upload.single('encryptedFile'), (req, res) => {
    const room = q.findRoomByPublicId.get(String(req.params.publicId || ''));
    if (!room) return res.status(404).json({ ok: false, error: 'room not found' });

    const deviceId = safeDevice(req.body?.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, error: 'deviceId required' });
    const participant = q.findParticipant.get(room.id, deviceId);
    if (!participant) return res.status(403).json({ ok: false, error: 'forbidden' });
    if (!isRoomOpen?.(room)) return res.status(409).json({ ok: false, error: 'room closed', code: 'ROOM_CLOSED' });

    const encryptedFile = req.file;
    if (!encryptedFile?.buffer?.length) return res.status(400).json({ ok: false, error: 'encryptedFile required' });
    if (encryptedFile.size > MAX_VOICE_BYTES) return res.status(413).json({ ok: false, error: 'voice too large' });

    const mimeType = safeAudioMime(req.body?.mimeType);
    if (!mimeType) return res.status(400).json({ ok: false, error: 'audio mime not allowed' });

    const durationSeconds = Number(req.body?.durationSeconds || 0);
    if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_DURATION_SECONDS || durationSeconds > MAX_DURATION_SECONDS) {
      return res.status(400).json({ ok: false, error: 'invalid voice duration' });
    }

    const sizeBytes = Math.max(0, Number(req.body?.sizeBytes || 0) || 0);
    if (sizeBytes > MAX_VOICE_BYTES) return res.status(413).json({ ok: false, error: 'voice too large' });

    const publicId = randomToken(24);
    const serverFilename = `voice_${publicId}.bin`;
    const filePath = path.join(UPLOAD_DIR, serverFilename);

    try {
      fs.writeFileSync(filePath, encryptedFile.buffer);
      q.createMedia.run(
        publicId,
        room.id,
        0,
        serverFilename,
        null,
        null,
        null,
        mimeType,
        'audio',
        sizeBytes,
        Number(req.body?.encryptedSizeBytes || encryptedFile.size) || encryptedFile.size,
        null,
        null,
        null,
        null,
        durationSeconds
      );
      const media = q.findMediaByPublicId.get(publicId);
      if (!media) throw new Error('voice media was not saved');
      return res.json({
        ok: true,
        media: {
          id: Number(media.id),
          public_id: media.public_id,
          mime_type: media.mime_type,
          media_kind: media.media_kind,
          size_bytes: Number(media.size_bytes || 0),
          encrypted_size_bytes: Number(media.encrypted_size_bytes || 0),
          duration_seconds: Number(media.duration_seconds || durationSeconds),
          file_order: Number(media.file_order || 0)
        }
      });
    } catch (error) {
      try { safeUnlink?.(serverFilename); } catch {}
      return res.status(500).json({ ok: false, error: 'voice upload failed' });
    }
  });
}

module.exports = { installVoiceServer };
