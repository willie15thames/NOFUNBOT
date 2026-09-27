'use strict';
const store=require('../storage/criticalStore');
const key=guildId=>`v204:assignments:${guildId}`;
const norm=x=>String(x||'').trim().toLowerCase();
async function claim(guildId,entry,userId){
 if(!entry.leagueId)throw new Error('A stable league ID is required');
 return store.transact(key(guildId),{assignments:{}},data=>{
  const id=`${entry.leagueId}:${norm(entry.baseTeam)}`;
  const old=data.assignments[id];
  if(old?.userId&&old.userId!==userId)throw new Error('Team is already claimed');
  if(Object.entries(data.assignments).some(([k,v])=>k!==id&&v.leagueId===entry.leagueId&&v.userId===userId))throw new Error('You already own a team in this league');
  data.assignments[id]={...entry,userId,ownerId:userId,isOpen:false,claimedAt:Date.now()};return data.assignments[id];
 });
}
async function release(guildId,entry,userId){
 return store.transact(key(guildId),{assignments:{}},data=>{const id=`${entry.leagueId}:${norm(entry.baseTeam)}`;const old=data.assignments[id];if(old&&(!userId||old.userId===userId)){old.previousUserId=old.userId;old.userId=null;old.ownerId=null;old.isOpen=true;old.releasedAt=Date.now();}});
}
async function restore(guildId,state){
 const data=await store.read(key(guildId),{assignments:{}});
 for(const a of Object.values(data.assignments)){
  if(!require('./activeLeagueService').getLeague(a.leagueId))continue;
  const slot=state.openTeamRegistry.find(t=>t.leagueId===a.leagueId&&norm(t.baseTeam)===norm(a.baseTeam));
  if(slot)Object.assign(slot,{ownerId:a.userId||null,isOpen:!a.userId,timezone:a.timezone||null});
  else state.openTeamRegistry.push({...a,ownerId:a.userId||null,isOpen:!a.userId});
  if(a.userId){const id=`${a.leagueId}::${norm(a.baseTeam)}`;const old=state.players.get(id)||{};state.players.set(id,{...old,leagueId:a.leagueId,userId:a.userId,baseTeam:a.baseTeam,displayTeam:a.displayTeam,streamLog:old.streamLog||[],streamCount:old.streamCount||0});}
 }
}
module.exports={claim,release,restore};
