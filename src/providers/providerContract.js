/* Provider contract primitives. Must not import concrete providers. */
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


module.exports = { CAPABILITY_KEYS, PROVIDER_INTERFACE, unsupported, notConfigured, normalizeCapabilities, createProvider };
