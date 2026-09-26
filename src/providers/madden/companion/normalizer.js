/*
 * NAVIGATION HEADER
 * FILE: src/providers/madden/companion/normalizer.js
 * LAYER: Provider adapter layer (V202, spec §16)
 * PURPOSE: Map a parsed Companion export into the bot's normalized snapshot shape { currentWeek, weeks, teams }
 *          and CanonicalGame records. Alias parsing happens ONCE here (spec §16).
 * LOOK HERE FIRST WHEN DEBUGGING: normalizeSchedule(), normalizeTeams().
 * NOTE: Field names used: gameScheduleInfoList[].{weekIndex, homeTeamId, awayTeamId, homeScore, awayScore, status,
 *       scheduleId} and leagueTeamInfoList[].{teamId, displayName, nickName, cityName} — the Companion/community
 *       export family. Unknown shapes fall back to the generic schedule alias parser in scheduleRegistryService.
 */

'use strict';

const { toCanonicalGame } = require('../../../league/canonicalModel');

function normalizeTeams(data) {
  const list = data?.leagueTeamInfoList || data?.teamInfoList || data?.teams || [];
  if (!Array.isArray(list)) return { byId: {}, names: [] };
  const byId = {};
  const names = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const id = t.teamId ?? t.id ?? t.abbrName ?? null;
    const display = t.displayName || t.name || [t.cityName, t.nickName].filter(Boolean).join(' ') || t.abbrName || null;
    if (!display) continue;
    if (id != null) byId[String(id)] = display;
    names.push(display);
  }
  return { byId, names };
}

/**
 * @returns {{ ok:boolean, snapshot?:{currentWeek:number|null, weeks:Object<string, object[]>, teams:string[]}, reason?:string, canonical?:object[] }}
 */
function normalizeSchedule(data, ctx = {}) {
  const teams = normalizeTeams(data);
  const teamMap = { ...(ctx.teamMap || {}), ...teams.byId };
  const list = data?.gameScheduleInfoList || data?.schedule || data?.games || null;
  if (!Array.isArray(list)) {
    // generic shapes (weeks map / our own export) → registry alias parser
    try {
      const registry = require('../../../services/scheduleRegistryService');
      const generic = registry.normalizeImportPayload(data);
      if (generic && Object.keys(generic.weeks || {}).length) return { ok: true, snapshot: generic, canonical: [] };
    } catch {}
    return { ok: false, reason: 'no-schedule-list' };
  }
  const weeks = {};
  const canonical = [];
  let maxUnplayed = null;
  for (const g of list) {
    if (!g || typeof g !== 'object') continue;
    const week = Number(g.weekIndex ?? g.week ?? g.Week);
    if (!Number.isFinite(week)) continue;
    // Companion weekIndex is zero-based; the bot's weeks are 1-based. Respect an explicit 1-based `week` field.
    const weekNumber = g.week != null || g.Week != null ? week : week + 1;
    const home = teamMap[String(g.homeTeamId)] || g.homeTeamName || g.homeTeam || g.home || null;
    const away = teamMap[String(g.awayTeamId)] || g.awayTeamName || g.awayTeam || g.away || null;
    if (!home || !away) continue;
    const status = g.status != null ? String(g.status) : (g.homeScore != null && g.awayScore != null && (Number(g.homeScore) + Number(g.awayScore)) > 0 ? 'final' : 'scheduled');
    const raw = {
      week: weekNumber,
      team1: home, team2: away,
      homeScore: g.homeScore ?? null, awayScore: g.awayScore ?? null,
      status, sourceGameId: g.scheduleId ?? g.gameId ?? null,
      seasonId: g.seasonIndex != null ? String(g.seasonIndex) : ctx.seasonId,
      provider: 'companion_export',
    };
    weeks[String(weekNumber)] = weeks[String(weekNumber)] || [];
    weeks[String(weekNumber)].push({ team1: home, team2: away, base1: home, base2: away, isPrimetime: false, isGotw: false, isOverseas: false, status: raw.status, homeScore: raw.homeScore, awayScore: raw.awayScore, sourceGameId: raw.sourceGameId });
    const cg = toCanonicalGame(raw, { leagueId: ctx.leagueId, provider: 'companion_export', seasonId: ctx.seasonId });
    if (cg) canonical.push(cg);
    if (raw.status !== 'final' && (maxUnplayed == null || weekNumber < maxUnplayed)) maxUnplayed = weekNumber;
  }
  const currentWeek = data.currentWeek != null ? Number(data.currentWeek) : (data.weekIndex != null ? Number(data.weekIndex) + 1 : maxUnplayed);
  return { ok: true, snapshot: { currentWeek: Number.isFinite(currentWeek) ? currentWeek : null, weeks, teams: teams.names }, canonical };
}

module.exports = { normalizeSchedule, normalizeTeams };
