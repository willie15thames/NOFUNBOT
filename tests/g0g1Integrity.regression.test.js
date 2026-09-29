'use strict';
const assert = require('node:assert/strict');
const registry = require('../src/services/activeLeagueService');
const assignment = require('../src/application/teamAssignmentUseCase');
const openTeams = require('../src/services/openTeamsService');
const sessions = require('../src/services/componentSessionService');
const security = require('../src/services/securityMiddlewareService');

(async () => {
  const guild = {id:'integrity-guild'};
  const member = {id:'integrity-user'};
  const foreign = registry.upsertLeague({id:'foreign-league',guildId:'other-guild',leagueName:'Foreign',status:'ACTIVE'});
  const archived = registry.upsertLeague({id:'archived-league',guildId:guild.id,leagueName:'Archived',status:'ARCHIVED'});
  const oldCandidates = openTeams.getOpenTeamsForLeague;
  const oldClaim = openTeams.claimTeam;
  let calls = 0;
  openTeams.getOpenTeamsForLeague = () => [{baseTeam:'Ravens',displayTeam:'Ravens',isOpen:true}];
  openTeams.claimTeam = async () => {calls++; return {success:true,entry:{displayTeam:'Ravens'}};};
  try {
    const wrongGuild = await assignment.assignTeam({guild,member,league:foreign,team:'Ravens'});
    assert.equal(wrongGuild.code,'LEAGUE_WRONG_GUILD');
    const inactive = await assignment.assignTeam({guild,member,league:archived,team:'Ravens'});
    assert.equal(inactive.code,'LEAGUE_ARCHIVED');
    assert.equal(calls,0,'a stale caller object cannot authorize mutation');
  } finally {
    openTeams.getOpenTeamsForLeague=oldCandidates;
    openTeams.claimTeam=oldClaim;
  }

  const panel = sessions.create({guildId:guild.id,actorId:member.id,flow:'team',options:[{value:'Ravens'}]});
  assert.equal(sessions.access(panel,{guildId:'other-guild',user:{id:member.id}}).ok,false);
  assert.equal(sessions.access(panel,{guildId:guild.id,user:{id:'other-user'}}).ok,false);
  assert.equal(sessions.access(panel,{guildId:guild.id,user:{id:member.id}}).ok,true);
  assert.equal(sessions.access(panel,{user:{id:member.id}}).ok,false,'missing guild context fails closed');
  sessions.remove(panel.id);
  assert.equal(sessions.access(sessions.get(panel.id),{guildId:guild.id,user:{id:member.id}}).ok,false);

  const canary='super-secret-canary-123';
  await security.auditLog({action:'test-redaction',guildId:guild.id,details:{apiKey:canary,nested:{password:canary},url:'postgres://user:pass@db.example/test'}});
  const recent=security.getRecentAuditLog(1)[0];
  assert.ok(!recent.details.includes(canary));
  assert.ok(!recent.details.includes('postgres://'));
  console.log('G0/G1 integrity: 1 passed, 0 failed');
})().catch(err=>{console.error(err);process.exitCode=1;});
