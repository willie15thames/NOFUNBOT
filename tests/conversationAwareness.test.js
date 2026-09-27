'use strict';
// Zero-dependency targeted tests so this surface can be validated even when the full Discord dependency tree is unavailable.
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✔ ${name}`); }
  catch (e) { fail++; console.log(`  ✘ ${name}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a,b,msg) { if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }

const ambient = require('../src/services/ambientConversationService');
const planner = require('../src/services/naturalActionPlannerService');

function fakeMessage({ id='m1', guildId='g1', channelId='c1', channelName='general', userId='u1', displayName='Paul', content='hello', bot=false } = {}) {
  return {
    id, guild: { id: guildId }, channel: { id: channelId, name: channelName },
    author: { id: userId, username: displayName, bot }, member: { displayName }, content,
    webhookId: null, mentions: { users: { has: () => false } }, client: { user: { id: 'bot1' } },
  };
}

test('ambient awareness records normal channel text without output side effects', () => {
  ambient.clearAll();
  const r = ambient.observe(fakeMessage({ content:'Ravens game was wild tonight' }));
  assert(r.observed, 'message not observed');
  assert(ambient.renderForPrompt({ guildId:'g1', channelId:'c1' }).includes('Paul: Ravens game was wild tonight'), 'context missing');
});

test('ambient awareness is channel-local and excludes operational channels', () => {
  ambient.clearAll(); ambient.observe(fakeMessage({ channelId:'c1', content:'one' })); ambient.observe(fakeMessage({ channelId:'c2', content:'two' }));
  assert(!ambient.renderForPrompt({ guildId:'g1', channelId:'c1' }).includes('two'), 'cross-channel leak');
  eq(ambient.observe(fakeMessage({ channelId:'c3', channelName:'audit-log', content:'private event' })).observed, false, 'audit exclusion');
});

test('ambient awareness ignores bot messages', () => { ambient.clearAll(); eq(ambient.observe(fakeMessage({ bot:true })).observed, false, 'bot ignored'); });

test('ambient prompt can exclude the current @mention message to avoid duplicate context', () => {
  ambient.clearAll();
  ambient.observe(fakeMessage({ id:'old1', content:'Paul was talking about the Ravens earlier' }));
  ambient.observe(fakeMessage({ id:'current1', content:'@myBot put Paul on the Ravens' }));
  const prompt = ambient.renderForPrompt({ guildId:'g1', channelId:'c1' }, { excludeMessageId:'current1' });
  assert(prompt.includes('Paul was talking about the Ravens earlier'), 'older context missing');
  assert(!prompt.includes('@myBot put Paul on the Ravens'), 'current message should be excluded');
});


test('natural planner parses smooth team assignment language', () => {
  eq(planner.parseTeamAssignment('put paul on the ravens'), {intent:'assign_team',memberQuery:'paul',teamQuery:'ravens'}, 'put form');
  eq(planner.parseTeamAssignment('assign @PT to the jets'), {intent:'assign_team',memberQuery:'@PT',teamQuery:'jets'}, 'assign form');
  eq(planner.parseTeamAssignment('give paul the ravens'), {intent:'assign_team',memberQuery:'paul',teamQuery:'ravens'}, 'give form');
});

test('team candidate resolver respects an explicit league hint', () => {
  const state={openTeamRegistry:[
    {leagueId:'L1',leagueName:'Main League',baseTeam:'Ravens',displayTeam:'Ravens',isOpen:true},
    {leagueId:'L2',leagueName:'Sunday League',baseTeam:'Ravens',displayTeam:'Ravens',isOpen:true},
  ]};
  const rows=planner.findTeamCandidates(state,'ravens','Sunday League');
  eq(rows.length,1,'scoped Ravens count');
  eq(rows[0].leagueId,'L2','scoped league');
});


test('team candidate resolver only becomes ambiguous when the requested team is duplicated', () => {
  const state={openTeamRegistry:[
    {leagueId:'L1',leagueName:'Main',baseTeam:'Ravens',displayTeam:'Ravens',isOpen:true},
    {leagueId:'L2',leagueName:'Fantasy',baseTeam:'Jets',displayTeam:'Jets',isOpen:true},
  ]};
  eq(planner.findTeamCandidates(state,'ravens').length,1,'unique Ravens');
  state.openTeamRegistry.push({leagueId:'L2',leagueName:'Fantasy',baseTeam:'Ravens',displayTeam:'Baltimore Ravens',isOpen:true});
  eq(planner.findTeamCandidates(state,'ravens').length,2,'duplicate Ravens');
});


// v204.7 release-closure regressions

test('ambient context redacts obvious secrets before storage', () => {
  ambient.clearAll();
  ambient.observe(fakeMessage({ content:'api_key=supersecret123 token: abcdefghijklmnop Bearer abcdefghijklmnopqrstuvwxyz' }));
  const p=ambient.renderForPrompt({guildId:'g1',channelId:'c1'});
  assert(!p.includes('supersecret123'), 'api key leaked');
  assert(!p.includes('abcdefghijklmnop'), 'token leaked');
  assert(p.includes('[secret redacted]') || p.includes('[redacted]'), 'redaction marker missing');
});

test('old explicit bot mentions are excluded from passive prompt by default', () => {
  ambient.clearAll();
  const m=fakeMessage({ id:'mention1', content:'@myBot remember this exact command' });
  m.mentions.users.has=id=>id==='bot1';
  ambient.observe(m);
  ambient.observe(fakeMessage({ id:'normal1', content:'Ravens are on next' }));
  const p=ambient.renderForPrompt({guildId:'g1',channelId:'c1'});
  assert(!p.includes('remember this exact command'),'old bot mention leaked into passive prompt');
  assert(p.includes('Ravens are on next'),'normal passive context missing');
});

test('message edits replace observed text and deletes remove it', () => {
  ambient.clearAll();
  const m=fakeMessage({id:'edit1',content:'old text'}); ambient.observe(m);
  m.content='new text'; ambient.updateMessage(m);
  let p=ambient.renderForPrompt({guildId:'g1',channelId:'c1'});
  assert(p.includes('new text')&&!p.includes('old text'),'edit not reflected');
  ambient.removeMessage(m);
  p=ambient.renderForPrompt({guildId:'g1',channelId:'c1'});
  assert(!p.includes('new text'),'delete not reflected');
});

console.log(`conversationAwareness.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
