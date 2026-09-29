'use strict';
const {PostgresProgressionRepository}=require('./postgresRepository');
async function issueIfActive({guildId,leagueId,userId,sourceId,rewardType=null,rewardTypes=null,points=0,actorId=null}){
  if(!process.env.DATABASE_URL||!guildId||!leagueId||!userId||!sourceId)return{skipped:true,reason:'CANONICAL_CONTEXT_UNAVAILABLE'};
  const types=(Array.isArray(rewardTypes)?rewardTypes:[rewardType]).filter(Boolean).map(x=>String(x).toUpperCase());
  if(!types.length)return{skipped:true,reason:'NO_CANONICAL_REWARD'};
  const pool=require('../g2/canonicalProjection').getPool();
  const season=(await pool.query(`SELECT * FROM "seasons" WHERE "guildId"=$1 AND "leagueId"=$2 AND state<>'ARCHIVED' ORDER BY "createdAt" DESC LIMIT 1`,[guildId,leagueId])).rows[0];
  if(!season?.policyVersionId)return{skipped:true,reason:'NO_ACTIVE_G2_SEASON'};
  const tenures=(await pool.query(`SELECT "membershipId" FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "userId"=$4 AND "leftAt" IS NULL`,[guildId,leagueId,season.id,userId])).rows;
  if(tenures.length!==1)return{skipped:true,reason:'ACTIVE_MEMBERSHIP_REQUIRED'};
  const repo=new PostgresProgressionRepository(pool), grants=[];
  for(const type of types){
    const row=await repo.issueMemberReward({guildId,leagueId,seasonId:season.id,ownerId:tenures[0].membershipId,rewardType:type,quantity:1,points:type==='ATTRIBUTE_POINTS'?Number(points||0):0,sourceType:'LEGACY_COMMAND_BRIDGE',sourceId:`${sourceId}:${type}`,policyVersionId:season.policyVersionId,actorId:actorId||userId});
    grants.push(row);
  }
  return{ok:true,seasonId:season.id,grants};
}
module.exports={issueIfActive};
