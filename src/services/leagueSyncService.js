/*
 * NAVIGATION HEADER
 * FILE: src/services/leagueSyncService.js
 * LAYER: Service layer (V202)
 * PURPOSE: Orchestrates data sync for /game-channels sync-now and sync-status. Legacy generic endpoint providers
 *          keep using liveSyncService.syncNow (unchanged behavior: import → load current week → optional schedule
 *          post + idempotent projection). Import-based providers (companion_export, neonsportz) process their
 *          queued ImportRuns through the provider adapter. Sync NEVER advances the league — it only refreshes data;
 *          the advance engine decides whether a new week may be published.
 * LOOK HERE FIRST WHEN DEBUGGING: syncNow(), getSyncStatus(), processQueuedImports().
 */

'use strict';

const liveSync = require('./liveSyncService');
const providerService = require('./providerService');
const importRuns = require('../league/importRunService');
const { makeLogger } = require('../utils/logger');

const log = makeLogger('leagueSync');
const IMPORT_PROVIDERS = new Set(['companion_export', 'neonsportz']);

function _leagueId() {
  try { const id = require('../league/spaceContext').current(); if (id) return String(id); } catch {}
  try { const rows = require('./activeLeagueService').listProviderTargets(); if (rows.length === 1) return String(rows[0].id); } catch {}
  return 'default';
}

async function processQueuedImports(providerKey) {
  const provider = require('../providers/gameProvider').get(providerKey);
  if (!provider) return { ok: false, reason: 'unknown-provider' };
  const queued = await importRuns.listRecoverableDurable(providerKey, [importRuns.IMPORT_STATUS.RECEIVED, importRuns.IMPORT_STATUS.QUEUED, importRuns.IMPORT_STATUS.PARSING]);
  const out = [];
  for (const run of queued.reverse()) {
    const r = await provider.ingestImport({ importId: run.id });
    if (r?.ok && providerKey !== 'companion_export') await importRuns.markStatusDurable(run.id, importRuns.IMPORT_STATUS.APPLIED, { currentWeek: r.currentWeek ?? null });
    if (!r?.ok && providerKey !== 'companion_export') await importRuns.markStatusDurable(run.id, importRuns.IMPORT_STATUS.FAILED, { error: r?.reason || 'ingest-failed' });
    out.push({ importId: run.id, ok: !!r?.ok, reason: r?.reason || null });
  }
  return { ok: true, processed: out.length, results: out };
}

async function syncNow(guild, state, helpers = {}) {
  const provider = providerService.getActiveProvider();
  const orchestrator = require('./providerSyncOrchestrator');
  return orchestrator.run({
    guild, state, provider, trigger: helpers.trigger || 'manual',
    processImports: IMPORT_PROVIDERS.has(provider.key)
      ? async () => {
          const r = await processQueuedImports(provider.key);
          log.info(`sync-now provider=${provider.key} processed=${r.processed || 0}`);
          return { ok: r.ok, mode: 'import-provider', provider: provider.key, ...r };
        }
      : null,
    pullSync: async () => {
      const r = await liveSync.syncNow(guild, state, state.players, helpers);
      return { mode: 'legacy-live-sync', provider: r.provider || provider.key, ...r };
    },
  });
}


async function getSyncStatus() {
  const cfg = liveSync.getLiveSyncConfig();
  const active = providerService.getActiveProvider();
  const health = await providerService.healthCheck(active.key).catch(e => ({ ok: false, reason: e.message }));
  return {
    liveSync: { sourceMode: cfg.sourceMode, provider: cfg.provider, lastSyncAt: cfg.lastSyncAt, lastSyncStatus: cfg.lastSyncStatus, lastSyncSummary: cfg.lastSyncSummary },
    activeProvider: active.describe(),
    health,
    imports: importRuns.getStatusSummary(),
    recentImports: importRuns.listRecent(5).map(r => ({ id: r.id, provider: r.provider, status: r.status, receivedAt: r.receivedAt, error: r.error || null, duplicates: r.duplicateDeliveries || 0 })),
    connections: require('./providerConnectionService').listConnections(_leagueId()),
    recentSyncRuns: require('./providerSyncRunService').list({ leagueId:_leagueId(), limit:5 }),
  };
}

module.exports = { syncNow, getSyncStatus, processQueuedImports };
