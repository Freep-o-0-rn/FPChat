'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const version = JSON.parse(read('public/version.json'));
const buildUi = read('public/build165-ui.js');
const settingsUi = read('public/settings-ui131.js');
const updater = read('update.bat');

const build = String(version.build);
assert.match(build, /^\d+(?:\.\d+)*$/, 'release build must have a valid cache-bust id');
assert(buildUi.includes(`const BUILD_LABEL = 'Build ${build}';`), 'main build label is stale');
assert(buildUi.includes(`?v=${build}`), 'build UI fallback cache suffix is stale');
assert(settingsUi.includes(`const BUILD = '${build}';`), 'settings fallback build is stale');
assert(updater.includes(`set "EXPECTED_BUILD=${build}"`), 'updater build gate is stale');

console.log('PASS displayed build labels match version.json');
console.log('PASS updater gate matches displayed/source build');
