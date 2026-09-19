/* Build 172: canonical per-room message state and reply dependency graph.
   This layer does not persist outbound queues and does not change server APIs. */
(() => {
  if (window.FPMessageStore172) return;

  const STATUS_RANK = Object.freeze({ sending: 0, sent: 1, delivered: 2, read: 3 });
  const SOURCE_PRIORITY = Object.freeze({
    legacy: 5,
    optimistic: 10,
    render: 20,
    history: 20,
    sync: 30,
    ws: 40,
    edit: 60,
    delete: 100
  });
  const MAX_ROOMS = 40;
  const MAX_MESSAGES_PER_ROOM = 10000;

  const rooms = new Map();
  let sequence = 0;
  let compatibilityClears = 0;

  function normalizeRoomId(value) {
    return String(value || '').trim();
  }

  function numericId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function clientIdOf(message) {
    const value = String(message?.client_message_id || message?.clientMessageId || '').trim();
    if (value) return value;
    const rawId = message?.id;
    return numericId(rawId) ? '' : String(rawId || '').trim();
  }

  function statusOf(value) {
    const status = String(value || 'sent');
    return Object.prototype.hasOwnProperty.call(STATUS_RANK, status) ? status : 'sent';
  }

  function strongerStatus(a, b) {
    const left = statusOf(a);
    const right = statusOf(b);
    return STATUS_RANK[right] > STATUS_RANK[left] ? right : left;
  }

  function timeValue(value) {
    if (!value) return 0;
    const date = new Date(value);
    const ms = date.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  function sourcePriority(source) {
    return SOURCE_PRIORITY[String(source || '')] || SOURCE_PRIORITY.legacy;
  }

  function keyForId(id) {
    const value = numericId(id);
    return value ? `id:${value}` : '';
  }

  function keyForClient(clientMessageId) {
    const value = String(clientMessageId || '').trim();
    return value ? `client:${value}` : '';
  }

  function createRoom(roomId) {
    return {
      roomId,
      messages: new Map(),
      clientToKey: new Map(),
      replyDependents: new Map(),
      touchedAt: Date.now(),
      version: 0
    };
  }

  function roomFor(roomId, create = true) {
    const id = normalizeRoomId(roomId);
    if (!id) return null;
    let room = rooms.get(id);
    if (!room && create) {
      room = createRoom(id);
      rooms.set(id, room);
      pruneRooms();
    }
    if (room) room.touchedAt = Date.now();
    return room || null;
  }

  function pruneRooms() {
    if (rooms.size <= MAX_ROOMS) return;
    const ordered = [...rooms.values()].sort((a, b) => a.touchedAt - b.touchedAt);
    for (const room of ordered) {
      if (rooms.size <= MAX_ROOMS) break;
      rooms.delete(room.roomId);
    }
  }

  function identity(record) {
    return record?.id || record?.clientMessageId || '';
  }

  function recordByAny(room, idOrClient) {
    if (!room) return null;
    const id = numericId(idOrClient);
    if (id) return room.messages.get(keyForId(id)) || null;
    const client = String(idOrClient || '').trim();
    if (!client) return null;
    const mapped = room.clientToKey.get(client);
    return (mapped && room.messages.get(mapped)) || room.messages.get(keyForClient(client)) || null;
  }

  function removeDependency(room, sourceId, dependent) {
    const id = numericId(sourceId);
    if (!id || !dependent) return;
    const set = room.replyDependents.get(id);
    if (!set) return;
    set.delete(String(dependent));
    if (!set.size) room.replyDependents.delete(id);
  }

  function addDependency(room, sourceId, dependent) {
    const id = numericId(sourceId);
    if (!id || !dependent) return;
    let set = room.replyDependents.get(id);
    if (!set) {
      set = new Set();
      room.replyDependents.set(id, set);
    }
    set.add(String(dependent));
  }

  function updateReplyDependency(room, record, nextReplyId) {
    const previous = numericId(record.replyToMessageId);
    const next = numericId(nextReplyId);
    const dependent = identity(record);
    if (previous && previous !== next) removeDependency(room, previous, dependent);
    record.replyToMessageId = next;
    if (next) addDependency(room, next, dependent);
  }

  function moveRecord(room, fromKey, toKey, record) {
    if (!fromKey || !toKey || fromKey === toKey) return record;
    const previousIdentity = fromKey.replace(/^(?:id|client):/, '');
    removeDependency(room, record.replyToMessageId, previousIdentity);
    const collision = room.messages.get(toKey);
    if (collision && collision !== record) {
      // The numeric server identity wins. Merge the useful transient fields from
      // the optimistic record without weakening canonical state.
      if (!collision.clientMessageId && record.clientMessageId) collision.clientMessageId = record.clientMessageId;
      collision.status = strongerStatus(collision.status, record.status);
      if (!collision.deleted && !collision.contentClock) {
        if (!collision.text && record.text) collision.text = record.text;
        if (!collision.preview && record.preview) collision.preview = record.preview;
        if (!collision.raw && record.raw) collision.raw = record.raw;
      }
      if (!collision.author && record.author) collision.author = record.author;
      room.messages.delete(fromKey);
      if (record.clientMessageId) room.clientToKey.set(record.clientMessageId, toKey);
      addDependency(room, collision.replyToMessageId, identity(collision));
      return collision;
    }
    room.messages.delete(fromKey);
    room.messages.set(toKey, record);
    if (record.clientMessageId) room.clientToKey.set(record.clientMessageId, toKey);
    addDependency(room, record.replyToMessageId, toKey.replace(/^(?:id|client):/, ''));
    return record;
  }

  function canonicalRecord(room, message) {
    const serverId = numericId(message?.id);
    const clientMessageId = clientIdOf(message);
    const serverKey = keyForId(serverId);
    const clientKey = clientMessageId ? (room.clientToKey.get(clientMessageId) || keyForClient(clientMessageId)) : '';

    let record = serverKey ? room.messages.get(serverKey) : null;
    if (record && clientKey && clientKey !== serverKey) {
      const optimistic = room.messages.get(clientKey);
      if (optimistic && optimistic !== record) record = moveRecord(room, clientKey, serverKey, optimistic);
    }
    if (!record && clientKey) record = room.messages.get(clientKey) || null;

    if (!record) {
      record = {
        id: serverId,
        clientMessageId: clientMessageId || '',
        raw: null,
        author: '',
        text: '',
        preview: '',
        kind: String(message?.type || 'text'),
        status: statusOf(message?.status || (serverId ? 'sent' : 'sending')),
        createdAt: message?.created_at || null,
        editedAt: null,
        editedAtMs: 0,
        contentClock: 0,
        contentPriority: 0,
        replyToMessageId: null,
        deleted: false,
        deletedForAll: false,
        hiddenSelf: false,
        version: 0,
        lastSource: 'unknown',
        touchedAt: Date.now()
      };
      const key = serverKey || keyForClient(clientMessageId || `anonymous-${++sequence}`);
      room.messages.set(key, record);
    } else if (serverKey) {
      const currentKey = [...room.messages.entries()].find(([, value]) => value === record)?.[0] || '';
      if (currentKey && currentKey !== serverKey) record = moveRecord(room, currentKey, serverKey, record);
    }

    if (serverId) record.id = serverId;
    if (clientMessageId) {
      record.clientMessageId = clientMessageId;
      room.clientToKey.set(clientMessageId, serverKey || [...room.messages.entries()].find(([, value]) => value === record)?.[0] || keyForClient(clientMessageId));
    }
    return record;
  }

  function dependentIds(room, sourceId) {
    const set = room?.replyDependents.get(numericId(sourceId));
    return set ? [...set] : [];
  }

  function emit(room, record, reason, extra = {}) {
    room.version += 1;
    record.version += 1;
    record.touchedAt = Date.now();
    room.touchedAt = record.touchedAt;
    const messageId = numericId(record.id);
    try {
      window.dispatchEvent(new CustomEvent('fpchat:message-store172-changed', {
        detail: {
          roomId: room.roomId,
          messageId,
          clientMessageId: record.clientMessageId || null,
          reason,
          dependentMessageIds: messageId ? dependentIds(room, messageId) : [],
          version: record.version,
          roomVersion: room.version,
          ...extra
        }
      }));
    } catch {}
  }

  function pruneRoom(room) {
    if (!room || room.messages.size <= MAX_MESSAGES_PER_ROOM) return;
    const referenced = new Set();
    for (const values of room.replyDependents.values()) {
      for (const value of values) referenced.add(String(value));
    }
    const entries = [...room.messages.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt);
    for (const [key, record] of entries) {
      if (room.messages.size <= MAX_MESSAGES_PER_ROOM) break;
      if (referenced.has(String(identity(record)))) continue;
      if (record.clientMessageId && !record.id) continue; // keep optimistic sends until ack/reload
      room.messages.delete(key);
      if (record.clientMessageId) room.clientToKey.delete(record.clientMessageId);
      removeDependency(room, record.replyToMessageId, identity(record));
    }
  }

  function previewFromText(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) return '';
    return value.length > 80 ? value.slice(0, 80).trimEnd() + '…' : value;
  }

  function upsert(roomId, message, options = {}) {
    const room = roomFor(roomId);
    if (!room || !message) return { applied: false, contentApplied: false, record: null, reason: 'invalid' };

    const record = canonicalRecord(room, message);
    const source = String(options.source || 'sync');
    const priority = sourcePriority(source);
    const incomingEditedAt = message.edited_at || options.editedAt || null;
    const incomingEditMs = timeValue(incomingEditedAt);
    const incomingCreatedMs = timeValue(message.created_at || record.createdAt);
    const incomingClock = incomingEditMs || incomingCreatedMs || ++sequence;
    const existingClock = Number(record.contentClock || 0);
    const existingPriority = Number(record.contentPriority || 0);

    const incomingDeleted = message.deleted_for_all === true || options.deletedForAll === true;
    if (incomingDeleted) {
      markDeleted(roomId, message.id || record.id, {
        scope: 'all',
        author: options.author || message.sender_name || record.author,
        source
      });
      return { applied: true, contentApplied: false, record: recordByAny(room, message.id || record.id), reason: 'deleted' };
    }

    const contentAllowed = !record.deleted && (
      !existingClock
      || incomingClock > existingClock
      || (incomingClock === existingClock && priority >= existingPriority)
    );

    let changed = false;
    let contentApplied = false;

    const nextStatus = strongerStatus(record.status, message.status || options.status || record.status);
    if (nextStatus !== record.status) {
      record.status = nextStatus;
      changed = true;
    }

    if (message.created_at && !record.createdAt) {
      record.createdAt = message.created_at;
      changed = true;
    }

    if (contentAllowed) {
      const nextText = options.text !== undefined ? String(options.text ?? '') : record.text;
      const nextPreview = options.preview !== undefined
        ? String(options.preview ?? '')
        : (nextText ? previewFromText(nextText) : record.preview);
      const nextAuthor = String(options.author || message.sender_name || record.author || '');
      const nextKind = String(options.kind || message.type || record.kind || 'text');
      const nextRaw = { ...(record.raw || {}), ...message };

      if (record.text !== nextText || record.preview !== nextPreview || record.author !== nextAuthor || record.kind !== nextKind) {
        record.text = nextText;
        record.preview = nextPreview;
        record.author = nextAuthor;
        record.kind = nextKind;
        changed = true;
      }
      record.raw = nextRaw;
      record.contentClock = incomingClock;
      record.contentPriority = priority;
      record.lastSource = source;
      if (incomingEditedAt) {
        record.editedAt = incomingEditedAt;
        record.editedAtMs = incomingEditMs;
      }
      updateReplyDependency(room, record, message.reply_to_message_id ?? options.replyToMessageId ?? record.replyToMessageId);
      contentApplied = true;
    } else if (message.reply_to_message_id && !record.replyToMessageId) {
      updateReplyDependency(room, record, message.reply_to_message_id);
      changed = true;
    }

    if (record.clientMessageId) {
      const key = record.id ? keyForId(record.id) : keyForClient(record.clientMessageId);
      room.clientToKey.set(record.clientMessageId, key);
    }

    if (changed) emit(room, record, contentApplied ? 'upsert' : 'status');
    pruneRoom(room);
    return {
      applied: changed,
      contentApplied,
      record,
      reason: contentApplied ? 'merged' : (record.deleted ? 'deleted' : 'stale-content')
    };
  }

  function setPreviewMeta(roomId, idOrClient, value = {}) {
    const room = roomFor(roomId);
    if (!room) return null;
    let record = recordByAny(room, idOrClient);
    if (!record) {
      const id = numericId(idOrClient);
      record = canonicalRecord(room, {
        id: id || idOrClient,
        client_message_id: id ? '' : String(idOrClient || ''),
        status: 'sent',
        type: value.kind || 'text'
      });
    }
    if (!record || record.deleted) return record;

    const isEnrichment = value.kind === 'voice' || value.kind === 'system';
    const canFill = !record.contentPriority || record.contentPriority <= SOURCE_PRIORITY.legacy;
    let changed = false;
    if ((canFill || isEnrichment) && value.author !== undefined && String(value.author || '') !== record.author) {
      record.author = String(value.author || '');
      changed = true;
    }
    if ((canFill || isEnrichment) && value.text !== undefined && String(value.text ?? '') !== record.text) {
      record.text = String(value.text ?? '');
      changed = true;
    }
    if ((canFill || isEnrichment) && value.preview !== undefined && String(value.preview ?? '') !== record.preview) {
      record.preview = String(value.preview ?? '');
      changed = true;
    }
    if ((canFill || isEnrichment) && value.kind && String(value.kind) !== record.kind) {
      record.kind = String(value.kind);
      changed = true;
    }
    if (changed) {
      record.lastSource = 'legacy-adapter';
      emit(room, record, 'preview-meta');
    }
    return record;
  }

  function markDeleted(roomId, idOrClient, { scope = 'all', author = '', source = 'delete' } = {}) {
    const room = roomFor(roomId);
    if (!room) return null;
    let record = recordByAny(room, idOrClient);
    if (!record) {
      const id = numericId(idOrClient);
      record = canonicalRecord(room, {
        id: id || idOrClient,
        client_message_id: id ? '' : String(idOrClient || ''),
        status: 'sent',
        type: 'deleted'
      });
    }
    if (!record) return null;

    const wasDeleted = record.deleted;
    record.deleted = true;
    record.deletedForAll = record.deletedForAll || scope === 'all';
    record.hiddenSelf = record.hiddenSelf || scope === 'self';
    record.kind = 'deleted';
    record.text = '';
    record.raw = null;
    record.preview = 'Сообщение удалено';
    if (author && !record.author) record.author = String(author);
    record.contentPriority = SOURCE_PRIORITY.delete;
    record.contentClock = Math.max(Number(record.contentClock || 0), Date.now());
    record.lastSource = String(source || 'delete');
    if (!wasDeleted || scope === 'all') emit(room, record, 'deleted', { scope: scope === 'self' ? 'self' : 'all' });
    return record;
  }

  function applyEdit(roomId, message, text, options = {}) {
    return upsert(roomId, message, {
      ...options,
      source: 'edit',
      text,
      preview: options.preview !== undefined ? options.preview : previewFromText(text),
      kind: options.kind || message?.type || 'text',
      editedAt: message?.edited_at || options.editedAt || new Date().toISOString()
    });
  }

  function updateStatus(roomId, messageId, status, clientMessageId = null) {
    const room = roomFor(roomId);
    if (!room) return null;
    let record = recordByAny(room, messageId) || recordByAny(room, clientMessageId);
    if (!record) {
      record = canonicalRecord(room, {
        id: numericId(messageId) || clientMessageId,
        client_message_id: clientMessageId || '',
        status
      });
    }
    if (!record) return null;
    const next = strongerStatus(record.status, status);
    if (next !== record.status) {
      record.status = next;
      emit(room, record, 'status');
    }
    return record;
  }

  function promote(roomId, clientMessageId, messageId, patch = {}) {
    const room = roomFor(roomId);
    if (!room) return null;
    const client = String(clientMessageId || '').trim();
    const id = numericId(messageId);
    let record = recordByAny(room, client) || recordByAny(room, id);
    if (!record) {
      record = canonicalRecord(room, {
        id: id || client,
        client_message_id: client,
        status: patch.status || 'sent',
        created_at: patch.createdAt || null
      });
    }
    if (!record) return null;

    if (id) {
      const oldKey = [...room.messages.entries()].find(([, value]) => value === record)?.[0] || '';
      record.id = id;
      record = moveRecord(room, oldKey, keyForId(id), record);
    }
    if (client) {
      record.clientMessageId = client;
      room.clientToKey.set(client, id ? keyForId(id) : keyForClient(client));
    }
    if (patch.createdAt && !record.createdAt) record.createdAt = patch.createdAt;
    record.status = strongerStatus(record.status, patch.status || record.status);
    emit(room, record, 'promoted');
    return record;
  }

  function resolveReply(roomId, messageId) {
    const id = numericId(messageId);
    const room = roomFor(roomId, false);
    const record = id && room ? recordByAny(room, id) : null;
    if (!record) {
      return {
        messageId: id || Number(messageId),
        author: 'Неизвестно',
        preview: 'Сообщение недоступно',
        kind: 'text',
        state: 'missing'
      };
    }
    if (record.deleted) {
      return {
        messageId: id || record.id,
        author: record.author || 'Неизвестно',
        preview: 'Сообщение удалено',
        kind: 'deleted',
        state: 'deleted'
      };
    }
    return {
      messageId: id || record.id,
      author: record.author || 'Неизвестно',
      preview: record.preview || previewFromText(record.text) || 'Сообщение недоступно',
      kind: record.kind || 'text',
      state: record.preview || record.text ? 'loaded' : 'loading'
    };
  }

  function dependents(roomId, sourceMessageId) {
    const room = roomFor(roomId, false);
    return room ? dependentIds(room, sourceMessageId) : [];
  }

  function get(roomId, idOrClient) {
    const room = roomFor(roomId, false);
    return room ? recordByAny(room, idOrClient) : null;
  }

  function roomSnapshot(roomId) {
    const room = roomFor(roomId, false);
    if (!room) return { messages: 0, deleted: 0, optimistic: 0, replySources: 0, version: 0 };
    let deleted = 0;
    let optimistic = 0;
    for (const record of room.messages.values()) {
      if (record.deleted) deleted += 1;
      if (!record.id && record.clientMessageId) optimistic += 1;
    }
    return {
      messages: room.messages.size,
      deleted,
      optimistic,
      replySources: room.replyDependents.size,
      version: room.version
    };
  }

  function snapshot() {
    return {
      owner: 'FPMessageStore172',
      rooms: rooms.size,
      messages: [...rooms.values()].reduce((sum, room) => sum + room.messages.size, 0),
      compatibilityClears,
      limits: { rooms: MAX_ROOMS, messagesPerRoom: MAX_MESSAGES_PER_ROOM },
      roomStats: [...rooms.values()].map((room) => roomSnapshot(room.roomId))
    };
  }

  function legacyCacheAdapter(roomResolver) {
    const currentRoom = () => normalizeRoomId(typeof roomResolver === 'function' ? roomResolver() : roomResolver);
    const adapter = {
      get(key) {
        const roomId = currentRoom();
        const record = get(roomId, key);
        if (!record) return undefined;
        return {
          id: numericId(record.id) || Number(key),
          author: record.author || 'Неизвестно',
          text: record.text || '',
          preview: record.deleted ? 'Сообщение удалено' : (record.preview || previewFromText(record.text)),
          kind: record.deleted ? 'deleted' : (record.kind || 'text'),
          deleted: Boolean(record.deleted)
        };
      },
      set(key, value = {}) {
        const roomId = currentRoom();
        if (!roomId) return adapter;
        if (value?.deleted || value?.kind === 'deleted') {
          markDeleted(roomId, key, { scope: 'all', author: value?.author || '', source: 'legacy-adapter' });
        } else {
          setPreviewMeta(roomId, key, value);
        }
        return adapter;
      },
      has(key) {
        return Boolean(get(currentRoom(), key));
      },
      delete() {
        // Canonical state is not deleted by compatibility callers.
        return false;
      },
      clear() {
        // Legacy renderChatView historically cleared a single global Map. The
        // adapter is room-scoped, so clearing it would destroy newer edits/tombstones.
        compatibilityClears += 1;
      },
      entries() {
        const room = roomFor(currentRoom(), false);
        const values = room ? [...room.messages.values()] : [];
        return values.map((record) => [record.id || record.clientMessageId, adapter.get(record.id || record.clientMessageId)])[Symbol.iterator]();
      },
      values() {
        return [...adapter.entries()].map((entry) => entry[1])[Symbol.iterator]();
      },
      keys() {
        return [...adapter.entries()].map((entry) => entry[0])[Symbol.iterator]();
      },
      [Symbol.iterator]() {
        return adapter.entries();
      }
    };
    Object.defineProperty(adapter, 'size', {
      enumerable: true,
      get() {
        return roomFor(currentRoom(), false)?.messages.size || 0;
      }
    });
    return adapter;
  }

  window.FPMessageStore172 = Object.freeze({
    upsert,
    applyEdit,
    markDeleted,
    updateStatus,
    promote,
    get,
    resolveReply,
    dependents,
    roomSnapshot,
    snapshot,
    legacyCacheAdapter
  });

  function registerRuntimeOwner() {
    try {
      window.FPRuntime?.registerOwner?.('message-store172', {
        role: 'canonical-message-state',
        mode: 'active-owner',
        publicOwner: 'FPMessageStore172'
      });
    } catch {}
  }

  registerRuntimeOwner();
  window.addEventListener?.('fpchat:boot-ready', registerRuntimeOwner, { once: true, passive: true });

  try {
    window.dispatchEvent(new CustomEvent('fpchat:message-store172-ready', { detail: snapshot() }));
  } catch {}
})();
