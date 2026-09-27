/*
 * NAVIGATION HEADER
 * FILE: src/services/leagueNamingService.js
 * LAYER: Service layer / deterministic naming
 * PURPOSE: Restores the documented multi-league naming contract introduced in v18.
 * LOOK HERE FIRST WHEN DEBUGGING: leagueChannelName(), leaguePrefixCode().
 * RELATED FLOW: leagueSetupService, leagueFeatureService, league rules lookup.
 * NOTE: DO NOT silently change this format. Existing servers and lookup regexes depend on `<2-char-prefix>.<channel-key>`.
 */

'use strict';

const MAX_DISCORD_CHANNEL_NAME = 100;

function _alnum(value, fallback = 'lg') {
  const clean = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (clean) return clean;
  const fb = String(fallback || 'lg').toLowerCase().replace(/[^a-z0-9]/g, '');
  return fb || 'lg';
}

function _channelKey(value, fallback = 'channel') {
  const clean = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return clean || fallback;
}

/**
 * Stable two-character league prefix introduced by patch v18.
 * Example: "NOFUNLEAGUE" -> "no". The fallback label is used only when the league name is blank.
 */
function leaguePrefixCode(leagueName, fallbackLabel = 'league') {
  const source = _alnum(leagueName, fallbackLabel);
  return source.slice(0, 2) || 'lg';
}

/**
 * Canonical league-scoped text-channel name introduced by patch v18.
 * Example: "NOFUNLEAGUE" + "rules" -> "no.rules".
 * This remains deterministic so setup reruns can find/reuse the same channel.
 */
function leagueChannelName(leagueName, channelKey, fallbackLabel = 'league') {
  const prefix = leaguePrefixCode(leagueName, fallbackLabel);
  const key = _channelKey(channelKey, 'channel');
  return `${prefix}.${key}`.slice(0, MAX_DISCORD_CHANNEL_NAME);
}

/**
 * Compatibility alias retained for callers that were written against the old inline active-check naming rule.
 * Canonical and legacy are currently identical by design; keeping this helper makes future migrations explicit.
 */
function legacyTwoCharChannelName(leagueName, channelKey) {
  return leagueChannelName(leagueName, channelKey, 'lg');
}

module.exports = {
  MAX_DISCORD_CHANNEL_NAME,
  leaguePrefixCode,
  leagueChannelName,
  legacyTwoCharChannelName,
};
