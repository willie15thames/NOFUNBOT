/*
 * NAVIGATION HEADER
 * FILE: src/services/rulesGuideService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { EmbedBuilder } = require('discord.js');

const MEMBER_COMMANDS = [
  { cmd: '/join-league', desc: 'Open the guided league + team join flow.' },
  { cmd: '/select-team', desc: 'Claim a team slot in your league.' },
  { cmd: '/open-teams', desc: 'See which teams are still available.' },
  { cmd: '/respond', desc: 'Acknowledge your weekly game inside your game channel.' },
  { cmd: '/report-result', desc: 'Submit your game result when finished.' },
  { cmd: '/propose-trade', desc: 'Create a trade proposal for review.' },
  { cmd: '/my-streams', desc: 'Check your current stream progress.' },
  { cmd: '/stream-board', desc: 'View stream reward progress and milestones.' },
  { cmd: '/rewards-board', desc: 'View rewards, POTW, and award boards.' },
  { cmd: '/claim-attr-boost', desc: 'Claim earned attribute boosts if enabled.' },
  { cmd: '/set-timezone', desc: 'Update your scheduling timezone.' },
];

const MEMBER_ACTIONS = [
  'Claim your team and set your timezone.',
  'Schedule your matchup within the required window.',
  'Use your private weekly game channel to coordinate with your opponent.',
  'Report results when your game is complete.',
  'Use only league channels and commands that are visible to you.',
];

function visibleChannelMentions(builtChannels = {}) {
  const blocked = new Set(['commissioner-ai', 'admin-hq', 'commish-hub', 'scoresheets']);
  const order = Object.entries(builtChannels)
    .filter(([key, ch]) => ch && !blocked.has(key))
    .map(([, ch]) => `<#${ch.id}>`);
  return order.length ? order.join(' • ') : 'League channels will appear here when your league finishes setup.';
}

function buildMemberGuideEmbed(leagueName, builtChannels = {}) {
  const commandLines = MEMBER_COMMANDS.map(c => `• **${c.cmd}** — ${c.desc}`).join('\n');
  const actionLines = MEMBER_ACTIONS.map(a => `• ${a}`).join('\n');

  return new EmbedBuilder()
    .setColor(0x1f4b99)
    .setTitle(`📘 ${leagueName} — Member Commands & Actions`)
    .setDescription('Below is the **member-only** command and action list for this league. It intentionally excludes staff/admin tools, staff-only procedures, and hidden channels.')
    .addFields(
      { name: 'Visible League Channels', value: visibleChannelMentions(builtChannels) },
      { name: 'Member Slash Commands', value: commandLines },
      { name: 'Member Actions', value: actionLines },
    )
    .setFooter({ text: 'Staff/admin actions are intentionally excluded from member-facing rules channels.' })
    .setTimestamp();
}

module.exports = {
  buildMemberGuideEmbed,
  MEMBER_COMMANDS,
  MEMBER_ACTIONS,
};
