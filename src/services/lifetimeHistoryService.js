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
async function recordResult(guildId, record, state) {
  return store.transact(key(guildId), empty(), data => {
    const old = data.results[record.matchupKey];
    const homeUserId = old ? old.homeUserId : resolveParticipant(state,record,record.homeTeam,record.homeUserId);
    const awayUserId = old ? old.awayUserId : resolveParticipant(state,record,record.awayTeam,record.awayUserId);
    const saved = { ...record, homeUserId, awayUserId, status: 'ACTIVE' };
    const revision = createHash('sha256').update(JSON.stringify([record.homeScore,record.awayScore,record.sourceRevision])).digest('hex');
    if (old?.revision === revision && old.status==='ACTIVE') return old;
    saved.revision=revision;
    for (const uid of [homeUserId,awayUserId]) if(uid) touch(data,uid);
    if (!homeUserId || !awayUserId) data.unresolved[record.matchupKey] = { reason:'Missing historical participant ID', ...saved };
    data.events.push({ type: old ? 'result-corrected' : 'result', key: record.matchupKey, previous: old || null, at:Date.now() });
    data.results[record.matchupKey] = saved;
    return saved;
  });
}
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
module.exports={recordStat,METRICS,archiveCompetition,presence,award,recordResult,retract,revokeAward,career,importLegacy};
