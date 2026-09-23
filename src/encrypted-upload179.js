'use strict';

function createEncryptedUpload179({ mediaKind, persist, cleanup = null } = {}) {
  const kind = String(mediaKind || '').trim();
  if (!kind) throw new Error('encrypted upload mediaKind is required');
  if (typeof persist !== 'function') throw new Error('encrypted upload persist delegate is required');
  if (cleanup !== null && typeof cleanup !== 'function') throw new Error('encrypted upload cleanup delegate must be a function');

  return Object.freeze({
    mediaKind: kind,
    handles(input) {
      return String(input?.mediaKind || '') === kind;
    },
    save(input) {
      return persist(input);
    },
    cleanup(input) {
      if (!cleanup) throw new Error('encrypted upload cleanup delegate is unavailable');
      return cleanup(input?.media);
    }
  });
}

module.exports = { createEncryptedUpload179 };
