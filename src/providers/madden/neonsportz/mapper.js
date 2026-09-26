/*
 * NAVIGATION HEADER
 * FILE: src/providers/madden/neonsportz/mapper.js
 * LAYER: Provider adapter layer (V202)
 * PURPOSE: Map a NeonSportz read-API / export JSON payload into the bot's normalized snapshot. NeonSportz field
 *          names are configuration-driven (NEONSPORTZ_SNAPSHOT_URL returns a JSON schedule export). Any shape the
 *          generic alias parser understands (weeks map, games list, our own export format) is accepted.
 * LOOK HERE FIRST WHEN DEBUGGING: mapSnapshot().
 */

'use strict';

function mapSnapshot(payload) {
  const registry = require('../../../services/scheduleRegistryService');
  const snapshot = registry.normalizeImportPayload(payload);
  const revision = payload?.revision ?? payload?.importId ?? payload?.exportedAt ?? payload?.updatedAt ?? null;
  return { snapshot, revision: revision != null ? String(revision) : null };
}

module.exports = { mapSnapshot };
