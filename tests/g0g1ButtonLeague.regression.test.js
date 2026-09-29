'use strict';
const assert = require('node:assert/strict');
const registry = require('../src/services/activeLeagueService');
const join = require('../src/services/joinLeagueService');
const teams = require('../src/services/openTeamsService');
const {buildCommandsForState} = require('../src/commands');

(async()=>{
  const guildId='button-test-guild';
  registry.upsertLeague({id:'button-a',guildId,leagueName:'Sunday',status:'ACTIVE',leagueTypeId:'madden_standard'});
  registry.upsertLeague({id:'button-b',guildId,leagueName:'Night',status:'ACTIVE',leagueTypeId:'madden_standard'});
  registry.upsertLeague({id:'button-archived',guildId,leagueName:'Old',status:'ARCHIVED',leagueTypeId:'madden_standard'});
  const state={openTeamRegistry:[
    {leagueId:'button-a',baseTeam:'Ravens',displayTeam:'Ravens',isOpen:true},
    {leagueId:'button-b',baseTeam:'Ravens',displayTeam:'Ravens',isOpen:true},
  ]};
  teams.init({state,getCh:()=>null});
  const select=buildCommandsForState().find(c=>c.name==='select-team');
  assert.equal(select.options.find(o=>o.name==='league').required,false);
  assert.equal(select.options.find(o=>o.name==='team').required,false);
  let response;
  const base={guildId,user:{id:'button-user'},reply:async payload=>{response=payload;return payload;}};
  await join.sendJoinLeaguePrompt(base,state,null);
  assert.equal(response.components.length>0,true,'button picker is primary');
  await join.sendJoinLeaguePrompt(base,state,'button-a');
  assert.match(response.embeds[0].data.title,/Sunday/);
  assert.equal(response.components.length>0,true);
  await join.sendJoinLeaguePrompt(base,state,'button-archived');
  assert.match(response.content,/archived/i);
  await join.sendJoinLeaguePrompt(base,state,'button-b');
  assert.match(response.embeds[0].data.title,/Night/);
  console.log('G0/G1 button league: 1 passed, 0 failed');
})().catch(err=>{console.error(err);process.exitCode=1;});
