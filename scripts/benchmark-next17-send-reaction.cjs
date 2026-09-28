'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const SAMPLES=5;
const OUT=path.resolve(process.env.FPCHAT_NEXT17_OUTPUT||path.join(process.cwd(),'next17-output'));
fs.mkdirSync(OUT,{recursive:true});

const HISTORICAL=Object.freeze({
  source:'docs/performance-step4-summary.json',
  reaction:{
    normal:{
      optimisticMs:[4.3,2.3,2.3,2.2,3.5],
      ackMs:[38.5,37.8,39.7,38.1,72.8]
    },
    throttled:{
      optimisticMs:[4.2,3.5,3.4,3.5,3.5],
      ackMs:[277.2,232.4,226.4,220.2,246]
    }
  },
  send:{
    normal:{
      optimisticMs:[26,14.4,12.5,10.6,9.4],
      ackMs:[26.1,14.4,12.6,10.6,21.3],
      success:5,
      failures:{}
    },
    throttled:{
      optimisticMs:[18,null,10.7,null,9.9],
      ackMs:[49.2,null,23.5,null,31],
      success:3,
      failures:{'optimistic-timeout':2}
    }
  }
});

const round=value=>value===null||value===undefined||!Number.isFinite(Number(value))
  ?null
  :Math.round(Number(value)*10)/10;

function stats(values){
  const clean=(values||[]).filter(value=>value!==null&&value!==undefined).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!clean.length)return{n:0,median:null,min:null,max:null,p95:null,p95Rule:'not calculated: no samples'};
  const median=clean.length%2?clean[(clean.length-1)/2]:(clean[clean.length/2-1]+clean[clean.length/2])/2;
  return{
    n:clean.length,
    median:round(median),
    min:round(clean[0]),
    max:round(clean.at(-1)),
    p95:null,
    p95Rule:'not calculated for n < 20'
  };
}

function summarizeAttempts(rows,metricNames){
  const failures={};
  for(const row of rows){
    if(row.success)continue;
    const key=String(row.failureStage||row.errorCode||'unknown');
    failures[key]=(failures[key]||0)+1;
  }
  const metrics={};
  for(const key of metricNames)metrics[key]=stats(rows.map(row=>row[key]));
  return{
    attempts:rows.length,
    successes:rows.filter(row=>row.success).length,
    failures,
    successRate:rows.length?round(rows.filter(row=>row.success).length/rows.length):null,
    metrics
  };
}

async function configureNetwork(session,profile){
  const config=profile==='throttled'
    ?{offline:false,latency:200,downloadThroughput:125000,uploadThroughput:62500,connectionType:'cellular3g'}
    :{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,connectionType:'wifi'};
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions',config);
  return config;
}

async function newProfilePage(browser,origin,errors,profile){
  const page=await browser.newPage({viewport:{width:1100,height:760}});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());
  const session=await page.context().newCDPSession(page);
  const network=await configureNetwork(session,profile);
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>
    window.__fpBootReady169At&&
    !document.getElementById('bootHold152')&&
    window.FPTextSend170&&
    window.FPMessageStore172&&
    window.FPReactionManager188&&
    window.FPReactionRenderer188&&
    window.FPConnection170
  ,null,{timeout:60000});
  return{page,session,network};
}

async function createRoom(page,label){
  return page.evaluate(async label=>{
    const deviceId=getOrCreateDeviceId();
    const secret='next17-'+label+'-'+crypto.randomUUID();
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:'Next17',deviceId,roomSecret:secret,...recovery})
    });
    if(!response.ok)throw Error('next17 room creation failed '+response.status);
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{deviceId,secret});
    upsertChat(data.publicId,{});
    await openChat(data.publicId);
    return{roomId:data.publicId,deviceId};
  },label);
}

async function waitOpenSocketPassive(page,timeout=30000){
  await page.waitForFunction(()=>{
    const socket=window.FPConnection170?.current?.();
    return Boolean(
      socket&&
      socket===state.ws&&
      socket.readyState===WebSocket.OPEN&&
      window.FPConnection170?.snapshot?.().open===true
    );
  },null,{timeout});
}

async function measureSend(page,profile,index){
  return page.evaluate(async({profile,index})=>{
    const TIMEOUT_MS=20000;
    const roomId=String(state?.roomId||'');
    const form=document.getElementById('sendForm');
    const input=document.getElementById('msgInput');
    const box=document.getElementById('messages');
    const manager=window.FPMessageStore172;
    if(!roomId||!form||!input||!box||!manager){
      return{
        kind:'send',
        profile,index,
        success:false,
        attempted:false,
        failureStage:'precondition',
        managerStateMs:null,
        domChangeMs:null,
        rafOpportunityMs:null,
        ackMs:null,
        actualResultVerified:false
      };
    }

    const value='next17-send-'+profile+'-'+index+'-'+crypto.randomUUID().slice(0,8);
    const result={
      kind:'send',
      profile,index,
      success:false,
      attempted:true,
      valueMarker:value,
      managerOwner:'FPMessageStore172',
      actionPath:'sendForm.requestSubmit -> FPSendManager177 -> FPTextSend170',
      managerStateEvent:'FPMessageStore172 contains optimistic record for this unique text',
      domEvent:'matching #messages .bubble-wrap.msg contains this unique message text',
      rafEvent:'first requestAnimationFrame callback scheduled after matching DOM change is observed',
      ackEvent:'matching DOM row is promoted to a positive numeric data-message-id and canonical store record has same id',
      managerStateMs:null,
      domChangeMs:null,
      rafOpportunityMs:null,
      ackMs:null,
      actualResultVerified:false,
      failureStage:null,
      errorCode:null,
      clientMessageId:null,
      serverMessageId:null,
      finalStatus:null
    };

    let started=0;
    let row=null;
    let managerRecord=null;
    let rafScheduled=false;
    let rafResolved=false;
    let domObserved=false;

    function matchingRow(){
      return [...box.querySelectorAll(':scope > .bubble-wrap.msg')].find(node=>{
        const text=node.querySelector('.message-text')?.textContent||'';
        return text===value;
      })||null;
    }

    function noteDom(){
      if(domObserved)return;
      const found=matchingRow();
      if(!found)return;
      row=found;
      domObserved=true;
      result.domChangeMs=performance.now()-started;
      if(!rafScheduled){
        rafScheduled=true;
        requestAnimationFrame(()=>{
          rafResolved=true;
          result.rafOpportunityMs=performance.now()-started;
        });
      }
    }

    const observer=new MutationObserver(()=>noteDom());
    observer.observe(box,{childList:true,subtree:true,attributes:true,attributeFilter:['data-message-id','data-id','data-client-message-id']});

    const onStore=event=>{
      const detail=event?.detail||{};
      if(String(detail.roomId||'')!==roomId)return;
      const ids=[detail.clientMessageId,detail.messageId].filter(value=>value!==null&&value!==undefined&&String(value)!=='');
      for(const id of ids){
        const record=manager.get(roomId,id);
        if(!record||String(record.text||'')!==value)continue;
        managerRecord=record;
        if(result.managerStateMs===null){
          result.managerStateMs=performance.now()-started;
          result.clientMessageId=String(record.clientMessageId||detail.clientMessageId||'')||null;
        }
        break;
      }
    };
    window.addEventListener('fpchat:message-store172-changed',onStore);

    try{
      input.value=value;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      started=performance.now();
      form.requestSubmit();

      const deadline=started+TIMEOUT_MS;
      while(performance.now()<deadline){
        noteDom();

        if(result.managerStateMs===null){
          const pending=manager.pending(roomId).find(record=>String(record.text||'')===value)||null;
          if(pending){
            managerRecord=pending;
            result.managerStateMs=performance.now()-started;
            result.clientMessageId=String(pending.clientMessageId||'')||null;
          }
        }

        row=row&&row.isConnected?row:matchingRow();
        const serverId=Number(row?.dataset?.messageId||row?.dataset?.id||0);
        if(Number.isSafeInteger(serverId)&&serverId>0){
          result.serverMessageId=serverId;
          if(result.ackMs===null)result.ackMs=performance.now()-started;
          const byServer=manager.get(roomId,serverId);
          const byClient=result.clientMessageId?manager.get(roomId,result.clientMessageId):null;
          const finalRecord=byServer||byClient||managerRecord;
          if(
            finalRecord&&
            Number(finalRecord.id)===serverId&&
            String(finalRecord.text||'')===value
          ){
            result.actualResultVerified=true;
            result.finalStatus=String(finalRecord.status||'');
          }
        }

        if(result.managerStateMs!==null&&result.domChangeMs!==null&&rafResolved&&result.actualResultVerified)break;
        await new Promise(resolve=>setTimeout(resolve,4));
      }

      if(!result.managerStateMs&&result.managerStateMs!==0)result.failureStage='manager-state-timeout';
      else if(!domObserved)result.failureStage='dom-timeout';
      else if(!rafResolved)result.failureStage='raf-opportunity-timeout';
      else if(result.ackMs===null)result.failureStage='ack-timeout';
      else if(!result.actualResultVerified)result.failureStage='final-result-mismatch';
      else result.success=true;
    }catch(error){
      result.failureStage=result.failureStage||'exception';
      result.errorCode=String(error?.code||error?.name||'ERROR');
      result.errorMessage=String(error?.message||'');
    }finally{
      observer.disconnect();
      window.removeEventListener('fpchat:message-store172-changed',onStore);
    }

    result.managerStateMs=result.managerStateMs===null?null:Math.round(result.managerStateMs*10)/10;
    result.domChangeMs=result.domChangeMs===null?null:Math.round(result.domChangeMs*10)/10;
    result.rafOpportunityMs=result.rafOpportunityMs===null?null:Math.round(result.rafOpportunityMs*10)/10;
    result.ackMs=result.ackMs===null?null:Math.round(result.ackMs*10)/10;
    return result;
  },{profile,index});
}

async function ensureReactionRemoved(page,messageId){
  return page.evaluate(async messageId=>{
    const roomId=String(state?.roomId||'');
    const manager=window.FPReactionManager188;
    if(!roomId||!manager||!messageId)return{ok:false,reason:'precondition'};
    await manager.getQuickReactions();
    let current=manager.get(roomId,messageId);
    const has=(current?.myReactions||[]).some(item=>String(item.reactionId)==='heart');
    if(has){
      await manager.toggleReaction({
        roomId,messageId,reactionId:'heart',
        reaction:{reactionId:'heart',type:'emoji',value:'❤️',enabled:true}
      });
    }
    window.FPReactionRenderer188?.patchMounted?.(roomId,messageId);
    current=manager.get(roomId,messageId);
    const still=(current?.myReactions||[]).some(item=>String(item.reactionId)==='heart');
    const row=[...document.querySelectorAll('#messages > .bubble-wrap.msg')].find(node=>Number(node.dataset.messageId||node.dataset.id)===Number(messageId));
    const pill=row?.querySelector('.fp-reaction-pill188[data-reaction-id="heart"]')||null;
    return{ok:!still&&!pill,managerHasHeart:still,domHasHeart:Boolean(pill)};
  },messageId);
}

async function measureReaction(page,profile,index,messageId){
  return page.evaluate(async({profile,index,messageId})=>{
    const TIMEOUT_MS=20000;
    const roomId=String(state?.roomId||'');
    const manager=window.FPReactionManager188;
    const renderer=window.FPReactionRenderer188;
    const row=[...document.querySelectorAll('#messages > .bubble-wrap.msg')]
      .find(node=>Number(node.dataset.messageId||node.dataset.id)===Number(messageId))||null;

    if(!roomId||!manager||!renderer||!row||!Number.isSafeInteger(Number(messageId))){
      return{
        kind:'reaction',profile,index,messageId,
        success:false,attempted:false,failureStage:'precondition',
        managerStateMs:null,domChangeMs:null,rafOpportunityMs:null,ackMs:null,
        actualResultVerified:false
      };
    }

    const descriptor={reactionId:'heart',type:'emoji',value:'❤️',enabled:true};
    const result={
      kind:'reaction',
      profile,index,messageId:Number(messageId),
      success:false,
      attempted:true,
      managerOwner:'FPReactionManager188',
      domOwner:'FPReactionRenderer188',
      actionPath:'FPReactionManager188.toggleReaction (same entry used by historical Step 4 reaction measurement)',
      managerStateEvent:'FPReactionManager188.get() optimistic projection contains own heart reaction',
      domEvent:'target message heart .fp-reaction-pill188 exists with aria-pressed=true',
      rafEvent:'first requestAnimationFrame callback scheduled after target reaction DOM state is observed',
      ackEvent:'toggleReaction promise resolves and final canonical manager state + target DOM still show own heart',
      managerStateMs:null,
      domChangeMs:null,
      rafOpportunityMs:null,
      ackMs:null,
      actualResultVerified:false,
      cleanupVerified:false,
      failureStage:null,
      errorCode:null
    };

    let started=0;
    let domObserved=false;
    let rafScheduled=false;
    let rafResolved=false;

    function currentManagerHasHeart(){
      const current=manager.get(roomId,messageId);
      return Boolean((current?.myReactions||[]).some(item=>String(item.reactionId)==='heart'));
    }

    function currentPill(){
      return row.querySelector('.fp-reaction-pill188[data-reaction-id="heart"]');
    }

    function noteDom(){
      if(domObserved)return;
      const pill=currentPill();
      if(!pill||pill.getAttribute('aria-pressed')!=='true')return;
      domObserved=true;
      result.domChangeMs=performance.now()-started;
      if(!rafScheduled){
        rafScheduled=true;
        requestAnimationFrame(()=>{
          rafResolved=true;
          result.rafOpportunityMs=performance.now()-started;
        });
      }
    }

    const observer=new MutationObserver(()=>noteDom());
    observer.observe(row,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-pressed','data-reaction-id']});

    try{
      await manager.getQuickReactions();
      if(currentManagerHasHeart()){
        result.failureStage='dirty-precondition';
        return result;
      }

      started=performance.now();
      const mutation=manager.toggleReaction({
        roomId,messageId,reactionId:'heart',reaction:descriptor
      });

      if(currentManagerHasHeart())result.managerStateMs=performance.now()-started;
      noteDom();

      let ackResolved=false;
      let ackError=null;
      Promise.resolve(mutation).then(()=>{
        ackResolved=true;
        result.ackMs=performance.now()-started;
      }).catch(error=>{
        ackResolved=true;
        ackError=error;
        result.ackMs=performance.now()-started;
      });

      const deadline=started+TIMEOUT_MS;
      while(performance.now()<deadline){
        if(result.managerStateMs===null&&currentManagerHasHeart()){
          result.managerStateMs=performance.now()-started;
        }
        noteDom();

        if(ackResolved){
          if(ackError){
            result.failureStage='mutation-rejected';
            result.errorCode=String(ackError?.code||ackError?.name||'REACTION_FAILED');
            result.errorMessage=String(ackError?.message||'');
            break;
          }
          const finalManager=currentManagerHasHeart();
          const finalPill=currentPill();
          const finalDom=Boolean(finalPill&&finalPill.getAttribute('aria-pressed')==='true');
          result.actualResultVerified=Boolean(finalManager&&finalDom);
          if(result.managerStateMs!==null&&domObserved&&rafResolved&&result.actualResultVerified)break;
        }
        await new Promise(resolve=>setTimeout(resolve,4));
      }

      if(!result.failureStage){
        if(result.managerStateMs===null)result.failureStage='manager-state-timeout';
        else if(!domObserved)result.failureStage='dom-timeout';
        else if(!rafResolved)result.failureStage='raf-opportunity-timeout';
        else if(result.ackMs===null)result.failureStage='ack-timeout';
        else if(!result.actualResultVerified)result.failureStage='final-result-mismatch';
        else result.success=true;
      }
    }catch(error){
      result.failureStage=result.failureStage||'exception';
      result.errorCode=String(error?.code||error?.name||'ERROR');
      result.errorMessage=String(error?.message||'');
    }finally{
      observer.disconnect();

      // Cleanup is outside the measured interval. It verifies repeatability and
      // prevents one sample's own reaction from becoming the next sample's input.
      try{
        if(currentManagerHasHeart()){
          await manager.toggleReaction({
            roomId,messageId,reactionId:'heart',reaction:descriptor
          });
        }
        renderer.patchMounted?.(roomId,messageId);
        const afterManager=currentManagerHasHeart();
        const afterPill=currentPill();
        result.cleanupVerified=!afterManager&&!afterPill;
      }catch{
        result.cleanupVerified=false;
      }
    }

    result.managerStateMs=result.managerStateMs===null?null:Math.round(result.managerStateMs*10)/10;
    result.domChangeMs=result.domChangeMs===null?null:Math.round(result.domChangeMs*10)/10;
    result.rafOpportunityMs=result.rafOpportunityMs===null?null:Math.round(result.rafOpportunityMs*10)/10;
    result.ackMs=result.ackMs===null?null:Math.round(result.ackMs*10)/10;
    return result;
  },{profile,index,messageId});
}

run(async({browser,origin,errors})=>{
  const report={
    schema:1,
    plan:'docs/performance-next-steps-prompts.md',
    item:17,
    status:'measurement',
    runtimeSha:process.env.FPCHAT_RUNTIME_SHA||null,
    measurementHead:process.env.GITHUB_SHA||null,
    build:null,
    collectedAt:new Date().toISOString(),
    samplesPerProfile:SAMPLES,
    historicalBaseline:HISTORICAL,
    environment:{
      browser:'Chromium '+browser.version(),
      platform:process.platform,
      arch:process.arch,
      node:process.version,
      cpuModel:os.cpus()[0]?.model||null,
      vcpu:os.cpus().length,
      physicalDevice:false,
      network:{
        normal:'same Step 4 condition: no added latency/bandwidth shaping',
        throttled:'same Step 4 CDP profile: latency=200 ms, download=125000 B/s, upload=62500 B/s, cellular3g'
      }
    },
    semantics:{
      requestAnimationFrame:'reported only as the nearest browser frame callback opportunity after the required DOM state was observed; it is not a hardware/display/present timestamp',
      failures:'every attempted sample remains in raw output; missing stages are null, never 0 ms',
      send:{
        managerState:'canonical FPMessageStore172 optimistic record for unique outgoing text',
        domState:'the matching outgoing message row/text exists in #messages',
        frameOpportunity:'first rAF callback scheduled after that matching DOM state is observed',
        actualResult:'matching row is promoted to numeric server message id and FPMessageStore172 resolves the same text/id'
      },
      reaction:{
        managerState:'FPReactionManager188 optimistic projection contains own heart reaction',
        domState:'the target message heart reaction pill exists and aria-pressed=true',
        frameOpportunity:'first rAF callback scheduled after that target pill state is observed',
        actualResult:'reaction mutation resolves and final canonical manager state + target reaction pill still represent own heart'
      }
    },
    raw:{},
    summary:{},
    notes:[
      'Runtime source and FPRuntime passive observer are unchanged.',
      'The new send manager metric uses FPMessageStore172 because FPSendManager177 is intentionally a stateless thin dispatcher.',
      'Historical Step 4 field names and raw values are preserved separately and are not silently redefined.',
      'The reaction action entry remains FPReactionManager188.toggleReaction to preserve comparability with historical Step 4; DOM and frame-opportunity are now verified separately.',
      'Five attempts per action/profile; no p95.'
    ]
  };

  for(const profile of ['normal','throttled']){
    const {page,network}=await newProfilePage(browser,origin,errors,profile);
    try{
      if(report.build===null){
        report.build=String(await page.evaluate(()=>fetch('/version.json',{cache:'no-store'}).then(r=>r.json()).then(v=>v.build||'')));
      }
      const fixture=await createRoom(page,profile);
      await waitOpenSocketPassive(page);

      const sendRows=[];
      for(let i=0;i<SAMPLES;i++){
        sendRows.push(await measureSend(page,profile,i));
      }

      const reactionTarget=sendRows.find(row=>row.success&&Number.isSafeInteger(Number(row.serverMessageId)))?.serverMessageId||null;
      const reactionRows=[];
      if(reactionTarget){
        const clean=await ensureReactionRemoved(page,reactionTarget);
        if(!clean.ok)throw Error('next17 reaction cleanup precondition failed '+JSON.stringify(clean));
        await page.evaluate(()=>window.FPReactionManager188.getQuickReactions());
        for(let i=0;i<SAMPLES;i++){
          reactionRows.push(await measureReaction(page,profile,i,reactionTarget));
        }
      }else{
        for(let i=0;i<SAMPLES;i++){
          reactionRows.push({
            kind:'reaction',profile,index:i,messageId:null,
            success:false,attempted:true,failureStage:'no-successful-send-target',
            managerStateMs:null,domChangeMs:null,rafOpportunityMs:null,ackMs:null,
            actualResultVerified:false,cleanupVerified:false
          });
        }
      }

      report.raw[profile]={send:sendRows,reaction:reactionRows,network};
      report.summary[profile]={
        send:summarizeAttempts(sendRows,['managerStateMs','domChangeMs','rafOpportunityMs','ackMs']),
        reaction:summarizeAttempts(reactionRows,['managerStateMs','domChangeMs','rafOpportunityMs','ackMs'])
      };
    }finally{
      await page.close();
    }
  }

  for(const profile of ['normal','throttled']){
    for(const action of ['send','reaction']){
      const rows=report.raw[profile][action];
      assert.equal(rows.length,SAMPLES,profile+' '+action+' attempt count changed');
      assert(rows.every(row=>row.attempted===true),profile+' '+action+' contains unattempted sample');
      for(const row of rows){
        if(!row.success)continue;
        assert.equal(row.actualResultVerified,true,profile+' '+action+' success has no verified actual result');
        assert.notEqual(row.managerStateMs,null,profile+' '+action+' success missing manager state metric');
        assert.notEqual(row.domChangeMs,null,profile+' '+action+' success missing DOM metric');
        assert.notEqual(row.rafOpportunityMs,null,profile+' '+action+' success missing rAF opportunity metric');
        assert.notEqual(row.ackMs,null,profile+' '+action+' success missing ACK metric');
        assert(row.rafOpportunityMs>=row.domChangeMs,profile+' '+action+' rAF opportunity precedes observed DOM state');
      }
    }
    assert(report.raw[profile].reaction.filter(row=>row.success).every(row=>row.cleanupVerified),
      profile+' reaction sample did not clean up for repeatability');
  }

  report.status='complete';
  report.browserErrors=[...errors];
  assert.equal(errors.length,0,'browser errors: '+JSON.stringify(errors));

  fs.writeFileSync(path.join(OUT,'next17-send-reaction-summary.json'),JSON.stringify(report,null,2)+'\n');
  console.log('NEXT17_RESULT '+JSON.stringify(report));
}).catch(error=>{
  console.error(error?.stack||error);
  process.exitCode=1;
});
