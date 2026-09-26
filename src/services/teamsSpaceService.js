/*
 * NAVIGATION HEADER
 * FILE: src/services/teamsSpaceService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * teamsSpaceService.js
 * Teams Space: auto-generated Discord category per team in a league-enabled community.
 * Each team gets its own private category visible only to team members.
 * This is NOT /select-team — this is the structural space for team collaboration.
 *
 * Hierarchy: Community → League → Team → Team Space (category + channels)
 */

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('teamsSpace');

// Channels created in each team space
const TEAM_SPACE_CHANNELS = [
  ['team-chat',       'General team discussion and coordination.',    false],
  ['team-strategy',   'Plays, plans, and matchup prep.',              false],
  ['team-results',    'Game results and performance notes.',          true],  // read-only from bot
  ['team-roster',     'Roster and availability updates.',             true],
];

/**
 * Get or create a role for a team.
 */
async function ensureTeamRole(guild, teamName) {
  const roleName = `Team • ${teamName}`;
  let role = guild.roles.cache.find(r => r.name === roleName);
  if (!role) {
    role = await guild.roles.create({
      name: roleName,
      mentionable: true,
      reason: `Auto-created team role for ${teamName}`,
    }).catch(() => null);
  }
  return role;
}

/**
 * Build permission overwrites for a team category/channel.
 * Only the team role + bot + commissioner can see it.
 */
function teamCategoryOverwrites(guild, teamRole, commRoleId) {
  const me = guild.members?.me;
  const overwrites = [
    // Lock everyone out by default
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
  ];
  // Bot always has access
  if (me?.id) {
    overwrites.push({
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.UseApplicationCommands,
      ],
    });
  }
  // Commissioner role has access
  if (commRoleId) {
    overwrites.push({
      id: commRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }
  // Team role has access
  if (teamRole?.id) {
    overwrites.push({
      id: teamRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.UseApplicationCommands,
      ],
    });
  }
  return overwrites;
}

/**
 * Create a team space (category + channels) for a given team.
 * Returns the created category.
 */
async function createTeamSpace(guild, teamName, commRoleId) {
  try {
    const teamRole = await ensureTeamRole(guild, teamName);
    const catName = `🏟️ ${teamName}`;
    const overwrites = teamCategoryOverwrites(guild, teamRole, commRoleId);

    // V198 FIX: Use findOrCreateCategory instead of raw guild.channels.create
    const { findOrCreateCategory } = require('./baseInitService');
    const cat = await findOrCreateCategory(guild, catName, overwrites);
    if (!cat) return null;

    // Create team channels under the category
    for (const [chName, topic, readOnly] of TEAM_SPACE_CHANNELS) {
      const existing = guild.channels.cache.find(
        c => c.isTextBased?.() && c.name === chName && c.parentId === cat.id
      );
      if (existing) continue;
      await guild.channels.create({
        name: chName,
        type: ChannelType.GuildText,
        parent: cat.id,
        topic,
        permissionOverwrites: overwrites,
        reason: `Team space channel for ${teamName}`,
      }).catch(() => null);
    }

    log.info(`Team space created: ${catName}`);
    return { category: cat, role: teamRole };
  } catch (err) {
    log.error(`createTeamSpace failed for ${teamName}:`, err.message);
    return null;
  }
}

/**
 * Delete a team space (category + all channels + role).
 */
async function deleteTeamSpace(guild, teamName) {
  const catName = `🏟️ ${teamName}`;
  const roleName = `Team • ${teamName}`;

  const cat = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === catName
  );
  if (cat) {
    const children = guild.channels.cache.filter(c => c.parentId === cat.id);
    for (const ch of children.values()) {
      await ch.delete(`Team space removed: ${teamName}`).catch(() => null);
    }
    await cat.delete(`Team space removed: ${teamName}`).catch(() => null);
  }

  const role = guild.roles.cache.find(r => r.name === roleName);
  if (role) await role.delete(`Team role removed: ${teamName}`).catch(() => null);

  log.info(`Team space deleted: ${teamName}`);
  return true;
}

/**
 * Assign a member to a team space (give them the team role).
 */
async function assignMemberToTeam(member, teamName) {
  const roleName = `Team • ${teamName}`;
  const role = member.guild.roles.cache.find(r => r.name === roleName);
  if (!role) return { ok: false, reason: 'team-role-not-found' };
  if (member.roles.cache.has(role.id)) return { ok: true, skipped: true };
  await member.roles.add(role, `Joined team: ${teamName}`).catch(() => null);
  return { ok: true, teamName, roleId: role.id };
}

/**
 * Remove a member from a team space.
 */
async function removeMemberFromTeam(member, teamName) {
  const roleName = `Team • ${teamName}`;
  const role = member.guild.roles.cache.find(r => r.name === roleName);
  if (!role || !member.roles.cache.has(role.id)) return { ok: true, skipped: true };
  await member.roles.remove(role, `Left team: ${teamName}`).catch(() => null);
  return { ok: true };
}

module.exports = {
  TEAM_SPACE_CHANNELS,
  ensureTeamRole,
  createTeamSpace,
  deleteTeamSpace,
  assignMemberToTeam,
  removeMemberFromTeam,
};
