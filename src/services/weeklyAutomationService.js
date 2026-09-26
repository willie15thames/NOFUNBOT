/*
 * NAVIGATION HEADER
 * FILE: src/services/weeklyAutomationService.js
 * LAYER: Service layer
 * PURPOSE: Discord PROJECTION of the current workflow week (game channels). V202 / BUG-001: this service is no
 *          longer the franchise-advance authority. runAdvanceAutomation() is a compatibility wrapper that projects
 *          the CURRENT workflow week idempotently (find-or-create per matchup, previous-week channels only are
 *          cleared). Franchise/source advancement is owned by src/league/advanceEngine.js.
 * LOOK HERE FIRST WHEN DEBUGGING: projectCurrentWeek(), runAdvanceAutomation(), getWeeklySettings().
 * RELATED FLOW: interactionRouter (/game-channels, /schedule-load-week), liveSyncService.syncNow,
 *               flowDefinitions 'schedule-advance', gameChannelCompatService, advanceEngine (PUBLISHING_NEW_WEEK).
 * NOTE: lastProjectedWeek = last week projected to Discord. lastAdvancedWeek is written ONLY by advanceEngine
 *       after a provider-verified source advance (never by this file).
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const { ensureGameChannel, deleteAllGameChannels } = require('./gameChannelService');
const { makeLogger } = require('../utils/logger');

const log = makeLogger('weeklyAutomation');
const FILE = 'weeklyAutomation.json';
const DEFAULTS = {
  mode: 'manual',
  advanceHours: 48,
  autoCreateGameChannels: true,
  clearPreviousWeekChannels: true,
  lastAdvancedWeek: null,     // written by advanceEngine only (verified source advance)
  lastProjectedWeek: null,    // written here (Discord projection)
  lastAutomationRunAt: null,
};

function getWeeklySettings() {
  const raw = loadJson(FILE, DEFAULTS) || {};
  return {
    ...DEFAULTS,
    ...raw,
    mode: raw.mode === 'automatic' ? 'automatic' : 'manual',
    advanceHours: Math.max(1, Number(raw.advanceHours || DEFAULTS.advanceHours)),
    autoCreateGameChannels: raw.autoCreateGameChannels !== false,
    clearPreviousWeekChannels: raw.clearPreviousWeekChannels !== false,
  };
}

function saveWeeklySettings(next) {
  const merged = { ...getWeeklySettings(), ...(next || {}) };
  merged.mode = merged.mode === 'automatic' ? 'automatic' : 'manual';
  merged.advanceHours = Math.max(1, Number(merged.advanceHours || DEFAULTS.advanceHours));
  saveJsonDebounced(FILE, merged, 300);
  return merged;
}

function getAdvanceMs() {
  return getWeeklySettings().advanceHours * 60 * 60 * 1000;
}

function _resolveOwner(teamName, players, explicit) {
  if (explicit) return String(explicit);
  if (!players || typeof players.values !== 'function') return null;
  try {
    const { getTeamDataByAnyName } = require('../utils/teamUtils');
    return getTeamDataByAnyName(teamName, players)?.userId || null;
  } catch { return null; }
}

/**
 * Ensure a game channel exists for every matchup of the current workflow week.
 * Idempotent: existing managed channels are reused (skipped), missing owners are held, only real creations count.
 * @returns {{ created:number, skipped:number, held:number, failed:number, week:number|null, holds:Array<{team1,team2,missing}> }}
 */
async function createChannelsForCurrentSchedule(guild, state, players) {
  const week = state?.scheduleState?.week;
  const matchups = Array.isArray(state?.scheduleState?.matchups) ? state.scheduleState.matchups : [];
  const result = { created: 0, skipped: 0, held: 0, failed: 0, week: week || null, holds: [] };
  if (!week || !matchups.length) return result;
  const registry = players || state?.players || null;

  for (const m of matchups) {
    const team1 = m.team1 || m.homeTeamName, team2 = m.team2 || m.awayTeamName;
    const r = await ensureGameChannel(guild, {
      week,
      team1, team2,
      user1Id: _resolveOwner(m.base1 || team1, registry, m.user1Id),
      user2Id: _resolveOwner(m.base2 || team2, registry, m.user2Id),
      isPrimetime: !!m.isPrimetime, isGotw: !!m.isGotw, isOverseas: !!m.isOverseas,
      game: state?.leagueConfig?.game, leagueTag: state?.leagueConfig?.leagueName,
    }).catch(e => ({ ok: false, reason: 'create-failed', error: e.message }));
    if (r.ok && r.created) result.created++;
    else if (r.ok) result.skipped++;
    else if (r.reason === 'missing-owner') { result.held++; result.holds.push({ team1, team2, missing: r.missing }); }
    else if (r.reason === 'cpu-or-bye') result.skipped++;
    else { result.failed++; log.warn(`ensureGameChannel failed week=${week} ${team1} vs ${team2}: ${r.reason}${r.error ? ' ' + r.error : ''}`); }
  }
  return result;
}

/** Legacy: delete ALL weekly game channels (manual /game-channels clear, league delete/reset). */
async function clearCurrentGameChannels(guild, reason = 'Weekly automation clear') {
  const deleted = await deleteAllGameChannels(guild, reason).catch(() => 0);
  return { deleted };
}

/** V202: delete only channels that belong to weeks other than the current workflow week. */
async function clearPreviousWeekChannels(guild, state, reason = 'Previous week cleared') {
  const week = Number(state?.scheduleState?.week);
  if (!Number.isFinite(week)) return { deleted: 0 };
  const deleted = await deleteAllGameChannels(guild, reason, { keepWeek: week }).catch(() => 0);
  return { deleted };
}

/** Explicit commissioner rebuild: clear everything then recreate the current week (unchanged manual semantics). */
async function rebuildCurrentWeekChannels(guild, state, players, reason = 'Weekly automation rebuild') {
  const cleared = await clearCurrentGameChannels(guild, reason);
  const created = await createChannelsForCurrentSchedule(guild, state, players);
  return { cleared: cleared.deleted || 0, created: created.created || 0, skipped: created.skipped || 0, held: created.held || 0, week: created.week || state?.scheduleState?.week || null };
}

/**
 * V202: idempotent projection of the current workflow week to Discord.
 * - previous-week channels are cleared (current week is never cleared by a re-run)
 * - matchup channels are find-or-create
 * Safe to call repeatedly: a second call for the same week creates nothing and deletes nothing.
 */
async function projectCurrentWeek(guild, state, players, opts = {}) {
  const settings = getWeeklySettings();
  const week = state?.scheduleState?.week || null;
  const result = { mode: settings.mode, cleared: 0, created: 0, skipped: 0, held: 0, failed: 0, week, ran: false, reason: null, holds: [] };
  if (!week) { result.reason = 'no-current-week'; return result; }
  if (!settings.autoCreateGameChannels && !opts.force) { result.reason = 'auto-create-disabled'; return result; }

  if (settings.clearPreviousWeekChannels || opts.clearPrevious) {
    const cleared = await clearPreviousWeekChannels(guild, state, `Previous week cleared before Week ${week} projection`);
    result.cleared = cleared.deleted || 0;
  }
  const created = await createChannelsForCurrentSchedule(guild, state, players);
  Object.assign(result, { created: created.created, skipped: created.skipped, held: created.held, failed: created.failed, holds: created.holds, ran: true });

  saveWeeklySettings({ lastProjectedWeek: week, lastAutomationRunAt: Date.now() });
  log.info(`projectCurrentWeek week=${week} created=${result.created} skipped=${result.skipped} held=${result.held} failed=${result.failed} clearedPrev=${result.cleared}`);
  return result;
}

/**
 * COMPATIBILITY WRAPPER (name and result shape preserved for router, liveSync, flowDefinitions).
 * Pre-V202 this cleared and recreated the SAME week and recorded it as "advanced". It now:
 *   - does nothing unless mode=automatic AND autoCreateGameChannels (unchanged gate)
 *   - projects the current workflow week idempotently (see projectCurrentWeek)
 *   - never claims a franchise advance and never writes lastAdvancedWeek
 */
async function runAdvanceAutomation(guild, state, players) {
  const settings = getWeeklySettings();
  if (settings.mode !== 'automatic' || !settings.autoCreateGameChannels) {
    return { mode: settings.mode, cleared: 0, created: 0, skipped: 0, held: 0, failed: 0, week: state?.scheduleState?.week || null, ran: false, reason: 'automation-off' };
  }
  return projectCurrentWeek(guild, state, players);
}

module.exports = {
  DEFAULTS,
  getWeeklySettings,
  saveWeeklySettings,
  getAdvanceMs,
  createChannelsForCurrentSchedule,
  clearCurrentGameChannels,
  clearPreviousWeekChannels,
  rebuildCurrentWeekChannels,
  projectCurrentWeek,
  runAdvanceAutomation,
};
