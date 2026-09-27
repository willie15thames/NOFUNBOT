/*
 * NAVIGATION HEADER
 * FILE: src/services/hierarchyEnforcementService.js
 * LAYER: Service layer
 * PURPOSE: Manages role hierarchy, permissions, or role-flow orchestration.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * hierarchyEnforcementService.js
 * The 7 golden laws. Every command/gate/action passes through this before execution.
 *
 * Execution order:
 *   1. SYSTEM BYPASS (setup/install commands always pass)
 *   2. BOT STATUS CHECK (killed → only kill-flow commands)
 *   3. WIZARD STATE CHECK (installation mode → only allowlisted commands)
 *   4. SETUP STEP ENFORCEMENT (structure mode requirements before communities, etc.)
 *   5. GATE CHECKS (timezone / community — silent visibility, never message spam)
 *   6. COMMAND EXECUTION
 */

const { makeLogger } = require('../utils/logger');
const serverSettings = require('./serverSettingsService');
const wizardPrefs = require('./wizardPreferencesService');
const wizardState = require('./wizardStateService');
const memberProfiles = require('./memberProfileService');
const log = makeLogger('hierarchy');

// ── Rule 1: Commands that bypass ALL hierarchy checks ─────────────────────
// V200.2: Synced with router's INSTALLATION_MODE_ALLOWLIST. These commands
// must pass through hierarchy without being blocked by timezone/community gates.
const SYSTEM_BYPASS_COMMANDS = new Set([
  'setup-bot', 'setup-wizard-start', 'initialize-server', 'trash-the-bot',
  'kill-bot', 'ignite-bot', 'bot-status', 'lock-bot-access',
  'set-timezone', 'manual', 'audit-wiring', 'setup-server',
  'set-bot-identity', 'set-bot-tone', 'customize-server-rules',
  'fix-duplicates', 'list-admins', 'add-admin', 'remove-admin',
  'hierarchy-status', 'suggestions', 'diagnose', 'health-status',
  'security-audit', 'audit-log',
]);

// ── Rule 3: Team-enabled community types (teams never top-level) ──────────
const TEAM_ENABLED_COMMUNITY_TYPES = new Set([
  'league-enabled',      // structured competition
  'team-enabled',        // explicit team mode
]);

/**
 * RULE 1: No communities before template is chosen.
 * Returns null (pass) or an error string (block).
 */
function checkTemplateBeforeCommunity(settings) {
  const mode = String(settings?.customStructureMode || '').toLowerCase();
  if (!mode) return 'Choose a structure mode before creating communities.';
  if (mode === 'template' && !settings.serverTemplate) {
    return 'Choose a server template before creating communities in Template Structure.';
  }
  if (mode === 'custom' && (!Array.isArray(settings.customTemplateSelections) || !settings.customTemplateSelections.length)) {
    return 'Choose at least one template before creating communities in Custom Structure.';
  }
  return null;
}

/**
 * RULE 2: No community selector without communities defined.
 * Returns null (pass) or an error string (block).
 */
function checkCommunitiesExistBeforeSelector(settings, availableCommunities = []) {
  const structureError = checkTemplateBeforeCommunity(settings);
  if (structureError) return structureError;
  if (!availableCommunities || availableCommunities.length === 0) {
    return 'No communities have been defined yet. Create communities before opening the selector.';
  }
  return null;
}

/**
 * RULE 3: No timezone gate before setup completes.
 * Setup is "complete" when serverInitialized is true.
 * Returns true if gate is allowed, false if it's too early.
 */
function isTimezoneGateAllowed(settings) {
  // Gate only runs after server is built
  return !!(settings.serverInitialized || settings.setupCompletedAt);
}

/**
 * RULE 4: Only ONE active wizard step.
 * Returns the current active stage, or null if no wizard is in progress.
 */
function getActiveWizardStage() {
  const state = wizardState.getState();
  if (!state.installationMode && !state.editMode) return null;
  return state.currentStep || 'flow';
}

/**
 * RULE 5: Teams NEVER top-level. Teams only exist inside league-enabled communities.
 * Returns true if teams are allowed for the given community type.
 */
function teamsAllowedForCommunityType(communityType) {
  return TEAM_ENABLED_COMMUNITY_TYPES.has(String(communityType || '').toLowerCase());
}

/**
 * RULE 5 extended: Determine if teams are enabled based on settings.
 * Teams are tied to mode (league-enabled), not template.
 */
function teamsEnabledForServer(settings) {
  const { getCommunityType } = require('./architectureSemanticsService');
  const type = getCommunityType(settings);
  return teamsAllowedForCommunityType(type);
}

/**
 * RULE 6: Gate = visibility control only.
 * Returns whether a member needs to pass the timezone gate, WITHOUT sending any messages.
 * Callers decide what to do with this — the gate never sends spam on its own.
 */
function memberNeedsTimezoneGate(memberId, settings) {
  if (!isTimezoneGateAllowed(settings)) return false;
  if (!settings.requireTimezone) return false;
  const profile = memberProfiles.getProfile(memberId);
  return !profile?.timezone;
}

/**
 * RULE 7: Nickname enforcement — always username (TZ), always re-append on change.
 * Returns the correct nickname for a member given their current profile.
 * Does NOT mutate — callers apply the result.
 */
function buildEnforcedNickname(member, profile) {
  if (!profile?.timezone) return null;
  // Preserve the compatibility entry point without a competing policy.
  return require('./nicknamePolicyService').buildDesiredNickname(member, require('../state'));
}

/**
 * Full hierarchy check for a command interaction.
 * Returns { allowed: true } or { allowed: false, reason: string, code: string }
 */
function checkCommandHierarchy(commandName, member, settings, availableCommunities = []) {
  // 1. System bypass — always pass
  if (SYSTEM_BYPASS_COMMANDS.has(commandName)) {
    return { allowed: true, bypassed: true };
  }

  // V200.2: BOT_KILLED and INSTALL_MODE checks REMOVED from hierarchy.
  // Router's _guardBotKilledCommand and _guardInstallationModeCommand handle both
  // for ALL users (commissioners + members). Having them here too caused double-gating
  // with different allowlists, creating inconsistent behavior for non-commissioners.

  // 4. Setup step enforcement (unique to hierarchy — router doesn't check these)
  const communityCommands = new Set(['setup-community', 'add-community', 'community-selector']);
  if (communityCommands.has(commandName)) {
    const templateErr = checkTemplateBeforeCommunity(settings);
    if (templateErr) return { allowed: false, code: 'NO_TEMPLATE', reason: templateErr };
    const selectorErr = checkCommunitiesExistBeforeSelector(settings, availableCommunities);
    if (selectorErr) return { allowed: false, code: 'NO_COMMUNITIES', reason: selectorErr };
  }

  const teamCommands = new Set(['select-team', 'join-league', 'team-registry-status']);
  if (teamCommands.has(commandName)) {
    if (!teamsEnabledForServer(settings)) {
      return {
        allowed: false,
        code: 'TEAMS_NOT_ENABLED',
        reason: 'Teams are only available in league-enabled servers. Set up a league-enabled community first.',
      };
    }
  }

  // 5. Gate checks — silent visibility control only (resolveUserAccess is the truth)
  if (member?.id) {
    try {
      const stateService = require('./stateService');
      const access = stateService.resolveUserAccess(member.id, null);
      if (!access.clear) {
        const safeCommands = new Set(['set-timezone', 'manual', 'audit-wiring', 'lock-bot-access', 'hierarchy-status']);
        if (!safeCommands.has(commandName)) {
          const codeMap = { timezone: 'TIMEZONE_GATE', community: 'COMMUNITY_GATE', setup: 'SETUP_INCOMPLETE' };
          return { allowed: false, code: codeMap[access.gate] || 'GATE_BLOCKED', reason: access.reason };
        }
      }
    } catch (_e) { /* gate check failures non-fatal */ }
  }

  return { allowed: true };
}

/**
 * Build a human-readable hierarchy state summary for the commissioner.
 */
function buildHierarchySummary(settings, availableCommunities = []) {
  const prefs = wizardPrefs.getPrefs();
  const installState = wizardState.getState();
  const { getCommunityType } = require('./architectureSemanticsService');
  const communityType = getCommunityType(settings);
  const teamsEnabled = teamsAllowedForCommunityType(communityType);

  return {
    structureMode: String(settings.customStructureMode || ''),
    templateSet: String(settings.customStructureMode || '') === 'base' ? true : (String(settings.customStructureMode || '') === 'custom' ? !!settings.customTemplateSelections?.length : !!settings.serverTemplate),
    subtemplateSet: String(settings.customStructureMode || '') === 'base' ? true : (String(settings.customStructureMode || '') === 'custom' ? true : !!settings.serverSubtemplate),
    serverInitialized: !!settings.serverInitialized,
    communitiesExist: availableCommunities.length > 0,
    timezoneGateAllowed: isTimezoneGateAllowed(settings),
    timezoneGateActive: !!settings.requireTimezone,
    communityType,
    teamsEnabled,
    wizardStage: installState.currentStep || 'flow',
    installationMode: !!installState.installationMode,
    botStatus: String(settings.botStatus || 'active'),
  };
}

module.exports = {
  SYSTEM_BYPASS_COMMANDS,
  TEAM_ENABLED_COMMUNITY_TYPES,
  checkTemplateBeforeCommunity,
  checkCommunitiesExistBeforeSelector,
  isTimezoneGateAllowed,
  getActiveWizardStage,
  teamsAllowedForCommunityType,
  teamsEnabledForServer,
  memberNeedsTimezoneGate,
  buildEnforcedNickname,
  checkCommandHierarchy,
  buildHierarchySummary,
};
