'use strict';
const {resolveAttribute}=require('./attributeCatalog');
const SUPPORTED=new Set(['companion_export','neonsportz','custom_endpoint']);
function rows(body){
 const parsed=typeof body==='string'?JSON.parse(body):body;
 const root=parsed?.data||parsed;
 if(Array.isArray(root))return root;
 for(const key of ['rosterInfoList','roster','players','playerInfoList','playerRoster','athletes'])if(Array.isArray(root?.[key]))return root[key];
 return [];
}
function playerIdOf(p){return p?.rosterId??p?.playerId??p?.id??p?.player_id??p?.eaId;}
function teamIdOf(p){return p?.teamId??p?.teamIndex??p?.team_id??p?.clubId;}
function normalizeDevTrait(raw){
 if(raw==null)return null;
 if(Number.isInteger(Number(raw))&&String(raw).trim()!=='')return ({0:'normal',1:'star',2:'superstar',3:'xfactor'})[Number(raw)]||String(raw).toLowerCase();
 const s=String(raw).trim().toUpperCase().replace(/[\s_-]+/g,'');
 const map={NORMAL:'normal',STAR:'star',SUPERSTAR:'superstar',XFACTOR:'xfactor',XF:'xfactor'};
 return map[s]||String(raw).trim().toLowerCase();
}
function specialValue(p,rewardType){
 if(rewardType==='DEV_TRAIT')return normalizeDevTrait(p.devTrait??p.devTraitName??p.developmentTrait??p.development_trait??p.traitDevelopment);
 const n=Number(p.age??p.playerAge??p.player_age);
 return Number.isInteger(n)&&n>=0&&n<=99?n:null;
}
async function resolveMapping(pool,{guildId,leagueId,teamId}){
 const maps=(await pool.query(`SELECT m."providerKey",m."externalTeamId" FROM "provider_team_mappings" m JOIN "provider_connections" c ON c."leagueId"=m."leagueId" AND c."providerKey"=m."providerKey" WHERE m."guildId"=$1 AND m."leagueId"=$2 AND m."teamId"=$3 AND c.status IN ('active','ready')`,[guildId,leagueId,teamId])).rows.filter(x=>SUPPORTED.has(x.providerKey));
 if(maps.length!==1)return{ok:false,code:maps.length?'PROVIDER_MAPPING_AMBIGUOUS':'PROVIDER_TEAM_MAPPING_REQUIRED'};
 return{ok:true,map:maps[0]};
}
async function latestRoster(pool,{leagueId,providerKey,afterReceivedAt=null}){
 return (await pool.query(`SELECT id,"providerKey","artifactBody","receivedAt" FROM "provider_import_receipts" WHERE "leagueId"=$1 AND "providerKey"=$2 AND stage='roster' AND status='applied' AND "artifactBody" IS NOT NULL AND ($3::timestamp IS NULL OR "receivedAt">$3) ORDER BY "receivedAt" DESC LIMIT 1`,[leagueId,providerKey,afterReceivedAt])).rows[0]||null;
}
async function readSpecial(pool,{guildId,leagueId,teamId,playerId,rewardType,afterReceivedAt=null}){
 if(!['DEV_TRAIT','AGE_RESET'].includes(rewardType))return{ok:false,code:'UNSUPPORTED_REWARD_TYPE'};
 const mapped=await resolveMapping(pool,{guildId,leagueId,teamId});if(!mapped.ok)return mapped;
 const receipt=await latestRoster(pool,{leagueId,providerKey:mapped.map.providerKey,afterReceivedAt});
 if(!receipt)return{ok:false,code:'VERIFIED_ROSTER_REQUIRED'};
 let list;try{list=rows(receipt.artifactBody);}catch{return{ok:false,code:'INVALID_ROSTER_SNAPSHOT'};}
 const matches=list.filter(p=>String(playerIdOf(p))===String(playerId)&&String(teamIdOf(p))===String(mapped.map.externalTeamId));
 if(matches.length!==1)return{ok:false,code:'PLAYER_NOT_ON_MAPPED_TEAM'};
 const value=specialValue(matches[0],rewardType);
 if(value==null||value==='')return{ok:false,code:'SPECIAL_VALUE_NOT_IMPORTED'};
 return{ok:true,value,provenance:{provider:mapped.map.providerKey,snapshotId:receipt.id,verifiedAt:new Date(receipt.receivedAt).toISOString()}};
}
async function readPlayer(pool,{guildId,leagueId,teamId,playerId,attributeKey,afterReceivedAt=null}){
 const mapped=await resolveMapping(pool,{guildId,leagueId,teamId});if(!mapped.ok)return mapped;
 const m=mapped.map;
 const receipt=await latestRoster(pool,{leagueId,providerKey:m.providerKey,afterReceivedAt});
 if(!receipt)return{ok:false,code:'VERIFIED_ROSTER_REQUIRED'};
 let list;try{list=rows(receipt.artifactBody);}catch{return{ok:false,code:'INVALID_ROSTER_SNAPSHOT'};}
 const matches=list.filter(p=>String(playerIdOf(p))===String(playerId)&&String(teamIdOf(p))===String(m.externalTeamId));
 if(matches.length!==1)return{ok:false,code:'PLAYER_NOT_ON_MAPPED_TEAM'};
 const p=matches[0],position=String(p.position||p.positionName||p.pos||'').toUpperCase();
 const entry=resolveAttribute(attributeKey,{gameId:'madden',gameVersion:'26',position});
 if(!entry||entry.key!==attributeKey)return{ok:false,code:'ATTRIBUTE_NOT_EDITABLE'};
 const raw=p[entry.providerField]??p[attributeKey]??p[String(entry.providerField||'').replace(/[A-Z]/g,m=>`_${m.toLowerCase()}`)];
 const rating=Number(raw);
 if(!Number.isInteger(rating)||rating<entry.minValue||rating>entry.maxValue)return{ok:false,code:'ATTRIBUTE_RATING_NOT_IMPORTED'};
 return{ok:true,teamId,playerId,attributeKey,attributeGroup:entry.group,position,rating,gameId:'madden',gameVersion:'26',provenance:{provider:m.providerKey,snapshotId:receipt.id,verifiedAt:new Date(receipt.receivedAt).toISOString()}};
}
module.exports={readPlayer,readSpecial,rows,normalizeDevTrait,playerIdOf,teamIdOf,SUPPORTED};
