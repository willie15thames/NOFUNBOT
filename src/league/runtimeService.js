/*
 * NAVIGATION HEADER
 * FILE: src/league/runtimeService.js
 * LAYER: League control plane (V202)
 * PURPOSE: Durable LeagueRuntime record (spec §14): providerId, sourceLeagueId, sourceWeek, workflowWeek, state,
 *          nextAdvanceAt, cycleId, hold, retry bookkeeping. Persisted to leagueRuntime.json (jsonStore → BotKv
 *          Postgres write-through) so the advance deadline and state survive restart/deploy (directive rule 19).
 *          Source week and workflow week are SEPARATE values (rule 22) and are never conflated here.
 * LOOK HERE FIRST WHEN DEBUGGING: getRuntime(), patchRuntime(), transition(), ADVANCE_STATE.
 * RELATED FLOW: advanceEngine (only writer of state transitions), automationPolicyService, actions catalog
 *               (request_league_advance / set_automation_policy), /game-channels advance-* subcommands.
 * NOTE: No timer handles are stored here — only timestamps.
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const { makeLogger } = require('../utils/logger');

const log = makeLogger('leagueRuntime');
const FILE = 'leagueRuntime.json';

const ADVANCE_STATE = Object.freeze({
  IDLE: 'IDLE',                                   // no league / automation disabled
  WEEK_ACTIVE: 'WEEK_ACTIVE',
  DEADLINE_APPROACHING: 'DEADLINE_APPROACHING',
  PRE_ADVANCE_CHECK: 'PRE_ADVANCE_CHECK',
  READY_TO_ADVANCE: 'READY_TO_ADVANCE',
  REQUESTING_GAME_ADVANCE: 'REQUESTING_GAME_ADVANCE',
  AWAITING_SOURCE_ADVANCE: 'AWAITING_SOURCE_ADVANCE',
  SOURCE_ADVANCED: 'SOURCE_ADVANCED',
  IMPORT_PENDING: 'IMPORT_PENDING',
  IMPORT_COMPLETE: 'IMPORT_COMPLETE',
  VALIDATING_NEW_WEEK: 'VALIDATING_NEW_WEEK',
  PUBLISHING_NEW_WEEK: 'PUBLISHING_NEW_WEEK',
  RETRY_WAIT: 'RETRY_WAIT',
  RECOVERY_REQUIRED: 'RECOVERY_REQUIRED',
  HOLD: 'HOLD',
});

// Legal transitions (spec §11). Any state may go to RETRY_WAIT, RECOVERY_REQUIRED or HOLD; HOLD/RETRY resume to `resumeState`.
const TRANSITIONS = Object.freeze({
  IDLE: ['WEEK_ACTIVE'],
  WEEK_ACTIVE: ['DEADLINE_APPROACHING', 'PRE_ADVANCE_CHECK', 'IDLE'],
  DEADLINE_APPROACHING: ['PRE_ADVANCE_CHECK', 'WEEK_ACTIVE', 'IDLE'],
  PRE_ADVANCE_CHECK: ['READY_TO_ADVANCE', 'WEEK_ACTIVE'],
  READY_TO_ADVANCE: ['REQUESTING_GAME_ADVANCE', 'AWAITING_SOURCE_ADVANCE', 'SOURCE_ADVANCED'],
  REQUESTING_GAME_ADVANCE: ['SOURCE_ADVANCED', 'AWAITING_SOURCE_ADVANCE'],
  AWAITING_SOURCE_ADVANCE: ['SOURCE_ADVANCED', 'WEEK_ACTIVE'],
  SOURCE_ADVANCED: ['IMPORT_PENDING'],
  IMPORT_PENDING: ['IMPORT_COMPLETE'],
  IMPORT_COMPLETE: ['VALIDATING_NEW_WEEK'],
  VALIDATING_NEW_WEEK: ['PUBLISHING_NEW_WEEK', 'IMPORT_PENDING'],
  PUBLISHING_NEW_WEEK: ['WEEK_ACTIVE'],
  RETRY_WAIT: [],      // resumes to resumeState
  RECOVERY_REQUIRED: [], // resumes to resumeState after commissioner action
  HOLD: [],            // resumes to resumeState
});
const ALWAYS_ALLOWED = new Set(['RETRY_WAIT', 'RECOVERY_REQUIRED', 'HOLD']);
const MID_CYCLE_STATES = new Set([
  'PRE_ADVANCE_CHECK', 'READY_TO_ADVANCE', 'REQUESTING_GAME_ADVANCE', 'AWAITING_SOURCE_ADVANCE',
  'SOURCE_ADVANCED', 'IMPORT_PENDING', 'IMPORT_COMPLETE', 'VALIDATING_NEW_WEEK', 'PUBLISHING_NEW_WEEK',
]);

const DEFAULTS = Object.freeze({
  schema: 'nofunleague-league-runtime',
  version: 1,
  leagueId: 'default',
  providerId: null,          // resolved lazily from liveSync config / policy when null
  sourceLeagueId: null,
  sourceSeasonId: null,
  sourceWeek: null,          // last provider-verified week
  sourceRevision: null,      // provider revision / import marker for the verified week
  workflowWeek: null,        // week the bot is operating (mirrors scheduleState.week after publish)
  state: ADVANCE_STATE.IDLE,
  resumeState: null,         // state to return to after HOLD / RETRY_WAIT / RECOVERY_REQUIRED
  nextAdvanceAt: null,
  deadlineArmedAt: null,
  cycleId: null,
  expectedSourceWeek: null,  // source week recorded before a control request (source week lock)
  targetWeek: null,
  retryCount: 0,
  nextRetryAt: null,
  hold: null,                // { reason, by, at }
  lastError: null,
  lastVerifiedAt: null,
  lastImportAt: null,
  lastPublishedWeek: null,
  lastTickAt: null,
  updatedAt: null,
});

function getRuntime() {
  const raw = loadJson(FILE, null);
  const merged = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!Object.values(ADVANCE_STATE).includes(merged.state)) merged.state = ADVANCE_STATE.IDLE;
  return merged;
}

function saveRuntime(next) {
  const merged = { ...getRuntime(), ...(next || {}), updatedAt: Date.now() };
  saveJsonDebounced(FILE, merged, 200);
  return merged;
}

function patchRuntime(patch) {
  return saveRuntime(patch);
}

function isTransitionAllowed(from, to) {
  if (from === to) return true;
  if (ALWAYS_ALLOWED.has(to)) return true;
  return (TRANSITIONS[from] || []).includes(to);
}

/**
 * Transition the runtime state. Illegal transitions are rejected (returns { ok:false }) instead of thrown so the
 * engine can record them as RECOVERY_REQUIRED conditions.
 */
function transition(to, patch = {}) {
  const rt = getRuntime();
  const from = rt.state;
  if (!isTransitionAllowed(from, to)) {
    log.warn(`illegal transition ${from} → ${to} rejected`);
    return { ok: false, from, to, runtime: rt };
  }
  const next = { ...patch, state: to };
  if (ALWAYS_ALLOWED.has(to) && !ALWAYS_ALLOWED.has(from)) next.resumeState = from;
  const saved = saveRuntime(next);
  if (from !== to) log.info(`state ${from} → ${to}${patch.cycleId ? ` cycle=${patch.cycleId}` : ''}`);
  return { ok: true, from, to, runtime: saved };
}

/** Leave HOLD / RETRY_WAIT / RECOVERY_REQUIRED and return to the recorded resume state (or WEEK_ACTIVE). */
function resumeFromPause(patch = {}) {
  const rt = getRuntime();
  const target = rt.resumeState && rt.resumeState !== rt.state ? rt.resumeState : ADVANCE_STATE.WEEK_ACTIVE;
  const saved = saveRuntime({ ...patch, state: target, resumeState: null, hold: null });
  log.info(`resumed ${rt.state} → ${target}`);
  return saved;
}

function isMidCycle(state = getRuntime().state) {
  return MID_CYCLE_STATES.has(state);
}

function resetRuntime(reason = 'reset') {
  log.warn(`runtime reset (${reason})`);
  const fresh = { ...DEFAULTS, updatedAt: Date.now() };
  saveJsonDebounced(FILE, fresh, 200);
  return fresh;
}

module.exports = {
  FILE,
  DEFAULTS,
  ADVANCE_STATE,
  TRANSITIONS,
  MID_CYCLE_STATES,
  getRuntime,
  saveRuntime,
  patchRuntime,
  transition,
  isTransitionAllowed,
  resumeFromPause,
  isMidCycle,
  resetRuntime,
};
