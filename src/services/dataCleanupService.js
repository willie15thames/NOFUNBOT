/*
 * NAVIGATION HEADER
 * FILE: src/services/dataCleanupService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { saveJson, loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const activeLeagueService = require('./activeLeagueService');
const teamRegistry = require('./teamRegistryService');

function purgeLeagueData(state, league) {
  const leagueId = String(league?.id || '');
  const leagueName = String(league?.leagueName || '');

  let teamSlotsReset = 0;
  for (const entry of state.openTeamRegistry || []) {
    const entryLeagueId = entry.leagueId != null ? String(entry.leagueId) : null;
    const matches = entryLeagueId === leagueId || (!entryLeagueId && state.leagueConfig?.leagueName === leagueName);
    if (!matches) continue;
    entry.isOpen = true;
    entry.ownerId = null;
    entry.timezone = null;
    teamSlotsReset++;
  }
  saveJsonDebounced('openTeamRegistry.json', state.openTeamRegistry);

  const nextPlayers = new Map();
  let playersRemoved = 0;
  for (const [key, player] of state.players.entries()) {
    const matches = String(player?.leagueId || '') === leagueId || (!player?.leagueId && state.leagueConfig?.leagueName === leagueName);
    if (matches) { playersRemoved++; continue; }
    nextPlayers.set(key, player);
  }
  state.players.clear();
  for (const [k, v] of nextPlayers.entries()) state.players.set(k, v);

  let gamesRemoved = 0;
  for (const [chId, game] of Array.from(state.games.entries())) {
    const matches = String(game?.leagueId || '') === leagueId || String(game?.leagueTag || '') === leagueName;
    if (matches || !leagueId) {
      state.games.delete(chId);
      gamesRemoved++;
    }
  }

  // Clear singleton schedule state if it appears to belong to the removed league.
  const currentMatches = Array.isArray(state.scheduleState?.matchups) ? state.scheduleState.matchups : [];
  const scheduleBelongs = currentMatches.some(m =>
    String(m?.leagueId || '') === leagueId || String(m?.leagueTag || '') === leagueName
  ) || (!leagueId && currentMatches.length > 0);
  if (scheduleBelongs || state.leagueConfig?.leagueName === leagueName) {
    state.scheduleState = { week:null, matchups:[], pinnedMsgId:null, lastPosted:null, timerId:null };
    saveJson('scheduleRegistry.json', {
      ...(loadJson('scheduleRegistry.json', {}) || {}),
      currentWeek: null,
      weeks: {},
      teams: [],
      lastImportAt: null,
      lastExportAt: null,
      source: 'local',
    });
  }

  // Remove team registry entries for this league, then resync from live state
  try {
    const reg = teamRegistry.getRegistry();
    reg.teams = (reg.teams || []).filter(t => String(t.leagueId || '') !== leagueId);
    saveJson('teamRegistry.json', reg);
  } catch {}
  try { teamRegistry.syncFromState(state); } catch {}

  activeLeagueService.removeLeague(leagueId);

  return {
    teamSlotsReset,
    playersRemoved,
    gamesRemoved,
    activeLeagueRemoved: !!leagueId,
  };
}

module.exports = {
  purgeLeagueData,
};
