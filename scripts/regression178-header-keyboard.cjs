'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const viewport=read('public/viewport-fix.js');
const app=read('public/app.js');
const keyboard=read('public/viewport-layout136.js');
const styles=read('public/styles.css');

assert(viewport.includes('function syncViewportCorrectionNow() {'),'immediate viewport correction helper missing');
assert(viewport.includes('requestedViewportCorrection(),'),'existing viewport correction formula source changed');
assert(viewport.includes('Math.max(0, Number(window.innerHeight) || 1200),'),'existing viewport correction clamp changed');
assert(viewport.includes("app.style.setProperty('--fpchat-viewport-correction-y', `${Math.round(correctionY)}px`);"),'correction output formula changed');
assert(viewport.includes('function handleVisualViewportChange() {'),'visual viewport change handler missing');
assert(viewport.includes('if (composerIsFocused() && chatIsOpen()) syncViewportCorrectionNow();'),'keyboard-focused immediate correction gate missing');
assert(viewport.includes("viewport?.addEventListener('resize', handleVisualViewportChange, { passive: true });"),'visualViewport resize no longer uses immediate correction handler');
assert(viewport.includes("viewport?.addEventListener('scroll', handleVisualViewportChange, { passive: true });"),'visualViewport scroll no longer uses immediate correction handler');

const helperStart=viewport.indexOf('function syncViewportCorrectionNow()');
const helperEnd=viewport.indexOf('\n  function syncViewportNow()',helperStart);
const helper=viewport.slice(helperStart,helperEnd);
assert(!helper.includes('scrollTop'),'header stabilization started writing message scroll');
assert(!helper.includes('requestBottom'),'header stabilization started requesting message bottom');
assert(!helper.includes('--fpchat-visible-height'),'header stabilization started changing viewport height in the immediate path');

assert(app.includes('window.FPScroll173=scrollCoordinator;'),'FPScroll173 owner changed');
assert(keyboard.includes('const threshold = Math.max(110, baselineHeight * 0.16);'),'keyboard threshold changed');
assert(keyboard.includes('padding-bottom: 8px !important;'),'keyboard composer padding changed');
assert(styles.includes('calc(8px + env(safe-area-inset-bottom))'),'default safe-area formula changed');

console.log('PASS 178.28.1 visualViewport keyboard events apply existing Y correction before the next animation frame');
console.log('PASS 178.28.1 immediate path changes only appRoot viewport correction, not message scroll/height');
console.log('PASS 178.28.1 keyboard threshold and safe-area formulas remain unchanged');
