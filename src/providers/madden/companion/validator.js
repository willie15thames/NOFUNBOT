/*
 * NAVIGATION HEADER
 * FILE: src/providers/madden/companion/validator.js
 * LAYER: Provider adapter layer (V202)
 * PURPOSE: Validate a normalized Companion snapshot before it is stored as a provider snapshot (league/validationService
 *          rules + Companion-specific checks: at least one week, week numbers sane).
 */

'use strict';

const { validateSnapshot } = require('../../../league/validationService');

function validateCompanionSnapshot(snapshot, opts = {}) {
  const base = validateSnapshot(snapshot, opts);
  const errors = [...base.errors];
  const weekKeys = Object.keys(snapshot?.weeks || {}).map(Number).filter(Number.isFinite);
  if (!weekKeys.length) errors.push('no-weeks');
  if (weekKeys.some(w => w < 1 || w > 30)) errors.push('week-out-of-range');
  return { ok: errors.length === 0, errors, warnings: base.warnings, currentWeek: base.currentWeek, games: base.games };
}

module.exports = { validateCompanionSnapshot };
