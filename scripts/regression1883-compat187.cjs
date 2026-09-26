const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

function fnv1a(text) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const stable187 = Object.freeze({
  'public/gesture-manager135.js': '9f734783',
  'public/layer-manager173.js': '4924241b',
  'public/network171.js': '0ec10078',
  'public/message-store172.js': '19496bd3',
  'public/connection170.js': '6dd51ca3',
  'public/dom-lifecycle173.js': '82120fa6',
  'public/room-context170.js': 'dc664849',
  'public/work174.js': '37b1ab50',
  'public/send-manager177.js': 'b69a873e',
  'public/text-send170.js': 'd78b9bc2',
  'public/media-send170.js': '818bab06'
});

for (const [file, expected] of Object.entries(stable187)) {
  assert.equal(fnv1a(read(file)), expected, `${file} changed from stable Build 187 while implementing reactions`);
}

const app = read('public/app.js');
const appendStart = app.indexOf('function appendMessage(box,m,txt,mine,autoScroll=true){');
const appendEnd = app.indexOf('\nfunction canonicalizeIncomingMessageForMount178', appendStart);
assert(appendStart >= 0 && appendEnd > appendStart, 'appendMessage source not found');
const append = app.slice(appendStart, appendEnd);
const normalizedAppend = append
  .replace("    if(e.target?.closest?.('.fp-reaction-pill188'))return;\n", '')
  .replace('  window.FPReactionRenderer188?.mount?.(w,state.roomId,m);\n', '');
assert.equal(
  fnv1a(normalizedAppend),
  '7fce4d92',
  'Build 188 changed stable Build 187 appendMessage behavior beyond the reaction swipe guard/render hook'
);
assert.equal((append.match(/FPReactionRenderer188\?\.mount/g) || []).length, 1, 'appendMessage must contain exactly one reaction render hook');
assert.equal((append.match(/fp-reaction-pill188/g) || []).length, 1, 'appendMessage must contain exactly one reaction swipe guard');

const context = read('public/message-context.js');
const contextHook = `    window.FPReactionInteractionManager188?.decorateContext?.(nextState, {
      menu,
      clone,
      menuBefore,
      sourceRect,
      closeContext
    });
`;
const normalizedContext = context
  .replace("    if (event.target?.closest?.('.fp-reaction-pill188')) return;\n", '')
  .replace("    if (event.target?.closest?.('.fp-reaction-pill188')) return;\n", '')
  .replace(contextHook, '');
assert.equal(
  fnv1a(normalizedContext),
  '222b4e49',
  'Build 188 changed stable Build 187 message-context beyond additive reaction guards/decorator hook'
);
assert.equal((context.match(/fp-reaction-pill188/g) || []).length, 2, 'message-context must contain exactly two reaction target guards');
assert.equal((context.match(/FPReactionInteractionManager188\?\.decorateContext/g) || []).length, 1, 'message-context must contain exactly one reaction decorator hook');

const usernameSearch = read('public/username-search143.js');
const profileApi = `  window.FPUsernameSearch143 = Object.freeze({
    openProfile(user) {
      if (!user || !validSyntax(String(user.username || '').toLowerCase())) return false;
      openProfile(user);
      return true;
    },
    closeProfile
  });

`;
assert.equal(
  fnv1a(usernameSearch.replace(profileApi, '')),
  '87f4353d',
  'Build 188 changed stable Build 187 username-search beyond the additive public profile opener'
);
assert.equal((usernameSearch.match(/window\.FPUsernameSearch143 = Object\.freeze/g) || []).length, 1, 'username-search must expose exactly one additive profile opener');

console.log('Build 188.3 compatibility guard vs stable 187: PASS');
