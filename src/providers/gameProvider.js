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

const { CAPABILITY_KEYS, PROVIDER_INTERFACE, unsupported, notConfigured, normalizeCapabilities, createProvider } = require('./providerContract');

// ── Registry facade ───────────────────────────────────────────────────────────
const registry = require('./providerRegistry');
const bootstrapper = require('./providerBootstrap');
function register(provider) { return registry.register(provider); }
function bootstrap() { return bootstrapper.bootstrap(); }
function get(key) { bootstrap(); return registry.get(key); }
function list() { bootstrap(); return registry.list(); }

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
