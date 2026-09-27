'use strict';
const { test, run, assert, eq } = require('./_harness');
const { leagueChannelName, leaguePrefixCode, legacyTwoCharChannelName } = require('../src/services/leagueNamingService');

test('new league channels use plain names inside league-owned categories', () => {
  eq(leagueChannelName('NOFUN League', 'standings'), 'standings', 'category scopes channel');
  eq(leagueChannelName('NOFUN League', 'standings'), leagueChannelName('NOFUN League', 'standings'), 'deterministic');
  assert(leagueChannelName('🔥 Mý League!!!', 'Weekly Schedule').length <= 100, 'within Discord limit');
  eq(leagueChannelName('🔥 Mý League!!!', 'Weekly Schedule'), 'weekly-schedule', 'safe readable name');
});

test('league prefix uses first two alphanumeric characters with fallback', () => {
  eq(leaguePrefixCode('NOFUNLEAGUE'), 'no', 'first two alphanumeric characters');
  eq(leaguePrefixCode('', 'Madden Franchise (Standard)'), 'ma', 'fallback label');
  eq(leaguePrefixCode('A'), 'a', 'single-character names preserve the existing inline contract');
});

test('legacy prefix remains recognizable without using it for new channels', () => {
  eq(legacyTwoCharChannelName('NOFUNLEAGUE', 'active-check'), 'no.active-check', 'legacy path');
  eq(leagueChannelName('NOFUNLEAGUE', 'active-check'), 'active-check', 'new path');
});

run('leagueNaming.test.js');
