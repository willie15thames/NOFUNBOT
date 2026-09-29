/*
 * Provider authority facade. v204.7 prefers an ACTIVE per-league ProviderConnection; legacy runtime/liveSync
 * remains compatibility fallback. Capability flags still come from the provider registry and are never forged.
 */
'use strict';
const registry=require('../providers/gameProvider');
const runtime=require('../league/runtimeService');
function _leagueId(){
  try{const scoped=require('../league/spaceContext').current();if(scoped)return String(scoped);}catch{}
  try{const rows=require('./activeLeagueService').listProviderTargets();if(rows.length===1)return String(rows[0].id);}catch{}
  return null;
}
function _hasAmbiguousLeagueScope(){try{return require('./activeLeagueService').listProviderTargets().length>1;}catch{return false;}}
function getActiveProvider(){
  registry.bootstrap();
  const lid=_leagueId();
  if(lid){
    try{
      const mode=require('./activeLeagueService').getDataSourceMode(lid);
      if(mode!=='external_sync')return registry.get('local');
      const rows=require('./providerConnectionService').listConnections(lid);
      const activeRows=rows.filter(r=>r.status==='active'||r.status==='degraded').sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
      const fallback=rows.find(r=>r.status==='fallback_manual');
      if(fallback&&!activeRows.length)return registry.get('local');
      // Never guess between two authoritative providers. New activation code prevents this; legacy drift fails safe.
      if(activeRows.length>1)return registry.get('local');
      const active=activeRows[0];
      if(active&&registry.get(active.providerKey))return registry.get(active.providerKey);
    }catch{}
  }
  // With multiple leagues and no scoped context, never let the legacy global provider choose for us.
  if(!lid && _hasAmbiguousLeagueScope()) return registry.get('local');
  return registry.resolveActive();
}
function describeProviders(){registry.bootstrap();return registry.list();}
function setActiveProvider(key){registry.bootstrap();if(key==null){runtime.patchRuntime({providerId:null});return{ok:true,provider:getActiveProvider().describe()};}const p=registry.get(key);if(!p)return{ok:false,reason:'unknown-provider',known:registry.list().map(x=>x.key)};runtime.patchRuntime({providerId:p.key});return{ok:true,provider:p.describe()};}
async function healthCheck(providerKey=null){
  const p=providerKey?registry.get(providerKey):getActiveProvider(); if(!p)return{ok:false,reason:'unknown-provider'};
  const h=await p.healthCheck(); const lid=_leagueId();
  if(lid){try{require('./providerConnectionService').recordHealth(lid,p.key,h);}catch{}}
  return{provider:p.key,...h};
}
module.exports={getActiveProvider,describeProviders,setActiveProvider,healthCheck};
