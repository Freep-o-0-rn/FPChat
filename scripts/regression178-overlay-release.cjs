'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const context=read('public/message-context.js');
const dom=read('public/dom-lifecycle173.js');
const layer=read('public/layer-manager173.js');

function exactFn(source,name){
  const m=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(source);
  assert(m,'function missing: '+name);
  const start=m.index;
  const paramsEnd=source.indexOf(')',start);
  assert(paramsEnd>=0,'function parameters missing: '+name);
  const brace=source.indexOf('{',paramsEnd);
  let depth=0;
  for(let i=brace;i<source.length;i+=1){
    if(source[i]==='{')depth+=1;
    else if(source[i]==='}'){depth-=1;if(depth===0)return source.slice(start,i+1);}
  }
  assert.fail('function end missing: '+name);
}

const close=exactFn(context,'closeContext');
const cancelTouch=exactFn(context,'cancelContextTouch178');
const boundary=exactFn(context,'closeContextBoundary178');

// Existing controller still owns UI close; no manual layer release.
assert(close.includes('current.root?.remove();'),'closeContext no longer removes the context root');
assert(close.includes("document.body.classList.remove('message-context-open');"),'closeContext no longer clears body UI state');
assert(close.includes('cleanupViewerReturn();'),'closeContext no longer cleans viewer-return resources');
assert(!close.includes('FPLayer173'),'closeContext started manually mutating layer state');

// Gesture cleanup is bounded to the recognizer. Once context opened, a browser
// touchcancel only ends the gesture lease; the context layer owns its own close.
assert(cancelTouch.includes('clearTimeout(session.timer);'),'touch cleanup no longer clears long-press timer');
assert(cancelTouch.includes('touchSession = null;'),'touch cleanup no longer releases its session');
assert(!cancelTouch.includes('closeContext('),'gesture cleanup can still destroy an opened context');
assert(context.includes("document.addEventListener('touchend', () => {\n    cancelContextTouch178();"),'touchend no longer uses shared cleanup');
assert(context.includes("document.addEventListener('touchcancel', () => {\n    cancelContextTouch178();"),'touchcancel no longer preserves an opened context');

// Viewport geometry belongs to FPContextLayout189. Browser resize must relayout
// an active context rather than interpret iOS/WebKit viewport settling as close.
assert(context.includes("window.FPContextLayout189.relayout(contextState.root, 'viewport-resize');"),'window resize no longer delegates active context geometry');
assert(context.includes('if (!contextState) return;'),'window resize guard missing');

// Navigation: chat DOM unmount cancels pending long press and closes body-level context.
assert(context.includes("window.FPDOM173?.on?.('chat', 'unmounted', () => {\n    closeContextBoundary178();"),'chat unmount boundary missing');
assert(boundary.includes('cancelContextTouch178();'),'navigation boundary does not cancel pending long press');
assert(boundary.includes('if (contextState) closeContext({ restoreScroll: false });'),'navigation boundary does not close active context');

// Lifecycle: hidden/page teardown cannot carry a stale context claim to the next screen/resume.
assert(context.includes("['background', 'pagehide', 'beforeunload'].includes(event?.lastType)"),'lifecycle boundary list changed');
assert(context.includes('window.FPLifecycle170?.subscribe?.((event) => {'),'lifecycle owner subscription missing');

// Claim release remains DOM-driven: context removal emits unmounted and FPLayer173 drops dom:context.
assert(dom.includes("context: '.message-context-root'"),'FPDOM173 context selector changed');
assert(dom.includes("for (const node of record.removedNodes || []) processNode(node, 'unmounted');"),'FPDOM173 removed-node lifecycle changed');
assert(layer.includes("dom.on(kind, 'unmounted', (detail) => onUnmounted(kind, layer, detail));"),'FPLayer173 no longer consumes DOM unmount');
assert(layer.includes('mounted[kind].delete(detail.node);'),'FPLayer173 context node is not removed from mounted set');
assert(layer.includes('setClaim(layer, `dom:${kind}`, Boolean(set?.size));'),'FPLayer173 mounted claim release rule changed');

// No second stack or manual claim release added to the feature controller.
assert(!context.includes('FPLayer173.claim('),'message context introduced manual claim');
assert(!context.includes('FPLayer173.setClaim('),'message context introduced manual setClaim/release');

console.log('PASS 178.17 close removes context DOM and keeps claim release DOM-driven');
console.log('PASS touchcancel releases the long-press gesture without closing an opened context');
console.log('PASS resize delegates active context geometry to FPContextLayout189');
console.log('PASS chat navigation/unmount closes body-level context and cancels pending context gesture');
console.log('PASS background/pagehide/beforeunload close stale context before later interaction');
