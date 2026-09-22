'use strict';

function createEncryptedUpload179({ mediaKind, persist } = {}) {
  const kind = String(mediaKind || '').trim();
  if (!kind) throw new Error('encrypted upload mediaKind is required');
  if (typeof persist !== 'function') throw new Error('encrypted upload persist delegate is required');

  return Object.freeze({
    mediaKind: kind,
    handles(input) {
      return String(input?.mediaKind || '') === kind;
    },
    save(input) {
      return persist(input);
    }
  });
}

module.exports = { createEncryptedUpload179 };
