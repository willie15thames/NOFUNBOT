'use strict';
const { randomUUID }=require('crypto');
const { transition }=require('./stateMachine');
const { normalizePolicy }=require('../progression/policy');
const PLACEHOLDER=/^(default|current|global)$/i;
function id(name,v){v=String(v||'').trim();if(!v||PLACEHOLDER.test(v))throw Object.assign(Error(`${name} must be canonical`),{code:'INVALID_CONTEXT'});return v;}
class SeasonService{
 constructor(repo){this.repo=repo;}
 async create({guildId,leagueId,seasonId=randomUUID(),ordinal=null,year=null,actorId}){
  guildId=id('guildId',guildId);leagueId=id('leagueId',leagueId);seasonId=id('seasonId',seasonId);id('actorId',actorId);
  return this.repo.createSeason({id:seasonId,guildId,leagueId,ordinal,year,state:'PRESEASON_SETUP'});
 }
 async versionPolicy({guildId,leagueId,seasonId,actorId,policy,effectiveAt=new Date(),retroactiveConfirmed=false}){
  [guildId,leagueId,seasonId,actorId].forEach((v,i)=>id(['guildId','leagueId','seasonId','actorId'][i],v));
  const normalized=normalizePolicy(policy);return this.repo.createPolicyVersion({id:`policy_${randomUUID()}`,guildId,leagueId,seasonId,createdBy:actorId,effectiveAt,policy:normalized,retroactiveConfirmed});
 }
 async transition({guildId,seasonId,to,actorId,override=false}){
  id('guildId',guildId);id('seasonId',seasonId);id('actorId',actorId);
  if(this.repo.transitionSeason)return this.repo.transitionSeason({guildId,seasonId,to,actorId,override});
  const row=await this.repo.getSeasonForUpdate({guildId,seasonId});if(!row)return{ok:false,code:'NOT_FOUND'};
  const result=transition(row.state,to,{override});if(!result.ok)return result;await this.repo.updateSeasonState({guildId,seasonId,state:to,actorId});return{ok:true,season:{...row,state:to}};
 }
}
module.exports={SeasonService};
