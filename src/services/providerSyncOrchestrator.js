/*
 * v204.7 provider sync orchestrator. Single owner of per-league sync locking, durable run lifecycle,
 * push-import draining, pull-provider execution, and connection status updates. Sync never advances a franchise.
 */
'use strict';
const critical=require('../storage/criticalStore');
const syncRuns=require('./providerSyncRunService');
const connections=require('./providerConnectionService');
function leagueId(){try{const id=require('../league/spaceContext').current();if(id)return String(id);}catch{}try{const rows=require('./activeLeagueService').listActiveLeagues();if(rows.length===1)return String(rows[0].id);}catch{}return 'default';}
async function run({guild,state,provider,trigger='manual',processImports,pullSync}){
  const lid=leagueId(), key=`provider-sync:${guild?.id||'global'}:${lid}`;
  const locked=await critical.withExclusive(key,async()=>{
    const run=await syncRuns.startDurable({leagueId:lid,providerKey:provider.key,trigger});
    try{
      const out=await (processImports?processImports():pullSync());
      await syncRuns.finishDurable(run.id,{ok:!!out?.ok,result:out}); connections.recordSync(lid,provider.key,out||{ok:false,reason:'empty-result'});
      return {...out,syncRunId:run.id};
    }catch(e){await syncRuns.finishDurable(run.id,{ok:false,error:e.message}).catch(()=>null);connections.recordSync(lid,provider.key,{ok:false,error:e.message});throw e;}
  });
  return locked.acquired?locked.value:{ok:false,reason:'provider-sync-locked',provider:provider.key};
}
module.exports={run,leagueId};
