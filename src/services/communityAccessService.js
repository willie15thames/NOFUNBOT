/*
 * NAVIGATION HEADER
 * FILE: src/services/communityAccessService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const { ChannelType, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const serverSettings = require('./serverSettingsService');
const memberProfiles = require('./memberProfileService');
const { getSelectorCommunities, classifySpace } = require('./architectureSemanticsService');

const CHANNEL_NAME = 'community-selector';
const TOPIC = 'Choose the communities and spaces you belong to. You can come back here any time to update access.';

function _selectorEnabled(settings = serverSettings.getSettings()) {
  // FIX: Use stateService to enforce selector-only-after-communities-exist rule
  try {
    const stateService = require('./stateService');
    return stateService.selectorIsReady(settings?.guildId || null);
  } catch {
    return !!(settings?.serverInitialized && getAvailableCommunities(settings).length);
  }
}

function _slug(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

function getAvailableCommunities(settings = serverSettings.getSettings()) {
  return getSelectorCommunities(settings);
}

async function ensureSelectorChannel(guild) {
  if (!guild) return null;
  if (!_selectorEnabled()) return null;
  let ch = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === CHANNEL_NAME);
  if (!ch) {
    ch = await guild.channels.create({
      name: CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: TOPIC,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
        ...(guild.members?.me?.id ? [{ id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.UseApplicationCommands] }] : [])
      ]
    }).catch(() => null);
  }
  if (!ch) return null;
  await ch.setTopic(TOPIC).catch(() => null);
  return ch;
}

async function ensureCommunityRoles(guild, settings = serverSettings.getSettings()) {
  const communities = getAvailableCommunities(settings);
  const map = new Map();
  for (const community of communities) {
    const roleName = `Community • ${community.name}`;
    let role = guild.roles.cache.find(r => r.name === roleName);
    if (!role) role = await guild.roles.create({ name: roleName, mentionable: false, reason: 'Community access role' }).catch(() => null);
    if (role) map.set(community.key, role);
  }
  return { communities, roles: map };
}

function buildSelectorPayload(settings = serverSettings.getSettings(), note = '') {
  const communities = _selectorEnabled(settings) ? getAvailableCommunities(settings) : [];
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🧩 Community Access')
    .setDescription(communities.length
      ? 'Choose the communities you want access to. You can come back and change this later.'
      : 'This server does not currently expose separate community spaces for access selection.')
    .setFooter({ text: 'Use the selector below any time to update your spaces.' })
    .setTimestamp();
  const components = [];
  if (communities.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('community_membership_select')
        .setPlaceholder('Choose your communities and spaces...')
.setMinValues(0)
        .setMaxValues(Math.min(communities.length, 10))
        .addOptions(communities.map(c => ({ label: c.name.slice(0, 100), value: c.key, description: String(c.description || `Access for ${c.name}`).slice(0, 100) })))
    ));
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

async function postSelectorPanel(guild, note = '') {
  // Hierarchy Rules 1 & 2: no selector without template + communities
  const _settings = serverSettings.getSettings();
  if (!_settings.serverTemplate || !getAvailableCommunities(_settings).length) return null;
  const settings = serverSettings.getSettings();
  if (!_selectorEnabled(settings)) {
    const existing = guild?.channels?.cache?.find?.(c => c.type === ChannelType.GuildText && c.name === CHANNEL_NAME);
    if (existing) await existing.delete('Community selector hidden until server communities exist').catch(() => null);
    return null;
  }
  const ch = await ensureSelectorChannel(guild);
  if (!ch) return null;
  const payload = buildSelectorPayload(settings, "");
  const recent = await ch.messages.fetch({ limit: 20 }).catch(() => null);
  let msg = recent ? [...recent.values()].find(m => m.author?.id === guild.members?.me?.id && /Community Access/i.test(String(m.embeds?.[0]?.title || ''))) : null;
  if (msg) {
    await msg.edit(payload).catch(() => null);
    return msg;
  }
  const sendMessageService = require('./sendMessageService');
  return sendMessageService.send(ch, payload, { action: 'community-selector-panel' });
}


async function syncCommunityChannelPermissions(guild, settings = serverSettings.getSettings()) {
  if (!guild) return { ok: false };
  const { communities, roles } = await ensureCommunityRoles(guild, settings);
  const roleMap = new Map(communities.map(c => [c.key, roles.get(c.key)]).filter(([, role]) => role));
  const channels = [...guild.channels.cache.values()].filter(ch => ch?.permissionOverwrites?.edit && ch.type !== ChannelType.GuildCategory && ch.name !== CHANNEL_NAME);
  for (const ch of channels) {
    if (require('./activeLeagueService').findLeagueForChannel(ch)) continue; // Space membership is exclusive; community roles must never grant access.
    const label = classifySpace(ch.name, settings);
    if (!label?.key) continue;
    const role = roleMap.get(label.key);
    if (!role) continue;
    await ch.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false }).catch(() => null);
    await ch.permissionOverwrites.edit(role.id, { ViewChannel: true, ReadMessageHistory: true, SendMessages: true, UseApplicationCommands: true }).catch(() => null);
    if (guild.members?.me?.id) await ch.permissionOverwrites.edit(guild.members.me.id, { ViewChannel: true, ReadMessageHistory: true, SendMessages: true, UseApplicationCommands: true, ManageChannels: true, ManageMessages: true }).catch(() => null);
  }
  return { ok: true, communities };
}

async function applyCommunityMembership(member, values = []) {
  if (!member?.guild) return { ok: false, reason: 'no-member' };
  // FIX 3: Check all gates are resolved before granting access
  try {
    const stateService = require('./stateService');
    const access = stateService.resolveUserAccess(member.id, member.guild.id);
    if (!access.clear && access.gate !== 'community') {
      // Timezone gate or setup gate is blocking — don't grant community access yet
      return { ok: false, reason: `gate-blocked:${access.gate}`, message: access.reason };
    }
  } catch (_e) { /* gate check failures are non-fatal */ }
  const settings = serverSettings.getSettings();
  const { communities, roles } = await ensureCommunityRoles(member.guild, settings);
  const wanted = new Set((Array.isArray(values) ? values : []).map(_slug));
  const profile = memberProfiles.getProfile(member.id) || {};
  memberProfiles.upsertProfile(member.id, { communities: [...wanted], lastCommunitySyncAt: Date.now(), lastSeenDisplayName: profile.lastSeenDisplayName || member.displayName || member.user?.username || 'member' });
  for (const community of communities) {
    const role = roles.get(community.key);
    if (!role) continue;
    if (wanted.has(community.key)) {
      if (!member.roles.cache.has(role.id)) await member.roles.add(role).catch(() => null);
    } else if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role).catch(() => null);
    }
  }
  await syncCommunityChannelPermissions(member.guild, settings).catch(() => null);
  return { ok: true, selected: communities.filter(c => wanted.has(c.key)).map(c => c.name), communities };
}

module.exports = { CHANNEL_NAME, getAvailableCommunities, ensureSelectorChannel, ensureCommunityRoles, buildSelectorPayload, postSelectorPanel, applyCommunityMembership, syncCommunityChannelPermissions };
