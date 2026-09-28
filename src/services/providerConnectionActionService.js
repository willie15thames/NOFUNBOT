/*
 * Commissioner-facing provider connection operations. Keeps route token rotation/disconnect/reconnect/test/activate
 * out of the interaction router and serializes connection edits with a connection-specific advisory lock.
 */
'use strict';
const critical=require('../storage/criticalStore');
const connections=require('./providerConnectionService');
const providerService=require('./providerService');
const activeLeagueService=require('./activeLeagueService');
function resolveLeagueId(){try{const x=require('../league/spaceContext').current();if(x)return String(x);}catch{}const rows=activeLeagueService.listActiveLeagues().filter(x=>x.kind!=='event');return rows.length===1?String(rows[0].id):null;}
function publicBase(){return String(process.env.PUBLIC_BASE_URL||(process.env.RAILWAY_PUBLIC_DOMAIN?`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`:'')).replace(/\/$/,'');}
function receiverPath(provider,token,{short=true}={}){if(provider==='companion_export')return short?`/x/${token}`:`/v1/providers/madden/companion/export/${token}`;if(provider==='neonsportz')return short?`/n/${token}`:`/v1/providers/neonsportz/import-completed/${token}`;return null;}
async function withConnectionLock(leagueId,provider,work){
 const r=await critical.withExclusive(`provider-connection:${leagueId}:${provider}`,async()=>{
  const before=connections.snapshotConnection(leagueId,provider);
  try{
   const value=await work();
   if(connections.getConnection(leagueId,provider)){
    const durable=await connections.persistConnectionDurable(leagueId,provider);
    if(!durable.ok){connections.restoreConnectionSnapshot(leagueId,provider,before);return{ok:false,reason:durable.reason||'provider-connection-not-durable'};}
   }
   return value;
  }catch(e){connections.restoreConnectionSnapshot(leagueId,provider,before);throw e;}
 });
 if(!r.acquired)return{ok:false,reason:'connection-locked'};return r.value;
}
async function configure({leagueId=resolveLeagueId(),provider,endpointUrl,externalLeagueId,secret,config={}}={}){
 if(!leagueId)return{ok:false,reason:'league-scope-required'};if(!connections.PROVIDERS.has(provider))return{ok:false,reason:'unsupported-provider'};
 return withConnectionLock(leagueId,provider,async()=>{const existing=connections.getConnection(leagueId,provider);const needsRoute=['companion_export','neonsportz'].includes(provider);const up=connections.upsertConnection({leagueId,providerKey:provider,endpointUrl:endpointUrl!==undefined?endpointUrl:existing?.endpointUrl,externalLeagueId:externalLeagueId!==undefined?externalLeagueId:existing?.externalLeagueId,status:existing?.status||'draft',routeToken:needsRoute&&!existing?.routeTokenHash?true:undefined,secret:secret!==undefined?secret:undefined,config:{...config,receiverExpiresAt:null,receiverMode:'managed'}});const path=up.routeToken?receiverPath(provider,up.routeToken):null;return{ok:true,connection:up.connection,routeToken:up.routeToken||null,receiverUrl:path?`${publicBase()}${path}`||path:null};});
}
async function test({leagueId=resolveLeagueId(),provider}={}){
 if(!leagueId)return{ok:false,reason:'league-scope-required'};const c=connections.getConnection(leagueId,provider);if(!c)return{ok:false,reason:'connection-not-found'};
 return withConnectionLock(leagueId,provider,async()=>{if(c.status==='draft'||c.status==='degraded'||c.status==='blocked'||c.status==='disconnected')connections.upsertConnection({...c,status:'testing'});const h=await require('../league/spaceContext').run(leagueId,()=>providerService.healthCheck(provider));const after=connections.getConnection(leagueId,provider);return{ok:!!h.ok,health:h,connection:after};});
}
async function activate({leagueId=resolveLeagueId(),provider}={}){
 if(!leagueId)return{ok:false,reason:'league-scope-required'};return withConnectionLock(leagueId,provider,async()=>{let c=connections.getConnection(leagueId,provider);if(!c)return{ok:false,reason:'connection-not-found'};if(c.healthStatus!=='healthy')return{ok:false,reason:'test-required'};if(c.status==='testing')c=connections.transitionConnection(leagueId,provider,'ready');if(c.status==='ready'||c.status==='degraded'||c.status==='fallback_manual')c=connections.transitionConnection(leagueId,provider,'active',{fallbackMode:'none'});connections.deactivateOtherConnections(leagueId,provider);try{require('./activeLeagueService').setDataSourceMode(leagueId,'external_sync');}catch{}return{ok:true,connection:connections.getConnection(leagueId,provider)};});
}
async function rotate({leagueId=resolveLeagueId(),provider}={}){if(!leagueId)return{ok:false,reason:'league-scope-required'};if(!['companion_export','neonsportz'].includes(provider))return{ok:false,reason:'route-token-not-used'};return withConnectionLock(leagueId,provider,async()=>{const existing=connections.getConnection(leagueId,provider);if(!existing)return{ok:false,reason:'connection-not-found'};const up=connections.upsertConnection({...existing,routeToken:true,config:{...(existing.config||{}),receiverExpiresAt:null,receiverMode:'managed'},lastError:null});const path=receiverPath(provider,up.routeToken);return{ok:true,connection:up.connection,routeToken:up.routeToken,receiverUrl:`${publicBase()}${path}`||path};});}

async function temporaryUrl({leagueId=resolveLeagueId(),provider='companion_export',minutes=60}={}){
 if(!leagueId)return{ok:false,reason:'league-scope-required'};
 if(!['companion_export','neonsportz'].includes(provider))return{ok:false,reason:'temporary-receiver-not-supported'};
 if(!['1','true','yes','on'].includes(String(process.env.ENABLE_PROVIDER_HTTP||'').toLowerCase()))return{ok:false,reason:'provider-http-disabled'};
 const base=publicBase();
 if(!base)return{ok:false,reason:'public-base-url-required'};
 const mins=Math.max(5,Math.min(10080,Number(minutes)||60));
 const expiresAt=Date.now()+mins*60*1000;
 return withConnectionLock(leagueId,provider,async()=>{
   const existing=connections.getConnection(leagueId,provider);
   const up=connections.upsertConnection({
     leagueId, providerKey:provider,
     endpointUrl:existing?.endpointUrl, externalLeagueId:existing?.externalLeagueId,
     status:existing?.status||'draft', routeToken:true,
     config:{...(existing?.config||{}),receiverExpiresAt:expiresAt,receiverGeneratedAt:Date.now(),receiverMode:'temporary'},
   });
   const path=receiverPath(provider,up.routeToken,{short:true});
   return{ok:true,connection:up.connection,routeToken:up.routeToken,receiverUrl:`${base}${path}`,expiresAt,minutes:mins};
 });
}
async function disconnect({leagueId=resolveLeagueId(),provider}={}){if(!leagueId)return{ok:false,reason:'league-scope-required'};return withConnectionLock(leagueId,provider,async()=>{const c=connections.disconnectConnection(leagueId,provider);if(!c)return{ok:false,reason:'connection-not-found'};try{require('./activeLeagueService').setDataSourceMode(leagueId,'custom_bot_managed');}catch{}return{ok:true,connection:c};});}
async function reconnect({leagueId=resolveLeagueId(),provider}={}){if(!leagueId)return{ok:false,reason:'league-scope-required'};return withConnectionLock(leagueId,provider,async()=>{const r=connections.reconnectConnection(leagueId,provider,{rotateToken:['companion_export','neonsportz'].includes(provider)});if(r.connection&&['companion_export','neonsportz'].includes(provider))connections.upsertConnection({...connections.getConnection(leagueId,provider),config:{...(connections.getConnection(leagueId,provider)?.config||{}),receiverExpiresAt:null,receiverMode:'managed'}});const path=r.routeToken?receiverPath(provider,r.routeToken):null;return{ok:true,connection:connections.getConnection(leagueId,provider)||r.connection,routeToken:r.routeToken,receiverUrl:path?`${publicBase()}${path}`||path:null};});}
async function fallback({leagueId=resolveLeagueId(),provider,reason='commissioner manual fallback'}={}){if(!leagueId)return{ok:false,reason:'league-scope-required'};return withConnectionLock(leagueId,provider,async()=>{const c=connections.enterManualFallback(leagueId,provider,reason);return{ok:true,connection:c};});}
function status({leagueId=resolveLeagueId()}={}){if(!leagueId)return{ok:false,reason:'league-scope-required',connections:[]};return{ok:true,leagueId,connections:connections.listConnections(leagueId)};}
module.exports={resolveLeagueId,receiverPath,configure,test,activate,rotate,temporaryUrl,disconnect,reconnect,fallback,status};
