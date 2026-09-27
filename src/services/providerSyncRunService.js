/*
 * Durable per-league provider sync lifecycle.
 * PostgreSQL is authoritative in production when available; the JSON file is a compatibility/read-through mirror.
 */
'use strict';
const crypto=require('crypto');
const {loadJson,saveJson}=require('../storage/jsonStore');
const {prismaSafe,getPrisma}=require('../storage/prisma');
const FILE='providerSyncRuns.json';
const TERMINAL=new Set(['succeeded','failed','cancelled']);
function _s(){const x=loadJson(FILE,{version:2,runs:[]});return {...x,version:2,runs:Array.isArray(x?.runs)?x.runs:[]};}
function _save(x){saveJson(FILE,{...x,updatedAt:Date.now()});}
function _requiresDurableDb(){return process.env.NODE_ENV==='production'&&process.env.ALLOW_JSON_PROVIDER_SYNC_RUNS!=='true';}
function _dbData(r){return {id:r.id,leagueId:r.leagueId,providerKey:r.providerKey,trigger:r.trigger,status:r.status,inputRevision:r.inputRevision,metadata:r.metadata||{},result:r.result||null,error:r.error||null,startedAt:new Date(r.startedAt),finishedAt:r.finishedAt?new Date(r.finishedAt):null};}
function _fromDb(r){return {...r,startedAt:new Date(r.startedAt).getTime(),finishedAt:r.finishedAt?new Date(r.finishedAt).getTime():null,createdAt:r.createdAt?new Date(r.createdAt).getTime():Date.now(),updatedAt:r.updatedAt?new Date(r.updatedAt).getTime():Date.now()};}
function start({leagueId,providerKey,trigger='manual',inputRevision=null,metadata={}}={}){if(!leagueId||!providerKey)throw Error('sync run requires leagueId/providerKey');const now=Date.now();const r={id:crypto.randomUUID(),leagueId:String(leagueId),providerKey:String(providerKey),trigger,status:'running',inputRevision:inputRevision?String(inputRevision):null,metadata,result:null,error:null,startedAt:now,finishedAt:null,createdAt:now,updatedAt:now};const s=_s();s.runs.unshift(r);s.runs=s.runs.slice(0,500);_save(s);_mirror(r);return r;}
function finish(id,{ok,result=null,error=null,status=null}={}){const s=_s(),i=s.runs.findIndex(r=>r.id===id);if(i<0)return null;const r=s.runs[i],now=Date.now();r.status=status||(ok?'succeeded':'failed');r.result=result;r.error=ok?null:String(error||'sync-failed');r.finishedAt=now;r.updatedAt=now;_save(s);_mirror(r);return r;}
function list({leagueId=null,providerKey=null,statuses=null,limit=50}={}){return _s().runs.filter(r=>(!leagueId||String(r.leagueId)===String(leagueId))&&(!providerKey||r.providerKey===providerKey)&&(!statuses||statuses.includes(r.status))).slice(0,limit);}
function recoverInterrupted(){const s=_s();let n=0;for(const r of s.runs){if(!TERMINAL.has(r.status)){r.status='failed';r.error='process-restarted-before-sync-completed';r.finishedAt=Date.now();r.updatedAt=r.finishedAt;_mirror(r);n++;}}if(n)_save(s);return n;}
function _mirror(r){prismaSafe(async p=>{if(!p.providerSyncRun)return null;const d=_dbData(r);return p.providerSyncRun.upsert({where:{id:r.id},create:d,update:{status:d.status,result:d.result,error:d.error,finishedAt:d.finishedAt,metadata:d.metadata}})},null).catch(()=>null);}
async function _persist(r){
 const p=getPrisma();
 if(!p?.providerSyncRun){if(_requiresDurableDb())return{ok:false,reason:'database-required-for-provider-sync-runs'};return{ok:true,durable:false};}
 try{const d=_dbData(r);await p.providerSyncRun.upsert({where:{id:r.id},create:d,update:{status:d.status,result:d.result,error:d.error,finishedAt:d.finishedAt,metadata:d.metadata}});return{ok:true,durable:true};}
 catch(e){if(_requiresDurableDb())return{ok:false,reason:'provider-sync-run-database-write-failed',error:String(e.message||e)};return{ok:true,durable:false,warning:String(e.message||e)};}
}
async function startDurable(args={}){
 const r=start(args);const d=await _persist(r);if(!d.ok){const s=_s();s.runs=s.runs.filter(x=>x.id!==r.id);_save(s);throw Error(d.reason);}return r;
}
async function finishDurable(id,opts={}){
 const before=list({limit:500}).find(r=>r.id===id)||null;const r=finish(id,opts);if(!r)return null;const d=await _persist(r);if(!d.ok&&_requiresDurableDb()){if(before){const s=_s(),i=s.runs.findIndex(x=>x.id===id);if(i>=0)s.runs[i]=before;_save(s);}throw Error(d.reason);}return r;
}
async function hydrateFromDatabase(){
 const p=getPrisma();if(!p?.providerSyncRun)return{ok:!_requiresDurableDb(),hydrated:0,reason:_requiresDurableDb()?'database-required-for-provider-sync-runs':'database-not-configured'};
 try{const rows=(await p.providerSyncRun.findMany({orderBy:{startedAt:'desc'},take:500})).map(_fromDb);const s=_s();if(_requiresDurableDb())s.runs=rows;else{const by=new Map(s.runs.map(r=>[r.id,r]));for(const r of rows)by.set(r.id,r);s.runs=[...by.values()].sort((a,b)=>b.startedAt-a.startedAt).slice(0,500);}_save(s);return{ok:true,hydrated:rows.length};}
 catch(e){return{ok:false,hydrated:0,reason:'provider-sync-run-database-read-failed',error:String(e.message||e)};}
}
async function recoverInterruptedDurable(){
 const ids=list({limit:500}).filter(r=>!TERMINAL.has(r.status)).map(r=>r.id);let n=0;
 for(const id of ids){await finishDurable(id,{ok:false,error:'process-restarted-before-sync-completed'});n++;}
 return n;
}
module.exports={FILE,start,finish,list,recoverInterrupted,startDurable,finishDurable,hydrateFromDatabase,recoverInterruptedDurable};
