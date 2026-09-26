const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const picker = read('public/reaction-picker188.js');
const interaction = read('public/reaction-interaction188.js');
const index = read('public/index.html');
const catalog = JSON.parse(read('public/reactions-catalog188.json'));

new Function(picker);
new Function(interaction);

assert(picker.includes("parentOwner: 'FPReactionInteractionManager188'"), 'picker is not a worker under ReactionInteractionManager');
assert(picker.includes("layer: 'existing message-context only'"), 'picker introduced a separate UI layer');
assert(picker.includes("transport: false"), 'picker unexpectedly owns transport');
assert(picker.includes("gestures: false"), 'picker unexpectedly owns gestures');
assert(picker.includes("persistentState: false"), 'picker unexpectedly owns persistent state');

assert(!picker.includes('fetch('), 'picker performs network I/O');
assert(!picker.includes('new WebSocket'), 'picker creates a WebSocket');
assert(!picker.includes('localStorage'), 'picker uses localStorage');
assert(!picker.includes('indexedDB'), 'picker uses IndexedDB');
assert(!picker.includes('MutationObserver'), 'picker introduced a MutationObserver');
assert(!picker.includes('IntersectionObserver'), 'picker introduced an IntersectionObserver');
assert(!picker.includes('setInterval('), 'picker introduced polling');
assert(!picker.includes('setTimeout('), 'picker introduced timers');
assert(!picker.includes('scrollTop ='), 'picker writes outer scroll');
assert(!picker.includes('scrollTo('), 'picker writes scroll');

assert(picker.includes('if (next && !state.rendered) render(state);'), 'full catalog is not lazy-rendered on first open');
assert(picker.includes('state.panel.hidden = !next;'), 'picker open/close state is not bounded to its panel');
assert(picker.includes("toggle.setAttribute('aria-expanded'"), 'picker toggle accessibility state missing');
assert(picker.includes("button.dataset.reactionId = String(reaction.id || '')"), 'picker items are not keyed by catalog reaction id');
assert(picker.includes("button.setAttribute('aria-pressed', selected ? 'true' : 'false')"), 'picker does not show own-reaction state');
assert(picker.includes('groupedCatalog(state.catalog)'), 'picker does not render from supplied catalog');
assert(picker.includes('item.enabled !== false'), 'disabled catalog reactions are not filtered');
assert(picker.includes("strip.insertAdjacentElement('afterend', panel)"), 'picker is not attached inside the existing message-context cluster');

assert(interaction.includes('manager.getQuickReactions()'), 'quick catalog source changed');
assert(interaction.includes('manager.getAvailableReactions()'), 'full catalog does not use ReactionManager catalog');
assert(interaction.includes('picker?.attach'), 'interaction owner does not attach full picker');
assert(interaction.includes('window.FPReactionPicker188?.syncSelection?.(strip, mine);'), 'picker selection does not follow authoritative/optimistic reaction changes');
assert(interaction.includes('void toggle(info,'), 'picker selection bypasses shared reaction mutation path');
assert(interaction.includes('closeContext?.();'), 'reaction selection no longer closes message context');

assert(index.includes('reaction-picker188.js'), 'picker asset missing from known boot assets');
assert(index.includes('renderer.onload = loadReactionPicker188;'), 'picker is not ordered after renderer');
assert(index.includes('picker.onload = loadReactionInteraction188;'), 'interaction owner is not ordered after picker');
assert(index.includes('picker.onerror = loadReactionInteraction188;'), 'quick reactions are not preserved if optional picker fails');

assert(Number.isSafeInteger(catalog.version) && catalog.version > 0, 'catalog version invalid');
assert(Number.isSafeInteger(catalog.quickLimit) && catalog.quickLimit > 0, 'catalog quickLimit invalid');
assert(Array.isArray(catalog.reactions), 'catalog reactions missing');
const enabled = catalog.reactions.filter((item) => item?.enabled !== false);
const quick = enabled.filter((item) => Number.isSafeInteger(Number(item.quickOrder)));
assert.equal(quick.length, catalog.quickLimit, 'quick reaction slots do not match quickLimit');
assert(enabled.length > quick.length, 'full catalog does not contain reactions beyond quick strip');
assert.equal(new Set(catalog.reactions.map((item) => item.id)).size, catalog.reactions.length, 'reaction catalog ids are duplicated');
assert(enabled.every((item) => typeof item.category === 'string' && item.category.length > 0), 'enabled reaction lacks category metadata');
assert.deepEqual(
  quick.sort((a,b)=>Number(a.quickOrder)-Number(b.quickOrder)).map((item)=>item.value),
  ['😂','❤️','👍','👎','🔥','🥰','👏'],
  'accepted quick reaction order changed'
);

console.log('Build 188.5 full reaction picker regression: PASS');
