'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const appPath=path.join(root,'public','app.js');
const versionPath=path.join(root,'public','version.json');
const indexPath=path.join(root,'public','index.html');

const appBytes=fs.readFileSync(appPath);
const appText=appBytes.toString('utf8');
const version=JSON.parse(fs.readFileSync(versionPath,'utf8'));
const index=fs.readFileSync(indexPath,'utf8');

function gitBlobSha(buffer){
  const body=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
  const header=Buffer.from('blob '+body.length+'\0');
  return crypto.createHash('sha1').update(header).update(body).digest('hex');
}
const actualRevision=gitBlobSha(appBytes);

assert.match(String(version.appRevision||''),/^[a-f0-9]{40}$/i,'version.json appRevision must be a full Git blob SHA');
assert.equal(version.appRevision,actualRevision,'appRevision must change whenever public/app.js bytes change');
assert(index.includes("let appBuildSuffix190 = '';"),'app-specific revision suffix state missing');
assert(index.includes("const appRevision = String(data?.appRevision ?? '').trim();"),'loader must read appRevision');
assert(index.includes("hint.href=\`/\${name}\${name==='app.js' ? appBuildSuffix190 : buildSuffix}\`;"),'app.js preload must use app-specific revision URL');
assert(index.includes("script.src = \`/app.js\${appBuildSuffix190}\`;"),'real app.js load must use app-specific revision URL');

run(async({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:1100,height:760}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.dismiss());

  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:30000});
  const current=await page.evaluate(async()=>{
    const appScript=[...document.scripts].find(s=>{try{return new URL(s.src,location.href).pathname==='/app.js';}catch{return false;}});
    const preload=[...document.querySelectorAll('link[rel="preload"][as="script"]')]
      .find(link=>{try{return new URL(link.href,location.href).pathname==='/app.js';}catch{return false;}});
    if(!appScript||!preload)throw new Error('app.js preload/script pair missing');
    const response=await fetch(appScript.src,{cache:'no-store'});
    return{
      scriptUrl:appScript.src,
      preloadUrl:preload.href,
      body:await response.text()
    };
  });
  assert.equal(current.scriptUrl,current.preloadUrl,'app.js preload and real script URL must be identical');
  const currentUrl=new URL(current.scriptUrl);
  assert.equal(currentUrl.searchParams.get('v'),String(version.build));
  assert.equal(currentUrl.searchParams.get('r'),actualRevision);
  assert.equal(gitBlobSha(Buffer.from(current.body)),actualRevision,'browser must receive bytes matching current appRevision');

  await page.close();

  const syntheticContext=await browser.newContext({viewport:{width:1100,height:760},serviceWorkers:'block'});
  const syntheticPage=await syntheticContext.newPage();
  syntheticPage.on('pageerror',e=>errors.push(e.message));
  syntheticPage.on('dialog',d=>d.dismiss());

  const bodyA=appText+"\n;window.__fpNext7RevisionBytes='A';\n";
  const bodyB=appText+"\n;window.__fpNext7RevisionBytes='B';\n";
  const revA=gitBlobSha(Buffer.from(bodyA));
  const revB=gitBlobSha(Buffer.from(bodyB));
  assert.notEqual(revA,revB);

  let servedRevision=revA;
  const bodies=new Map([[revA,bodyA],[revB,bodyB]]);
  const versionTemplate={...version,build:'190.2'};

  await syntheticPage.route('**/version.json*',route=>{
    const payload={...versionTemplate,appRevision:servedRevision};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});
  });
  await syntheticPage.route('**/app.js*',route=>{
    const requestUrl=new URL(route.request().url());
    const revision=requestUrl.searchParams.get('r');
    const body=bodies.get(revision);
    if(!body)return route.fulfill({status:409,contentType:'text/plain',body:'unexpected app revision '+revision});
    return route.fulfill({
      status:200,
      contentType:'application/javascript; charset=utf-8',
      headers:{'Cache-Control':'public, max-age=31536000, immutable','ETag':'"'+revision+'"'},
      body
    });
  });

  const loadSynthetic=async(expected)=>{
    await syntheticPage.goto(origin,{waitUntil:'domcontentloaded'});
    await syntheticPage.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:30000});
    await syntheticPage.waitForFunction(marker=>window.__fpNext7RevisionBytes===marker,expected.marker,{timeout:10000});
    return syntheticPage.evaluate(async(expectedRevision)=>{
      const appScript=[...document.scripts].find(s=>{try{return new URL(s.src,location.href).pathname==='/app.js';}catch{return false;}});
      const preload=[...document.querySelectorAll('link[rel="preload"][as="script"]')]
        .find(link=>{try{return new URL(link.href,location.href).pathname==='/app.js';}catch{return false;}});
      const response=await fetch(appScript.src,{cache:'force-cache'});
      return{
        marker:window.__fpNext7RevisionBytes,
        scriptUrl:appScript.src,
        preloadUrl:preload.href,
        body:await response.text(),
        expectedRevision
      };
    },expected.revision);
  };

  servedRevision=revB;
  const updated=await loadSynthetic({revision:revB,marker:'B'});
  assert.equal(updated.scriptUrl,updated.preloadUrl);
  assert.equal(new URL(updated.scriptUrl).searchParams.get('r'),revB);
  assert.equal(updated.marker,'B');
  assert.equal(gitBlobSha(Buffer.from(updated.body)),revB,'updated URL must return updated bytes');

  servedRevision=revA;
  const rolledBack=await loadSynthetic({revision:revA,marker:'A'});
  assert.equal(rolledBack.scriptUrl,rolledBack.preloadUrl);
  assert.equal(new URL(rolledBack.scriptUrl).searchParams.get('r'),revA);
  assert.equal(rolledBack.marker,'A');
  assert.equal(gitBlobSha(Buffer.from(rolledBack.body)),revA,'rollback URL must return rollback bytes');
  assert.notEqual(updated.scriptUrl,rolledBack.scriptUrl,'content revision must change app.js URL across update/rollback');
  await syntheticContext.close();

  assert.deepEqual(errors,[]);
  console.log('PASS appRevision equals Git blob SHA of public/app.js');
  console.log('PASS app.js preload and executable script use the identical revisioned URL');
  console.log('PASS current revision URL returns exact current app.js bytes');
  console.log('PASS synthetic update changes URL and executes/returns updated bytes');
  console.log('PASS synthetic rollback changes URL back and executes/returns rollback bytes');
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
