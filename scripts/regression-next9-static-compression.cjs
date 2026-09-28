'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const appBytes=fs.readFileSync(path.join(root,'public','app.js'));
const cssBytes=fs.readFileSync(path.join(root,'public','styles.css'));
const version=JSON.parse(fs.readFileSync(path.join(root,'public','version.json'),'utf8'));
const serverSource=fs.readFileSync(path.join(root,'server.js'),'utf8');

function gitBlobSha(buffer){
  const body=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
  return crypto.createHash('sha1').update(Buffer.from('blob '+body.length+'\0')).update(body).digest('hex');
}
assert.equal(version.appRevision,gitBlobSha(appBytes));
assert(serverSource.includes("app.use(staticCompression190);"),'static compression middleware missing');
assert(serverSource.includes("pathname === '/sw.js'"),'sw.js exclusion missing');
assert(serverSource.includes("pathname.startsWith('/api/')"),'API exclusion missing');
assert(serverSource.includes("res.vary('Accept-Encoding')"),'Vary negotiation missing');

function rawGet(url,{acceptEncoding,ifNoneMatch}={}){
  return new Promise((resolve,reject)=>{
    const u=new URL(url);
    const headers={};
    if(acceptEncoding!==undefined)headers['Accept-Encoding']=acceptEncoding;
    if(ifNoneMatch)headers['If-None-Match']=ifNoneMatch;
    const req=http.request({hostname:u.hostname,port:u.port,path:u.pathname+u.search,method:'GET',headers},res=>{
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>resolve({
        status:res.statusCode,
        headers:res.headers,
        body:Buffer.concat(chunks)
      }));
    });
    req.on('error',reject);req.end();
  });
}
function decode(body,encoding){
  if(encoding==='br')return zlib.brotliDecompressSync(body);
  if(encoding==='gzip')return zlib.gunzipSync(body);
  return body;
}
function varyHasAcceptEncoding(headers){
  return String(headers.vary||'').toLowerCase().split(',').map(x=>x.trim()).includes('accept-encoding');
}

run(async({browser,origin,errors})=>{
  const appUrl=origin+'/app.js?v='+encodeURIComponent(String(version.build))+'&r='+encodeURIComponent(String(version.appRevision));
  const cssUrl=origin+'/styles.css?v='+encodeURIComponent(String(version.build));

  const appBr=await rawGet(appUrl,{acceptEncoding:'br, gzip'});
  assert.equal(appBr.status,200);
  assert.equal(appBr.headers['content-encoding'],'br');
  assert(varyHasAcceptEncoding(appBr.headers));
  assert.match(String(appBr.headers['cache-control']||''),/immutable/i);
  assert.deepEqual(decode(appBr.body,'br'),appBytes);
  assert(appBr.body.length<appBytes.length*0.6,'brotli app.js should materially reduce transfer');

  const appGzip=await rawGet(appUrl,{acceptEncoding:'gzip'});
  assert.equal(appGzip.status,200);
  assert.equal(appGzip.headers['content-encoding'],'gzip');
  assert(varyHasAcceptEncoding(appGzip.headers));
  assert.deepEqual(decode(appGzip.body,'gzip'),appBytes);
  assert(appGzip.body.length<appBytes.length*0.7,'gzip app.js should materially reduce transfer');

  const appIdentity=await rawGet(appUrl,{acceptEncoding:'identity'});
  assert.equal(appIdentity.status,200);
  assert.equal(appIdentity.headers['content-encoding'],undefined);
  assert(varyHasAcceptEncoding(appIdentity.headers));
  assert.deepEqual(appIdentity.body,appBytes,'identity client must receive exact uncompressed app bytes');

  const qGzip=await rawGet(appUrl,{acceptEncoding:'br;q=0, gzip;q=1'});
  assert.equal(qGzip.headers['content-encoding'],'gzip','q=0 must disable br');

  const qIdentity=await rawGet(appUrl,{acceptEncoding:'br;q=0, gzip;q=0, identity;q=1'});
  assert.equal(qIdentity.headers['content-encoding'],undefined,'client rejecting compression must receive identity');
  assert.deepEqual(qIdentity.body,appBytes);

  const cssBr=await rawGet(cssUrl,{acceptEncoding:'br, gzip'});
  assert.equal(cssBr.status,200);
  assert.equal(cssBr.headers['content-encoding'],'br');
  assert(varyHasAcceptEncoding(cssBr.headers));
  assert.deepEqual(decode(cssBr.body,'br'),cssBytes);
  assert.match(String(cssBr.headers['cache-control']||''),/max-age=0/i);

  const etag=String(appBr.headers.etag||'');
  assert(etag);
  const conditional=await rawGet(appUrl,{acceptEncoding:'br, gzip',ifNoneMatch:etag});
  assert.equal(conditional.status,304,'compressed representation must preserve validator behavior');
  assert(varyHasAcceptEncoding(conditional.headers),'304 must retain Accept-Encoding variance');
  assert.equal(conditional.body.length,0);

  for(const target of ['/','/version.json','/sw.js','/api/__next9_missing__']){
    const response=await rawGet(origin+target,{acceptEncoding:'br, gzip'});
    assert.equal(response.headers['content-encoding'],undefined,'compression leaked to '+target);
    assert(!varyHasAcceptEncoding(response.headers),'Accept-Encoding variance leaked to '+target);
  }

  // Normal browser client must negotiate a compressed static representation.
  const page=await browser.newPage({viewport:{width:1100,height:760}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.dismiss());
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  let browserApp=null;
  cdp.on('Network.responseReceived',e=>{
    try{
      const u=new URL(e.response.url);
      if(u.pathname!=='/app.js')return;
      const h={};for(const [k,v] of Object.entries(e.response.headers||{}))h[k.toLowerCase()]=String(v);
      browserApp={
        encoding:h['content-encoding']||null,
        vary:h.vary||null,
        cacheControl:h['cache-control']||null
      };
    }catch{}
  });
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:30000});
  assert(browserApp&&['br','gzip'].includes(browserApp.encoding),'Chromium startup must negotiate compression for app.js');
  assert(String(browserApp.vary||'').toLowerCase().includes('accept-encoding'));
  assert.deepEqual(errors,[]);
  await page.close();

  console.log('PASS Brotli and gzip negotiation for JS/CSS');
  console.log('PASS Vary Accept-Encoding and existing cache validators are preserved');
  console.log('PASS identity/q=0 clients receive exact uncompressed bytes');
  console.log('PASS HTML/version.json/sw.js/API remain outside static compression');
  console.log('PASS Chromium startup negotiates compressed app.js');
  console.log('NEXT9_SIZES '+JSON.stringify({
    appIdentity:appIdentity.body.length,
    appBr:appBr.body.length,
    appGzip:appGzip.body.length,
    cssIdentity:cssBytes.length,
    cssBr:cssBr.body.length
  }));
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
