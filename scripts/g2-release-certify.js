'use strict';
// Production/staging G2 readiness proof. Run only after migrations against the target database.
const {Pool}=require('pg');
async function main(){
 if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for G2 certification');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
 const failures=[];
 try{
  const reg=async(sql,args=[])=>(await pool.query(sql,args)).rows;
  const duplicate=await reg(`SELECT "guildId","leagueId","seasonId","userId",COUNT(*)::int AS n FROM membership_tenures WHERE "leftAt" IS NULL GROUP BY 1,2,3,4 HAVING COUNT(*)>1 LIMIT 20`);
  if(duplicate.length) failures.push(`duplicate active membership tenures: ${duplicate.length}`);
  const review=await reg(`SELECT "guildId","leagueId","seasonId",COUNT(*)::int AS n FROM legacy_progression_migrations WHERE status='REVIEW_REQUIRED' GROUP BY 1,2,3 ORDER BY n DESC LIMIT 20`);
  if(review.length) failures.push(`legacy progression rows still require commissioner review: ${review.reduce((n,r)=>n+Number(r.n),0)}`);
  const orphanClaims=await reg(`SELECT c.id FROM progression_claims c LEFT JOIN membership_tenures t ON t."membershipId"=c."membershipId" AND t."seasonId"=c."seasonId" WHERE c.status='PENDING' AND t.id IS NULL LIMIT 20`);
  if(orphanClaims.length) failures.push(`pending progression claims without tenure: ${orphanClaims.length}`);
  const activeSeasonsNoPolicy=await reg(`SELECT id FROM seasons WHERE state<>'ARCHIVED' AND "policyVersionId" IS NULL LIMIT 20`);
  if(activeSeasonsNoPolicy.length) failures.push(`active seasons without progression policy: ${activeSeasonsNoPolicy.length}`);
  const mappedProviders=await reg(`SELECT c."guildId",c."leagueId",c."providerKey" FROM provider_connections c WHERE c.status IN ('active','ready') AND c."providerKey" IN ('companion_export','neonsportz','custom_endpoint') AND NOT EXISTS (SELECT 1 FROM provider_team_mappings m WHERE m."guildId"=c."guildId" AND m."leagueId"=c."leagueId" AND m."providerKey"=c."providerKey") LIMIT 20`);
  if(mappedProviders.length) failures.push(`active G2 provider connections without team mappings: ${mappedProviders.length}`);
  if(failures.length){console.error('G2 release certification FAILED');for(const x of failures)console.error(' - '+x);process.exitCode=1;return;}
  console.log('G2 release certification PASS');
  console.log(' - one active tenure per member/season');
  console.log(' - no unresolved legacy progression review rows');
  console.log(' - no orphan pending claims');
  console.log(' - all active seasons have a policy version');
  console.log(' - active supported providers have canonical team mappings');
 } finally { await pool.end(); }
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
