'use strict';
const { test, run, assert, eq, freshState, resetFiles } = require('./_harness');
function setup() {
  resetFiles(['gameResults.json', 'standings_proam_1.json', 'gameSessions.json']);
  const state = freshState();
  state.leagueConfig.proAm = { proam_1: { id: 'proam_1', teams: ['Bears', 'Lions', 'Jets'] } };
  const { loadJson } = require('../src/storage/jsonStore');
  return { state, svc: require('../src/league/gameResultService'), standings: () => loadJson('standings_proam_1.json', {}) };
}
test('submit same result twice → one standings update (BUG-006)', async () => {
  const { state, svc, standings } = setup();
  const a = await svc.submitGameResult({ homeTeam: 'Bears', awayTeam: 'Lions', homeScore: 21, awayScore: 14, week: 2, source: 'slash-command' }, { state });
  const b = await svc.submitGameResult({ homeTeam: 'Bears', awayTeam: 'Lions', homeScore: 21, awayScore: 14, week: 2, source: 'slash-command' }, { state });
  assert(a.ok && a.standings.updated, 'applied');
  assert(b.ok && b.deduped, 'deduped');
  eq([standings().Bears.w, standings().Lions.l, standings().Bears.pf], [1, 1, 21], 'counted once');
  eq(state.ocrGameResults.length, 1, 'legacy projection has one row');
});
test('corrected score supersedes: old reversed, new applied (no double count)', async () => {
  const { state, svc, standings } = setup();
  await svc.submitGameResult({ homeTeam: 'Bears', awayTeam: 'Lions', homeScore: 21, awayScore: 14, week: 2 }, { state });
  const c = await svc.submitGameResult({ homeTeam: 'Lions', awayTeam: 'Bears', homeScore: 30, awayScore: 21, week: 2 }, { state });
  assert(c.superseded, 'superseded');
  eq([standings().Bears.w, standings().Bears.l, standings().Lions.w, standings().Lions.l], [0, 1, 1, 0], 'corrected');
  eq(standings().Bears.pf, 21, 'points not doubled');
});
test('retract reverses standings and clears legacy projection', async () => {
  const { state, svc, standings } = setup();
  await svc.submitGameResult({ homeTeam: 'Bears', awayTeam: 'Jets', homeScore: 10, awayScore: 3, week: 1 }, { state });
  const r = await svc.retractGameResult({ week: 1, team1: 'Jets', team2: 'Bears' }, { state });
  eq(r.removed, 1, 'removed');
  eq([standings().Bears.w, standings().Jets.l], [0, 0], 'reversed');
  eq(state.ocrGameResults.length, 0, 'projection cleared');
});
test('invalid input rejected with a reason; unmapped league still recorded without standings', async () => {
  const { state, svc } = setup();
  eq((await svc.submitGameResult({ homeTeam: 'A', awayTeam: 'A', homeScore: 1, awayScore: 0, week: 1 }, { state })).code, 'same-team', 'same team');
  eq((await svc.submitGameResult({ homeTeam: 'A', awayTeam: 'B', homeScore: -1, awayScore: 0, week: 1 }, { state })).code, 'invalid-scores', 'neg');
  const r = await svc.submitGameResult({ homeTeam: 'Cowboys', awayTeam: 'Giants', homeScore: 7, awayScore: 3, week: 1 }, { state });
  assert(r.ok && !r.standings.updated && r.standings.reason === 'no-standings-league', 'recorded, no ledger');
});
run('results.test.js');
