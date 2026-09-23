'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const storage = fs.readFileSync(path.join(root, 'public/storage167.js'), 'utf8').replace(/\r\n/g, '\n');
const network = fs.readFileSync(path.join(root, 'public/network171.js'), 'utf8').replace(/\r\n/g, '\n');

function functionSource(source, name) {
  const wrapped = '\n' + source;
  const match = new RegExp('\\n\\s*(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(wrapped);
  assert(match, 'function missing: ' + name);
  const start = Math.max(0, match.index - 1);
  const rest = source.slice(start + 1);
  const next = /\n\s{2}(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/g;
  next.lastIndex = 1;
  const found = next.exec(rest);
  return found ? rest.slice(0, found.index) : rest;
}

const drain = functionSource(storage, 'drainPrefetchResponse');
const pump = functionSource(storage, 'pumpPrefetch');

assert(drain.includes('response.body.getReader()'), 'prefetch response body is not acquired');
assert(drain.includes('await reader.read()'), 'prefetch response body is not drained');
assert(drain.includes('if (chunk.done) break;'), 'prefetch drain has no EOF completion');
assert(pump.includes('const response = await window.fetch(url);'), 'prefetch no longer uses the existing fetch/cache path');
assert(pump.includes('await drainPrefetchResponse(response);'), 'prefetch fetch returns without finishing its body consumer');
assert(!pump.includes('.then(() => window.fetch(url))'), 'old leaking prefetch path is still present');

const budget = functionSource(network, 'releaseMediaSlot');
assert(budget.includes('reservedMediaSlots=Math.max(0,reservedMediaSlots-weight)'), 'media budget release contract changed');
assert(network.includes('if(chunk.done){controller.close();stats.mediaBudget.completed++;if(!init?.fpMediaLease174)release();return;}'),
  'media stream EOF no longer releases the ordinary media lease');

(async () => {
  let pulls = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls <= 3) controller.enqueue(new Uint8Array([pulls]));
      else controller.close();
    }
  }));
  const reader = response.body.getReader();
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
  }
  assert.equal(bytes, 3, 'stream drain fixture failed');
  console.log('PASS incoming media prefetch consumes its response stream to EOF');
  console.log('PASS FPNetwork171 media slot release remains bound to stream completion');
  console.log('PASS old fetch-with-unread-body prefetch path is absent');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
