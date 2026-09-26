/*
 * NAVIGATION HEADER
 * FILE: src/services/providerService.js
 * LAYER: Service layer (V202)
 * PURPOSE: Service-layer entry point to the provider adapter registry (src/providers/gameProvider). Commands and
 *          handlers call this instead of reaching into src/providers directly: which provider is active, what it
 *          can do, whether it is healthy, and selecting the provider for the league runtime.
 * LOOK HERE FIRST WHEN DEBUGGING: getActiveProvider(), setActiveProvider(), describeProviders().
 * RELATED FLOW: advanceEngine, leagueSyncService, /game-channels sync-status.
 * NOTE: Selecting a provider never enables a control capability the provider does not declare.
 */

'use strict';

const registry = require('../providers/gameProvider');
const runtime = require('../league/runtimeService');

function getActiveProvider() { return registry.resolveActive(); }

function describeProviders() {
  registry.bootstrap();
  return registry.list();
}

/** Pin the league runtime to a registered provider key (null = follow liveSync config). */
function setActiveProvider(key) {
  registry.bootstrap();
  if (key == null) { runtime.patchRuntime({ providerId: null }); return { ok: true, provider: getActiveProvider().describe() }; }
  const p = registry.get(key);
  if (!p) return { ok: false, reason: 'unknown-provider', known: registry.list().map(x => x.key) };
  runtime.patchRuntime({ providerId: p.key });
  return { ok: true, provider: p.describe() };
}

async function healthCheck() {
  const p = getActiveProvider();
  const h = await p.healthCheck();
  return { provider: p.key, ...h };
}

module.exports = { getActiveProvider, describeProviders, setActiveProvider, healthCheck };
