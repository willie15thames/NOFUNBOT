/* Canonical league identity and lifecycle resolver. */
'use strict';

const activeLeagues = require('./activeLeagueService');

function norm(v='') { return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

function resolveLeague(input, options = {}) {
  const raw = String(input || '').trim();
  if (!raw || raw === '_none_') return { ok:false, code:'LEAGUE_REQUIRED', message:'Choose a league first.' };
  const guildId = options.guildId ? String(options.guildId) : null;
  const mode = options.mode || 'operational';
  const source = mode === 'joinable' ? activeLeagues.listJoinableLeagues({ guildId })
    : mode === 'resettable' ? activeLeagues.listResettableLeagues({ guildId })
    : mode === 'provider' ? activeLeagues.listProviderTargets({ guildId, includePaused:!!options.includePaused })
    : mode === 'progression' ? activeLeagues.listProgressionEligibleLeagues({ guildId })
    : activeLeagues.listOperationalLeagues({ guildId });

  const exactId = source.find(l => String(l.id) === raw);
  if (exactId) return { ok:true, league:exactId, matchedBy:'id' };

  const needle = norm(raw);
  const exactNames = source.filter(l => norm(l.leagueName) === needle);
  if (exactNames.length === 1) return { ok:true, league:exactNames[0], matchedBy:'name' };
  if (exactNames.length > 1) return { ok:false, code:'LEAGUE_AMBIGUOUS', message:'More than one league has that name. Choose the exact league button.', candidates:exactNames };

  if (options.allowPrefix) {
    const partial = source.filter(l => norm(l.leagueName).includes(needle) || norm(l.id).startsWith(needle));
    if (partial.length === 1) return { ok:true, league:partial[0], matchedBy:'partial' };
    if (partial.length > 1) return { ok:false, code:'LEAGUE_AMBIGUOUS', message:'That league name matches more than one active league.', candidates:partial };
  }
  return { ok:false, code:'LEAGUE_NOT_FOUND', message:'That league is not available for this action.' };
}

function requireLeague(input, options = {}) {
  const result = resolveLeague(input, options);
  if (!result.ok) {
    const err = new Error(result.message);
    err.code = result.code;
    err.candidates = result.candidates;
    throw err;
  }
  return result.league;
}

module.exports = { resolveLeague, requireLeague, norm };
