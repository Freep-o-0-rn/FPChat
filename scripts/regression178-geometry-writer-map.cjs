'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');

const app=read('public/app.js');
const viewport=read('public/viewport-fix.js');
const keyboard=read('public/viewport-layout136.js');
const styles=read('public/styles.css');
const chatFix=read('public/chat-fix.js');
const swipe=read('public/swipe-fix.js');
const settings=read('public/settings-ui131.js');
const context=read('public/message-context.js');
const actions=read('public/message-actions.js');

// #messages.scrollTop belongs to FPScroll173. 178.23 removed message-actions direct writes.
assert(app.includes("window.FPScroll173=scrollCoordinator;"),'FPScroll173 export missing');
assert(app.includes("write(box,top,behavior='auto')"),'FPScroll173 central writer missing');
assert(app.includes("else box.scrollTop=next;"),'FPScroll173 normal direct executor changed');
const removalStart=actions.indexOf('function keepViewportWhileRemoving(box, el)');
const removalEnd=actions.indexOf('function clearReplyDraftIfNeeded',removalStart);
assert(removalStart>=0&&removalEnd>removalStart,'message removal viewport helper missing');
assert(!/box\.scrollTop\s*=/.test(actions.slice(removalStart,removalEnd)),'message-actions reintroduced a direct #messages writer');
assert(viewport.includes('window.FPScroll173.requestBottom(box);'),'viewport bottom pin no longer prefers FPScroll173');
assert(viewport.includes('box.scrollTop = box.scrollHeight;'),'known viewport compatibility fallback disappeared outside its own migration step');

// Viewport numeric geometry: viewport-fix.js is the writer of both CSS variables.
assert(viewport.includes("app.style.setProperty('--fpchat-visible-height'"),'visible-height writer missing');
assert(viewport.includes("app.style.setProperty('--fpchat-viewport-correction-y'"),'viewport-correction writer missing');
assert(viewport.includes("app.style.removeProperty('--fpchat-visible-height')"),'visible-height cleanup missing');
assert(viewport.includes("app.style.removeProperty('--fpchat-viewport-correction-y')"),'viewport-correction cleanup missing');
assert(!keyboard.includes("setProperty('--fpchat-visible-height'"),'keyboard-state owner started writing visible-height');
assert(!keyboard.includes("setProperty('--fpchat-viewport-correction-y'"),'keyboard-state owner started writing viewport correction');

// CSS consumes the viewport variables; this is not a second JS geometry writer.
assert(viewport.includes('height: var(--fpchat-visible-height, 100dvh) !important;'),'appRoot height no longer consumes visible-height variable');
assert(viewport.includes('transform: translate3d(0, var(--fpchat-viewport-correction-y, 0px), 0);'),'appRoot transform no longer consumes correction variable');

// Keyboard state is a separate state property owned by FPViewport136.
assert(keyboard.includes("root.classList.toggle('fp-keyboard-open', next);"),'keyboard open class writer missing');
assert(keyboard.includes("root.dataset.fpKeyboard = next ? 'open' : 'closed';"),'keyboard dataset writer missing');
assert(keyboard.includes("root.classList.add(opening ? 'fp-keyboard-opening' : 'fp-keyboard-closing');"),'keyboard transition-state writer missing');
assert(keyboard.includes('window.FPViewport136 = Object.freeze({'),'FPViewport136 public owner missing');
assert(!keyboard.includes('box.scrollTop ='),'keyboard-state owner started writing message scroll');

// Keyboard CSS geometry is conditional CSS driven by keyboard state.
assert(keyboard.includes('html.fp-os-ios.fp-keyboard-open #appRoot.fpchat-mobile-chat-viewport .chat-view .composer'),'keyboard composer CSS selector missing');
assert(keyboard.includes('padding-bottom: 8px !important;'),'keyboard composer padding rule changed');
assert(keyboard.includes('html.fp-os-ios.fp-keyboard-open #appRoot.fpchat-mobile-chat-viewport .chat-view .new-messages-pill'),'keyboard pill CSS selector missing');
assert(keyboard.includes('bottom: 66px !important;'),'keyboard pill bottom rule changed');

// Safe-area geometry is static CSS/browser env input, not a JS viewport writer.
assert(styles.includes('env(safe-area-inset-bottom)'),'safe-area CSS input missing');
assert(styles.includes('.composer{')&&styles.includes('calc(8px + env(safe-area-inset-bottom))'),'composer default safe-area rule changed');

// Composer textarea height is a different property/subsystem with its established two-role writers.
assert(app.includes('function autoResizeMessageInput(input)'),'composer autosize owner missing');
assert(app.includes('input.style.height=`${lineHeight}px`;'),'composer autosize base height write missing');
assert(app.includes('input.style.height=`${Math.max(lineHeight,nextHeight)}px`;'),'composer autosize calculated height write missing');
assert(chatFix.includes("if (!input || !input.isConnected || input.value !== '') return false;"),'empty-composer guard changed');
assert(chatFix.includes('input.style.height = `${lineHeight}px`;'),'empty-composer height reset missing');

// Settings transform is gesture geometry, not viewport geometry.
assert(swipe.includes("const modernSettingsRoot = () => document.querySelector('.fp-settings131');"),'active settings gesture root missing');
assert(swipe.includes('root.style.transform = `translate3d(${x}px,0,0)`;'),'active settings gesture transform missing');
const backSwipeRefs=(settings.match(/installBackSwipe\s*\(/g)||[]).length;
assert.equal(backSwipeRefs,1,'settings-ui131 installBackSwipe became active/called again');

// Legacy chat transform is an explicit gesture fallback only when FPGesture135 is absent.
assert(app.includes('if(window.FPGesture135)return;'),'legacy chat transform fallback lost its gesture-owner guard');
assert(app.includes('chatView.style.transform=`translateX(${translate}px)`;'),'legacy chat fallback transform missing');

// message-context direct scroll belongs to a distinct overlay scroll container.
assert(context.includes("const scroll = root.querySelector('.message-context-scroll');"),'message-context scroll container missing');
assert(context.includes('scroll.scrollTop = Math.min('),'message-context overlay scroll write missing');

// Public owner map must continue distinguishing these three responsibilities.
assert(viewport.includes("geometry: 'viewport-fix158'"),'FPViewport173 geometry owner label changed');
assert(viewport.includes("keyboardState: 'FPViewport136'"),'FPViewport173 keyboard-state owner label changed');
assert(viewport.includes("messageScroll: 'FPScroll173'"),'FPViewport173 message-scroll owner label changed');

console.log('PASS 178.26 #messages scroll, keyboard state and viewport CSS geometry remain separate properties');
console.log('PASS 178.26 viewport numeric CSS variables each have one active JS writer');
console.log('PASS 178.26 safe-area and keyboard-dependent CSS are consumers/rules, not competing JS writers');
console.log('PASS 178.26 composer and gesture geometry are mapped separately from viewport ownership');
console.log('PASS 178.26 no competing same-property viewport geometry writer is proven by this audit');
