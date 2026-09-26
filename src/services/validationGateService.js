/*
 * NAVIGATION HEADER
 * FILE: src/services/validationGateService.js
 * LAYER: Service layer
 * PURPOSE: Shared preflight validators for all critical flows. Fail early with useful diagnostics or self-heal if safe.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for validateSetupWizardContract, validateChannel, preflightForFlow.
 * RELATED FLOW: setup wizard, release orchestration, reboot finalization, AI routing, role sync.
 * NOTE: V184 — expanded from minimal contract checks to comprehensive flow validation.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const wizardStateService = require('./wizardStateService');
const log = makeLogger('validationGate');

// ── Individual validators ────────────────────────────────────────────

function validateSetupWizardContract(channel) {
  const state = wizardStateService.getState();
  const failures = [];
  if (!channel) failures.push('missing-setup-channel');
  if (!state.installationMode) failures.push('installation-mode-off');
  if (!state.currentStep) failures.push('missing-current-step');
  if (!state.activeMessageId) failures.push('missing-active-message-id');
  return { ok: failures.length === 0, failures };
}

function validateReleaseMetadata(metadata = {}) {
  const failures = [];
  if (!metadata.version) failures.push('missing-version');
  if (!metadata.category) failures.push('missing-category');
  if (!Array.isArray(metadata.fixes) || !metadata.fixes.length) failures.push('missing-fix-list');
  return { ok: failures.length === 0, failures };
}

function validateChannel(channel, label = 'channel') {
  const failures = [];
  if (!channel) failures.push(`missing-${label}`);
  else if (!channel.send && !channel.messages) failures.push(`${label}-not-text-channel`);
  return { ok: failures.length === 0, failures };
}

function validateRolesExist(guild, roleNames = []) {
  const failures = [];
  if (!guild?.roles?.cache) {
    failures.push('guild-roles-unavailable');
    return { ok: false, failures };
  }
  for (const name of roleNames) {
    const found = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
    if (!found) failures.push(`missing-role:${name}`);
  }
  return { ok: failures.length === 0, failures };
}

async function validateActiveMessage(channel, messageId) {
  const failures = [];
  if (!messageId) {
    failures.push('no-active-message-id');
    return { ok: false, failures, exists: false };
  }
  if (!channel?.messages?.fetch) {
    failures.push('channel-cannot-fetch');
    return { ok: false, failures, exists: false };
  }
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) {
    failures.push('active-message-deleted');
    return { ok: false, failures, exists: false };
  }
  return { ok: true, failures, exists: true };
}

function validateEnvironment(requiredVars = []) {
  const failures = [];
  for (const varName of requiredVars) {
    if (!process.env[varName]?.trim()) failures.push(`missing-env:${varName}`);
  }
  return { ok: failures.length === 0, failures };
}

function validateTemplateDependencies(settings = {}) {
  const failures = [];
  if (!settings.serverTemplate) failures.push('no-server-template');
  return { ok: failures.length === 0, failures };
}

function validateBotPermissions(channel, permissionNames = []) {
  const failures = [];
  if (!channel?.guild?.members?.me) {
    failures.push('cannot-resolve-bot-member');
    return { ok: false, failures };
  }
  const botPerms = channel.permissionsFor?.(channel.guild.members.me);
  if (!botPerms) {
    failures.push('cannot-resolve-permissions');
    return { ok: false, failures };
  }
  for (const perm of permissionNames) {
    if (!botPerms.has(perm)) failures.push(`missing-perm:${perm}`);
  }
  return { ok: failures.length === 0, failures };
}

// ── Composite preflight ──────────────────────────────────────────────

function preflightForFlow(flowName, ctx = {}) {
  const allFailures = [];
  let observability;
  try { observability = require('./observabilityService'); } catch {}

  switch (flowName) {
    case 'setup-wizard': {
      const c = validateChannel(ctx.channel, 'setup-wizard-channel');
      const w = validateSetupWizardContract(ctx.channel);
      allFailures.push(...c.failures, ...w.failures);
      break;
    }
    case 'release': {
      const r = validateReleaseMetadata(ctx.metadata);
      allFailures.push(...r.failures);
      break;
    }
    case 'reboot-finalization': {
      const c = validateChannel(ctx.channel, 'wizard-channel');
      allFailures.push(...c.failures);
      if (!ctx.guild) allFailures.push('missing-guild');
      break;
    }
    case 'ai-response': {
      const c = validateChannel(ctx.channel, 'response-channel');
      if (ctx.permissionNames?.length && ctx.channel) {
        const p = validateBotPermissions(ctx.channel, ctx.permissionNames);
        allFailures.push(...p.failures);
      }
      allFailures.push(...c.failures);
      break;
    }
    case 'role-sync': {
      if (!ctx.guild) allFailures.push('missing-guild');
      break;
    }
    case 'member-onboarding': {
      if (!ctx.guild) allFailures.push('missing-guild');
      if (!ctx.member) allFailures.push('missing-member');
      const s = require('./serverSettingsService').getSettings();
      if (!s.serverInitialized) allFailures.push('server-not-initialized');
      break;
    }
    case 'community-provision': {
      if (!ctx.guild) allFailures.push('missing-guild');
      if (!ctx.communityName?.trim()) allFailures.push('missing-community-name');
      const nameVal = validateCommunityName(ctx.communityName);
      allFailures.push(...nameVal.failures);
      break;
    }
    case 'content-moderation': {
      if (!ctx.message) allFailures.push('missing-message');
      if (!ctx.message?.guild) allFailures.push('missing-guild');
      break;
    }
    case 'server-build': {
      if (!ctx.guild) allFailures.push('missing-guild');
      const env = validateEnvironment(['TOKEN', 'CLIENT_ID', 'GUILD_ID']);
      allFailures.push(...env.failures);
      const s2 = require('./serverSettingsService').getSettings();
      if (!s2.serverTemplate) allFailures.push('no-template-selected');
      break;
    }
    case 'security-response': {
      if (!ctx.guild) allFailures.push('missing-guild');
      if (!ctx.userId) allFailures.push('missing-user-id');
      if (!ctx.eventType) allFailures.push('missing-event-type');
      break;
    }
    default:
      log.warn(`[PREFLIGHT] unknown flow: ${flowName}`);
  }

  const ok = allFailures.length === 0;

  if (!ok) {
    log.info(`[PREFLIGHT] ${flowName} FAILED: ${allFailures.join(', ')}`);
    if (observability?.recordFlowOutcome) {
      observability.recordFlowOutcome(`preflight:${flowName}`, {
        outcome: 'validation-fail',
        failures: allFailures,
      });
    }
  }

  return { ok, failures: allFailures, flow: flowName };
}

// ── New validators (V191) ────────────────────────────────────────────

function validateCommunityName(name) {
  const failures = [];
  if (!name || !String(name).trim()) { failures.push('empty-community-name'); return { ok: false, failures }; }
  const clean = String(name).trim();
  if (clean.length < 2) failures.push('community-name-too-short');
  if (clean.length > 50) failures.push('community-name-too-long');
  if (/[<>@#&!`]/.test(clean)) failures.push('community-name-has-special-chars');
  return { ok: failures.length === 0, failures };
}

function validateAudienceRating(rating) {
  const failures = [];
  const valid = new Set(['g', 'pg', 'pg13', 'r']);
  if (!rating || !valid.has(String(rating).trim().toLowerCase())) {
    failures.push('invalid-audience-rating');
  }
  return { ok: failures.length === 0, failures };
}

function validateMemberActionable(guild, memberId) {
  const failures = [];
  if (!guild?.members?.me) { failures.push('bot-not-in-guild'); return { ok: false, failures }; }
  const botMember = guild.members.me;
  const target = guild.members.cache.get(memberId);
  if (!target) { failures.push('member-not-found'); return { ok: false, failures }; }
  if (target.roles.highest.position >= botMember.roles.highest.position) {
    failures.push('target-role-too-high');
  }
  return { ok: failures.length === 0, failures };
}

function validateServerInitialized() {
  const settings = require('./serverSettingsService').getSettings();
  const failures = [];
  if (!settings.serverInitialized) failures.push('server-not-initialized');
  if (!settings.serverTemplate) failures.push('no-template');
  return { ok: failures.length === 0, failures };
}

module.exports = {
  validateSetupWizardContract,
  validateReleaseMetadata,
  validateChannel,
  validateRolesExist,
  validateActiveMessage,
  validateEnvironment,
  validateTemplateDependencies,
  validateBotPermissions,
  validateCommunityName,
  validateAudienceRating,
  validateMemberActionable,
  validateServerInitialized,
  preflightForFlow,
};
