'use strict';
const { test, run, assert, eq } = require('./_harness');
const { parseCsvObjects, parseCsvRows } = require('../src/utils/csv');
const { fetchExternal, validateExternalUrl } = require('../src/utils/httpIntake');
const { matchupKey, toCanonicalGame } = require('../src/league/canonicalModel');

test('CSV: quoted commas, escaped quotes, embedded newline (BUG-011)', () => {
  const rows = parseCsvObjects('week,team1,team2\n1,"Kansas City, MO Chiefs","The ""Birds"""\n2,"Line\nBreak",Jets\n');
  eq(rows.length, 2, 'row count');
  eq(rows[0].team1, 'Kansas City, MO Chiefs', 'quoted comma');
  eq(rows[0].team2, 'The "Birds"', 'escaped quote');
  eq(rows[1].team1, 'Line\nBreak', 'embedded newline');
  eq(parseCsvRows('\uFEFFa,b\r\n1,2\r\n').length, 2, 'BOM + CRLF');
});
test('scheduleRegistry.parseCsv uses the RFC 4180 parser', () => {
  const reg = require('../src/services/scheduleRegistryService');
  eq(reg.parseCsv('week,team1,team2\n3,"A, B",C')[0].team1, 'A, B', 'registry parse');
});
test('httpIntake rejects private destinations, http, credentials, non-allowlisted hosts (BUG-010)', () => {
  for (const u of ['https://127.0.0.1/x', 'https://10.1.2.3/', 'https://169.254.169.254/latest', 'https://localhost/a', 'https://[::1]/', 'https://192.168.0.5/']) eq(validateExternalUrl(u).reason, 'private-destination', u);
  eq(validateExternalUrl('http://example.com/').reason, 'protocol-not-allowed', 'http');
  eq(validateExternalUrl('https://u:p@example.com/').reason, 'credentials-in-url', 'creds');
  eq(validateExternalUrl('https://evil.com/a', { allowedHosts: ['cdn.discordapp.com'] }).reason, 'host-not-allowed', 'allowlist');
  assert(validateExternalUrl('https://cdn.discordapp.com/a.csv', { allowedHosts: ['cdn.discordapp.com'] }).ok, 'allowed cdn');
});
test('httpIntake enforces timeout (fails fast, structured)', async () => {
  const hang = (url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const t0 = Date.now();
  const r = await fetchExternal({ url: 'https://example.com/x', timeoutMs: 150, fetchImpl: hang });
  eq(r.reason, 'timeout', 'timeout reason');
  assert(Date.now() - t0 < 2000, 'failed fast');
});
test('httpIntake enforces size cap, content-type, no redirects', async () => {
  const mk = (status, body, ct, extra = {}) => async () => ({ status, ok: status >= 200 && status < 300, headers: { get: k => (k === 'content-type' ? ct : extra[k] || null) }, arrayBuffer: async () => Buffer.from(body) });
  eq((await fetchExternal({ url: 'https://example.com/', maxBytes: 10, fetchImpl: mk(200, 'x'.repeat(50), 'text/plain') })).reason, 'max-bytes-exceeded', 'size');
  eq((await fetchExternal({ url: 'https://example.com/', expectedContentTypes: ['image/*'], fetchImpl: mk(200, 'x', 'text/html') })).reason, 'unexpected-content-type', 'ctype');
  eq((await fetchExternal({ url: 'https://example.com/', fetchImpl: mk(302, '', 'text/html') })).reason, 'redirect-not-followed', 'redirect');
  eq((await fetchExternal({ url: 'https://example.com/', fetchImpl: mk(503, '', 'text/html') })).reason, 'bad-status', '5xx');
  const ok = await fetchExternal({ url: 'https://example.com/', parse: 'json', fetchImpl: mk(200, '{"a":1}', 'application/json') });
  assert(ok.ok && ok.data.a === 1, 'json ok');
});
test('matchupKey is order-independent and stable', () => {
  const a = matchupKey({ leagueId: 'L', week: 3, teamA: 'Bears', teamB: 'Lions' });
  const b = matchupKey({ leagueId: 'L', week: 3, teamA: 'lions', teamB: 'BEARS' });
  eq(a, b, 'same key');
  assert(!matchupKey({ week: 3, teamA: '', teamB: 'x' }), 'invalid → null');
  const g = toCanonicalGame({ homeTeam: 'Bears', awayTeam: 'Lions', week: 2, homeScore: 21, awayScore: 14 });
  eq(g.status, 'final', 'status inferred');
});
run('utils.test.js');
