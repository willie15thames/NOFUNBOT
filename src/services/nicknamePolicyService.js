/*
 * NAVIGATION HEADER
 * FILE: src/services/nicknamePolicyService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const memberProfiles = require('./memberProfileService');
const activeLeagueService = require('./activeLeagueService');

function timezoneLabel(timezone) {
  const raw = String(timezone || '').trim();
  if (!raw) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: raw, timeZoneName: 'short' }).formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value || raw;
  } catch {
    return raw.split('/').pop().replace(/_/g, ' ');
  }
}

function stripTimezoneSuffix(name = '') {
  return String(name || '').replace(/\s*\((?:[A-Z]{2,5}|UTC[+-]?\d+|GMT[+-]?\d+)\)\s*$/i, '').trim();
}

function _allLeagueEntriesForMember(state, memberId) {
  const openTeams = Array.isArray(state?.openTeamRegistry) ? state.openTeamRegistry : [];
  const direct = openTeams.filter(entry => String(entry?.ownerId || '') === String(memberId));
  if (direct.length) return direct;
  const players = [...(state?.players?.values?.() || [])].filter(p => String(p?.userId || '') === String(memberId));
  return players.map(p => ({ leagueId: p.leagueId || null, displayTeam: p.displayTeam || p.baseTeam || null, baseTeam: p.baseTeam || null }));
}

function resolveLeagueContext(state, channelOrId) {
  return activeLeagueService.findLeagueForChannel(channelOrId);
}

function getLeagueDisplayForMember(state, memberId, channelOrId = null) {
  const entries = _allLeagueEntriesForMember(state, memberId);
  if (!entries.length) return null;
  const league = resolveLeagueContext(state, channelOrId);
  if (league) {
    const match = entries.find(entry => String(entry?.leagueId || '') === String(league.id));
    if (match) return match.displayTeam || match.baseTeam || null;
  }
  if (entries.length === 1) return entries[0].displayTeam || entries[0].baseTeam || null;
  return null;
}

function getDisplayForLeague(state, memberId, leagueId) {
  const entry = _allLeagueEntriesForMember(state, memberId)
    .find(item => String(item.leagueId || '') === String(leagueId || ''));
  return entry?.displayTeam || entry?.baseTeam || null;
}

function buildDesiredNickname(member, state, opts = {}) {
  const profile = memberProfiles.getProfile(member?.id);
  const label = profile?.timezoneLabel || timezoneLabel(profile?.timezone);
  if (!label) return null;
  const assignment = profile?.botNicknameAssignment;
  const original = assignment?.status === 'ASSIGNED'
    ? assignment.originalNickname
    : (String(member?.nickname || '').trim() || null);
  const base = stripTimezoneSuffix(original || profile?.lastSeenDisplayName || member?.user?.globalName || member?.user?.username || 'Member');
  const suffix = ` (${String(label).toUpperCase()})`;
  const maxBase = Math.max(1, 32 - suffix.length);
  return `${base.slice(0, maxBase).trim()}${suffix}`.slice(0,32);
}

async function syncMemberNickname(member, state, opts = {}) {
  if (!member) return { ok:false, reason:'missing-member' };
  const current = String(member.nickname || '').trim();
  const profile = memberProfiles.getProfile(member.id) || {};
  const assignment = profile.botNicknameAssignment;
  const timezone = profile.timezone;

  // Clearing timezone restores only a nickname the bot can prove it owns.
  if (!timezone) {
    const proven = assignment && String(assignment.guildId) === String(member.guild?.id)
      && assignment.value === current && assignment.status === 'ASSIGNED';
    if (!proven) return { ok:true, skipped:true, reason:'custom-nickname-preserved' };
    if (!member.manageable) return { ok:false, reason:'not-manageable', action:'restore nickname through a server admin with a higher role' };
    try {
      await member.setNickname(assignment.originalNickname || null, 'Restore nickname after timezone removal');
      memberProfiles.upsertProfile(member.id,{ botNicknameAssignment:{...assignment,status:'RESTORED',restoredAt:Date.now()} });
      return { ok:true, restored:true };
    } catch (err) { return { ok:false, reason:err.message }; }
  }

  const desired = buildDesiredNickname(member, state, opts);
  if (!desired) return { ok:true, skipped:true, reason:'no-timezone-label' };
  if (current === desired) return { ok:true, skipped:true, reason:'already-synced', value:desired };

  // If the bot previously assigned a nickname but the member/staff changed it manually,
  // do not clobber that manual choice. A fresh onboarding assignment is allowed when
  // there is no active bot-owned assignment.
  if (assignment?.status === 'ASSIGNED' && assignment.value !== current) {
    return { ok:true, skipped:true, reason:'manual-nickname-change-preserved' };
  }
  if (!member.manageable) return { ok:false, reason:'not-manageable', action:'move the bot role above the member role or let staff set the suffix manually' };

  const originalNickname = assignment?.status === 'ASSIGNED' ? assignment.originalNickname : (current || null);
  try {
    await member.setNickname(desired, opts.reason || 'Timezone onboarding sync');
    memberProfiles.upsertProfile(member.id, {
      botNicknameAssignment:{
        guildId:String(member.guild?.id || ''),
        value:desired,
        originalNickname,
        status:'ASSIGNED',
        assignedAt:Date.now(),
        reason:opts.reason || 'timezone-sync',
      },
    });
    return { ok:true, assigned:true, value:desired, originalNickname };
  } catch (err) { return { ok:false, reason:err.message }; }
}

async function syncGuildNicknames(guild, state) {
  const out = [];
  for (const member of guild.members.cache.values()) {
    const profile = memberProfiles.getProfile(member.id);
    if (!profile?.timezone && !profile?.teamDisplay) continue;
    out.push(await syncMemberNickname(member, state));
  }
  return out;
}

module.exports = { timezoneLabel, stripTimezoneSuffix, buildDesiredNickname, syncMemberNickname, syncGuildNicknames, resolveLeagueContext, getLeagueDisplayForMember, getDisplayForLeague };
