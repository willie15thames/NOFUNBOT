/* Canonical league identity and lifecycle resolver.
 * Identity is resolved against all canonical guild records first; lifecycle policy is applied second.
 * This preserves truthful errors such as ARCHIVED/ARCHIVING instead of collapsing them into NOT_FOUND.
 */
'use strict';

const activeLeagues = require('./activeLeagueService');

function norm(v='') { return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

function _allowedForMode(league, mode, options = {}) {
  const status = String(league?.status || 'ACTIVE').toUpperCase();
  if (mode === 'history' || mode === 'records') return true;
  if (mode === 'joinable') return status === 'ACTIVE' && league?.kind !== 'event';
  if (mode === 'resettable') return ['ACTIVE','PAUSED','REPAIR_REQUIRED'].includes(status) && league?.kind !== 'event';
  if (mode === 'provider') return (status === 'ACTIVE' || (options.includePaused && status === 'PAUSED')) && league?.kind !== 'event';
  if (mode === 'progression') return status === 'ACTIVE' && league?.kind !== 'event' && league?.progressionDisabled !== true;
  return ['ACTIVE','PAUSED'].includes(status);
}

function _lifecycleFailure(league, mode) {
  const status = String(league?.status || 'ACTIVE').toUpperCase();
  if (status === 'ARCHIVED' || status === 'DELETED') {
    return { ok:false, code:'LEAGUE_ARCHIVED', message:'That league is archived.', league };
  }
  if (status === 'ARCHIVING') {
    return { ok:false, code:'LEAGUE_ARCHIVING', message:'That league is being archived. Wait for cleanup to finish.', league };
  }
  if (mode === 'joinable') {
    return { ok:false, code:'LEAGUE_NOT_JOINABLE', message:'That league is not currently joinable.', league };
  }
  return { ok:false, code:'INVALID_STATE', message:'That league is not available for this action.', league };
}

function resolveLeague(input, options = {}) {
  const raw = String(input || '').trim();
  if (!raw || raw === '_none_') return { ok:false, code:'LEAGUE_REQUIRED', message:'Choose a league first.' };
  const guildId = options.guildId ? String(options.guildId) : null;
  const mode = options.mode || 'operational';

  // Resolve identity globally enough to distinguish wrong-guild from genuinely missing,
  // but never return a wrong-guild record to the caller.
  const allRecords = activeLeagues.listLeagueRecords();
  const guildRecords = guildId
    ? allRecords.filter(l => String(l.guildId || '') === guildId)
    : allRecords;

  const exactAnyId = allRecords.find(l => String(l.id) === raw);
  if (exactAnyId && guildId && String(exactAnyId.guildId || '') !== guildId) {
    return { ok:false, code:'LEAGUE_WRONG_GUILD', message:'That league is not available in this server.' };
  }

  let matches = guildRecords.filter(l => String(l.id) === raw);
  let matchedBy = 'id';
  if (!matches.length) {
    const needle = norm(raw);
    matches = guildRecords.filter(l => norm(l.leagueName) === needle);
    matchedBy = 'name';
    if (!matches.length && options.allowAliases) {
      matches = guildRecords.filter(l => Array.isArray(l.aliases) && l.aliases.some(a => norm(a) === needle));
      matchedBy = 'alias';
    }
    if (!matches.length && options.allowPrefix) {
      matches = guildRecords.filter(l => norm(l.leagueName).includes(needle) || norm(l.id).startsWith(needle));
      matchedBy = 'partial';
    }
  }

  if (matches.length > 1) {
    return { ok:false, code:'LEAGUE_AMBIGUOUS', message:'More than one league matches that name. Choose the exact league.', candidates:matches };
  }
  if (!matches.length) {
    // A same-name record in another guild is intentionally indistinguishable from unavailable.
    return { ok:false, code:'LEAGUE_NOT_FOUND', message:"I couldn't match that league. Choose it from the list or run /leagues list." };
  }

  const league = matches[0];
  if (!_allowedForMode(league, mode, options)) return _lifecycleFailure(league, mode);
  return { ok:true, league, matchedBy };
}

function requireLeague(input, options = {}) {
  const result = resolveLeague(input, options);
  if (!result.ok) {
    const err = new Error(result.message);
    err.code = result.code;
    err.candidates = result.candidates;
    err.league = result.league;
    throw err;
  }
  return result.league;
}

module.exports = { resolveLeague, requireLeague, norm };
