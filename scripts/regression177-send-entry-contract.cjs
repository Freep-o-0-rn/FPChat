'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const textSend=read('public/text-send170.js');
const mediaSend=read('public/media-send170.js');
const voice=read('public/voice.js');
const app=read('public/app.js');
const typing=read('public/typing.js');
const doc=read('docs/Build177_SendEntryPoints.md');

assert(textSend.includes("form.onsubmit = dispatchSubmit;"),'text assigned submit entry must be the 177.18 dispatcher wrapper');
assert(textSend.includes("return manager.dispatch(() => submit(event));"),'text dispatcher must invoke the existing submit executor');
assert(textSend.includes("const sendingForms = new WeakSet();"),'text duplicate guard changed');
assert(textSend.includes("contexts.beginOperation(roomId, 'text-send')"),'text operation context changed');
assert(textSend.includes("const clientMessageId = crypto.randomUUID();"),'text clientMessageId generation changed');
assert(textSend.includes("queuePendingTextSend(outbound)"),'text existing retry handoff changed');
assert(textSend.includes("retryOwner: 'pendingTextSends/app.js'"),'text retry owner declaration changed');

assert(app.includes("const pendingTextSends=new Map()"),'existing text pending map missing');
assert(app.includes("pending.attempts<4"),'existing text retry count changed');
assert(app.includes("},1800)"),'existing text retry interval changed');
assert(app.includes("function resendPendingTextMessages()"),'existing reconnect resend missing');
assert(app.includes("resendPendingTextMessages();"),'reconnect no longer invokes existing text resend');
assert(app.includes("function handleWsMessageAck(payload)"),'text ACK path missing');
assert(app.includes("function handleWsMessageStatus(payload)"),'text status path missing');

assert(mediaSend.includes("sendMediaFromPreview = function sendMediaFromPreview170(root)"),'media entry owner changed');
assert(mediaSend.includes("contexts.beginOperation(context.roomId, 'media-send')"),'media operation context changed');
assert(mediaSend.includes("preview.sending || preview.cancelled || preview.committed"),'media duplicate guard changed');
assert(mediaSend.includes("contexts.cancelOperation(preview.operation, 'user-cancelled')"),'media cancel path changed');
assert(mediaSend.includes("item.uploadId ||= crypto.randomUUID()"),'media stable uploadId retry identity changed');
assert(mediaSend.includes("if (mediaPreviewState === preview && confirm("),'media existing retry prompt changed');
assert(mediaSend.includes("{signal:operation.signal}"),'media upload cancellation signal changed');
assert(!mediaSend.includes('clientMessageId'),'media must not gain text clientMessageId in 177.16');

assert(voice.includes("async function uploadAndSendVoice(data)"),'voice executor changed');
assert(voice.includes("contexts?.beginOperation?.(data.roomId, 'voice-send')"),'voice operation context changed');
assert(voice.includes("signal: operation?.signal"),'voice upload operation signal changed');
assert(voice.includes("if (!preview || uploadInFlight) return;"),'voice duplicate upload guard changed');
assert(voice.includes("const sent = await uploadAndSendVoice(preview);"),'voice preview retry entry changed');
assert(voice.includes("roomId: rec.roomId"),'voice source room capture changed');
assert(voice.includes("showPreview(data);"),'voice failed-send preview fallback missing');
assert(!voice.includes('clientMessageId'),'voice must not gain text clientMessageId in 177.16');

assert(typing.includes("if (event.target?.id !== 'msgInput' || !event.isTrusted) return;"),
  'trusted text typing gate changed');
assert(typing.includes("sendSignal('typing:start', roomId, 'typing')"),'text typing start changed');
assert(typing.includes("if (event.target?.id !== 'sendForm') return;")&&typing.includes("stopLocalTyping();"),
  'text submit typing stop changed');
assert(typing.includes("beginMediaUpload(media.roomId, media.kind);"),'media activity start transport hook missing');
assert(typing.includes("finishMediaUpload(media.roomId, media.kind);"),'media activity finish transport hook missing');
assert(typing.includes("this.addEventListener('abort', finish, { once: true });"),'media abort activity cleanup missing');
assert(typing.includes("this.addEventListener('error', finish, { once: true });"),'media error activity cleanup missing');
assert(voice.includes("startLocalActivity(roomId, 'recording_audio');"),'voice recording activity start changed');
assert(voice.includes("stopLocalActivity('recording_audio');"),'voice recording activity stop changed');
assert(voice.includes("startLocalActivity(data.roomId, 'audio');"),'voice send activity start changed');
assert(voice.includes("stopLocalActivity('audio');"),'voice send activity stop changed');

assert(app.includes("accept='image/*,video/*'"),'current media input scope changed');
assert(app.includes("if(!isImg&&!isVid)continue"),'current image/video media filter changed');

for(const [name,source] of Object.entries({mediaSend,voice,app,typing})){
  assert(!source.includes('FPSendManager177'),name+' unexpectedly transferred to SendManager before its dedicated step');
}
for(const [name,source] of Object.entries({textSend,mediaSend,voice,app,typing})){
  assert(!source.includes('pendingSends'),name+' unexpectedly contains a common pendingSends store');
  assert(!source.includes('sendQueue'),name+' unexpectedly contains a common sendQueue');
}
assert(doc.includes('No common `pendingSends`, `sendQueue`, or cross-type pending store exists.'),
  '177.16 contract must explicitly document absence of common pending store');

console.log('PASS text entry/context/retry/clientMessageId/activity contract documented');
console.log('PASS media entry/context/retry/cancel/uploadId/activity contract documented');
console.log('PASS voice entry/context/retry/cancel/activity contract documented');
console.log('PASS no SendManager, common submit owner, or cross-type pending store introduced');
console.log('PASS current generic file-send path is not assumed');
