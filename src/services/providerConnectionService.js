/*
 * NAVIGATION HEADER
 * FILE: src/services/providerConnectionService.js
 * LAYER: Service layer / provider control plane
 * PURPOSE: Per-league provider connection registry and lifecycle authority.
 * SECURITY: public route tokens are stored only as SHA-256 hashes. Provider secrets are encrypted by
 *          providerSecretService and never returned by public/status methods.
 */
'use strict';
const crypto=require('crypto');
const {loadJson,saveJson}=require('../storage/jsonStore');
const {prismaSafe,getPrisma}=require('../storage/prisma');
const secrets=require('./providerSecretService');
const FILE='providerConnections.json';
const PROVIDERS=new Set(['companion_export','neonsportz','custom_endpoint','madden_companion','nba2k_companion']);
const STATES=new Set(['draft','testing','ready','active','degraded','blocked','fallback_manual','disconnecting','disconnected']);
const TRANSITIONS={
 draft:new Set(['testing','ready','disconnected']), testing:new Set(['ready','blocked','degraded','disconnected']),
 ready:new Set(['active','testing','disconnected']), active:new Set(['degraded','blocked','fallback_manual','disconnecting','testing']),
 degraded:new Set(['active','blocked','fallback_manual','testing','disconnecting']), blocked:new Set(['testing','fallback_manual','disconnecting']),
 fallback_manual:new Set(['testing','active','disconnecting']), disconnecting:new Set(['disconnected']), disconnected:new Set(['draft','testing','ready']),
};
function _store(){const v=loadJson(FILE,{version:2,connections:[]});return v&&typeof v==='object'?{version:2,...v,connections:Array.isArray(v.connections)?v.connections:[]}:{version:2,connections:[]};}
function _save(s){saveJson(FILE,{...s,updatedAt:Date.now()});return s;}
function _id(l,p){return `${String(l)}:${String(p)}`;}
function _hash(v){return crypto.createHash('sha256').update(String(v||''),'utf8').digest('hex');}
function _safeEqHex(a,b){try{const aa=Buffer.from(String(a||''),'hex'),bb=Buffer.from(String(b||''),'hex');return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);}catch{return false;}}
function generateRouteToken(){return crypto.randomBytes(32).toString('base64url');}
function encryptSecret(v){return v?secrets.encrypt(v):null;} function decryptSecret(v){return secrets.decrypt(v);}
function _normalize(row={}){return {...row,status:STATES.has(row.status)?row.status:'draft',healthStatus:['unknown','healthy','degraded','blocked'].includes(row.healthStatus)?row.healthStatus:'unknown',fallbackMode:['none','manual'].includes(row.fallbackMode)?row.fallbackMode:'none'};}
function _public(r){if(!r)return null;const n=_normalize(r);const {secretCiphertext,routeTokenHash,...safe}=n;return {...safe,hasSecret:!!secretCiphertext,hasRouteToken:!!routeTokenHash};}
function getConnection(leagueId,providerKey=null){const row=_store().connections.find(r=>String(r.leagueId)===String(leagueId)&&(!providerKey||r.providerKey===providerKey));return row?_normalize(row):null;}
function listConnections(leagueId=null){return _store().connections.filter(r=>leagueId==null||String(r.leagueId)===String(leagueId)).map(_public);}
function getSecret(l,p){return decryptSecret(getConnection(l,p)?.secretCiphertext);}
function resolveRouteToken(providerKey,token){
 const hash=_hash(token);
 const row=_store().connections.find(r=>r.providerKey===providerKey&&r.routeTokenHash&&_safeEqHex(r.routeTokenHash,hash)&&!['disconnecting','disconnected'].includes(_normalize(r).status));
 if(!row)return{valid:false,leagueId:null,connection:null,expired:false};
 const expiresAt=Number(row.config?.receiverExpiresAt||0);
 if(expiresAt&&Date.now()>=expiresAt)return{valid:false,leagueId:null,connection:_public(row),expired:true};
 return{valid:true,leagueId:String(row.leagueId),connection:_public(row),expired:false};
}
function _put(row){const s=_store(),idx=s.connections.findIndex(r=>r.id===row.id);if(idx>=0)s.connections[idx]=row;else s.connections.push(row);_save(s);_mirror(row);return row;}
function upsertConnection(input={}){
 const leagueId=String(input.leagueId||'').trim(),providerKey=String(input.providerKey||'').trim();if(!leagueId)throw Error('provider connection requires leagueId');if(!PROVIDERS.has(providerKey))throw Error(`unsupported provider: ${providerKey}`);
 const prev=getConnection(leagueId,providerKey),now=Date.now();const routeToken=input.routeToken===true?generateRouteToken():typeof input.routeToken==='string'?input.routeToken:null;
 let secretCiphertext=prev?.secretCiphertext||null;if(input.secret!==undefined)secretCiphertext=input.secret?encryptSecret(input.secret):null;
 const status=STATES.has(input.status)?input.status:(prev?.status||'draft');
 const row=_normalize({id:_id(leagueId,providerKey),leagueId,providerKey,status,healthStatus:input.healthStatus??prev?.healthStatus??'unknown',fallbackMode:input.fallbackMode??prev?.fallbackMode??'none',endpointUrl:String(input.endpointUrl??prev?.endpointUrl??'').trim()||null,externalLeagueId:String(input.externalLeagueId??prev?.externalLeagueId??'').trim()||null,routeTokenHash:routeToken?_hash(routeToken):(prev?.routeTokenHash||null),secretCiphertext,config:{...(prev?.config||{}),...(input.config||{})},lastHealthAt:input.lastHealthAt??prev?.lastHealthAt??null,lastSyncAt:input.lastSyncAt??prev?.lastSyncAt??null,lastSuccessAt:input.lastSuccessAt??prev?.lastSuccessAt??null,lastError:input.lastError!==undefined?input.lastError:(prev?.lastError||null),blockedReason:input.blockedReason!==undefined?input.blockedReason:(prev?.blockedReason||null),createdAt:prev?.createdAt||now,updatedAt:now});
 _put(row);return {connection:_public(row),routeToken};
}
function transitionConnection(leagueId,providerKey,next,patch={}){const r=getConnection(leagueId,providerKey);if(!r)throw Error('connection-not-found');if(!STATES.has(next))throw Error(`invalid-connection-state:${next}`);if(r.status!==next&&!TRANSITIONS[r.status]?.has(next))throw Error(`illegal-connection-transition:${r.status}->${next}`);return upsertConnection({...r,...patch,status:next}).connection;}
function rotateRouteToken(leagueId,providerKey){const r=getConnection(leagueId,providerKey);if(!r)throw Error('connection-not-found');const token=generateRouteToken();const up=upsertConnection({...r,routeToken:token,lastError:null});return {connection:up.connection,routeToken:token};}
function disconnectConnection(leagueId,providerKey){const r=getConnection(leagueId,providerKey);if(!r)return null;let status=r.status;if(status!=='disconnecting'&&status!=='disconnected'){if(TRANSITIONS[status]?.has('disconnecting'))status='disconnecting';else status='disconnected';}let row=_normalize({...r,status:'disconnected',routeTokenHash:null,secretCiphertext:null,healthStatus:'unknown',fallbackMode:'none',blockedReason:null,lastError:null,updatedAt:Date.now()});_put(row);return _public(row);}
function reconnectConnection(leagueId,providerKey,{rotateToken=true}={}){const r=getConnection(leagueId,providerKey);if(!r)throw Error('connection-not-found');let token=null;const row={...r,status:'testing',healthStatus:'unknown',fallbackMode:'none',lastError:null,blockedReason:null};if(rotateToken){token=generateRouteToken();row.routeTokenHash=_hash(token);} _put(_normalize({...row,updatedAt:Date.now()}));return {connection:_public(row),routeToken:token};}
function enterManualFallback(leagueId,providerKey,reason='manual fallback'){const r=getConnection(leagueId,providerKey);if(!r)throw Error('connection-not-found');const next=TRANSITIONS[r.status]?.has('fallback_manual')?'fallback_manual':r.status;return upsertConnection({...r,status:next,fallbackMode:'manual',lastError:String(reason)}).connection;}
function recordHealth(l,p,result={}){const r=getConnection(l,p);if(!r)return null;const ok=!!(result.ok&&result.healthy!==false);let status=r.status;if(!ok&&['active','testing','ready'].includes(status))status=result.reason==='unauthorized'||result.reason==='not-configured'?'blocked':'degraded';else if(ok&&['testing','degraded','blocked'].includes(status))status='ready';return upsertConnection({...r,status,healthStatus:ok?'healthy':(status==='blocked'?'blocked':'degraded'),lastHealthAt:Date.now(),lastError:ok?null:String(result.reason||result.error||'health-check-failed'),blockedReason:status==='blocked'?String(result.reason||'provider blocked'):null}).connection;}
function recordSync(l,p,result={}){const r=getConnection(l,p);if(!r)return null;const ok=!!result.ok;let status=r.status;if(ok&&['ready','testing','degraded'].includes(status))status='active';if(!ok&&status==='active')status='degraded';return upsertConnection({...r,status,healthStatus:ok?'healthy':'degraded',lastSyncAt:Date.now(),lastSuccessAt:ok?Date.now():r.lastSuccessAt,lastError:ok?null:String(result.reason||result.error||'sync-failed')}).connection;}
function _mirror(row){prismaSafe(async p=>{if(!p.providerConnection)return null;const data=_dbData(row);return p.providerConnection.upsert({where:{leagueId_providerKey:{leagueId:row.leagueId,providerKey:row.providerKey}},create:data,update:data});},null).catch(()=>null);}


function _requiresDurableDb(){const env=String(process.env.APP_ENV||process.env.NODE_ENV||'').toLowerCase();return env==='production'&&String(process.env.ALLOW_JSON_PROVIDER_CONNECTIONS||'').toLowerCase()!=='true';}
function _dbData(row){return {id:row.id,leagueId:row.leagueId,providerKey:row.providerKey,status:row.status,healthStatus:row.healthStatus,fallbackMode:row.fallbackMode,endpointUrl:row.endpointUrl,externalLeagueId:row.externalLeagueId,routeTokenHash:row.routeTokenHash,secretCiphertext:row.secretCiphertext,config:row.config,lastHealthAt:row.lastHealthAt?new Date(row.lastHealthAt):null,lastSyncAt:row.lastSyncAt?new Date(row.lastSyncAt):null,lastSuccessAt:row.lastSuccessAt?new Date(row.lastSuccessAt):null,lastError:row.lastError,blockedReason:row.blockedReason};}
function _fromDb(row){return _normalize({...row,lastHealthAt:row.lastHealthAt?new Date(row.lastHealthAt).getTime():null,lastSyncAt:row.lastSyncAt?new Date(row.lastSyncAt).getTime():null,lastSuccessAt:row.lastSuccessAt?new Date(row.lastSuccessAt).getTime():null,createdAt:row.createdAt?new Date(row.createdAt).getTime():Date.now(),updatedAt:row.updatedAt?new Date(row.updatedAt).getTime():Date.now()});}
async function persistConnectionDurable(leagueId,providerKey){
 const row=getConnection(leagueId,providerKey);if(!row)return{ok:false,reason:'connection-not-found'};
 const p=getPrisma();
 if(!p?.providerConnection){if(_requiresDurableDb())return{ok:false,reason:'database-required-for-provider-connections'};return{ok:true,durable:false,connection:_public(row)};}
 try{const data=_dbData(row);await p.providerConnection.upsert({where:{leagueId_providerKey:{leagueId:row.leagueId,providerKey:row.providerKey}},create:data,update:data});return{ok:true,durable:true,connection:_public(row)};}
 catch(e){if(_requiresDurableDb())return{ok:false,reason:'provider-connection-database-write-failed',error:String(e.message||e)};return{ok:true,durable:false,connection:_public(row),warning:String(e.message||e)};}
}
async function hydrateFromDatabase(){
 const p=getPrisma();if(!p?.providerConnection)return{ok:!_requiresDurableDb(),hydrated:0,reason:_requiresDurableDb()?'database-required-for-provider-connections':'database-not-configured'};
 try{const rows=await p.providerConnection.findMany();const converted=rows.map(_fromDb);const st=_store();if(_requiresDurableDb())st.connections=converted;else{const by=new Map(st.connections.map(r=>[r.id,r]));for(const r of converted)by.set(r.id,r);st.connections=[...by.values()];}_save(st);return{ok:true,hydrated:converted.length};}
 catch(e){return{ok:false,hydrated:0,reason:'provider-connection-database-read-failed',error:String(e.message||e)};}
}
function snapshotConnection(leagueId,providerKey){const r=getConnection(leagueId,providerKey);return r?JSON.parse(JSON.stringify(r)):null;}
function restoreConnectionSnapshot(leagueId,providerKey,snapshot){const st=_store(),id=_id(String(leagueId),String(providerKey)),idx=st.connections.findIndex(r=>r.id===id);if(snapshot){if(idx>=0)st.connections[idx]=snapshot;else st.connections.push(snapshot);}else if(idx>=0)st.connections.splice(idx,1);_save(st);return snapshot?_public(snapshot):null;}

function deactivateOtherConnections(leagueId, exceptProviderKey) {
  const rows = _store().connections.filter(r => String(r.leagueId) === String(leagueId) && r.providerKey !== exceptProviderKey);
  const changed = [];
  for (const r of rows) {
    const n = _normalize(r);
    if (!['active','degraded'].includes(n.status)) continue;
    const next = _normalize({ ...n, status:'ready', fallbackMode:'none', updatedAt:Date.now() });
    _put(next); changed.push(_public(next));
  }
  return changed;
}
function encryptionReady(){return secrets.ready();}
module.exports={FILE,PROVIDERS,STATES,TRANSITIONS,getConnection,listConnections,getSecret,resolveRouteToken,upsertConnection,transitionConnection,rotateRouteToken,disconnectConnection,reconnectConnection,enterManualFallback,recordHealth,recordSync,deactivateOtherConnections,generateRouteToken,encryptSecret,decryptSecret,encryptionReady,persistConnectionDurable,hydrateFromDatabase,snapshotConnection,restoreConnectionSnapshot};
