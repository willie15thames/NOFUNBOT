'use strict';
const {randomUUID}=require('crypto');
const {normalizePolicy}=require('./policy');
const {membershipId}=require('../g2/canonicalProjection');
async function reconcileTenures(pool,{guildId,leagueId,seasonId}){
 const client=await pool.connect();try{await client.query('BEGIN');
  const season=(await client.query('SELECT * FROM "seasons" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 FOR UPDATE',[seasonId,guildId,leagueId])).rows[0];
  if(!season?.policyVersionId)throw Object.assign(Error('Season policy required'),{code:'POLICY_NOT_FOUND'});
  const policyRow=(await client.query('SELECT policy FROM "progression_policy_versions" WHERE id=$1',[season.policyVersionId])).rows[0];
  const policy=normalizePolicy(policyRow.policy);
  const source=(await client.query(`SELECT u."userId" AS "userId",tm."teamId" AS "teamId" FROM "team_members" tm JOIN "teams" t ON t.id=tm."teamId" JOIN "users" u ON u.id=tm."userId" WHERE t."leagueId"=$1 AND u."guildId"=$2`,[leagueId,guildId])).rows;
  const unique=new Set(source.map(x=>x.userId));if(unique.size!==source.length)throw Object.assign(Error('A member has multiple canonical team assignments'),{code:'AMBIGUOUS_TEAM_MEMBERSHIP'});
  const active=(await client.query(`SELECT * FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "leftAt" IS NULL FOR UPDATE`,[guildId,leagueId,seasonId])).rows;
  if(new Set(active.map(x=>x.userId)).size!==active.length)throw Object.assign(Error('Duplicate active tenures require repair'),{code:'AMBIGUOUS_ACTIVE_TENURE'});
  const current=new Map(source.map(x=>[x.userId,x.teamId]));let joined=0,left=0,transferred=0;
  const membershipByUser=new Map(active.map(x=>[x.userId,x.membershipId]));
  for(const old of active){
   if(current.get(old.userId)===old.teamId)continue;
   const isTransfer=current.has(old.userId);
   await client.query(`UPDATE "membership_tenures" SET "leftAt"=NOW(),"departureType"=$2,"updatedAt"=NOW() WHERE id=$1`,[old.id,isTransfer?'TRANSFER':'LEAVE']);
   if(isTransfer){transferred++;continue;}
   left++;
   if(policy.forfeiture.onLeave){
    await client.query(`UPDATE "progression_grants" SET status='FORFEITED',"updatedAt"=NOW() WHERE "seasonId"=$1 AND "ownerType"='MEMBER' AND "ownerId"=$2 AND status IN ('AVAILABLE','LOCKED')`,[seasonId,old.membershipId]);
    await client.query(`UPDATE "progression_claims" SET status='FORFEITED',"updatedAt"=NOW() WHERE "seasonId"=$1 AND "membershipId"=$2 AND status='PENDING'`,[seasonId,old.membershipId]);
    await client.query(`UPDATE "progression_wallets" SET forfeited=forfeited+GREATEST(0,earned-spent-forfeited-locked),locked=0,"updatedAt"=NOW() WHERE "seasonId"=$1 AND "ownerType"='MEMBER' AND "ownerId"=$2`,[seasonId,old.membershipId]);
   }
  }
  const still=new Set(active.filter(x=>current.get(x.userId)===x.teamId).map(x=>x.userId));
  for(const row of source){if(still.has(row.userId))continue;
   const stableMembershipId=membershipByUser.get(row.userId)||membershipId(guildId,leagueId,row.userId);
   await client.query(`INSERT INTO "membership_tenures" (id,"guildId","leagueId","seasonId","membershipId","userId","teamId","joinedAt") VALUES($1,$2,$3,$4,$5,$6,$7,NOW())`,[`tenure_${randomUUID()}`,guildId,leagueId,seasonId,stableMembershipId,row.userId,row.teamId]);joined++;
  }
  await client.query('COMMIT');return{ok:true,joined,left,transferred};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
module.exports={reconcileTenures};
