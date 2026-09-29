/*
 * NAVIGATION HEADER
 * FILE: src/providers/customEndpoint.js
 * LAYER: Provider adapter layer (V202)
 * PURPOSE: Generic JSON-endpoint data provider factory wrapping the legacy liveSync env/config contract
 *          (MYBOT_*_SYNC_URL / MYBOT_*_SYNC_TOKEN or liveSync.endpointUrl). Fetches go through utils/httpIntake
 *          (timeout, size cap, https, no private destinations). Data only — no control capability.
 * LOOK HERE FIRST WHEN DEBUGGING: createEndpointProvider(), _target().
 * RELATED FLOW: liveSyncService (legacy generic sync), providers/madden, providers/nba2k.
 */

'use strict';

const { createProvider, notConfigured } = require('./providerContract');
const { fetchExternal } = require('../utils/httpIntake');

function _target(key, envUrl, envToken) {
  let cfg = null;
  try { cfg = require('../services/liveSyncService').getLiveSyncConfig(); } catch {}
  let managed = null;
  try {
    const leagueId = require('../league/spaceContext').current();
    if (leagueId) managed = require('../services/providerConnectionService').getConnection(leagueId, key);
  } catch {}
  let managedSecret = '';
  if (managed) { try { managedSecret = require('../services/providerConnectionService').getSecret(managed.leagueId, key) || ''; } catch {} }
  const url = managed?.endpointUrl || (cfg && cfg.provider === key && cfg.endpointUrl) || process.env[envUrl] || '';
  const token = managedSecret || process.env[envToken] || '';
  return { url, token, managed };
}

async function _fetchSnapshot(key, envUrl, envToken) {
  const { url, token, managed } = _target(key, envUrl, envToken);
  if (!url) return notConfigured(key, [envUrl]);
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (managed?.config?.etag) headers['If-None-Match'] = managed.config.etag;
  if (managed?.config?.lastModified) headers['If-Modified-Since'] = managed.config.lastModified;
  const res = await fetchExternal({ url, headers, parse: 'json', expectedContentTypes: ['application/json', 'text/json', 'application/*+json', 'text/plain'], timeoutMs: 20000, acceptStatuses:[304] });
  if (!res.ok) return { ok: false, reason: `fetch-${res.reason}`, providerId: key, status: res.status || null, retryAfter: res.headers?.retryAfter || null };
  if (res.notModified) {
    const prior = require('../services/providerDataSnapshotService').getStage(key, 'endpoint_snapshot');
    if (!prior) return { ok:false, reason:'not-modified-without-baseline', providerId:key, status:304 };
    const registry = require('../services/scheduleRegistryService');
    return { ok:true, providerId:key, snapshot:registry.normalizeImportPayload(prior.data), revision:String(prior.meta?.revision || prior.updatedAt), raw:prior.data, notModified:true };
  }
  const registry = require('../services/scheduleRegistryService');
  let normalized;
  try { normalized = registry.normalizeImportPayload(res.data); } catch (e) { return { ok:false, reason:`schema-mismatch:${e.message}`, providerId:key, status:res.status }; }
  const revision = String(res.data?.revision || res.data?.exportedAt || res.headers?.etag || res.headers?.lastModified || Date.now());
  require('../services/providerDataSnapshotService').saveStage(key, 'endpoint_snapshot', res.data, { revision, etag:res.headers?.etag || null, lastModified:res.headers?.lastModified || null });
  if (managed) {
    try {
      require('../services/providerConnectionService').upsertConnection({ ...managed, config:{ ...(managed.config||{}), etag:res.headers?.etag || managed.config?.etag || null, lastModified:res.headers?.lastModified || managed.config?.lastModified || null } });
    } catch {}
  }
  return { ok: true, providerId: key, snapshot: normalized, revision, raw: res.data, etag:res.headers?.etag || null, lastModified:res.headers?.lastModified || null };
}

function createEndpointProvider({ key, label, envUrl, envToken }) {
  return createProvider({
    key,
    label,
    verified: () => !!_target(key, envUrl, envToken).url,
    capabilities: { dataImport: true, readSchedule: true, readLeagueState: true, readStats: false, webhook: false, advanceWeek: false, markReady: false, autoPilot: false, forceResult: false },
    methods: {
      async healthCheck() {
        const { url } = _target(key, envUrl, envToken);
        if (!url) return { ok: false, providerId: key, healthy: false, reason: 'not-configured', missing: [envUrl] };
        const r = await _fetchSnapshot(key, envUrl, envToken);
        return r.ok ? { ok:true, providerId:key, healthy:true, configured:true, notModified:!!r.notModified } : { ok:false, providerId:key, healthy:false, reason:r.reason, status:r.status || null, retryAfter:r.retryAfter || null };
      },
      async getCurrentWeek() {
        const r = await _fetchSnapshot(key, envUrl, envToken);
        if (!r.ok) return r;
        return { ok: true, providerId: key, week: r.snapshot.currentWeek != null ? Number(r.snapshot.currentWeek) : null, revision: r.revision };
      },
      async fetchLeagueSnapshot() { return _fetchSnapshot(key, envUrl, envToken); },
      async fetchWeek(ctx, week) {
        const r = await _fetchSnapshot(key, envUrl, envToken);
        if (!r.ok) return r;
        const games = r.snapshot.weeks?.[String(week)] || [];
        if (!games.length) return { ok: false, reason: 'week-not-in-snapshot', providerId: key, week: Number(week) };
        return { ok: true, providerId: key, week: Number(week), games, revision: r.revision };
      },
      async ingestImport(input) {
        const registry = require('../services/scheduleRegistryService');
        const reg = registry.importScheduleObject(input?.payload ?? input, { source: key });
        return { ok: true, providerId: key, currentWeek: reg.currentWeek, storedWeeks: Object.keys(reg.weeks || {}).length, revision: String(reg.lastImportAt) };
      },
    },
  });
}

module.exports = { createEndpointProvider };
