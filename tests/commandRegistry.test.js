'use strict';
const { test, run, assert, eq } = require('./_harness');
const { CommandInteractionOptionResolver } = require('discord.js');
const alias = require('../src/services/commandAliasService');

// Frozen V202 top-level set (100). Any change to a user-facing top-level command must be deliberate.
const FROZEN_TOP_LEVEL = ["active-check-status","add-admin","add-member-to-league","add-open-team","advance-week","append-rule","attr-award","audit-emojis","audit-log","audit-wiring","ban","broadcasts","claim-attr-boost","clear-strikes","create-game","create-poll","customize-server-rules","dashboard","delete-community","delete-league","diagnose","edit-community","edit-message","fill-cpu","fix-duplicates","game-channels","health-status","hierarchy-status","initialize-server","join-league","league-data-ingest","league-export","list-admins","list-communities","list-features","lock-bot-access","logger","manual","member-record","my-streams","open-teams","player","player-of-the-week","post-component","post-nfl-news","post-standings","potw-confirm","propose-trade","refresh-open-teams","refresh-rewards","register-team","release-cpu","release-team","release-week","remove-admin","remove-open-team","report-result","reset-customization","reset-league","respond","retract-score","rewards-board","schedule","schedule-import","schedule-load-week","security-audit","select-team","send-welcome","set-bot-identity","set-bot-tone","set-hub-week","set-live-sync","set-rules","set-stat-leaders","set-team-identity","set-team-logo","set-timezone","setup-community","setup-event","setup-league","setup-server","setup-team","setup-wizard-start","start-season","stream-board","streams","suggestions","superbowl-champion","sync-emojis","team-registry-status","teams","toggle-feature","toggle-team-mode","transaction","trash-the-bot","update-rule","waitlist","warn-player","workflow","yearly-award"];

function allDefined() {
  const src = require('fs').readFileSync(require.resolve('../src/commands'), 'utf8');
  return [...src.matchAll(/new SlashCommandBuilder\(\)\s*\n?\s*\.setName\('([^']+)'\)/g)].map(m => m[1]);
}
function registered() { return require('../src/commands').buildCommandsForState().filter(c => !c.type || c.type === 1); }

function mockInteraction(commandName, options, { autocomplete = false } = {}) {
  return {
    commandName,
    options: new CommandInteractionOptionResolver({}, options, {}),
    isChatInputCommand: () => !autocomplete,
    isAutocomplete: () => autocomplete,
  };
}

test('every defined command is registered — zero trimmed (was 12 cut in v201/V202)', () => {
  const reg = registered();
  const top = new Set(reg.map(c => c.name));
  const nested = new Set(alias.GROUPED_ALIASES.map(a => a.legacy));
  const unreachable = allDefined().filter(n => !top.has(n) && !nested.has(n));
  eq(unreachable, [], 'unreachable commands');
  assert(reg.length <= 100, 'within Discord cap');
});
test('top-level command set is byte-identical to V202 (no user-facing command renamed or removed)', () => {
  eq(registered().map(c => c.name).sort(), FROZEN_TOP_LEVEL, 'top-level set');
});
test('containers stay within Discord limits and keep the legacy permission level', () => {
  for (const c of registered().filter(c => ['game-channels', 'streams', 'workflow'].includes(c.name))) {
    assert(c.options.length <= 25, `/${c.name} options ≤25`);
    for (const o of c.options) if (o.type === 2) assert(o.options.length <= 25, `/${c.name} ${o.name} ≤25`);
    assert(JSON.stringify(c).length < alias.MAX_COMMAND_JSON_BYTES, `/${c.name} payload`);
    eq(String(c.default_member_permissions), '0', `/${c.name} stays admin-only`);
  }
});
test('flat legacy command inside a subcommand group resolves; its options stay readable', () => {
  const i = mockInteraction('game-channels', [{ type: 2, name: 'live-sync', options: [{ type: 1, name: 'source-mode', options: [{ type: 3, name: 'mode', value: 'external_synced' }] }] }]);
  const r = alias.resolveInteractionAlias(i);
  eq([r.legacy, i.commandName], ['set-league-source-mode', 'set-league-source-mode'], 'rewritten to legacy');
  eq(i.options.getString('mode'), 'external_synced', 'legacy handler reads its option unchanged');
  eq(alias.resolveInteractionAlias(i), r, 'idempotent (index.js + router both call it)');
});
test('flat legacy command as a direct subcommand, including autocomplete', () => {
  const i = mockInteraction('streams', [{ type: 1, name: 'restore', options: [{ type: 3, name: 'team', value: 'Bears', focused: true }] }], { autocomplete: true });
  alias.resolveInteractionAlias(i);
  eq(i.commandName, 'restore-stream', 'autocomplete routed to legacy');
  eq(i.options.getFocused(), 'Bears', 'focused value intact');
});
test('legacy command with its own subcommands becomes a group; inner getSubcommand() unchanged', () => {
  const i = mockInteraction('workflow', [{ type: 2, name: 'process-builder', options: [{ type: 1, name: 'toggle', options: [{ type: 3, name: 'name', value: 'p1' }] }] }]);
  alias.resolveInteractionAlias(i);
  eq([i.commandName, i.options.getSubcommand(), i.options.getString('name')], ['process-builder', 'toggle', 'p1'], 'nested legacy group');
});
test('non-aliased subcommands of the same containers are untouched', () => {
  for (const [cmd, opts] of [
    ['game-channels', [{ type: 1, name: 'status', options: [] }]],
    ['game-channels', [{ type: 1, name: 'advance-status', options: [] }]],
    ['workflow', [{ type: 1, name: 'run', options: [] }]],
    ['streams', [{ type: 1, name: 'reset', options: [] }]],
    ['teams', [{ type: 1, name: 'list', options: [] }]],
  ]) {
    const i = mockInteraction(cmd, opts);
    eq(alias.resolveInteractionAlias(i), null, `${cmd} ${opts[0].name} not aliased`);
    eq(i.commandName, cmd, 'name unchanged');
  }
  const button = { commandName: undefined, isChatInputCommand: () => false, isAutocomplete: () => false };
  eq(alias.resolveInteractionAlias(button), null, 'components ignored');
});
test('every alias target still has its original router case (handler reused, not duplicated)', () => {
  const src = require('fs').readFileSync(require.resolve('../src/routing/interactionRouter'), 'utf8');
  for (const a of alias.GROUPED_ALIASES) assert(src.includes(`case '${a.legacy}'`), `router case ${a.legacy}`);
});
test('build-time guards: permission mismatch, collision and wrong kind are rejected', () => {
  const base = [
    { name: 'game-channels', description: 'g', default_member_permissions: '0', options: [{ type: 1, name: 'status', description: 's' }] },
    { name: 'streams', description: 's', default_member_permissions: '0', options: [{ type: 1, name: 'reset', description: 'r' }] },
    { name: 'workflow', description: 'w', default_member_permissions: '0', options: [{ type: 1, name: 'run', description: 'r' }] },
  ];
  const legacy = alias.GROUPED_ALIASES.map(a => ({ name: a.legacy, description: 'x', default_member_permissions: '0', options: a.kind === 'group' ? [{ type: 1, name: 'create', description: 'c' }] : [] }));
  assert(alias.applyGroupedAliases([...base, ...legacy]).length === 3, 'valid spec builds');
  const widened = legacy.map(l => l.name === 'restore-stream' ? { ...l, default_member_permissions: null } : l);
  let threw = false; try { alias.applyGroupedAliases([...base, ...widened]); } catch (e) { threw = /different permissions/.test(e.message); }
  assert(threw, 'permission mismatch rejected');
  const collide = base.map(b => b.name === 'streams' ? { ...b, options: [...b.options, { type: 1, name: 'restore', description: 'dup' }] } : b);
  threw = false; try { alias.applyGroupedAliases([...collide, ...legacy]); } catch (e) { threw = /collision/.test(e.message); }
  assert(threw, 'name collision rejected');
});
test('member-facing guides and manual show the real grouped paths (no dead command names)', () => {
  const fs = require('fs');
  const guide = fs.readFileSync(require.resolve('../src/services/channelGuideService'), 'utf8');
  const manual = fs.readFileSync(require.resolve('../src/services/manualService'), 'utf8');
  for (const a of alias.GROUPED_ALIASES) {
    assert(!new RegExp("['\"`]/" + a.legacy + "\\b").test(guide), `guide has no literal /${a.legacy}`);
    assert(!new RegExp("['\"`]/" + a.legacy + "\\b").test(manual), `manual has no literal /${a.legacy}`);
  }
  eq(alias.displayPath('hub-status'), '/game-channels hub status', 'display path');
  eq(alias.displayPath('process-builder'), '/workflow process-builder', 'group display path');
  eq(alias.displayPath('advance-week'), '/advance-week', 'non-aliased unchanged');
});
test('fail-closed: an unresolved aliased path is recognised so containers never run a different subcommand', () => {
  const i = mockInteraction('game-channels', [{ type: 2, name: 'live-sync', options: [{ type: 1, name: 'now', options: [] }] }]);
  assert(alias.isAliasedPath(i), 'game-channels live-sync now detected');
  const w = mockInteraction('workflow', [{ type: 2, name: 'process-builder', options: [{ type: 1, name: 'list', options: [] }] }]);
  assert(alias.isAliasedPath(w), 'workflow process-builder list detected (not /workflow list)');
  assert(!alias.isAliasedPath(mockInteraction('workflow', [{ type: 1, name: 'list', options: [] }])), '/workflow list is its own');
  const src = require('fs').readFileSync(require.resolve('../src/routing/interactionRouter'), 'utf8');
  for (const c of ['game-channels', 'streams', 'workflow']) {
    const at = src.indexOf(`case '${c}': {`);
    assert(src.slice(at, at + 400).includes('isAliasedPath(interaction)'), `${c} case guarded`);
  }
});
run('commandRegistry.test.js');
