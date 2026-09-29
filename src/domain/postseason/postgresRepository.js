'use strict';
const {randomUUID}=require('crypto');
const {buildSingleElimination}=require('./bracket');
class PostgresPostseasonRepository{
 constructor(pool){if(!pool)throw Error('PostgreSQL pool required');this.pool=pool;}
 async seed({guildId,leagueId,seasonId,seeds,policy}){
  const client=await this.pool.connect();try{await client.query('BEGIN');
   const season=(await client.query('SELECT * FROM "seasons" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 FOR UPDATE',[seasonId,guildId,leagueId])).rows[0];
   if(!season||season.state!=='POSTSEASON_SEEDING')throw Object.assign(Error('Season must be in postseason seeding'),{code:'INVALID_SEASON_STATE'});
   if(policy.format&&policy.format!=='SINGLE_ELIMINATION')throw Object.assign(Error('Unsupported postseason format'),{code:'UNSUPPORTED_FORMAT'});
   const bracket=buildSingleElimination(seeds,{seedCount:policy.seedCount,byes:policy.byes});
   const eligible=(await client.query('SELECT id FROM "teams" WHERE "leagueId"=$1',[leagueId])).rows.map(x=>x.id);
   if(seeds.some(x=>!eligible.includes(x.teamId)))throw Object.assign(Error('Seeded team is outside league'),{code:'TEAM_SCOPE'});
   const id=`bracket_${randomUUID()}`;
   const inserted=await client.query(`INSERT INTO "postseason_brackets" (id,"guildId","leagueId","seasonId",format,"seedCount",seeds,status) VALUES($1,$2,$3,$4,'SINGLE_ELIMINATION',$5,$6::jsonb,'ACTIVE') ON CONFLICT ("seasonId") DO NOTHING RETURNING *`,[id,guildId,leagueId,seasonId,bracket.seedCount,JSON.stringify({teams:seeds,reseed:!!policy.reseed})]);
   if(!inserted.rowCount){await client.query('ROLLBACK');return{ok:false,code:'BRACKET_EXISTS'};}
   for(const match of bracket.matches)await client.query(`INSERT INTO "postseason_matches" (id,"bracketId","seasonId",round,slot,"homeTeamId","awayTeamId") VALUES($1,$2,$3,1,$4,$5,$6)`,[`match_${randomUUID()}`,id,seasonId,match.slot,match.homeTeamId,match.awayTeamId]);
   await client.query('UPDATE "seasons" SET state=$2,"updatedAt"=NOW() WHERE id=$1',[seasonId,'POSTSEASON_ACTIVE']);
   await client.query('COMMIT');return{ok:true,bracket:inserted.rows[0]};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }
 async recordResult({guildId,leagueId,seasonId,matchId,winnerTeamId,providerGameId,evidence}){
  if(!providerGameId||!evidence?.source||!evidence?.verifiedAt)return{ok:false,code:'RESULT_EVIDENCE_REQUIRED'};
  const client=await this.pool.connect();try{await client.query('BEGIN');
   const bracket=(await client.query('SELECT * FROM "postseason_brackets" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 FOR UPDATE',[guildId,leagueId,seasonId])).rows[0];
   if(!bracket||bracket.status!=='ACTIVE'){await client.query('ROLLBACK');return{ok:false,code:'BRACKET_NOT_ACTIVE'};}
   const match=(await client.query('SELECT * FROM "postseason_matches" WHERE id=$1 AND "bracketId"=$2 FOR UPDATE',[matchId,bracket.id])).rows[0];
   if(!match){await client.query('ROLLBACK');return{ok:false,code:'MATCH_NOT_FOUND'};}
   if(match.status==='COMPLETE'){await client.query('COMMIT');return match.winnerTeamId===winnerTeamId?{ok:true,idempotent:true,match}:{ok:false,code:'RESULT_CONFLICT'};}
   if(![match.homeTeamId,match.awayTeamId].includes(winnerTeamId)){await client.query('ROLLBACK');return{ok:false,code:'INVALID_WINNER'};}
   const used=(await client.query('SELECT id FROM "postseason_matches" WHERE "bracketId"=$1 AND "providerGameId"=$2 LIMIT 1',[bracket.id,providerGameId])).rows[0];
   if(used){await client.query('ROLLBACK');return{ok:false,code:'PROVIDER_GAME_ALREADY_USED'};}
   await client.query(`UPDATE "postseason_matches" SET "winnerTeamId"=$2,status='COMPLETE',"providerGameId"=$3,"resultEvidence"=$4::jsonb WHERE id=$1`,[matchId,winnerTeamId,providerGameId,JSON.stringify(evidence)]);
   const round=(await client.query('SELECT * FROM "postseason_matches" WHERE "bracketId"=$1 AND round=$2 ORDER BY slot',[bracket.id,match.round])).rows;
   if(round.every(x=>x.status==='COMPLETE'||x.id===matchId)){
    const stored=typeof bracket.seeds==='string'?JSON.parse(bracket.seeds):bracket.seeds;
    const seedList=Array.isArray(stored)?stored:stored.teams;
    const byes=match.round===1?buildSingleElimination(seedList,{seedCount:bracket.seedCount}).byes:[];
    const winners=[...byes,...round.map(x=>x.id===matchId?winnerTeamId:x.winnerTeamId)];
    if(winners.length===1){await client.query(`UPDATE "postseason_brackets" SET status='COMPLETE',"updatedAt"=NOW() WHERE id=$1`,[bracket.id]);await client.query(`UPDATE "seasons" SET state='OFFSEASON',"updatedAt"=NOW() WHERE id=$1`,[seasonId]);}
    else{
     if(stored.reseed){const ranks=new Map(seedList.map(x=>[x.teamId,Number(x.seed)]));winners.sort((a,b)=>ranks.get(a)-ranks.get(b));}
     for(let i=0;i<Math.floor(winners.length/2);i++)await client.query(`INSERT INTO "postseason_matches" (id,"bracketId","seasonId",round,slot,"homeTeamId","awayTeamId") VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT ("bracketId",round,slot) DO NOTHING`,[`match_${randomUUID()}`,bracket.id,seasonId,match.round+1,i+1,winners[i],winners[winners.length-1-i]]);
    }
   }
   await client.query('COMMIT');return{ok:true,match:{...match,winnerTeamId,status:'COMPLETE'}};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }
}
module.exports={PostgresPostseasonRepository};
