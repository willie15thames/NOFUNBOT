/*
 * NAVIGATION HEADER
 * FILE: src/services/leagueVisibilityService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const activeLeagueService = require('./activeLeagueService');

function _isStaffOnlyChannel(ch) {
  const name = String(ch?.name || '').toLowerCase();
  const parent = String(ch?.parent?.name || '').toLowerCase();
  return /admin|commissioner|commish|scoresheets|staff/.test(name) || /admin|staff/.test(parent);
}



function _isReadOnlyChannel(ch) {
  const name = String(ch?.name || '').toLowerCase();
  return /(^|\.)(rules|announcements|server-guide|open-teams)$/.test(name) || /(^|\b)(rules|announcements|server-guide)$/.test(name);
}

async function grantMemberAccessToLeague(guild, member, state, leagueId = null) {
  const target = leagueId
    ? activeLeagueService.getLeague(leagueId)
    : activeLeagueService.getCurrentLeagueFallback(state);

  if (!target) return { granted: 0, reason: 'no-league' };

  let granted = 0;
  for (const chId of target.builtChannelIds || []) {
    const ch = guild.channels.cache.get(chId);
    if (!ch || _isStaffOnlyChannel(ch)) continue;
    const perms = { ViewChannel: true, ReadMessageHistory: true };
    if (!_isReadOnlyChannel(ch)) perms.SendMessages = true;
    await ch.permissionOverwrites.edit(member.id, perms).catch(() => null);
    granted++;
  }

  return { granted, league: target };
}

module.exports = {
  grantMemberAccessToLeague,
};
