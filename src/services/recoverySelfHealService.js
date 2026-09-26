/*
 * NAVIGATION HEADER
 * FILE: src/services/recoverySelfHealService.js
 * LAYER: Service layer
 * PURPOSE: Heals missing guided assets — wizard guide, patch-notes channel, roles, stale active message refs, invalid channel mappings.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for healWizardGuide, healPatchNotes, healRoles, runFullRecovery.
 * RELATED FLOW: recovery/self-heal, startup reconciliation, validation recovery, role hierarchy sync.
 * NOTE: V184 — expanded from 2 heal functions to comprehensive drift recovery.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const wizardStateService = require('./wizardStateService');
const log = makeLogger('selfHeal');

// ── Wizard guide recovery ────────────────────────────────────────────

async function healWizardGuide(channel, payloadBuilder, singleMessageWizardService) {
  if (!channel || !singleMessageWizardService) return { ok: false, reason: 'missing-dependency', healed: false };
  const activeId = wizardStateService.getActiveMessageId();
  const current = activeId ? await channel.messages.fetch(activeId).catch(() => null) : null;
  if (current) return { ok: true, healed: false, messageId: current.id };
  const msg = await singleMessageWizardService.reconcileOrRecreate(channel, payloadBuilder, {
    action: 'heal-wizard-guide',
    deleteUserMessages: true,
  });
  _recordHeal('wizard-guide', { ok: !!msg, healed: true });
  return { ok: !!msg, healed: true, messageId: msg?.id || null };
}

// ── Patch notes channel recovery ─────────────────────────────────────

async function healPatchNotes(guild, patchNotesService) {
  if (!guild || !patchNotesService?.ensurePatchNotesChannel) return { ok: false, reason: 'missing-dependency', healed: false };
  const ensured = await patchNotesService.ensurePatchNotesChannel(guild).catch(() => null);
  const ok = !!ensured?.channel;
  _recordHeal('patch-notes-channel', { ok, healed: ok });
  return { ok, healed: ok, channelId: ensured?.channel?.id || null };
}

// ── Stale active message reference recovery ──────────────────────────

async function healStaleActiveMessage(channel) {
  if (!channel) return { ok: false, reason: 'missing-channel', healed: false };
  const activeId = wizardStateService.getActiveMessageId();
  if (!activeId) return { ok: true, healed: false, reason: 'no-active-id' };
  const msg = await channel.messages.fetch(activeId).catch(() => null);
  if (msg) return { ok: true, healed: false, messageId: activeId };
  // Active message is gone — clear the stale reference
  wizardStateService.patch({ activeMessageId: null });
  log.info(`[SELF-HEAL] cleared stale activeMessageId=${activeId}`);
  _recordHeal('stale-active-message', { ok: true, healed: true, clearedId: activeId });
  return { ok: true, healed: true, clearedId: activeId };
}

// ── Role recovery ────────────────────────────────────────────────────

async function healRoles(guild, settings = {}) {
  if (!guild) return { ok: false, reason: 'missing-guild', healed: false };
  let roleSync;
  try { roleSync = require('./roleHierarchySyncService'); } catch { return { ok: false, reason: 'role-sync-unavailable', healed: false }; }
  const result = await roleSync.reconcile(guild, settings, { dryRun: false });
  _recordHeal('roles', { ok: result.ok, healed: result.actions.length > 0 });
  return { ok: result.ok, healed: result.actions.length > 0, actions: result.actions };
}

// ── Channel mapping recovery ─────────────────────────────────────────

async function healMissingChannel(guild, channelName, categoryId, opts = {}) {
  if (!guild || !channelName) return { ok: false, reason: 'missing-args', healed: false };
  const { ChannelType } = require('discord.js');
  const existing = guild.channels.cache.find(ch =>
    ch.name.toLowerCase() === channelName.toLowerCase() && ch.type === ChannelType.GuildText
  );
  if (existing) return { ok: true, healed: false, channelId: existing.id };
  try {
    const createOpts = {
      name: channelName,
      type: ChannelType.GuildText,
      reason: `Self-heal: recreating missing channel "${channelName}" — V184`,
    };
    if (categoryId) createOpts.parent = categoryId;
    const created = await guild.channels.create(createOpts);
    log.info(`[SELF-HEAL] recreated channel #${channelName} (${created.id})`);
    _recordHeal('missing-channel', { ok: true, healed: true, channelName, channelId: created.id });
    return { ok: true, healed: true, channelId: created.id };
  } catch (err) {
    log.error(`[SELF-HEAL] failed to recreate #${channelName}:`, err.message);
    _recordHeal('missing-channel', { ok: false, healed: false, channelName, error: err.message });
    return { ok: false, healed: false, reason: err.message };
  }
}

// ── Full recovery sweep ──────────────────────────────────────────────

/**
 * Run all recovery checks. Designed to be called on startup or on-demand.
 *
 * @param {Object} ctx - { guild, wizardChannel, payloadBuilder, patchNotesService, singleMessageWizardService, settings }
 * @returns {{ results: Object[], healedCount: number, failedCount: number }}
 */
async function runFullRecovery(ctx = {}) {
  const results = [];

  // 1. Stale active message
  if (ctx.wizardChannel) {
    results.push({ check: 'stale-active-message', ...(await healStaleActiveMessage(ctx.wizardChannel)) });
  }

  // 2. Wizard guide
  if (ctx.wizardChannel && ctx.singleMessageWizardService && ctx.payloadBuilder) {
    results.push({ check: 'wizard-guide', ...(await healWizardGuide(ctx.wizardChannel, ctx.payloadBuilder, ctx.singleMessageWizardService)) });
  }

  // 3. Patch notes channel
  if (ctx.guild && ctx.patchNotesService) {
    results.push({ check: 'patch-notes', ...(await healPatchNotes(ctx.guild, ctx.patchNotesService)) });
  }

  // 4. Roles
  if (ctx.guild && ctx.settings) {
    results.push({ check: 'roles', ...(await healRoles(ctx.guild, ctx.settings)) });
  }

  const healedCount = results.filter(r => r.healed).length;
  const failedCount = results.filter(r => !r.ok).length;

  log.info(`[SELF-HEAL] full recovery complete — ${results.length} checks, ${healedCount} healed, ${failedCount} failed`);

  return { results, healedCount, failedCount };
}

// ── Observability hook ───────────────────────────────────────────────

function _recordHeal(flow, data) {
  try {
    const obs = require('./observabilityService');
    obs.recordSelfHeal(flow, data);
  } catch {}
}

module.exports = {
  healWizardGuide,
  healPatchNotes,
  healStaleActiveMessage,
  healRoles,
  healMissingChannel,
  runFullRecovery,
};
