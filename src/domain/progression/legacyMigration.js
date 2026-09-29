'use strict';
const {randomUUID}=require('crypto');
const {PostgresProgressionRepository}=require('./postgresRepository');

function inferRewards(award={}){
  if(Array.isArray(award.rewardTypes)&&award.rewardTypes.length) return award.rewardTypes.map(rewardType=>({rewardType:String(rewardType).toUpperCase(),quantity:1,points:0}));
  if(award.rewardType) return [{rewardType:String(award.rewardType).toUpperCase(),quantity:Number(award.quantity||1),points:Number(award.points||0)}];
  const title=String(award.title||award.awardLabel||'').trim();
  if(/super\s*bowl\s*champ/i.test(title)) return [{rewardType:'AGE_RESET',quantity:1,points:0},{rewardType:'DEV_TRAIT',quantity:1,points:0}];
  if(/age\s*reset/i.test(title)&&!(/\bor\b/i.test(title))) return [{rewardType:'AGE_RESET',quantity:1,points:0}];
  if(/superstar.*dev|dev\s*(trait|upgrade)/i.test(title)&&!(/\bor\b/i.test(title))) return [{rewardType:'DEV_TRAIT',quantity:1,points:0}];
  if(/attribute|attr.*boost/i.test(title)){
    const points=Number(award.points||String(award.details||'').match(/\+?(\d+)\s*(?:point|attr|rating)/i)?.[1]||0);
    if(Number.isInteger(points)&&points>0)return [{rewardType:'ATTRIBUTE_POINTS',quantity:1,points}];
  }
  return [];
}

async function recordMigration(client,{guildId,leagueId,seasonId,sourceType,sourceId,userId,status,payload,resolution={}}){
  const id=`legacy_${randomUUID()}`;
  const r=await client.query(`INSERT INTO "legacy_progression_migrations" (id,"guildId","leagueId","seasonId","sourceType","sourceId","userId",status,payload,resolution)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
    ON CONFLICT ("guildId","sourceType","sourceId") DO UPDATE SET status=EXCLUDED.status,resolution=EXCLUDED.resolution,"updatedAt"=NOW()
    RETURNING *`,[id,guildId,leagueId,seasonId,sourceType,sourceId,userId||null,status,JSON.stringify(payload||{}),JSON.stringify(resolution||{})]);
  return r.rows[0];
}

async function migrateLifetimeAwards(pool,{guildId,leagueId,seasonId,actorId}){
  const history=await require('../../services/lifetimeHistoryService').snapshot(guildId);
  const awards=Object.values(history.awards||{}).filter(a=>a&&a.status==='ACTIVE'&&String(a.leagueId)===String(leagueId));
  const repo=new PostgresProgressionRepository(pool);
  const season=(await pool.query(`SELECT * FROM "seasons" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3`,[seasonId,guildId,leagueId])).rows[0];
  if(!season?.policyVersionId)throw Object.assign(Error('Season policy required'),{code:'POLICY_NOT_FOUND'});
  let migrated=0,review=0,skipped=0;
  for(const award of awards){
    const sourceId=String(award.id||award.sourceId||'').trim(); if(!sourceId){skipped++;continue;}
    const rewards=inferRewards(award);
    const tenure=award.userId?(await pool.query(`SELECT "membershipId" FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "userId"=$4 AND "leftAt" IS NULL`,[guildId,leagueId,seasonId,String(award.userId)])).rows:null;
    if(!award.userId||!rewards.length||tenure?.length!==1){
      const reason=!award.userId?'MEMBER_ATTRIBUTION_REQUIRED':!rewards.length?'REWARD_TYPE_REVIEW_REQUIRED':'ACTIVE_MEMBERSHIP_REQUIRED';
      await recordMigration(pool,{guildId,leagueId,seasonId,sourceType:'LIFETIME_AWARD',sourceId,userId:award.userId,status:'REVIEW_REQUIRED',payload:award,resolution:{reason}}); review++; continue;
    }
    const membershipId=tenure[0].membershipId, grantIds=[];
    try{
      for(const reward of rewards){
        const row=await repo.issueMemberReward({guildId,leagueId,seasonId,ownerId:membershipId,rewardType:reward.rewardType,quantity:reward.quantity||1,points:reward.points||0,sourceType:'LEGACY_AWARD',sourceId:`${sourceId}:${reward.rewardType}`,policyVersionId:season.policyVersionId,actorId});
        grantIds.push(row.id);
      }
      await recordMigration(pool,{guildId,leagueId,seasonId,sourceType:'LIFETIME_AWARD',sourceId,userId:award.userId,status:'MIGRATED',payload:award,resolution:{grantIds,rewards}}); migrated++;
    }catch(err){
      await recordMigration(pool,{guildId,leagueId,seasonId,sourceType:'LIFETIME_AWARD',sourceId,userId:award.userId,status:'REVIEW_REQUIRED',payload:award,resolution:{reason:err.code||'MIGRATION_FAILED',message:String(err.message||err).slice(0,300)}}); review++;
    }
  }
  return {ok:true,total:awards.length,migrated,review,skipped};
}

async function importPendingBoostReview(pool,{guildId,leagueId,seasonId,pendingBoosts}){
  let migrated=0;
  for(const [key,value] of pendingBoosts||[]){
    await recordMigration(pool,{guildId,leagueId,seasonId,sourceType:'PENDING_ATTR_BOOST',sourceId:String(key),userId:value?.userId||value?.requesterId||null,status:'REVIEW_REQUIRED',payload:value||{},resolution:{reason:'LEGACY_PENDING_CLAIM_REQUIRES_CANONICAL_ENTITLEMENT_AND_PROVIDER_BASELINE'}}); migrated++;
  }
  return {ok:true,migrated};
}

async function report(pool,{guildId,leagueId,seasonId}){
  const rows=(await pool.query(`SELECT status,COUNT(*)::int AS count FROM "legacy_progression_migrations" WHERE "guildId"=$1 AND "leagueId"=$2 AND ($3::text IS NULL OR "seasonId"=$3) GROUP BY status`,[guildId,leagueId,seasonId||null])).rows;
  const counts=Object.fromEntries(rows.map(r=>[r.status,Number(r.count)]));
  return {counts,reviewRequired:Number(counts.REVIEW_REQUIRED||0),ready:Number(counts.REVIEW_REQUIRED||0)===0};
}
module.exports={inferRewards,recordMigration,migrateLifetimeAwards,importPendingBoostReview,report};
