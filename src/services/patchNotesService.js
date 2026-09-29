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

const PATCH_FILE = path.join(__dirname, '..', '..', 'PUBLIC_PATCH_NOTES.md');
const CATEGORY_NAME = '🛠️ Bot Setup & Patch Notes';
const CHANNEL_NAME = 'patch-notes';

function _patchDocFiles() {
  // Public Discord patch notes deliberately do not read internal PATCH_V*,
  // PATCH_NOTES_AND_CONTEXT.txt, changelog.txt, RC notes, or test history.
  return [];
}

function readPatchText() {
  try { return fs.readFileSync(PATCH_FILE, 'utf8'); }
  catch { return ''; }
}

function _publicPublishingEnabled() {
  const { toBoolean } = require('../config/featureFlags');
  return String(process.env.APP_ENV || '').toLowerCase() === 'production'
    && toBoolean(process.env.PUBLIC_PATCH_NOTES_ENABLED, true);
}

function _publicVersion() {
  return String(process.env.PUBLIC_RELEASE_VERSION || '1.0.0').trim() || '1.0.0';
}

async function _alreadyPublished(guildId, version) {
  const { getPrisma } = require('../storage/prisma');
  const prisma = getPrisma();
  if (!prisma) return { known: false, published: false, reason: 'database-unavailable' };
  try {
    const key = `public-patch:${guildId}:${version}`;
    const row = await prisma.botKv.findUnique({ where: { key } });
    return { known: true, published: !!row, key, prisma };
  } catch {
    return { known: false, published: false, reason: 'publication-check-failed' };
  }
}

async function _markPublished(guildId, version) {
  const { getPrisma } = require('../storage/prisma');
  const prisma = getPrisma();
  if (!prisma) return false;
  const key = `public-patch:${guildId}:${version}`;
  try {
    await prisma.botKv.upsert({
      where: { key },
      create: {
        key,
        value: { guildId: String(guildId), version: String(version), publishedAt: new Date().toISOString() },
        source: 'public-release',
      },
      update: {
        value: { guildId: String(guildId), version: String(version), publishedAt: new Date().toISOString() },
        source: 'public-release',
      },
    });
    return true;
  } catch {
    return false;
  }
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
    // G3: patch notes no longer imports baseInitService. This avoids a service cycle while
    // retaining exact-name reuse and Discord-side creation as this service's own asset authority.
    cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && _normalizeName(c.name) === _normalizeName(CATEGORY_NAME));
    if (!cat) cat = await guild.channels.create({ name: CATEGORY_NAME, type: ChannelType.GuildCategory });
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
  if (!_publicPublishingEnabled() && !opts.forcePublic) return null;

  const version = _publicVersion();
  const publication = await _alreadyPublished(guild.id, version);

  // In production fail closed when durable publication state cannot be checked.
  // This prevents deploy/restart loops from spamming the public patch lane.
  if (!opts.forcePublic && !publication.known) return null;
  if (!opts.forcePublic && publication.published) return null;

  const ensured = await ensurePatchNotesChannel(guild);
  let channel = ensured?.channel || null;
  if (!channel) return null;

  await new Promise(r => setTimeout(r, 300));
  channel = guild.channels.cache.get(channel.id) || channel;

  const entries = parsePatchEntries(readPatchText());
  const embeds = buildPatchEmbeds(entries).slice(-10);
  if (!embeds.length) return null;

  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  for (const msg of (recent ? [...recent.values()] : [])) {
    if (msg.author?.id === guild.members?.me?.id) await msg.delete().catch(() => null);
  }

  for (const embed of embeds) {
    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
      flags: MessageFlags.SuppressNotifications,
    });
  }

  await _markPublished(guild.id, version);
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
