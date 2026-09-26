/*
 * NAVIGATION HEADER
 * FILE: src/league/automationPolicyService.js
 * LAYER: League control plane (V202)
 * PURPOSE: Commissioner automation settings (spec §12/§14 AutomationPolicy): enabled, intervalHours (48 default),
 *          timezone, precheckPolicy, exceptionPolicy, shadowMode. Persisted to automationPolicy.json.
 *          Owner of enabled/intervalHours for the ADVANCE ENGINE. The legacy weeklyAutomation settings
 *          (mode/advanceHours) are mirrored on every save so existing readers (schedule embed footer,
 *          /game-channels status, dashboard) stay consistent.
 * LOOK HERE FIRST WHEN DEBUGGING: getPolicy(), setPolicy(), syncFromWeeklySettings().
 * RELATED FLOW: advanceEngine, /game-channels advance-setup, actions catalog set_automation_policy.
 * NOTE: "48 hours" is a default policy value, never hard-coded in engine logic (spec §19).
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');

const FILE = 'automationPolicy.json';
const DEFAULTS = Object.freeze({
  schema: 'nofunleague-automation-policy',
  version: 1,
  enabled: false,
  intervalHours: 48,
  timezone: 'America/Los_Angeles',
  shadowMode: true,               // records decisions, performs no provider control / publish until turned off (spec §31)
  precheckPolicy: Object.freeze({
    blockOnActiveGame: true,      // never advance while a tracked game is unfinished (spec §21 failsafe)
    requireAllGamesFinal: false,  // stricter: require a recorded result for every matchup
    requireProviderHealthy: true,
    approachingWindowHours: 6,    // DEADLINE_APPROACHING notice window
  }),
  exceptionPolicy: Object.freeze({
    maxRetries: 5,
    retryBackoffMinutes: 15,
    alertCommissionerOnHold: true,
  }),
  notifyChannelKey: 'commishHub', // channelResolver key; falls back to adminHq
  updatedAt: null,
  updatedBy: null,
});

const VALID_KEYS = new Set(['enabled', 'intervalHours', 'timezone', 'shadowMode', 'precheckPolicy', 'exceptionPolicy', 'notifyChannelKey', 'updatedBy']);

function _clampHours(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(24 * 14, Math.max(1, Math.round(n)));
}

function getPolicy() {
  const raw = loadJson(FILE, null);
  if (!raw || typeof raw !== 'object') {
    // Migration bridge: derive from legacy weeklyAutomation settings until the commissioner runs advance-setup.
    let legacy = null;
    try { legacy = require('../services/weeklyAutomationService').getWeeklySettings(); } catch {}
    return {
      ...DEFAULTS,
      precheckPolicy: { ...DEFAULTS.precheckPolicy },
      exceptionPolicy: { ...DEFAULTS.exceptionPolicy },
      enabled: legacy ? legacy.mode === 'automatic' : false,
      intervalHours: legacy ? _clampHours(legacy.advanceHours, 48) : 48,
      source: 'legacy-weekly-settings',
    };
  }
  return {
    ...DEFAULTS,
    ...raw,
    enabled: !!raw.enabled,
    intervalHours: _clampHours(raw.intervalHours, DEFAULTS.intervalHours),
    shadowMode: raw.shadowMode !== false,
    precheckPolicy: { ...DEFAULTS.precheckPolicy, ...(raw.precheckPolicy || {}) },
    exceptionPolicy: { ...DEFAULTS.exceptionPolicy, ...(raw.exceptionPolicy || {}) },
    source: 'policy-file',
  };
}

/**
 * Save policy fields. Unknown keys are rejected (structured), nested policies are merged.
 * Mirrors enabled/intervalHours into weeklyAutomation settings (legacy readers).
 */
function setPolicy(patch = {}, actor = null) {
  const unknown = Object.keys(patch).filter(k => !VALID_KEYS.has(k));
  if (unknown.length) return { ok: false, reason: 'unknown-fields', fields: unknown };
  const cur = getPolicy();
  const next = {
    ...cur,
    ...patch,
    enabled: patch.enabled != null ? !!patch.enabled : cur.enabled,
    intervalHours: patch.intervalHours != null ? _clampHours(patch.intervalHours, cur.intervalHours) : cur.intervalHours,
    shadowMode: patch.shadowMode != null ? !!patch.shadowMode : cur.shadowMode,
    precheckPolicy: { ...cur.precheckPolicy, ...(patch.precheckPolicy || {}) },
    exceptionPolicy: { ...cur.exceptionPolicy, ...(patch.exceptionPolicy || {}) },
    timezone: String(patch.timezone || cur.timezone || DEFAULTS.timezone),
    updatedAt: Date.now(),
    updatedBy: actor ? String(actor) : cur.updatedBy || null,
  };
  delete next.source;
  saveJsonDebounced(FILE, next, 200);
  try {
    const weekly = require('../services/weeklyAutomationService');
    weekly.saveWeeklySettings({ mode: next.enabled ? 'automatic' : 'manual', advanceHours: next.intervalHours });
  } catch {}
  return { ok: true, policy: { ...next, source: 'policy-file' } };
}

/** Called after the legacy /game-channels automation command so both stores agree. */
function syncFromWeeklySettings(weekly) {
  if (!weekly) return null;
  const raw = loadJson(FILE, null);
  if (!raw || typeof raw !== 'object') return null; // no policy file yet → getPolicy() already derives from legacy
  const next = { ...raw, enabled: weekly.mode === 'automatic', intervalHours: _clampHours(weekly.advanceHours, raw.intervalHours || 48), updatedAt: Date.now() };
  saveJsonDebounced(FILE, next, 200);
  return next;
}

function describePolicy(policy = getPolicy()) {
  return [
    `Enabled: **${policy.enabled ? 'yes' : 'no'}** | Interval: **${policy.intervalHours}h** | Timezone: **${policy.timezone}**`,
    `Mode: **${policy.shadowMode ? 'SHADOW (records decisions, no advance/publish)' : 'LIVE'}**`,
    `Prechecks: block on active game=${policy.precheckPolicy.blockOnActiveGame ? 'yes' : 'no'}, require all results=${policy.precheckPolicy.requireAllGamesFinal ? 'yes' : 'no'}, provider healthy=${policy.precheckPolicy.requireProviderHealthy ? 'yes' : 'no'}`,
    `Retries: max ${policy.exceptionPolicy.maxRetries}, backoff ${policy.exceptionPolicy.retryBackoffMinutes}m`,
  ].join('\n');
}

module.exports = { FILE, DEFAULTS, getPolicy, setPolicy, syncFromWeeklySettings, describePolicy };
