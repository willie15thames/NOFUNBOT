/*
 * NAVIGATION HEADER
 * FILE: src/services/openTeamsService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
// src/services/openTeamsService.js
// Multi-league aware team registry. Each team entry has a leagueId.
// Members can only select teams in leagues with availability.

const { EmbedBuilder } = require('discord.js');
const { getTeamEmoji }        = require('../utils/teamUtils');
const { loadJson, saveJsonDebounced }   = require('../storage/jsonStore');
const { upsertBoardMessage } = require('./boardManagerService');
const teamRegistry = require('./teamRegistryService');
const activeLeagueService = require('./activeLeagueService');
const memberProfiles = require('./memberProfileService');
const nicknamePolicy = require('./nicknamePolicyService');
const { makeLogger }          = require('../utils/logger');
const log = makeLogger('openTeams');

const DIVS = [
  {label:'AFC East', teams:['Bills','Dolphins','Patriots','Jets']},
  {label:'AFC North',teams:['Ravens','Bengals','Browns','Steelers']},
  {label:'AFC South',teams:['Texans','Colts','Jaguars','Titans']},
  {label:'AFC West', teams:['Chiefs','Raiders','Chargers','Broncos']},
  {label:'NFC East', teams:['Cowboys','Eagles','Giants','Commanders']},
  {label:'NFC North',teams:['Bears','Lions','Packers','Vikings']},
  {label:'NFC South',teams:['Falcons','Panthers','Saints','Buccaneers']},
  {label:'NFC West', teams:['49ers','Seahawks','Rams','Cardinals']},
];

let _getCh, _state;

function init({ getCh, state }) {
  _getCh  = getCh;
  _state  = state;
  try { teamRegistry.syncFromState(_state); } catch {}
}

const playerKey = (entry) => `${entry.leagueId || 'legacy'}::${norm(entry.baseTeam)}`;
const norm = s => String(s).toLowerCase().trim().replace(/\s+/g, ' ');

// ── League helpers ──────────────────────────────────────────────

/** Get all leagues that have open team slots */
function getLeaguesWithAvailability() {
  const reg = _state.openTeamRegistry;
  const leagueIds = new Set(reg.filter(t => t.isOpen).map(t => t.leagueId).filter(Boolean));
  // Also include teams with no leagueId (legacy / default league)
  if (reg.some(t => t.isOpen && !t.leagueId)) leagueIds.add(null);
  return leagueIds;
}

/** Get open teams filtered by leagueId (null = default/legacy league) */
function getOpenTeamsForLeague(leagueId) {
  return _state.openTeamRegistry.filter(t =>
    t.isOpen && (t.leagueId || null) === (leagueId || null)
  );
}

/** Get all leagues a user is in (has a claimed team) */
function getUserLeagues(userId) {
  const entries = _state.openTeamRegistry.filter(t => t.ownerId === userId);
  return entries.map(t => ({
    leagueId: t.leagueId || null,
    leagueName: _getLeagueName(t.leagueId),
    team: t.displayTeam,
    baseTeam: t.baseTeam,
  }));
}

/** Get league display name from activeLeagues or leagueConfig */

function _getLeagueName(leagueId) {
  if (!leagueId) {
    if (_state.leagueConfig?.leagueName) return _state.leagueConfig.leagueName;
    if (_state.leagueConfig?.leagueTypeId) return activeLeagueService.leagueTypeLabel(_state.leagueConfig.leagueTypeId);
    return 'League Not Initialized';
  }
  const league = activeLeagueService.getLeague(leagueId);
  return league?.leagueName || leagueId;
}


// ── Embeds ──────────────────────────────────────────────────────

function buildOpenTeamsEmbeds(guild, leagueId) {
  const reg = _state.openTeamRegistry.filter(t =>
    leagueId === undefined || (t.leagueId || null) === (leagueId || null)
  );
  if (!reg.length) {
    return [new EmbedBuilder().setColor(0xf39c12).setTitle('🏟 Available Teams')
      .setDescription('No teams configured yet. Commissioner: `/add-open-team`').setTimestamp()];
  }
  const open    = reg.filter(t => t.isOpen).length;
  const claimed = reg.filter(t => !t.isOpen).length;
  const lines   = [];

  // Standard NFL divisions
  for (const div of DIVS) {
    const rows = div.teams.map(name => {
      const e = reg.find(t => norm(t.baseTeam) === norm(name));
      if (!e) return null;
      const emoji   = getTeamEmoji(guild, e.baseTeam) || '';
      const display = norm(e.displayTeam) !== norm(e.baseTeam)
        ? `**${e.displayTeam}** *(${e.baseTeam})*`
        : `**${e.displayTeam}**`;
      const status = e.isOpen ? '✅' : `❌${e.ownerId ? ` <@${e.ownerId}>` : ''}`;
      return `${status} ${emoji} ${display}`.trim();
    }).filter(Boolean);
    if (rows.length) { lines.push(`**${div.label}**`); lines.push(rows.join('\n')); lines.push(''); }
  }

  // Custom / extra teams not in standard divisions
  const known = new Set(DIVS.flatMap(d => d.teams.map(t => norm(t))));
  for (const e of reg.filter(t => !known.has(norm(t.baseTeam)))) {
    const emoji   = getTeamEmoji(guild, e.baseTeam) || '';
    const display = norm(e.displayTeam) !== norm(e.baseTeam)
      ? `**${e.displayTeam}** *(${e.baseTeam})*`
      : `**${e.displayTeam}**`;
    const status = e.isOpen ? '✅' : `❌${e.ownerId ? ` <@${e.ownerId}>` : ''}`;
    lines.push(`${status} ${emoji} ${display}`.trim());
  }

  const leagueName = _getLeagueName(leagueId || null);
  const title = leagueName ? `🏟 Open Teams — ${leagueName}` : '🏟 Open Teams';
  return [new EmbedBuilder().setColor(0xf39c12).setTitle(title)
    .setDescription(lines.join('\n').trim() || 'No teams configured.')
    .addFields(
      { name: '✅ Available', value: String(open),    inline: true },
      { name: '❌ Claimed',   value: String(claimed), inline: true },
      { name: 'Total',       value: String(reg.length), inline: true },
    )
    .setFooter({ text: 'Use /select-team to claim  •  Updates automatically' })
    .setTimestamp()];
}


let _boardMsgId = null, _boardChId = null;

async function refreshOpenTeamsBoard(guild) {
  const hasActiveLeague = activeLeagueService.listOperationalLeagues().length > 0 || !!(_state.leagueConfig?.leagueTypeId && _state.leagueConfig?.leagueName);
  const hasConfiguredTeams = Array.isArray(_state.openTeamRegistry) && _state.openTeamRegistry.length > 0;
  if (!hasActiveLeague || !hasConfiguredTeams) return { skipped: true, reason: 'no-active-league' };
  for (const league of activeLeagueService.listOperationalLeagues().filter(l=>!require('../league/spaceContext').current()||l.id===require('../league/spaceContext').current())) {
    const ch = (league.builtChannelIds || []).map(id=>guild.channels.cache.get(id)).find(c=>c && require('./leagueNamingService').matchesLeagueChannelKey(c.name,'open-teams'));
    if (!ch) continue;
    await upsertBoardMessage({boardKey:`openTeams:${guild.id}:${league.id}`,channel:ch,payload:{embeds:buildOpenTeamsEmbeds(guild,league.id),allowedMentions:{parse:[]}}});
  }
}


async function announceTeamOpen(guild, entry, reason) {
  const lg = activeLeagueService.getLeague(entry.leagueId);
  const ch = (lg?.builtChannelIds || []).map(id=>guild.channels.cache.get(id)).find(c=>c && require('./leagueNamingService').matchesLeagueChannelKey(c.name,'announcements'));
  if (!ch) return;
  const roleId = lg.memberRoleId;
  await ch.send({
    content: roleId ? `<@&${roleId}>` : undefined,
    embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle(`🏟 ${entry.displayTeam} is now open!`)
      .setDescription(`**${entry.displayTeam}** (slot: ${entry.baseTeam}) just opened — ${reason}.\nUse \`/select-team\` to claim it!`)
      .setTimestamp()],
    allowedMentions: roleId ? { roles: [roleId], parse: [] } : { parse: [] },
  }).catch(() => null);
}

// ── Find / Claim / Release ──────────────────────────────────────

function _findEntry(nameInput, leagueId) {
  const { TEAM_SLANG } = require('../config/teams');
  const resolved = TEAM_SLANG[(nameInput || '').toLowerCase().trim()] || nameInput;
  const needle   = norm(resolved);
  const reg      = _state.openTeamRegistry;
  // If leagueId specified, filter to that league; otherwise search all
  const pool = leagueId !== undefined
    ? reg.filter(t => (t.leagueId || null) === (leagueId || null))
    : reg;
  return (
    pool.find(t => norm(t.baseTeam) === needle || norm(t.displayTeam) === needle) ||
    pool.find(t => needle.includes(norm(t.baseTeam)) || norm(t.baseTeam).includes(needle)) ||
    null
  );
}

async function claimTeamForUser(guild, member, teamNameInput, options = {}) {
  const activeLeagues = activeLeagueService.listResetOptions(_state);
  if (!activeLeagues.length) {
    return { success: false, reason: 'No active league has been created yet. The commissioner needs to run `/setup-league` first.' };
  }
  // Check if any teams are open at all
  const allOpen = _state.openTeamRegistry.filter(t => t.isOpen);
  if (!allOpen.length) {
    return { success: false, reason: 'No teams are currently configured or available in any league. Check back later or ask the commissioner.' };
  }

  const explicitId = options.leagueId || require('../league/spaceContext').current() || (activeLeagues.length === 1 ? activeLeagues[0].id : undefined);
  if (!explicitId && activeLeagues.length > 1) return { success:false, reason:'Select an exact league before claiming a team.' };
  const entry = _findEntry(teamNameInput, explicitId);
  if (!entry) {
    // Team not found — provide helpful suggestions
    const suggestions = allOpen.slice(0, 5).map(t => t.displayTeam).join(', ');
    return { success: false, reason: `Team **${teamNameInput}** not found in any league registry.\n\nAvailable teams include: ${suggestions}${allOpen.length > 5 ? '...' : ''}\nUse the league-scoped team buttons or type the exact team name.` };
  }
  if (!entry.isOpen) {
    return { success: false, reason: `**${entry.displayTeam}** is already claimed${entry.ownerId ? ` by <@${entry.ownerId}>` : ''}. Try another team.` };
  }

  // Check if user already owns a team IN THIS LEAGUE
  const leagueId = entry.leagueId || null;
  const currentInLeague = _state.openTeamRegistry.find(t =>
    t.ownerId === member.id && (t.leagueId || null) === leagueId
  );
  if (currentInLeague) {
    return { success: false, reason: `You already own **${currentInLeague.displayTeam}** in this league. Use \`/release-team\` first.` };
  }

  // Reserve in the live registry before awaiting Discord; rollback on access failure.
  entry.isOpen = false;
  entry.ownerId = member.id;
  try {
    await require('./teamAssignmentService').claim(guild.id,entry,member.id);
    await require('./leagueVisibilityService').grantMemberAccessToLeague(guild, member, _state, entry.leagueId);
  }
  catch (err) { await require('./teamAssignmentService').release(guild.id,entry,member.id); entry.isOpen = true; entry.ownerId = null; return { success:false, reason:`Access could not be granted: ${err.message}` }; }
  entry.timezone = options.timezone || null;
  const key      = playerKey(entry);
  const candidate = _state.players.get(key);
  const existing = candidate?.userId === member.id ? candidate : null;
  _state.players.set(key, {
    userId: member.id, team: key, baseTeam: entry.baseTeam, displayTeam: entry.displayTeam,
    leagueId: leagueId,
    timezone: options.timezone || existing?.timezone || null,
    streamCount: existing?.streamCount || 0, streamLog: existing?.streamLog || [],
    warnings: existing?.warnings || 0, closeAppWarnings: existing?.closeAppWarnings || 0,
    inactivityWarnings: existing?.inactivityWarnings || 0,
  });
  memberProfiles.upsertProfile(member.id, { timezone: entry.timezone || existing?.timezone || null, timezoneLabel: nicknamePolicy.timezoneLabel(entry.timezone || existing?.timezone || null), lastSeenDisplayName: nicknamePolicy.stripTimezoneSuffix(member.displayName), teamDisplay: entry.displayTeam });
  await nicknamePolicy.syncMemberNickname(member, _state, { reason: 'Team claim timezone sync' }).catch(() => null);
  await refreshOpenTeamsBoard(guild).catch(() => null);
  saveJsonDebounced('openTeamRegistry.json', _state.openTeamRegistry);
  require('../storage/jsonStore').saveJson('players.json', [..._state.players].map(([key,p])=>({key,...p})));
  try { teamRegistry.syncFromState(_state); } catch {}
  return { success: true, entry };
}

async function releaseByUserId(guild, userId, leagueId = null) {
  const entries = _state.openTeamRegistry.filter(t => t.ownerId === userId && (!leagueId || t.leagueId === leagueId));
  if (entries.length > 1) { for (const item of entries) await releaseByUserId(guild,userId,item.leagueId); return entries[0]; }
  const entry = entries[0];
  if (!entry) return null;
  if (entry.ownerId) {
    await require('./leagueVisibilityService').revokeMemberAccess(guild,entry.ownerId,entry.leagueId);
    await require('./teamAssignmentService').release(guild.id,entry,entry.ownerId);
  }
  entry.isOpen = true; entry.ownerId = null; entry.timezone = null;
  const p = _state.players.get(playerKey(entry));
  if (p) { p.userId = null; p.timezone = null; }
  await refreshOpenTeamsBoard(guild).catch(() => null);
  saveJsonDebounced('openTeamRegistry.json', _state.openTeamRegistry);
  require('../storage/jsonStore').saveJson('players.json', [..._state.players].map(([key,p])=>({key,...p})));
  try { teamRegistry.syncFromState(_state); } catch {}
  return entry;
}

async function releaseByName(guild, teamNameInput, options = {}) {
  const [name, encodedLeague] = String(teamNameInput || '').split('::');
  const selected = encodedLeague || options.leagueId || require('../league/spaceContext').current();
  if (!selected && activeLeagueService.listOperationalLeagues().length > 1) throw new Error('Select the league for team release');
  const entry = _findEntry(name, selected || undefined);
  if (!entry) return null;
  const prevOwner = entry.ownerId;
  if (entry.ownerId) {
    await require('./leagueVisibilityService').revokeMemberAccess(guild,entry.ownerId,entry.leagueId);
    await require('./teamAssignmentService').release(guild.id,entry,entry.ownerId);
  }
  entry.isOpen = true; entry.ownerId = null; entry.timezone = null;
  const p = _state.players.get(playerKey(entry));
  if (p) { p.userId = null; p.timezone = null; }
  await refreshOpenTeamsBoard(guild).catch(() => null);
  saveJsonDebounced('openTeamRegistry.json', _state.openTeamRegistry);
  require('../storage/jsonStore').saveJson('players.json', [..._state.players].map(([key,p])=>({key,...p})));
  try { teamRegistry.syncFromState(_state); } catch {}
  return { entry, prevOwner };
}



async function createOrClaimCustomTeam(guild, member, { leagueId=null, teamName, replacementFor=null, logoUrl=null, timezone=null }) {
  const activeLeagues = activeLeagueService.listResetOptions(_state);
  if (!activeLeagues.length) {
    return { success: false, reason: 'No active league exists yet. Commissioner must run `/setup-league` first.' };
  }
  if (!leagueId && activeLeagues.length > 1) return {success:false,reason:'Select a league first.'};
  const league = leagueId ? activeLeagues.find(l => String(l.id)===String(leagueId)) : activeLeagues[0];
  if (!league) return { success:false, reason:'Selected league was not found.' };
  if (_state.openTeamRegistry.some(t => t.ownerId === member.id && t.leagueId === league.id)) return {success:false,reason:'You already own a team in this league.'};
  const cleanName = String(teamName||'').trim();
  if (!cleanName) return { success:false, reason:'Team name is required.' };
  const replaceNeedle = String(replacementFor||'').trim();

  let entry = replaceNeedle ? _findEntry(replaceNeedle, league.id) : null;
  if (entry && !entry.isOpen) {
    return { success:false, reason:`Replacement slot **${entry.displayTeam}** is already claimed.` };
  }
  if (!entry) {
    entry = {
      baseTeam: replaceNeedle || cleanName,
      displayTeam: cleanName,
      logoUrl: logoUrl || null,
      isOpen: true,
      ownerId: null,
      leagueId: league.id,
      leagueName: league.leagueName,
      isCPU: false,
      timezone: null,
      replacementFor: replaceNeedle || null,
      isCustomTeam: true,
    };
    _state.openTeamRegistry.push(entry);
  } else {
    entry.displayTeam = cleanName;
    entry.logoUrl = logoUrl || entry.logoUrl || null;
    entry.replacementFor = entry.replacementFor || replaceNeedle || null;
    entry.isCustomTeam = true;
  }

  // Reserve in the live registry before awaiting Discord; rollback on access failure.
  entry.isOpen = false;
  entry.ownerId = member.id;
  try {
    await require('./teamAssignmentService').claim(guild.id,entry,member.id);
    await require('./leagueVisibilityService').grantMemberAccessToLeague(guild, member, _state, entry.leagueId);
  }
  catch (err) { await require('./teamAssignmentService').release(guild.id,entry,member.id); entry.isOpen = true; entry.ownerId = null; return { success:false, reason:`Access could not be granted: ${err.message}` }; }
  entry.timezone = timezone || null;
  const key = playerKey(entry);
  const candidate = _state.players.get(key);
  const existing = candidate?.userId === member.id ? candidate : null;
  _state.players.set(key, {
    userId: member.id,
    team: key,
    baseTeam: entry.baseTeam,
    displayTeam: entry.displayTeam,
    leagueId: league.id,
    timezone: timezone || existing?.timezone || null,
    logoUrl: entry.logoUrl || null,
    replacementFor: entry.replacementFor || null,
    isCustomTeam: true,
    streamCount: existing?.streamCount || 0,
    streamLog: existing?.streamLog || [],
    warnings: existing?.warnings || 0,
    closeAppWarnings: existing?.closeAppWarnings || 0,
    inactivityWarnings: existing?.inactivityWarnings || 0,
  });

  memberProfiles.upsertProfile(member.id, { timezone: timezone || existing?.timezone || null, timezoneLabel: nicknamePolicy.timezoneLabel(timezone || existing?.timezone || null), lastSeenDisplayName: nicknamePolicy.stripTimezoneSuffix(member.displayName), teamDisplay: entry.displayTeam });
  await nicknamePolicy.syncMemberNickname(member, _state, { reason: 'Custom team timezone sync' }).catch(() => null);
  await refreshOpenTeamsBoard(guild).catch(() => null);
  saveJsonDebounced('openTeamRegistry.json', _state.openTeamRegistry);
  require('../storage/jsonStore').saveJson('players.json', [..._state.players].map(([key,p])=>({key,...p})));
  try { teamRegistry.syncFromState(_state); } catch {}
  return { success:true, entry, createdCustom: true, league };
}

module.exports = {
  init,
  buildOpenTeamsEmbeds,
  refreshOpenTeamsBoard,
  announceTeamOpen,
  claimTeamForUser,
  claimTeam: claimTeamForUser,
  releaseByUserId,
  releaseTeamByUserId: releaseByUserId,
  releaseTeamByName:   releaseByName,
  releaseByName,
  // New multi-league helpers
  getLeaguesWithAvailability,
  getOpenTeamsForLeague,
  getUserLeagues,
  createOrClaimCustomTeam,
};
