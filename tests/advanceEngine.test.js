'use strict';
const { test, run, assert, eq, mockGuild, freshState, initGameChannels, resetFiles } = require('./_harness');
const FILES = ['leagueRuntime.json', 'automationPolicy.json', 'scheduleRegistry.json', 'weeklyAutomation.json', 'gameSessions.json', 'gameResults.json', 'liveSync.json'];

function setup({ enabled = true, shadow = false, week = 3, games = null } = {}) {
  resetFiles(FILES);
  const state = freshState();
  initGameChannels(state);
  const reg = require('../src/services/scheduleRegistryService');
  const policy = require('../src/league/automationPolicyService');
  policy.setPolicy({ enabled, intervalHours: 48, shadowMode: shadow, precheckPolicy: { requireProviderHealthy: true, blockOnActiveGame: true } });
  reg.upsertWeek(week, games || [{ team1: 'Bears', team2: 'Lions' }], { source: 'test' });
  reg.loadWeekIntoState(state, week);
  const rt = require('../src/league/runtimeService');
  rt.saveRuntime({ ...rt.DEFAULTS, state: 'WEEK_ACTIVE', workflowWeek: week, nextAdvanceAt: Date.now() - 1000, deadlineArmedAt: Date.now() - 49 * 3600000 });
  return { state, rt, reg, policy, engine: require('../src/league/advanceEngine') };
}

test('48h deadline with a provider that cannot control Madden → AWAITING_SOURCE_ADVANCE, nothing published (rule 21/26)', async () => {
  const { state, engine, rt } = setup();
  const r = await engine.tick({ state, notify: false });
  eq(r.state, 'AWAITING_SOURCE_ADVANCE', 'state');
  eq(rt.getRuntime().workflowWeek, 3, 'workflow week unchanged');
  eq(state.scheduleState.week, 3, 'schedule week unchanged');
  assert(r.messages.some(m => /Madden advance required/.test(m)), 'native action instruction sent');
  assert(require('../src/services/weeklyAutomationService').getWeeklySettings().lastAdvancedWeek == null, 'no advance recorded');
});
test('timer tick again while awaiting → no second cycle, no publish (advance twice = no-op)', async () => {
  const { state, engine, rt } = setup();
  await engine.tick({ state, notify: false });
  const cycle = rt.getRuntime().cycleId;
  const r2 = await engine.requestAdvance({ state });
  eq(r2.state, 'AWAITING_SOURCE_ADVANCE', 'still awaiting');
  eq(rt.getRuntime().cycleId, cycle, 'same cycle');
});
test('source verified → import → validate → publish exactly once; new deadline armed', async () => {
  const { state, engine, rt, reg } = setup();
  await engine.tick({ state, notify: false });
  reg.importScheduleObject({ currentWeek: 4, weeks: { 4: [{ team1: 'Bears', team2: 'Packers' }] } }, { source: 'test' });
  const r = await engine.tick({ state, notify: false });
  eq(r.state, 'WEEK_ACTIVE', 'back to active');
  const after = rt.getRuntime();
  eq([after.workflowWeek, after.sourceWeek, after.lastPublishedWeek], [4, 4, 4], 'weeks advanced to 4');
  eq(state.scheduleState.week, 4, 'state published week 4');
  assert(after.nextAdvanceAt > Date.now() + 47 * 3600000, 'next 48h deadline armed');
  assert(String(after.sourceVerification).startsWith('provider:local'), 'verification labelled');
  eq(require('../src/services/weeklyAutomationService').getWeeklySettings().lastAdvancedWeek, 4, 'verified advance recorded');
  const again = await engine.tick({ state, notify: false });
  eq(rt.getRuntime().workflowWeek, 4, 'no double publish');
  eq(again.state, 'WEEK_ACTIVE', 'stable');
});
test('source reports new week but import missing → no publish, RETRY then RECOVERY (partial import)', async () => {
  const { state, engine, rt, reg } = setup();
  await engine.tick({ state, notify: false });
  const r0 = reg.getRegistry(); r0.currentWeek = 4; reg.saveRegistry(r0); // source says 4, no week-4 games
  const r = await engine.tick({ state, notify: false });
  eq(r.state, 'RETRY_WAIT', 'retry wait');
  eq(state.scheduleState.week, 3, 'not published');
});
test('import with unknown team → RECOVERY_REQUIRED, not published, alert (missing team)', async () => {
  const { state, engine, rt, reg } = setup();
  state.openTeamRegistry.push({ baseTeam: 'Bears', displayTeam: 'Bears' }, { baseTeam: 'Lions', displayTeam: 'Lions' }, { baseTeam: 'Packers', displayTeam: 'Packers' });
  await engine.tick({ state, notify: false });
  reg.importScheduleObject({ currentWeek: 4, weeks: { 4: [{ team1: 'Bears', team2: 'Martians' }] } }, { source: 'test' });
  const r = await engine.tick({ state, notify: false });
  eq(r.state, 'RECOVERY_REQUIRED', 'recovery');
  assert(r.messages.some(m => /failed validation/.test(m) && /martians/i.test(m)), 'alert names the team');
  eq(state.scheduleState.week, 3, 'not published');
});
test('active game in progress → HOLD with reason; resume re-checks', async () => {
  const { state, engine, rt } = setup();
  const gcs = require('../src/services/gameChannelService');
  const guild = mockGuild();
  const c = await gcs.ensureGameChannel(guild, { week: 3, team1: 'Bears', team2: 'Lions', user1Id: '300000000000000001', user2Id: '300000000000000002' });
  await gcs.handleGameChannelMessage({ channel: c.channel, guild, content: 'searching now', author: { tag: 't' } });
  const r = await engine.tick({ state, notify: false });
  eq(r.state, 'HOLD', 'held');
  assert(/in progress/.test(rt.getRuntime().hold.reason), 'reason recorded');
  state.games.get(c.channel.id).finished = true; // result reported
  const resumed = await engine.resume({ state });
  eq(resumed.state, 'AWAITING_SOURCE_ADVANCE', 'finished game no longer blocks; resume re-ran prechecks');
  for (const g of state.games.values()) if (g.reminderId) clearTimeout(g.reminderId);
});
test('shadow mode → records WOULD decision, no advance, re-arms deadline', async () => {
  const { state, engine, rt } = setup({ shadow: true });
  const r = await engine.tick({ state, notify: false });
  eq(r.state, 'WEEK_ACTIVE', 'stays active');
  eq(rt.getRuntime().lastShadowDecision.path, 'AWAITING_SOURCE_ADVANCE', 'decision recorded');
  eq(rt.getRuntime().workflowWeek, 3, 'no advance');
});
test('automation disabled → deadline does nothing; manual advance-now still works', async () => {
  const { state, engine } = setup({ enabled: false });
  eq((await engine.tick({ state, notify: false })).state, 'WEEK_ACTIVE', 'no auto action');
  eq((await engine.requestAdvance({ state })).state, 'AWAITING_SOURCE_ADVANCE', 'manual starts procedure');
});
test('manual provider attestation accepted only above expected week; labelled as commissioner-attested', async () => {
  const { state, engine, rt, reg } = setup();
  await engine.tick({ state, notify: false });
  const bad = await engine.requestAdvance({ state, actor: 'c1', attestedSourceWeek: 3 });
  eq(rt.getRuntime().state, 'AWAITING_SOURCE_ADVANCE', 'rejected attestation keeps waiting');
  reg.upsertWeek(4, [{ team1: 'Bears', team2: 'Vikings' }], { source: 'test' });
  const r0 = reg.getRegistry(); r0.currentWeek = 3; reg.saveRegistry(r0); // provider itself still says 3
  await engine.requestAdvance({ state, actor: 'c1', attestedSourceWeek: 4 });
  eq(rt.getRuntime().workflowWeek, 4, 'published');
  assert(/commissioner-attested/.test(rt.getRuntime().sourceVerification), 'attestation labelled');
});
test('provider WITH control: advanceWeek requested exactly once per cycle, publish only after read-back', async () => {
  const { state, engine, rt, reg } = setup();
  const gp = require('../src/providers/gameProvider');
  let calls = 0, providerWeek = 3;
  gp.register(gp.createProvider({ key: 'mock_control', capabilities: { readLeagueState: true, readSchedule: true, advanceWeek: true }, methods: {
    getCurrentWeek: async () => ({ ok: true, week: providerWeek }),
    fetchWeek: async (c, w) => ({ ok: true, week: w, games: [{ team1: 'Bears', team2: 'Rams' }] }),
    advanceWeek: async () => { calls++; return { ok: true }; },
  } }));
  rt.patchRuntime({ providerId: 'mock_control' });
  const r1 = await engine.tick({ state, notify: false });
  eq(r1.state, 'AWAITING_SOURCE_ADVANCE', 'HTTP success is not proof — awaiting read-back');
  await engine.tick({ state, notify: false });
  eq(calls, 1, 'control requested once');
  providerWeek = 4;
  const r3 = await engine.tick({ state, notify: false });
  eq(r3.state, 'WEEK_ACTIVE', 'published after verified read-back');
  eq(rt.getRuntime().workflowWeek, 4, 'week 4');
  eq(calls, 1, 'still once');
});
test('crash during PUBLISHING (restart) → publish completes once, idempotent commit', async () => {
  const { state, engine, rt, reg } = setup();
  reg.upsertWeek(4, [{ team1: 'Bears', team2: 'Packers' }], { source: 'test' });
  rt.saveRuntime({ state: 'PUBLISHING_NEW_WEEK', cycleId: 'c-crash', targetWeek: 4, pendingGames: [{ team1: 'Bears', team2: 'Packers' }], publishCommittedFor: 'c-crash', workflowWeek: 4 });
  engine.recoverOnBoot(state);
  const r = await engine.tick({ state, notify: false });
  eq(r.state, 'WEEK_ACTIVE', 'completed');
  eq(rt.getRuntime().lastCycleId, 'c-crash', 'same cycle finished');
});
test('concurrent ticks → one runs, the other is a no-op (single-flight / lock)', async () => {
  const { state, engine } = setup();
  const [a, b] = await Promise.all([engine.tick({ state, notify: false }), engine.tick({ state, notify: false })]);
  eq([a.ok, b.ok].filter(Boolean).length, 1, 'exactly one tick ran');
  assert(['in-flight', 'locked'].includes((a.ok ? b : a).reason), 'other reports in-flight/locked');
});
test('/advance-week compatibility: manual week recorded, open cycle closed, deadline re-armed', async () => {
  const { state, engine, rt } = setup();
  await engine.tick({ state, notify: false });
  const r = engine.recordManualAdvance({ week: 5, actor: 'c1' });
  eq([r.ok, rt.getRuntime().state, rt.getRuntime().workflowWeek], [true, 'WEEK_ACTIVE', 5], 'manual path');
  assert(rt.getRuntime().nextAdvanceAt > Date.now(), 'future deadline');
});
test('enabling automation never fires a stale past deadline', async () => {
  const { state, engine, rt, policy } = setup({ enabled: false });
  const prev = policy.getPolicy();
  const r = policy.setPolicy({ enabled: true });
  engine.onPolicyChanged(prev, r.policy);
  assert(rt.getRuntime().nextAdvanceAt > Date.now() + 47 * 3600000, 're-armed 48h out');
  eq((await engine.tick({ state, notify: false })).state, 'WEEK_ACTIVE', 'no immediate advance');
});
test('illegal state transitions are rejected', () => {
  const rt = require('../src/league/runtimeService');
  rt.saveRuntime({ state: 'WEEK_ACTIVE' });
  eq(rt.transition('PUBLISHING_NEW_WEEK').ok, false, 'cannot jump to publish');
});
run('advanceEngine.test.js');
