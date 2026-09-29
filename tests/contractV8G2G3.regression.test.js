'use strict';
const fs=require('fs');const path=require('path');
const tests=[];function test(name,fn){tests.push({name,fn});}
function assert(v,m='assertion failed'){if(!v)throw Error(m);}
function eq(a,b,m='values differ'){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);}
async function run(){let failed=0;for(const t of tests){try{await t.fn();console.log(`✅ ${t.name}`);}catch(e){failed++;console.error(`❌ ${t.name}: ${e.stack||e}`);}}if(failed)process.exitCode=1;else console.log(`\n${tests.length} passed, 0 failed`);}

test('G2 policy caps are commissioner-configurable and enforced transactionally', async()=>{
 const {normalizePolicy,validateAttributeSpend}=require('../src/domain/progression/policy');
 const p=normalizePolicy({attribute:{allowedGroups:['SKILL','MENTAL'],memberSeasonCap:10,teamSeasonCap:20,playerSeasonCap:6,perClaimCap:3,perAttributeCap:4}});
 assert(validateAttributeSpend({policy:p,attribute:'awareness',group:'MENTAL',points:3,totals:{memberSpent:4,teamSpent:5,playerSpent:2,attributeSpent:1}}).ok);
 eq(validateAttributeSpend({policy:p,attribute:'awareness',group:'MENTAL',points:4,totals:{}}).code,'CLAIM_CAP_EXCEEDED');
 eq(validateAttributeSpend({policy:p,attribute:'speed',group:'PHYSICAL',points:1,totals:{}}).code,'ATTRIBUTE_GROUP_BLOCKED');
});

test('G2 initial team grants are idempotent and member rewards require provenance', async()=>{
 const {InMemoryProgressionRepository}=require('../src/domain/progression/inMemoryRepository');
 const {ProgressionService}=require('../src/domain/progression/service');
 const repo=new InMemoryProgressionRepository();
 repo.addPolicy({id:'policy-1',guildId:'guild-1',leagueId:'league-1',seasonId:'season-1',version:1,policy:{attribute:{allowedGroups:['SKILL'],perClaimCap:5}}});
 const svc=new ProgressionService(repo);
 const a=svc.issueInitialGrant({guildId:'guild-1',leagueId:'league-1',seasonId:'season-1',teamId:'team-1',rewardType:'ATTRIBUTE_POINTS',points:5,policyVersionId:'policy-1'});
 const b=svc.issueInitialGrant({guildId:'guild-1',leagueId:'league-1',seasonId:'season-1',teamId:'team-1',rewardType:'ATTRIBUTE_POINTS',points:5,policyVersionId:'policy-1'});
 eq(a.id,b.id,'initial team grant reminted');
 let threw=false;try{svc.issueMemberReward({guildId:'guild-1',leagueId:'league-1',seasonId:'season-1',membershipId:'member-1',rewardType:'ATTRIBUTE',policyVersionId:'policy-1'});}catch(e){threw=e.code==='INVALID_PROVENANCE';}
 assert(threw,'member reward without provenance was accepted');
});

test('G2 claims consume a real entitlement once and retain provider provenance', async()=>{
 const {InMemoryProgressionRepository}=require('../src/domain/progression/inMemoryRepository');
 const {ProgressionService}=require('../src/domain/progression/service');
 const repo=new InMemoryProgressionRepository();
 repo.addPolicy({id:'policy-1',guildId:'guild-1',leagueId:'league-1',seasonId:'season-1',version:1,policy:{attribute:{allowedGroups:['SKILL'],perClaimCap:2,memberSeasonCap:4}}});
 const svc=new ProgressionService(repo,{verifyPlayer:async()=>({ok:true,applied:true,gameId:'madden',gameVersion:'26',teamId:'team-1',playerId:'player-1',position:'WR',before:70,after:72,provenance:{provider:'test',snapshotId:'snap-1',verifiedAt:123}})});
 const g=svc.issueMemberReward({guildId:'guild-1',leagueId:'league-1',seasonId:'season-1',membershipId:'member-1',rewardType:'ATTRIBUTE_POINTS',points:2,quantity:1,sourceType:'POTW',sourceId:'week-1',policyVersionId:'policy-1'});
 const input={guildId:'guild-1',leagueId:'league-1',seasonId:'season-1',membershipId:'member-1',teamId:'team-1',playerId:'player-1',grantId:g.id,attributeKey:'catching',attributeGroup:'SKILL',points:2,idempotencyKey:'interaction-1',actorId:'user-1'};
 const first=await svc.claimAttribute(input);assert(first.ok,'first claim failed');eq(first.mutation.providerVerification.snapshotId,'snap-1');
 const retry=await svc.claimAttribute(input);assert(retry.ok&&retry.idempotent,'same interaction was not idempotent');
 const second=await svc.claimAttribute({...input,idempotencyKey:'interaction-2'});eq(second.code,'ENTITLEMENT_UNAVAILABLE');
 eq(repo.mutations.length,1,'double mutation occurred');
});

test('G2 tenure departure forfeits member rewards but never initial team grants', async()=>{
 const {InMemoryProgressionRepository}=require('../src/domain/progression/inMemoryRepository');
 const {ProgressionService}=require('../src/domain/progression/service');
 const repo=new InMemoryProgressionRepository();
 repo.addPolicy({id:'policy-1',seasonId:'season-1',version:1,policy:{forfeiture:{onLeave:true},attribute:{allowedGroups:['SKILL']}}});
 const svc=new ProgressionService(repo);
 repo.startTenure({membershipId:'member-1',userId:'user-1',guildId:'guild-1',leagueId:'league-1',seasonId:'season-1'});
 const team=svc.issueInitialGrant({guildId:'guild-1',leagueId:'league-1',seasonId:'season-1',teamId:'team-1',rewardType:'DEV',policyVersionId:'policy-1'});
 const member=svc.issueMemberReward({guildId:'guild-1',leagueId:'league-1',seasonId:'season-1',membershipId:'member-1',rewardType:'ATTRIBUTE',sourceType:'STREAM',sourceId:'evt-1',policyVersionId:'policy-1'});
 const out=svc.departMember({seasonId:'season-1',membershipId:'member-1',departureType:'LEAVE',policyVersionId:'policy-1'});
 eq(out.forfeited,1);eq(repo.grants.find(x=>x.id===member.id).status,'FORFEITED');eq(repo.grants.find(x=>x.id===team.id).status,'AVAILABLE');
});

test('G2 claims fail closed without provider evidence and cannot exceed earned points', async()=>{
 const {InMemoryProgressionRepository}=require('../src/domain/progression/inMemoryRepository');
 const {ProgressionService}=require('../src/domain/progression/service');
 const repo=new InMemoryProgressionRepository();
 repo.addPolicy({id:'p',policy:{attribute:{allowedGroups:['SKILL']}}});
 const g=new ProgressionService(repo).issueMemberReward({guildId:'g',leagueId:'l',seasonId:'s',membershipId:'m',rewardType:'ATTRIBUTE_POINTS',points:3,sourceType:'POTW',sourceId:'week-1',policyVersionId:'p'});
 const input={guildId:'g',leagueId:'l',seasonId:'s',membershipId:'m',teamId:'t',playerId:'player',grantId:g.id,attributeKey:'catching',attributeGroup:'SKILL',points:2,idempotencyKey:'one',actorId:'u',before:1,after:99};
 eq((await new ProgressionService(repo).claimAttribute(input)).code,'PROVIDER_VERIFICATION_UNAVAILABLE');
 const svc=new ProgressionService(repo,{verifyPlayer:async()=>({ok:true,applied:true,gameId:'madden',gameVersion:'26',teamId:'t',playerId:'player',position:'WR',before:70,after:72,provenance:{provider:'test',snapshotId:'snap',verifiedAt:123}})});
 const first=await svc.claimAttribute(input);assert(first.ok);eq(first.mutation.before,70);eq(first.mutation.after,72);
 eq(repo.grants[0].points,1);
 eq((await svc.claimAttribute({...input,idempotencyKey:'two',points:2})).code,'INSUFFICIENT_ENTITLEMENT');
 eq(repo.mutations.length,1);
});

test('G2 season lifecycle and postseason bracket are explicit', async()=>{
 const {transition}=require('../src/domain/season/stateMachine');
 assert(transition('PRESEASON_SETUP','PRESEASON_ACTIVE').ok);
 assert(!transition('PRESEASON_SETUP','POSTSEASON_ACTIVE').ok);
 const {buildSingleElimination,advanceMatch}=require('../src/domain/postseason/bracket');
 const b=buildSingleElimination([{teamId:'t1',seed:1},{teamId:'t2',seed:2},{teamId:'t3',seed:3},{teamId:'t4',seed:4}],{seedCount:4});
 eq(b.matches.length,2);assert(advanceMatch(b.matches[0],b.matches[0].homeTeamId).ok);
 const six=buildSingleElimination(Array.from({length:6},(_,i)=>({teamId:`t${i+1}`,seed:i+1})),{seedCount:6});
 eq(six.byes,['t1','t2']);eq(six.matches.length,2);
 let invalid=false;try{buildSingleElimination(Array.from({length:4},(_,i)=>({teamId:`t${i}`,seed:i+1})),{byes:1});}catch(e){invalid=e.code==='INVALID_BYES';}assert(invalid);
});

test('G2 tier assignments are reproducible, unique, and manual values are checked', async()=>{
 const {assignTiers}=require('../src/domain/progression/tiers');
 const ids=['team-1','team-2','team-3','team-4'];
 eq(assignTiers(ids,{mode:'RANDOM',seed:'season-seed'}),assignTiers([...ids].reverse(),{mode:'RANDOM',seed:'season-seed'}));
 eq(new Set(assignTiers(ids,{mode:'BASIC'}).map(x=>x.tier)).size,4);
 let rejected=false;try{assignTiers(ids,{mode:'MANUAL',manual:{'team-1':'T1'}});}catch(e){rejected=e.code==='INVALID_MANUAL_TIERS';}assert(rejected);
});

test('G2 policy versions lock a real season before numbering', async()=>{
 const {PostgresSeasonRepository}=require('../src/domain/season/postgresRepository');
 const calls=[];const client={query:async(sql,args)=>{calls.push(sql);if(sql.startsWith('SELECT id,state FROM'))return{rowCount:1,rows:[{id:'season',state:'PRESEASON_SETUP'}]};if(sql.startsWith('SELECT COALESCE'))return{rows:[{v:1}]};if(sql.startsWith('INSERT INTO'))return{rows:[{id:'p2',version:2}]};return{rows:[]};},release(){}};
 const repo=new PostgresSeasonRepository({connect:async()=>client});
 const row=await repo.createPolicyVersion({id:'p2',guildId:'g',leagueId:'l',seasonId:'season',policy:{},effectiveAt:new Date(),createdBy:'u'});
 eq(row.version,2);assert(calls.findIndex(x=>x.includes('FOR UPDATE'))<calls.findIndex(x=>x.includes('MAX(version)')));
 assert(calls.includes('COMMIT'));
});

test('G2 attribute choices come from a game/version catalog', async()=>{
 const {listAttributes,resolveAttribute}=require('../src/domain/progression/attributeCatalog');
 const attrs=listAttributes({gameId:'madden',gameVersion:'26',position:'QB',policy:{attribute:{allowedGroups:['SKILL','MENTAL']}}});
 assert(attrs.length>0);assert(attrs.every(x=>['SKILL','MENTAL'].includes(x.group)));eq(resolveAttribute('SAC',{gameId:'madden',gameVersion:'26'}).key,'throw_accuracy_short');
});

test('G2 provider roster evidence uses canonical team mapping and applied receipt', async()=>{
 const {readPlayer}=require('../src/domain/progression/providerRosterEvidence');
 const queries=[];const fake={query:async(sql,args)=>{queries.push(sql);return sql.includes('provider_team_mappings')?
   {rows:[{providerKey:'companion_export',externalTeamId:'42'}]}:sql.includes('provider_connections')?{rows:[{id:'connection'}]}:
   {rows:[{id:'receipt-2',providerKey:'companion_export',receivedAt:'2026-09-29T02:00:00Z',artifactBody:JSON.stringify({rosterInfoList:[{rosterId:'99',teamId:'42',position:'WR',catching:73}]})}]};}};
 const result=await readPlayer(fake,{guildId:'g',leagueId:'l',teamId:'t',playerId:'99',attributeKey:'catching',afterReceivedAt:'2026-09-29T01:00:00Z'});
 assert(result.ok);eq(result.rating,73);eq(result.provenance.snapshotId,'receipt-2');
 assert(queries[1].includes("status='applied'"));
 const wrong=await readPlayer({query:async(sql)=>sql.includes('provider_team_mappings')?{rows:[{providerKey:'companion_export',externalTeamId:'7'}]}:fake.query(sql)},
  {guildId:'g',leagueId:'l',teamId:'t',playerId:'99',attributeKey:'catching'});
 eq(wrong.code,'PLAYER_NOT_ON_MAPPED_TEAM');
});

test('G2 pending claim reserves points without debiting grant or wallet', async()=>{
 const {PostgresProgressionRepository}=require('../src/domain/progression/postgresRepository');
 const sql=[];const client={release(){},query:async(q,args)=>{sql.push(q);
  if(q.includes('FROM "seasons"'))return{rows:[{id:'s'}]};
  if(q.includes('FROM "membership_tenures"'))return{rows:[{id:'tenure'}]};
  if(q.includes('FROM "progression_grants"'))return{rows:[{id:'grant',status:'AVAILABLE',guildId:'g',leagueId:'l',seasonId:'s',ownerType:'MEMBER',ownerId:'m',rewardType:'ATTRIBUTE_POINTS',points:2,quantity:1,policyVersionId:'p'}]};
  if(q.includes('FROM "progression_policy_versions"'))return{rows:[{id:'p',guildId:'g',leagueId:'l',seasonId:'s',policy:{attribute:{allowedGroups:['SKILL']}}}]};
  if(q.includes('COALESCE'))return{rows:[{n:0}]};
  if(q.includes('INSERT INTO "progression_claims"'))return{rowCount:1,rows:[{id:'claim',status:'PENDING'}]};
  return{rows:[]};}};
 const repo=new PostgresProgressionRepository({connect:async()=>client});
 const input={guildId:'g',leagueId:'l',seasonId:'s',membershipId:'m',teamId:'t',actorId:'u',grantId:'grant',playerId:'p1',attributeKey:'catching',points:2,idempotencyKey:'ix'};
 const result=await repo.requestAttribute(input,async()=>({ok:true,attributeGroup:'SKILL',rating:70,provenance:{provider:'test',snapshotId:'snap',verifiedAt:'2026-09-29T00:00:00Z'}}));
 assert(result.ok);eq(result.claim.status,'PENDING');assert(sql.includes('COMMIT'));
 assert(!sql.some(q=>q.includes('UPDATE "progression_grants"')||q.includes('UPDATE "progression_wallets"')));
});

test('G2 postseason result requires mapped teams and a final provider receipt', async()=>{
 const {readGameResult}=require('../src/domain/postseason/providerGameEvidence');
 const fake={query:async(sql)=>sql.includes('provider_team_mappings')?{rows:[
  {teamId:'t1',externalTeamId:'1',providerKey:'companion_export'},
  {teamId:'t2',externalTeamId:'2',providerKey:'companion_export'}]}:sql.includes('provider_connections')?{rows:[{id:'connection'}]}:
  {rows:[{id:'receipt',receivedAt:'2026-09-29T04:00:00Z',artifactBody:JSON.stringify({gameScheduleInfoList:[{scheduleId:'game',homeTeamId:1,awayTeamId:2,homeScore:21,awayScore:17,status:'final'}]})}]}};
 const r=await readGameResult(fake,{guildId:'g',leagueId:'l',homeTeamId:'t1',awayTeamId:'t2',providerGameId:'game'});
 assert(r.ok);eq(r.winnerTeamId,'t1');eq(r.evidence.snapshotId,'receipt');
});

test('G2 special policy requires explicit trait transitions and age target', async()=>{
 const {normalizePolicy}=require('../src/domain/progression/policy');
 const p=normalizePolicy({special:{devTraitTransitions:[{from:'star',to:'superstar'}],ageResetTarget:22}});
 eq(p.special.ageResetTarget,22);eq(p.special.devTraitTransitions[0].to,'superstar');
 let bad=false;try{normalizePolicy({special:{devTraitTransitions:[{from:'star',to:'star'}]}});}catch(e){bad=e.code==='INVALID_POLICY';}assert(bad);
 const {readSpecial}=require('../src/domain/progression/providerRosterEvidence');
 const fake={query:async(sql)=>sql.includes('provider_team_mappings')?{rows:[{providerKey:'companion_export',externalTeamId:'42'}]}:sql.includes('provider_connections')?{rows:[{id:'connection'}]}:
  {rows:[{id:'roster',receivedAt:'2026-09-29T03:00:00Z',artifactBody:JSON.stringify({rosterInfoList:[{rosterId:'p',teamId:'42',devTrait:'star',age:29}]})}]}};
 eq((await readSpecial(fake,{guildId:'g',leagueId:'l',teamId:'t',playerId:'p',rewardType:'DEV_TRAIT'})).value,'star');
 eq((await readSpecial(fake,{guildId:'g',leagueId:'l',teamId:'t',playerId:'p',rewardType:'AGE_RESET'})).value,29);
});

test('G2 tenure reconciliation closes old tenure and forfeits only member entitlements', async()=>{
 const {reconcileTenures}=require('../src/domain/progression/tenureReconciliation');
 const calls=[];const client={release(){},query:async(sql)=>{calls.push(sql);
  if(sql.includes('FROM "seasons"'))return{rows:[{id:'s',policyVersionId:'p'}]};
  if(sql.includes('FROM "progression_policy_versions"'))return{rows:[{policy:{forfeiture:{onLeave:true}}}]};
  if(sql.includes('FROM "team_members"'))return{rows:[{userId:'u',teamId:'new-team'}]};
  if(sql.includes('FROM "membership_tenures"'))return{rows:[{id:'old',membershipId:'old-member',userId:'u',teamId:'old-team'}]};
  return{rows:[]};}};
 const out=await reconcileTenures({connect:async()=>client},{guildId:'g',leagueId:'l',seasonId:'s'});
 eq(out.joined,1);eq(out.left,0);eq(out.transferred,1);assert(calls.includes('COMMIT'));
 assert(!calls.some(x=>x.includes('UPDATE \"progression_grants\"')),'team transfer must not forfeit member rewards');
});

test('G3 operation fence is guild scoped and rejects placeholder identity', async()=>{
 const {withFence}=require('../src/infrastructure/operationFence');
 let n=0;const a=await withFence({guildId:'guild-1',key:'advance:league-1'},async()=>++n);assert(a.acquired);eq(n,1);
 let bad=false;try{await withFence({guildId:'global',key:'x'},async()=>1);}catch(e){bad=e.code==='INVALID_SCOPE';}assert(bad);
});

test('G3 backpressure gate rejects overload and exports metrics', async()=>{
 const {createBackpressureGate}=require('../src/infrastructure/backpressure');
 const gate=createBackpressureGate({maxInFlight:1,maxQueued:0});
 let release;const hold=new Promise(r=>release=r);const a=gate.run(()=>hold);
 let rejected=false;try{await gate.run(async()=>2);}catch(e){rejected=e.code==='BACKPRESSURE';}
 assert(rejected);release();await a;eq(gate.metrics().rejected,1);
});

test('G3 compatibility paths have owner replacement telemetry condition and deadline', async()=>{
 const reg=require('../src/infrastructure/compatibilityRegistry');const rows=reg.all();assert(rows.length>=3);
 for(const r of rows)for(const k of ['compatId','owner','replacement','removalCondition','deadlineRelease'])assert(r[k],`${r.compatId} missing ${k}`);
});

test('G2/G3 schema contains canonical normalized authority tables and no JSON progression authority', async()=>{
 const schema=fs.readFileSync(path.join(__dirname,'..','prisma','schema.prisma'),'utf8');
 for(const model of ['Season','ProgressionPolicyVersion','TierAssignment','ProgressionGrant','ProgressionWallet','ProgressionClaim','PlayerMutation','EntitlementConsumption','MembershipTenure','PostseasonBracket','PostseasonMatch','OperationFence','CompatibilityPath']) assert(schema.includes(`model ${model}`),`missing ${model}`);
 const domain=fs.readFileSync(path.join(__dirname,'..','src','domain','progression','service.js'),'utf8');
 assert(!domain.includes('jsonStore'),'progression domain may not use jsonStore');
 assert(!domain.includes('pendingAttrBoosts'),'new progression domain depends on legacy pending boosts');
});


test('G3 concurrent claims cannot double-spend one entitlement', async()=>{
 const {InMemoryProgressionRepository}=require('../src/domain/progression/inMemoryRepository');
 const {ProgressionService}=require('../src/domain/progression/service');
 const repo=new InMemoryProgressionRepository();
 repo.addPolicy({id:'policy-1',policy:{attribute:{allowedGroups:['SKILL'],perClaimCap:2}}});
 const svc=new ProgressionService(repo,{verifyPlayer:async()=>{await new Promise(r=>setImmediate(r));return{ok:true,applied:true,gameId:'madden',gameVersion:'26',teamId:'team-1',playerId:'player-1',position:'WR',before:70,after:71,provenance:{provider:'test',snapshotId:'snap-1',verifiedAt:123}};}});
 const g=svc.issueMemberReward({guildId:'guild-1',leagueId:'league-1',seasonId:'season-1',membershipId:'member-1',rewardType:'ATTRIBUTE_POINTS',points:1,quantity:1,sourceType:'EVENT',sourceId:'one',policyVersionId:'policy-1'});
 const base={guildId:'guild-1',leagueId:'league-1',seasonId:'season-1',membershipId:'member-1',teamId:'team-1',playerId:'player-1',grantId:g.id,attributeKey:'catching',attributeGroup:'SKILL',points:1,actorId:'user-1'};
 const [a,b]=await Promise.all([svc.claimAttribute({...base,idempotencyKey:'a'}),svc.claimAttribute({...base,idempotencyKey:'b'})]);
 eq([a,b].filter(x=>x.ok).length,1,'two claims succeeded');eq(repo.mutations.length,1,'two mutations persisted');eq(repo.claims.length,1,'losing claim persisted');
});


test('G3 commissioner authorization is independent from interaction router', async()=>{
 const auth=fs.readFileSync(path.join(__dirname,'..','src','services','commissionerAuthorizationService.js'),'utf8');
 assert(auth.includes('function isCommissionerAiAuthorized'),'authorization service missing predicate');
 const handler=fs.readFileSync(path.join(__dirname,'..','src','handlers','commissionerHandler.js'),'utf8');
 const router=fs.readFileSync(path.join(__dirname,'..','src','routing','interactionRouter.js'),'utf8');
 assert(!handler.includes("require('../routing/interactionRouter')"),'handler imports router');
 assert(!router.includes("require('../handlers/commissionerHandler')"),'router imports handler');
});

test('G3 setup wizard bridge is a narrow fail-closed port', async()=>{
 const bridge=require('../src/services/setupWizardBridgeService');
 bridge.resetForTests();
 let unavailable=false;try{await bridge.post({id:'g'});}catch(e){unavailable=e.code==='SETUP_WIZARD_PORT_UNAVAILABLE';}
 assert(unavailable,'bridge did not fail closed before registration');
 let seen=null;bridge.register({postSetupWizardMessage:async(g,n,o)=>{seen={g,n,o};return 'ok';}});
 eq(await bridge.post({id:'g'},'note',{stage:'mode'}),'ok');eq(seen.n,'note');
 bridge.resetForTests();
});

test('G3 patch notes no longer cycles through base initialization', async()=>{
 const patch=fs.readFileSync(path.join(__dirname,'..','src','services','patchNotesService.js'),'utf8');
 assert(!patch.includes("require('./baseInitService')"),'patch notes imports baseInitService');
});


test('G3 InteractionExecutionContext owns acknowledgement and prevents double initial reply', async()=>{
 const {for:ctxFor}=require('../src/services/interactionExecutionContext');
 const calls=[];
 const interaction={replied:false,deferred:false,
  async reply(p){calls.push(['reply',p]);this.replied=true;return 'r';},
  async followUp(p){calls.push(['followUp',p]);return 'f';},
  async editReply(p){calls.push(['editReply',p]);return 'e';},
  async deferReply(p){calls.push(['deferReply',p]);this.deferred=true;return 'd';},
  async update(p){calls.push(['update',p]);this.replied=true;return 'u';},
  async deferUpdate(){calls.push(['deferUpdate']);this.deferred=true;return 'du';}
 };
 const ctx=ctxFor(interaction);
 eq(await ctx.reply({content:'one'}),'r');
 eq(await ctx.reply({content:'two'}),'f'); // second logical reply becomes a follow-up, never a second initial acknowledgement
 assert(calls.filter(x=>x[0]==='reply').length===1,'double initial reply escaped context');
 assert(calls.filter(x=>x[0]==='followUp').length===1,'acknowledged interaction did not use follow-up');
});

test('G3 source has no direct interaction settlement outside canonical adapter', async()=>{
 const root=path.join(__dirname,'..','src');const found=[];
 (function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory())walk(full);else if(e.isFile()&&e.name.endsWith('.js')&&!full.endsWith('interactionExecutionContext.js')){const t=fs.readFileSync(full,'utf8');if(/\binteraction\.(?:reply|deferReply|deferUpdate|editReply|update|followUp)\s*\(/.test(t))found.push(full);}}})(root);
 eq(found,[],'direct interaction settlement remains');
});


test('G3 operation fences isolate identical keys across many guilds and dedupe within one guild', async()=>{
 const {withFence}=require('../src/infrastructure/operationFence');
 const metrics=require('../src/infrastructure/scaleMetrics');metrics.reset();
 const values=await Promise.all(Array.from({length:64},(_,i)=>withFence({guildId:`guild-${i}`,key:'advance:same'},async()=>i)));
 eq(values.filter(x=>x.acquired).length,64,'cross-guild fence collision');
 let release;const hold=new Promise(r=>release=r);
 const first=withFence({guildId:'guild-one',key:'advance:league'},async()=>hold);
 await new Promise(r=>setImmediate(r));
 const duplicate=await withFence({guildId:'guild-one',key:'advance:league'},async()=>99);
 assert(duplicate.duplicate&&!duplicate.acquired,'same-guild duplicate was not fenced');release();await first;
 const snap=metrics.snapshot();assert(Object.keys(snap.counters).some(k=>k.startsWith('operation_fence_duplicate_total')),'fence duplicate metric missing');
});

test('G3 compatibility retirement requires both zero hits and satisfied removal condition', async()=>{
 const reg=require('../src/infrastructure/compatibilityRegistry');const id=reg.all()[0].compatId;
 assert(!reg.retirementReport({hitCounts:{[id]:1},conditions:{[id]:true}}).find(x=>x.compatId===id).ready);
 assert(!reg.retirementReport({hitCounts:{[id]:0},conditions:{[id]:false}}).find(x=>x.compatId===id).ready);
 assert(reg.assertRetirementReady(id,{hitCounts:{[id]:0},conditions:{[id]:true}}).ready);
});


test('G3 trusted request context enforces active-league guild isolation', async()=>{
 const os=require('os');const fs=require('fs');const path=require('path');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'nofun-g3-scope-'));
 const old=process.env.BOT_DATA_DIR;process.env.BOT_DATA_DIR=tmp;
 for(const mod of ['../src/storage/jsonStore','../src/services/activeLeagueService','../src/application/requestContext']){try{delete require.cache[require.resolve(mod)];}catch{}}
 const ctx=require('../src/application/requestContext');const registry=require('../src/services/activeLeagueService');
 await ctx.run({guildId:'guild-a',actorId:'user-a'},async()=>registry.upsertLeague({id:'league-a',guildId:'guild-a',leagueTypeId:'madden_franchise',leagueName:'A'}));
 await ctx.run({guildId:'guild-b',actorId:'user-b'},async()=>registry.upsertLeague({id:'league-b',guildId:'guild-b',leagueTypeId:'madden_franchise',leagueName:'B'}));
 await ctx.run({guildId:'guild-a',actorId:'user-a'},async()=>{
   eq(registry.listLeagueRecords().map(x=>x.id),['league-a']);
   eq(registry.getLeague('league-b'),null,'wrong-guild league leaked through getLeague');
   let wrong=false;try{registry.removeLeague('league-b');}catch(e){wrong=e.code==='LEAGUE_WRONG_GUILD';}assert(wrong,'cross-guild delete did not fail closed');
 });
 await require('../src/storage/jsonStore').flushAllWrites();
 if(old==null)delete process.env.BOT_DATA_DIR;else process.env.BOT_DATA_DIR=old;
 fs.rmSync(tmp,{recursive:true,force:true});
});


test('G3 storage queue identity cannot dedupe identical writes across guilds', async()=>{
 const {storageJobId}=require('../src/queue/queueIdentity');
 const data={value:1};
 const a=storageJobId('settings.json',data,{guildId:'guild-a',spaceId:'league-1'});
 const b=storageJobId('settings.json',data,{guildId:'guild-b',spaceId:'league-1'});
 const retry=storageJobId('settings.json',data,{guildId:'guild-a',spaceId:'league-1'});
 assert(a!==b,'cross-guild storage jobs collided');eq(a,retry,'same scoped write is not deterministic');
});


test('G3 backpressure gate enforces hard concurrency and drains FIFO queue', async()=>{
 const {createBackpressureGate}=require('../src/infrastructure/backpressure');
 const gate=createBackpressureGate({maxInFlight:3,maxQueued:20,queueTimeoutMs:1000,name:'load-test'});
 let active=0,peak=0;
 const jobs=Array.from({length:20},(_,i)=>gate.run(async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;return i;}));
 const values=await Promise.all(jobs);eq(values.length,20);assert(peak<=3,`concurrency escaped limit: ${peak}`);assert(gate.metrics().maxObserved<=3);
});

test('G3 backpressure queued work times out instead of bypassing capacity', async()=>{
 const {createBackpressureGate}=require('../src/infrastructure/backpressure');
 const gate=createBackpressureGate({maxInFlight:1,maxQueued:1,queueTimeoutMs:5,name:'timeout-test'});
 let release;const hold=gate.run(()=>new Promise(r=>{release=r;}));
 let code=null;try{await gate.run(async()=>2);}catch(e){code=e.code;}
 eq(code,'BACKPRESSURE_TIMEOUT');release();await hold;eq(gate.metrics().timedOut,1);
});


test('G2 overflow modes account for every excess reward point', async()=>{
 const {planOverflow}=require('../src/domain/progression/overflow');
 const reject=planOverflow({mode:'REJECT',cap:10,currentEarned:9,incoming:3});eq(reject.code,'MEMBER_EARNED_CAP');eq(reject.overflow,2);
 const bank=planOverflow({mode:'BANK_LOCKED',cap:10,currentEarned:9,incoming:3});assert(bank.ok);eq(bank.accepted,3);eq(bank.locked,2);eq(bank.forfeited,0);
 const expire=planOverflow({mode:'EXPIRE',cap:10,currentEarned:9,incoming:3,expiryDays:7});assert(expire.ok);eq(expire.accepted,1);eq(expire.forfeited,2);assert(expire.expiresAt instanceof Date);
 const convert=planOverflow({mode:'CONVERT',cap:10,currentEarned:9,incoming:6,conversion:{rewardType:'DEV_TRAIT',pointsPerUnit:2}});assert(convert.ok);eq(convert.accepted,1);eq(convert.convertQuantity,2);eq(convert.convertRemainder,1);eq(convert.locked,1);
});

test('G2 canonical membership identity is stable across a league tenure', async()=>{
 const p=require('../src/domain/g2/canonicalProjection');
 const a=p.membershipId('guild-1','league-1','user-1');
 const b=p.membershipId('guild-1','league-1','user-1');
 eq(a,b);assert(a.startsWith('member_'));
 eq(p.teamPk('guild-1','league-1','Ravens'),p.teamPk('guild-1','league-1','ravens'));
 assert(p.membershipId('guild-1','league-2','user-1')!==a,'membership leaked across league');
});

test('G2 legacy reward inference migrates only unambiguous entitlements', async()=>{
 const {inferRewards}=require('../src/domain/progression/legacyMigration');
 eq(inferRewards({title:'Super Bowl Champion'}).map(x=>x.rewardType),['AGE_RESET','DEV_TRAIT']);
 eq(inferRewards({rewardType:'AGE_RESET'}).map(x=>x.rewardType),['AGE_RESET']);
 eq(inferRewards({title:'Age Reset or Dev Trait'}),[],'ambiguous legacy choice was auto-minted');
 eq(inferRewards({title:'Attribute Boost',details:'+3 rating points'}),[{rewardType:'ATTRIBUTE_POINTS',quantity:1,points:3}]);
});

test('G2 provider evidence supports all enabled provider adapters and normalizes traits', async()=>{
 const evidence=require('../src/domain/progression/providerRosterEvidence');
 for(const key of ['companion_export','neonsportz','custom_endpoint'])assert(evidence.SUPPORTED.has(key),`missing ${key}`);
 eq(evidence.normalizeDevTrait(3),'xfactor');eq(evidence.normalizeDevTrait('X-Factor'),'xfactor');eq(evidence.normalizeDevTrait('Super Star'),'superstar');
 const list=evidence.rows({data:{players:[{id:'p1'}]}});eq(list.length,1);eq(evidence.playerIdOf({player_id:'p2'}),'p2');eq(evidence.teamIdOf({clubId:'t'}),'t');
});

test('G2 cutover migration enforces one active tenure and durable legacy review queue', async()=>{
 const schema=fs.readFileSync(path.join(__dirname,'..','prisma','schema.prisma'),'utf8');
 assert(schema.includes('model LegacyProgressionMigration'),'legacy migration queue model missing');
 const migrations=path.join(__dirname,'..','prisma','migrations');
 const files=[];(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(e.name==='migration.sql')files.push(f);}})(migrations);
 const sql=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
 assert(sql.includes('legacy_progression_migrations'),'durable legacy migration table missing');
 assert(sql.includes('membership_tenures_one_active_user_per_season'),'active tenure uniqueness gate missing');
});

test('G2 normal league and team paths invoke canonical PostgreSQL projection', async()=>{
 const setup=fs.readFileSync(path.join(__dirname,'..','src','services','leagueSetupService.js'),'utf8');
 const teams=fs.readFileSync(path.join(__dirname,'..','src','services','openTeamsService.js'),'utf8');
 assert(setup.includes('canonicalProjection')&&setup.includes('projectLeague'),'league build does not project canonical rows');
 assert(teams.includes('projectTeamClaim')&&teams.includes('projectTeamRelease'),'team lifecycle does not project canonical membership tenure');
});

test('G2 commissioner legacy cutover is exposed as an explicit migration operation', async()=>{
 const useCase=fs.readFileSync(path.join(__dirname,'..','src','application','g2ProgressionUseCase.js'),'utf8');
 const commands=fs.readFileSync(path.join(__dirname,'..','src','commands.js'),'utf8');
 assert(useCase.includes("'migrate-legacy'")||useCase.includes('migrate-legacy'),'migrate-legacy use case missing');
 assert(commands.includes('migrate-legacy'),'migrate-legacy command missing');
 assert(useCase.includes('importPendingBoostReview'),'legacy pending boosts are not captured durably');
});

run();
