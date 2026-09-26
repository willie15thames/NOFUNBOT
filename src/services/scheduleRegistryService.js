/*
 * NAVIGATION HEADER
 * FILE: src/services/scheduleRegistryService.js
 * LAYER: Service layer
 * PURPOSE: Controls scheduling, timers, or recurring execution behavior.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');

const FILE = 'scheduleRegistry.json';
const DEFAULTS = {
  schema: 'nofunleague-schedule-registry',
  version: 1,
  source: 'local',
  currentWeek: null,
  weeks: {},
  teams: [],
  players: [],
  lastImportAt: null,
  lastExportAt: null,
};

function getRegistry() {
  const raw = loadJson(FILE, DEFAULTS) || {};
  return {
    ...DEFAULTS,
    ...raw,
    weeks: typeof raw.weeks === 'object' && raw.weeks ? raw.weeks : {},
    teams: Array.isArray(raw.teams) ? raw.teams : [],
    players: Array.isArray(raw.players) ? raw.players : [],
  };
}

function saveRegistry(next) {
  const merged = { ...getRegistry(), ...(next || {}) };
  saveJsonDebounced(FILE, merged, 300);
  return merged;
}

function normalizeGame(game) {
  if (!game || typeof game !== 'object') return null;

  const team1 = game.team1 || game.homeTeam || game.home || game.awayTeamA || game.teamA || game.team || null;
  const team2 = game.team2 || game.awayTeam || game.away || game.homeTeamB || game.teamB || game.opponent || null;
  if (!team1 || !team2) return null;

  return {
    team1: String(team1).trim(),
    team2: String(team2).trim(),
    base1: String(game.base1 || game.team1Base || team1).trim(),
    base2: String(game.base2 || game.team2Base || team2).trim(),
    user1Id: game.user1Id ? String(game.user1Id) : null,
    user2Id: game.user2Id ? String(game.user2Id) : null,
    isPrimetime: !!game.isPrimetime,
    isGotw: !!game.isGotw,
    isOverseas: !!game.isOverseas,
  };
}

function inferTeamsFromWeeks(weeks) {
  const teamSet = new Set();
  Object.values(weeks || {}).forEach(games => {
    (games || []).forEach(g => {
      if (g.team1) teamSet.add(g.team1);
      if (g.team2) teamSet.add(g.team2);
    });
  });
  return Array.from(teamSet).sort();
}

function upsertWeek(week, matchups, meta = {}) {
  const registry = getRegistry();
  const key = String(week);
  registry.weeks[key] = (Array.isArray(matchups) ? matchups : []).map(normalizeGame).filter(Boolean);
  registry.currentWeek = Number(week);
  registry.teams = inferTeamsFromWeeks(registry.weeks);
  if (meta.source) registry.source = meta.source;
  if (meta.importedAt) registry.lastImportAt = meta.importedAt;
  saveRegistry(registry);
  return registry;
}

function getWeek(week) {
  const registry = getRegistry();
  return Array.isArray(registry.weeks[String(week)]) ? registry.weeks[String(week)] : [];
}

function listWeeks() {
  return Object.keys(getRegistry().weeks).map(n => Number(n)).filter(n => !Number.isNaN(n)).sort((a,b) => a-b);
}

function exportCurrentWeek(state) {
  const registry = getRegistry();
  const week = state?.scheduleState?.week || registry.currentWeek;
  const matchups = week ? (registry.weeks[String(week)] || state?.scheduleState?.matchups || []) : [];
  registry.lastExportAt = Date.now();
  saveRegistry(registry);
  return {
    schema: 'nofunleague-schedule-export',
    version: 1,
    exportedAt: registry.lastExportAt,
    source: registry.source,
    currentWeek: week || null,
    weeks: week ? { [String(week)]: matchups } : {},
    teams: registry.teams || inferTeamsFromWeeks(week ? { [String(week)]: matchups } : registry.weeks),
    players: Array.isArray(registry.players) ? registry.players : [],
  };
}

function exportAllWeeks(state) {
  const registry = getRegistry();
  registry.lastExportAt = Date.now();
  saveRegistry(registry);
  return {
    schema: 'nofunleague-schedule-export',
    version: 1,
    exportedAt: registry.lastExportAt,
    source: registry.source,
    currentWeek: state?.scheduleState?.week || registry.currentWeek || null,
    weeks: registry.weeks,
    teams: registry.teams || inferTeamsFromWeeks(registry.weeks),
    players: Array.isArray(registry.players) ? registry.players : [],
  };
}

// V202 (BUG-011): RFC 4180 parser — quoted commas, escaped quotes and embedded newlines no longer corrupt rows.
function parseCsv(text) {
  return require('../utils/csv').parseCsvObjects(text);
}

/**
 * V202: PURE normalization of any accepted payload shape into { currentWeek, weeks, teams, players }.
 * Does not read or write the registry. Used by importScheduleObject and by every provider adapter so alias
 * parsing happens in exactly one place (spec §16).
 */
function normalizeImportPayload(input, registryCurrentWeek = null) {
  let weeks = {};
  let currentWeek = null;
  const registry = { currentWeek: registryCurrentWeek };

  // Our own export format: { weeks: { "1": [..] } }
  if (input && typeof input === 'object' && input.weeks && !Array.isArray(input.weeks)) {
    for (const [week, games] of Object.entries(input.weeks)) {
      weeks[String(week)] = (games || []).map(normalizeGame).filter(Boolean);
    }
    currentWeek = input.currentWeek != null ? Number(input.currentWeek) : registry.currentWeek;
  }
  // Array form: { weeks: [{week, games|matchups}] }
  else if (input && Array.isArray(input.weeks)) {
    for (const entry of input.weeks) {
      const week = entry.week ?? entry.number;
      const games = entry.games || entry.matchups || [];
      if (week != null) weeks[String(week)] = games.map(normalizeGame).filter(Boolean);
    }
    currentWeek = input.currentWeek != null ? Number(input.currentWeek) : registry.currentWeek;
  }
  // Flat games list: { games: [{week,...}] } or { schedule: [...] }
  else if (input && Array.isArray(input.games || input.schedule)) {
    const items = input.games || input.schedule;
    for (const game of items) {
      const week = Number(game.week ?? game.Week ?? 0);
      if (!week) continue;
      weeks[String(week)] = weeks[String(week)] || [];
      const normalized = normalizeGame(game);
      if (normalized) weeks[String(week)].push(normalized);
    }
    currentWeek = input.currentWeek != null ? Number(input.currentWeek) : registry.currentWeek;
  }
  // CSV rows already parsed
  else if (Array.isArray(input)) {
    for (const game of input) {
      const week = Number(game.week ?? game.Week ?? 0);
      if (!week) continue;
      weeks[String(week)] = weeks[String(week)] || [];
      const normalized = normalizeGame({
        team1: game.team1 || game.homeTeam || game.Home || game.home,
        team2: game.team2 || game.awayTeam || game.Away || game.away,
        base1: game.base1 || game.team1,
        base2: game.base2 || game.team2,
        isPrimetime: /true|1|yes/i.test(String(game.isPrimetime || game.primetime || '')),
        isGotw: /true|1|yes/i.test(String(game.isGotw || game.gotw || '')),
        isOverseas: /true|1|yes/i.test(String(game.isOverseas || game.overseas || '')),
      });
      if (normalized) weeks[String(week)].push(normalized);
    }
  }

  let playerList = null;
  if (Array.isArray(input?.players))    playerList = input.players;
  else if (Array.isArray(input?.roster)) playerList = input.roster;
  return {
    currentWeek: currentWeek != null && !Number.isNaN(currentWeek) ? currentWeek : null,
    weeks,
    teams: inferTeamsFromWeeks(weeks),
    players: playerList,
  };
}

function importScheduleObject(input, options = {}) {
  const registry = getRegistry();
  const source = options.source || 'import';
  const normalized = normalizeImportPayload(input, registry.currentWeek);
  const mergedWeeks = { ...(registry.weeks || {}), ...normalized.weeks };
  const teamList = inferTeamsFromWeeks(mergedWeeks);
  const playerList = Array.isArray(normalized.players) ? normalized.players : (Array.isArray(registry.players) ? registry.players : []);
  const next = {
    ...registry,
    source,
    currentWeek: normalized.currentWeek != null ? normalized.currentWeek : registry.currentWeek,
    weeks: mergedWeeks,
    teams: teamList,
    players: playerList,
    lastImportAt: Date.now(),
  };
  saveRegistry(next);
  return next;
}

// V202 (BUG-010): attachments are fetched through the central intake (Discord CDN allowlist, timeout, size cap).
async function importAttachmentUrl(url, filename, options = {}) {
  const { fetchExternal, DISCORD_CDN_HOSTS } = require('../utils/httpIntake');
  const res = await fetchExternal({ url, parse: 'text', allowedHosts: DISCORD_CDN_HOSTS, timeoutMs: 15000, maxBytes: 4 * 1024 * 1024 });
  if (!res.ok) throw new Error(`Failed to fetch attachment: ${res.reason}${res.status ? ` (${res.status})` : ''}`);
  const text = res.data;

  let payload;
  if ((filename || '').toLowerCase().endsWith('.csv')) {
    payload = parseCsv(text);
  } else {
    payload = JSON.parse(text);
  }
  return importScheduleObject(payload, options);
}

function loadWeekIntoState(state, week) {
  const games = getWeek(week);
  if (!games.length) return null;
  state.scheduleState = {
    ...state.scheduleState,
    week: Number(week),
    matchups: games,
    pinnedMsgId: null,
  };
  const registry = getRegistry();
  registry.currentWeek = Number(week);
  saveRegistry(registry);
  return games;
}

module.exports = {
  getRegistry,
  saveRegistry,
  upsertWeek,
  getWeek,
  listWeeks,
  exportCurrentWeek,
  exportAllWeeks,
  importScheduleObject,
  normalizeImportPayload,
  importAttachmentUrl,
  loadWeekIntoState,
  parseCsv,
};
