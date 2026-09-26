'use strict';
const { test, run, assert, eq, mockGuild, freshState, initGameChannels, resetFiles } = require('./_harness');

function setup() {
  resetFiles(['gameSessions.json', 'weeklyAutomation.json']);
  const state = freshState();
  const gcs = initGameChannels(state);
  const guild = mockGuild();
  return { state, gcs, guild };
}
const textChannels = g => [...g.channels.cache.values()].filter(c => c.type === 0);

test('build the same game 10 times → exactly one managed channel (BUG-003)', async () => {
  const { gcs, guild, state } = setup();
  let created = 0;
  for (let i = 0; i < 10; i++) {
    const r = await gcs.ensureGameChannel(guild, { week: 4, team1: 'Bears', team2: 'Lions', user1Id: '300000000000000001', user2Id: '300000000000000002' });
    assert(r.ok, 'ok'); if (r.created) created++;
  }
  eq(created, 1, 'created once');
  eq(textChannels(guild).length, 1, 'one text channel');
  eq(state.games.size, 1, 'one session');
  const again = await gcs.ensureGameChannel(guild, { week: 4, team1: 'Lions', team2: 'Bears', user1Id: '300000000000000002', user2Id: '300000000000000001' });
  eq(again.created, false, 'reversed order reuses');
});
test('parallel creation race → one channel survives', async () => {
  const { gcs, guild } = setup();
  const rs = await Promise.all([1, 2, 3].map(() => gcs.ensureGameChannel(guild, { week: 5, team1: 'Jets', team2: 'Bills', user1Id: '300000000000000003', user2Id: '300000000000000004' })));
  assert(rs.every(r => r.ok), 'all ok');
  eq(textChannels(guild).length, 1, 'single channel after race');
});
test('missing owner → structured HOLD, no channel, legacy wrapper returns null (BUG-004)', async () => {
  const { gcs, guild } = setup();
  const r = await gcs.ensureGameChannel(guild, { week: 1, team1: 'Bears', team2: 'Lions', user1Id: '300000000000000001', user2Id: null });
  eq(r.ok, false, 'not ok'); eq(r.reason, 'missing-owner', 'reason'); eq(r.missing, ['Lions'], 'missing side');
  eq(textChannels(guild).length, 0, 'nothing created');
  eq(await gcs.createGameChannel(guild, 1, 'Bears', { id: '300000000000000001' }, 'Lions', null), null, 'legacy null');
  eq((await gcs.ensureGameChannel(guild, { week: 1, team1: 'CPU', team2: 'Lions', user1Id: '1', user2Id: '2' })).reason, 'cpu-or-bye', 'cpu skipped');
});
test('weekly projection is idempotent; re-run creates and deletes nothing (BUG-001)', async () => {
  const { guild, state } = setup();
  const weekly = require('../src/services/weeklyAutomationService');
  state.players.set('bears', { baseTeam: 'Bears', displayTeam: 'Bears', userId: '300000000000000001' });
  state.players.set('lions', { baseTeam: 'Lions', displayTeam: 'Lions', userId: '300000000000000002' });
  state.players.set('jets', { baseTeam: 'Jets', displayTeam: 'Jets', userId: '300000000000000003' });
  state.scheduleState.week = 6;
  state.scheduleState.matchups = [{ team1: 'Bears', team2: 'Lions' }, { team1: 'Jets', team2: 'Packers' }];
  const a = await weekly.projectCurrentWeek(guild, state, state.players, { force: true });
  eq([a.created, a.held], [1, 1], 'first run: 1 created, 1 held (Packers unowned)');
  const b = await weekly.projectCurrentWeek(guild, state, state.players, { force: true });
  eq([b.created, b.cleared, b.skipped], [0, 0, 1], 'second run: nothing created or cleared');
  eq(guild._deleted.length, 0, 'no deletions');
  const legacy = await weekly.runAdvanceAutomation(guild, state, state.players);
  eq(legacy.ran, false, 'manual mode → wrapper does nothing');
  assert(weekly.getWeeklySettings().lastAdvancedWeek == null, 'projection never records a franchise advance');
});
test('restart with active game → session, responses and deadline intent restored', async () => {
  const { gcs, guild, state } = setup();
  const r = await gcs.ensureGameChannel(guild, { week: 7, team1: 'Bears', team2: 'Lions', user1Id: '300000000000000001', user2Id: '300000000000000002' });
  const sessions = require('../src/league/gameSessionService');
  state.games.get(r.channel.id).responded.add('300000000000000001');
  sessions.syncFromState(state);
  for (const g of state.games.values()) if (g.reminderId) clearTimeout(g.reminderId);
  state.games.clear(); // simulate process restart (memory gone, Discord channel remains)
  const rh = sessions.rehydrate(guild, state, gcs.armReminders);
  eq(rh.restored, 1, 'restored');
  const g = state.games.get(r.channel.id);
  assert(g && g.responded.has('300000000000000001'), 'responded set restored');
  const again = await gcs.ensureGameChannel(guild, { week: 7, team1: 'Bears', team2: 'Lions', user1Id: '300000000000000001', user2Id: '300000000000000002' });
  eq(again.created, false, 'no duplicate after restart');
  for (const x of state.games.values()) if (x.reminderId) clearTimeout(x.reminderId);
});
test('single delete refuses non-game channels; update grants resolved owner access', async () => {
  const { gcs, guild, state } = setup();
  const general = guild._makeChannel({ name: 'general-chat' });
  eq((await gcs.deleteSingleGameChannel(guild, general)).reason, 'not-a-weekly-game-channel', 'refused');
  const r = await gcs.ensureGameChannel(guild, { week: 8, team1: 'Bears', team2: 'Lions', user1Id: '300000000000000001', user2Id: '300000000000000002' });
  const upd = await gcs.refreshGameChannelOwners(guild, r.channel);
  assert(upd.ok, 'update ok');
  for (const x of state.games.values()) if (x.reminderId) clearTimeout(x.reminderId);
});
run('gameChannels.test.js');
