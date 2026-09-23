'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
async function main(){
  const window={};
  vm.runInNewContext(fs.readFileSync(path.join(root,'public/work174.js'),'utf8'),{window,performance,setTimeout});
  let current=true,processed=0,observed=0;
  setTimeout(()=>{observed=processed;current=false;},0);
  const completed=await window.FPWork174.each(Array(80),()=>processed++,{current:()=>current,batch:20});
  assert.equal(completed,false);assert.equal(processed,20);assert.equal(observed,20);
  let active=0;
  await window.FPWork174.each([1,2,3],async()=>{assert.equal(active++,0);await Promise.resolve();active--;});
  assert.equal(active,0);
  await assert.rejects(window.FPWork174.each([1],()=>{throw Error('expected');}),/expected/);
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  const literal=html.match(/const startupDependencies174 = (\{[\s\S]*?\n      \});/);
  assert(literal,'Startup dependency map is missing');
  const graph=vm.runInNewContext('('+literal[1]+')');
  const visited=new Set(),visiting=new Set();
  function visit(name){
    assert(fs.existsSync(path.join(root,'public',name)),`Missing dependency ${name}`);
    assert(!visiting.has(name),`Dependency cycle at ${name}`);
    if(visited.has(name))return;
    visiting.add(name);for(const dependency of graph[name]||[])visit(dependency);
    visiting.delete(name);visited.add(name);
  }
  Object.keys(graph).forEach(visit);
  for(const name of fs.readdirSync(path.join(root,'public')).filter(name=>name.endsWith('.js'))){
    new vm.Script(fs.readFileSync(path.join(root,'public',name),'utf8'),{filename:name});
  }
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1],{filename:'index.html inline'});
  console.log('Build174 checks passed: cancellable sequential batches, error propagation, acyclic startup map, public/inline JS syntax. Browser behavior is covered separately.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
