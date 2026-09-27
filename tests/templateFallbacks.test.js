'use strict';
const { ChannelType } = require('discord.js');
const { test, run, assert, eq, mockGuild } = require('./_harness');
const rules = require('../src/services/leagueSetupService')._internals;
const names = require('../src/services/nicknamePolicyService');
const profiles = require('../src/services/memberProfileService');
const cleanup = require('../src/services/templateReconciliationService');
const base = require('../src/services/baseInitService');
const topology = require('../src/services/channelTopologyService');

test('rules lookup stays inside the selected league and accepts old and new names', async () => {
  const guild = mockGuild();
  const baseCat = guild._makeChannel({name:'Welcome',type:ChannelType.GuildCategory});
  const a = guild._makeChannel({name:'A Info',type:ChannelType.GuildCategory});
  const b = guild._makeChannel({name:'B Info',type:ChannelType.GuildCategory});
  guild._makeChannel({name:'rules',parent:baseCat});
  const owned = guild._makeChannel({name:'ffrules',parent:a});
  const leagueRules = guild._makeChannel({name:'rules',parent:b});
  eq((await rules.getLeagueRulesChannel(guild,{id:'a',builtCategoryIds:[a.id],builtChannelIds:[owned.id]})).id,owned.id);
  eq(await rules.getLeagueRulesChannel(guild,{id:'lost',builtCategoryIds:[],builtChannelIds:[]}),null);
  require('../src/services/activeLeagueService').upsertLeague({id:'b',guildId:guild.id,leagueName:'B',builtCategoryIds:[b.id],builtChannelIds:[leagueRules.id]});
  eq(topology.findConfiguredChannel(guild,'rules',{textOnly:true}).parentId,baseCat.id);
});

test('rules preset keeps the prior bot post if the replacement send fails', async () => {
  const guild=mockGuild();
  const cat=guild._makeChannel({name:'League Info',type:ChannelType.GuildCategory});
  const ch=guild._makeChannel({name:'rules',parent:cat});
  let deleted=false;
  ch.messages.fetch=async()=>new Map([['prior',{author:{id:guild.members.me.id},embeds:[{title:'📖 Test — Old Rules'}],delete:async()=>{deleted=true;}}]]);
  ch.send=async()=>{throw new Error('Discord denied send');};
  try { await rules.publishLeagueRulesForPreset(guild,{id:'test',leagueName:'Test',builtCategoryIds:[cat.id],builtChannelIds:[ch.id]},'competitive_default'); }
  catch (err) { eq(err.message,'Discord denied send'); }
  eq(deleted,false,'prior rules remain visible');
});

test('team identity is league-specific while native guild nicknames remain untouched', async () => {
  const member = {id:'member-stable',displayName:'Player',user:{username:'Player'}};
  profiles.upsertProfile(member.id,{timezone:'America/Los_Angeles',timezoneLabel:'PDT',nicknameBase:'Player'});
  const state = {openTeamRegistry:[{ownerId:member.id,leagueId:'a',displayTeam:'Lions'}]};
  eq(names.buildDesiredNickname(member,state,{channel:{id:'a'}}),null);
  eq(names.getDisplayForLeague(state,member.id,'a'),'Lions');
  state.openTeamRegistry.push({ownerId:member.id,leagueId:'b',displayTeam:'Ravens'});
  eq(names.getDisplayForLeague(state,member.id,'b'),'Ravens');
  let changed=false;
  eq((await names.syncMemberNickname({...member,nickname:'My chosen name',manageable:true,setNickname:async()=>{changed=true;}},state)).reason,'custom-nickname-preserved');
  eq(changed,false);
});

test('legacy bot team nickname resets to Discord profile while commissioner hierarchy failure is explicit', async () => {
  const member={guild:{id:'nickname-guild'},id:'legacy-nick',nickname:'Lions (PDT)',displayName:'Lions (PDT)',user:{username:'Player'}};
  const state={openTeamRegistry:[{ownerId:member.id,leagueId:'league-a',displayTeam:'Lions'}]};
  profiles.upsertProfile(member.id,{timezone:'America/Los_Angeles',timezoneLabel:'PDT',nicknameBase:'Player',botNicknameAssignment:{guildId:member.guild.id,value:member.nickname,status:'ASSIGNED'}});
  eq((await names.syncMemberNickname({...member,manageable:false},state)).reason,'not-manageable');
  let value='not-called';
  const result=await names.syncMemberNickname({...member,manageable:true,setNickname:async next=>{value=next;}},state);
  eq(result.restored,true);eq(value,null);
  const changedSeason=await names.syncMemberNickname({...member,nickname:'Lions (EDT)',manageable:true,setNickname:async next=>{value=next;}},state);
  eq(changedSeason.reason,'custom-nickname-preserved');
});

test('initial template manifest records ownership so a later edit can remove obsolete bot assets', async () => {
  const guild = mockGuild();
  const old = guild._makeChannel({name:'Initial Gaming',type:ChannelType.GuildCategory});
  const stale = guild._makeChannel({name:'squad-up',parent:old}); stale.topic='Gaming Server channel for Test';
  eq(cleanup.recordDesired(guild,[{name:'Initial Gaming',channels:[['squad-up',false]]}]).recorded,1);
  const next = guild._makeChannel({name:'Next Sports',type:ChannelType.GuildCategory});
  const keep = guild._makeChannel({name:'scores',parent:next}); keep.topic='Sports Server channel for Test';
  const result = await cleanup.reconcile(guild, cleanup.capture(guild), [{name:'Next Sports',channels:[['scores',false]]}]);
  eq(result.deletedChannels,1);
  assert(!guild.channels.cache.has(stale.id),'obsolete bot-owned channel removed after manifest-backed edit');
  assert(guild.channels.cache.has(keep.id),'new desired channel preserved');
});

test('template option switch deletes identifiable old assets and preserves manual channels', async () => {
  const guild = mockGuild();
  const old = guild._makeChannel({name:'Old Gaming',type:ChannelType.GuildCategory});
  const obsolete = guild._makeChannel({name:'squad-up',parent:old}); obsolete.topic='Gaming Server channel for Test';
  const manual = guild._makeChannel({name:'personal-notes',parent:old}); manual.topic='User-created';
  const next = guild._makeChannel({name:'New Sports',type:ChannelType.GuildCategory});
  const channel = guild._makeChannel({name:'scores',parent:next}); channel.topic='Sports Server channel for Test';
  recordTemplate(guild,[obsolete]);
  const snap=cleanup.capture(guild);
  const result=await cleanup.reconcile(guild,snap,[{name:'New Sports',channels:[['scores',false]]}],cat=>base._internals._isProtectedScopeCategory(guild,cat));
  eq(result.deletedChannels,1);
  assert(guild.channels.cache.has(old.id),'manual child keeps its category');
  assert(guild.channels.cache.has(manual.id),'manual channel preserved');
  assert(guild.channels.cache.has(channel.id),'new template channel preserved');
});

test('same-named template channels remain in their separate categories', async () => {
  const guild=mockGuild();
  const a=guild._makeChannel({name:'A',type:ChannelType.GuildCategory});
  const b=guild._makeChannel({name:'B',type:ChannelType.GuildCategory});
  const first=await base.findOrCreateText(guild,a,'general-chat');
  const second=await base.findOrCreateText(guild,b,'general-chat');
  assert(first.id!==second.id,'category IDs separate otherwise identical names');
  eq(first.parentId,a.id); eq(second.parentId,b.id);
});

test('empty former template category is removed after its last managed channel', async () => {
  const guild=mockGuild();
  const old=guild._makeChannel({name:'Old Option',type:ChannelType.GuildCategory});
  const stale=guild._makeChannel({name:'old-option',parent:old}); stale.topic='Custom space: Old Option';
  const next=guild._makeChannel({name:'New Option',type:ChannelType.GuildCategory});
  const keep=guild._makeChannel({name:'new-option',parent:next}); keep.topic='Custom space: New Option';
  recordTemplate(guild,[stale]);
  const result=await cleanup.reconcile(guild,cleanup.capture(guild),[{name:'New Option',channels:[['new-option',false]]}]);
  eq(result.deletedCategories,1);
  assert(!guild.channels.cache.has(old.id) && guild.channels.cache.has(next.id),'only old empty category removed');
});

test('two active leagues can share a display prefix because space IDs isolate them', async () => {
  const service=require('../src/services/managedSpaceService');
  const guildId='same-prefix-check';
  const a=await service.reserve(guildId,{name:'Frost League',code:'fr',kind:'league'});
  const b=await service.reserve(guildId,{name:'Friday League',code:'fr',kind:'league'});
  assert(a.id!==b.id,'distinct league identities');
});

test('active-check fallback stays in its private league category', async () => {
  const guild=mockGuild();
  const unrelated=guild._makeChannel({name:'active-check'});
  const cat=guild._makeChannel({name:'FF Gameplay',type:ChannelType.GuildCategory});
  const role='league-member-role';
  const league={id:'active-check-private',guildId:guild.id,leagueName:'Friday',memberRoleId:role,builtCategoryIds:[cat.id],builtChannelIds:[]};
  const result=await require('../src/services/leagueFeatureService').toggleActiveCheckForLeague(guild,league,{});
  assert(result.enabled && result.channel.id!==unrelated.id,'unrelated channel not adopted');
  eq(result.channel.parentId,cat.id);
  assert(result.channel.permissionOverwrites.cache.get(guild.id).deny.includes(require('discord.js').PermissionFlagsBits.ViewChannel),'everyone denied');
  assert(result.channel.permissionOverwrites.cache.has(role),'league role permitted');
});

test('base policy refresh does not expose a private league rules channel', async () => {
  const guild=mockGuild();
  const cat=guild._makeChannel({name:'FF League Info',type:ChannelType.GuildCategory});
  const ch=guild._makeChannel({name:'rules',parent:cat});
  require('../src/services/activeLeagueService').upsertLeague({id:'private-policy',guildId:guild.id,leagueName:'FF',builtCategoryIds:[cat.id],builtChannelIds:[ch.id]});
  await base.normalizeBaseChannelPolicies(guild);
  assert(!ch.permissionOverwrites.cache.has(guild.id),'league everyone overwrite must remain untouched');
});

test('base permission failure is visible to template build caller', async () => {
  const guild=mockGuild();
  const cat=guild._makeChannel({name:'👋 Welcome to Test Guild',type:ChannelType.GuildCategory});
  const ch=guild._makeChannel({name:'rules',parent:cat});
  ch.permissionOverwrites.edit=async()=>{throw new Error('Missing Manage Channels');};
  let rejected=false;
  try { await base.normalizeBaseChannelPolicies(guild); } catch (err) { rejected=err.message==='Missing Manage Channels'; }
  assert(rejected,'permission failure must be reported');
});

test('membership roles are readable unique and taggable without elevated permissions', () => {
  const roles=require('../src/services/spaceRoleService');
  const a=roles.membershipRoleOptions('league','Friday Football','aaaaaaaa-1111');
  const b=roles.membershipRoleOptions('event','Weekend Finals','bbbbbbbb-2222');
  assert(a.name.includes('Friday Football') && b.name.includes('Weekend Finals'));
  assert(a.name!==b.name && a.mentionable && b.mentionable);
  eq(a.permissions,[]);eq(b.permissions,[]);
});

test('active check failed post cannot start a response timer or count members absent', async () => {
  const guild=mockGuild();
  const cat=guild._makeChannel({name:'League Gameplay',type:ChannelType.GuildCategory});
  const ch=guild._makeChannel({name:'active-check',parent:cat});
  const league={id:'failed-post',guildId:guild.id,leagueName:'Friday',memberRoleId:'role-friday',builtCategoryIds:[cat.id],builtChannelIds:[ch.id]};
  require('../src/services/activeLeagueService').upsertLeague(league);
  const features=require('../src/services/leagueFeatureService');
  features.setLeague(league.id,{activeCheckEnabled:true,channelId:ch.id,lastPostedAt:null,windowEndsAt:null});
  const state={openTeamRegistry:[{ownerId:'p1',leagueId:league.id,displayTeam:'Lions'}]};
  ch.send=async()=>{throw new Error('Discord send denied');};
  const batch=await features.processDueActiveChecks(guild,state);
  assert(batch.errors.some(x=>x.leagueId===league.id&&x.error==='Discord send denied'),'caller receives per-league Discord error');
  eq(features.getLeague(league.id).windowEndsAt,null);
  ch.send=async payload=>{guild._sent.push(payload);return {id:'sent'};};
  await features.processDueActiveChecks(guild,state);
  assert(guild._sent[0].content.includes('<@&role-friday>') && guild._sent[0].content.includes('<@p1> — Lions'));
  eq(guild._sent[0].allowedMentions.roles,['role-friday']);
  assert(features.getLeague(league.id).windowEndsAt>0);
});

test('inactivity removal targets only its league and never kicks the member from the server', async () => {
  const guild=mockGuild();
  const member={id:'member-in-two',user:{username:'Player'},kick:async()=>{throw new Error('server kick must not run');}};
  guild.members.fetch=async()=>member;
  const league={id:'inactivity-a',leagueName:'League A'};
  const state={openTeamRegistry:[
    {ownerId:member.id,leagueId:league.id,displayTeam:'Lions'},
    {ownerId:member.id,leagueId:'inactivity-b',displayTeam:'Ravens'},
  ]};
  const open=require('../src/services/openTeamsService');
  const original=open.releaseByUserId;
  let target=null;
  open.releaseByUserId=async(_guild,userId,leagueId)=>{target={userId,leagueId};return state.openTeamRegistry[0];};
  try {
    await require('../src/services/leagueFeatureService')._internals.executeAutoBoots(guild,state,league,[member.id],{[member.id]:5});
    eq(target,{userId:member.id,leagueId:league.id});
    eq(state.openTeamRegistry[1].ownerId,member.id);
  } finally {open.releaseByUserId=original;}
});

test('community role failure is visible and a pending league is excluded from community overwrites', async () => {
  const guild=mockGuild();
  guild.id='333333333333333333';guild.roles.everyone.id=guild.id;
  const communities=require('../src/services/communityAccessService');
  guild.roles.create=async()=>{throw new Error('Manage Roles denied');};
  let rejected=false;
  try{await communities.ensureCommunityRoles(guild,{serverTemplate:'sports'});}catch(err){rejected=err.message==='Manage Roles denied';}
  assert(rejected,'role creation failure cannot be reported as success');
  guild.roles.create=async({name})=>{const role={id:`community-${guild.roles.cache.size}`,name};guild.roles.cache.set(role.id,role);return role;};
  const category=guild._makeChannel({name:'League Pending',type:ChannelType.GuildCategory});
  const channel=guild._makeChannel({name:'standings',parent:category});
  const spaces=require('../src/services/managedSpaceService');
  const pending=await spaces.reserve(guild.id,{kind:'league',name:'Pending Privacy'});
  await spaces.transition(guild.id,pending.id,'PREPARING',{builtCategoryIds:[category.id]});
  await communities.syncCommunityChannelPermissions(guild,{serverTemplate:'sports'});
  assert(!channel.permissionOverwrites.cache.has(guild.id),'a pending private category is not made public by community access');
});

function recordTemplate(guild,channels){const store=require('../src/storage/jsonStore');const data=store.loadJson('templateBuildManifest.json',{})||{};data[guild.id]={channels:channels.map(ch=>({id:ch.id,name:ch.name,topic:ch.topic,parentId:ch.parentId}))};store.saveJson('templateBuildManifest.json',data);}
run('templateFallbacks.test.js');
