/*
 * NAVIGATION HEADER
 * FILE: src/providers/madden/ea/controlProvider.js
 * LAYER: Provider adapter layer (V202, spec §10/§35)
 * PURPOSE: Placeholder GameControlProvider for an OFFICIAL/AUTHORIZED EA franchise-control interface. No such
 *          public server-to-server API is verified, so EVERY control capability is false and every control call
 *          returns { ok:false, reason:'unsupported-capability' }. Reverse-engineered endpoints, credential replay
 *          and UI automation are deliberately NOT implemented here (spec §2 legal/technical boundary).
 *          When an authorized interface exists, implement the methods and flip the capability flags — the
 *          advance engine needs no other change (REQUESTING_GAME_ADVANCE path is already wired).
 */

'use strict';

const { createProvider } = require('../../gameProvider');

module.exports = createProvider({
  key: 'ea_official_control',
  label: 'EA official franchise control (not available — no authorized interface verified)',
  control: true,
  verified: false,
  capabilities: { dataImport: false, readSchedule: false, readLeagueState: false, readStats: false, webhook: false, advanceWeek: false, markReady: false, autoPilot: false, forceResult: false },
  methods: {
    async healthCheck() { return { ok: false, providerId: 'ea_official_control', healthy: false, reason: 'not-available' }; },
  },
});
