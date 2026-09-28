/*
 * NAVIGATION HEADER
 * FILE: src/services/timezoneGateService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const buttonChoices = require('./buttonChoiceService');
const memberProfiles = require('./memberProfileService');
const nicknamePolicy = require('./nicknamePolicyService');
const serverSettings = require('./serverSettingsService');
const { findConfiguredChannel, getConfiguredChannelName, matchesConfiguredChannel } = require('./channelTopologyService');

const GATE_CHANNEL_NAME = getConfiguredChannelName('timezoneGate') || 'timezone-gate';
const GATE_CHANNEL_TOPIC = 'Members must save their timezone here before the rest of the server unlocks when timezone gate is enabled. Pick your timezone using the buttons below.';


const TIMEZONE_CHOICES = [
  { label: 'Pacific Time (PST/PDT)', value: 'America/Los_Angeles', description: 'US West Coast' },
  { label: 'Mountain Time (MST/MDT)', value: 'America/Denver', description: 'US Mountain' },
  { label: 'Central Time (CST/CDT)', value: 'America/Chicago', description: 'US Central' },
  { label: 'Eastern Time (EST/EDT)', value: 'America/New_York', description: 'US East Coast' },
];

function isTimezoneGateActive(settings = serverSettings.getSettings()) {
  // FIX: Use stateService to enforce gate-only-after-setup rule
  try {
    const stateService = require('./stateService');
    return stateService.isTimezoneGateReady(null);
  } catch {
    // fallback to direct check
    return !!(settings?.requireTimezone && settings?.serverInitialized);
  }
}


function buildTimezoneSelectRow(customId = 'timezone_onboarding_select', context = {}) {
  const built = buttonChoices.createChoiceRows({
    guildId: context.guildId || null, actorId: context.actorId || null, public: context.public !== false,
    flow:'timezone', legacyCustomId:customId, minValues:1, maxValues:1, options:TIMEZONE_CHOICES,
  });
  return built.rows[0];
}

function _denyViewPermissions() {
  return {
    ViewChannel: false,
    SendMessages: false,
    AddReactions: false,
    UseApplicationCommands: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: false,
  };
}

function _allowViewPermissions() {
  return {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    UseApplicationCommands: true,
  };
}

async function ensureGateChannel(guild) {
  if (!guild) return null;
  if (!isTimezoneGateActive()) return null;
  let ch = findConfiguredChannel(guild, 'timezoneGate', { textOnly: true });
  if (!ch) {
    ch = await guild.channels.create({
      name: GATE_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: GATE_CHANNEL_TOPIC,
    }).catch(() => null);
  }
  if (!ch) return null;
  await ch.setTopic(GATE_CHANNEL_TOPIC).catch(() => null);
  const everyoneId = guild.roles.everyone.id;
  await ch.permissionOverwrites.edit(everyoneId, {
    ViewChannel: false,
    SendMessages: false,
    UseApplicationCommands: false,
    ReadMessageHistory: false,
  }).catch(() => null);
  if (guild.members?.me?.id) {
    await ch.permissionOverwrites.edit(guild.members.me.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      UseApplicationCommands: true,
      ManageChannels: true,
      ManageMessages: true,
    }).catch(() => null);
  }
  return ch;
}

async function postGatePrompt(member) {
  const guild = member?.guild;
  if (!guild || member?.user?.bot) return null;
  const ch = await ensureGateChannel(guild);
  if (!ch) return null;
  await ch.permissionOverwrites.edit(member.id, _allowViewPermissions()).catch(() => null);
  const payload = {
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🕒 Timezone Gate')
      .setDescription('Choose your timezone using the buttons below to unlock the rest of the server.')
      .setFooter({ text: 'Once your timezone saves, the rest of the server unlocks automatically.' })
      .setTimestamp()],
    components: [buildTimezoneSelectRow()],
    allowedMentions: { parse: [] }
  };
  const recent = await ch.messages.fetch({ limit: 20 }).catch(() => null);
  let panel = recent ? [...recent.values()].find(m => m.author?.id === guild.members?.me?.id && /Timezone Gate/i.test(String(m.embeds?.[0]?.title || ''))) : null;
  if (panel) await panel.edit(payload).catch(() => null);
  else panel = await ch.send(payload).catch(() => null);
  return ch;
}

function _shouldSkipChannel(ch) {
  const name = String(ch?.name || '').toLowerCase();
  if (!ch || !ch.permissionOverwrites?.edit) return true;
  if (matchesConfiguredChannel(ch, 'timezoneGate')) return true;
  return false;
}

async function lockMemberToTimezoneGate(member) {
  const guild = member?.guild;
  if (!guild || member?.user?.bot) return null;
  const gateChannel = await postGatePrompt(member);
  const deny = _denyViewPermissions();
  for (const ch of guild.channels.cache.values()) {
    if (_shouldSkipChannel(ch)) continue;
    await ch.permissionOverwrites.edit(member.id, deny).catch(() => null);
  }
  return gateChannel;
}

async function releaseMemberFromTimezoneGate(member) {
  const guild = member?.guild;
  if (!guild || member?.user?.bot) return false;
  for (const ch of guild.channels.cache.values()) {
    if (!ch?.permissionOverwrites?.delete) continue;
    await ch.permissionOverwrites.delete(member.id).catch(() => null);
  }
  const gateChannel = findConfiguredChannel(guild, 'timezoneGate', { textOnly: true });
  if (gateChannel) {
    try {
      const recent = await gateChannel.messages.fetch({ limit: 25 }).catch(() => null);
      for (const msg of (recent ? [...recent.values()] : [])) {
        const title = String(msg.embeds?.[0]?.title || '');
        if (msg.author?.id === guild.members?.me?.id && /Timezone Gate/i.test(title) && msg.components?.length) {
          await msg.delete().catch(() => null);
        }
      }
    } catch {}
  }
  try {
    const communityAccess = require('./communityAccessService');
    await communityAccess.postSelectorPanel(guild).catch(() => null);
  } catch {}
  return true;
}

async function enforceGuildTimezoneGate(guild) {
  if (!guild) return null;
  const settings = serverSettings.getSettings();
  if (!isTimezoneGateActive(settings)) return null;
  const members = guild.members?.cache?.size ? [...guild.members.cache.values()] : [];
  for (const member of members) {
    if (!member || member.user?.bot) continue;
    const profile = memberProfiles.getProfile(member.id);
    if (profile?.timezone) {
      await releaseMemberFromTimezoneGate(member).catch(() => null);
      continue;
    }
    await lockMemberToTimezoneGate(member).catch(() => null);
  }
  return true;
}

async function hideGateChannel(guild) {
  if (!guild) return null;
  const gateChannel = findConfiguredChannel(guild, 'timezoneGate', { textOnly: true });
  if (gateChannel) await gateChannel.delete('Timezone gate hidden').catch(() => null);
  return true;
}

async function clearAllTimezoneDataAndNicknames(guild, state) {
  if (!guild) return null;
  for (const member of guild.members.cache.values()) {
    if (!member || member.user?.bot) continue;
    // Only revert a nickname that matches the old bot-owned team/timezone
    // format. A commissioner or member's chosen server nickname is theirs.
    await nicknamePolicy.syncMemberNickname(member, state).catch(() => null);
    await releaseMemberFromTimezoneGate(member).catch(() => null);
  }
  memberProfiles.clearAllTimezones();
  if (state?.players?.values) {
    for (const player of state.players.values()) {
      if (player && Object.prototype.hasOwnProperty.call(player, 'timezone')) player.timezone = null;
    }
  }
  const gateChannel = findConfiguredChannel(guild, 'timezoneGate', { textOnly: true });
  if (gateChannel) await gateChannel.delete('Timezone gate disabled').catch(() => null);
  return true;
}

module.exports = {
  GATE_CHANNEL_NAME,
  TIMEZONE_CHOICES,
  buildTimezoneSelectRow,
  ensureGateChannel,
  postGatePrompt,
  lockMemberToTimezoneGate,
  releaseMemberFromTimezoneGate,
  enforceGuildTimezoneGate,
  clearAllTimezoneDataAndNicknames,
  hideGateChannel,
  isTimezoneGateActive,
};
