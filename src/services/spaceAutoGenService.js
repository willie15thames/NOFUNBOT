/*
 * NAVIGATION HEADER
 * FILE: src/services/spaceAutoGenService.js
 * LAYER: Service layer
 * PURPOSE: Auto-generates channels when a community is created. Users see channels, not "spaces".
 * LOOK HERE FIRST WHEN DEBUGGING: Search for generateCommunityChannels.
 * RELATED FLOW: interactionRouter.js (/setup-community), communityAccessService.js.
 * NOTE: V198 — uses findOrCreateCategory from baseInitService to prevent duplicate categories.
 */

'use strict';
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('spaceAutoGen');

// Space templates by community type — these build actual Discord channels
const SPACE_TEMPLATES = {
  'social': [
    ['general',          'Community chat and hangout.',                false],
    ['introductions',    'Introduce yourself to the community.',       false],
    ['off-topic',        'Anything goes (within server rules).',       false],
    ['media-share',      'Memes, clips, and media drops.',             false],
    ['announcements',    'Community announcements.',                   true],
  ],
  'league': [
    ['league-chat',      'General league discussion.',                 false],
    ['scores-and-standings', 'Live scores and current standings.',     true],
    ['schedule-board',   'Weekly matchup schedule.',                  true],
    ['trash-talk',       'Pre-game and post-game banter.',             false],
    ['trade-block',      'Trade proposals and discussion.',            false],
    ['league-announcements', 'Official league updates.',              true],
  ],
  'league-enabled': [
    ['league-chat',      'General league discussion.',                 false],
    ['scores-and-standings', 'Live scores and current standings.',     true],
    ['schedule-board',   'Weekly matchup schedule.',                  true],
    ['trash-talk',       'Pre-game and post-game banter.',             false],
    ['trade-block',      'Trade proposals and discussion.',            false],
    ['league-announcements', 'Official league updates.',              true],
  ],
  'competitive': [
    ['team-chat',        'Competitive discussion.',                    false],
    ['matchup-board',    'Upcoming and recent matchups.',              true],
    ['vod-review',       'Video review and breakdown.',                false],
    ['recruiting',       'Open roster spots and tryouts.',             false],
    ['results',          'Match results and records.',                 true],
  ],
  'events': [
    ['event-chat',       'Event discussion and planning.',             false],
    ['event-calendar',   'Upcoming events and schedule.',              true],
    ['event-signups',    'RSVP and event registration.',               false],
    ['event-highlights', 'Recap and highlights from past events.',     true],
    ['watch-party',      'Live reaction during events.',               false],
  ],
  'event-driven': [
    ['event-chat',       'Event discussion and planning.',             false],
    ['event-calendar',   'Upcoming events and schedule.',              true],
    ['event-signups',    'RSVP and event registration.',               false],
    ['event-highlights', 'Recap and highlights from past events.',     true],
    ['watch-party',      'Live reaction during events.',               false],
  ],
  'fanzone': [
    ['fan-chat',         'Fan discussion and hype.',                   false],
    ['media-dump',       'Fan art, clips, memes.',                     false],
    ['news-feed',        'Latest news and updates.',                   true],
    ['debate-zone',      'Hot takes and debates.',                     false],
    ['lore-deep-dive',   'Lore, history, and background.',             false],
  ],
  'edu': [
    ['study-chat',       'Study discussion and collaboration.',        false],
    ['resource-share',   'Resources, links, and guides.',              false],
    ['q-and-a',          'Ask questions and get help.',                false],
    ['progress-check',   'Share progress and goals.',                  false],
    ['announcements',    'Course and community announcements.',        true],
  ],
  'wellness': [
    ['check-in',         'Daily check-in and support.',                false],
    ['safe-space',       'A kind, judgment-free zone.',                false],
    ['resources',        'Mental health and wellness resources.',      true],
    ['gratitude-log',    'Daily gratitude and wins.',                  false],
  ],
  // Default fallback
  'community-driven': [
    ['general',          'Community chat.',                            false],
    ['media-share',      'Media and links.',                           false],
    ['announcements',    'Community updates.',                         true],
  ],
};

/**
 * Get the channel specs for a community type.
 * Falls back to community-driven if type not found.
 */
function getSpaceChannels(communityType) {
  const type = String(communityType || '').toLowerCase().replace(/[-\s]+/g, '-');
  return SPACE_TEMPLATES[type] || SPACE_TEMPLATES['community-driven'];
}

/**
 * Build permission overwrites for a community category.
 */
function communityOverwrites(guild, communityRole, commRoleId) {
  const me = guild.members?.me;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
  ];
  if (me?.id) {
    overwrites.push({
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.UseApplicationCommands,
      ],
    });
  }
  if (commRoleId) {
    overwrites.push({
      id: commRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
    });
  }
  if (communityRole?.id) {
    overwrites.push({
      id: communityRole.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions,
              PermissionFlagsBits.UseApplicationCommands],
    });
  }
  return overwrites;
}

/**
 * Auto-generate channels for a community.
 * Called when /setup-community creates a new community — users see channels, not "spaces".
 */
async function generateCommunityChannels(guild, communityName, communityType, commRoleId) {
  try {
    const channels = getSpaceChannels(communityType);
    const catName = communityName;
    const { findOrCreateCategory, findOrCreateText } = require('./baseInitService');

    // Ensure community role exists
    const roleName = `Community • ${communityName}`;
    let communityRole = guild.roles.cache.find(r => r.name === roleName);
    if (!communityRole) {
      communityRole = await guild.roles.create({
        name: roleName,
        mentionable: false,
        reason: `Community role: ${communityName}`,
      }).catch(() => null);
    }

    const overwrites = communityOverwrites(guild, communityRole, commRoleId);

    // V198 FIX: Use findOrCreateCategory instead of raw guild.channels.create
    const cat = await findOrCreateCategory(guild, catName, overwrites);
    if (!cat) return null;

    // V198 FIX: Use findOrCreateText for global dedup — channels found under other parents are moved
    const created = [];
    for (const [chName, topic, readOnly] of channels) {
      const opts = readOnly ? { readOnly: true } : {};
      const ch = await findOrCreateText(guild, cat, chName, topic, opts);
      // Only count as "created" if it didn't already exist in cache before this call
      if (ch) created.push(ch.name);
    }

    log.info(`Auto-generated ${created.length} channel(s) for community: ${communityName}`);
    return { category: cat, role: communityRole, channels: created };
  } catch (err) {
    log.error(`generateCommunityChannels failed for ${communityName}:`, err.message);
    return null;
  }
}

/**
 * Delete all channels and category for a community.
 */
async function deleteCommunityChannels(guild, communityName) {
  const cat = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === communityName
  );
  if (cat) {
    const children = guild.channels.cache.filter(c => c.parentId === cat.id);
    for (const ch of children.values()) {
      await ch.delete(`Community deleted: ${communityName}`).catch(() => null);
    }
    await cat.delete(`Community deleted: ${communityName}`).catch(() => null);
  }

  const roleName = `Community • ${communityName}`;
  const role = guild.roles.cache.find(r => r.name === roleName);
  if (role) await role.delete(`Community deleted: ${communityName}`).catch(() => null);

  return true;
}

module.exports = { SPACE_TEMPLATES, getSpaceChannels, generateCommunityChannels, deleteCommunityChannels };
