'use strict';
const assert = require('node:assert/strict');
const critical = require('../src/storage/criticalStore');
const registry = require('../src/services/activeLeagueService');
const assignments = require('../src/services/teamAssignmentService');
const visibility = require('../src/services/leagueVisibilityService');
const reset = require('../src/services/cleanSlateResetService');
const fs = require('node:fs');
const path = require('node:path');
const {getDataDir,saveJson} = require('../src/storage/jsonStore');
const space = require('../src/league/spaceContext');
const gameSessions = require('../src/league/gameSessionService');

(async () => {
  const guildId = 'clean-slate-test-guild', leagueId = 'clean-slate-test-league';
  registry.upsertLeague({id:leagueId,guildId,leagueName:'Before Reset',status:'ACTIVE'});
  await critical.transact(`v204:assignments:${guildId}`,{assignments:{}},s=>{
    s.assignments[`${leagueId}:ravens`]={leagueId,baseTeam:'Ravens',userId:'old-member'};
  });
  await critical.transact(`v204:memberships:${guildId}`,{members:{}},s=>{
    s.members[`${leagueId}:old-member`]={leagueId,userId:'old-member',status:'ACTIVE'};
  });
  await critical.transact(`v204:active-removals:${guildId}:${leagueId}`,{pending:[]},s=>{s.pending=['old-member'];});
  gameSessions.registerSession('old-game-channel',{team1:'Ravens',team2:'Jets',week:1,responded:new Set()}, {guildId,leagueId,matchupKey:'old-game-key'});
  await space.run(leagueId,()=>saveJson('hubWeeklyData.json',{week:99,oldLeague:true}));
  const scoped = path.join(getDataDir(),`space_${encodeURIComponent(leagueId)}__hubWeeklyData.json`);
  assert.equal(fs.existsSync(scoped),true);
  try { await reset.resetGuild(guildId,{}); }
  catch (err) {
    // Local test has no database. The reset must say it is incomplete, yet
    // never leave locally durable owner/access records behind.
    assert.equal(err.code,'CLEAN_SLATE_INCOMPLETE');
  }
  assert.equal(registry.getLeague(leagueId),null);
  assert.deepEqual(await critical.read(`v204:assignments:${guildId}`,{assignments:{}}),{assignments:{}});
  assert.equal(await visibility.hasMembership(guildId,'old-member',leagueId),false);
  assert.deepEqual(await critical.read(`v204:active-removals:${guildId}:${leagueId}`,{pending:[]}),{pending:[]});
  assert.equal(fs.existsSync(scoped),false,'old league runtime cannot rehydrate');
  assert.equal(gameSessions.findByMatchupKey('old-game-key'),null,'old game session cannot rehydrate');
  const fresh={openTeamRegistry:[],players:new Map()};
  await assignments.restore(guildId,fresh);
  assert.equal(fresh.openTeamRegistry.length,0);
  console.log('Clean-slate hydration: 1 passed, 0 failed');
})().catch(err=>{console.error(err);process.exitCode=1;});
