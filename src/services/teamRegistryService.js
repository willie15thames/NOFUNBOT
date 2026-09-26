/*
 * NAVIGATION HEADER
 * FILE: src/services/teamRegistryService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');

const FILE = 'teamRegistry.json';
const DEFAULTS = {
  schema: 'nofunleague-team-registry',
  version: 1,
  teams: [],
  lastSyncedAt: null,
  notes: 'Normalized team ownership registry used to keep open teams, owners, schedules, and weekly channel data aligned.',
};

function getRegistry() {
  const raw = loadJson(FILE, DEFAULTS) || {};
  return {
    ...DEFAULTS,
    ...raw,
    teams: Array.isArray(raw.teams) ? raw.teams : [],
  };
}

function saveRegistry(reg) {
  const next = { ...DEFAULTS, ...(reg || {}) };
  saveJsonDebounced(FILE, next, 300);
  return next;
}

function syncFromState(state) {
  const leagueTypeId = state?.leagueConfig?.leagueTypeId || null;
  const leagueName = state?.leagueConfig?.leagueName || 'League Not Initialized';

  const playersByBase = new Map();
  try {
    for (const p of state.players.values()) {
      playersByBase.set(String(p.baseTeam || p.team || '').toLowerCase(), p);
    }
  } catch {}

  const teams = (state?.openTeamRegistry || []).map(t => {
    const player = playersByBase.get(String(t.baseTeam || '').toLowerCase()) || null;
    return {
      leagueId: t.leagueId || leagueTypeId || null,
      leagueName,
      leagueTypeId,
      baseTeam: t.baseTeam,
      displayTeam: t.displayTeam,
      logoUrl: t.logoUrl || null,
      replacementFor: t.replacementFor || player?.replacementFor || null,
      isCustomTeam: !!(t.isCustomTeam || player?.isCustomTeam),
      isOpen: !!t.isOpen,
      ownerId: t.ownerId || player?.userId || null,
      ownerDisplay: player?.displayTeam || null,
      timezone: player?.timezone || t.timezone || null,
      syncedAt: Date.now(),
    };
  });

  const next = {
    ...getRegistry(),
    teams,
    lastSyncedAt: Date.now(),
  };
  saveRegistry(next);
  return next;
}

function setTeamOwner({ state, baseTeam, ownerId }) {
  const reg = syncFromState(state);
  const needle = String(baseTeam || '').toLowerCase();
  const team = reg.teams.find(t => String(t.baseTeam || '').toLowerCase() === needle);
  if (!team) return null;
  team.ownerId = ownerId || null;
  team.isOpen = !ownerId;
  team.syncedAt = Date.now();
  saveRegistry(reg);
  return team;
}

function listTeamsForLeague(state, leagueId = null) {
  const reg = syncFromState(state);
  return reg.teams.filter(t => (t.leagueId || null) === (leagueId || null));
}

module.exports = {
  getRegistry,
  saveRegistry,
  syncFromState,
  setTeamOwner,
  listTeamsForLeague,
};
