'use strict';
const { test, run, assert, eq, resetFiles } = require('./_harness');
process.env.COMPANION_EXPORT_TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz';
process.env.NEONSPORTZ_WEBHOOK_SECRET = 'whsec_test';
const gw = require('../src/providers/madden/companion/exportGateway');
const wh = require('../src/providers/madden/neonsportz/webhook');
const gp = require('../src/providers/gameProvider');
resetFiles(['importRuns.json', 'importArtifacts.json', 'companionSnapshots.json']);
const body = JSON.stringify({ leagueTeamInfoList: [{ teamId: 1, displayName: 'Bears' }, { teamId: 2, displayName: 'Lions' }], gameScheduleInfoList: [{ weekIndex: 2, homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 0, status: 'scheduled' }] });

test('Companion gateway: wrong token 404, oversize 413, bad content-type 415', () => {
  eq(gw.receiveExport({ leagueToken: 'nope', body }).status, 404, 'token');
  eq(gw.receiveExport({ leagueToken: process.env.COMPANION_EXPORT_TOKEN, body: Buffer.alloc(gw.MAX_PAYLOAD_BYTES + 1) }).status, 413, 'size');
  eq(gw.receiveExport({ leagueToken: process.env.COMPANION_EXPORT_TOKEN, body, contentType: 'text/html' }).status, 415, 'ctype');
});
test('Companion gateway: durable receipt, duplicate payload not re-imported, parse → validated snapshot', () => {
  const a = gw.receiveExport({ leagueToken: process.env.COMPANION_EXPORT_TOKEN, body, contentType: 'application/json' });
  eq(a.status, 202, 'accepted fast');
  const b = gw.receiveExport({ leagueToken: process.env.COMPANION_EXPORT_TOKEN, body, contentType: 'application/json' });
  assert(b.duplicate && b.importId === a.importId, 'duplicate detected');
  const p = gw.processImportRun(a.importId, {});
  assert(p.ok && p.snapshot.weeks['3'].length === 1, 'zero-based weekIndex normalized to week 3');
  eq(gp.get('companion_export').getCapabilities().advanceWeek, false, 'export never implies control');
});
test('Companion gateway: malformed JSON fails the import run, never throws', () => {
  const a = gw.receiveExport({ leagueToken: process.env.COMPANION_EXPORT_TOKEN, body: '{not json', contentType: 'application/json' });
  const p = gw.processImportRun(a.importId, {});
  eq([p.ok, p.reason], [false, 'invalid-json'], 'structured failure');
});
test('NeonSportz webhook: auth, event filter, delivery-id dedupe (retries are idempotent)', () => {
  const ev = JSON.stringify({ event: 'league_import_completed', league: 'L1', weekIndex: 3 });
  eq(wh.receiveImportCompleted({ headers: { 'x-neonsportz-delivery': 'd1' }, body: ev }).status, 401, 'unauthorized');
  eq(wh.receiveImportCompleted({ headers: { 'x-webhook-secret': 'whsec_test' }, body: JSON.stringify({ event: 'other' }) }).body.ignored, true, 'other events ignored with 2xx');
  const first = wh.receiveImportCompleted({ headers: { 'x-webhook-secret': 'whsec_test', 'x-neonsportz-delivery': 'd1' }, body: ev });
  eq(first.status, 202, 'accepted');
  for (let i = 0; i < 7; i++) assert(wh.receiveImportCompleted({ headers: { 'x-webhook-secret': 'whsec_test', 'x-neonsportz-delivery': 'd1' }, body: ev }).duplicate, `retry ${i} deduped`);
  eq(wh.receiveImportCompleted({ headers: { 'x-webhook-secret': 'whsec_test' }, body: ev }).status, 400, 'missing delivery id');
});
test('unsupported control is structured, never faked; unconfigured provider reports missing config', async () => {
  const ns = gp.get('neonsportz');
  eq((await ns.advanceWeek({})).reason, 'unsupported-capability', 'no control');
  eq((await gp.get('ea_official_control').advanceWeek({})).reason, 'unsupported-capability', 'EA placeholder');
  const h = await ns.healthCheck();
  assert(!h.ok && h.missing.includes('NEONSPORTZ_SNAPSHOT_URL'), 'missing config reported');
  eq(gp.resolveActive().key, 'local', 'default provider is local (no silent switch)');
});
run('providersIngestion.test.js');
