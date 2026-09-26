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

const { createProvider, notConfigured } = require('./gameProvider');
const { fetchExternal } = require('../utils/httpIntake');

function _target(key, envUrl, envToken) {
  let cfg = null;
  try { cfg = require('../services/liveSyncService').getLiveSyncConfig(); } catch {}
  const url = (cfg && cfg.provider === key && cfg.endpointUrl) || process.env[envUrl] || '';
  const token = process.env[envToken] || '';
  return { url, token };
}

async function _fetchSnapshot(key, envUrl, envToken) {
  const { url, token } = _target(key, envUrl, envToken);
  if (!url) return notConfigured(key, [envUrl]);
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchExternal({ url, headers, parse: 'json', expectedContentTypes: ['application/json', 'text/json', 'application/*+json', 'text/plain'], timeoutMs: 20000 });
  if (!res.ok) return { ok: false, reason: `fetch-${res.reason}`, providerId: key, status: res.status || null };
  const registry = require('../services/scheduleRegistryService');
  const normalized = registry.normalizeImportPayload(res.data);
  return { ok: true, providerId: key, snapshot: normalized, revision: String(res.data?.revision || res.data?.exportedAt || Date.now()), raw: res.data };
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
        return { ok: true, providerId: key, healthy: true, configured: true };
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
