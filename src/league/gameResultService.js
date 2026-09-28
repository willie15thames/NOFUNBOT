/*
 * NAVIGATION HEADER
 * FILE: src/league/gameResultService.js
 * LAYER: League control plane (V202)
 * PURPOSE: The ONE owner of game results (audit §10 / BUG-006). Every result path — /report-result, the
 *          game-results component modal, and future provider imports — calls submitGameResult(). It validates,
 *          dedupes by matchupKey + sourceRevision, commits authoritative results and standings in the lifetime BotKv transaction, applies standings exactly once (with reverse on supersede/retract),
 *          marks the game session complete, keeps the legacy projections (state.ocrGameResults,
 *          componentRegistry submissions) in sync, and emits one observability event.
 * LOOK HERE FIRST WHEN DEBUGGING: submitGameResult(), retractGameResult(), getResult(), listResults().
 * RELATED FLOW: interactionRouter (/report-result, /retract-score, comp_game_result_modal), leagueSetupService
 *               recordGameResult/reverseGameResult (standings writer), gameSessionService.markFinished.
 * NOTE: AI prose never enters this service. Predictions never mutate results (spec §25).
 */

'use strict';

const { loadJson, saveJson } = require('../storage/jsonStore');
const { matchupKey: buildMatchupKey, normalizeTeam } = require('./canonicalModel');
const gameSessions = require('./gameSessionService');
const { makeLogger } = require('../utils/logger');

const log = makeLogger('gameResult');
const FILE = 'gameResults.json';
const MAX_EVENTS = 500;

function _load() {
  const raw = loadJson(FILE, { schema: 'nofunleague-game-results', version: 1, results: {}, events: [] }) || {};
  return {
    schema: 'nofunleague-game-results',
    version: 1,
    results: raw.results && typeof raw.results === 'object' ? raw.results : {},
    events: Array.isArray(raw.events) ? raw.events : [],
  };
}

function _int(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * Resolve which standings ledger (leagueSetupService standings_<leagueId>.json) this result belongs to.
 * Explicit leagueId wins; otherwise a pro-am league whose team list contains BOTH teams; otherwise null.
 * A null league means "no standings ledger exists for this matchup" — the result is still recorded.
 */
function resolveStandingsLeague(state, homeTeam, awayTeam, explicitLeagueId = null) {
  const proAm = state?.leagueConfig?.proAm || {};
  if (explicitLeagueId && proAm[explicitLeagueId]) return { leagueId: explicitLeagueId, league: proAm[explicitLeagueId] };
  const h = normalizeTeam(homeTeam), a = normalizeTeam(awayTeam);
  const matches = Object.entries(proAm).filter(([, lg]) => {
    const teams = (lg?.teams || []).map(normalizeTeam);
    return teams.includes(h) && teams.includes(a);
  });
  if (matches.length === 1) return { leagueId: matches[0][0], league: matches[0][1] };
  return { leagueId: null, league: null, reason: matches.length ? 'ambiguous-league' : 'no-standings-league' };
}

function _canonicalTeamName(league, teamName) {
  if (!league?.teams) return teamName;
  const n = normalizeTeam(teamName);
  return league.teams.find(t => normalizeTeam(t) === n) || teamName;
}

function _applyStandings(ledger, state, leagueId, league, record, sign) {
  const home=_canonicalTeamName(league,record.homeTeam),away=_canonicalTeamName(league,record.awayTeam);
  const records=ledger.standings[leagueId] ||= JSON.parse(JSON.stringify(loadJson(`standings_${leagueId}.json`,{})||{}));
  records[home] ||= {w:0,l:0,pf:0,pa:0}; records[away] ||= {w:0,l:0,pf:0,pa:0};
  for(const [team,field,n]of [[home,'pf',record.homeScore],[home,'pa',record.awayScore],[away,'pf',record.awayScore],[away,'pa',record.homeScore]])records[team][field]=Math.max(0,Number(records[team][field]||0)+sign*n);
  if(record.homeScore!==record.awayScore){const winner=record.homeScore>record.awayScore?home:away,loser=winner===home?away:home;records[winner].w=Math.max(0,(records[winner].w||0)+sign);records[loser].l=Math.max(0,(records[loser].l||0)+sign);}
}
const scopeKey=()=>require('./spaceContext').current()||'__root__';
function resultLedger(data){
  data.resultLedgers ||= {};
  const scope=scopeKey();
  return data.resultLedgers[scope] ||= {...JSON.parse(JSON.stringify(_load())),standings:{}};
}
function projectLedger(ledger,state){
  saveJson(FILE,{schema:'nofunleague-game-results',version:2,results:ledger.results,events:ledger.events});
  for(const [id,records]of Object.entries(ledger.standings))saveJson(`standings_${id}.json`,records);
  if(state){state.ocrGameResults.length=0;for(const record of Object.values(ledger.results))_syncLegacyOcr(state,record);}
}
async function recoverProjections(guildId,state){
  const data=await require('../services/lifetimeHistoryService').snapshot(guildId);
  for(const [scope,ledger]of Object.entries(data.resultLedgers||{})){
    if(scope!=='__root__'&&!require('../services/activeLeagueService').getLeague(scope))continue;
    await require('./spaceContext').run(scope==='__root__'?null:scope,()=>projectLedger(ledger,state));
  }
}

function _syncLegacyOcr(state, record, remove = false) {
  if (!Array.isArray(state?.ocrGameResults)) return;
  const h = normalizeTeam(record.homeTeam), a = normalizeTeam(record.awayTeam), w = Number(record.week);
  const idx = state.ocrGameResults.findIndex(r => {
    const rw = Number(r.week);
    const t1 = normalizeTeam(r.team1), t2 = normalizeTeam(r.team2);
    return String(r.leagueId || record.leagueId) === String(record.leagueId) && rw === w && ((t1 === h && t2 === a) || (t1 === a && t2 === h));
  });
  if (idx !== -1) state.ocrGameResults.splice(idx, 1);
  if (remove) return;
  const winner = record.homeScore > record.awayScore ? record.homeTeam : record.awayScore > record.homeScore ? record.awayTeam : null;
  const loser = winner ? (winner === record.homeTeam ? record.awayTeam : record.homeTeam) : null;
  state.ocrGameResults.push({
    week: record.week, leagueId: record.leagueId,
    team1: record.homeTeam, team2: record.awayTeam,
    score1: record.homeScore, score2: record.awayScore,
    winner, loser,
    winnerScore: winner ? Math.max(record.homeScore, record.awayScore) : null,
    loserScore: winner ? Math.min(record.homeScore, record.awayScore) : null,
    reportedAt: record.submittedAt, reporterId: record.submittedBy, matchupKey: record.matchupKey, source: record.source,
  });
}

/**
 * Submit a game result. Idempotent per matchupKey + sourceRevision.
 *
 * @param {object} input
 * @param {string} input.homeTeam
 * @param {string} input.awayTeam
 * @param {number} input.homeScore
 * @param {number} input.awayScore
 * @param {number} input.week
 * @param {string} [input.leagueId]        explicit standings league id (pro-am). Optional.
 * @param {string} [input.provider]        identity provider segment (default 'local')
 * @param {string} [input.seasonId]        default 'current'
 * @param {string} [input.source]          'slash-command' | 'component-modal' | provider key
 * @param {string} [input.sourceRevision]  provider/import revision; a new revision supersedes the stored one
 * @param {string} [input.submittedBy]     user id (used in payloads only; never rendered by this service)
 * @param {string} [input.channelId]       game channel id → session completion
 * @param {object} ctx                     { state, guild? }
 * @returns {{ok:true, deduped:boolean, superseded:boolean, record:object, standings:{updated:boolean, leagueId:string|null, reason?:string}}|{ok:false, reason:string, code:string}}
 */
async function submitGameResult(input = {}, ctx = {}) {
  const state = ctx.state || require('../state');
  const homeTeam = String(input.homeTeam || '').trim();
  const awayTeam = String(input.awayTeam || '').trim();
  const homeScore = _int(input.homeScore);
  const awayScore = _int(input.awayScore);
  const week = _int(input.week);

  if (!homeTeam || !awayTeam) return { ok: false, code: 'invalid-teams', reason: 'Both team names are required.' };
  if (normalizeTeam(homeTeam) === normalizeTeam(awayTeam)) return { ok: false, code: 'same-team', reason: 'A team cannot play itself.' };
  if (homeScore == null || awayScore == null || homeScore < 0 || awayScore < 0) return { ok: false, code: 'invalid-scores', reason: 'Scores must be whole numbers ≥ 0.' };
  if (week == null || week < 0) return { ok: false, code: 'invalid-week', reason: 'Week must be a whole number.' };

  const provider = String(input.provider || 'local').toLowerCase();
  const seasonId = String(input.seasonId || 'current');
  const standingsTarget = resolveStandingsLeague(state, homeTeam, awayTeam, input.leagueId || null);
  const identityLeague = input.leagueId || require('./spaceContext').current() || standingsTarget.leagueId || state?.leagueConfig?.leagueName || 'default';
  const key = input.matchupKey || buildMatchupKey({ leagueId: identityLeague, provider, seasonId, week, teamA: homeTeam, teamB: awayTeam });
  if (!key) return { ok: false, code: 'invalid-identity', reason: 'Could not build a matchup identity.' };

  const sourceRevision = input.sourceRevision != null ? String(input.sourceRevision) : null;
  const history=require('../services/lifetimeHistoryService');
  const historyGuildId=ctx.guild?.id||process.env.GUILD_ID;
  const committed=await history.transaction(historyGuildId,data=>{
  const store = resultLedger(data);
  const existing = store.results[key] || null;

  // ── Dedupe: same matchup + same revision (or no revision on either side) → no second write, no second standings update ──
  if(existing&&String(existing.leagueId)!==String(identityLeague))throw Error('Result key belongs to another league');
  if (existing) {
    const sameRevision = (existing.sourceRevision || null) === sourceRevision;
    const sameScore = existing.homeScore === homeScore && existing.awayScore === awayScore
      && normalizeTeam(existing.homeTeam) === normalizeTeam(homeTeam);
    if (sameRevision && (sourceRevision != null || sameScore)) {
      log.info(`dedupe ${key} (revision=${sourceRevision ?? 'none'})`);
      return { ok: true, deduped: true, superseded: false, record: existing, standings: { updated: false, leagueId: existing.standingsLeagueId || null, reason: 'deduped' } };
    }
  }

  const now = Date.now();
  const record = {
    matchupKey: key,
    leagueId: identityLeague,
    provider, seasonId, week, game:state.leagueConfig?.game || 'unknown',
    homeTeam, awayTeam, homeScore, awayScore,
    winner: homeScore > awayScore ? homeTeam : awayScore > homeScore ? awayTeam : null,
    source: String(input.source || 'unknown'),
    sourceRevision,
    submittedBy: input.submittedBy ? String(input.submittedBy) : null,
    channelId: input.channelId ? String(input.channelId) : null,
    submittedAt: now,
    supersedes: existing ? { submittedAt: existing.submittedAt, sourceRevision: existing.sourceRevision, homeScore: existing.homeScore, awayScore: existing.awayScore } : null,
    standingsLeagueId: null,
    standingsApplied: false,
  };

  const lifetime=history.recordResultIn(data,record,state);
  record.homeUserId=lifetime.homeUserId;record.awayUserId=lifetime.awayUserId;
  const standings={updated:false,leagueId:standingsTarget.leagueId,reason:standingsTarget.reason||null};
  if(existing?.standingsApplied&&existing.standingsLeagueId)_applyStandings(store,state,existing.standingsLeagueId,state.leagueConfig?.proAm?.[existing.standingsLeagueId],existing,-1);
  if(standingsTarget.leagueId){
    _applyStandings(store,state,standingsTarget.leagueId,standingsTarget.league,record,1);
    record.standingsLeagueId=standingsTarget.leagueId;record.standingsApplied=true;standings.updated=true;
  }
  Object.assign(data.results[key],record);
  store.results[key]=record;
  store.events.push({type:existing?'superseded':'recorded',matchupKey:key,at:now});
  if(store.events.length>MAX_EVENTS)store.events.splice(0,store.events.length-MAX_EVENTS);
  return {ok:true,deduped:false,superseded:!!existing,record,standings};
  });
  // Read the committed authority; projections never increment counters themselves.
  const ledger=(await history.snapshot(historyGuildId)).resultLedgers[scopeKey()];
  projectLedger(ledger,state);
  if(committed.deduped)return committed;
  const {record,standings}=committed;

  // ── Session completion + legacy projections ──
  if (record.channelId) {
    gameSessions.markFinished(record.channelId, { resultKey: key });
    const live = state?.games?.get?.(record.channelId);
    if (live) live.finished = true;
  }
  _syncLegacyOcr(state, record);
  if (record.source === 'component-modal') {
    try {
      require('../services/componentRegistryService').recordGameResult(record.submittedBy, { week, yourTeam: homeTeam, yourScore: homeScore, oppTeam: awayTeam, oppScore: awayScore, matchupKey: key });
    } catch (e) { log.warn(`component projection failed: ${e.message}`); }
  }

  // ── Optional Discord projection of standings (best-effort, after durable commit) ──
  if (ctx.guild && standings.updated && standingsTarget.league) {
    try {
      const leagueSetup = require('../services/leagueSetupService');
      const def = leagueSetup.LEAGUE_TYPES?.[standingsTarget.league.typeId] || {};
      await leagueSetup.refreshStandings(ctx.guild, standingsTarget.leagueId, standingsTarget.league.teams || [], `${state.leagueConfig?.leagueName || 'League'} — ${def.label || 'Standings'}`, def.color || 0x5865f2, state).catch(() => null);
    } catch (e) { log.warn(`standings refresh failed: ${e.message}`); }
  }

  try { require('../services/observabilityService').recordFlowOutcome('game-result', { outcome: 'success', matchupKey: key, superseded: committed.superseded, standingsUpdated: standings.updated }); } catch {}
  log.info(`recorded ${key} ${homeTeam} ${homeScore}-${awayScore} ${awayTeam} source=${record.source} standings=${standings.updated ? standingsTarget.leagueId : 'n/a'}`);
  return committed;
}

/**
 * Retract (remove) a recorded result. Reverses standings if they were applied. Legacy ocr projection is cleared.
 * @returns {{ok:true, removed:number}|{ok:false, reason:string}}
 */
async function retractGameResult({ week, team1, team2, leagueId = null }, ctx = {}) {
  const state = ctx.state || require('../state');
  leagueId = leagueId || require('./spaceContext').current();
  if (!leagueId && require('../services/activeLeagueService').listOperationalLeagues().length > 1) return {ok:false,reason:'Select the league for score retraction'};
  const w = _int(week);
  const a = normalizeTeam(team1), b = normalizeTeam(team2);
  if (w == null || !a || !b) return { ok: false, reason: 'invalid-input' };
  const history=require('../services/lifetimeHistoryService'),guildId=ctx.guild?.id||process.env.GUILD_ID;
  const removed=await history.transaction(guildId,data=>{
    const ledger=resultLedger(data);let count=0;
    for(const [key,rec]of Object.entries(ledger.results)){
      if(leagueId&&String(rec.leagueId)!==String(leagueId)||Number(rec.week)!==w)continue;
      const h=normalizeTeam(rec.homeTeam),aw=normalizeTeam(rec.awayTeam);
      if(!((h===a&&aw===b)||(h===b&&aw===a)))continue;
      if(rec.standingsApplied&&rec.standingsLeagueId)_applyStandings(ledger,state,rec.standingsLeagueId,state.leagueConfig?.proAm?.[rec.standingsLeagueId],rec,-1);
      if(data.results[key])data.results[key].status='RETRACTED';
      data.events.push({type:'result-retracted',key,actor:ctx.actor||null,at:Date.now()});
      delete ledger.results[key];ledger.events.push({type:'retracted',matchupKey:key,at:Date.now()});count++;
    }
    return count;
  });
  projectLedger((await history.snapshot(guildId)).resultLedgers[scopeKey()],state);
  return{ok:true,removed};
}

function getResult(key) { return _load().results[key] || null; }

function listResults(week = null) {
  return Object.values(_load().results).filter(r => (!require('./spaceContext').current() || r.leagueId === require('./spaceContext').current()) && (week == null || Number(r.week) === Number(week)));
}

function getStatusSummary() {
  const all = Object.values(_load().results);
  return { total: all.length, withStandings: all.filter(r => r.standingsApplied).length, lastRecordedAt: all.reduce((m, r) => Math.max(m, r.submittedAt || 0), 0) || null };
}

module.exports = { recoverProjections, FILE, submitGameResult, retractGameResult, resolveStandingsLeague, getResult, listResults, getStatusSummary };
