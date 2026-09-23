'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');

const index=read('public/index.html');
const app=read('public/app.js');
const roomContext=read('public/room-context170.js');
const textSend=read('public/text-send170.js');
const mediaSend=read('public/media-send170.js');

const exactCoordinationDeclaration="window.FPStartup174=Object.freeze({dependencies:startupDependencies174,preloaded:preload174,ready:ownersReady174,fail:()=>resolveOwners174(false),execution:'definitions before app; navigation after room/open/send owners'});";
assert(index.includes(exactCoordinationDeclaration),'FPStartup174 coordination surface changed during 180.10');

const roomReadyToken="window.addEventListener('fpchat:room-lifecycle-ready174',loadLifecycleOwner,{once:true});";
assert.equal(roomContext.split(roomReadyToken).length-1,1,'room-lifecycle readiness must connect to owner chain exactly once');

for(const [source,next] of [
  ['connection170.js','loadSyncCoordinator176'],
  ['sync-coordinator176.js','loadRoomOpenOwner'],
  ['room-open170.js','loadSendManager177'],
  ['send-manager177.js','loadTextSendOwner']
]){
  assert.equal(roomContext.split(source).length-1,1,'required owner loader must have one source site: '+source);
  const sourceAt=roomContext.indexOf(source);
  const functionAt=roomContext.lastIndexOf('function ',sourceAt);
  const nextFunction=roomContext.indexOf('\n  function ',sourceAt);
  const body=roomContext.slice(functionAt,nextFunction>=0?nextFunction:roomContext.length);
  assert(body.includes('script.onload = '+next),'success transition missing for '+source);
  assert(body.includes('script.onerror = () => window.FPStartup174?.fail();'),'failure transition missing for '+source);
}

assert.equal(roomContext.split('lifecycle170.js').length-1,1,'Lifecycle170 fallback loader must have one source site');
{
  const sourceAt=roomContext.indexOf('lifecycle170.js');
  const functionAt=roomContext.lastIndexOf('function ',sourceAt);
  const nextFunction=roomContext.indexOf('\n  function ',sourceAt);
  const body=roomContext.slice(functionAt,nextFunction>=0?nextFunction:roomContext.length);
  assert(body.includes('script.onload = loadConnectionOwner;'),'Lifecycle170 success transition changed');
  assert(body.includes('script.onerror = () => window.FPStartup174?.fail();'),'Lifecycle170 fallback failure is not connected to FPStartup174.fail');
}

assert.equal(roomContext.split('text-send170.js').length-1,1,'TextSend owner loader must have one source site');
{
  const sourceAt=roomContext.indexOf('text-send170.js');
  const functionAt=roomContext.lastIndexOf('function ',sourceAt);
  const nextFunction=roomContext.indexOf('\n  function ',sourceAt);
  const body=roomContext.slice(functionAt,nextFunction>=0?nextFunction:roomContext.length);
  assert(body.includes('script.onerror = () => window.FPStartup174?.fail();'),'TextSend failure transition changed');
}

assert.equal(textSend.split('media-send170.js').length-1,1,'MediaSend owner must be loaded from one TextSend site');
assert(textSend.includes('script.onerror = () => window.FPStartup174?.fail();'),'MediaSend failure transition changed');
assert.equal(mediaSend.split("window.dispatchEvent(new Event('fpchat:send-owners-ready174'))").length-1,1,'startup-ready event must be emitted once by MediaSend owner');

const awaitReady=app.indexOf('if(window.FPStartup174?.ready&&!(await FPStartup174.ready))');
assert(awaitReady>=0,'app navigation no longer uses the existing FPStartup174.ready gate');

function harness({lifecycleInstalled,lifecycleReadyFlag}){
  const scripts=[];
  const listeners=new Map();
  let failCount=0;

  const document={
    currentScript:{src:'https://fpchat.test/room-context170.js?v=180.10'},
    querySelector(selector){
      const key=(selector.match(/data-fp-([a-z0-9-]+)/i)||[])[1];
      if(!key)return null;
      const prop=key.replace(/-([a-z0-9])/g,(_,ch)=>ch.toUpperCase());
      return scripts.find(script=>script.dataset&&Object.prototype.hasOwnProperty.call(script.dataset,'fp'+prop[0].toUpperCase()+prop.slice(1)))||null;
    },
    createElement(tag){
      assert.equal(tag,'script');
      return {dataset:{},src:'',onload:null,onerror:null};
    },
    body:{appendChild(script){scripts.push(script);}}
  };

  const window={
    FPStartup174:{fail(){failCount++;}},
    FPRoomLifecycle98Ready:lifecycleReadyFlag,
    FPLifecycle170:lifecycleInstalled?{}:undefined,
    addEventListener(type,fn,options){
      const list=listeners.get(type)||[];
      list.push({fn,once:Boolean(options?.once)});
      listeners.set(type,list);
    },
    dispatchEvent(){return true;}
  };

  const sandbox={
    window,
    document,
    location:{href:'https://fpchat.test/'},
    URL,
    AbortController,
    DOMException,
    performance:{now:()=>1},
    CustomEvent:class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}},
    Map,
    Object,
    String,
    Boolean,
    Error,
    console
  };

  vm.runInNewContext(roomContext,sandbox,{filename:'room-context170.js'});

  function emit(type){
    const list=[...(listeners.get(type)||[])];
    for(const item of list){
      item.fn({type});
      if(item.once){
        const current=listeners.get(type)||[];
        listeners.set(type,current.filter(entry=>entry!==item));
      }
    }
  }

  return {scripts,listeners,emit,get failCount(){return failCount;}};
}

{
  const h=harness({lifecycleInstalled:true,lifecycleReadyFlag:false});
  assert.equal(h.scripts.length,0,'normal path must wait for room-lifecycle readiness');
  assert.equal((h.listeners.get('fpchat:room-lifecycle-ready174')||[]).length,1,'normal path must attach one room-lifecycle readiness listener');

  h.emit('fpchat:room-lifecycle-ready174');
  const expected=['/connection170.js','/sync-coordinator176.js','/room-open170.js','/send-manager177.js','/text-send170.js'];
  for(let i=0;i<expected.length;i++){
    const script=h.scripts[i];
    assert(script,'missing owner transition '+expected[i]);
    assert(script.src.includes(expected[i]),'unexpected owner order: '+script.src+' expected '+expected[i]);
    assert.equal(typeof script.onerror,'function','required owner lacks shared failure connection: '+expected[i]);
    if(i<expected.length-1){
      assert.equal(typeof script.onload,'function','required owner lacks success transition: '+expected[i]);
      script.onload();
    }
  }
  assert.equal(h.scripts.length,expected.length,'normal path attached an owner more than once');
  assert.equal(h.failCount,0,'normal owner sequence unexpectedly failed startup');
}

{
  const h=harness({lifecycleInstalled:false,lifecycleReadyFlag:true});
  assert.equal(h.scripts.length,1,'Lifecycle170 fallback should append exactly one script');
  const lifecycle=h.scripts[0];
  assert(lifecycle.src.includes('/lifecycle170.js'),'wrong fallback owner loaded');
  assert.equal(typeof lifecycle.onload,'function','Lifecycle170 fallback success connection missing');
  assert.equal(typeof lifecycle.onerror,'function','Lifecycle170 fallback failure connection missing');
  lifecycle.onerror();
  assert.equal(h.failCount,1,'Lifecycle170 fallback failure must fail existing startup gate exactly once');
  assert.equal(h.scripts.length,1,'Lifecycle170 fallback failure must not advance to another owner');
}

for(const forbidden of ['AppCoordinator180','FPAppCoordinator180','app-coordinator180.js']){
  assert(![index,app,roomContext,textSend,mediaSend].join('\n').includes(forbidden),'180.10 introduced a second coordinator: '+forbidden);
}

console.log('PASS 180.10 each remaining required owner has one existing init connection');
console.log('PASS 180.10 normal room-lifecycle -> Connection -> Sync -> RoomOpen -> Send -> Text order is unchanged');
console.log('PASS 180.10 Lifecycle170 fallback failure now reports through the same FPStartup174.fail API');
console.log('PASS 180.10 TextSend -> MediaSend -> send-owners-ready completion boundary is unchanged');
console.log('PASS 180.10 business coordination surface remains FPStartup174; no second coordinator was introduced');
