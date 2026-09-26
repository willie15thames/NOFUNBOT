/*
 * NAVIGATION HEADER
 * FILE: src/providers/gameProvider.js
 * LAYER: Provider adapter layer (V202, spec §7/§22)
 * PURPOSE: Formal GameDataProvider / GameControlProvider contract, explicit capability flags, structured
 *          unsupported/not-configured results, and the provider registry. Handlers and the advance engine never
 *          know whether data came from NeonSportz, a Companion export, a custom endpoint or manual import.
 * LOOK HERE FIRST WHEN DEBUGGING: PROVIDER_INTERFACE, createProvider(), registry.resolveActive().
 * RELATED FLOW: providers/local, providers/madden/*, providers/nba2k, league/advanceEngine, liveSyncService.
 * NOTE: A false capability is NEVER worked around (rule 26/47). advanceWeek() on a provider without control
 *       returns { ok:false, reason:'unsupported-capability' } and the engine enters AWAITING_SOURCE_ADVANCE.
 */

'use strict';

const CAPABILITY_KEYS = Object.freeze([
  'dataImport',        // can ingest an import payload / artifact
  'readSchedule',      // can return schedule/matchups for a week
  'readStats',         // can return stat lines
  'readLeagueState',   // can return current source week / season
  'webhook',           // emits import-completion events to our receiver
  'advanceWeek',       // CONTROL: can advance the source franchise week
  'markReady',         // CONTROL
  'autoPilot',         // CONTROL
  'forceResult',       // CONTROL
]);

const PROVIDER_INTERFACE = Object.freeze([
  'getProviderId', 'getCapabilities', 'healthCheck', 'getCurrentWeek', 'fetchLeagueSnapshot', 'fetchWeek',
  'validateSnapshot', 'ingestImport', 'advanceWeek', 'markReady', 'setAutoPilot', 'forceResult', 'getRevision',
]);

function unsupported(providerId, capability, extra = {}) {
  return { ok: false, reason: 'unsupported-capability', providerId, capability, ...extra };
}

function notConfigured(providerId, missing = [], extra = {}) {
  return { ok: false, reason: 'not-configured', providerId, missing: [].concat(missing), ...extra };
}

function normalizeCapabilities(caps = {}) {
  const out = {};
  for (const k of CAPABILITY_KEYS) out[k] = caps[k] === true;
  return Object.freeze(out);
}

/**
 * Build a provider from a partial implementation. Every interface method exists; unimplemented ones return a
 * structured unsupported result. Capabilities are explicit booleans (spec §7).
 */
function createProvider(spec = {}) {
  if (!spec.key) throw new Error('provider spec requires key');
  const key = String(spec.key);
  const caps = normalizeCapabilities(spec.capabilities || {});
  const impl = spec.methods || {};
  const guard = (name, capability) => async (...args) => {
    if (capability && !caps[capability]) return unsupported(key, capability);
    if (typeof impl[name] !== 'function') return unsupported(key, capability || name);
    try { return await impl[name](...args); }
    catch (e) { return { ok: false, reason: 'provider-error', providerId: key, method: name, error: String(e?.message || e) }; }
  };
  return Object.freeze({
    key,
    label: spec.label || key,
    control: !!spec.control,
    getProviderId: () => key,
    getCapabilities: () => caps,
    describe: () => ({ key, label: spec.label || key, capabilities: caps, control: !!spec.control, verified: typeof spec.verified === 'function' ? !!spec.verified() : !!spec.verified }),
    healthCheck: typeof impl.healthCheck === 'function' ? guard('healthCheck', null) : async () => ({ ok: true, providerId: key, healthy: true, note: 'no health probe defined' }),
    getCurrentWeek: guard('getCurrentWeek', 'readLeagueState'),
    fetchLeagueSnapshot: guard('fetchLeagueSnapshot', 'readSchedule'),
    fetchWeek: guard('fetchWeek', 'readSchedule'),
    validateSnapshot: typeof impl.validateSnapshot === 'function' ? guard('validateSnapshot', null) : async snapshot => require('../league/validationService').validateSnapshot(snapshot),
    ingestImport: guard('ingestImport', 'dataImport'),
    advanceWeek: guard('advanceWeek', 'advanceWeek'),
    markReady: guard('markReady', 'markReady'),
    setAutoPilot: guard('setAutoPilot', 'autoPilot'),
    forceResult: guard('forceResult', 'forceResult'),
    getRevision: typeof impl.getRevision === 'function' ? guard('getRevision', null) : async () => ({ ok: true, providerId: key, revision: null }),
  });
}

// ── Registry ──────────────────────────────────────────────────────────────────
const _providers = new Map();

function register(provider) {
  if (!provider?.key) throw new Error('cannot register provider without key');
  _providers.set(provider.key, provider);
  return provider;
}

// get()/list() bootstrap lazily so any entry point (webhook, command, engine) sees the full registry.
function get(key) { bootstrap(); return _providers.get(String(key || '')) || null; }
function list() { bootstrap(); return [..._providers.values()].map(p => p.describe()); }

let _bootstrapped = false;
function bootstrap() {
  if (_bootstrapped) return;
  _bootstrapped = true;
  register(require('./local'));
  for (const p of require('./madden')) register(p);
  for (const p of require('./nba2k')) register(p);
}

/**
 * Resolve the active data provider for the league:
 *   leagueRuntime.providerId → liveSync config (external_sync + provider) → 'local'.
 */
function resolveActive() {
  bootstrap();
  let key = null;
  try { key = require('../league/runtimeService').getRuntime().providerId || null; } catch {}
  if (!key) {
    try {
      const cfg = require('../services/liveSyncService').getLiveSyncConfig();
      key = cfg.sourceMode === 'external_sync' && cfg.provider !== 'off' ? cfg.provider : 'local';
    } catch { key = 'local'; }
  }
  return get(key) || get('local');
}

module.exports = { CAPABILITY_KEYS, PROVIDER_INTERFACE, unsupported, notConfigured, normalizeCapabilities, createProvider, register, get, list, bootstrap, resolveActive };
