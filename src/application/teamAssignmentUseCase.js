/*
 * Canonical team-assignment application use case.
 * All transports (slash command, buttons, natural language, AI actions) should converge here.
 * Natural-language parsing may identify intent/entities, but must not own the mutation.
 */
'use strict';

const activeLeagueService = require('../services/activeLeagueService');
const leagueResolver = require('../services/leagueResolverService');
const openTeamsService = require('../services/openTeamsService');
const { norm } = require('../utils/helpers');

function typedFailure(code, message, details = {}) {
  return { ok: false, success: false, code, reason: message, message, ...details };
}

async function assignTeam({ guild, member, leagueId, league = null, team, timezone = null, source = 'unknown' } = {}) {
  if (!guild?.id) return typedFailure('GUILD_REQUIRED', 'A Discord guild is required.');
  if (!member?.id) return typedFailure('MEMBER_REQUIRED', 'A valid guild member is required.');
  if (!team) return typedFailure('TEAM_REQUIRED', 'Choose a team.');

  // A caller-provided object is a hint, not authority. Re-read status and guild
  // at execution time even for a button or an earlier autocomplete result.
  const resolved = leagueResolver.resolveLeague(leagueId || league?.id, { guildId: guild.id, mode: 'joinable' });
  if (!resolved.ok) return typedFailure(resolved.code || 'LEAGUE_NOT_FOUND', resolved.message || 'League not found.');
  const resolvedLeague = resolved.league;
  const canonicalLeagueId = String(resolvedLeague.id);
  const available = openTeamsService.getOpenTeamsForLeague(canonicalLeagueId) || [];
  const candidate = available.find(t => norm(t.baseTeam) === norm(team) || norm(t.displayTeam) === norm(team));
  if (!candidate) return typedFailure('TEAM_NOT_OPEN', `**${team}** is not an open team in **${resolvedLeague.leagueName || canonicalLeagueId}**.`, { league: resolvedLeague });

  const result = await openTeamsService.claimTeam(guild, member, candidate.baseTeam, { leagueId: canonicalLeagueId, timezone });
  if (!result?.success) return typedFailure('TEAM_ASSIGNMENT_FAILED', result?.reason || 'Team assignment failed.', { league: resolvedLeague });

  return {
    ok: true,
    success: true,
    code: 'TEAM_ASSIGNED',
    entry: result.entry,
    league: resolvedLeague,
    source,
  };
}

async function releaseTeam({ guild, leagueId, team, source = 'unknown' } = {}) {
  if (!guild?.id) return typedFailure('GUILD_REQUIRED', 'A Discord guild is required.');
  const resolved = leagueResolver.resolveLeague(leagueId, { guildId: guild.id, mode: 'operational' });
  if (!resolved.ok) return typedFailure(resolved.code || 'LEAGUE_NOT_FOUND', resolved.message || 'League not found.');
  const result = await openTeamsService.releaseByName(guild, team, { leagueId: resolved.league.id });
  if (!result) return typedFailure('TEAM_NOT_FOUND', `Team **${team}** was not found in **${resolved.league.leagueName || resolved.league.id}**.`);
  return { ok: true, success: true, code: 'TEAM_RELEASED', entry: result.entry, prevOwner: result.prevOwner, league: resolved.league, source };
}

module.exports = { assignTeam, releaseTeam, typedFailure };
