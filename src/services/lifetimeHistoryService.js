'use strict';
// Permanent earned history is independent of Discord membership and operational league state.
const { createHash } = require('crypto');
const store = require('../storage/criticalStore');
const empty = () => ({ version: 1, members: {}, competitions: {}, results: {}, awards: {}, stats: {}, events: [], unresolved: {} });
const key = guildId => { if (!guildId) throw new Error('Guild ID required for lifetime history'); return `v204:lifetime:${guildId}`; };
const norm = x => String(x || '').trim().toLowerCase();
function touch(data, userId) {
  if (!userId) throw new Error('Member ID required');
  return data.members[userId] ||= { userId: String(userId), firstSeenAt: Date.now() };
}
async function archiveCompetition(guildId, league) {
  if (!league?.id) throw new Error('Competition ID required');
  return store.transact(key(guildId), empty(), data => {
    data.competitions[league.id] = { ...data.competitions[league.id], id: league.id, name: league.leagueName || league.name, game: league.game || null, kind: league.kind || 'league', retainedAt: Date.now() };
    return data.competitions[league.id];
  });
}
async function presence(guildId, userId, status) {
  return store.transact(key(guildId), empty(), data => { const m = touch(data,userId); m.presence = status; m.lastSeenAt=Date.now(); return m; });
}
async function award(guildId, grant) {
  if (!grant.userId || !grant.id || !grant.leagueId) throw new Error('Award requires a member, source ID and selected league');
  return store.transact(key(guildId), empty(), data => {
    if (data.awards[grant.id]) return data.awards[grant.id];
    touch(data, grant.userId);
    const saved = { ...grant, status: 'ACTIVE', recordedAt: Date.now() };
    data.awards[grant.id] = saved;
    data.events.push({ type: 'award', id: grant.id, at: saved.recordedAt });
    return saved;
  });
}
function resolveParticipant(state, record, team, supplied) {
  if (supplied) return String(supplied);
  const matches = (state.openTeamRegistry || []).filter(t => String(t.leagueId) === String(record.leagueId) && [t.baseTeam,t.displayTeam].some(x => norm(x)===norm(team)) && t.ownerId);
  return matches.length === 1 ? String(matches[0].ownerId) : null;
}
function recordResultIn(data, record, state) {
    const old = data.results[record.matchupKey];
    if(old&&(old.leagueId!==record.leagueId||[norm(old.homeTeam),norm(old.awayTeam)].sort().join('|')!==[norm(record.homeTeam),norm(record.awayTeam)].sort().join('|')))throw Error('Result source belongs to a different matchup');
    const sameHome=old&&norm(old.homeTeam)===norm(record.homeTeam);
    const homeUserId = old ? (sameHome?old.homeUserId:old.awayUserId) : resolveParticipant(state,record,record.homeTeam,record.homeUserId);
    const awayUserId = old ? (sameHome?old.awayUserId:old.homeUserId) : resolveParticipant(state,record,record.awayTeam,record.awayUserId);
    const saved = { ...record, homeUserId, awayUserId, status: 'ACTIVE' };
    const revision = createHash('sha256').update(JSON.stringify([record.homeTeam,record.awayTeam,record.homeScore,record.awayScore,record.sourceRevision])).digest('hex');
    if (old?.revision === revision && old.status==='ACTIVE') return old;
    saved.revision=revision;
    for (const uid of [homeUserId,awayUserId]) if(uid) touch(data,uid);
    if (!homeUserId || !awayUserId) data.unresolved[record.matchupKey] = { reason:'Missing historical participant ID', ...saved };
    data.events.push({ type: old ? 'result-corrected' : 'result', key: record.matchupKey, previous: old || null, at:Date.now() });
    data.results[record.matchupKey] = saved;
    return saved;
}
async function recordResult(guildId,record,state){return transaction(guildId,data=>recordResultIn(data,record,state));}
async function transaction(guildId,mutate){return store.transact(key(guildId),empty(),mutate);}
async function snapshot(guildId){return store.read(key(guildId),empty());}
async function clearGuild(guildId){return store.clear(key(guildId));}
async function retract(guildId, matchupKey, actor) {
  return store.transact(key(guildId), empty(), data => {
    const item=data.results[matchupKey]; if(!item || item.status==='RETRACTED') return false;
    item.status='RETRACTED'; data.events.push({type:'result-retracted',key:matchupKey,actor:actor||null,at:Date.now()}); return true;
  });
}
async function revokeAward(guildId, id, actor, reason) {
  if (!actor || !reason) throw new Error('Award correction requires actor and reason');
  return store.transact(key(guildId),empty(),data=>{ const item=data.awards[id]; if(!item)throw new Error('Award not found'); item.status='REVOKED'; data.events.push({type:'award-revoked',id,actor,reason,at:Date.now()}); return item; });
}
const METRICS = new Set(['passing_yards','rushing_yards','receiving_yards','touchdowns','interceptions','sacks','points','rebounds','assists','stream_credits']);
async function recordStat(guildId, entry) {
  if (!entry.id || !entry.userId || !entry.leagueId || !entry.game || !entry.seasonId || !METRICS.has(entry.metric) || !Number.isFinite(entry.value) || entry.value < 0) throw new Error('Stat needs a source ID, member, league, game, season, supported metric and nonnegative number');
  return store.transact(key(guildId),empty(),data=>{
    data.stats ||= {}; touch(data,entry.userId);
    const old=data.stats[entry.id];
    if(old && JSON.stringify(old)===JSON.stringify(entry))return old;
    if(old && (old.userId!==entry.userId || old.leagueId!==entry.leagueId || old.metric!==entry.metric))throw new Error('Source ID belongs to another stat');
    data.events.push({type:old?'stat-corrected':'stat',id:entry.id,previous:old||null,at:Date.now()});
    data.stats[entry.id]={...entry};return entry;
  });
}

// Stream source identity, cooldown and award are one existing lifetime transaction.
async function adjustStreamProgress(guildId,player,delta,operationId){
 if(!player.leagueId||!player.userId)throw Error('Select a claimed team in its league before adjusting stream progress');
 return transaction(guildId,data=>{
  data.streamAccounts ||= {};data.streamAdjustments ||= {};
  if(operationId&&data.streamAdjustments[operationId])return data.streamAdjustments[operationId];
  const key=`${player.leagueId}:${player.userId}`;
  const account=data.streamAccounts[key] ||= {count:Number(player.streamCount||0),lastCreditAt:player.lastStreamCreditAt||player.streamLog?.at(-1)?.timestamp||0};
  account.count=delta===null?0:Math.max(0,account.count+delta);
  const result={...account};
  if(operationId)data.streamAdjustments[operationId]=result;
  data.events.push({type:'stream-progress-adjusted',operationId:operationId||null,leagueId:player.leagueId,userId:player.userId,delta,at:Date.now()});
  return result;
 });
}
async function creditStream(guildId,input,seed={}){
 if(!input.messageId||!input.userId||!input.leagueId||!input.game||!input.seasonId||!Number.isFinite(input.cooldown)||input.cooldown<0||!Array.isArray(input.rewards))throw Error('Stream credit needs a source, member, league, game, season and valid cooldown/rewards');
 return transaction(guildId,data=>{
  const id=`stream:${input.messageId}`;data.streamAccounts ||= {};data.stats ||= {};
  if(data.stats[id])return{ok:false,reason:'duplicate'};
  const accountKey=`${input.leagueId}:${input.userId}`;
  const account=data.streamAccounts[accountKey] ||= {count:Number(seed.count||0)%16,lastCreditAt:Number(seed.lastCreditAt||0)};
  const now=Date.now();
  if(now-account.lastCreditAt<input.cooldown)return{ok:false,reason:'cooldown',remainingMs:input.cooldown-(now-account.lastCreditAt)};
  touch(data,input.userId);const count=account.count+1;
  data.stats[id]={id,userId:input.userId,leagueId:input.leagueId,metric:'stream_credits',value:1,game:input.game,seasonId:input.seasonId};
  data.events.push({type:'stat',id,at:now});
  const reward=input.rewards.find(r=>r.count===count)||null;
  if(reward){const awardId=`stream-award:${input.messageId}`;data.awards[awardId]={id:awardId,userId:input.userId,leagueId:input.leagueId,title:reward.label,status:'ACTIVE',recordedAt:now};data.events.push({type:'award',id:awardId,at:now});}
  account.count=count>=16?0:count;account.lastCreditAt=now;
  return{ok:true,count,nextCount:account.count,lastCreditAt:now,reward};
 });
}

async function career(guildId,userId) {
  const data=await store.read(key(guildId),empty());
  const games=Object.values(data.results).filter(r=>r.status==='ACTIVE' && [r.homeUserId,r.awayUserId].includes(String(userId)));
  let wins=0,losses=0,ties=0;
  const seasons=new Set();
  for(const r of games){const mine=r.homeUserId===String(userId)?r.homeScore:r.awayScore;const theirs=r.homeUserId===String(userId)?r.awayScore:r.homeScore; if(mine>theirs)wins++;else if(mine<theirs)losses++;else ties++;seasons.add(`${r.leagueId}:${r.seasonId}`);}
  const awards=Object.values(data.awards).filter(a=>String(a.userId)===String(userId)&&a.status==='ACTIVE');
  const stats=Object.values(data.stats||{}).filter(x=>String(x.userId)===String(userId));
  const metrics={};for(const stat of stats){const key=`${stat.game}:${stat.metric}`;metrics[key]=(metrics[key]||0)+stat.value;}
  return { metrics, stats, userId, member:data.members[userId]||null, gamesPlayed:games.length,wins,losses,ties,winPercentage:games.length?Math.round(1000*(wins+ties/2)/games.length)/10:null,seasons:seasons.size,awards,games };
}
async function importLegacy(guildId,state) {
  return store.transact(key(guildId),empty(),data=>{
    let imported=0,unresolved=0;
    for(const type of ['potwHistory','yearlyAwardHistory','superbowlHistory','streamMilestones']) for(const [i,a] of (state[type]||[]).entries()){
      if (a.sourceId && data.awards[a.sourceId]) continue;
      const id=`legacy:${type}:${i}:${createHash('sha256').update(JSON.stringify(a)).digest('hex')}`;
      if(data.awards[id]||data.unresolved[id])continue;
      if(!a.userId){data.unresolved[id]={type,source:a,reason:'Member attribution required'};unresolved++;continue;}
      touch(data,a.userId);data.awards[id]={...a,id,userId:String(a.userId),leagueId:a.leagueId||'legacy-unattributed',title:a.awardLabel||type,status:'ACTIVE',legacy:true};imported++;
    }
    return {imported,unresolved};
  });
}
module.exports={clearGuild,adjustStreamProgress,creditStream,transaction,snapshot,recordResultIn,recordStat,METRICS,archiveCompetition,presence,award,recordResult,retract,revokeAward,career,importLegacy};
