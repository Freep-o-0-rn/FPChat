/* Build 174: a bidirectional, bounded message window.
   MessageStore172 owns content, RoomContext170 owns cancellation, FPScroll173
   owns every scroll write. This module owns only the mounted history range. */
(() => {
  if(window.FPHistory174)return;
  const LIMIT=300, PAGE=100;
  let requests=0,evictions=0,jumps=0;
  const nodes=box=>Array.from(box?.querySelectorAll(':scope > .bubble-wrap.msg')||[]);
  const id=node=>Number(node?.dataset.messageId||0);
  const unread=box=>nodes(box).filter(n=>n.dataset.incoming==='1'&&n.dataset.read==='0').length;
  const valid=view=>isRoomViewCurrent170(view);
  const pending=roomId=>window.FPMessageStore172?.pending(roomId)||[];

  async function page(view,params={},signal=view.context?.signal){
    if(!valid(view))throw new DOMException('Stale room','AbortError');
    const deviceId=STORAGE.get(STORAGE.roomState(view.roomId))?.deviceId;
    const query=new URLSearchParams({deviceId:String(deviceId),limit:String(PAGE),...params});
    requests++;
    const response=await fetch(`/api/rooms/${encodeURIComponent(view.roomId)}/messages?${query}`,{cache:'no-store',signal});
    if(!response.ok)throw Error(`History ${response.status}`);
    const data=await response.json();
    if(!valid(view))throw new DOMException('Stale room','AbortError');
    if(!Array.isArray(data.messages))throw Error('Invalid history page');
    return data;
  }
  async function around(view,anchor,signal){
    if(!anchor)return {...await page(view,{},signal),hasNewer:false};
    // Existing indexed before/after APIs also enforce room membership and deletes.
    const [older,newer]=await Promise.all([
      page(view,{before:String(anchor+1)},signal),page(view,{after:String(anchor)},signal)
    ]);
    const messages=[...new Map([...older.messages,...newer.messages].map(m=>[Number(m.id),m])).values()].sort((a,b)=>Number(a.id)-Number(b.id));
    return {...older,messages,hasNewer:Boolean(newer.hasMore)};
  }
  async function hydrate(view,data){
    const seed=Array.isArray(data.messages)?data.messages:[];
    data.latestMessage174=seed.at(-1)||null;
    const anchor=getInitialScrollTargetId(data);
    if(anchor&&!seed.some(m=>Number(m.id)===anchor)){
      const result=await around(view,anchor,view.context?.signal);
      if(!valid(view))return;
      Object.assign(data,{messages:result.messages,hasMore:result.hasMore,nextCursor:result.nextCursor,hasNewer:result.hasNewer});
    }else if(seed.length>LIMIT){
      const index=anchor?seed.findIndex(m=>Number(m.id)===anchor):-1;
      const start=index<0?seed.length-LIMIT:Math.max(0,Math.min(index-PAGE,seed.length-LIMIT));
      data.messages=seed.slice(start,start+LIMIT);
      data.hasNewer=start+LIMIT<seed.length;
      data.hasMore=start>0||Boolean(data.hasMore);
      data.nextCursor=Number(data.messages[0]?.id)||null;
    }
  }
  function dispose(node){
    node.dataset.fpEvicted174='1';
    try{unreadVisibleObserver?.unobserve(node);}catch{}
    for(const image of node.querySelectorAll('img')){
      if(image.src.startsWith('blob:'))URL.revokeObjectURL(image.src);
    }
    node.remove();evictions++;
  }
  function syncRange(history,box){
    const mounted=nodes(box),numeric=mounted.map(id).filter(n=>Number.isSafeInteger(n)&&n>0);
    history.loadedMessageIds=new Set(numeric);
    history.oldestMessageId=numeric[0]||null;
    if(numeric.length){history.nextCursor=numeric[0];history.newerCursor=numeric.at(-1);}
    const local=pending(history.roomId),index=new Map(local.map((r,i)=>[r.clientMessageId,i]));
    const indices=mounted.map(n=>index.get(n.dataset.clientMessageId||n.dataset.messageId)).filter(i=>i!==undefined);
    history.localOlder174=indices.length?Math.min(...indices)>0:false;
    history.localNewer174=local.length>0&&(!indices.length||Math.max(...indices)<local.length-1);
  }
  function restoreAnchor(box,anchor){
    if(anchor)restoreMessagesViewState(box,anchor);
  }
  function trim(direction='newer'){
    const history=activeChatHistory,box=document.getElementById('messages');
    if(!history||!isCurrentMessagesBox(box)||scrollCoordinator.isOpening())return;
    const mounted=nodes(box);
    if(mounted.length<=LIMIT){syncRange(history,box);return;}
    const anchor=getFirstVisibleMessageAnchor(box);
    const total=unread(box)+history.unloadedUnreadCount;
    const rect=box.getBoundingClientRect();
    let lastRemovedNumeric=0;
    // Pending sends remain in the canonical store and existing retry owner.
    // Their offscreen DOM is paged locally, just like server-backed history.
    while(mounted.length>LIMIT){
      const candidates=direction==='older'?[...mounted].reverse():mounted;
      let candidate=candidates[0];
      if(!candidate)break;
      const r=candidate.getBoundingClientRect();
      let side=direction;
      if(r.bottom>=rect.top&&r.top<=rect.bottom){candidate=candidates.at(-1);side=direction==='older'?'newer':'older';}
      const numeric=Number.isSafeInteger(id(candidate))&&id(candidate)>0;
      if(numeric)lastRemovedNumeric=Math.max(lastRemovedNumeric,id(candidate));
      dispose(candidate);
      mounted.splice(mounted.indexOf(candidate),1);
      if(numeric){if(side==='older')history.hasNewer=true;else history.hasMore=true;}
    }
    syncRange(history,box);
    if(!history.oldestMessageId&&lastRemovedNumeric)history.nextCursor=lastRemovedNumeric+1;
    history.unloadedUnreadCount=Math.max(0,total-unread(box));
    rebuildDateSeparators(box);syncUnreadDivider(box);restoreAnchor(box,anchor);
  }
  async function render(view,messages,deviceId,current){
    const scratch=document.createElement('div');
    try{
      await FPWork174.each(messages,async message=>{
        const record=window.FPMessageStore172?.get(view.roomId,message.id);
        if(record?.deleted)return;
        const text=await decryptText(message.iv,message.ciphertext,view.key).catch(()=>'[cannot decrypt]');
        if(!current())return;
        if(window.FPMessageStore172?.get(view.roomId,message.id)?.deleted)return;
        const node=appendMessage(scratch,{...message,status:getEffectiveMessageStatus(view.roomId,message)},text,message.sender_device_id===deviceId,false);
        if(node)node.dataset.fpStoreVersion174=String(window.FPMessageStore172?.get(view.roomId,message.id)?.version||0);
      },{current});
      if(!current())throw new DOMException('Stale history window','AbortError');
      return scratch;
    }catch(error){nodes(scratch).forEach(dispose);throw error;}
  }
  function reconcileBeforeMount(view,scratch,deviceId){
    // An earlier node can become stale while later nodes decrypt. Reconcile
    // the entire prepared window synchronously at the actual mount boundary.
    for(const node of nodes(scratch)){
      const record=window.FPMessageStore172?.get(view.roomId,node.dataset.messageId);
      if(!record)continue;
      if(record.deleted){dispose(node);continue;}
      if(String(record.version)===node.dataset.fpStoreVersion174)continue;
      const holder=document.createElement('div');
      const message={...record.raw,id:record.id||record.clientMessageId,status:record.status,edited_at:record.editedAt,reply_to_message_id:record.replyToMessageId};
      const replacement=appendMessage(holder,message,record.text,message.sender_device_id===deviceId,false);
      if(replacement)node.replaceWith(replacement);
      dispose(node);
    }
  }
  function transaction(history,view){
    history.request174?.abort();
    const controller=new AbortController();
    history.request174=controller;
    history.loading=true;
    const cancel=()=>controller.abort();
    view.context?.signal.addEventListener('abort',cancel,{once:true});
    return {
      signal:controller.signal,
      current:()=>valid(view)&&activeChatHistory===history&&history.request174===controller&&!controller.signal.aborted,
      finish(){view.context?.signal.removeEventListener('abort',cancel);if(history.request174===controller){history.loading=false;history.request174=null;}}
    };
  }
  function finishMount(history,box,total){
    syncRange(history,box);
    history.unloadedUnreadCount=Math.max(0,total-unread(box));
    rebuildDateSeparators(box);refreshReplyBlocks(box);syncUnreadDivider(box);
    resumeUnreadObservation(box);
    const received=nodes(box).filter(n=>n.dataset.incoming==='1'&&n.dataset.status==='sent').map(id).filter(Boolean);
    if(received.length)markMessagesReceived(history.roomId,history.deviceId,received);
    updateUnreadIndicators();
  }
  async function load(direction){
    const history=activeChatHistory,box=document.getElementById('messages');
    if(!history||!isCurrentMessagesBox(box)||history.loading||scrollCoordinator.isOpening())return false;
    const local=pending(history.roomId);
    const index=new Map(local.map((r,i)=>[r.clientMessageId,i]));
    const mountedLocal=nodes(box).map(n=>index.get(n.dataset.clientMessageId||n.dataset.messageId)).filter(i=>i!==undefined);
    const first=mountedLocal.length?Math.min(...mountedLocal):local.length;
    const last=mountedLocal.length?Math.max(...mountedLocal):-1;
    if(direction==='older'&&mountedLocal.length&&first>0)return loadPending(history,box,local.slice(Math.max(0,first-PAGE),first),direction);
    if(direction==='newer'&&!history.hasNewer&&last<local.length-1)return loadPending(history,box,local.slice(last+1,last+1+PAGE),direction);
    if(direction==='older'?!history.hasMore:!history.hasNewer)return false;
    const cursor=direction==='older'?history.nextCursor:history.newerCursor;
    if(!Number.isSafeInteger(cursor)||cursor<=0)return false;
    const view=captureRoomView170(),task=transaction(history,view);
    try{
      const data=await page(view,{[direction==='older'?'before':'after']:String(cursor)},task.signal);
      if(!task.current())return false;
      const existing=new Set(nodes(box).map(n=>String(n.dataset.messageId)));
      const unique=data.messages.filter(m=>!existing.has(String(m.id)));
      const scratch=await render(view,unique,history.deviceId,task.current);
      if(!task.current()){nodes(scratch).forEach(dispose);return false;}
      reconcileBeforeMount(view,scratch,history.deviceId);
      const anchor=getFirstVisibleMessageAnchor(box),total=unread(box)+history.unloadedUnreadCount;
      const fragment=document.createDocumentFragment();while(scratch.firstChild)fragment.appendChild(scratch.firstChild);
      if(direction==='older')box.insertBefore(fragment,box.querySelector('.bubble-wrap.msg'));
      else box.appendChild(fragment);
      if(direction==='older'){history.hasMore=Boolean(data.hasMore);history.nextCursor=Number(data.nextCursor)||cursor;}
      else{history.hasNewer=Boolean(data.hasMore);history.newerCursor=Number(data.nextCursor)||cursor;}
      finishMount(history,box,total);restoreAnchor(box,anchor);trim(direction);
      // A page can contain only canonical tombstones. Advance the API cursor
      // even when none of those records produced a mounted node.
      const next=Number(data.nextCursor)||Number(direction==='older'?data.messages[0]?.id:data.messages.at(-1)?.id);
      if(Number.isSafeInteger(next)&&next>0)history[direction==='older'?'nextCursor':'newerCursor']=next;
      scheduleViewStateSave();
      return unique.length>0;
    }catch(error){if(error.name!=='AbortError')console.warn('History window load failed',error);return false;}
    finally{task.finish();}
  }
  async function loadPending(history,box,records,direction){
    const view=captureRoomView170(),task=transaction(history,view),scratch=document.createElement('div');
    try{
      await FPWork174.each(records,record=>{
        if(findMessageElement(record.id,record.clientMessageId))return;
        appendMessage(scratch,{...record.raw,id:record.id||record.clientMessageId,status:record.status},record.text,true,false);
      },{current:task.current});
      if(!task.current())return false;
      reconcileBeforeMount(view,scratch,history.deviceId);
      const anchor=getFirstVisibleMessageAnchor(box),total=unread(box)+history.unloadedUnreadCount;
      const fragment=document.createDocumentFragment();while(scratch.firstChild)fragment.appendChild(scratch.firstChild);
      if(direction==='older')box.insertBefore(fragment,nodes(box).find(n=>!Number.isSafeInteger(id(n)))||null);
      else box.appendChild(fragment);
      finishMount(history,box,total);restoreAnchor(box,anchor);trim(direction);return true;
    }finally{nodes(scratch).forEach(dispose);task.finish();}
  }
  function jump(anchor=0){
    const history=activeChatHistory;
    if(anchor||!history)return jumpWindow(anchor);
    if(history.tailJump174)return history.tailJump174;
    const pending=jumpWindow(0).finally(()=>{if(history.tailJump174===pending)history.tailJump174=null;});
    history.tailJump174=pending;
    return pending;
  }
  async function jumpWindow(anchor){
    const history=activeChatHistory,box=document.getElementById('messages');
    if(!history||!isCurrentMessagesBox(box))return null;
    if(anchor&&findMessageElement(anchor))return findMessageElement(anchor);
    const view=captureRoomView170(),task=transaction(history,view);
    const liveVersion=history.liveVersion174||0;
    try{
      const data=await around(view,anchor,task.signal);jumps++;
      if(!task.current())return null;
      if(anchor&&!data.messages.some(m=>Number(m.id)===anchor))return null;
      const scratch=await render(view,data.messages,history.deviceId,task.current);
      if(!task.current()){nodes(scratch).forEach(dispose);return null;}
      reconcileBeforeMount(view,scratch,history.deviceId);
      const total=unread(box)+history.unloadedUnreadCount;
      const latest=Number(data.messages.at(-1)?.id)||0;
      const carry=nodes(box).filter(n=>!anchor&&Number.isSafeInteger(id(n))&&id(n)>latest);
      if(!anchor){
        for(const record of pending(history.roomId).slice(-LIMIT)){
          const existing=findMessageElement(record.id,record.clientMessageId);
          if(existing)carry.push(existing);
          else{
            const holder=document.createElement('div');
            const node=appendMessage(holder,{...record.raw,id:record.clientMessageId,status:record.status},record.text,true,false);
            if(node)carry.push(node);
          }
        }
      }
      // Moving a pending node is not deletion: preserve its retry/client id and listeners.
      carry.forEach(n=>n.remove());
      nodes(box).forEach(dispose);
      box.querySelectorAll('.date-sep,.new-messages-divider').forEach(n=>n.remove());
      while(scratch.firstChild)box.appendChild(scratch.firstChild);
      carry.forEach(n=>box.appendChild(n));
      history.hasMore=Boolean(data.hasMore);
      history.hasNewer=Boolean(data.hasNewer)||(history.liveVersion174||0)!==liveVersion;
      history.nextCursor=Number(data.nextCursor)||null;
      finishMount(history,box,total);
      const target=anchor?findMessageElement(anchor):null;
      if(target)scrollCoordinator.focus(target,'auto',8);
      else scrollCoordinator.write(box,box.scrollHeight,'auto');
      trim(anchor?'older':'newer');
      return target;
    }catch(error){if(error.name!=='AbortError')console.warn('History anchor load failed',error);return null;}
    finally{task.finish();}
  }
  async function goToUnread(){
    const history=activeChatHistory,box=document.getElementById('messages');
    if(!history||!isCurrentMessagesBox(box))return;
    if(history.unloadedUnreadCount>0){
      const view=captureRoomView170(),task=transaction(history,view);
      let first;
      try{
        const data=await page(view,{limit:'1'},task.signal);
        if(!task.current())return;
        first=Number(data.firstUnreadMessageId)||0;
      }catch(error){if(error.name!=='AbortError')console.warn('Unread anchor load failed',error);return;}
      finally{task.finish();}
      const target=first?findMessageElement(first)||await jump(first):null;
      if(!valid(view))return;
      if(target)scrollCoordinator.focus(target,'smooth',8);
      else if(!first)await jump();
      return;
    }
    const first=box.querySelector('.msg[data-read="0"][data-incoming="1"]');
    if(first)scrollCoordinator.focus(first,'smooth',8);
    else scrollCoordinator.requestBottom(box);
  }
  function shouldDefer(box){
    const h=activeChatHistory;
    return Boolean(h&&(h.hasNewer||h.localNewer174||(nodes(box).length>=LIMIT&&!isMessagesAtBottom(box))));
  }
  function defer(message,text,mine){
    const h=activeChatHistory;
    const result=upsertRoomMessage(h.roomId,message,{text});
    h.hasNewer=true;
    h.liveVersion174=(h.liveVersion174||0)+1;
    if(!mine&&!result.isDuplicate&&message.status!=='read')h.unloadedUnreadCount++;
    updateUnreadIndicators();
    return result;
  }
  function mounted(box){
    box.style.overflowAnchor='none';
    box.addEventListener('scroll',()=>{
      if(scrollCoordinator.isOpening())return;
      if(box.scrollTop<=CHAT_HISTORY_LOAD_THRESHOLD_PX)void load('older');
      else if(box.scrollHeight-box.clientHeight-box.scrollTop<=CHAT_HISTORY_LOAD_THRESHOLD_PX)void load('newer');
    },{passive:true});
    trim();
    if(pending(activeChatHistory?.roomId).length&&!activeChatHistory?.unreadCount&&!activeChatHistory?.viewState?.anchorMessageId)void jump();
  }
  window.FPHistory174=Object.freeze({hydrate,load,jump,goToUnread,trim,mounted,shouldDefer,defer,
    snapshot:()=>({limit:LIMIT,mounted:nodes(document.getElementById('messages')).length,requests,evictions,jumps,hasOlder:Boolean(activeChatHistory?.hasMore||activeChatHistory?.localOlder174),hasNewer:Boolean(activeChatHistory?.hasNewer||activeChatHistory?.localNewer174)})});
})();
