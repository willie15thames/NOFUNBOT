'use strict';
const fs=require('fs'); const path=require('path');
const { test, run, assert, eq, mockGuild } = require('./_harness');

test('G0 UI gate: production source renders no StringSelectMenuBuilder', async()=>{
  const root=path.join(__dirname,'..','src');
  const hits=[];
  for(const file of walk(root)) if(file.endsWith('.js')) { const t=fs.readFileSync(file,'utf8'); if(t.includes('StringSelectMenuBuilder')) hits.push(path.relative(root,file)); }
  eq(hits,[], 'select menu builders must be zero');
});

test('emoji fallback never leaks internal custom emoji key', async()=>{
  const guild=mockGuild(); const {getTeamEmoji,getDevEmoji}=require('../src/utils/teamUtils');
  const team=getTeamEmoji(guild,'Panthers');
  assert(!/:1804panthers:/i.test(team), 'internal Panthers emoji key leaked');
  assert(!/:stardev:/i.test(getDevEmoji(guild,'star')), 'internal dev emoji key leaked');
});

test('workflow registry distinguishes wired and dormant definitions', async()=>{
  const w=require('../src/services/workflowEngineService');
  const rows=w.listWorkflows();
  assert(rows.some(x=>x.name==='post-build'&&x.wireStatus==='wired'),'post-build must be wired');
  assert(rows.some(x=>x.name==='member-onboarding'&&x.wireStatus==='dormant'),'unwired advertised flow must be truthful/dormant');
});

test('AI runtime cancels timed-out request and owns retry policy', async()=>{
  const {runWithAIRetry}=require('../src/services/ai/aiRuntimeOrchestrator');
  let aborted=false;
  try {
    await runWithAIRetry({timeoutMs:20,attempts:1,request:({signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true; reject(Object.assign(new Error('aborted'),{name:'AbortError'}));});})});
    throw new Error('expected timeout');
  } catch(e){ eq(e.code,'AI_TIMEOUT','timeout code'); }
  assert(aborted,'underlying request was not aborted');
  let attempts=0;
  const out=await runWithAIRetry({timeoutMs:100,attempts:2,retryDelayMs:1,request:async()=>{attempts++; if(attempts===1){const e=new Error('overloaded');e.status=529;throw e;} return 'ok';}});
  eq(out,'ok','retry result'); eq(attempts,2,'attempt count');
});

test('R Open House allows high-signal social banter but blocks operational channels', async()=>{
  const settings=require('../src/services/serverSettingsService');
  const policy=require('../src/services/trashTalkEngagementPolicyService');
  const orig=settings.getSettings;
  settings.getSettings=()=>({audienceRating:'r',rOpenHouseEnabled:true,rOpenHouseChannels:[],rOpenHouseOptOutUserIds:[],rOpenHouseUserCooldownMs:5000,rOpenHouseChannelCooldownMs:5000,rOpenHouseBurstLimit:3,rOpenHouseBurstWindowMs:300000});
  policy.resetForTests();
  const base={guild:{id:'g'},author:{id:'u',bot:false},attachments:{size:0},stickers:{size:0},mentions:{users:{size:0,has:()=>false}},reference:null,content:'Ravens cooked yall 😂 trash ass team'};
  assert(policy.shouldEngage({...base,channel:{id:'c1',name:'nfl-chat'}}, {user:{id:'bot'}}, {consume:false}).eligible,'social banter should be eligible');
  assert(!policy.shouldEngage({...base,channel:{id:'c2',name:'warnings-log'}}, {user:{id:'bot'}}, {consume:false}).eligible,'operational channel must be blocked');
  settings.getSettings=orig;
});

test('Pacific business-clock helper returns a future daily wake-up within 24h', async()=>{
  const {msUntilHourInZone}=require('../src/services/hubReleaseService');
  const ms=msUntilHourInZone(18,59,'America/Los_Angeles');
  assert(ms>0 && ms<=24*60*60*1000+60*1000,`unexpected delay ${ms}`);
});


test('high-integrity team commands carry explicit league scope and router re-resolves it', async()=>{
  const commands=fs.readFileSync(path.join(__dirname,'..','src','commands.js'),'utf8');
  const router=fs.readFileSync(path.join(__dirname,'..','src','routing','interactionRouter.js'),'utf8');
  for(const command of ['register-team','set-team-identity','add-open-team','remove-open-team','set-team-logo','release-team','create-game']){
    const idx=commands.indexOf(`.setName('${command}')`);
    assert(idx>=0,`missing /${command}`);
    assert(commands.slice(idx,idx+950).includes("setName('league')"),`/${command} missing explicit league option`);
    const caseIdx=router.indexOf(`case '${command}':`);
    assert(caseIdx>=0,`router missing ${command}`);
    assert(router.slice(caseIdx,caseIdx+1800).includes("getString('league')"),`${command} does not re-resolve league at execution`);
  }
});

test('natural team assignment converges on application use case instead of direct claim mutation', async()=>{
  const planner=fs.readFileSync(path.join(__dirname,'..','src','services','naturalActionPlannerService.js'),'utf8');
  assert(!/\bclaimTeam\s*\(/.test(planner),'natural planner still calls claimTeam directly');
  assert(planner.includes('assignUseCase.assignTeam'),'natural planner missing canonical application use case');
});

test('Anthropic service has no competing Promise.race timeout owner', async()=>{
  const service=fs.readFileSync(path.join(__dirname,'..','src','services','ai','anthropicService.js'),'utf8');
  assert(!/Promise\.race\s*\(/.test(service),'Anthropic service still owns a duplicate Promise.race timeout');
  assert(service.includes('aiRuntimeOrchestrator'),'Anthropic service must delegate timeout/retry ownership');
});

function walk(dir){ const out=[]; for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name); if(e.isDirectory())out.push(...walk(p)); else out.push(p);} return out; }
run('contractV8.regression.test.js');
