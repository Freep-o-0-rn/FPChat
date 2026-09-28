'use strict';

const http=require('node:http');
const {run}=require('./browser-harness174.cjs');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'public','version.json'),'utf8'));
const OUT=process.env.FPCHAT_NEXT9_OUTPUT||path.join(process.cwd(),'next9-output');
fs.mkdirSync(OUT,{recursive:true});

function rawGet(url,acceptEncoding){
  return new Promise((resolve,reject)=>{
    const u=new URL(url);
    const req=http.request({
      hostname:u.hostname,port:u.port,path:u.pathname+u.search,method:'GET',
      headers:{'Accept-Encoding':acceptEncoding}
    },res=>{
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>resolve({
        url:u.pathname+u.search,
        acceptEncoding,
        status:res.statusCode,
        contentEncoding:res.headers['content-encoding']||null,
        vary:res.headers.vary||null,
        cacheControl:res.headers['cache-control']||null,
        etag:res.headers.etag||null,
        contentLength:res.headers['content-length']?Number(res.headers['content-length']):null,
        transferBytes:Buffer.concat(chunks).length
      }));
    });
    req.on('error',reject);req.end();
  });
}

run(async({browser,origin,errors})=>{
  const appUrl=origin+'/app.js?v='+encodeURIComponent(String(version.build))+'&r='+encodeURIComponent(String(version.appRevision));
  const cssUrl=origin+'/styles.css?v='+encodeURIComponent(String(version.build));
  const raw=[];
  for(const url of [appUrl,cssUrl]){
    raw.push(await rawGet(url,'br, gzip'));
    raw.push(await rawGet(url,'gzip'));
    raw.push(await rawGet(url,'identity'));
  }

  const context=await browser.newContext({viewport:{width:1100,height:760}});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.dismiss());
  const cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const rows=new Map();
  cdp.on('Network.requestWillBeSent',e=>{
    try{
      const u=new URL(e.request.url);
      if(!u.origin.startsWith(origin)||(!u.pathname.endsWith('.js')&&!u.pathname.endsWith('.css')))return;
      if(u.pathname==='/sw.js')return;
      rows.set(e.requestId,{url:u.pathname+u.search,path:u.pathname,start:e.timestamp,acceptEncoding:e.request.headers?.['Accept-Encoding']||e.request.headers?.['accept-encoding']||null});
    }catch{}
  });
  cdp.on('Network.responseReceived',e=>{
    const row=rows.get(e.requestId);if(!row)return;
    const h=e.response.headers||{};
    const lower={};for(const [k,v] of Object.entries(h))lower[k.toLowerCase()]=String(v);
    row.status=e.response.status;
    row.contentEncoding=lower['content-encoding']||null;
    row.vary=lower.vary||null;
    row.cacheControl=lower['cache-control']||null;
    row.fromDiskCache=Boolean(e.response.fromDiskCache);
  });
  cdp.on('Network.loadingFinished',e=>{
    const row=rows.get(e.requestId);if(!row)return;
    row.encodedBytes=e.encodedDataLength||0;
    row.durationMs=Math.round((e.timestamp-row.start)*10000)/10;
  });
  const started=Date.now();
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:30000});
  await page.waitForTimeout(100);
  const startupMs=Date.now()-started;
  const requests=[...rows.values()].filter(r=>r.status);
  const result={
    build:version.build,appRevision:version.appRevision,
    raw,
    browser:{
      startupMs,
      requestCount:requests.length,
      encodedBytes:requests.reduce((a,r)=>a+(Number(r.encodedBytes)||0),0),
      contentEncodings:[...new Set(requests.map(r=>r.contentEncoding).filter(Boolean))],
      varyValues:[...new Set(requests.map(r=>r.vary).filter(Boolean))],
      app:requests.find(r=>r.path==='/app.js')||null,
      largest:[...requests].sort((a,b)=>(b.encodedBytes||0)-(a.encodedBytes||0)).slice(0,10)
    },
    errors
  };
  fs.writeFileSync(path.join(OUT,'next9-static-compression.json'),JSON.stringify(result,null,2)+'\n');
  console.log('NEXT9_RESULT '+JSON.stringify(result));
  if(errors.length)process.exitCode=1;
  await context.close();
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
