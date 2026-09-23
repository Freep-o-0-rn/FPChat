'use strict';

function createHistoryRead179({ db, listMessagesLatest, listMessagesBefore } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new Error('history read db transaction dependency is missing');
  if (!listMessagesLatest || typeof listMessagesLatest.all !== 'function') throw new Error('history latest statement dependency is missing');
  if (!listMessagesBefore || typeof listMessagesBefore.all !== 'function') throw new Error('history before statement dependency is missing');

  const readPageTx = db.transaction((roomId, beforeCursor, safeLimit, serializeMessages) => {
    const rows = beforeCursor === null
      ? listMessagesLatest.all(roomId, safeLimit + 1)
      : listMessagesBefore.all(roomId, beforeCursor, safeLimit + 1);
    const hasMore = rows.length > safeLimit;
    const pageRows = rows.slice(0, safeLimit).reverse();
    const messages = serializeMessages(pageRows);
    return { messages, hasMore, nextCursor: messages.length ? Number(messages[0].id) : null };
  });

  return Object.freeze({
    readPage({ roomId, beforeCursor = null, safeLimit, serializeMessages } = {}) {
      if (typeof serializeMessages !== 'function') throw new Error('history serialize dependency is missing');
      return readPageTx(roomId, beforeCursor, safeLimit, serializeMessages);
    }
  });
}

module.exports = { createHistoryRead179 };
