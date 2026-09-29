'use strict';
const SUPPORTED=new Set(['companion_export','neonsportz','custom_endpoint']);
function gameList(payload){const p=typeof payload==='string'?JSON.parse(payload):payload;const r=p?.data||p;for(const k of ['gameScheduleInfoList','schedule','games','matchups'])if(Array.isArray(r?.[k]))return r[k];return Array.isArray(r)?r:[];}
function gameIdOf(g){return g?.scheduleId??g?.gameId??g?.id??g?.matchId;}
function teamId(g,side){return side==='home'?(g?.homeTeamId??g?.home?.id??g?.home_team_id):(g?.awayTeamId??g?.away?.id??g?.away_team_id);}
function score(g,side){return Number(side==='home'?(g?.homeScore??g?.home?.score):(g?.awayScore??g?.away?.score));}
function isFinal(g){const s=String(g?.status??g?.gameStatus??g?.state??'').toLowerCase();return ['final','completed','complete','finished'].includes(s)||g?.isFinal===true;}
async function readGameResult(pool,{guildId,leagueId,homeTeamId,awayTeamId,providerGameId}){
 const maps=(await pool.query(`SELECT m."teamId",m."externalTeamId",m."providerKey" FROM "provider_team_mappings" m JOIN "provider_connections" c ON c."leagueId"=m."leagueId" AND c."providerKey"=m."providerKey" WHERE m."guildId"=$1 AND m."leagueId"=$2 AND m."teamId"=ANY($3::text[]) AND c.status IN ('active','ready')`,[guildId,leagueId,[homeTeamId,awayTeamId]])).rows.filter(x=>SUPPORTED.has(x.providerKey));
 const groups=new Map();for(const m of maps){const a=groups.get(m.providerKey)||[];a.push(m);groups.set(m.providerKey,a);}
 const eligible=[...groups.entries()].filter(([,a])=>a.length===2&&new Set(a.map(x=>x.teamId)).size===2);
 if(eligible.length!==1)return{ok:false,code:eligible.length?'PROVIDER_RESULT_MAPPING_AMBIGUOUS':'TEAM_MAPPING_REQUIRED'};
 const [provider,providerMaps]=eligible[0];
 const receipts=(await pool.query(`SELECT id,"artifactBody","receivedAt" FROM "provider_import_receipts" WHERE "leagueId"=$1 AND "providerKey"=$2 AND stage='schedule' AND status='applied' AND "artifactBody" IS NOT NULL ORDER BY "receivedAt" DESC LIMIT 100`,[leagueId,provider])).rows;
 const byTeam=new Map(providerMaps.map(x=>[String(x.externalTeamId),x.teamId]));
 for(const receipt of receipts){
  let games;try{games=gameList(receipt.artifactBody);}catch{continue;}
  const matches=games.filter(g=>String(gameIdOf(g))===String(providerGameId));
  if(matches.length!==1)continue;
  const game=matches[0],home=byTeam.get(String(teamId(game,'home'))),away=byTeam.get(String(teamId(game,'away')));
  if(!home||!away||new Set([home,away]).size!==2)return{ok:false,code:'PROVIDER_GAME_TEAM_MISMATCH'};
  const h=score(game,'home'),a=score(game,'away');
  if(!isFinal(game)||!Number.isInteger(h)||!Number.isInteger(a)||h<0||a<0||h===a)return{ok:false,code:'PROVIDER_RESULT_NOT_FINAL'};
  return{ok:true,winnerTeamId:h>a?home:away,evidence:{source:provider,snapshotId:receipt.id,verifiedAt:new Date(receipt.receivedAt).toISOString(),homeScore:h,awayScore:a}};
 }
 return{ok:false,code:'PROVIDER_GAME_NOT_FOUND'};
}
module.exports={readGameResult,gameList,SUPPORTED};
