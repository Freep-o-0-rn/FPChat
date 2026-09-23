'use strict';

const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const http=require('node:http');
const root=path.resolve(__dirname,'..');

function freePort(){
 return new Promise((resolve,reject)=>{
  const s=net.createServer();
  s.once('error',reject);
  s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});
 });
}
function getJson(port,pathname){
 return new Promise((resolve,reject)=>{
  const req=http.get({hostname:'127.0.0.1',port,path:pathname,timeout:3000},res=>{
   let body='';res.setEncoding('utf8');res.on('data',c=>body+=c);res.on('end',()=>{
    try{resolve({status:res.statusCode,body:body?JSON.parse(body):null});}catch(e){reject(e);}
   });
  });
  req.once('error',reject);req.once('timeout',()=>req.destroy(new Error('HTTP timeout')));
 });
}
async function runEntry(args,label){
 const port=await freePort();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fpchat-1795-'));
 const db=path.join(dir,'chat.sqlite');
 const env={...process.env,APP_HOST:'127.0.0.1',APP_PORT:String(port),DATABASE_PATH:db,VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:''};
 const child=spawn(process.execPath,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='',listenCount=0,readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const timer=setTimeout(()=>readyReject(new Error(label+' startup timeout\n'+stdout+'\n'+stderr)),8000);
 child.stdout.on('data',chunk=>{const t=chunk.toString();stdout+=t;listenCount+=(t.match(/FPChat listening on/g)||[]).length;if(listenCount===1)readyResolve();});
 child.stderr.on('data',chunk=>stderr+=chunk.toString());
 child.once('exit',(code,signal)=>{if(listenCount===0)readyReject(new Error(label+' exited before listen code='+code+' signal='+signal+'\n'+stderr));});
 try{
  await ready;clearTimeout(timer);
  await new Promise(r=>setTimeout(r,150));
  assert.equal(listenCount,1,label+' started server more than once');
  const probe=await getJson(port,'/api/push/vapid-public-key');
  assert.equal(probe.status,200,label+' probe status');
  return {probe,listenCount};
 } finally {
  clearTimeout(timer);
  if(!child.killed)child.kill();
  await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500);});
  fs.rmSync(dir,{recursive:true,force:true});
 }
}

(async()=>{
 const direct=await runEntry(['server.js'],'direct entry');
 const legacy=await runEntry(['-r','./src/message-actions-bootstrap.js','server.js'],'legacy preload entry');
 assert.deepEqual(legacy.probe,direct.probe,'old preload and direct entry probe contract differ');
 assert.equal(direct.listenCount,1);
 assert.equal(legacy.listenCount,1);
 console.log('PASS 179.5 direct and legacy preload entries expose the same probe contract');
 console.log('PASS 179.5 both entry modes execute startup exactly once');
})().catch(error=>{console.error(error);process.exitCode=1;});
