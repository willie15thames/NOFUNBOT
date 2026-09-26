/*
 * NAVIGATION HEADER
 * FILE: src/state.js
 * LAYER: Project file
 * PURPOSE: Owns or coordinates application state and source-of-truth decisions.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
// src/state.js
// All shared mutable state in one place. No circular deps.
// Loaded once at startup by index.js. Every service reads/writes from here.
const { loadJson }         = require('./storage/jsonStore');
const { DEFAULT_OPEN_TEAMS } = require('./config/teams');
const { COMMISSIONER_IDS }   = require('./config/env');
const { DEFAULT_RULE_TEXT }  = require('./config/rules');

// ── Players ──────────────────────────────────────────────────
const players        = new Map(); // norm(baseTeam) → playerRecord
const teamLookup     = new Map(); // norm(team) → playerRecord
const userTeamLookup = new Map(); // userId → playerRecord
const rosterOverrides = new Map();

// ── Game state ───────────────────────────────────────────────
const games          = new Map(); // channelId → gameData
const ocrGameResults = [];

// ── Pending actions ──────────────────────────────────────────
// FIX: Load from disk so pending trades/offenses/boosts survive restarts.
// Previously these were empty Maps — any restart wiped all pending actions.
const _savedTrades   = loadJson('pendingTrades.json', {});
const _savedBoosts   = loadJson('pendingAttrBoosts.json', {});
const _savedOffenses = loadJson('pendingOffenses.json', {});

const pendingTrades     = new Map(Object.entries(_savedTrades));
const pendingAttrBoosts = new Map(Object.entries(_savedBoosts));
const pendingOffenses   = new Map(Object.entries(_savedOffenses));
const offenseCooldowns  = new Map();
const spamTracker       = new Map();

// Auto-save pending state every 30 seconds (debounced writes to disk + DB)
const { saveJsonDebounced } = require('./storage/jsonStore');
// V202 (BUG-007): timer handles are process-local and never persisted — strip them before serialising.
const _TIMER_FIELDS = new Set(['releaseTimerId', 'potwTimerId', 'timerId', 'initialTimerId']);
function _withoutTimers(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (!_TIMER_FIELDS.has(k)) out[k] = v;
  return out;
}
function _persistPendingState() {
  saveJsonDebounced('pendingTrades.json', Object.fromEntries(pendingTrades), 5000);
  saveJsonDebounced('pendingAttrBoosts.json', Object.fromEntries(pendingAttrBoosts), 5000);
  saveJsonDebounced('pendingOffenses.json', Object.fromEntries(pendingOffenses), 5000);
  // V202 (BUG-007): state that previously had no writer (or was loaded but never saved).
  // module.exports is read (not the local bindings) because services reassign state.hubWeeklyData / state.scheduleState.
  const ex = module.exports;
  saveJsonDebounced('hubWeeklyData.json', _withoutTimers(ex.hubWeeklyData), 5000);
  saveJsonDebounced('rewardHistory.json', {
    potwHistory: ex.potwHistory, yearlyAwardHistory: ex.yearlyAwardHistory, superbowlHistory: ex.superbowlHistory,
    streamMilestones: ex.streamMilestones, currentStatLeaders: ex.currentStatLeaders || null,
  }, 5000);
  saveJsonDebounced('scheduleStateRuntime.json', { week: ex.scheduleState?.week ?? null, pinnedMsgId: ex.scheduleState?.pinnedMsgId || null, lastPosted: ex.scheduleState?.lastPosted || null }, 5000);
  try { require('./league/gameSessionService').syncFromState(ex); } catch {}
}
setInterval(_persistPendingState, 30_000).unref?.();

// ── Counters ──────────────────────────────────────────────────
// FIX: Resume counters from highest loaded ID to prevent collisions after restart
let _tradeId = 1;
let _boostId = 1;
let _offenseId = 1;
// Scan loaded pending state for highest existing IDs
for (const key of pendingTrades.keys()) {
  const m = String(key).match(/TRADE-(\d+)/);
  if (m) _tradeId = Math.max(_tradeId, parseInt(m[1], 10) + 1);
}
for (const key of pendingAttrBoosts.keys()) {
  const m = String(key).match(/boost_(\d+)/);
  if (m) _boostId = Math.max(_boostId, parseInt(m[1], 10) + 1);
}
for (const key of pendingOffenses.keys()) {
  const n = parseInt(key, 10);
  if (!isNaN(n)) _offenseId = Math.max(_offenseId, n + 1);
}
function nextTradeId()  { return `TRADE-${String(_tradeId++).padStart(4,'0')}`; }
function nextBoostId()  { return `boost_${_boostId++}`; }
function nextOffenseId(){ return String(_offenseId++); }

// ── Open team registry ────────────────────────────────────────
// Each entry now includes leagueId to support multiple concurrent leagues.
const _saved = loadJson('openTeamRegistry.json', null);
const openTeamRegistry = _saved ? JSON.parse(JSON.stringify(_saved)) : [];

// ── Active leagues registry ───────────────────────────────────
// Maps leagueId → { leagueTypeId, leagueName, game, isCustom, createdAt, ... }
const _savedLeagues = loadJson('activeLeagues.json', {});
const activeLeagues = new Map(Object.entries(_savedLeagues));

// ── Rewards history ───────────────────────────────────────────
const potwHistory        = [];
const yearlyAwardHistory = [];
const superbowlHistory   = [];
const streamMilestones   = [];
let   currentStatLeaders = null;

// ── League memory ─────────────────────────────────────────────
const leagueMemory = { scores:[], statLines:[], potw:[], superbowls:[], weeklyStats:[], lastUpdated:null };

// ── Hub weekly staging ────────────────────────────────────────
const _savedHub = loadJson('hubWeeklyData.json', null);
let hubWeeklyData = _savedHub || {
  week:null, scores:[], statLines:[], standings:null,
  potwCandidate:null, released:false, releaseTimerId:null, potwTimerId:null,
};

// ── Schedule ──────────────────────────────────────────────────
const scheduleState = { week:null, matchups:[], pinnedMsgId:null, lastPosted:null, timerId:null };

// ── Dynamic admin IDs ─────────────────────────────────────────
const commissionerIds = new Set([...COMMISSIONER_IDS]);

// ── Board message IDs ─────────────────────────────────────────
const boardMessages = {
  welcomeMessageId:null, openTeamsMessageId:null, streamInfoMessageId:null,
  rulesMessageIds:[], teamBuilderMessageId:null, openTeamsChannelId:null,
};
const rewardsBoardIds = { potwMsgId:null, yearlyMsgId:null, streamMsgId:null, sbMsgId:null, statsMsgId:null };

// ── League config (PER-LEAGUE RULES + HISTORY) ────────────────
const leagueConfig = {
  leagueTypeId: null,           // Current league type (e.g., 'madden_franchise')
  leagueName: null,             // Custom league name for searching/documentation (e.g., 'NOFUNLEAGUE S3')
  game: null,                   // Game type (e.g., 'madden', 'nba2k')
  rulesText: DEFAULT_RULE_TEXT, // Full rules text
  rulesUpdatedAt: null,         // Timestamp of last rule update
  rulesHistory: [               // Track all rule changes
    {
      timestamp: Date.now(),
      updatedBy: 'system',
      action: 'initialized',
      oldText: null,
      newText: DEFAULT_RULE_TEXT,
      section: 'All'
    }
  ],
};

// ── Trash talk memory ─────────────────────────────────────────
const trashTalkMemory = { players: new Map(), leagueCulture:[], goldRoasts:[], channelMsgCount: new Map() };

// NOTE: gameInstigatorCooldowns REMOVED in V185 — was orphaned (nothing wrote to it).
// NOTE: aiMentionCooldowns REMOVED in V185 — was exported but had zero callers.
//       AI cooldowns are now handled by personaArbiterService and responseGuardService.

// NOTE: tradeIdCounter and boostIdCounter public getters are REMOVED (SEC-09 fix).
// All callers must use nextTradeId() and nextBoostId() exclusively.
// interactionRouter.js was the only caller — updated to use state.nextTradeId().

/**
 * V202 (BUG-007): startup hydration phase. Runs AFTER initStore() (Postgres cache warm-up) and BEFORE any
 * release/schedule/advance timers are armed (stabilityCoreMicroservice Phase 1). Module-load reads above happen
 * before Postgres warm-up, so on ephemeral disks they can be empty; this re-reads the warmed cache.
 * Merge policy: only fills values that are still empty/default in memory — never overwrites runtime changes.
 * @returns {object} summary of what was hydrated
 */
function hydrateRuntimeState() {
  const { loadJson } = require('./storage/jsonStore');
  const ex = module.exports;
  const out = {};
  const fillMap = (map, file, name) => {
    if (map.size) return;
    const saved = loadJson(file, {}) || {};
    for (const [k, v] of Object.entries(saved)) map.set(k, v);
    if (map.size) out[name] = map.size;
  };
  fillMap(pendingTrades, 'pendingTrades.json', 'pendingTrades');
  fillMap(pendingAttrBoosts, 'pendingAttrBoosts.json', 'pendingAttrBoosts');
  fillMap(pendingOffenses, 'pendingOffenses.json', 'pendingOffenses');
  fillMap(activeLeagues, 'activeLeagues.json', 'activeLeagues');
  for (const key of pendingTrades.keys()) { const m = String(key).match(/TRADE-(\d+)/); if (m) _tradeId = Math.max(_tradeId, parseInt(m[1], 10) + 1); }
  for (const key of pendingAttrBoosts.keys()) { const m = String(key).match(/boost_(\d+)/); if (m) _boostId = Math.max(_boostId, parseInt(m[1], 10) + 1); }
  for (const key of pendingOffenses.keys()) { const n = parseInt(key, 10); if (!isNaN(n)) _offenseId = Math.max(_offenseId, n + 1); }

  if (!openTeamRegistry.length) {
    const reg = loadJson('openTeamRegistry.json', null);
    if (Array.isArray(reg) && reg.length) { openTeamRegistry.push(...JSON.parse(JSON.stringify(reg))); out.openTeamRegistry = reg.length; }
  }

  // leagueConfig: merge persisted fields over defaults (rulesText/rulesHistory only when persisted)
  const savedLc = loadJson('leagueConfig.json', null);
  if (savedLc && typeof savedLc === 'object' && !ex.leagueConfig.leagueTypeId) {
    for (const [k, v] of Object.entries(savedLc)) {
      if (v === undefined) continue;
      if ((k === 'rulesText' || k === 'rulesHistory') && (v == null || (Array.isArray(v) && !v.length) || v === '')) continue;
      ex.leagueConfig[k] = v;
    }
    out.leagueConfig = savedLc.leagueName || savedLc.leagueTypeId || 'loaded';
  }

  // hubWeeklyData (timers are never restored — startHubReleaseTimer re-arms from week)
  const savedHub = loadJson('hubWeeklyData.json', null);
  if (savedHub && typeof savedHub === 'object' && !ex.hubWeeklyData?.week && savedHub.week) {
    ex.hubWeeklyData = { week: null, scores: [], statLines: [], standings: null, potwCandidate: null, released: false, ..._withoutTimers(savedHub), releaseTimerId: null, potwTimerId: null };
    out.hubWeeklyData = savedHub.week;
  } else if (ex.hubWeeklyData) { ex.hubWeeklyData.releaseTimerId = null; ex.hubWeeklyData.potwTimerId = null; }

  // scheduleState from the schedule registry (authoritative current week + matchups)
  if (ex.scheduleState.week == null) {
    const reg = loadJson('scheduleRegistry.json', null);
    const week = reg?.currentWeek != null ? Number(reg.currentWeek) : null;
    const games = week != null && Array.isArray(reg?.weeks?.[String(week)]) ? reg.weeks[String(week)] : [];
    if (week != null && games.length) {
      const rt = loadJson('scheduleStateRuntime.json', null) || {};
      ex.scheduleState.week = week;
      ex.scheduleState.matchups = games;
      if (Number(rt.week) === week) { ex.scheduleState.pinnedMsgId = rt.pinnedMsgId || null; ex.scheduleState.lastPosted = rt.lastPosted || null; }
      out.scheduleState = { week, matchups: games.length };
    }
  }

  // reward history arrays (previously never persisted)
  const rh = loadJson('rewardHistory.json', null);
  if (rh && typeof rh === 'object') {
    for (const key of ['potwHistory', 'yearlyAwardHistory', 'superbowlHistory', 'streamMilestones']) {
      if (!ex[key].length && Array.isArray(rh[key]) && rh[key].length) { ex[key].push(...rh[key]); out[key] = rh[key].length; }
    }
    if (!ex.currentStatLeaders && rh.currentStatLeaders) { ex.currentStatLeaders = rh.currentStatLeaders; out.currentStatLeaders = true; }
  }
  return out;
}

module.exports = {
  hydrateRuntimeState,
  players, teamLookup, userTeamLookup, rosterOverrides,
  games, ocrGameResults,
  pendingTrades, pendingAttrBoosts, pendingOffenses, offenseCooldowns, spamTracker,
  nextTradeId, nextBoostId, nextOffenseId,
  persistPendingState: _persistPendingState, // FIX: allow callers to trigger immediate save
  openTeamRegistry, activeLeagues, commissionerIds,
  potwHistory, yearlyAwardHistory, superbowlHistory, streamMilestones,
  get currentStatLeaders()  { return currentStatLeaders; },
  set currentStatLeaders(v) { currentStatLeaders=v; },
  leagueMemory, hubWeeklyData, scheduleState,
  boardMessages, rewardsBoardIds, leagueConfig,
  trashTalkMemory,
};
