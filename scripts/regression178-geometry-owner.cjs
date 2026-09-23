'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const publicDir=path.join(root,'public');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');

const viewport=read('public/viewport-fix.js');
const keyboard=read('public/viewport-layout136.js');
const styles=read('public/styles.css');

function walk(dir){
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...walk(full));
    else if(entry.isFile()&&/\.(?:js|css)$/.test(entry.name))out.push(full);
  }
  return out;
}

function relative(file){return path.relative(root,file).replace(/\\/g,'/');}
function writersForCssVar(variable){
  const hits=[];
  for(const file of walk(publicDir)){
    if(!file.endsWith('.js'))continue;
    const source=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
    const lines=source.split('\n');
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(line.includes(`setProperty('${variable}'`)||line.includes(`setProperty("${variable}"`)||
         line.includes(`removeProperty('${variable}'`)||line.includes(`removeProperty("${variable}"`)){
        hits.push({file:relative(file),line:i+1,text:line.trim()});
      }
    }
  }
  return hits;
}

const visibleHeightWriters=writersForCssVar('--fpchat-visible-height');
const correctionWriters=writersForCssVar('--fpchat-viewport-correction-y');
assert(visibleHeightWriters.length>=2,'visible-height set/remove writer contract missing');
assert(correctionWriters.length>=2,'viewport-correction set/remove writer contract missing');
assert(visibleHeightWriters.every(hit=>hit.file==='public/viewport-fix.js'),
  'proved competing writer for --fpchat-visible-height: '+JSON.stringify(visibleHeightWriters));
assert(correctionWriters.every(hit=>hit.file==='public/viewport-fix.js'),
  'proved competing writer for --fpchat-viewport-correction-y: '+JSON.stringify(correctionWriters));

// Preserve the existing viewport formulas instead of changing them to satisfy the build number.
assert(viewport.includes('if (Number.isFinite(visualHeight) && visualHeight > 240) return visualHeight;'),
  'raw visual viewport threshold changed');
assert(viewport.includes('return Math.max(240, Number(window.innerHeight) || document.documentElement.clientHeight || 240);'),
  'raw viewport fallback formula changed');
assert(viewport.includes('return reference - candidate >= Math.max(STALE_VIEWPORT_MIN_GAP_PX, reference * 0.16);'),
  'stale viewport gap formula changed');
assert(viewport.includes('const STALE_VIEWPORT_MIN_GAP_PX = 120;'),
  'stale viewport minimum gap changed');
assert(viewport.includes('const BOTTOM_PIN_MS = 1500;'),
  'keyboard bottom-pin duration changed');
assert(viewport.includes("app.style.setProperty('--fpchat-visible-height', `${Math.ceil(currentVisibleHeight())}px`);"),
  'visible-height output formula changed');
assert(viewport.includes('Math.max(0, Number(window.innerHeight) || 1200),'),
  'viewport correction clamp changed');
assert(viewport.includes('requestedViewportCorrection(),'),
  'viewport correction source changed');
assert(viewport.includes("app.style.setProperty('--fpchat-viewport-correction-y', `${Math.round(correctionY)}px`);"),
  'viewport correction output formula changed');

// Preserve keyboard-state formulas and CSS reactions.
assert(keyboard.includes('const obscured = Math.max(0, baselineHeight - height);'),
  'keyboard obscured-height formula changed');
assert(keyboard.includes('const threshold = Math.max(110, baselineHeight * 0.16);'),
  'keyboard detection threshold changed');
assert(keyboard.includes('applyKeyboardState(Boolean(focused && obscured >= threshold));'),
  'keyboard open decision changed');
assert(keyboard.includes('padding-bottom: 8px !important;'),
  'iOS keyboard composer padding changed');
assert(keyboard.includes('bottom: 66px !important;'),
  'iOS keyboard new-message-pill position changed');

// Preserve default safe-area formulas.
assert(styles.includes('.composer{')&&styles.includes('padding:8px 12px calc(8px + env(safe-area-inset-bottom));'),
  'default composer safe-area formula changed');
assert(styles.includes('padding-top:calc(12px + env(safe-area-inset-top))'),
  'mobile top safe-area formula changed');
assert(styles.includes('padding-bottom:calc(12px + env(safe-area-inset-bottom))'),
  'chat-list bottom safe-area formula changed');

// The known viewport-fix direct scroll is not viewport geometry and must not justify this migration.
assert(viewport.includes('window.FPScroll173.requestBottom(box);'),
  'keyboard bottom pin no longer prefers the message-scroll owner');
assert(viewport.includes('box.scrollTop = box.scrollHeight;'),
  'known message-scroll compatibility fallback moved during geometry-only 178.27');

console.log('PASS 178.27 no second active JS writer exists for either viewport numeric CSS property');
console.log('PASS 178.27 no runtime writer migration is justified without a same-property competitor');
console.log('PASS 178.27 existing viewport, keyboard and safe-area formulas remain unchanged');
console.log('PASS 178.27 known message-scroll fallback remains classified separately');
