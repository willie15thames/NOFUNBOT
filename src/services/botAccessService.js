/*
 * NAVIGATION HEADER
 * FILE: src/services/botAccessService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { makeLogger } = require('../utils/logger');
const { STAFF_REPAIR_CHANNEL_KEYS } = require('../config/channels');
const { matchesConfiguredChannel } = require('./channelTopologyService');
const log = makeLogger('botAccess');

const BOT_CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.UseApplicationCommands,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.AddReactions,
];

const COMM_CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.UseApplicationCommands,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AddReactions,
];

function isSupportedRepairChannel(channel) {
  return !!channel && [ChannelType.GuildText, ChannelType.GuildCategory, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildStageVoice, ChannelType.GuildMedia].includes(channel.type);
}
function shouldRepairCommissionerAccess(channel) { return STAFF_REPAIR_CHANNEL_KEYS.some(key => matchesConfiguredChannel(channel, key)); }

async function lockBotAccessOnChannel(channel, guild) {
  try {
    const me = guild?.members?.me;
    if (!me?.id || !channel?.permissionOverwrites?.edit) return;
    await channel.permissionOverwrites.edit(me.id, Object.fromEntries(BOT_CHANNEL_PERMISSIONS.map(permission => [permission, true]))).catch(() => null);
  } catch (err) {
    log.warn(`lockBotAccessOnChannel failed on ${channel?.name}: ${err.message}`);
  }
}

async function lockBotAccessGuildWide(guild, commRoleId) {
  try {
    const me = guild?.members?.me;
    if (!me?.id) return 0;
    const channels = [...guild.channels.cache.values()].filter(isSupportedRepairChannel);
    let fixed = 0;
    for (const channel of channels) {
      const currentPerms = channel.permissionOverwrites?.cache?.get(me.id);
      const needsFix = !currentPerms || BOT_CHANNEL_PERMISSIONS.some(permission => !currentPerms.allow?.has?.(permission));
      if (needsFix) {
        await channel.permissionOverwrites.edit(me.id, Object.fromEntries(BOT_CHANNEL_PERMISSIONS.map(permission => [permission, true]))).catch(() => null);
        fixed += 1;
      }
      if (commRoleId && shouldRepairCommissionerAccess(channel)) {
        const commPerms = channel.permissionOverwrites?.cache?.get(commRoleId);
        const needsCommFix = !commPerms || COMM_CHANNEL_PERMISSIONS.some(permission => !commPerms.allow?.has?.(permission));
        if (needsCommFix) await channel.permissionOverwrites.edit(commRoleId, Object.fromEntries(COMM_CHANNEL_PERMISSIONS.map(permission => [permission, true]))).catch(() => null);
      }
    }
    if (fixed > 0) log.info(`Bot access lock: re-applied on ${fixed} channel(s).`);
    return fixed;
  } catch (err) {
    log.warn('lockBotAccessGuildWide failed:', err.message);
    return 0;
  }
}

function checkBotGuildAdmin(guild) {
  const me = guild?.members?.me;
  if (!me) return false;
  return me.permissions?.has?.(PermissionFlagsBits.Administrator) ?? false;
}

function botAccessOverwrite(guild) {
  const me = guild?.members?.me;
  if (!me?.id) return null;
  return { id: me.id, allow: BOT_CHANNEL_PERMISSIONS };
}
function commAccessOverwrite(guild, commRoleId) {
  if (!commRoleId) return null;
  return { id: commRoleId, allow: COMM_CHANNEL_PERMISSIONS };
}

module.exports = { lockBotAccessOnChannel, lockBotAccessGuildWide, checkBotGuildAdmin, botAccessOverwrite, commAccessOverwrite, shouldRepairCommissionerAccess, BOT_CHANNEL_PERMISSIONS, COMM_CHANNEL_PERMISSIONS };
