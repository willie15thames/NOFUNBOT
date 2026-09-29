/*
 * NAVIGATION HEADER
 * FILE: src/league/gameSessionService.js
 * LAYER: League control plane (V202)
 * PURPOSE: Durable owner of weekly game sessions (spec §14 "Game", audit §7 "Persist GameSession").
 *          Persists matchup identity → channel id, owner ids, response state, reminder state, deadline intent
 *          to gameSessions.json (jsonStore → BotKv Postgres write-through) so a restart no longer forgets which
 *          channels are live or who has responded. state.games (channelId → gameData) stays the in-memory
 *          projection every handler already uses; this service keeps the two in sync.
 * LOOK HERE FIRST WHEN DEBUGGING: registerSession(), findByMatchupKey(), rehydrate(), syncFromState().
 * RELATED FLOW: gameChannelService.ensureGameChannel/createGameChannel/deleteGameChannel, stabilityCoreMicroservice
 *               (rehydrate on boot), state.js persist loop (syncFromState).
 * NOTE: Never persist Node timer handles — only timestamps/intent (createdAt, deadlineAt, nextReminderAt).
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const { matchupKey } = require('./canonicalModel');
const { makeLogger } = require('../utils/logger');

const log = makeLogger('gameSession');
const FILE = 'gameSessions.json';
const SESSION_STATUS = Object.freeze({ ACTIVE: 'active', FINISHED: 'finished', DELETED: 'deleted' });
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const SEVEN_HOURS = 7 * 60 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // finished/deleted sessions are pruned after 30 days

function _load() {
  const raw = loadJson(FILE, { schema: 'nofunleague-game-sessions', version: 1, sessions: {} }) || {};
  return {
    schema: 'nofunleague-game-sessions',
    version: 1,
    sessions: raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {},
  };
}

function _save(store) {
  saveJsonDebounced(FILE, store, 300);
  return store;
}

function buildMatchupKeyFor(gameData, meta = {}) {
  return matchupKey({
    leagueId: meta.leagueId || gameData.leagueId,
    provider: meta.provider || gameData.provider || 'local',
    seasonId: meta.seasonId || gameData.seasonId || 'current',
    week: gameData.week,
    teamA: gameData.team1,
    teamB: gameData.team2,
  });
}

/** Persist (create or replace) the durable record for a live game channel. */
function registerSession(channelId, gameData, meta = {}) {
  if (!channelId || !gameData) return null;
  const key = meta.matchupKey || buildMatchupKeyFor(gameData, meta);
  if (!key) return null;
  const store = _load();
  const now = Date.now();
  const createdAt = Number(gameData.createdAt || now);
  const existing = store.sessions[key] || {};
  const session = {
    matchupKey: key,
    channelId: String(channelId),
    guildId: meta.guildId ? String(meta.guildId) : (existing.guildId || null),
    leagueId: meta.leagueId || gameData.leagueId || existing.leagueId || 'default',
    provider: meta.provider || gameData.provider || existing.provider || 'local',
    seasonId: meta.seasonId || gameData.seasonId || existing.seasonId || 'current',
    week: Number(gameData.week),
    team1: gameData.team1,
    team2: gameData.team2,
    user1Id: gameData.user1Id || null,
    user2Id: gameData.user2Id || null,
    isPrimetime: !!gameData.isPrimetime,
    isGotw: !!gameData.isGotw,
    isOverseas: !!gameData.isOverseas,
    gameKey: gameData.gameKey || existing.gameKey || 'madden',
    leagueTag: gameData.leagueTag || existing.leagueTag || '',
    status: gameData.finished ? SESSION_STATUS.FINISHED : SESSION_STATUS.ACTIVE,
    responded: [...(gameData.responded instanceof Set ? gameData.responded : (gameData.responded || []))].map(String),
    reminderCount: Number(gameData.reminderCount || 0),
    createdAt,
    deadlineAt: Number(existing.deadlineAt || (createdAt + TWENTY_FOUR_HOURS)),
    nextReminderAt: Number(existing.nextReminderAt || (createdAt + SEVEN_HOURS)),
    finishedAt: gameData.finished ? (existing.finishedAt || now) : null,
    updatedAt: now,
  };
  store.sessions[key] = session;
  _save(store);
  gameData.matchupKey = key;
  return session;
}

function findByMatchupKey(key) {
  if (!key) return null;
  return _load().sessions[key] || null;
}

function findByChannelId(channelId) {
  if (!channelId) return null;
  const id = String(channelId);
  return Object.values(_load().sessions).find(s => s.channelId === id) || null;
}

function listActive(week = null) {
  return Object.values(_load().sessions).filter(s => s.status === SESSION_STATUS.ACTIVE && (!require('./spaceContext').current() || s.leagueId === require('./spaceContext').current()) && (week == null || Number(s.week) === Number(week)));
}

function clearGuild(guildId, leagueIds = []) {
  const store = _load();
  const leagues = new Set(leagueIds.map(String));
  let removed = 0;
  for (const [key, session] of Object.entries(store.sessions)) {
    if (String(session.guildId || '') !== String(guildId) && !leagues.has(String(session.leagueId || ''))) continue;
    delete store.sessions[key]; removed++;
  }
  if (removed) _save(store);
  return removed;
}

function _patch(key, patch) {
  const store = _load();
  const cur = store.sessions[key];
  if (!cur) return null;
  store.sessions[key] = { ...cur, ...patch, updatedAt: Date.now() };
  _save(store);
  return store.sessions[key];
}

function markResponded(channelId, userId) {
  const s = findByChannelId(channelId);
  if (!s) return null;
  const set = new Set((s.responded || []).map(String));
  set.add(String(userId));
  return _patch(s.matchupKey, { responded: [...set] });
}

function markFinished(channelId, extra = {}) {
  const s = findByChannelId(channelId);
  if (!s) return null;
  return _patch(s.matchupKey, { status: SESSION_STATUS.FINISHED, finishedAt: Date.now(), ...extra });
}

function markDeleted(channelId) {
  const s = findByChannelId(channelId);
  if (!s) return null;
  return _patch(s.matchupKey, { status: SESSION_STATUS.DELETED, deletedAt: Date.now() });
}

/**
 * Copy the live in-memory projection (responded / finished / reminderCount) back into the durable store.
 * Called from the state persist loop so /respond and reminder ticks never need to know about persistence.
 */
function syncFromState(state) {
  if (!state?.games || typeof state.games.entries !== 'function') return 0;
  const store = _load();
  let changed = 0;
  for (const [channelId, game] of state.games.entries()) {
    const s = game?.matchupKey ? store.sessions[game.matchupKey] : Object.values(store.sessions).find(x => x.channelId === String(channelId));
    if (!s) continue;
    const responded = [...(game.responded instanceof Set ? game.responded : (game.responded || []))].map(String);
    const status = game.finished ? SESSION_STATUS.FINISHED : (s.status === SESSION_STATUS.DELETED ? SESSION_STATUS.DELETED : SESSION_STATUS.ACTIVE);
    const reminderCount = Number(game.reminderCount || 0);
    if (responded.join(',') !== (s.responded || []).join(',') || status !== s.status || reminderCount !== s.reminderCount) {
      store.sessions[s.matchupKey] = {
        ...s, responded, status, reminderCount,
        finishedAt: status === SESSION_STATUS.FINISHED ? (s.finishedAt || Date.now()) : s.finishedAt,
        updatedAt: Date.now(),
      };
      changed++;
    }
  }
  if (changed) _save(store);
  return changed;
}

/** Drop finished/deleted sessions older than the retention window. Keeps the file bounded. */
function pruneStale(now = Date.now()) {
  const store = _load();
  let removed = 0;
  for (const [key, s] of Object.entries(store.sessions)) {
    const done = s.status !== SESSION_STATUS.ACTIVE;
    const ts = Number(s.finishedAt || s.deletedAt || s.updatedAt || s.createdAt || 0);
    if (done && ts && now - ts > RETENTION_MS) { delete store.sessions[key]; removed++; }
  }
  if (removed) _save(store);
  return removed;
}

/**
 * Restart recovery: rebuild state.games from the durable store for channels that still exist and re-arm
 * reminder/deadline handling through the supplied callback. Sessions whose channel is gone are marked deleted.
 * @param {import('discord.js').Guild} guild
 * @param {object} state
 * @param {(guild, channelId, gameData) => void} armReminders  gameChannelService reminder re-arm hook
 */
function rehydrate(guild, state, armReminders) {
  if (!guild || !state?.games) return { restored: 0, missing: 0, finished: 0 };
  const store = _load();
  let restored = 0, missing = 0, finished = 0, changed = false;
  for (const s of Object.values(store.sessions)) {
    if (s.status !== SESSION_STATUS.ACTIVE) continue;
    if (require('./spaceContext').current() && s.leagueId !== require('./spaceContext').current()) continue;
    if (s.guildId && String(s.guildId) !== String(guild.id)) continue;
    const channel = guild.channels.cache.get(s.channelId);
    if (!channel) {
      s.status = SESSION_STATUS.DELETED; s.deletedAt = Date.now(); s.updatedAt = Date.now();
      missing++; changed = true;
      continue;
    }
    if (state.games.has(s.channelId)) continue; // already live in memory (double-boot guard)
    const gameData = {
      week: s.week, team1: s.team1, team2: s.team2, user1Id: s.user1Id, user2Id: s.user2Id,
      isPrimetime: !!s.isPrimetime, isGotw: !!s.isGotw, isOverseas: !!s.isOverseas,
      responded: new Set((s.responded || []).map(String)),
      reminderCount: Number(s.reminderCount || 0),
      finished: false,
      createdAt: Number(s.createdAt || Date.now()),
      reminderId: null,
      score: null,
      gameKey: s.gameKey || 'madden',
      leagueTag: s.leagueTag || '',
      matchupKey: s.matchupKey,
      leagueId: s.leagueId,
      provider: s.provider,
      seasonId: s.seasonId,
    };
    state.games.set(s.channelId, gameData);
    if (typeof armReminders === 'function') {
      try { armReminders(guild, s.channelId, gameData); } catch (e) { log.warn(`re-arm failed for ${s.channelId}: ${e.message}`); }
    }
    if (Date.now() >= Number(s.deadlineAt || 0) && s.deadlineAt) finished++; // deadline already passed — armReminders handles expiry on first tick
    restored++;
  }
  if (changed) _save(store);
  log.info(`rehydrate: restored=${restored} missingChannel=${missing} pastDeadline=${finished}`);
  return { restored, missing, finished };
}

function getStatusSummary() {
  const all = Object.values(_load().sessions);
  return {
    total: all.length,
    active: all.filter(s => s.status === SESSION_STATUS.ACTIVE).length,
    finished: all.filter(s => s.status === SESSION_STATUS.FINISHED).length,
    deleted: all.filter(s => s.status === SESSION_STATUS.DELETED).length,
  };
}

module.exports = {
  clearGuild,
  FILE,
  SESSION_STATUS,
  TWENTY_FOUR_HOURS,
  SEVEN_HOURS,
  buildMatchupKeyFor,
  registerSession,
  findByMatchupKey,
  findByChannelId,
  listActive,
  markResponded,
  markFinished,
  markDeleted,
  syncFromState,
  pruneStale,
  rehydrate,
  getStatusSummary,
};
