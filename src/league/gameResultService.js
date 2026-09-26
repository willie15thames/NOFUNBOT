/*
 * NAVIGATION HEADER
 * FILE: src/league/gameResultService.js
 * LAYER: League control plane (V202)
 * PURPOSE: The ONE owner of game results (audit §10 / BUG-006). Every result path — /report-result, the
 *          game-results component modal, and future provider imports — calls submitGameResult(). It validates,
 *          dedupes by matchupKey + sourceRevision, persists the authoritative record (gameResults.json →
 *          BotKv Postgres write-through), applies standings exactly once (with reverse on supersede/retract),
 *          marks the game session complete, keeps the legacy projections (state.ocrGameResults,
 *          componentRegistry submissions) in sync, and emits one observability event.
 * LOOK HERE FIRST WHEN DEBUGGING: submitGameResult(), retractGameResult(), getResult(), listResults().
 * RELATED FLOW: interactionRouter (/report-result, /retract-score, comp_game_result_modal), leagueSetupService
 *               recordGameResult/reverseGameResult (standings writer), gameSessionService.markFinished.
 * NOTE: AI prose never enters this service. Predictions never mutate results (spec §25).
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
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

function _save(store) {
  if (store.events.length > MAX_EVENTS) store.events.splice(0, store.events.length - MAX_EVENTS);
  saveJsonDebounced(FILE, store, 300);
  return store;
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

function _applyStandings(state, leagueId, league, record, sign) {
  const leagueSetup = require('../services/leagueSetupService');
  const home = _canonicalTeamName(league, record.homeTeam);
  const away = _canonicalTeamName(league, record.awayTeam);
  if (sign > 0) leagueSetup.recordGameResult(leagueId, home, away, record.homeScore, record.awayScore);
  else leagueSetup.reverseGameResult(leagueId, home, away, record.homeScore, record.awayScore);
}

function _syncLegacyOcr(state, record, remove = false) {
  if (!Array.isArray(state?.ocrGameResults)) return;
  const h = normalizeTeam(record.homeTeam), a = normalizeTeam(record.awayTeam), w = Number(record.week);
  const idx = state.ocrGameResults.findIndex(r => {
    const rw = Number(r.week);
    const t1 = normalizeTeam(r.team1), t2 = normalizeTeam(r.team2);
    return rw === w && ((t1 === h && t2 === a) || (t1 === a && t2 === h));
  });
  if (idx !== -1) state.ocrGameResults.splice(idx, 1);
  if (remove) return;
  const winner = record.homeScore > record.awayScore ? record.homeTeam : record.awayScore > record.homeScore ? record.awayTeam : null;
  const loser = winner ? (winner === record.homeTeam ? record.awayTeam : record.homeTeam) : null;
  state.ocrGameResults.push({
    week: record.week,
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
  const identityLeague = input.leagueId || standingsTarget.leagueId || state?.leagueConfig?.leagueName || 'default';
  const key = input.matchupKey || buildMatchupKey({ leagueId: identityLeague, provider, seasonId, week, teamA: homeTeam, teamB: awayTeam });
  if (!key) return { ok: false, code: 'invalid-identity', reason: 'Could not build a matchup identity.' };

  const sourceRevision = input.sourceRevision != null ? String(input.sourceRevision) : null;
  const store = _load();
  const existing = store.results[key] || null;

  // ── Dedupe: same matchup + same revision (or no revision on either side) → no second write, no second standings update ──
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
    provider, seasonId, week,
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

  // ── Standings: reverse the superseded record first, then apply the new one (never double count) ──
  const standings = { updated: false, leagueId: standingsTarget.leagueId, reason: standingsTarget.reason || null };
  if (standingsTarget.leagueId) {
    try {
      if (existing?.standingsApplied && existing.standingsLeagueId) {
        _applyStandings(state, existing.standingsLeagueId, state.leagueConfig?.proAm?.[existing.standingsLeagueId], existing, -1);
      }
      _applyStandings(state, standingsTarget.leagueId, standingsTarget.league, record, +1);
      record.standingsLeagueId = standingsTarget.leagueId;
      record.standingsApplied = true;
      standings.updated = true;
    } catch (e) {
      standings.reason = `standings-failed: ${e.message}`;
      log.error(`standings update failed for ${key}: ${e.message}`);
    }
  }

  store.results[key] = record;
  store.events.push({ type: existing ? 'superseded' : 'recorded', matchupKey: key, at: now, source: record.source, sourceRevision });
  _save(store);

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

  try { require('../services/observabilityService').recordFlowOutcome('game-result', { outcome: 'success', matchupKey: key, superseded: !!existing, standingsUpdated: standings.updated }); } catch {}
  log.info(`recorded ${key} ${homeTeam} ${homeScore}-${awayScore} ${awayTeam} source=${record.source} standings=${standings.updated ? standingsTarget.leagueId : 'n/a'}`);
  return { ok: true, deduped: false, superseded: !!existing, record, standings };
}

/**
 * Retract (remove) a recorded result. Reverses standings if they were applied. Legacy ocr projection is cleared.
 * @returns {{ok:true, removed:number}|{ok:false, reason:string}}
 */
async function retractGameResult({ week, team1, team2 }, ctx = {}) {
  const state = ctx.state || require('../state');
  const w = _int(week);
  const a = normalizeTeam(team1), b = normalizeTeam(team2);
  if (w == null || !a || !b) return { ok: false, reason: 'invalid-input' };
  const store = _load();
  let removed = 0;
  for (const [key, rec] of Object.entries(store.results)) {
    const h = normalizeTeam(rec.homeTeam), aw = normalizeTeam(rec.awayTeam);
    if (Number(rec.week) !== w) continue;
    if (!((h === a && aw === b) || (h === b && aw === a))) continue;
    if (rec.standingsApplied && rec.standingsLeagueId) {
      try { _applyStandings(state, rec.standingsLeagueId, state.leagueConfig?.proAm?.[rec.standingsLeagueId], rec, -1); }
      catch (e) { log.error(`standings reverse failed for ${key}: ${e.message}`); }
    }
    _syncLegacyOcr(state, rec, true);
    delete store.results[key];
    store.events.push({ type: 'retracted', matchupKey: key, at: Date.now() });
    removed++;
  }
  if (removed) _save(store);
  return { ok: true, removed };
}

function getResult(key) { return _load().results[key] || null; }

function listResults(week = null) {
  return Object.values(_load().results).filter(r => week == null || Number(r.week) === Number(week));
}

function getStatusSummary() {
  const all = Object.values(_load().results);
  return { total: all.length, withStandings: all.filter(r => r.standingsApplied).length, lastRecordedAt: all.reduce((m, r) => Math.max(m, r.submittedAt || 0), 0) || null };
}

module.exports = { FILE, submitGameResult, retractGameResult, resolveStandingsLeague, getResult, listResults, getStatusSummary };
