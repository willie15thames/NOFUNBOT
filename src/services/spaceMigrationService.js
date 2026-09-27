'use strict';
const store=require('../storage/jsonStore');
const context=require('../league/spaceContext');
const registry=require('./activeLeagueService');
async function migrate(guildId,state){
 const managed=await require('./managedSpaceService').list(guildId);
 for(const s of managed){
  if(s.status==='ACTIVE'&&s.builtChannelIds)registry.upsertLeague({...s,leagueName:s.leagueName||s.name});
  else if(['ARCHIVED','REPAIR_REQUIRED'].includes(s.status))registry.removeLeague(s.id);
 }
 const all=registry.listActiveLeagues();
 const match=all.filter(l=>l.id===state.leagueConfig.leagueId||l.leagueName===state.leagueConfig.leagueName);
 const marker=`v204Migration_${guildId}.json`;
 if(!store.loadJson(marker,null)){
  // Attribute singleton data only when the original name/ID resolves uniquely.
  if(match.length===1){
   const primary=match[0];
   const fields=['leagueConfig','scheduleState','hubWeeklyData','leagueMemory','ocrGameResults','potwHistory','yearlyAwardHistory','superbowlHistory','streamMilestones','currentStatLeaders','rewardsBoardIds'];
   const snapshot=Object.fromEntries(fields.map(k=>[k,state[k]]));
   snapshot.leagueConfig={...snapshot.leagueConfig,leagueId:primary.id};
   const clean=JSON.parse(JSON.stringify(snapshot,(k,v)=>/timerId|TimerId$/.test(k)?null:v));
   const files=['leagueRuntime.json','automationPolicy.json','scheduleRegistry.json','weeklyAutomation.json','liveSync.json'];
   const sources=Object.fromEntries(files.map(f=>[f,store.loadJson(f,null)]));
   await context.run(primary.id,async()=>{if(!store.loadJson('spaceState.json',null))store.saveJson('spaceState.json',clean);for(const f of files)if(sources[f]&&!store.loadJson(f,null))store.saveJson(f,sources[f]);await store.flushSpaceWrites();});
   for(const [k,v]of [...state.players])if(!v.leagueId){state.players.delete(k);state.players.set(`${primary.id}::${String(v.baseTeam||k).toLowerCase()}`,{...v,leagueId:primary.id});}
   for(const t of state.openTeamRegistry)if(!t.leagueId)t.leagueId=primary.id;
  }
  await require('./lifetimeHistoryService').importLegacy(guildId,state);
  store.saveJson(marker,{version:1,at:Date.now(),primary:match.length===1?match[0].id:null,unattributed:match.length!==1});
 }
 // Canonicalize legacy player keys without guessing conflicting ownership.
 const conflicts=[];
 for(const [oldKey,player]of [...state.players]){
  if(!player.leagueId)continue;
  const canonical=`${player.leagueId}::${String(player.baseTeam||player.team||oldKey.split('::').at(-1)).trim().toLowerCase()}`;
  if(canonical===oldKey)continue;
  const existing=state.players.get(canonical);
  if(existing?.userId&&player.userId&&existing.userId!==player.userId){conflicts.push({oldKey,canonical});continue;}
  state.players.set(canonical,{...player,...existing,userId:existing?.userId||player.userId});state.players.delete(oldKey);
 }
 if(conflicts.length){store.saveJson('rc6-player-conflicts.json',conflicts);throw Error('Conflicting player ownership: review rc6-player-conflicts.json before continuing');}
 await require('./teamAssignmentService').restore(guildId,state);
 const lifetime=await require('./lifetimeHistoryService').snapshot(guildId);
 for(const player of state.players.values()){
  const account=lifetime.streamAccounts?.[`${player.leagueId}:${player.userId}`];
  if(account){player.streamCount=account.count;player.lastStreamCreditAt=account.lastCreditAt;}
 }
 store.saveJson('players.json',[...state.players].map(([key,value])=>({key,...value})));
 await require('../league/gameResultService').recoverProjections(guildId,state);
 store.saveJson('openTeamRegistry.json',state.openTeamRegistry);
}
module.exports={migrate};
