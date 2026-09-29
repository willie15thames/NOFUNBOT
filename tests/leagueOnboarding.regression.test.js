'use strict';
const { test, run, assert, eq, mockGuild } = require('./_harness');
const activeLeagueService = require('../src/services/activeLeagueService');
const onboarding = require('../src/services/leagueMemberOnboardingService');
const profiles = require('../src/services/memberProfileService');
const nicknames = require('../src/services/nicknamePolicyService');

function resetLeagues() { activeLeagueService.saveRegistry({}); }

function makeMember(guild, id, nickname = null) {
  const dms = [];
  return {
    guild,
    id,
    nickname,
    displayName: nickname || 'Player',
    manageable: true,
    user: { id, username: 'Player', globalName: null, bot: false },
    send: async payload => { dms.push(payload); return { id:`dm-${id}` }; },
    setNickname: async function(next) { this.nickname = next; this.displayName = next || this.user.username; return this; },
    _dms: dms,
  };
}

test('commissioner placement sends exact league, team, and member-owned timezone selector', async () => {
  resetLeagues();
  const guild = mockGuild();
  const general = guild._makeChannel({ name:'general' });
  activeLeagueService.upsertLeague({
    id:'league-a', guildId:guild.id, leagueName:'Test League A', leagueTypeId:'madden_standard', game:'madden',
    builtChannelIds:[general.id], builtCategoryIds:[],
  });
  const member = makeMember(guild, 'member-onboard-a');
  const out = await onboarding.notifyMemberAdded({ guild, member, leagueId:'league-a', teamName:'Baltimore Ravens', actorId:'comm-1' });
  assert(out.ok, 'onboarding send succeeds');
  eq(guild._sent.length, 1, 'one canonical league-channel greeting');
  const payload = guild._sent[0].payload;
  eq(payload.content, `<@${member.id}>`);
  const embed = payload.embeds[0].toJSON();
  eq(embed.title, '👋 Welcome to Test League A');
  assert(embed.description.includes('**Team:** Baltimore Ravens'), 'team appears in greeting');
  assert(embed.description.includes('Choose your timezone'), 'timezone is the next action');
  const row = payload.components[0].toJSON();
  assert(row.components[0].custom_id.startsWith('ui:'), 'timezone choices use opaque button sessions');
  const session = require('../src/services/componentSessionService').get(row.components[0].custom_id.split(':')[1]);
  eq(session.legacyCustomId, `league_member_timezone::league-a::${member.id}`);
  assert(member._dms[0].content.includes('Test League A'), 'DM identifies exact league');
  assert(member._dms[0].content.includes('Baltimore Ravens'), 'DM identifies assigned team');
});

test('member placed without a team is told the exact league and next team-selection step', async () => {
  resetLeagues();
  const guild = mockGuild();
  const general = guild._makeChannel({ name:'general' });
  activeLeagueService.upsertLeague({
    id:'league-b', guildId:guild.id, leagueName:'Test League B', leagueTypeId:'madden_standard', game:'madden',
    builtChannelIds:[general.id], builtCategoryIds:[],
  });
  const member = makeMember(guild, 'member-onboard-b');
  const out = await onboarding.notifyMemberAdded({ guild, member, leagueId:'league-b', teamName:null, actorId:'comm-1' });
  assert(out.ok, 'onboarding send succeeds');
  const embed = guild._sent[0].payload.embeds[0].toJSON();
  assert(embed.description.includes('**Team:** not selected yet'), 'no silent team assignment');
  assert(embed.description.includes('`/select-team`'), 'member is told how to choose a team');
});

test('timezone nickname uses member identity, never league team identity', async () => {
  const guild = mockGuild();
  const member = makeMember(guild, 'member-nick-a', 'My Chosen Name');
  profiles.upsertProfile(member.id, { timezone:'America/Los_Angeles', timezoneLabel:'PDT', lastSeenDisplayName:'My Chosen Name' });
  const state = { openTeamRegistry:[
    { ownerId:member.id, leagueId:'league-a', displayTeam:'Lions' },
    { ownerId:member.id, leagueId:'league-b', displayTeam:'Ravens' },
  ]};
  const result = await nicknames.syncMemberNickname(member, state, { reason:'onboarding regression' });
  assert(result.ok && result.assigned, 'timezone nickname assigned');
  eq(member.nickname, 'My Chosen Name (PDT)');
  eq(nicknames.getDisplayForLeague(state, member.id, 'league-a'), 'Lions');
  eq(nicknames.getDisplayForLeague(state, member.id, 'league-b'), 'Ravens');
});

test('legacy team-based nickname migrates to profile-plus-timezone instead of carrying a league team across leagues', async () => {
  const guild = mockGuild();
  const member = makeMember(guild, 'member-legacy-a', 'Lions (PDT)');
  profiles.upsertProfile(member.id, {
    timezone:'America/Los_Angeles', timezoneLabel:'PDT', lastSeenDisplayName:'Player',
    botNicknameAssignment:{ guildId:guild.id, value:'Lions (PDT)', status:'ASSIGNED', originalNickname:null },
  });
  member.user.username = 'Player';
  const state = { openTeamRegistry:[{ ownerId:member.id, leagueId:'league-a', displayTeam:'Lions' }] };
  const result = await nicknames.syncMemberNickname(member, state, { reason:'legacy migration regression' });
  assert(result.ok && result.assigned, 'legacy nickname is actively migrated');
  eq(member.nickname, 'Player (PDT)');
});

run('League onboarding regression');
