'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const selection=fs.readFileSync(path.join(root,'public/message-selection.js'),'utf8').replace(/\r\n/g,'\n');
const dom=fs.readFileSync(path.join(root,'public/dom-lifecycle173.js'),'utf8').replace(/\r\n/g,'\n');
const indexHtml=fs.readFileSync(path.join(root,'public/index.html'),'utf8').replace(/\r\n/g,'\n');

function fn(source,name){
  const wrapped='\n'+source;
  const m=new RegExp('\\n\\s*(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(wrapped);
  assert(m,'function missing: '+name);
  const start=Math.max(0,m.index-1);
  const rest=source.slice(start+1);
  const next=/\n\s*(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/g;
  next.lastIndex=1;
  const n=next.exec(rest);
  return n?rest.slice(0,n.index):rest;
}

const createAction=fn(selection,'createActionButton');
const decorate=fn(selection,'decorateContext');

assert(selection.includes("window.FPDOM173.on('context', 'mounted', ({ node }) => decorateContext(node));"),'selection decorator is not connected through FPDOM173 context:mounted');
assert(decorate.includes("let select = menu.querySelector('[data-fp-message-action=\"select\"]');"),'decorator no longer checks for an existing select action');
assert(decorate.includes('if (!select) {'),'decorator no longer guards creation');
assert(decorate.includes('select = createActionButton();'),'decorator no longer uses the existing action factory');
assert(createAction.includes("button.addEventListener('click', (event) => {"),'selection action click bind changed');
assert((createAction.match(/addEventListener\('click'/g)||[]).length===1,'selection action binds click more than once in its factory');

// This one decorator owns no external per-node registry/resource.
assert(!/new\s+(?:Map|Set|WeakMap|WeakSet)\s*\(/.test(decorate),'context decorator introduced an external per-node registry');
assert(!decorate.includes('MutationObserver'),'context decorator introduced its own observer');
assert(!decorate.includes('document.addEventListener'),'context decorator introduced a global per-node listener');

// FPDOM173 remains the single normal DOM lifecycle observer.
assert((dom.match(/new MutationObserver\(/g)||[]).length===1,'FPDOM173 no longer has exactly one lifecycle observer');
assert(dom.includes("observer.observe(document.body || document.documentElement, { childList: true, subtree: true });"),'FPDOM173 lifecycle observer scope changed');

// The legacy observer is only the compatibility branch when FPDOM173 is unavailable.
const ownerBranch=selection.indexOf('if (window.FPDOM173?.on) {');
const fallback=selection.indexOf('} else {',ownerBranch);
const fallbackObserver=selection.indexOf('const observer = new MutationObserver',fallback);
assert(ownerBranch>=0&&fallback>ownerBranch&&fallbackObserver>fallback,'legacy MutationObserver escaped the FPDOM173 fallback branch');

// Startup order: DOM owner before app; selection listener before message-context creates contexts.
const preloadStart=indexHtml.indexOf("const preload174 = [");
const preloadEnd=indexHtml.indexOf("];",preloadStart);
assert(preloadStart>=0&&preloadEnd>preloadStart,'startup preload174 list missing');
const preload=indexHtml.slice(preloadStart,preloadEnd);
const domPos=preload.indexOf("'dom-lifecycle173.js'");
const appPos=preload.indexOf("'app.js'");
assert(domPos>=0&&appPos>domPos,'FPDOM173 is no longer preloaded before app.js');
assert(indexHtml.includes("'app.js':['room-context170.js','lifecycle170.js','network171.js','message-store172.js','dom-lifecycle173.js','layer-manager173.js','work174.js','history174.js']"),'app startup dependency no longer requires FPDOM173');
const loadContextStart=indexHtml.indexOf('const loadContextStack = () => {');
const loadContextEnd=indexHtml.indexOf('\n          };',loadContextStart);
assert(loadContextStart>=0&&loadContextEnd>loadContextStart,'message context stack loader missing');
const loadContext=indexHtml.slice(loadContextStart,loadContextEnd);
assert(loadContext.includes("messageContext.src = `/message-context.js${buildSuffix}`;"),'message-context load left the gated context stack');
assert(indexHtml.includes('messageSelection.onload = loadContextStack;'),'message-selection success no longer gates message-context');
assert(indexHtml.includes('messageSelection.onerror = loadContextStack;'),'message-selection compatibility failure no longer continues context stack');

// Mini semantic check of the actual decorator source: repeated mount of the same
// context must reuse the same action button and therefore the same click bind.
class FakeClassList{contains(){return false;}}
class FakeButton{
  constructor(){this.dataset={};this.classList=new FakeClassList();this.listeners=[];this.nextElementSibling=null;}
  addEventListener(type,handler){this.listeners.push({type,handler});}
}
class FakeMenu{
  constructor(){this.children=[];}
  querySelector(sel){
    if(sel==='[data-fp-message-action="select"]')return this.children.find(x=>x.dataset?.fpMessageAction==='select')||null;
    if(sel==='[data-fp-message-action="delete"]')return null;
    return null;
  }
  appendChild(node){this.children.push(node);return node;}
  insertBefore(node){return node;}
}
class FakeElement{
  constructor(menu,clone){this.menu=menu;this.clone=clone;}
  querySelector(sel){if(sel==='.message-context-menu')return this.menu;if(sel==='.message-context-copy')return this.clone;return null;}
}
const documentStub={createElement(){return new FakeButton();}};
const factory=new Function('document','Element','selection','MENU','ROOT','COPY','messageId','closeContext','requestAnimationFrame','startSelection',
  createAction+'\n'+decorate+'\nreturn {decorateContext};');
const api=factory(documentStub,FakeElement,null,'.message-context-menu','.message-context-root','.message-context-copy',()=>123,()=>{},fn=>fn(),()=>{});
const menu=new FakeMenu();
const clone={classList:new FakeClassList()};
const context=new FakeElement(menu,clone);
api.decorateContext(context);
api.decorateContext(context);
assert.equal(menu.children.length,1,'same context node received duplicate selection action');
assert.equal(menu.children[0].listeners.filter(x=>x.type==='click').length,1,'same decorator action received duplicate click bind');

console.log('PASS 178.10 selection context decorator enters through FPDOM173');
console.log('PASS repeated mount of the same context keeps one action and one click bind');
console.log('PASS decorator has no external per-node resource to leak after context unmount');
console.log('PASS legacy MutationObserver remains fallback-only; FPDOM173 is the normal observer owner');
