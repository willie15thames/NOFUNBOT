/*
 * NAVIGATION HEADER
 * FILE: src/providers/local/index.js
 * LAYER: Provider adapter layer (V202)
 * PURPOSE: 'local' data provider — the manually maintained schedule registry (JSON/CSV imports, /advance-week,
 *          screenshot schedules). Source week == whatever the commissioner last imported. No control capability.
 *          This is the emergency-fallback provider (rule 28) and the default when no external provider is set.
 * LOOK HERE FIRST WHEN DEBUGGING: getCurrentWeek(), fetchWeek().
 */

'use strict';

const { createProvider } = require('../providerContract');

module.exports = createProvider({
  key: 'local',
  label: 'Local schedule registry (manual import)',
  verified: true,
  capabilities: { dataImport: true, readSchedule: true, readLeagueState: true, readStats: false, webhook: false, advanceWeek: false, markReady: false, autoPilot: false, forceResult: false },
  methods: {
    async healthCheck() { return { ok: true, providerId: 'local', healthy: true }; },
    async getRevision() {
      const reg = require('../../services/scheduleRegistryService').getRegistry();
      return { ok: true, providerId: 'local', revision: reg.lastImportAt ? String(reg.lastImportAt) : null };
    },
    async getCurrentWeek() {
      const reg = require('../../services/scheduleRegistryService').getRegistry();
      return { ok: true, providerId: 'local', week: reg.currentWeek != null ? Number(reg.currentWeek) : null, revision: reg.lastImportAt ? String(reg.lastImportAt) : null, source: reg.source || 'local' };
    },
    async fetchLeagueSnapshot() {
      const reg = require('../../services/scheduleRegistryService').getRegistry();
      return { ok: true, providerId: 'local', snapshot: { currentWeek: reg.currentWeek, weeks: reg.weeks || {}, teams: reg.teams || [], players: reg.players || [] }, revision: reg.lastImportAt ? String(reg.lastImportAt) : null };
    },
    async fetchWeek(ctx, week) {
      const registry = require('../../services/scheduleRegistryService');
      const games = registry.getWeek(week);
      if (!games.length) return { ok: false, reason: 'week-not-imported', providerId: 'local', week: Number(week) };
      const reg = registry.getRegistry();
      return { ok: true, providerId: 'local', week: Number(week), games, revision: reg.lastImportAt ? String(reg.lastImportAt) : null };
    },
    async ingestImport(input) {
      const registry = require('../../services/scheduleRegistryService');
      const reg = registry.importScheduleObject(input?.payload ?? input, { source: input?.source || 'local' });
      return { ok: true, providerId: 'local', currentWeek: reg.currentWeek, storedWeeks: Object.keys(reg.weeks || {}).length, revision: String(reg.lastImportAt) };
    },
  },
});
