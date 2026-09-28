/*
 * NAVIGATION HEADER
 * FILE: src/services/activeLeagueService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
// Lazy access avoids the setup -> registry -> setup CommonJS cycle.
const types = () => require('./leagueSetupService').LEAGUE_TYPES;

const FILE = 'activeLeagues.json';

function getRegistry() {
  const raw = loadJson(FILE, {}) || {};
  return typeof raw === 'object' && raw ? raw : {};
}

function saveRegistry(reg) {
  saveJsonDebounced(FILE, reg, 300);
  return reg;
}

function listActiveLeagues() {
  return Object.entries(getRegistry()).map(([id, league]) => ({
    id,
    ...league,
  }));
}

function getLeague(id) {
  const reg = getRegistry();
  return reg[id] ? { id, ...reg[id] } : null;
}

function getCurrentLeagueFallback(state) {
  if (!state?.leagueConfig?.leagueTypeId) return null;
  return {
    id: 'current',
    leagueTypeId: state.leagueConfig.leagueTypeId,
    leagueName: state.leagueConfig.leagueName || 'Current League',
    game: state.leagueConfig.game || (types()[state.leagueConfig.leagueTypeId]?.game || null),
    builtCategoryIds: state.leagueConfig.builtCategoryIds || [],
    builtChannelIds: state.leagueConfig.builtChannelIds || [],
    isCustom: !!state.leagueConfig.isCustom,
    createdAt: state.leagueConfig.createdAt || Date.now(),
  };
}

function listResetOptions(state) {
  const listed = listActiveLeagues();
  if (listed.length) return listed;
  const fallback = getCurrentLeagueFallback(state);
  return fallback ? [fallback] : [];
}

function leagueTypeLabel(typeId) {
  return types()[typeId]?.label || typeId || 'Unknown';
}

function formatResetChoice(league) {
  const typeLabel = leagueTypeLabel(league.leagueTypeId);
  const game = league.game ? ` • ${String(league.game).toUpperCase()}` : '';
  return {
    name: `${league.leagueName} — ${typeLabel}${game}`.slice(0, 100),
    value: String(league.id).slice(0, 100),
  };
}

function upsertLeague(league) {
  const reg = getRegistry();
  reg[String(league.id)] = {
    ...league,
    leagueTypeId: league.leagueTypeId,
    leagueName: league.leagueName,
    game: league.game || (types()[league.leagueTypeId]?.game || null),
    builtCategoryIds: Array.isArray(league.builtCategoryIds) ? league.builtCategoryIds : [],
    builtChannelIds: Array.isArray(league.builtChannelIds) ? league.builtChannelIds : [],
    isCustom: !!league.isCustom,
    createdAt: league.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  saveRegistry(reg);
  return { id: String(league.id), ...reg[String(league.id)] };
}


function clearGuild(guildId, options = {}) {
  const gid = String(guildId || '');
  const includeLegacyUnscoped = options.includeLegacyUnscoped !== false;
  const reg = getRegistry();
  let removed = 0;
  for (const [id, league] of Object.entries(reg)) {
    if (String(league.guildId || '') === gid || (includeLegacyUnscoped && !league.guildId)) { delete reg[id]; removed++; }
  }
  saveRegistry(reg);
  return removed;
}

function removeLeague(id) {
  const reg = getRegistry();
  delete reg[String(id)];
  saveRegistry(reg);
  return reg;
}


function setDataSourceMode(id, mode) {
  const leagueId = String(id || '').trim();
  if (!leagueId) throw new Error('league id is required');
  const normalized = String(mode || '').toLowerCase() === 'external_sync' ? 'external_sync' : 'custom_bot_managed';
  const reg = getRegistry();
  if (!reg[leagueId]) throw new Error('league-not-found');
  reg[leagueId] = { ...reg[leagueId], dataSourceMode:normalized, updatedAt:Date.now() };
  saveRegistry(reg);
  return { id:leagueId, ...reg[leagueId] };
}
function getDataSourceMode(id) {
  const leagueId = String(id || '').trim();
  if (!leagueId) return 'custom_bot_managed';
  const row = getRegistry()[leagueId];
  return row?.dataSourceMode === 'external_sync' ? 'external_sync' : 'custom_bot_managed';
}

function findLeagueForChannel(channelOrId) {
  const channel = channelOrId && typeof channelOrId === 'object' ? channelOrId : null;
  const channelId = String(channel?.id || channelOrId || '');
  if (!channelId) return null;
  const parentId = String(channel?.parentId || '');
  for (const league of listActiveLeagues()) {
    const builtChannels = Array.isArray(league.builtChannelIds) ? league.builtChannelIds.map(String) : [];
    const builtCategories = Array.isArray(league.builtCategoryIds) ? league.builtCategoryIds.map(String) : [];
    if (builtChannels.includes(channelId)) return league;
    if (parentId && builtCategories.includes(parentId)) return league;
  }
  return null;
}

module.exports = {
  getRegistry,
  saveRegistry,
  listActiveLeagues,
  getLeague,
  getCurrentLeagueFallback,
  listResetOptions,
  formatResetChoice,
  leagueTypeLabel,
  upsertLeague,
  removeLeague,
  clearGuild,
  setDataSourceMode,
  getDataSourceMode,
  findLeagueForChannel,
};
