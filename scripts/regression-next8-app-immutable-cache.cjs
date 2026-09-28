'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const appBytes=fs.readFileSync(path.join(root,'public','app.js'));
const version=JSON.parse(fs.readFileSync(path.join(root,'public','version.json'),'utf8'));
const serverSource=fs.readFileSync(path.join(root,'server.js'),'utf8');

function gitBlobSha(buffer){
  const body=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
  return crypto.createHash('sha1').update(Buffer.from('blob '+body.length+'\0')).update(body).digest('hex');
}
const revision=gitBlobSha(appBytes);

assert.equal(version.appRevision,revision,'appRevision must match current app.js bytes');
assert(serverSource.includes("app.get('/app.js', (req, res, next) => {"),'targeted app.js cache route missing');
assert(serverSource.includes("res.sendFile(APP_JS_PATH, { maxAge: '1y', immutable: true })"),'revisioned app.js must use long immutable caching');
assert(serverSource.includes("return res.status(410).type('text/plain').send('stale app revision')"),'stale revision must not receive current bytes');
assert(serverSource.includes("if (!requestedRevision) return next();"),'unrevisioned app.js must keep normal static policy');

run(async({browser,origin,errors})=>{
  const immutableUrl=origin+'/app.js?v='+encodeURIComponent(String(version.build))+'&r='+revision;

  // Server header/content contract.
  const exact=await fetch(immutableUrl);
  assert.equal(exact.status,200);
  assert.match(String(exact.headers.get('cache-control')||''),/max-age=31536000/i);
  assert.match(String(exact.headers.get('cache-control')||''),/immutable/i);
  const exactBody=Buffer.from(await exact.arrayBuffer());
  assert.equal(gitBlobSha(exactBody),revision,'immutable URL must return bytes matching its revision');

  const stale='0'.repeat(40);
  const staleResponse=await fetch(origin+'/app.js?v='+encodeURIComponent(String(version.build))+'&r='+stale);
  assert.equal(staleResponse.status,410,'stale content revision must fail closed');
  assert.match(String(staleResponse.headers.get('cache-control')||''),/no-store/i);
  assert.notEqual(gitBlobSha(Buffer.from(await staleResponse.arrayBuffer())),revision,'stale URL must not return current app bytes');

  const unrevisioned=await fetch(origin+'/app.js?v='+encodeURIComponent(String(version.build)));
  assert.equal(unrevisioned.status,200);
  assert.doesNotMatch(String(unrevisioned.headers.get('cache-control')||''),/immutable/i);

  for(const url of ['/', '/version.json', '/sw.js', '/api/__next8_missing__']){
    const response=await fetch(origin+url);
    assert.doesNotMatch(String(response.headers.get('cache-control')||''),/immutable/i,'immutable policy leaked to '+url);
  }

  // Repeat launch in one browser context: current content-revisioned app.js
  // should be served from browser cache without a validator round trip.
  const context=await browser.newContext({viewport:{width:1100,height:760}});
  const prime=await context.newPage();
  prime.on('pageerror',e=>errors.push(e.message));
  prime.on('dialog',d=>d.dismiss());
  await prime.goto(origin,{waitUntil:'domcontentloaded'});
  await prime.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:30000});
  await prime.evaluate(async()=>{if('serviceWorker'in navigator){try{await navigator.serviceWorker.ready;}catch{}}});
  const primeUrl=await prime.evaluate(()=>[...document.scripts].find(s=>{try{return new URL(s.src,location.href).pathname==='/app.js';}catch{return false;}})?.src||'');
  assert.equal(primeUrl,immutableUrl);
  await prime.close();

  const repeat=await context.newPage();
  repeat.on('pageerror',e=>errors.push(e.message));
  repeat.on('dialog',d=>d.dismiss());
  const cdp=await context.newCDPSession(repeat);
  await cdp.send('Network.enable');
  let appRequestId=null;
  let fromDiskCache=false;
  let servedFromCache=false;
  let networkStatus=null;
  let encodedBytes=null;
  cdp.on('Network.requestWillBeSent',e=>{
    try{
      const u=new URL(e.request.url);
      if(u.pathname==='/app.js'&&u.searchParams.get('r')===revision)appRequestId=e.requestId;
    }catch{}
  });
  cdp.on('Network.requestServedFromCache',e=>{
    if(e.requestId===appRequestId)servedFromCache=true;
  });
  cdp.on('Network.responseReceived',e=>{
    if(e.requestId!==appRequestId)return;
    fromDiskCache=Boolean(e.response.fromDiskCache);
  });
  cdp.on('Network.responseReceivedExtraInfo',e=>{
    if(e.requestId===appRequestId)networkStatus=e.statusCode;
  });
  cdp.on('Network.loadingFinished',e=>{
    if(e.requestId===appRequestId)encodedBytes=e.encodedDataLength;
  });

  await repeat.goto(origin,{waitUntil:'domcontentloaded'});
  await repeat.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:30000});
  const repeatInfo=await repeat.evaluate(()=>({
    appUrl:[...document.scripts].find(s=>{try{return new URL(s.src,location.href).pathname==='/app.js';}catch{return false;}})?.src||'',
    timing:performance.getEntriesByType('resource')
      .filter(e=>{try{return new URL(e.name).pathname==='/app.js';}catch{return false;}})
      .map(e=>({name:e.name,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,duration:e.duration}))
  }));
  assert.equal(repeatInfo.appUrl,immutableUrl);
  assert(appRequestId,'repeat app.js request was not observable');
  assert(fromDiskCache||servedFromCache||(repeatInfo.timing[0]?.transferSize===0),
    'repeat app.js must come from browser cache');
  assert.notEqual(networkStatus,304,'repeat immutable app.js must not pay a 304 validator round trip');
  assert(!encodedBytes||encodedBytes===0,'repeat immutable app.js should transfer zero network body bytes');
  await context.close();

  // Item 7 owns the byte/URL update+rollback proof. This item adds the server
  // immutable contract and keeps the same content-derived URL invariant.
  assert.deepEqual(errors,[]);
  console.log('PASS only exact revisioned app.js gets long immutable caching');
  console.log('PASS stale app revision fails closed and never receives current bytes');
  console.log('PASS HTML/version.json/sw.js/API and unrevisioned app.js are not immutable');
  console.log('PASS repeat launch serves revisioned app.js from browser cache without 304 validation');
  console.log('NEXT8_REPEAT '+JSON.stringify({
    appUrl:repeatInfo.appUrl,
    fromDiskCache,servedFromCache,networkStatus,encodedBytes,
    resourceTiming:repeatInfo.timing
  }));
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
