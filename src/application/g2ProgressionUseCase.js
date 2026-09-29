'use strict';
const {randomUUID}=require('crypto');
const {SeasonService}=require('../domain/season/service');
const {PostgresSeasonRepository}=require('../domain/season/postgresRepository');
const {PostgresProgressionRepository}=require('../domain/progression/postgresRepository');
const {PostgresPostseasonRepository}=require('../domain/postseason/postgresRepository');
const {normalizePolicy}=require('../domain/progression/policy');
const {requiredString}=require('./requestContext');
const {readPlayer,readSpecial}=require('../domain/progression/providerRosterEvidence');

let runtimePool;
function getPool(){
 if(!process.env.DATABASE_URL)throw Object.assign(Error('PostgreSQL is required for progression'),{code:'DATABASE_REQUIRED'});
 if(!runtimePool)runtimePool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
 return runtimePool;
}
function parseJson(raw,label){try{return JSON.parse(raw);}catch{throw Object.assign(Error(`${label} must be valid JSON`),{code:'INVALID_JSON'});}}
async function assertLeague(pool,guildId,leagueId){
 const row=(await pool.query(`SELECT l.id FROM "leagues" l JOIN "communities" c ON c.id=l."communityId" WHERE l.id=$1 AND c."guildId"=$2 AND l."isActive"=true`,[leagueId,guildId])).rows[0];
 if(!row)throw Object.assign(Error('League is not active in this server database'),{code:'LEAGUE_NOT_FOUND'});
}
async function assertSeason(pool,guildId,leagueId,seasonId){
 const row=(await pool.query('SELECT * FROM "seasons" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3',[seasonId,guildId,leagueId])).rows[0];
 if(!row)throw Object.assign(Error('Season not found in this league'),{code:'SEASON_NOT_FOUND'});
 return row;
}
async function openSeason(pool,{guildId,leagueId,year,actorId}){
 if(!Number.isInteger(year)||year<2000||year>2200)throw Object.assign(Error('Season year is invalid'),{code:'INVALID_YEAR'});
 const client=await pool.connect();try{await client.query('BEGIN');
  await client.query('SELECT id FROM "leagues" WHERE id=$1 FOR UPDATE',[leagueId]);
  const current=await client.query(`SELECT id FROM "seasons" WHERE "guildId"=$1 AND "leagueId"=$2 AND state<>'ARCHIVED' LIMIT 1`,[guildId,leagueId]);
  if(current.rowCount)throw Object.assign(Error('Archive the current season before creating another'),{code:'SEASON_ALREADY_OPEN'});
  const seasonId=`season_${randomUUID()}`;
  await client.query(`INSERT INTO "seasons" (id,"guildId","leagueId",ordinal,year,state) VALUES($1,$2,$3,$4,$4,'PRESEASON_SETUP')`,[seasonId,guildId,leagueId,year]);
  const policyId=`policy_${randomUUID()}`;
  await client.query(`INSERT INTO "progression_policy_versions" (id,"guildId","leagueId","seasonId",version,"effectiveAt",policy,"createdBy") VALUES($1,$2,$3,$4,1,NOW(),$5::jsonb,$6)`,[policyId,guildId,leagueId,seasonId,JSON.stringify(normalizePolicy()),actorId]);
  await client.query('UPDATE "seasons" SET "policyVersionId"=$2 WHERE id=$1',[seasonId,policyId]);
  // Snapshot only canonical team memberships. Legacy JSON assignments require
  // explicit migration before rewards can be claimed.
  await client.query(`INSERT INTO "membership_tenures" (id,"guildId","leagueId","seasonId","membershipId","userId","teamId","joinedAt")
   SELECT 'tenure_' || md5($1 || ':' || tm."teamId" || ':' || u."userId"),$2,$3,$1,
          'member_' || md5($3 || ':' || u."userId"),u."userId",tm."teamId",NOW()
   FROM "team_members" tm JOIN "teams" t ON t.id=tm."teamId" JOIN "users" u ON u.id=tm."userId"
   WHERE t."leagueId"=$3 AND u."guildId"=$2`,[seasonId,guildId,leagueId]);
  await client.query('COMMIT');return{seasonId,policyId};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
async function execute({guildId,leagueId,seasonId,actorId,sub,options,commissioner,pool=getPool()}){
 guildId=requiredString('guildId',guildId);leagueId=requiredString('leagueId',leagueId);actorId=requiredString('actorId',actorId);
 await assertLeague(pool,guildId,leagueId);
 const admin=new Set(['open-season','set-policy','tiers','initial-grant','initial-all','sync-tenures','migrate-legacy','grant-reward','state','seed-bracket','bracket-result','map-team','approve-claim']);
 if(admin.has(sub)&&!commissioner)return{ok:false,code:'COMMISSIONER_REQUIRED'};
 if(sub==='open-season')return{ok:true,...await openSeason(pool,{guildId,leagueId,year:options.year,actorId})};
 seasonId=requiredString('seasonId',seasonId);const season=await assertSeason(pool,guildId,leagueId,seasonId);
 const seasonRepo=new PostgresSeasonRepository(pool),progress=new PostgresProgressionRepository(pool);
 if(sub==='set-policy'){
  const parsed=parseJson(options.policyJson,'Policy');
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')return{ok:false,code:'INVALID_POLICY'};
  const row=await new SeasonService(seasonRepo).versionPolicy({guildId,leagueId,seasonId,actorId,policy:parsed,retroactiveConfirmed:options.confirmRetroactive});
  return{ok:true,policyId:row.id,version:row.version};
 }
 if(sub==='tiers'){
  const teams=(await pool.query('SELECT id FROM "teams" WHERE "leagueId"=$1 ORDER BY id',[leagueId])).rows.map(x=>x.id);
  const p=(await progress.getPolicy(season.policyVersionId)).policy;
  const settings=normalizePolicy(p).tier;const manual=settings.mode==='MANUAL'?parseJson(options.seedOrManual,'Manual tier map'):undefined;
  const rows=await progress.finalizeTiers({guildId,leagueId,seasonId,teamIds:teams,seed:settings.mode==='RANDOM'?options.seedOrManual:undefined,manual,actorId});
  return{ok:true,tiers:rows};
 }
 if(sub==='initial-grant'){
  const grants=await progress.grantInitialPackage({guildId,leagueId,seasonId,teamId:requiredString('teamId',options.teamId)});
  return{ok:true,grants};
 }
 if(sub==='initial-all'){
  const teams=(await pool.query('SELECT id FROM "teams" WHERE "leagueId"=$1 ORDER BY id',[leagueId])).rows;
  let count=0;for(const team of teams){await progress.grantInitialPackage({guildId,leagueId,seasonId,teamId:team.id});count++;}
  return{ok:true,teamCount:count};
 }
 if(sub==='sync-tenures')return require('../domain/progression/tenureReconciliation').reconcileTenures(pool,{guildId,leagueId,seasonId});
 if(sub==='migrate-legacy'){
  const tenure=await require('../domain/progression/tenureReconciliation').reconcileTenures(pool,{guildId,leagueId,seasonId});
  const migration=require('../domain/progression/legacyMigration');
  const awards=await migration.migrateLifetimeAwards(pool,{guildId,leagueId,seasonId,actorId});
  const state=require('../state');
  const pendingEntries=[...(state.pendingAttrBoosts||new Map()).entries()];
  const pending=await migration.importPendingBoostReview(pool,{guildId,leagueId,seasonId,pendingBoosts:pendingEntries});
  if(pendingEntries.length){
   state.pendingAttrBoosts.clear();
   require('../storage/jsonStore').saveJson('pendingAttrBoosts.json',{});
  }
  const report=await migration.report(pool,{guildId,leagueId,seasonId});
  return{ok:true,tenure,awards,pending,report};
 }
 if(sub==='grant-reward'){
  const tenure=(await pool.query(`SELECT * FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "userId"=$4 AND "leftAt" IS NULL`,[guildId,leagueId,seasonId,options.memberId])).rows;
  if(tenure.length!==1)return{ok:false,code:'UNIQUE_ACTIVE_MEMBERSHIP_REQUIRED'};
  const row=await progress.issueMemberReward({guildId,leagueId,seasonId,ownerId:tenure[0].membershipId,rewardType:'ATTRIBUTE_POINTS',quantity:1,points:options.points,sourceType:'COMMISSIONER_AWARD',sourceId:requiredString('sourceId',options.sourceId),policyVersionId:season.policyVersionId});
  return{ok:true,grantId:row.id,idempotent:!!row.idempotent};
 }
 if(sub==='state')return new SeasonService(seasonRepo).transition({guildId,seasonId,to:options.next,actorId});
 if(sub==='seed-bracket'){
  const policy=normalizePolicy((await progress.getPolicy(season.policyVersionId)).policy);
  return new PostgresPostseasonRepository(pool).seed({guildId,leagueId,seasonId,seeds:parseJson(options.seedsJson,'Seeds'),policy:policy.postseason});
 }
 if(sub==='bracket-result'){
  const matchId=requiredString('matchId',options.matchId),providerGameId=requiredString('providerGameId',options.providerGameId);
  const match=(await pool.query(`SELECT m.* FROM "postseason_matches" m JOIN "postseason_brackets" b ON b.id=m."bracketId" WHERE m.id=$1 AND b."guildId"=$2 AND b."leagueId"=$3 AND b."seasonId"=$4`,[matchId,guildId,leagueId,seasonId])).rows[0];
  if(!match)return{ok:false,code:'MATCH_NOT_FOUND'};
  const {readGameResult}=require('../domain/postseason/providerGameEvidence');
  const result=await readGameResult(pool,{guildId,leagueId,homeTeamId:match.homeTeamId,awayTeamId:match.awayTeamId,providerGameId});
  if(!result.ok)return result;
  return new PostgresPostseasonRepository(pool).recordResult({guildId,leagueId,seasonId,matchId,winnerTeamId:result.winnerTeamId,providerGameId,evidence:result.evidence});
 }
 if(sub==='map-team'){
  const teamId=requiredString('teamId',options.teamId),externalTeamId=requiredString('externalTeamId',options.externalTeamId),provider=requiredString('provider',options.provider);
  const team=(await pool.query('SELECT id FROM "teams" WHERE id=$1 AND "leagueId"=$2',[teamId,leagueId])).rows[0];
  const connection=(await pool.query(`SELECT id FROM "provider_connections" WHERE "leagueId"=$1 AND "providerKey"=$2 AND status IN ('ready','active')`,[leagueId,provider])).rows[0];
  if(!team||!connection)return{ok:false,code:'TEAM_OR_PROVIDER_NOT_READY'};
  await pool.query(`INSERT INTO "provider_team_mappings" (id,"guildId","leagueId","providerKey","teamId","externalTeamId","mappedBy") VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT ("leagueId","providerKey","teamId") DO UPDATE SET "externalTeamId"=EXCLUDED."externalTeamId","mappedBy"=EXCLUDED."mappedBy","updatedAt"=NOW()`,[`mapping_${randomUUID()}`,guildId,leagueId,provider,teamId,externalTeamId,actorId]);
  return{ok:true};
 }
 if(sub==='approve-claim'){
  const claim=(await pool.query(`SELECT * FROM "progression_claims" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 AND "seasonId"=$4`,[requiredString('claimId',options.claimId),guildId,leagueId,seasonId])).rows[0];
  if(!claim||claim.status!=='PENDING')return{ok:false,code:'CLAIM_NOT_PENDING'};
  const requested=claim.requestedMutations?.[0];
  if(['DEV_TRAIT','AGE_RESET'].includes(requested?.type))return progress.approveSpecial({guildId,leagueId,seasonId,claimId:claim.id,approvalActorId:actorId},readSpecial);
  if(requested?.type!=='ATTRIBUTE')return{ok:false,code:'INVALID_CLAIM'};
  const input={guildId,leagueId,seasonId,membershipId:claim.membershipId,teamId:claim.teamId,playerId:claim.playerId,grantId:claim.grantId,
    attributeKey:requested.attributeKey,attributeGroup:requested.attributeGroup,points:requested.points,idempotencyKey:claim.idempotencyKey,actorId:claim.actorId,
    approvalActorId:actorId,existingClaimId:claim.id};
  return progress.claimAttribute(input,async(_,client)=>{
   const after=await readPlayer(client,{guildId,leagueId,teamId:claim.teamId,playerId:claim.playerId,attributeKey:requested.attributeKey,
      afterReceivedAt:requested.baselineProvenance?.verifiedAt});
   if(!after.ok)return after;
   if(after.provenance.provider!==requested.baselineProvenance?.provider)return{ok:false,code:'PROVIDER_CHANGED'};
   return{...after,applied:true,before:requested.before,after:after.rating};
  });
 }
 if(sub==='claim-special'){
  const grantId=requiredString('grantId',options.grantId),playerId=requiredString('playerId',options.playerId);
  const grant=(await pool.query(`SELECT * FROM "progression_grants" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 AND "seasonId"=$4`,[grantId,guildId,leagueId,seasonId])).rows[0];
  if(!grant||!['DEV_TRAIT','AGE_RESET'].includes(grant.rewardType))return{ok:false,code:'SPECIAL_ENTITLEMENT_REQUIRED'};
  const tenures=(await pool.query(`SELECT * FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "userId"=$4 AND "leftAt" IS NULL`,[guildId,leagueId,seasonId,actorId])).rows;
  if(tenures.length!==1)return{ok:false,code:'UNIQUE_ACTIVE_MEMBERSHIP_REQUIRED'};
  const t=tenures[0];
  return progress.requestSpecial({guildId,leagueId,seasonId,membershipId:t.membershipId,teamId:t.teamId,actorId,grantId,playerId,
    rewardType:grant.rewardType,target:options.targetTrait,idempotencyKey:options.interactionId},readSpecial);
 }
 if(sub==='cancel-claim'){
  const changed=await pool.query(`UPDATE "progression_claims" SET status='CANCELLED',"updatedAt"=NOW() WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 AND "seasonId"=$4 AND "actorId"=$5 AND status='PENDING' RETURNING id`,[requiredString('claimId',options.claimId),guildId,leagueId,seasonId,actorId]);
  return changed.rowCount?{ok:true,claimId:changed.rows[0].id}:{ok:false,code:'OWN_PENDING_CLAIM_REQUIRED'};
 }
 if(sub==='rewards'){
  const tenure=(await pool.query(`SELECT "membershipId" FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "userId"=$4 AND "leftAt" IS NULL`,[guildId,leagueId,seasonId,actorId])).rows;
  if(tenure.length!==1)return{ok:false,code:'UNIQUE_ACTIVE_MEMBERSHIP_REQUIRED'};
  const membershipId=tenure[0].membershipId;
  const grants=(await pool.query(`SELECT id,"rewardType",quantity,points,status,"sourceType","sourceId" FROM "progression_grants" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "ownerType"='MEMBER' AND "ownerId"=$4 ORDER BY "createdAt" DESC LIMIT 20`,[guildId,leagueId,seasonId,membershipId])).rows;
  const wallet=(await pool.query(`SELECT earned,spent,forfeited,locked FROM "progression_wallets" WHERE "seasonId"=$1 AND "ownerType"='MEMBER' AND "ownerId"=$2 AND currency='ATTRIBUTE_POINTS'`,[seasonId,membershipId])).rows[0]||null;
  return{ok:true,grants,wallet};
 }
 if(sub==='policy'){
  if(!commissioner){
   const membership=(await pool.query(`SELECT id FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "userId"=$4 AND "leftAt" IS NULL LIMIT 1`,[guildId,leagueId,seasonId,actorId])).rows[0];
   if(!membership)return{ok:false,code:'MEMBERSHIP_REQUIRED'};
  }
  const row=await progress.getPolicy(season.policyVersionId);
  if(!row)return{ok:false,code:'POLICY_NOT_FOUND'};
  return{ok:true,version:row.version,policy:normalizePolicy(row.policy),state:season.state};
 }
 return{ok:false,code:'UNSUPPORTED_OPERATION'};
}
async function requestAttribute({guildId,leagueId,actorId,grantId,playerId,attributeKey,points,idempotencyKey,pool=getPool()}){
 [guildId,leagueId,actorId,grantId,playerId,attributeKey,idempotencyKey].forEach((v,i)=>requiredString(['guildId','leagueId','actorId','grantId','playerId','attributeKey','idempotencyKey'][i],v));
 await assertLeague(pool,guildId,leagueId);
 const grant=(await pool.query(`SELECT * FROM "progression_grants" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3`,[grantId,guildId,leagueId])).rows[0];
 if(!grant)return{ok:false,code:'ENTITLEMENT_UNAVAILABLE'};
 const tenures=(await pool.query(`SELECT * FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "userId"=$4 AND "leftAt" IS NULL`,[guildId,leagueId,grant.seasonId,actorId])).rows;
 if(tenures.length!==1)return{ok:false,code:'UNIQUE_ACTIVE_MEMBERSHIP_REQUIRED'};
 const t=tenures[0];
 return new PostgresProgressionRepository(pool).requestAttribute({guildId,leagueId,seasonId:grant.seasonId,membershipId:t.membershipId,teamId:t.teamId,
   actorId,grantId,playerId,attributeKey,points,idempotencyKey},readPlayer);
}
module.exports={execute,requestAttribute,getPool,openSeason,assertLeague,assertSeason};
