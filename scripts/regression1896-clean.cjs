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
const voicePins = read('public/voice-pins127.js');

assert.equal(version.build, '189.6', 'version.json must expose Build 189.6');
assert.match(updater, /EXPECTED_BUILD=189\.6/, 'safe updater must accept Build 189.6');
assert.match(buildUi, /BUILD_LABEL = 'Build 189\.6'/, 'UI build label must match version.json');
assert.doesNotMatch(buildUi, /\?v=189\.5/, 'Build 189.5 fallback cache suffix must not survive');

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
assert.match(context, /state\.placed = true/, 'placement must be committed even with reduced motion');
assert.match(context, /pickerFrozen/, 'expanded reaction catalog must freeze after its one placement pass');
assert.match(context, /picker-open/, 'picker opening must get an explicit relayout');
assert.doesNotMatch(context, /visualViewport\?\.addEventListener\?\.\('scroll'/, 'picker scroll/browser chrome scroll must not feed context geometry');
assert.match(picker, /overflow-y:auto/, 'full reaction catalog must remain internally scrollable');
assert.match(picker, /delegateLayout\(st,'picker-open'\)/, 'picker must request one geometry pass after opening');

console.log('Build 189.6 clean regression contract: OK');
