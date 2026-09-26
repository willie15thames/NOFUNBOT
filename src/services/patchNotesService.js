/*
 * NAVIGATION HEADER
 * FILE: src/services/patchNotesService.js
 * LAYER: Service layer
 * PURPOSE: Tracks updates, release notes, or patch history.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const { getStaffRoles: getConfiguredStaffRoles } = require('./accessPolicyService');

const PATCH_FILE = path.join(__dirname, '..', '..', 'PATCH_NOTES_AND_CONTEXT.txt');
const CATEGORY_NAME = '🛠️ Bot Setup & Patch Notes';
const CHANNEL_NAME = 'patch-notes';

function _patchDocFiles() {
  try {
    const root = path.join(__dirname, '..', '..');
    return fs.readdirSync(root)
      .filter(name => /^PATCH_V\d+.*\.(md|txt)$/i.test(name))
      .sort((a, b) => {
        const na = Number((a.match(/^PATCH_V(\d+)/i) || [0, 0])[1]) || 0;
        const nb = Number((b.match(/^PATCH_V(\d+)/i) || [0, 0])[1]) || 0;
        return na - nb;
      })
      .map(name => path.join(root, name));
  } catch {
    return [];
  }
}

function readPatchText() {
  const parts = [];
  try { parts.push(fs.readFileSync(PATCH_FILE, 'utf8')); } catch {}
  for (const file of _patchDocFiles()) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      if (raw && !parts.includes(raw)) parts.push(raw);
    } catch {}
  }
  return parts.filter(Boolean).join('\n\n');
}

function parsePatchEntries(text) {
  const lines = String(text || '').split(/\r?\n/);
  const entries = [];
  let current = null;
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    const isHeader = /^\[.+\]/.test(line) || /^v\d+/i.test(line) || /^#+\s*/.test(line);
    if (isHeader) {
      if (current) entries.push(current);
      current = { title: line.replace(/^#+\s*/, ''), bullets: [] };
      continue;
    }
    if (!current) current = { title: 'Patch notes', bullets: [] };
    current.bullets.push(line.replace(/^[-*]\s*/, ''));
  }
  if (current) entries.push(current);
  return entries.slice(-10);
}

function buildPatchEmbeds(entries) {
  const embeds = [];
  const chunks = entries.slice(-10);
  for (let i = 0; i < chunks.length; i += 1) {
    const entry = chunks[i];
    const bullets = (entry.bullets || []).slice(-7).map(b => `• ${String(b).slice(0, 240)}`).join('\n');
    embeds.push(new EmbedBuilder()
      .setColor(i === chunks.length - 1 ? 0x2ecc71 : 0x5865f2)
      .setTitle(i === chunks.length - 1 ? `🧾 Latest Patch: ${entry.title}` : `📌 ${entry.title}`)
      .setDescription(bullets || 'No detail lines recorded for this patch entry.')
      .setFooter({ text: 'Patch notes persist across wipes unless the bot is fully uninstalled.' })
      .setTimestamp());
  }
  if (!embeds.length) {
    embeds.push(new EmbedBuilder().setColor(0x5865f2).setTitle('🧾 Patch Notes').setDescription('No patch notes have been recorded yet.').setTimestamp());
  }
  return embeds;
}

function _normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _isPatchCategoryName(value) {
  const normalized = _normalizeName(value);
  return normalized === _normalizeName(CATEGORY_NAME) || normalized === 'bot setup patch notes';
}

function _isPatchChannelName(value) {
  return _normalizeName(value) === CHANNEL_NAME;
}

function _channelRank(ch) {
  let score = 0;
  if (!ch) return score;
  if (ch.name === CATEGORY_NAME || ch.name === CHANNEL_NAME) score += 10;
  if (ch.parent?.name && _isPatchCategoryName(ch.parent.name)) score += 5;
  if (String(ch.name || '').includes('🛠️')) score += 3;
  return score;
}

async function _pickPrimaryCategory(guild) {
  const matches = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildCategory && _isPatchCategoryName(c.name))
    .sort((a, b) => (_channelRank(b) - _channelRank(a)) || (a.rawPosition - b.rawPosition));
  let cat = matches.first();
  if (!cat) {
    // V198 FIX: Use findOrCreateCategory instead of raw guild.channels.create
    const { findOrCreateCategory } = require('./baseInitService');
    cat = await findOrCreateCategory(guild, CATEGORY_NAME);
  } else if (cat.name !== CATEGORY_NAME) {
    await cat.setName(CATEGORY_NAME).catch(() => null);
  }
  if (cat) {
    const categories = [...guild.channels.cache.values()].filter(c => c.type === ChannelType.GuildCategory).sort((a,b)=>a.rawPosition-b.rawPosition);
    await cat.setPosition(Math.max(0, categories.length - 1)).catch(() => null);
    await cat.permissionOverwrites.edit(guild.roles.everyone.id, {
      ViewChannel: false,
      SendMessages: false,
      AddReactions: false,
      UseApplicationCommands: false,
      SendMessagesInThreads: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
      ReadMessageHistory: false,
    }).catch(() => null);
    const staffRoles = getConfiguredStaffRoles(guild, { includeAdministrator: true, includeManageGuild: false, includeRoleNameFallback: false });
    for (const role of staffRoles) {
      await cat.permissionOverwrites.edit(role.id, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: false,
      }).catch(() => null);
    }
    if (guild.members?.me?.id) {
      await cat.permissionOverwrites.edit(guild.members.me.id, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: true,
        ManageChannels: true,
        ManageMessages: true,
      }).catch(() => null);
    }
  }
  return { primary: cat, duplicates: matches.filter(c => !cat || c.id !== cat.id) };
}

async function ensurePatchNotesCategory(guild) {
  const { primary, duplicates } = await _pickPrimaryCategory(guild);
  for (const dup of duplicates.values()) {
    const childCount = guild.channels.cache.filter(c => c.parentId === dup.id).size;
    if (!childCount) await dup.delete('Duplicate patch-notes category cleanup').catch(() => null);
  }
  return primary;
}

async function cleanupDuplicatePatchAssets(guild, targetCategory, targetChannel) {
  const allPatchChannels = guild.channels.cache.filter(c => c.isTextBased?.() && _isPatchChannelName(c.name));
  let keeper = targetChannel || null;

  if (!keeper) {
    keeper = allPatchChannels
      .sort((a, b) => (_channelRank(b) - _channelRank(a)) || (a.rawPosition - b.rawPosition))
      .first() || null;
  }

  let archiveIndex = 1;
  for (const ch of allPatchChannels.values()) {
    if (keeper && ch.id === keeper.id) continue;
    const hasForeignMessages = await ch.messages.fetch({ limit: 5 }).then(col => [...col.values()].some(m => m.author?.id !== guild.members?.me?.id)).catch(() => false);
    if (!hasForeignMessages) {
      await ch.delete('Duplicate patch-notes channel cleanup').catch(() => null);
      continue;
    }
    if (targetCategory?.id && ch.parentId !== targetCategory.id) await ch.setParent(targetCategory.id).catch(() => null);
    await ch.setName(`${CHANNEL_NAME}-archive-${archiveIndex++}`).catch(() => null);
    await ch.permissionOverwrites.edit(guild.roles.everyone.id, {
      ViewChannel: false,
      SendMessages: false,
      AddReactions: false,
      UseApplicationCommands: false,
      SendMessagesInThreads: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
    }).catch(() => null);
  }

  const allPatchCategories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory && _isPatchCategoryName(c.name));
  for (const cat of allPatchCategories.values()) {
    if (targetCategory && cat.id === targetCategory.id) continue;
    const children = guild.channels.cache.filter(c => c.parentId === cat.id);
    for (const child of children.values()) {
      if (targetCategory?.id) await child.setParent(targetCategory.id).catch(() => null);
    }
    await cat.delete('Duplicate patch-notes category cleanup').catch(() => null);
  }

  return keeper;
}

async function _seedPatchNotesWelcome(channel) {
  return channel || null;
}

async function ensurePatchNotesChannel(guild) {
  const cat = await ensurePatchNotesCategory(guild);
  let ch = guild.channels.cache
    .filter(c => c.isTextBased?.() && _isPatchChannelName(c.name))
    .sort((a, b) => (_channelRank(b) - _channelRank(a)) || (a.rawPosition - b.rawPosition))
    .first();

  if (!ch) {
    ch = await guild.channels.create({
      name: CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: cat?.id,
      topic: 'Private bot patch notes and update log for commissioners and staff only.',
    }).catch(() => null);
  }
  if (cat?.id && ch?.parentId !== cat.id) await ch.setParent(cat.id).catch(() => null);
  ch = await cleanupDuplicatePatchAssets(guild, cat, ch);
  if (!ch) return { category: cat, channel: null };

  if (ch.name !== CHANNEL_NAME) await ch.setName(CHANNEL_NAME).catch(() => null);
  await ch.setTopic('Private bot patch notes and update log for commissioners and staff only.').catch(() => null);

  await ch.permissionOverwrites.edit(guild.roles.everyone.id, {
    ViewChannel: false,
    ReadMessageHistory: false,
    SendMessages: false,
    AddReactions: false,
    UseApplicationCommands: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: false,
  }).catch(() => null);

  const staffRoles = getConfiguredStaffRoles(guild, { includeAdministrator: true, includeManageGuild: false, includeRoleNameFallback: false });
  for (const role of staffRoles) {
    await ch.permissionOverwrites.edit(role.id, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: false,
      AddReactions: false,
      UseApplicationCommands: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
      SendMessagesInThreads: false,
      ManageMessages: true,
    }).catch(() => null);
  }

  if (guild.members?.me?.id) {
    await ch.permissionOverwrites.edit(guild.members.me.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      ManageMessages: true,
      ManageChannels: true,
    }).catch(() => null);
  }

  await ch.setPosition(0).catch(() => null);
  await _seedPatchNotesWelcome(ch).catch(() => null);

  // Register with guide lifecycle so patchNotes is tracked as a managed guide lane
  try {
    const guideLifecycle = require('./guideLifecycleService');
    if (ch?.guild?.id && ch?.id) {
      guideLifecycle.registerChannel(ch.guild.id, ch.id, 'patch-notes', {
        idleRefreshAfterMs: 0, // patch-notes never idle-refreshes — only updates on publish
      });
    }
  } catch {}

  return { category: cat, channel: ch };
}

async function publishPatchNotes(guild, opts = {}) {
  const ensured = await ensurePatchNotesChannel(guild);
  let channel = ensured?.channel || null;
  if (!channel) return null;
  await new Promise(r => setTimeout(r, 300));
  channel = guild.channels.cache.get(channel.id) || channel;
  const entries = parsePatchEntries(readPatchText());
  const recentEntries = entries.slice(-10);
  const embeds = buildPatchEmbeds(recentEntries).slice(-10);
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  for (const msg of (recent ? [...recent.values()] : [])) {
    if (msg.author?.id === guild.members?.me?.id) await msg.delete().catch(() => null);
  }
  // Chronological release feed: oldest retained entry first, newest patch posted last.
  for (const embed of embeds) {
    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
      flags: MessageFlags.SuppressNotifications,
    }).catch((err) => { throw err; });
  }
  const after = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const botMsgs = after ? [...after.values()].filter(m => m.author?.id === guild.members?.me?.id).sort((a,b)=>b.createdTimestamp-a.createdTimestamp) : [];
  for (const msg of botMsgs.slice(10)) await msg.delete().catch(() => null);
  return channel;
}


function isProtectedPatchAsset(ch) {
  if (!ch) return false;
  const name = _normalizeName(ch.name);
  const parent = _normalizeName(ch.parent?.name);
  return _isPatchChannelName(name) || name === _normalizeName('setup-wizard') || _isPatchCategoryName(parent) || _isPatchCategoryName(name);
}

module.exports = {
  CATEGORY_NAME,
  CHANNEL_NAME,
  readPatchText,
  parsePatchEntries,
  buildPatchEmbeds,
  ensurePatchNotesCategory,
  ensurePatchNotesChannel,
  cleanupDuplicatePatchAssets,
  publishPatchNotes,
  isProtectedPatchAsset,
};
