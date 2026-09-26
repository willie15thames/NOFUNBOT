/*
 * NAVIGATION HEADER
 * FILE: src/league/canonicalModel.js
 * LAYER: League control plane (V202)
 * PURPOSE: One canonical shape for games and one stable matchup identity. Provider-specific field aliases are
 *          parsed here ONCE (spec §16); downstream code consumes CanonicalGame, never raw provider fields.
 * LOOK HERE FIRST WHEN DEBUGGING: matchupKey(), toCanonicalGame(), GAME_STATUS.
 * RELATED FLOW: gameSessionService (channel identity), gameResultService (result dedupe), advanceEngine (projection),
 *               scheduleRegistryService.normalizeGame (legacy alias parsing kept at the edge).
 * NOTE: Pure functions. No I/O. matchupKey is order-independent so A vs B === B vs A.
 */

'use strict';

const GAME_STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  FINAL: 'final',
  CANCELLED: 'cancelled',
  UNKNOWN: 'unknown',
});

/** Lowercase alphanumeric team identity. "Kansas City Chiefs" → "kansascitychiefs". */
function normalizeTeam(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeLeagueId(leagueId) {
  return String(leagueId || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60) || 'default';
}

/**
 * Stable matchup identity: leagueId + provider + seasonId + week + sorted normalized teams.
 * Order-independent so the same game reported from either side resolves to one key.
 */
function matchupKey({ leagueId, provider, seasonId, week, teamA, teamB }) {
  const a = normalizeTeam(teamA);
  const b = normalizeTeam(teamB);
  if (!a || !b) return null;
  const [t1, t2] = a < b ? [a, b] : [b, a];
  const w = Number(week);
  if (!Number.isFinite(w) || w < 0) return null;
  return [
    normalizeLeagueId(leagueId),
    String(provider || 'local').toLowerCase(),
    String(seasonId || 'current').toLowerCase(),
    `w${w}`,
    t1,
    t2,
  ].join('|');
}

function _numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function _status(raw, homeScore, awayScore) {
  const s = String(raw || '').toLowerCase().trim();
  if (['final', 'complete', 'completed', 'played', 'done'].includes(s)) return GAME_STATUS.FINAL;
  if (['in_progress', 'inprogress', 'live', 'playing', 'started'].includes(s)) return GAME_STATUS.IN_PROGRESS;
  if (['cancelled', 'canceled', 'void'].includes(s)) return GAME_STATUS.CANCELLED;
  if (['scheduled', 'pending', 'upcoming', 'unplayed'].includes(s)) return GAME_STATUS.SCHEDULED;
  if (homeScore != null && awayScore != null) return GAME_STATUS.FINAL;
  if (!s) return GAME_STATUS.SCHEDULED;
  return GAME_STATUS.UNKNOWN;
}

/**
 * Build a CanonicalGame from any of the schedule shapes the bot has accepted historically
 * (team1/team2, homeTeam/awayTeam, home/away, teamA/teamB, ...).
 * Returns null when the game cannot be identified (missing team or week).
 */
function toCanonicalGame(raw, ctx = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const homeName = raw.homeTeamName || raw.team1 || raw.homeTeam || raw.home || raw.teamA || raw.team || null;
  const awayName = raw.awayTeamName || raw.team2 || raw.awayTeam || raw.away || raw.teamB || raw.opponent || null;
  const week = Number(raw.week ?? raw.Week ?? ctx.week ?? NaN);
  if (!homeName || !awayName || !Number.isFinite(week)) return null;
  const leagueId = normalizeLeagueId(raw.leagueId || ctx.leagueId);
  const provider = String(raw.provider || raw.source || ctx.provider || 'local').toLowerCase();
  const seasonId = String(raw.seasonId || raw.season || ctx.seasonId || 'current');
  const homeScore = _numOrNull(raw.homeScore ?? raw.score1 ?? raw.winnerScore);
  const awayScore = _numOrNull(raw.awayScore ?? raw.score2 ?? raw.loserScore);
  const key = matchupKey({ leagueId, provider, seasonId, week, teamA: homeName, teamB: awayName });
  if (!key) return null;
  return {
    id: raw.id || key,
    matchupKey: key,
    sourceGameId: raw.sourceGameId != null ? String(raw.sourceGameId) : null,
    leagueId,
    seasonId,
    week,
    homeTeamId: normalizeTeam(raw.homeTeamId || raw.base1 || homeName),
    awayTeamId: normalizeTeam(raw.awayTeamId || raw.base2 || awayName),
    homeTeamName: String(homeName).trim(),
    awayTeamName: String(awayName).trim(),
    homeUserId: raw.homeUserId || raw.user1Id || null,
    awayUserId: raw.awayUserId || raw.user2Id || null,
    homeScore,
    awayScore,
    status: _status(raw.status, homeScore, awayScore),
    startsAt: raw.startsAt || null,
    source: provider,
    sourceVersion: raw.sourceVersion != null ? String(raw.sourceVersion) : null,
    flags: {
      isPrimetime: !!raw.isPrimetime,
      isGotw: !!raw.isGotw,
      isOverseas: !!raw.isOverseas,
    },
  };
}

module.exports = { GAME_STATUS, normalizeTeam, normalizeLeagueId, matchupKey, toCanonicalGame };
