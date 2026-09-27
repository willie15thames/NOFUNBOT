'use strict';
const { test, run, assert, eq, mockGuild, freshState, resetFiles, ChannelType } = require('./_harness');

test('command registry: ≤100 registered, identical top-level set, /game-channels has advance/sync subcommands (BUG-012 guard)', () => {
  const { buildCommandsForState } = require('../src/commands');
  const slash = buildCommandsForState().filter(c => !c.type || c.type === 1);
  assert(slash.length <= 100, 'within Discord cap');
  const gc = slash.find(c => c.name === 'game-channels');
  const subs = gc.options.map(o => o.name);
  for (const s of ['configure', 'create', 'clear', 'rebuild', 'notify', 'automation', 'status', 'update', 'delete', 'advance-status', 'advance-settings', 'advance-now', 'advance-hold', 'advance-resume', 'sync-status', 'sync-now']) assert(subs.includes(s), `sub ${s}`);
  assert(subs.length <= 25, 'subcommand cap');
  for (const must of ['advance-week', 'report-result', 'retract-score', 'create-game', 'respond', 'schedule-import', 'schedule-load-week']) assert(slash.some(c => c.name === must), `still registered: ${must}`);
});
test('league category permissions: only adminOnly categories deny @everyone (BUG-005)', () => {
  const src = require('fs').readFileSync(require.resolve('../src/services/leagueSetupService'), 'utf8');
  assert(!/adminOnly\s*\|\|\s*true/.test(src), 'no forced || true');
  assert(!/buildStaffOverwrites\(guild, commRoleId, true\)/.test(src), 'no literal true in category builders');
  assert(src.includes('adminOnly: !!cat.adminOnly'), 'shared plan preserves category adminOnly');
  assert(src.includes('buildStaffOverwrites(guild, commRoleId, cat.adminOnly)'), 'shared builder uses category policy');
});
test('schedule timer: double start leaves exactly one pending timer; stale generation is a no-op (BUG-002)', () => {
  resetFiles(['weeklyAutomation.json']);
  require('../src/services/weeklyAutomationService').saveWeeklySettings({ mode: 'automatic' });
  const hub = require('../src/services/hubReleaseService');
  const state = freshState(); const guild = mockGuild();
  const a = hub.startScheduleTimer(guild, state, () => null, () => '');
  const b = hub.startScheduleTimer(guild, state, () => null, () => '');
  assert(b.generation > a.generation, 'generation advanced');
  const st = hub.getScheduleTimerStatus(guild);
  eq([st.phase, st.generation], ['pending-first-fire', b.generation], 'one pending timer, current generation');
  require('../src/services/weeklyAutomationService').saveWeeklySettings({ mode: 'manual' });
  hub.startScheduleTimer(guild, state, () => null, () => '');
  eq(hub.getScheduleTimerStatus(guild).active, false, 'manual mode cancels the pending first fire too');
});
test('state hydration after store warm-up fills schedule, leagueConfig, hub, rewards without clobbering (BUG-007)', () => {
  const { saveJson } = require('../src/storage/jsonStore');
  const state = require('../src/state');
  state.scheduleState.week = null; state.scheduleState.matchups = [];
  state.leagueConfig.leagueTypeId = null;
  saveJson('scheduleRegistry.json', { currentWeek: 9, weeks: { 9: [{ team1: 'Bears', team2: 'Lions' }] } });
  saveJson('leagueConfig.json', { leagueTypeId: 'madden_franchise', leagueName: 'NFL S3', rulesText: '' });
  saveJson('hubWeeklyData.json', { week: 9, scores: [{ team1: 'a' }], statLines: [], released: false });
  saveJson('rewardHistory.json', { potwHistory: [{ week: 8 }], superbowlHistory: [], yearlyAwardHistory: [], streamMilestones: [] });
  const h = state.hydrateRuntimeState();
  eq([state.scheduleState.week, state.scheduleState.matchups.length], [9, 1], 'schedule');
  eq(state.leagueConfig.leagueName, 'NFL S3', 'leagueConfig');
  assert(state.leagueConfig.rulesText && state.leagueConfig.rulesText.length > 10, 'empty persisted rules did not wipe defaults');
  eq(state.hubWeeklyData.week, 9, 'hub');
  eq(state.potwHistory.length, 1, 'rewards');
  state.scheduleState.week = 10;
  state.hydrateRuntimeState();
  eq(state.scheduleState.week, 10, 'runtime value never overwritten');
  assert(h.scheduleState, 'summary reported');
});
test('persist loop serialises hub data without timer handles (no circular JSON)', () => {
  const state = require('../src/state');
  state.hubWeeklyData.releaseTimerId = setTimeout(() => {}, 100000); state.hubWeeklyData.releaseTimerId.unref();
  state.persistPendingState();
  const { loadJson } = require('../src/storage/jsonStore');
  assert(!('releaseTimerId' in (loadJson('hubWeeklyData.json', {}) || {})), 'timer stripped');
  clearTimeout(state.hubWeeklyData.releaseTimerId);
});
test('dedup sweep: same-name categories not built this run are report-only; scoped categories never touched (BUG-009)', async () => {
  const base = require('../src/services/baseInitService');
  const guild = mockGuild();
  const s1 = guild._makeChannel({ name: '📊 Stats', type: ChannelType.GuildCategory });
  const s2 = guild._makeChannel({ name: 'Stats', type: ChannelType.GuildCategory });
  guild._makeChannel({ name: 'leaders', parent: s1 }); guild._makeChannel({ name: 'leaders', parent: s2 });
  const w1 = guild._makeChannel({ name: '🎮 ─── WEEKLY GAMES — MADDEN ───', type: ChannelType.GuildCategory });
  const w2 = guild._makeChannel({ name: '🎮 ─── WEEKLY GAMES — MADDEN ───', type: ChannelType.GuildCategory });
  await base._internals._silentDedupSweep(guild);
  eq(guild._deleted.length, 0, 'nothing deleted');
  assert(guild.channels.cache.has(s2.id) && guild.channels.cache.has(w2.id), 'both groups intact');
  assert(base._internals._isProtectedScopeCategory(guild, w1), 'weekly games is scoped');
  const gen = guild._makeChannel({ name: 'general-chat', parent: w1 });
  const community = await base.findOrCreateCategory(guild, '💬 Community');
  const got = await base.findOrCreateText(guild, community, 'general-chat');
  assert(got.id !== gen.id && gen.parentId === w1.id, 'channel in a scoped category was not adopted/moved');
});
test('no raw external fetch remains outside the intake layer (BUG-010)', () => {
  const { execSync } = require('child_process');
  const out = execSync("grep -rn 'await fetch(' src --include=*.js || true", { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  eq(out.trim(), '', 'no direct fetch');
});
test('only one active-check scheduler owner (BUG-008)', () => {
  const fs = require('fs'); const path = require('path');
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert(!/processDueActiveChecks\(_g, state\)/.test(idx), 'index.js interval removed');
  const lf = require('../src/services/leagueFeatureService');
  assert(typeof lf.processDueActiveChecks === 'function', 'processor exported');
});
test('provider HTTP receiver is off by default (zero behavior change)', () => {
  delete process.env.ENABLE_PROVIDER_HTTP;
  eq(require('../src/http/providerHttpServer').start().started, false, 'disabled');
});
run('platform.test.js');
