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

function buildDesiredNickname(member, state, opts = {}) {
  const profile = memberProfiles.ensureProfile(member.id, { lastSeenDisplayName: member.displayName });
  if (!profile?.timezone) return null;
  const label = String(profile.timezoneLabel || timezoneLabel(profile.timezone) || profile.timezone || '').toUpperCase();
  const team = getLeagueDisplayForMember(state, member.id, opts.channel || opts.channelId || null);
  const base = team || stripTimezoneSuffix(profile.lastSeenDisplayName || member.displayName || member.user?.username || 'member');
  return `${base} (${label})`.slice(0, 32);
}

async function syncMemberNickname(member, state, opts = {}) {
  if (!member?.manageable) return { ok: false, reason: 'not-manageable' };
  const desired = buildDesiredNickname(member, state, opts);
  if (!desired) return { ok: false, reason: 'timezone-missing' };
  const current = String(member.nickname || member.displayName || '').trim();
  if (current === desired) return { ok: true, skipped: true, desired };
  try {
    await member.setNickname(desired, opts.reason || 'Timezone/team nickname sync');
    return { ok: true, desired };
  } catch (err) {
    return { ok: false, reason: err.message, desired };
  }
}

async function syncGuildNicknames(guild, state) {
  const out = [];
  for (const member of guild.members.cache.values()) {
    const profile = memberProfiles.getProfile(member.id);
    if (!profile?.timezone) continue;
    out.push(await syncMemberNickname(member, state));
  }
  return out;
}

module.exports = { timezoneLabel, stripTimezoneSuffix, buildDesiredNickname, syncMemberNickname, syncGuildNicknames, resolveLeagueContext, getLeagueDisplayForMember };
