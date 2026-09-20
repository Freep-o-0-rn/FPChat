'use strict';
const path = require('node:path');
const {spawnSync} = require('node:child_process');
let failed = false;
for (const build of [169, 170, 171, 172, 173, ...(process.argv.includes('--174') ? [174] : [])]) {
  const result = spawnSync(process.execPath, [path.join(__dirname, `check-build${build}.js`)], {stdio:'inherit'});
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
