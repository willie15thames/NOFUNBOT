'use strict';
const { test, run, assert, eq } = require('./_harness');
const { leagueChannelName, leaguePrefixCode, legacyTwoCharChannelName } = require('../src/services/leagueNamingService');

test('league naming preserves the documented v18 two-character dot contract', () => {
  eq(leagueChannelName('NOFUN League', 'standings'), 'no.standings', 'expected v18 scoped name');
  eq(leagueChannelName('NOFUN League', 'standings'), leagueChannelName('NOFUN League', 'standings'), 'deterministic');
  assert(leagueChannelName('🔥 Mý League!!!', 'Weekly Schedule').length <= 100, 'within Discord limit');
  assert(/^[a-z0-9]{2}\.[a-z0-9-]+$/.test(leagueChannelName('🔥 Mý League!!!', 'Weekly Schedule')), 'safe v18 format');
});

test('league prefix uses first two alphanumeric characters with fallback', () => {
  eq(leaguePrefixCode('NOFUNLEAGUE'), 'no', 'first two alphanumeric characters');
  eq(leaguePrefixCode('', 'Madden Franchise (Standard)'), 'ma', 'fallback label');
  eq(leaguePrefixCode('A'), 'a', 'single-character names preserve the existing inline contract');
});

test('legacy active-check helper matches canonical v18 path', () => {
  eq(legacyTwoCharChannelName('NOFUNLEAGUE', 'active-check'), 'no.active-check', 'legacy path');
  eq(legacyTwoCharChannelName('NOFUNLEAGUE', 'active-check'), leagueChannelName('NOFUNLEAGUE', 'active-check'), 'compatibility path is stable');
});

run('leagueNaming.test.js');
