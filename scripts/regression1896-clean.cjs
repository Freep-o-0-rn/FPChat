'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const version = JSON.parse(read('public/version.json'));
const updater = read('update.bat');
const buildUi = read('public/build165-ui.js');
const gesture = read('public/gesture-manager135.js');
const swipe = read('public/swipe-fix.js');
const context = read('public/context-layout189.js');
const messageContext = read('public/message-context.js');
const picker = read('public/reaction-picker188.js');
const reactionInteraction = read('public/reaction-interaction188.js');
const reactionRenderer = read('public/reaction-renderer188.js');
const reactionDetails = read('public/reaction-details188.js');
const voicePins = read('public/voice-pins127.js');

const build = String(version.build);
assert.match(build, /^\d+(?:\.\d+)*$/, 'release build must be a valid cache id');
assert.ok(updater.includes(`EXPECTED_BUILD=${build}`), 'safe updater must match version.json');
assert.ok(buildUi.includes(`BUILD_LABEL = 'Build ${build}'`), 'UI build label must match version.json');
assert.ok(buildUi.includes(`?v=${build}`), 'fallback cache suffix must match version.json');

assert.equal(
  fs.existsSync(path.join(root, 'public/voice-playback-arbiter189.js')),
  false,
  'redundant FPVoicePlaybackArbiter189 must stay removed'
);
assert.doesNotMatch(context, /FPVoicePlaybackArbiter189|voice-playback-arbiter189/, 'context geometry must not load a playback arbiter');
assert.match(voicePins, /let playbackGeneration = 0/, 'existing pinned voice owner must own async generation');
assert.match(voicePins, /generation !== playbackGeneration/, 'stale pinned voice starts must be rejected');
assert.match(voicePins, /resetOtherPlaybackUi\(root\)/, 'only the current pinned voice may present active playback');

assert.match(gesture, /mode === 'pins'/, 'existing gesture arbiter must admit pins navigation');
assert.match(gesture, /fp-pins114-action-overlay,\.fp-pins114-delete-overlay/, 'higher pins modals must keep precedence');
assert.match(swipe, /const mode = pinsOpen \? "pins"/, 'existing swipe executor must select pins mode before underlying chat');
assert.match(swipe, /claimAction\(\`navigate:\$\{swipe\.mode\}\`/, 'pins swipe must claim through FPGesture135');
assert.match(swipe, /root\.querySelector\('\.fp-pins114-back'\)\?\.click\(\)/, 'pins swipe must use the existing back action and preserve current chat');

assert.match(messageContext, /ctx\.drawImage\(source, 0, 0, width, height\)/, 'context clone must copy canvas-backed voice waveform');
assert.match(messageContext, /FPContextLayout189\.relayout\(root, 'context-open'\)/, 'context owner must receive initial geometry');
assert.match(messageContext, /hasContextGeometryOwner[\s\S]*\? 12/, 'context owner must start without legacy source-position reserve');
assert.match(context, /cluster\.style\.paddingTop = \`\$\{SAFE_GAP\}px\`/, 'context geometry must own compact top reserve');
assert.match(context, /menuBottom > bounds\.bottom/, 'oversized context must clamp the complete action menu into the safe area');
assert.match(context, /reason === 'picker-open' \|\| reason === 'picker-close'/, 'picker state changes must relayout synchronously before paint');
assert.match(messageContext, /cluster\.appendChild\(clone\);\s*cluster\.appendChild\(menu\);/, 'selected message must precede the action menu in context DOM');
assert.doesNotMatch(messageContext, /if \(menuBefore\)/, 'source-position heuristic must not move the action menu above the selected message');
assert.match(reactionInteraction, /cluster\.insertBefore\(strip, clone\)/, 'quick reactions must stay above the selected message');
assert.match(context, /state\.placed = true/, 'placement must be committed even with reduced motion');
assert.match(context, /pickerFrozen/, 'expanded reaction catalog must freeze after its one placement pass');
assert.match(context, /picker-open/, 'picker opening must get an explicit relayout');
assert.doesNotMatch(context, /visualViewport\?\.addEventListener\?\.\('scroll'/, 'picker scroll/browser chrome scroll must not feed context geometry');
assert.match(picker, /overflow-y:auto/, 'full reaction catalog must remain internally scrollable');
assert.match(picker, /delegateLayout\(st,next\?'picker-open':'picker-close'\)/, 'picker must request one geometry pass after final expanded DOM state');
assert.match(picker, /height:min\(390px,48vh\)/, 'mobile full reaction catalog must expose roughly 4-5 visible rows');
assert.match(reactionInteraction, /\{ menu, clone, sourceRect, closeContext \}/, 'interaction manager must receive the context action menu');
assert.match(reactionInteraction, /menu\.hidden = Boolean\(expanded\)/, 'context action menu must hide while full reactions are open');
assert.match(reactionInteraction, /admitPickerToggle/, 'full reaction toggle admission must stay in the existing interaction manager');
assert.match(reactionInteraction, /claimAction\?\.\('reaction-picker-toggle'/, 'full reaction toggle must be arbitrated by FPGesture135');
assert.match(reactionInteraction, /fp-reaction-picker-expanded188/, 'expanded reaction state must be explicit on the context cluster');
assert.doesNotMatch(reactionInteraction, /closest\?\.\('\.fp-reaction-avatar188'\)/, 'compact avatar must not own a profile-click branch');
assert.doesNotMatch(reactionInteraction, /openParticipantProfile\?\.\(/, 'compact reaction interaction must not open profiles directly');
assert.match(reactionRenderer, /avatar\.setAttribute\('aria-hidden', 'true'\)/, 'compact participant avatar must remain presentation-only');
assert.match(reactionDetails, /root\.addEventListener\('click', \(\) => openProfile\(row\)\)/, 'profiles must remain available from Reaction Details rows');

assert.match(voicePins, /active\.root === root && active\.messageId === messageId/, 'waveform progress must have one concrete DOM/audio owner');
assert.match(voicePins, /const safe = ownsPlayback \? requested : 0/, 'inactive pinned voices must render neutral 0:00 progress');
assert.doesNotMatch(voicePins, /positions\.delete\(pinKey\(otherMessageId\)\)/, 'neutralizing another card must not destroy its private resume position');

console.log(`Build ${build} accumulated 189.10 regression contract: OK`);
