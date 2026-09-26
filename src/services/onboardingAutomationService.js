/*
 * NAVIGATION HEADER
 * FILE: src/services/onboardingAutomationService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * onboardingAutomationService.js
 * Plug-and-play server builder and onboarding automation.
 *
 * Features:
 *   - Auto-build server on template select (express setup path)
 *   - Auto-DM members with personalized onboarding based on template
 *   - Auto-post welcome card with correct join path
 *   - Automation status board in #commissioner-ai
 *   - Gating logic: timezone gate, community gate, active-check gate
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { makeLogger } = require('../utils/logger');
const serverSettings = require('./serverSettingsService');
const templateLogic = require('./serverTemplateLogicService');
const memberProfiles = require('./memberProfileService');
const { loadJson, saveJson } = require('../storage/jsonStore');
const { findConfiguredChannel } = require('./channelTopologyService');
const log = makeLogger('onboardingAuto');

const FILE = 'onboardingAutomation.json';
const DEFAULTS = {
  expressSetupEnabled: true,
  autoWelcomeDm: true,
  autoWelcomeCard: true,
  autoCommunityGate: false,
  autoTimezoneGate: false,
  autoActiveCheck: true,
  activeCheckIntervalDays: 14,
  onboardingVersion: 1,
};

function getSettings() {
  return { ...DEFAULTS, ...(loadJson(FILE, DEFAULTS) || {}) };
}

function saveSettings(next) {
  const s = { ...getSettings(), ...(next || {}) };
  saveJson(FILE, s);
  return s;
}

/**
 * Build an onboarding DM embed for a new member based on the server template.
 */
function buildOnboardingDm(member, guild, settings) {
  const tmplProfile = templateLogic.getTemplateProfile(settings);
  const joinHelp = tmplProfile?.joinHelp || 'Browse the server channels to find your spot.';
  const serverName = guild?.name || 'the server';

  const rulesChannel = guild?.channels?.cache?.find(c => c.isTextBased?.() && c.name === 'rules');
  const _guideChName = templateLogic.getGuideChannelName ? templateLogic.getGuideChannelName(settings) : 'server-guide';
  const guideChannel = guild?.channels?.cache?.find(c => c.isTextBased?.() && (c.name === _guideChName || c.name === 'server-guide'));
  const rulesLink = rulesChannel ? `https://discord.com/channels/${guild.id}/${rulesChannel.id}` : null;

  const audienceWarning = serverSettings.requiresAgeWarning?.(settings.audienceRating) && settings.ageWarningEnabled
    ? serverSettings.getAudienceWarning(settings.audienceRating, settings.filterMode)
    : null;

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`👋 Welcome to ${serverName}`)
    .setDescription(
      (rulesLink ? `**[📖 Jump to #rules](${rulesLink})**\n\n` : '') +
      `${audienceWarning ? `⚠️ **Content note:** ${audienceWarning}\n\n` : ''}` +
      `${joinHelp}\n\n` +
      (guideChannel ? `📋 Check <#${guideChannel.id}> for the full server guide.\n\n` : '') +
      `Use \`/set-timezone\` to save your timezone — it keeps scheduling and notifications accurate.`
    )
    .setFooter({ text: `Template: ${tmplProfile?.name || 'Standard'}` })
    .setTimestamp();
}

/**
 * Build the automation status embed for #commissioner-ai.
 */
function buildAutomationStatusEmbed(settings, autoSettings) {
  const tmplProfile = templateLogic.getTemplateProfile(settings);
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('⚙️ Onboarding & Automation Status')
    .addFields(
      { name: 'Server Template', value: tmplProfile?.name || 'Not set', inline: true },
      { name: 'Subtemplate', value: settings.serverSubtemplate || 'None', inline: true },
      { name: 'Audience Rating', value: String(settings.audienceRating || 'pg13').toUpperCase(), inline: true },
      { name: 'Welcome DM', value: autoSettings.autoWelcomeDm ? '✅ ON' : '❌ OFF', inline: true },
      { name: 'Welcome Card', value: autoSettings.autoWelcomeCard ? '✅ ON' : '❌ OFF', inline: true },
      { name: 'Timezone Gate', value: settings.requireTimezone ? '✅ ON' : '❌ OFF', inline: true },
      { name: 'Active Check', value: autoSettings.autoActiveCheck ? `✅ Every ${autoSettings.activeCheckIntervalDays} days` : '❌ OFF', inline: true },
      { name: 'Express Setup', value: autoSettings.expressSetupEnabled ? '✅ Enabled' : '❌ Manual only', inline: true },
    )
    .setFooter({ text: 'Use /set-bot-tone, /setup-wizard-start, or the wizard to change these settings.' })
    .setTimestamp();
}

/**
 * Post or update the automation status board in #commissioner-ai.
 */
async function postAutomationStatus(guild) {
  try {
    const settings = serverSettings.getSettings();
    const autoSettings = getSettings();
    const ch = findConfiguredChannel(guild, 'commAI', { textOnly: true });
    if (!ch) return;
    const embed = buildAutomationStatusEmbed(settings, autoSettings);
    // Find and update existing board, or post fresh
    const recent = await ch.messages.fetch({ limit: 20 }).catch(() => null);
    const existing = recent ? [...recent.values()].find(m =>
      m.author?.id === guild.members?.me?.id &&
      m.embeds?.[0]?.title?.includes('Automation Status')
    ) : null;
    if (existing?.editable) {
      await existing.edit({ embeds: [embed] }).catch(() => null);
    } else {
      await ch.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    }
  } catch (err) {
    log.warn('postAutomationStatus failed:', err.message);
  }
}

/**
 * Handle new member join — send onboarding DM if enabled.
 */
async function handleMemberJoin(member, guild) {
  try {
    const autoSettings = getSettings();
    if (!autoSettings.autoWelcomeDm) return;
    const settings = serverSettings.getSettings();
    if (!settings.serverInitialized) return; // don't DM during setup
    const embed = buildOnboardingDm(member, guild, settings);
    await member.send({ embeds: [embed] }).catch(() => null);
    log.info(`Onboarding DM sent to ${member.user?.tag}`);
  } catch (err) {
    log.warn('handleMemberJoin onboarding failed:', err.message);
  }
}

/**
 * Gating check — returns which gates a member needs to pass.
 * Delegates to stateService.resolveUserAccess for canonical gate enforcement.
 */
function getMemberGateStatus(memberId, settings) {
  try {
    const stateService = require('./stateService');
    const access = stateService.resolveUserAccess(memberId, settings?.guildId || null);
    if (access.clear) return [];
    return [{ gate: access.gate, label: access.reason, command: access.gate === 'timezone' ? '/set-timezone' : '#community-selector' }];
  } catch {
    // fallback — display only, not enforcement
    const autoSettings = getSettings();
    const profile = require('./memberProfileService').getProfile(memberId);
    const gates = [];
    if (settings.requireTimezone && !profile?.timezone) {
      gates.push({ gate: 'timezone', label: 'Set timezone', command: '/set-timezone' });
    }
    return gates;
  }
}

module.exports = {
  getSettings,
  saveSettings,
  buildOnboardingDm,
  buildAutomationStatusEmbed,
  postAutomationStatus,
  handleMemberJoin,
  getMemberGateStatus,
  DEFAULTS,
};
