/*
 * NAVIGATION HEADER
 * FILE: src/services/stateOwnershipMapService.js
 * LAYER: Service layer
 * PURPOSE: Single source of truth registry — maps every state field to its owning service.
 *          Prevents split-truth bugs by making ownership explicit and auditable.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for OWNERSHIP_MAP and validateOwnership.
 * RELATED FLOW: state service, wizard state, server settings, validation gate, release orchestration.
 * NOTE: V184 — introduced as part of the reliability hardening program.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const log = makeLogger('stateOwnership');

/**
 * Canonical ownership map.
 * Format: { fieldPath: { owner: serviceName, deprecated: false, migratedFrom?: string } }
 *
 * Rules:
 * 1. Every field has exactly ONE owner.
 * 2. Consumers read through the owner's API, never directly.
 * 3. Deprecated fields must not be read or written — validation catches violations.
 */
const OWNERSHIP_MAP = Object.freeze({
  // ── Wizard State ──
  'wizard.installationMode':     { owner: 'wizardStateService',      deprecated: false },
  'wizard.currentStep':          { owner: 'wizardStateService',      deprecated: false },
  'wizard.activeMessageId':      { owner: 'wizardStateService',      deprecated: false },
  'wizard.lastAdvancedAt':       { owner: 'wizardStateService',      deprecated: false },
  'wizard.lastReconciledAt':     { owner: 'wizardStateService',      deprecated: false },
  'wizard.setupPhase':           { owner: 'wizardStateService',      deprecated: false },

  // ── Server Settings ──
  'settings.serverTemplate':     { owner: 'serverSettingsService',   deprecated: false },
  'settings.serverSubtemplate':  { owner: 'serverSettingsService',   deprecated: false },
  'settings.themeName':          { owner: 'serverSettingsService',   deprecated: false },
  'settings.serverInitialized':  { owner: 'serverSettingsService',   deprecated: false },
  'settings.botStatus':          { owner: 'serverSettingsService',   deprecated: false },
  'settings.botName':            { owner: 'serverSettingsService',   deprecated: false },
  'settings.audienceRating':     { owner: 'serverSettingsService',   deprecated: false },
  'settings.filterMode':         { owner: 'serverSettingsService',   deprecated: false },
  'settings.requireTimezone':    { owner: 'serverSettingsService',   deprecated: false },
  'settings.communities':        { owner: 'serverSettingsService',   deprecated: false },

  // ── Release State ──
  'release.currentVersion':      { owner: 'releaseOrchestrationService', deprecated: false },
  'release.lastPublished':       { owner: 'releaseOrchestrationService', deprecated: false },
  'release.history':             { owner: 'releaseOrchestrationService', deprecated: false },

  // ── Patch Notes ──
  'patchNotes.channelId':        { owner: 'patchNotesService',      deprecated: false },
  'patchNotes.lastMessageId':    { owner: 'patchNotesService',      deprecated: false },

  // ── Event Claims ──
  'eventClaim.redisReady':       { owner: 'eventClaimService',      deprecated: false },
  'eventClaim.localFallback':    { owner: 'eventClaimService',      deprecated: false },

  // ── Persona Routing ──
  'persona.lastDecision':        { owner: 'personaArbiterService',  deprecated: false },

  // ── Member Profiles ──
  'memberProfiles.*':            { owner: 'memberProfileService',   deprecated: false },

  // ── Guide Lifecycle ──
  'guide.activeMessageId':       { owner: 'guideLifecycleService',  deprecated: false },

  // ── DEPRECATED fields — reads/writes MUST be removed ──
  'wizard.setupStarted':         { owner: 'wizardStateService',      deprecated: true, migratedTo: 'wizard.installationMode' },
  'wizard.wizardMessageId':      { owner: 'wizardStateService',      deprecated: true, migratedTo: 'wizard.activeMessageId' },
});

/**
 * Get the owner of a state field.
 * @param {string} fieldPath
 * @returns {{ owner: string, deprecated: boolean, migratedTo?: string } | null}
 */
function getOwner(fieldPath) {
  return OWNERSHIP_MAP[fieldPath] || null;
}

/**
 * Check if a field is deprecated.
 */
function isDeprecated(fieldPath) {
  const entry = OWNERSHIP_MAP[fieldPath];
  return !!entry?.deprecated;
}

/**
 * Validate that a caller is the rightful owner of a field.
 * @param {string} fieldPath
 * @param {string} callerService
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateOwnership(fieldPath, callerService) {
  const entry = OWNERSHIP_MAP[fieldPath];
  if (!entry) {
    return { ok: false, reason: `unknown-field: ${fieldPath}` };
  }
  if (entry.deprecated) {
    return { ok: false, reason: `deprecated-field: ${fieldPath} → use ${entry.migratedTo || 'N/A'}` };
  }
  if (entry.owner !== callerService) {
    return { ok: false, reason: `ownership-violation: ${fieldPath} owned by ${entry.owner}, not ${callerService}` };
  }
  return { ok: true };
}

/**
 * Returns all deprecated fields for auditing.
 */
function getDeprecatedFields() {
  return Object.entries(OWNERSHIP_MAP)
    .filter(([, v]) => v.deprecated)
    .map(([field, v]) => ({ field, owner: v.owner, migratedTo: v.migratedTo || null }));
}

/**
 * Returns the full ownership map for auditing / diagnostics.
 */
function getFullMap() {
  return { ...OWNERSHIP_MAP };
}

/**
 * Run a static audit: reports any deprecated fields that should be removed.
 */
function auditDeprecatedAccess() {
  const deprecated = getDeprecatedFields();
  if (deprecated.length > 0) {
    log.warn(`[OWNERSHIP-AUDIT] ${deprecated.length} deprecated field(s) still in map:`);
    for (const d of deprecated) {
      log.warn(`  ❌ ${d.field} → migrate to ${d.migratedTo || 'REMOVE'}`);
    }
  }
  return deprecated;
}

module.exports = {
  OWNERSHIP_MAP,
  getOwner,
  isDeprecated,
  validateOwnership,
  getDeprecatedFields,
  getFullMap,
  auditDeprecatedAccess,
};
