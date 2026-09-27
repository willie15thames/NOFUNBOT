'use strict';
const {test,run,assert,eq,mockGuild}=require('./_harness');
const {Collection,PermissionFlagsBits:P}=require('discord.js');
const registry=require('../src/services/activeLeagueService');
const setup=require('../src/services/leagueSetupService');
const spaces=require('../src/services/managedSpaceService');
const context=require('../src/league/spaceContext');
const history=require('../src/services/lifetimeHistoryService');
const storage=require('../src/storage/jsonStore');
const guild=mockGuild();
guild.roles.create=async({name,mentionable,permissions})=>{const role={id:`role-${guild.roles.cache.size}`,name,mentionable,permissions,delete:async()=>guild.roles.cache.delete(role.id)};guild.roles.cache.set(role.id,role);return role;};
const state=require('../src/state');
setup.init?.({state});
// setup takes positional state through its explicit initializer.
const leagues=[];
test('registry import exposes methods without a circular partial export',()=>{eq(typeof registry.listActiveLeagues,'function');assert(setup.LEAGUE_TYPES.madden_franchise,'league types load');});
test('three combined slots are reserved atomically and reject a fourth concurrent request',async()=>{
 const outcomes=await Promise.allSettled([1,2,3,4].map(i=>spaces.reserve('capacity',{kind:i===2?'event':'league',name:`Space ${i}`})));
 eq(outcomes.filter(x=>x.status==='fulfilled').length,3);eq(outcomes.filter(x=>x.status==='rejected').length,1);
});
test('league builds have exclusive private categories and preserve staff-only access',async()=>{
 for(const name of ['Alpha','Beta']){const built=await setup.buildLeagueStructure(guild,'madden_franchise',null,name);leagues.push(built.activeLeague);}
 for(const league of leagues){const role=guild.roles.cache.get(league.memberRoleId);assert(role.name.includes(league.leagueName)&&role.mentionable,'league role supports human-readable tagging');eq(role.permissions,[]);}
 assert(!leagues[0].builtCategoryIds.some(id=>leagues[1].builtCategoryIds.includes(id)),'no shared category');
 for(const id of leagues[0].builtChannelIds){const ch=guild.channels.cache.get(id);const all=ch.permissionOverwrites.cache.get(guild.id);assert(all.deny.includes(P.ViewChannel),'everyone denied');if(/admin|commish|commissioner|scoresheets/.test(ch.name))assert(!ch.permissionOverwrites.cache.has(leagues[0].memberRoleId),'staff channel has no member role');}
});
test('runtime and policy storage stay isolated through overlapping async contexts',async()=>{
 const runtime=require('../src/league/runtimeService');
 await Promise.all(['A','B'].map(id=>context.run(id,async()=>{runtime.patchRuntime({workflowWeek:id==='A'?2:7});await Promise.resolve();eq(runtime.getRuntime().workflowWeek,id==='A'?2:7);})));
});
test('scoped state stores independent schedule and history and preserves global team registry',async()=>{
 state.openTeamRegistry.push({leagueId:'A',baseTeam:'Ravens',isOpen:true},{leagueId:'B',baseTeam:'Ravens',isOpen:true});
 await context.run('A',async()=>{state.scheduleState.week=3;state.potwHistory.push({player:'A'});storage.saveJson('openTeamRegistry.json',state.openTeamRegistry);state.flushSpace();});
 context.run('B',()=>{eq(state.scheduleState.week,null);eq(state.potwHistory.length,0);});
 // Shared persistence merges the other league rather than replacing its rows.
 storage.saveJson('openTeamRegistry.json',state.openTeamRegistry);
 await context.run('A',async()=>storage.saveJson('openTeamRegistry.json',state.openTeamRegistry));
 assert(storage.loadJson('openTeamRegistry.json',[]).some(x=>x.leagueId==='B'),'B retained');
});
test('two identical team names claim independently and failed access rolls back ownership',async()=>{
 const open=require('../src/services/openTeamsService');open.init({state,getCh:()=>null});
 for(const lg of leagues)state.openTeamRegistry.push({leagueId:lg.id,leagueName:lg.leagueName,baseTeam:'Ravens',displayTeam:'Ravens',isOpen:true});
 const member=id=>({id,displayName:id,roles:{add:async()=>{},remove:async()=>{}}});
 const a=await open.claimTeam(guild,member('u1'),'Ravens',{leagueId:leagues[0].id});
 const b=await open.claimTeam(guild,member('u2'),'Ravens',{leagueId:leagues[1].id});
 assert(a.success&&b.success,'both claims succeed');eq([...state.players.values()].filter(x=>x.baseTeam==='Ravens').length,2);
 state.openTeamRegistry.push({leagueId:leagues[0].id,baseTeam:'Bills',displayTeam:'Bills',isOpen:true});
 const fail=await open.claimTeam(guild,{id:'bad',roles:{add:async()=>{throw new Error('Denied');}}},'Bills',{leagueId:leagues[0].id});
 eq(fail.success,false);assert(state.openTeamRegistry.find(x=>x.baseTeam==='Bills').isOpen,'slot remains open');
});
test('lifetime results and honors survive leave return archive and replay without duplicate credit',async()=>{
 const record={matchupKey:'game-1',leagueId:leagues[0].id,seasonId:'s1',homeTeam:'Ravens',awayTeam:'Bills',homeUserId:'u1',awayUserId:'u2',homeScore:20,awayScore:10};
 await history.recordResult(guild.id,record,state);await history.recordResult(guild.id,record,state);
 await history.award(guild.id,{id:'award-1',leagueId:leagues[0].id,userId:'u1',title:'Champion'});
 await history.award(guild.id,{id:'award-1',leagueId:leagues[0].id,userId:'u1',title:'Champion'});
 await history.presence(guild.id,'u1','LEFT');await history.archiveCompetition(guild.id,leagues[0]);await history.presence(guild.id,'u1','PRESENT');
 const career=await history.career(guild.id,'u1');eq([career.gamesPlayed,career.wins,career.awards.length],[1,1,1]);
 await history.recordResult(guild.id,{...record,homeScore:0,sourceRevision:'correction'},state);eq((await history.career(guild.id,'u1')).losses,1);
 await history.retract(guild.id,'game-1','comm');eq((await history.career(guild.id,'u1')).gamesPlayed,0);eq((await history.career(guild.id,'u1')).awards.length,1);
});
test('erasing A preserves B resources and A lifetime honors',async()=>{
 const before=[...leagues[1].builtChannelIds,...leagues[1].builtCategoryIds];
 await setup.deleteLeagueStructure(guild,{leagueId:leagues[0].id,channelIds:leagues[0].builtChannelIds,categoryIds:leagues[0].builtCategoryIds});
 assert(before.every(id=>guild.channels.cache.has(id)),'B resources unchanged');eq((await history.career(guild.id,'u1')).awards.length,1);
});
test('legacy awards without member identity remain unresolved and import is idempotent',async()=>{
 const old={potwHistory:[{player:'athlete'},{player:'athlete2',userId:'old'}]};
 eq(await history.importLegacy('legacy-test',old),{imported:1,unresolved:1});eq(await history.importLegacy('legacy-test',old),{imported:0,unresolved:0});
});
test('custom stats correct by source ID and remain separated by game',async()=>{
 const base={id:'stats-1',leagueId:'A',userId:'u1',metric:'passing_yards',value:250,game:'madden',seasonId:'s1'};
 await history.recordStat(guild.id,base);await history.recordStat(guild.id,base);eq((await history.career(guild.id,'u1')).metrics['madden:passing_yards'],250);
 await history.recordStat(guild.id,{...base,value:270});eq((await history.career(guild.id,'u1')).metrics['madden:passing_yards'],270);
});
test('unknown league cannot trigger fuzzy deletion',async()=>{
 const before=guild.channels.cache.size;let failed=false;
 try{await setup.deleteLeagueStructure(guild,{typeId:'madden_franchise'});}catch{failed=true;}
 assert(failed,'unsafe delete rejected');eq(guild.channels.cache.size,before);
});
test('event occupies a shared slot and grants only its dedicated member role',async()=>{
 registry.removeLeague(leagues[0].id);await spaces.transition(guild.id,leagues[0].id,'ARCHIVED');
 const ev=await require('../src/services/eventSpaceService').create(guild,{name:'Tournament'});
 assert(guild.roles.cache.get(ev.memberRoleId).name.includes('Tournament')&&guild.roles.cache.get(ev.memberRoleId).mentionable,'event role supports tagging');
 eq(ev.kind,'event');const ch=guild.channels.cache.get(ev.builtChannelIds[0]);assert(ch.permissionOverwrites.cache.get(guild.id).deny.includes(P.ViewChannel),'event private');
 assert(ch.permissionOverwrites.cache.has(ev.memberRoleId),'event-specific role');
});
test('league runtime A cannot change B policy or channel resolver',async()=>{
 const policy=require('../src/league/automationPolicyService');
 context.run('A',()=>policy.setPolicy({intervalHours:24}));context.run('B',()=>policy.setPolicy({intervalHours:72}));
 context.run('A',()=>eq(policy.getPolicy().intervalHours,24));context.run('B',()=>eq(policy.getPolicy().intervalHours,72));
 context.run(leagues[1].id,()=>{const ch=require('../src/services/channels/channelResolver').getCh(guild,'rules');assert(ch?.name==='rules'&&leagues[1].builtCategoryIds.includes(ch.parentId),'resolves selected league channel');});
});
run('auditV204.test.js');
