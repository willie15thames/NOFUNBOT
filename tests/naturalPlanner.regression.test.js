'use strict';
const assert = require('assert');
const planner = require('../src/services/naturalActionPlannerService');
const activeLeagueService = require('../src/services/activeLeagueService');

let passed=0, failed=0;
async function test(name, fn){ try{ await fn(); console.log('✅',name); passed++; }catch(e){ console.error('❌',name,'\n ',e.stack||e); failed++; }}
function member(id,name){ return { id:String(id), displayName:name, user:{ id:String(id), username:name, globalName:name }, toString(){return `<@${id}>`;}}; }
function fakeMessage(text, members, authorId='900000000000000001'){
  const map=new Map(members.map(m=>[m.id,m]));
  const bot={id:'999999999999999999'};
  return {
    content:`<@${bot.id}> ${text}`, author:{id:authorId}, member:map.get(authorId)||member(authorId,'Commissioner'),
    guild:{id:'g1', members:{ me:{id:bot.id}, cache:map, fetch:async id=>map.get(String(id))||null, search:async()=>new Map() }},
    channel:{id:'c1'}, client:{user:bot}, mentions:{users:new Map()},
  };
}
function state(rows){ return {openTeamRegistry:rows}; }
function league(id,name){ return {id,leagueName:name,status:'active'}; }

(async()=>{
  const Paul=member('900000000000000002','Paul'); const Sam=member('900000000000000003','Sam'); const Comm=member('900000000000000001','Comm');
  activeLeagueService.getLeague = id => ({l1:league('l1','Sunday League'),l2:league('l2','Weeknight League')})[id]||null;
  const assignment = require('../src/application/teamAssignmentUseCase');
  const realAssign = assignment.assignTeam;

  await test('new full request clears stale member from prior ambiguity', async()=>{
    planner.clearPending(); const s=state([
      {leagueId:'l1',baseTeam:'Ravens',displayTeam:'Ravens',isOpen:true}, {leagueId:'l2',baseTeam:'Ravens',displayTeam:'Ravens',isOpen:true},
      {leagueId:'l1',baseTeam:'Jets',displayTeam:'Jets',isOpen:true},
    ]);
    let claims=[]; assignment.assignTeam=async input=>{claims.push(input);return {success:true,entry:{displayTeam:input.team},league:activeLeagueService.getLeague(input.leagueId)};};
    let r=await planner.tryHandleCommissionerMessage(fakeMessage('put Paul on the Ravens',[Comm,Paul,Sam]),{state:s,claimTeam:async(...a)=>{claims.push(a);return {success:true,entry:a[2]};}});
    assert.equal(r.handled,true); assert.match(r.reply,/more than one league/i); assert.equal(claims.length,0);
    r=await planner.tryHandleCommissionerMessage(fakeMessage('put Sam on the Jets',[Comm,Paul,Sam]),{state:s,claimTeam:async(g,m,t,o)=>{claims.push({m,t,o});return {success:true,entry:{leagueId:o.leagueId,displayTeam:t}};}});
    assert.equal(r.executed,true); assert.equal(claims.length,1); assert.equal(claims[0].member.id,Sam.id);
  });

  await test('unique team across multiple leagues executes without league clarification', async()=>{
    planner.clearPending(); const s=state([{leagueId:'l1',baseTeam:'Ravens',displayTeam:'Ravens',isOpen:true},{leagueId:'l2',baseTeam:'Jets',displayTeam:'Jets',isOpen:true}]);
    let got=null; assignment.assignTeam=async input=>{got=input;return {success:true,entry:{displayTeam:input.team},league:activeLeagueService.getLeague(input.leagueId)};}; const r=await planner.tryHandleCommissionerMessage(fakeMessage('put Paul on the Ravens',[Comm,Paul]),{state:s,claimTeam:async(g,m,t,o)=>{got={m,t,o};return {success:true,entry:{leagueId:o.leagueId,displayTeam:t}};}});
    assert.equal(r.executed,true); assert.equal(got.member.id,Paul.id); assert.equal(got.leagueId,'l1');
  });

  await test('duplicate team asks league then explicit mention follow-up resumes safely', async()=>{
    planner.clearPending(); const s=state([{leagueId:'l1',baseTeam:'Ravens',displayTeam:'Ravens',isOpen:true},{leagueId:'l2',baseTeam:'Ravens',displayTeam:'Ravens',isOpen:true}]);
    let claims=[]; assignment.assignTeam=async input=>{claims.push(input);return {success:true,entry:{displayTeam:input.team},league:activeLeagueService.getLeague(input.leagueId)};}; let r=await planner.tryHandleCommissionerMessage(fakeMessage('put Paul on the Ravens',[Comm,Paul]),{state:s,claimTeam:async()=>{throw new Error('should not claim yet');}});
    assert.match(r.reply,/which league/i);
    r=await planner.tryHandleCommissionerMessage(fakeMessage('Sunday League',[Comm,Paul]),{state:s,claimTeam:async(g,m,t,o)=>{claims.push({m,t,o});return {success:true,entry:{leagueId:o.leagueId,displayTeam:t}};}});
    assert.equal(r.executed,true); assert.equal(claims[0].member.id,Paul.id); assert.equal(claims[0].leagueId,'l1');
  });

  assignment.assignTeam=realAssign;
  const catalogCases=[
    ['create a channel called film-room',{type:'create_channel',name:'film-room'}],
    ['rename channel film-room to scouting',{type:'rename_channel',oldName:'film-room',newName:'scouting'}],
    ['set topic for scouting to Weekly opponent study',{type:'set_channel_topic',name:'scouting',topic:'Weekly opponent study'}],
    ['make a role called Stream Team',{type:'create_role',name:'Stream Team'}],
    ['rename role Stream Team to Media Team',{type:'rename_role',oldName:'Stream Team',newName:'Media Team'}],
    ['set role Media Team color to #AABBCC',{type:'set_role_color',name:'Media Team',color:'#AABBCC'}],
    ['rename category League Office to Front Office',{type:'rename_category',oldName:'League Office',newName:'Front Office'}],
    ['delete channel old-room',{type:'delete_channel',name:'old-room'}],
    ['post \"Week 4 is live\" in announcements',{type:'post_message',text:'Week 4 is live',channelName:'announcements'}],
    ['turn league automation off',{type:'set_automation_policy',enabled:false}],
    ['set automation interval to 48 hours',{type:'set_automation_policy',intervalHours:48}],
    ['refresh the open teams board',{type:'refresh_open_teams'}],
    ['check league status',{type:'league_status'}],
    ['dry run the advance',{type:'request_league_advance',dryRun:true}],
    ['advance the league',{type:'request_league_advance',dryRun:false}],
    ['set hub week to 7',{type:'set_hub_week',week:7}],
    ['publish the current week',{type:'release_week'}],
    ['show the banned list',{type:'ban_list'}],
    ['ban <@900000000000000099> for repeated no-shows',{type:'ban_user',userId:'900000000000000099',reason:'repeated no-shows'}],
    ['unban <@900000000000000099>',{type:'unban_user',userId:'900000000000000099'}],
    ['add to the rules under Scheduling: Games must be scheduled within 24 hours',{type:'update_rules',newText:'Games must be scheduled within 24 hours',section:'Scheduling'}],
    ['turn shadow mode off',{type:'set_automation_policy',shadowMode:false}],
    ['block advance when a game is active on',{type:'set_automation_policy',blockOnActiveGame:true}],
    ['require all games final before advance on',{type:'set_automation_policy',requireAllGamesFinal:true}],
    ['check provider status',{type:'provider_status'}],
    ['sync league data now',{type:'provider_sync_now'}],
    ['test NeonSportz connection',{type:'provider_test_connection',provider:'neonsportz'}],
    ['activate NeonSportz provider',{type:'provider_activate_connection',provider:'neonsportz'}],
    ['disconnect NeonSportz provider',{type:'provider_disconnect',provider:'neonsportz'}],
    ['reconnect NeonSportz provider',{type:'provider_reconnect',provider:'neonsportz'}],
  ];
  for (const [text,expected] of catalogCases) await test(`catalog planner: ${text}`, async()=>assert.deepStrictEqual(planner.parseCatalogAction(text),expected));

  await test('release team resolves a unique claimed team without asking league', async()=>{
    planner.clearPending();
    const s=state([{leagueId:'l1',baseTeam:'Ravens',displayTeam:'Ravens',isOpen:false,ownerId:Paul.id},{leagueId:'l2',baseTeam:'Jets',displayTeam:'Jets',isOpen:false,ownerId:Sam.id}]);
    const r=planner.planCatalogActionFromMessage(fakeMessage('release the Ravens',[Comm,Paul,Sam]),{state:s});
    assert.equal(r.handled,true); assert.deepStrictEqual(r.action,{type:'release_team',teamName:'Ravens::l1'});
  });

  await test('release team asks for league only when the claimed team is duplicated', async()=>{
    planner.clearPending();
    const s=state([{leagueId:'l1',baseTeam:'Ravens',displayTeam:'Ravens',isOpen:false,ownerId:Paul.id},{leagueId:'l2',baseTeam:'Ravens',displayTeam:'Ravens',isOpen:false,ownerId:Sam.id}]);
    let r=planner.planCatalogActionFromMessage(fakeMessage('release the Ravens',[Comm,Paul,Sam]),{state:s});
    assert.match(r.reply,/which league/i); assert.equal(r.action,undefined);
    r=planner.planCatalogActionFromMessage(fakeMessage('Sunday League',[Comm,Paul,Sam]),{state:s});
    assert.deepStrictEqual(r.action,{type:'release_team',teamName:'Ravens::l1'});
  });

  
  await test('catalog planner: replace an existing rule with new text',async()=>{const p=planner.parseCatalogAction('replace rule "Games in 48 hours" with "Games in 24 hours"');assert.deepStrictEqual(p,{type:'update_rules',oldText:'Games in 48 hours',newText:'Games in 24 hours'});});
console.log(`\nNatural planner regression: ${passed} passed, ${failed} failed`); if(failed) process.exitCode=1;
})();
