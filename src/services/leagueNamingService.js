/*
 * NAVIGATION HEADER
 * FILE: src/services/leagueNamingService.js
 * LAYER: Service layer / deterministic naming
 * PURPOSE: Stable channel keys inside league-owned categories; legacy names remain readable.
 * LOOK HERE FIRST WHEN DEBUGGING: leagueChannelName(), leaguePrefixCode().
 * RELATED FLOW: leagueSetupService, leagueFeatureService, league rules lookup.
 * NOTE: A category and stored resource IDs identify the league; channels use plain names.
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
 * Channels are scoped by their league category, not by a name prefix.
 * Example: "NOFUNLEAGUE" + "rules" -> "rules".
 */
function leagueChannelName(leagueName, channelKey, fallbackLabel = 'league') {
  const key = _channelKey(channelKey, 'channel');
  return key.slice(0, MAX_DISCORD_CHANNEL_NAME);
}

/**
 * Existing league channels may still have the old two-character prefix.
 */
function legacyTwoCharChannelName(leagueName, channelKey) {
  return `${leaguePrefixCode(leagueName, 'lg')}.${_channelKey(channelKey, 'channel')}`.slice(0, MAX_DISCORD_CHANNEL_NAME);
}

function matchesLeagueChannelKey(name, key) {
  const actual = String(name || '').toLowerCase();
  const clean = _channelKey(key);
  return actual === clean || new RegExp(`^[a-z0-9]{2}(?:[.-])?${clean}$`).test(actual);
}

module.exports = {
  MAX_DISCORD_CHANNEL_NAME,
  leaguePrefixCode,
  leagueChannelName,
  legacyTwoCharChannelName,
  matchesLeagueChannelKey,
};
