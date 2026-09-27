/*
 * NAVIGATION HEADER
 * FILE: src/providers/madden/index.js
 * LAYER: Provider adapter layer (V202)
 * PURPOSE: Madden provider set: Companion export gateway (data), NeonSportz (data + webhook), legacy companion
 *          endpoint (data), EA official control placeholder (all control flags false).
 */

'use strict';

const { createProvider } = require('../gameProvider');
const { createEndpointProvider } = require('../customEndpoint');
const exportGateway = require('./companion/exportGateway');

const companionExport = createProvider({
  key: 'companion_export',
  label: 'Madden Companion export gateway (data only)',
  verified: () => {
    if (String(process.env.COMPANION_EXPORT_TOKEN || '').trim() || String(process.env.COMPANION_EXPORT_TOKENS_JSON || '').trim()) return true;
    try { const id=require('../../league/spaceContext').current(); return !!(id && require('../../services/providerConnectionService').getConnection(id,'companion_export')?.routeTokenHash); } catch { return false; }
  },
  capabilities: { dataImport: true, readSchedule: true, readLeagueState: true, readStats: true, webhook: false, advanceWeek: false, markReady: false, autoPilot: false, forceResult: false },
  methods: {
    async healthCheck() {
      let configured = !!(String(process.env.COMPANION_EXPORT_TOKEN || '').trim() || String(process.env.COMPANION_EXPORT_TOKENS_JSON || '').trim());
      try { const id=require('../../league/spaceContext').current(); configured = configured || !!(id && require('../../services/providerConnectionService').getConnection(id,'companion_export')?.routeTokenHash); } catch {}
      if (!configured) return { ok: false, providerId: 'companion_export', healthy: false, reason: 'not-configured', missing: ['Companion receiver token'] };
      const latest = exportGateway.getLatestSnapshot();
      return { ok: true, providerId: 'companion_export', healthy: true, lastValidatedAt: latest?.validatedAt || null };
    },
    async getRevision() { const latest = exportGateway.getLatestSnapshot(); return { ok: true, providerId: 'companion_export', revision: latest?.payloadHash || null }; },
    async getCurrentWeek() {
      const latest = exportGateway.getLatestSnapshot();
      if (!latest) return { ok: false, reason: 'no-snapshot-yet', providerId: 'companion_export' };
      return { ok: true, providerId: 'companion_export', week: latest.currentWeek != null ? Number(latest.currentWeek) : null, revision: latest.payloadHash, validatedAt: latest.validatedAt };
    },
    async fetchLeagueSnapshot() {
      const latest = exportGateway.getLatestSnapshot();
      if (!latest) return { ok: false, reason: 'no-snapshot-yet', providerId: 'companion_export' };
      return { ok: true, providerId: 'companion_export', snapshot: latest, revision: latest.payloadHash };
    },
    async fetchWeek(ctx, week) {
      const latest = exportGateway.getLatestSnapshot();
      if (!latest) return { ok: false, reason: 'no-snapshot-yet', providerId: 'companion_export' };
      const games = latest.weeks?.[String(week)] || [];
      if (!games.length) return { ok: false, reason: 'week-not-in-snapshot', providerId: 'companion_export', week: Number(week) };
      return { ok: true, providerId: 'companion_export', week: Number(week), games, revision: latest.payloadHash };
    },
    async ingestImport(input) {
      const r = exportGateway.processImportRun(input?.importId, input?.ctx || {});
      return r.ok ? { ok: true, providerId: 'companion_export', ...r } : { ok: false, providerId: 'companion_export', reason: r.reason, errors: r.errors || null };
    },
  },
});

module.exports = [
  companionExport,
  require('./neonsportz/client'),
  createEndpointProvider({ key: 'madden_companion', label: 'Madden companion endpoint (legacy MYBOT_MADDEN_SYNC_URL, data only)', envUrl: 'MYBOT_MADDEN_SYNC_URL', envToken: 'MYBOT_MADDEN_SYNC_TOKEN' }),
  createEndpointProvider({ key: 'custom_endpoint', label: 'Custom JSON endpoint (data only)', envUrl: 'MYBOT_CUSTOM_SYNC_URL', envToken: 'MYBOT_CUSTOM_SYNC_TOKEN' }),
  require('./ea/controlProvider'),
];
