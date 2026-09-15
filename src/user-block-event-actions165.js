/* Build 165: minimal pair-status endpoint for personal system-chat actions. */
function safeDeviceId(value) {
  const text = String(value || '').trim();
  if (text.length < 8 || text.length > 128) return '';
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : '';
}

function installUserBlockEventActions165({ app, userBlocks }) {
  if (!app || !userBlocks?.relationship) throw new Error('user block event action dependencies are missing');
  if (app.__fpUserBlockEventActions165Installed) return;
  app.__fpUserBlockEventActions165Installed = true;

  app.get('/api/user-blocks/pair-status', (req, res) => {
    const viewer = safeDeviceId(req.query?.deviceId);
    const target = safeDeviceId(req.query?.targetDeviceId);
    if (!viewer || !target || viewer === target) {
      return res.status(400).json({ ok: false, code: 'USER_BLOCK_PAIR_FIELDS_REQUIRED' });
    }
    const own = userBlocks.relationship(viewer, target).blockedByMe;
    return res.json({
      ok: true,
      blockedByMe: Boolean(own),
      blockId: own?.public_id || null
    });
  });
}

module.exports = { installUserBlockEventActions165 };
