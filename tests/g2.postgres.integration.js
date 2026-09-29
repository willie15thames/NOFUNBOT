'use strict';
// G2 disposable-PostgreSQL certification: canonical projection, tenure continuity, and forfeiture.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const projection=require('../src/domain/g2/canonicalProjection');

async function main(){
 if(!process.env.DATABASE_URL) throw new Error('Set a disposable DATABASE_URL for G2 PostgreSQL integration');
 if(process.env.NODE_ENV==='production') throw new Error('Do not run G2 integration fixtures in production');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 const suffix=randomUUID().replace(/-/g,'').slice(0,12);
 const guildId=`g2-ci-${suffix}`,leagueId=`league-${suffix}`,seasonId=`season-${suffix}`,policyId=`policy-${suffix}`,userId=`user-${suffix}`;
 const teams=[{leagueId,baseTeam:'Ravens',displayTeam:'Ravens',isOpen:true},{leagueId,baseTeam:'Jets',displayTeam:'Jets',isOpen:true}];
 try{
  await projection.projectLeague({guildId,league:{id:leagueId,leagueName:'G2 CI League',game:'madden'},teamEntries:teams},pool);
  assert.ok(teams[0].teamId&&teams[1].teamId,'canonical teams were not projected');
  await pool.query(`INSERT INTO progression_policy_versions (id,"guildId","leagueId","seasonId",version,"effectiveAt",policy,"createdBy") VALUES($1,$2,$3,$4,1,NOW(),$5::jsonb,'ci')`,[policyId,guildId,leagueId,seasonId,JSON.stringify({forfeiture:{onLeave:true,onKick:true,onBan:true},attribute:{allowedGroups:['SKILL']}})]);
  await pool.query(`INSERT INTO seasons (id,"guildId","leagueId",ordinal,state,"policyVersionId") VALUES($1,$2,$3,1,'PRESEASON_ACTIVE',$4)`,[seasonId,guildId,leagueId,policyId]);

  const first=await projection.projectTeamClaim({guildId,leagueId,entry:teams[0],userId},pool);
  const tenure1=(await pool.query(`SELECT * FROM membership_tenures WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "userId"=$4 AND "leftAt" IS NULL`,[guildId,leagueId,seasonId,userId])).rows[0];
  assert.equal(tenure1.membershipId,first.membershipId);
  await pool.query(`INSERT INTO progression_grants (id,"guildId","leagueId","seasonId","ownerType","ownerId","rewardType",quantity,points,"sourceType","sourceId",status,"policyVersionId") VALUES($1,$2,$3,$4,'MEMBER',$5,'DEV_TRAIT',1,0,'CI','earned','AVAILABLE',$6)`,[`grant-${suffix}`,guildId,leagueId,seasonId,first.membershipId,policyId]);

  const moved=await projection.projectTeamClaim({guildId,leagueId,entry:teams[1],userId},pool);
  assert.equal(moved.membershipId,first.membershipId,'team transfer changed canonical member identity');
  const histories=(await pool.query(`SELECT "membershipId","teamId","leftAt","departureType" FROM membership_tenures WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "userId"=$4 ORDER BY "joinedAt"`,[guildId,leagueId,seasonId,userId])).rows;
  assert.equal(histories.length,2);assert.equal(histories.filter(x=>x.leftAt===null).length,1);assert.equal(histories[0].departureType,'TRANSFER');
  assert.equal((await pool.query(`SELECT status FROM progression_grants WHERE id=$1`,[`grant-${suffix}`])).rows[0].status,'AVAILABLE','team transfer forfeited member reward');

  await projection.projectTeamRelease({guildId,leagueId,entry:teams[1],userId,departureType:'LEAVE'},pool);
  assert.equal((await pool.query(`SELECT status FROM progression_grants WHERE id=$1`,[`grant-${suffix}`])).rows[0].status,'FORFEITED','actual departure did not apply forfeiture policy');
  assert.equal((await pool.query(`SELECT count(*)::int n FROM membership_tenures WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "userId"=$4 AND "leftAt" IS NULL`,[guildId,leagueId,seasonId,userId])).rows[0].n,0);
  console.log('PASS G2 canonical projection, stable transfer identity, and departure forfeiture');
 }finally{
  // G2 tables do not all carry FKs, so clean them explicitly before League cascade cleanup.
  await pool.query(`DELETE FROM "postseason_matches" WHERE "bracketId" IN (SELECT id FROM "postseason_brackets" WHERE "guildId"=$1)`,[guildId]).catch(()=>{});
  for(const [table,col] of [['legacy_progression_migrations','guildId'],['progression_claims','guildId'],['player_mutations','guildId'],['progression_grants','guildId'],['progression_wallets','guildId'],['membership_tenures','guildId'],['tier_assignments','guildId'],['postseason_brackets','guildId'],['progression_policy_versions','guildId'],['seasons','guildId']]){
   await pool.query(`DELETE FROM "${table}" WHERE "${col}"=$1`,[guildId]).catch(()=>{});
  }
  await pool.query(`DELETE FROM communities WHERE "guildId"=$1`,[guildId]).catch(()=>{});
  await pool.query(`DELETE FROM users WHERE "guildId"=$1`,[guildId]).catch(()=>{});
  await pool.query(`DELETE FROM server_config WHERE "guildId"=$1`,[guildId]).catch(()=>{});
  await pool.end();
 }
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
