'use strict';

const path=require('node:path');
const {performance}=require('node:perf_hooks');
const Database=require('better-sqlite3');

const HISTORY_PAGE_SIZE=100;
const MESSAGE_SELECT='SELECT m.id, m.type, m.client_message_id, m.ciphertext, m.iv, m.reply_to_message_id, m.status, m.event_type, m.event_actor_name, m.created_at, m.delivered_at, m.read_at, p.display_name as sender_name, p.device_id as sender_device_id FROM messages m JOIN participants p ON p.id = m.sender_id';
const SQL_LATEST=MESSAGE_SELECT+' WHERE m.room_id=? ORDER BY m.id DESC LIMIT ?';
const SQL_BEFORE=MESSAGE_SELECT+' WHERE m.room_id=? AND m.id<? ORDER BY m.id DESC LIMIT ?';
const SQL_MEDIA='SELECT id, public_id, mime_type, media_kind, size_bytes, encrypted_size_bytes, width, height, duration_seconds, file_order FROM media WHERE message_id=? ORDER BY file_order ASC, id ASC';

function normalizeLimit(value){
  const parsed=Number.parseInt(value,10);
  if(!Number.isFinite(parsed))return HISTORY_PAGE_SIZE;
  return Math.max(1,Math.min(HISTORY_PAGE_SIZE,parsed));
}

const dbPath=process.env.FPCHAT_DIAG_DB;
const roomId=Number.parseInt(process.env.FPCHAT_DIAG_ROOM_ID||'',10);
const beforeRaw=process.env.FPCHAT_DIAG_BEFORE;
const before=beforeRaw===undefined||beforeRaw===''?null:Number.parseInt(beforeRaw,10);
const safeLimit=normalizeLimit(process.env.FPCHAT_DIAG_LIMIT);

if(!dbPath)throw new Error('Set FPCHAT_DIAG_DB to an existing SQLite file. Diagnostic opens it readonly.');
if(!Number.isSafeInteger(roomId)||roomId<=0)throw new Error('Set FPCHAT_DIAG_ROOM_ID to a positive numeric room id.');
if(before!==null&&(!Number.isSafeInteger(before)||before<=0))throw new Error('FPCHAT_DIAG_BEFORE must be a positive message id when supplied.');

const resolved=path.resolve(dbPath);
const db=new Database(resolved,{readonly:true,fileMustExist:true});
try{
  db.pragma('query_only = ON');
  const pageSql=before===null?SQL_LATEST:SQL_BEFORE;
  const pageParams=before===null?[roomId,safeLimit+1]:[roomId,before,safeLimit+1];
  const pagePlan=db.prepare('EXPLAIN QUERY PLAN '+pageSql).all(...pageParams);
  const txBefore=db.inTransaction;
  const t0=performance.now();
  const rows=db.prepare(pageSql).all(...pageParams);
  const pageMs=performance.now()-t0;
  const txAfterPage=db.inTransaction;
  const pageRows=rows.slice(0,safeLimit).reverse();
  const mediaStmt=db.prepare(SQL_MEDIA);
  const media=[];
  let mediaMs=0;
  for(const row of pageRows){
    if(row.type!=='media')continue;
    const start=performance.now();
    const items=mediaStmt.all(row.id);
    mediaMs+=performance.now()-start;
    media.push({messageId:row.id,count:items.length});
  }
  const txAfterHydration=db.inTransaction;
  const mediaPlan=pageRows.find(row=>row.type==='media')
    ? db.prepare('EXPLAIN QUERY PLAN '+SQL_MEDIA).all(pageRows.find(row=>row.type==='media').id)
    : [];

  console.log(JSON.stringify({
    readonly:true,
    queryOnly:true,
    db:resolved,
    mode:before===null?'latest':'before',
    sql:{page:pageSql,media:SQL_MEDIA},
    params:{page:pageParams,media:'[messageId] once per media message in returned page'},
    order:['page SELECT','slice(0, safeLimit)','reverse()','hydrate media SELECT once per type=media'],
    transaction:{explicit:false,before:txBefore,afterPage:txAfterPage,afterHydration:txAfterHydration},
    sample:{rawRows:rows.length,pageRows:pageRows.length,hasMore:rows.length>safeLimit,mediaMessages:media.length,pageMs:Number(pageMs.toFixed(3)),mediaMs:Number(mediaMs.toFixed(3))},
    queryPlan:{page:pagePlan,media:mediaPlan}
  },null,2));
}finally{db.close();}
