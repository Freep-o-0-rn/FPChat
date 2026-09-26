const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const renderer = read('public/reaction-renderer188.js');
new Function(renderer);

assert(renderer.includes("scope: '.fp-message-reactions188 only'"), 'renderer ownership scope changed');
assert(renderer.includes("owner: 'FPMessageRender178'"), 'renderer is no longer a worker under MessageRender');
assert(renderer.includes("gestures: 'delegated to FPReactionInteractionManager188'"), 'reaction gesture ownership is not delegated');
assert(renderer.includes('pointer-events:none'), 'reaction pills are not inert before interaction owner readiness');
assert(renderer.includes(':root.fp-reaction-interaction188-ready .${PILL}'), 'reaction pills are not gated by interaction owner readiness');
assert.equal((renderer.match(/MutationObserver/g) || []).length, 0, 'reaction renderer introduced a MutationObserver');
assert.equal((renderer.match(/IntersectionObserver/g) || []).length, 0, 'reaction renderer introduced an IntersectionObserver');
assert.equal((renderer.match(/setInterval\s*\(/g) || []).length, 0, 'reaction renderer introduced polling');
assert.equal((renderer.match(/setTimeout\s*\(/g) || []).length, 0, 'reaction renderer introduced timers');
assert.equal((renderer.match(/fetch\s*\(/g) || []).length, 0, 'reaction renderer owns transport');
assert.equal((renderer.match(/scrollTop\s*=/g) || []).length, 0, 'reaction renderer writes scroll');
assert.equal((renderer.match(/scrollTo\s*\(/g) || []).length, 0, 'reaction renderer writes scroll');
assert.equal((renderer.match(/new WebSocket/g) || []).length, 0, 'reaction renderer creates WebSocket');
assert(renderer.includes("if ((count === 1 || count === 2) && preview.length === count)"), '1-2 avatar compact rule missing');
assert(renderer.includes("value.textContent = String(count);"), '3+ compact count fallback missing');
assert(renderer.includes("pill.classList.toggle('is-mine', reaction?.mine === true);"), 'own reaction highlight missing');
assert(renderer.includes("preview.forEach((participantId) => avatars.appendChild(makeAvatar(participantId)))"), 'profile circle preview missing');
assert(renderer.includes("container.appendChild(pill);"), 'keyed pill reorder/patch path missing');
assert(renderer.includes("pill.dataset.fpReactionSignature188 === signature"), 'unchanged pills are rebuilt');
assert(renderer.includes("bubble.insertBefore(container, meta || null);"), 'reaction lane is not isolated inside the existing bubble');
assert(renderer.includes("messageEl.classList?.contains('system-event-wrap')"), 'system messages can receive reactions');

const app = read('public/app.js');
assert(app.includes('window.FPReactionRenderer188?.mount?.(w,state.roomId,m);'), 'message renderer hook missing');
assert(app.indexOf('window.FPReactionRenderer188?.mount?.(w,state.roomId,m);') > app.indexOf('box.appendChild(w);'), 'reaction hook runs before the stable message is mounted');
assert(app.includes('participantId:Number(item.participantId)||null'), 'participant id is not retained for profile circles');
assert(app.includes('participantId:Number(payload.participantId)||Number(previousPresence.participantId)||null'), 'presence update drops participant id');

const blocks = read('src/user-blocks165.js');
assert(blocks.includes('participantId: Number(item.id) || null'), 'participant DTO does not expose existing participant id');

const index = read('public/index.html');
assert(index.includes('reaction-renderer188.js'), 'reaction renderer asset missing');
assert(index.includes('manager.onload = loadReactionRenderer188;'), 'renderer is not ordered after ReactionManager');
assert(index.includes('renderer.onload = loadReactionInteraction188;'), 'interaction manager is not ordered after renderer');

console.log('Build 188.3 reaction renderer regression: PASS');
