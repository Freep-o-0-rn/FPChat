'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const Database=require('better-sqlite3');

process.env.FPCHAT_NEXT10_SERVER_TIMING='1';
const hookPath=path.join(__dirname,'next10-server-timing-hook.cjs');
process.env.NODE_OPTIONS=((process.env.NODE_OPTIONS||'')+' --require='+hookPath).trim();

const {run}=require('./browser-harness174.cjs');
const OUT=path.resolve(process.env.FPCHAT_NEXT10_OUTPUT||path.join(process.cwd(),'next10-output'));
fs.mkdirSync(OUT,{recursive:true});

const REPEATS=5;
const POST_OPEN_OBSERVE_MS=1200;
const NETWORK_PROFILE=Object.freeze({
  latency:200,
  downloadThroughput:125000,
  uploadThroughput:62500,
  label:'200 ms latency, ~1 Mbit/s down, ~0.5 Mbit/s up'
});

const round=n=>Number.isFinite(Number(n))?Math.round(Number(n)*100)/100:null;
const stats=values=>{
  const clean=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!clean.length)return null;
  return{n:clean.length,raw:clean.map(round),median:round(clean[Math.floor(clean.length/2)]),min:round(clean[0]),max:round(clean[clean.length-1])};
};
const lower=headers=>{
  const out={};
  for(const [k,v] of Object.entries(headers||{}))out[String(k).toLowerCase()]=String(v);
  return out;
};
const serverTimingMs=headers=>{
  const value=String(headers?.['x-fp-diag-server-ms']||'').trim();
  const parsed=Number(value);
  if(Number.isFinite(parsed))return parsed;
  const match=String(headers?.['server-timing']||'').match(/fpserver;dur=([0-9.]+)/);
  return match?Number(match[1]):null;
};
const requestKind=url=>{
  const u=new URL(url);
  if(/\/join$/.test(u.pathname))return'join';
  if(!/\/messages$/.test(u.pathname))return'other';
  if(u.searchParams.has('before'))return u.searchParams.get('reactions')==='1'?'history-before':'messages-before';
  if(u.searchParams.has('after'))return u.searchParams.get('reactions')==='1'?'history-after':'sync-after';
  return'history-latest-get';
};
const safeBodySummary=text=>{
  try{
    const data=JSON.parse(text);
    const messages=Array.isArray(data?.messages)?data.messages:[];
    const reactions=Array.isArray(data?.reactionSummaries)?data.reactionSummaries:[];
    return{
      messageCount:messages.length,
      messagesJsonBytes:Buffer.byteLength(JSON.stringify(messages)),
      reactionSummaryCount:reactions.length,
      reactionJsonBytes:Buffer.byteLength(JSON.stringify(reactions)),
      hasMore:typeof data?.hasMore==='boolean'?data.hasMore:null,
      unreadCount:Number.isFinite(Number(data?.unreadCount))?Number(data.unreadCount):null,
      firstUnreadPresent:data?.firstUnreadMessageId!=null
    };
  }catch{return null;}
};

run(async({browser,origin,errors,temp,root})=>{
  const setup=await browser.newPage({viewport:{width:1100,height:760}});
  setup.on('pageerror',e=>errors.push(e.message));
  setup.on('dialog',d=>d.dismiss());
  await setup.goto(origin);
  await setup.waitForFunction(()=>window.FPMediaSend170&&window.FPHistory174&&!document.getElementById('bootHold152'));

  const fixture=await setup.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='next10-fixed-room';
    const key=await deriveKey(secret);
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:'Next10',deviceId,roomSecret:secret,...recovery})
    });
    if(!response.ok)throw new Error('room fixture '+response.status);
    const data=await response.json();
    const encrypted=[];
    for(let i=0;i<12;i++)encrypted.push(await encryptText('next10 synthetic '+i+' '+('payload '.repeat((i%4)+1)),key));
    return{roomId:data.publicId,deviceId,secret,count:1500,incoming:true,encrypted:encrypted};
  });

  const seeded=JSON.parse(execFileSync(
    process.env.FPCHAT_TEST_NODE||process.execPath,
    [path.join(root,'scripts/seed-history174.cjs')],
    {input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures:[fixture]}),encoding:'utf8'}
  ))[0];
  await setup.close();

  const db=new Database(path.join(temp,'test.sqlite'));
  db.pragma('busy_timeout = 5000');
  const room=db.prepare('SELECT id FROM rooms WHERE public_id=?').get(fixture.roomId);
  const creator=db.prepare('SELECT id FROM participants WHERE room_id=? AND device_id=?').get(room.id,fixture.deviceId);
  const ids=db.prepare('SELECT id FROM messages WHERE room_id=? ORDER BY id ASC').all(room.id).map(row=>Number(row.id));
  if(ids.length!==fixture.count)throw new Error('unexpected fixture message count '+ids.length);

  const anchorId=ids[350];
  const unreadId=ids[350];
  const lastId=ids.at(-1);

  const setView=db.prepare(
    'INSERT INTO chat_view_state(room_id,device_id,anchor_message_id,anchor_offset_px,at_bottom,updated_at) '+
    "VALUES(?,?,?,?,?,datetime('now')) "+
    'ON CONFLICT(room_id,device_id) DO UPDATE SET '+
    'anchor_message_id=excluded.anchor_message_id, '+
    'anchor_offset_px=excluded.anchor_offset_px, '+
    'at_bottom=excluded.at_bottom, '+
    "updated_at=datetime('now')"
  );
  const clearRead=db.prepare(
    "UPDATE messages SET status='read', delivered_at=COALESCE(delivered_at,datetime('now')), read_at=COALESCE(read_at,datetime('now')) WHERE room_id=?"
  );
  const makeUnread=db.prepare(
    "UPDATE messages SET status='sent', delivered_at=NULL, read_at=NULL WHERE room_id=? AND sender_id!=? AND id>=?"
  );
  const readState=db.prepare(
    "SELECT COUNT(*) total, SUM(CASE WHEN sender_id!=? AND status!='read' THEN 1 ELSE 0 END) unread FROM messages WHERE room_id=?"
  );

  const resetScenario=name=>{
    db.transaction(()=>{
      clearRead.run(room.id);
      if(name==='end'){
        setView.run(room.id,fixture.deviceId,null,0,1);
      }else if(name==='saved-anchor'){
        setView.run(room.id,fixture.deviceId,anchorId,17,0);
      }else if(name==='first-unread'){
        makeUnread.run(room.id,creator.id,unreadId);
        setView.run(room.id,fixture.deviceId,null,0,0);
      }else throw new Error('unknown scenario '+name);
    })();
    const state=readState.get(creator.id,room.id);
    return{total:Number(state.total),unread:Number(state.unread||0),targetOrdinal:name==='end'?null:351,atBottom:name==='end'};
  };

  const context=await browser.newContext({viewport:{width:1100,height:760}});
  await context.addInitScript(({deviceId,roomId,secret})=>{
    localStorage.setItem('fpchat:device-id',deviceId);
    localStorage.setItem('fpchat:nick','Next10');
    localStorage.setItem('fpchat:room:'+roomId,JSON.stringify({deviceId:deviceId,secret:secret}));
  },{deviceId:fixture.deviceId,roomId:fixture.roomId,secret:fixture.secret});

  async function measureOne(scenario,repeat){
    const expected=resetScenario(scenario);
    if(expected.total!==1500)throw new Error('fixture drift before '+scenario+' #'+repeat);
    if(scenario!=='first-unread'&&expected.unread!==0)throw new Error('unexpected unread before '+scenario);
    if(scenario==='first-unread'&&expected.unread!==1150)throw new Error('unexpected unread count '+expected.unread);

    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>d.dismiss());
    await page.goto(origin);
    await page.waitForFunction(()=>window.FPMediaSend170&&window.FPHistory174&&!document.getElementById('bootHold152'));

    const cdp=await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions',{
      offline:false,
      latency:NETWORK_PROFILE.latency,
      downloadThroughput:NETWORK_PROFILE.downloadThroughput,
      uploadThroughput:NETWORK_PROFILE.uploadThroughput,
      connectionType:'cellular3g'
    });

    const rows=new Map();
    const ensure=id=>{
      if(!rows.has(id))rows.set(id,{requestId:id});
      return rows.get(id);
    };

    cdp.on('Network.requestWillBeSent',event=>{
      const url=String(event.request?.url||'');
      let u;
      try{u=new URL(url);}catch{return;}
      if(u.origin!==origin)return;
      if(!u.pathname.includes('/api/rooms/')||(!u.pathname.endsWith('/join')&&!u.pathname.endsWith('/messages')))return;
      const row=ensure(event.requestId);
      Object.assign(row,{
        kind:requestKind(url),
        method:event.request.method,
        startTs:event.timestamp,
        query:{
          before:u.searchParams.has('before'),
          after:u.searchParams.has('after'),
          reactions:u.searchParams.get('reactions')==='1',
          limit:u.searchParams.get('limit')||null
        }
      });
    });
    cdp.on('Network.responseReceived',event=>{
      const row=rows.get(event.requestId);if(!row)return;
      const h=lower(event.response.headers||{});
      Object.assign(row,{
        logicalStatus:event.response.status,
        responseTs:event.timestamp,
        responseHeaders:h,
        serverMs:serverTimingMs(h),
        contentLength:h['content-length']?Number(h['content-length']):null,
        fromDiskCache:Boolean(event.response.fromDiskCache),
        fromServiceWorker:Boolean(event.response.fromServiceWorker)
      });
    });
    cdp.on('Network.loadingFinished',event=>{
      const row=rows.get(event.requestId);if(!row)return;
      row.endTs=event.timestamp;
      row.encodedBytes=Number(event.encodedDataLength||0);
    });
    cdp.on('Network.loadingFailed',event=>{
      const row=rows.get(event.requestId);if(!row)return;
      row.endTs=event.timestamp;
      row.failed=true;
      row.errorText=event.errorText||null;
    });

    const opened=await page.evaluate(async input=>{
      const started=performance.now();
      await openChat(input.roomId);
      const openMs=performance.now()-started;
      const box=document.getElementById('messages');
      const target=input.scenario==='saved-anchor'?input.anchorId:(input.scenario==='first-unread'?input.unreadId:null);
      return{
        openMs:openMs,
        targetMounted:target?Boolean(findMessageElement(target)):null,
        tailMounted:Boolean(findMessageElement(input.lastId)),
        mounted:box?.querySelectorAll('.bubble-wrap.msg').length||0,
        hasNewer:Boolean(activeChatHistory?.hasNewer),
        unreadCount:Number(activeChatHistory?.unreadCount||0),
        firstUnreadMatches:input.scenario==='first-unread'?Number(activeChatHistory?.firstUnreadMessageId)===input.unreadId:null,
        atBottom:box?isMessagesAtBottom(box):null
      };
    },{roomId:fixture.roomId,lastId:lastId,anchorId:anchorId,unreadId:unreadId,scenario:scenario});

    await page.waitForTimeout(POST_OPEN_OBSERVE_MS);

    const requests=[];
    for(const row of rows.values()){
      if(!row.responseTs)continue;
      let bodySummary=null;
      try{
        const body=await cdp.send('Network.getResponseBody',{requestId:row.requestId});
        const text=body.base64Encoded?Buffer.from(body.body,'base64').toString('utf8'):body.body;
        bodySummary=safeBodySummary(text);
      }catch{}
      const ttfbMs=(row.responseTs-row.startTs)*1000;
      const durationMs=row.endTs?(row.endTs-row.startTs)*1000:null;
      requests.push({
        kind:row.kind,
        method:row.method,
        query:row.query,
        status:row.logicalStatus,
        serverMs:round(row.serverMs),
        ttfbMs:round(ttfbMs),
        nonServerTtfbMs:row.serverMs==null?null:round(Math.max(0,ttfbMs-row.serverMs)),
        durationMs:round(durationMs),
        contentLength:row.contentLength,
        encodedBytes:row.encodedBytes,
        fromDiskCache:row.fromDiskCache,
        fromServiceWorker:row.fromServiceWorker,
        body:bodySummary
      });
    }

    const order={join:0,'history-before':1,'history-after':2,'sync-after':3,'messages-before':4,'history-latest-get':5,other:9};
    requests.sort((a,b)=>(order[a.kind]??9)-(order[b.kind]??9));

    await cdp.detach().catch(()=>{});
    await page.close();

    const after=readState.get(creator.id,room.id);
    return{
      scenario:scenario,
      repeat:repeat,
      initialState:expected,
      open:opened,
      postOpenUnread:Number(after.unread||0),
      requests:requests,
      historyRequestCount:requests.filter(r=>r.kind!=='join').length,
      historyKinds:requests.filter(r=>r.kind!=='join').map(r=>r.kind),
      historyEncodedBytes:requests.filter(r=>r.kind!=='join').reduce((sum,r)=>sum+(r.encodedBytes||0),0)
    };
  }

  const scenarios=['end','saved-anchor','first-unread'];
  const samples=[];
  for(let repeat=1;repeat<=REPEATS;repeat++){
    for(const scenario of scenarios)samples.push(await measureOne(scenario,repeat));
  }

  const summarizeScenario=scenario=>{
    const list=samples.filter(x=>x.scenario===scenario);
    const joins=list.map(x=>x.requests.find(r=>r.kind==='join')).filter(Boolean);
    const histories=list.flatMap(x=>x.requests.filter(r=>r.kind!=='join'));
    const byKind={};
    for(const kind of [...new Set(histories.map(r=>r.kind))]){
      const perSample=list.map(sample=>sample.requests.filter(r=>r.kind===kind));
      byKind[kind]={
        countPerRun:perSample.map(rows=>rows.length),
        serverMs:stats(perSample.flat().map(r=>r.serverMs)),
        ttfbMs:stats(perSample.flat().map(r=>r.ttfbMs)),
        durationMs:stats(perSample.flat().map(r=>r.durationMs)),
        contentLength:stats(perSample.flat().map(r=>r.contentLength)),
        encodedBytes:stats(perSample.flat().map(r=>r.encodedBytes)),
        messageCount:stats(perSample.flat().map(r=>r.body?.messageCount))
      };
    }
    return{
      repeats:list.length,
      openMs:stats(list.map(x=>x.open.openMs)),
      mounted:stats(list.map(x=>x.open.mounted)),
      historyRequestCount:stats(list.map(x=>x.historyRequestCount)),
      historyEncodedBytes:stats(list.map(x=>x.historyEncodedBytes)),
      join:{
        serverMs:stats(joins.map(r=>r.serverMs)),
        ttfbMs:stats(joins.map(r=>r.ttfbMs)),
        nonServerTtfbMs:stats(joins.map(r=>r.nonServerTtfbMs)),
        durationMs:stats(joins.map(r=>r.durationMs)),
        contentLength:stats(joins.map(r=>r.contentLength)),
        encodedBytes:stats(joins.map(r=>r.encodedBytes)),
        messageCount:stats(joins.map(r=>r.body?.messageCount)),
        messagesJsonBytes:stats(joins.map(r=>r.body?.messagesJsonBytes))
      },
      historyByKind:byKind,
      validation:{
        targetMounted:list.map(x=>x.open.targetMounted),
        tailMounted:list.map(x=>x.open.tailMounted),
        hasNewer:list.map(x=>x.open.hasNewer),
        firstUnreadMatches:list.map(x=>x.open.firstUnreadMatches),
        atBottom:list.map(x=>x.open.atBottom),
        initialUnread:list.map(x=>x.initialState.unread)
      }
    };
  };

  const report={
    schema:1,
    build:'190.2',
    runtimeSha:process.env.FPCHAT_RUNTIME_SHA||null,
    environment:'isolated Linux headless Chromium + local SQLite',
    network:NETWORK_PROFILE,
    repeats:REPEATS,
    observationAfterOpenMs:POST_OPEN_OBSERVE_MS,
    fixture:{
      oneFixedRoom:true,
      messages:1500,
      allSyntheticText:true,
      targetOrdinal:351,
      lastPageSize:100,
      identityPreservedAcrossRepeats:true,
      dbStateResetBeforeEveryOpen:true,
      browserContextPreservedAcrossRepeats:true
    },
    timingSemantics:{
      serverMs:'test-only Node server request wall from HTTP request event to res.end; includes route logic, SQLite work and JSON serialization; it is not DB time',
      ttfbMs:'browser CDP request start to response headers under the configured network profile',
      nonServerTtfbMs:'ttfbMs - serverMs; includes client queueing and request/response network propagation, not a pure wire-only metric',
      durationMs:'browser CDP request start to loadingFinished'
    },
    scenarios:Object.fromEntries(scenarios.map(name=>[name,summarizeScenario(name)])),
    samples:samples,
    errors:errors
  };

  report.confirmedCandidate={
    name:'latest history page embedded in POST /join for non-tail opening',
    type:'server-side latest-page history read/payload inside mandatory join HTTP request',
    appliesTo:['saved-anchor','first-unread'],
    evidence:{
      joinMessageCount:report.scenarios['saved-anchor'].join.messageCount,
      savedAnchorTailMounted:report.scenarios['saved-anchor'].validation.tailMounted,
      unreadTailMounted:report.scenarios['first-unread'].validation.tailMounted,
      savedAnchorHistoryKinds:Object.keys(report.scenarios['saved-anchor'].historyByKind),
      unreadHistoryKinds:Object.keys(report.scenarios['first-unread'].historyByKind)
    },
    note:'This is not the whole join request and must not be called DB time. The join HTTP request remains necessary for access/participants/unread/view-state; only its embedded latest history page is the confirmed over-fetch when the target is outside that page.'
  };

  fs.writeFileSync(path.join(OUT,'next10-join-history.json'),JSON.stringify(report,null,2)+'\n');
  console.log('NEXT10_RESULT '+JSON.stringify(report));

  db.close();
  await context.close();
  if(errors.length)process.exitCode=1;
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
