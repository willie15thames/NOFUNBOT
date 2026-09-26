/*
 * NAVIGATION HEADER
 * FILE: src/providers/madden/neonsportz/client.js
 * LAYER: Provider adapter layer (V202, spec §9)
 * PURPOSE: NeonSportz DATA provider. Reads go through utils/httpIntake against the configured read endpoint:
 *          NEONSPORTZ_SNAPSHOT_URL (full https URL returning a JSON schedule export) + NEONSPORTZ_API_TOKEN.
 *          Import completion is signalled by the webhook receiver (webhook.js). No franchise-control capability
 *          is documented, so advanceWeek/markReady/autoPilot/forceResult are FALSE (structured unsupported).
 * LOOK HERE FIRST WHEN DEBUGGING: provider.getCurrentWeek(), provider.fetchLeagueSnapshot(), _config().
 * NOTE: Until NEONSPORTZ_SNAPSHOT_URL is set the provider reports not-configured and verified=false.
 */

'use strict';

const { createProvider, notConfigured } = require('../../gameProvider');
const { fetchExternal } = require('../../../utils/httpIntake');
const { mapSnapshot } = require('./mapper');

const KEY = 'neonsportz';

function _config() {
  return {
    snapshotUrl: String(process.env.NEONSPORTZ_SNAPSHOT_URL || '').trim(),
    token: String(process.env.NEONSPORTZ_API_TOKEN || '').trim(),
    leagueId: String(process.env.NEONSPORTZ_LEAGUE_ID || '').trim(),
    webhookSecret: String(process.env.NEONSPORTZ_WEBHOOK_SECRET || '').trim(),
  };
}

async function _fetchSnapshot() {
  const cfg = _config();
  if (!cfg.snapshotUrl) return notConfigured(KEY, ['NEONSPORTZ_SNAPSHOT_URL']);
  const headers = { Accept: 'application/json' };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  const res = await fetchExternal({ url: cfg.snapshotUrl, headers, parse: 'json', expectedContentTypes: ['application/json', 'text/json', 'application/*+json', 'text/plain'], timeoutMs: 20000 });
  if (!res.ok) return { ok: false, reason: `fetch-${res.reason}`, providerId: KEY, status: res.status || null };
  const mapped = mapSnapshot(res.data);
  return { ok: true, providerId: KEY, snapshot: mapped.snapshot, revision: mapped.revision || String(Date.now()), raw: res.data };
}

module.exports = createProvider({
  key: KEY,
  label: 'NeonSportz (Madden data provider; webhook-triggered reads)',
  verified: () => !!_config().snapshotUrl,
  capabilities: { dataImport: true, readSchedule: true, readLeagueState: true, readStats: false, webhook: true, advanceWeek: false, markReady: false, autoPilot: false, forceResult: false },
  methods: {
    async healthCheck() {
      const cfg = _config();
      const missing = [];
      if (!cfg.snapshotUrl) missing.push('NEONSPORTZ_SNAPSHOT_URL');
      if (!cfg.webhookSecret) missing.push('NEONSPORTZ_WEBHOOK_SECRET');
      if (missing.length) return { ok: false, providerId: KEY, healthy: false, reason: 'not-configured', missing };
      return { ok: true, providerId: KEY, healthy: true, configured: true };
    },
    async getCurrentWeek() {
      const r = await _fetchSnapshot();
      if (!r.ok) return r;
      return { ok: true, providerId: KEY, week: r.snapshot.currentWeek != null ? Number(r.snapshot.currentWeek) : null, revision: r.revision };
    },
    async fetchLeagueSnapshot() { return _fetchSnapshot(); },
    async fetchWeek(ctx, week) {
      const r = await _fetchSnapshot();
      if (!r.ok) return r;
      const games = r.snapshot.weeks?.[String(week)] || [];
      if (!games.length) return { ok: false, reason: 'week-not-in-snapshot', providerId: KEY, week: Number(week) };
      return { ok: true, providerId: KEY, week: Number(week), games, revision: r.revision };
    },
    async ingestImport(input) {
      // Webhook-triggered: the receiver already recorded the ImportRun; here we perform the read-only fetch.
      const r = await _fetchSnapshot();
      if (!r.ok) return r;
      const registry = require('../../../services/scheduleRegistryService');
      const reg = registry.importScheduleObject(r.snapshot, { source: KEY });
      return { ok: true, providerId: KEY, currentWeek: reg.currentWeek, storedWeeks: Object.keys(reg.weeks || {}).length, revision: r.revision, importId: input?.importId || null };
    },
  },
});
