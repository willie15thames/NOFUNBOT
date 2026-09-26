/*
 * NAVIGATION HEADER
 * FILE: src/league/validationService.js
 * LAYER: League control plane (V202)
 * PURPOSE: Deterministic validation of a normalized snapshot before it may become the published week
 *          (spec §13: team mapping, game-count, duplicates, week consistency). Returns structured results;
 *          never throws for data problems.
 * LOOK HERE FIRST WHEN DEBUGGING: validateSnapshot(), validateWeekGames().
 * RELATED FLOW: gameProvider.validateSnapshot default, advanceEngine VALIDATING_NEW_WEEK.
 */

'use strict';

const { toCanonicalGame, normalizeTeam } = require('./canonicalModel');

/**
 * @param {object} snapshot { currentWeek, weeks: { [week]: rawGame[] }, teams?: string[] }
 * @param {object} [opts]   { knownTeams?: string[], expectedGamesPerWeek?: number|null, requireWeek?: number|null }
 */
function validateSnapshot(snapshot, opts = {}) {
  const errors = [];
  const warnings = [];
  if (!snapshot || typeof snapshot !== 'object') return { ok: false, errors: ['snapshot-missing'], warnings, games: {} };
  const weeks = snapshot.weeks && typeof snapshot.weeks === 'object' && !Array.isArray(snapshot.weeks) ? snapshot.weeks : null;
  if (!weeks) errors.push('weeks-missing');
  const currentWeek = snapshot.currentWeek != null ? Number(snapshot.currentWeek) : null;
  if (currentWeek != null && !Number.isFinite(currentWeek)) errors.push('current-week-invalid');
  if (opts.requireWeek != null && (!weeks || !weeks[String(opts.requireWeek)])) errors.push(`week-${opts.requireWeek}-missing`);
  const games = {};
  if (weeks) {
    for (const [week, list] of Object.entries(weeks)) {
      const r = validateWeekGames(Number(week), list, opts);
      games[week] = r.games;
      errors.push(...r.errors.map(e => `w${week}:${e}`));
      warnings.push(...r.warnings.map(w => `w${week}:${w}`));
    }
  }
  return { ok: errors.length === 0, errors, warnings, currentWeek, games };
}

function validateWeekGames(week, list, opts = {}) {
  const errors = [];
  const warnings = [];
  const games = [];
  if (!Array.isArray(list)) return { ok: false, errors: ['games-not-array'], warnings, games };
  const known = Array.isArray(opts.knownTeams) && opts.knownTeams.length ? new Set(opts.knownTeams.map(normalizeTeam)) : null;
  const seen = new Set();
  const teamSeen = new Map();
  for (const raw of list) {
    const g = toCanonicalGame({ ...raw, week: raw?.week ?? week }, { week, leagueId: opts.leagueId, provider: opts.provider, seasonId: opts.seasonId });
    if (!g) { errors.push('unidentifiable-game'); continue; }
    if (Number(g.week) !== Number(week)) errors.push(`week-mismatch:${g.homeTeamName}-vs-${g.awayTeamName}`);
    if (seen.has(g.matchupKey)) { errors.push(`duplicate-matchup:${g.matchupKey}`); continue; }
    seen.add(g.matchupKey);
    for (const t of [g.homeTeamId, g.awayTeamId]) {
      if (known && !known.has(t) && !/\b(cpu|bye)\b/.test(t)) errors.push(`unknown-team:${t}`);
      teamSeen.set(t, (teamSeen.get(t) || 0) + 1);
    }
    games.push(g);
  }
  for (const [t, n] of teamSeen) if (n > 1 && !/\b(cpu|bye)\b/.test(t)) warnings.push(`team-appears-${n}x:${t}`);
  if (opts.expectedGamesPerWeek && games.length !== Number(opts.expectedGamesPerWeek)) {
    errors.push(`game-count:${games.length}!=${opts.expectedGamesPerWeek}`);
  }
  return { ok: errors.length === 0, errors, warnings, games };
}

module.exports = { validateSnapshot, validateWeekGames };
