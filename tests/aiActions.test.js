'use strict';
const { test, run, assert, eq, mockGuild, freshState, resetFiles } = require('./_harness');
const V = require('../src/actions/actionValidator');
const X = require('../src/actions/actionExecutor');
const C = require('../src/actions/confirmationService');
const catalog = require('../src/actions/actionCatalog');
const prompt = require('../src/ai/commissionerPrompt');

function ctx(guild, state) { return { guild, channelId: 'c', actorId: '400000000000000001', actorTag: 'comm#1', requestId: 'r1', state, client: null, getCh: () => null }; }

test('unknown action → structured unsupported_action, no side effect', async () => {
  const guild = mockGuild(); const state = freshState();
  const plan = V.validatePlan({ actions: [{ type: 'nuke_server' }, { type: 'set_identity', teamName: 'x' }], reply: 'ok' });
  const out = await X.executePlan(plan, ctx(guild, state));
  eq(out.results.length, 0, 'nothing executed');
  eq(out.rejected.length, 2, 'both rejected');
  assert(out.rejected.every(r => /unsupported action/.test(r.reason)), 'unsupported surfaced');
  assert(/use the matching slash command/.test(X.formatResults(out)), 'commissioner told');
});
test('delete without confirmation is blocked by the application; plan is atomic', async () => {
  const guild = mockGuild(); const state = freshState();
  guild._makeChannel({ name: 'old-news' });
  const plan = V.validatePlan({ actions: [{ type: 'post_message', channelName: 'old-news', text: 'hi' }, { type: 'delete_channel', name: 'old-news' }], reply: 'Done!', requiresConfirmation: false });
  const out = await X.executePlan(plan, ctx(guild, state));
  assert(out.pending && out.pending.token, 'confirmation token issued despite model saying false');
  eq(out.results.length, 0, 'no partial execution');
  eq(guild._sent.length, 0, 'nothing posted');
  assert([...guild.channels.cache.values()].some(c => c.name === 'old-news'), 'channel still exists');
  eq(C.consume(out.pending.token, '400000000000000999').reason, 'wrong-user', 'other user cannot confirm');
  const ok = C.consume(out.pending.token, '400000000000000001', guild.id);
  assert(ok.ok, 'requester can confirm');
  eq(C.consume(out.pending.token, '400000000000000001').reason, 'not-found', 'exactly once');
  const done = await X.runConfirmed(ok.entry, ctx(guild, state));
  assert(done.results.every(r => r.ok), 'executed after confirm');
  assert(![...guild.channels.cache.values()].some(c => c.name === 'old-news'), 'deleted after confirm');
});
test('post_message: mentions never pinged, unknown field (ping) rejected', async () => {
  const guild = mockGuild(); const state = freshState();
  guild._makeChannel({ name: 'announcements' });
  eq(V.validateAction({ type: 'post_message', channelName: 'announcements', text: 'x', ping: '@everyone' }).code, 'invalid_fields', 'ping rejected');
  const out = await X.executePlan(V.validatePlan({ actions: [{ type: 'post_message', channelName: 'announcements', text: '@everyone hello' }] }), ctx(guild, state));
  assert(out.results[0].ok, 'posted');
  eq(guild._sent[0].payload.allowedMentions, { parse: [] }, 'no mention parsing');
});
test('output contract: prose → zero actions; mixed → invalid; thoughts/confidence ignored', () => {
  eq(V.parseModelOutput('Sure thing, Commissioner.').kind, 'prose', 'prose');
  eq(V.parseModelOutput('Here: {"actions":[]}').kind, 'invalid', 'mixed');
  eq(V.parseModelOutput('```json\n{"actions":[],"reply":"x"}\n```').kind, 'json', 'single fence');
  const p = V.validatePlan({ thoughts: 'secret', confidence: 0.1, actions: [{ type: 'ban_list' }], reply: 'r' });
  assert(p.ok && p.valid.length === 1, 'low self-reported confidence does not change execution');
  eq(V.validatePlan({ actions: 'x' }).ok, false, 'bad shape');
});
test('ban_list reply never exposes numeric member IDs', async () => {
  const guild = mockGuild(); const state = freshState();
  const ml = require('../src/services/memberLedgerService');
  ml.init({ getCh: () => null, state, guild, client: null });
  ml.recordBan('500000000000000001', 'spam', '400000000000000001');
  const out = await X.executePlan(V.validatePlan({ actions: [{ type: 'ban_list' }] }), ctx(guild, state));
  assert(out.results[0].ok, 'ok');
  assert(!/\d{17,20}/.test(out.results[0].message), 'no snowflakes in reply');
});
test('prompt is generated from the catalog: every action listed, no phantom/obsolete controls', () => {
  const block = prompt.buildActionCatalogBlock();
  for (const a of catalog.listActions()) assert(block.includes(`- ${a.type}:`), `listed ${a.type}`);
  const full = prompt.buildCommissionerPrompt({ serverName: 'X', commTones: 't', personaBlock: '', rulesText: 'r', historyText: 'h', leagueLine: 'l', awarenessBlock: '', liveState: { teams: '', open: '', games: '', trades: '', channels: '' } });
  assert(full.includes('COMMISSIONER AI SYSTEM INSTRUCTION v2'), 'v2 instruction loaded');
  assert(full.includes('{"actions":[...],"reply":"...","requiresConfirmation":false}'), 'v2 output contract');
  for (const bad of ['set_identity', '"confidence"', '"thoughts"', 'FULL CONTROL', 'confirm first']) assert(!full.includes(bad), `no ${bad}`);
});
test('every catalog action declares the full contract (rule 29/30)', () => {
  for (const a of catalog.listActions()) {
    for (const k of ['type', 'owner', 'permission', 'idempotency', 'description', 'fields', 'execute']) assert(a[k] !== undefined, `${a.type}.${k}`);
    assert(typeof a.destructive === 'boolean', `${a.type}.destructive`);
    assert(a.confirmation !== undefined, `${a.type}.confirmation`);
    if (a.destructive && typeof a.confirmation !== 'function') eq(a.confirmation, 'interactive', `${a.type} destructive → interactive`);
  }
  assert(catalog.requiresConfirmation(catalog.getAction('request_league_advance'), {}), 'advance needs confirm');
  assert(!catalog.requiresConfirmation(catalog.getAction('request_league_advance'), { dryRun: true }), 'dry run does not');
  assert(catalog.requiresConfirmation(catalog.getAction('set_automation_policy'), { enabled: true }), 'enabling needs confirm');
});
test('confirmation map is bounded (TTL + max size)', () => {
  for (let i = 0; i < C.MAX_PENDING + 25; i++) C.create({ guildId: 'g', requesterId: 'u', actions: [] });
  assert(C.size() <= C.MAX_PENDING, 'capped');
});
run('aiActions.test.js');
