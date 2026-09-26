/* Build 188.1: single versioned reaction catalog shared by server and browser. */
const rawCatalog = require('../public/reactions-catalog188.json');

const REACTION_ID_RE = /^[a-z0-9_]{1,48}$/;

function normalizeCatalog(input) {
  const version = Number(input?.version);
  const maxPerParticipantPerMessage = Number(input?.maxPerParticipantPerMessage);
  const quickLimit = Number(input?.quickLimit);
  if (!Number.isSafeInteger(version) || version <= 0) throw new Error('reaction catalog version is invalid');
  if (!Number.isSafeInteger(maxPerParticipantPerMessage) || maxPerParticipantPerMessage < 1 || maxPerParticipantPerMessage > 20) {
    throw new Error('reaction catalog maxPerParticipantPerMessage is invalid');
  }
  if (!Number.isSafeInteger(quickLimit) || quickLimit < 1 || quickLimit > 20) throw new Error('reaction catalog quickLimit is invalid');
  if (!Array.isArray(input?.reactions) || !input.reactions.length) throw new Error('reaction catalog is empty');

  const ids = new Set();
  const reactions = input.reactions.map((item, index) => {
    const id = String(item?.id || '').trim();
    const type = String(item?.type || '').trim();
    const value = String(item?.value || '').trim();
    const category = String(item?.category || 'other').trim().slice(0, 32) || 'other';
    const enabled = item?.enabled !== false;
    const quickOrder = item?.quickOrder == null ? null : Number(item.quickOrder);
    if (!REACTION_ID_RE.test(id) || ids.has(id)) throw new Error(`reaction catalog id is invalid or duplicated at index ${index}`);
    if (type !== 'emoji' && type !== 'custom') throw new Error(`reaction ${id} type is invalid`);
    if (!value || value.length > 96) throw new Error(`reaction ${id} value is invalid`);
    if (quickOrder != null && (!Number.isSafeInteger(quickOrder) || quickOrder < 1 || quickOrder > quickLimit)) {
      throw new Error(`reaction ${id} quickOrder is invalid`);
    }
    ids.add(id);
    return Object.freeze({ id, type, value, category, enabled, quickOrder });
  });

  const quick = reactions.filter((item) => item.quickOrder != null).sort((a, b) => a.quickOrder - b.quickOrder || a.id.localeCompare(b.id));
  const quickOrders = new Set(quick.map((item) => item.quickOrder));
  if (quick.length !== quickLimit || quickOrders.size !== quickLimit) throw new Error('reaction quick catalog must fill every quick slot exactly once');

  const byId = new Map(reactions.map((item) => [item.id, item]));
  return Object.freeze({
    version,
    maxPerParticipantPerMessage,
    quickLimit,
    reactions: Object.freeze(reactions),
    quick: Object.freeze(quick),
    byId
  });
}

const catalog = normalizeCatalog(rawCatalog);

function reactionById(value) {
  return catalog.byId.get(String(value || '').trim()) || null;
}

function isReactionEnabled(value) {
  return reactionById(value)?.enabled === true;
}

function publicCatalog() {
  return {
    version: catalog.version,
    maxPerParticipantPerMessage: catalog.maxPerParticipantPerMessage,
    quickLimit: catalog.quickLimit,
    reactions: catalog.reactions.map((item) => ({
      id: item.id,
      type: item.type,
      value: item.value,
      category: item.category,
      enabled: item.enabled,
      ...(item.quickOrder != null ? { quickOrder: item.quickOrder } : {})
    }))
  };
}

module.exports = {
  REACTION_ID_RE,
  catalog,
  reactionById,
  isReactionEnabled,
  publicCatalog,
  normalizeCatalog
};
