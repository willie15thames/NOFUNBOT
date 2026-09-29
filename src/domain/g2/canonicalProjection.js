'use strict';

const { createHash } = require('crypto');

let pool;
function enabled(){ return !!String(process.env.DATABASE_URL || '').trim(); }
function getPool(){
  if(!enabled()) return null;
  if(!pool){
    const { Pool } = require('pg');
    pool = new Pool({ connectionString:process.env.DATABASE_URL, connectionTimeoutMillis:10000 });
  }
  return pool;
}
function digest(...parts){ return createHash('sha256').update(parts.map(x=>String(x??'')).join('\u001f')).digest('hex').slice(0,24); }
function communityId(guildId){ return `community_${digest('league-community',guildId)}`; }
function serverId(guildId){ return `server_${digest('server',guildId)}`; }
function userPk(guildId,userId){ return `user_${digest('user',guildId,userId)}`; }
function teamPk(guildId,leagueId,baseTeam){ return `team_${digest('team',guildId,leagueId,String(baseTeam||'').trim().toLowerCase())}`; }
function membershipId(guildId,leagueId,userId){ return `member_${digest('membership',guildId,leagueId,userId)}`; }

async function withTx(fn, db=getPool()){
  if(!db) return { skipped:true, reason:'DATABASE_URL_NOT_CONFIGURED' };
  const client=await db.connect();
  try { await client.query('BEGIN'); const out=await fn(client); await client.query('COMMIT'); return out; }
  catch(err){ await client.query('ROLLBACK').catch(()=>{}); throw err; }
  finally { client.release(); }
}

async function ensureLeagueRows(client,{guildId,league,teamEntries=[]}){
  if(!guildId||!league?.id) throw Object.assign(Error('Canonical league projection requires guild and league IDs'),{code:'INVALID_CONTEXT'});
  const cId=communityId(guildId);
  await client.query(`INSERT INTO "server_config" (id,"guildId") VALUES($1,$2) ON CONFLICT ("guildId") DO NOTHING`,[serverId(guildId),guildId]);
  await client.query(`INSERT INTO "communities" (id,"guildId",name,type) VALUES($1,$2,$3,'league') ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,"updatedAt"=NOW()`,[cId,guildId,'CommishAI League Spaces']);
  const existing=(await client.query(`SELECT l.id,c."guildId" FROM "leagues" l JOIN "communities" c ON c.id=l."communityId" WHERE l.id=$1`,[league.id])).rows[0];
  if(existing&&String(existing.guildId)!==String(guildId)) throw Object.assign(Error('League ID belongs to another guild'),{code:'LEAGUE_SCOPE_MISMATCH'});
  await client.query(`INSERT INTO "leagues" (id,"communityId",name,game,"seasonType","seasonWeeks","isActive","leagueTypeId","builtCategoryIds","builtChannelIds","commissionerRoleId","isCustom","leagueTag")
    VALUES($1,$2,$3,$4,$5,$6,true,$7,$8::jsonb,$9::jsonb,$10,$11,$12)
    ON CONFLICT (id) DO UPDATE SET "communityId"=EXCLUDED."communityId",name=EXCLUDED.name,game=EXCLUDED.game,"seasonType"=EXCLUDED."seasonType","seasonWeeks"=EXCLUDED."seasonWeeks","isActive"=true,"leagueTypeId"=EXCLUDED."leagueTypeId","builtCategoryIds"=EXCLUDED."builtCategoryIds","builtChannelIds"=EXCLUDED."builtChannelIds","commissionerRoleId"=EXCLUDED."commissionerRoleId","isCustom"=EXCLUDED."isCustom","leagueTag"=EXCLUDED."leagueTag","updatedAt"=NOW()`,[
      league.id,cId,league.leagueName||league.name||league.id,league.game||null,league.seasonType||null,league.seasonWeeks??null,league.leagueTypeId||null,JSON.stringify(league.builtCategoryIds||[]),JSON.stringify(league.builtChannelIds||[]),league.commissionerRoleId||league.commRoleId||null,!!league.isCustom,league.leagueTag||null
    ]);
  const mapped=[];
  for(const entry of teamEntries){
    if(String(entry.leagueId||league.id)!==String(league.id)) continue;
    const name=String(entry.baseTeam||entry.displayTeam||'').trim(); if(!name) continue;
    const id=entry.teamId||teamPk(guildId,league.id,name);
    const row=(await client.query(`INSERT INTO "teams" (id,"leagueId",name,"displayName","logoUrl","isOpen","ownerId","displayTeam","replacementFor","isCustomTeam")
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT ("leagueId",name) DO UPDATE SET "displayName"=EXCLUDED."displayName","logoUrl"=EXCLUDED."logoUrl","isOpen"=EXCLUDED."isOpen","ownerId"=EXCLUDED."ownerId","displayTeam"=EXCLUDED."displayTeam","replacementFor"=EXCLUDED."replacementFor","isCustomTeam"=EXCLUDED."isCustomTeam","updatedAt"=NOW()
      RETURNING id`,[id,league.id,name,entry.displayTeam||name,entry.logoUrl||null,entry.isOpen!==false,entry.ownerId||null,entry.displayTeam||name,entry.replacementFor||null,!!entry.isCustomTeam])).rows[0];
    entry.teamId=row.id; mapped.push({baseTeam:name,teamId:row.id});
  }
  return {ok:true,leagueId:league.id,teams:mapped};
}

async function projectLeague({guildId,league,teamEntries=[]},db=getPool()){
  if(!db) return {skipped:true,reason:'DATABASE_URL_NOT_CONFIGURED'};
  return withTx(client=>ensureLeagueRows(client,{guildId,league,teamEntries}),db);
}

async function resolveTeam(client,{guildId,leagueId,entry}){
  const name=String(entry?.baseTeam||entry?.displayTeam||'').trim();
  if(!name) throw Object.assign(Error('Team identity required'),{code:'TEAM_REQUIRED'});
  const row=(await client.query(`SELECT t.id FROM "teams" t JOIN "leagues" l ON l.id=t."leagueId" JOIN "communities" c ON c.id=l."communityId" WHERE t."leagueId"=$1 AND lower(t.name)=lower($2) AND c."guildId"=$3`,[leagueId,name,guildId])).rows[0];
  if(!row) throw Object.assign(Error('Canonical team row is missing; rebuild/cut over the league first'),{code:'CANONICAL_TEAM_REQUIRED'});
  entry.teamId=row.id; return row.id;
}

async function projectTeamClaim({guildId,leagueId,entry,userId,timezone=null,displayName=null},db=getPool()){
  if(!db) return {skipped:true,reason:'DATABASE_URL_NOT_CONFIGURED'};
  return withTx(async client=>{
    const teamId=await resolveTeam(client,{guildId,leagueId,entry});
    const uId=userPk(guildId,userId);
    await client.query(`INSERT INTO "users" (id,"guildId","userId",timezone,"nicknameBase") VALUES($1,$2,$3,$4,$5)
      ON CONFLICT ("guildId","userId") DO UPDATE SET timezone=COALESCE(EXCLUDED.timezone,"users".timezone),"nicknameBase"=COALESCE(EXCLUDED."nicknameBase","users"."nicknameBase"),"updatedAt"=NOW()`,[uId,guildId,userId,timezone,displayName]);
    const canonicalUser=(await client.query(`SELECT id FROM "users" WHERE "guildId"=$1 AND "userId"=$2`,[guildId,userId])).rows[0];
    await client.query(`DELETE FROM "team_members" tm USING "teams" t WHERE tm."teamId"=t.id AND tm."userId"=$1 AND t."leagueId"=$2 AND tm."teamId"<>$3`,[canonicalUser.id,leagueId,teamId]);
    await client.query(`INSERT INTO "team_members" ("userId","teamId") VALUES($1,$2) ON CONFLICT ("userId","teamId") DO NOTHING`,[canonicalUser.id,teamId]);
    const defaultMembershipId=membershipId(guildId,leagueId,userId);
    let effectiveMembershipId=defaultMembershipId;
    const seasons=(await client.query(`SELECT id FROM "seasons" WHERE "guildId"=$1 AND "leagueId"=$2 AND state<>'ARCHIVED' ORDER BY "createdAt" DESC FOR UPDATE`,[guildId,leagueId])).rows;
    for(const season of seasons){
      const active=(await client.query(`SELECT * FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "userId"=$4 AND "leftAt" IS NULL FOR UPDATE`,[guildId,leagueId,season.id,userId])).rows;
      if(active.length>1) throw Object.assign(Error('Duplicate active membership tenure requires repair'),{code:'AMBIGUOUS_ACTIVE_TENURE'});
      const mId=active[0]?.membershipId||defaultMembershipId; effectiveMembershipId=mId;
      if(active[0]?.teamId===teamId) continue;
      if(active[0]) await client.query(`UPDATE "membership_tenures" SET "leftAt"=NOW(),"departureType"='TRANSFER',"updatedAt"=NOW() WHERE id=$1`,[active[0].id]);
      await client.query(`INSERT INTO "membership_tenures" (id,"guildId","leagueId","seasonId","membershipId","userId","teamId","joinedAt") VALUES($1,$2,$3,$4,$5,$6,$7,NOW())`,[`tenure_${digest(season.id,mId,teamId,Date.now())}`,guildId,leagueId,season.id,mId,userId,teamId]);
    }
    return {ok:true,userId,teamId,membershipId:effectiveMembershipId,seasons:seasons.length};
  },db);
}

async function projectTeamRelease({guildId,leagueId,entry,userId,departureType='LEAVE',forfeit=true},db=getPool()){
  if(!db) return {skipped:true,reason:'DATABASE_URL_NOT_CONFIGURED'};
  return withTx(async client=>{
    const teamId=await resolveTeam(client,{guildId,leagueId,entry});
    const user=(await client.query(`SELECT id FROM "users" WHERE "guildId"=$1 AND "userId"=$2`,[guildId,userId])).rows[0];
    if(user) await client.query(`DELETE FROM "team_members" WHERE "userId"=$1 AND "teamId"=$2`,[user.id,teamId]);
    const seasons=(await client.query(`SELECT s.id,s."policyVersionId",p.policy FROM "seasons" s LEFT JOIN "progression_policy_versions" p ON p.id=s."policyVersionId" WHERE s."guildId"=$1 AND s."leagueId"=$2 AND s.state<>'ARCHIVED' FOR UPDATE`,[guildId,leagueId])).rows;
    const mId=membershipId(guildId,leagueId,userId);
    for(const season of seasons){
      await client.query(`UPDATE "membership_tenures" SET "leftAt"=NOW(),"departureType"=$5,"updatedAt"=NOW() WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "membershipId"=$4 AND "leftAt" IS NULL`,[guildId,leagueId,season.id,mId,String(departureType).toUpperCase()]);
      if(!forfeit||String(departureType).toUpperCase()==='ROLLBACK'||!season.policy) continue;
      const policy=require('../progression/policy').normalizePolicy(season.policy);
      const key={LEAVE:'onLeave',KICK:'onKick',BAN:'onBan'}[String(departureType).toUpperCase()];
      if(!key||!policy.forfeiture[key]) continue;
      await client.query(`UPDATE "progression_grants" SET status='FORFEITED',"updatedAt"=NOW() WHERE "seasonId"=$1 AND "ownerType"='MEMBER' AND "ownerId"=$2 AND status IN ('AVAILABLE','LOCKED')`,[season.id,mId]);
      await client.query(`UPDATE "progression_claims" SET status='FORFEITED',"updatedAt"=NOW() WHERE "seasonId"=$1 AND "membershipId"=$2 AND status='PENDING'`,[season.id,mId]);
      await client.query(`UPDATE "progression_wallets" SET forfeited=forfeited+GREATEST(0,earned-spent-forfeited-locked),locked=0,"updatedAt"=NOW() WHERE "seasonId"=$1 AND "ownerType"='MEMBER' AND "ownerId"=$2`,[season.id,mId]);
    }
    return {ok:true,userId,teamId,membershipId:mId,seasons:seasons.length};
  },db);
}

module.exports={enabled,getPool,digest,communityId,serverId,userPk,teamPk,membershipId,projectLeague,projectTeamClaim,projectTeamRelease,_ensureLeagueRows:ensureLeagueRows};
