'use strict';
const {test,run,assert,eq,mockGuild,ChannelType,freshState,resetFiles}=require('./_harness');
const json=require('../src/storage/jsonStore'),critical=require('../src/storage/criticalStore'),registry=require('../src/services/activeLeagueService');
const history=require('../src/services/lifetimeHistoryService'),results=require('../src/league/gameResultService');
const scope=require('../src/league/spaceContext');
let serial=0;
function fixture(){const state=freshState();const id=`rc6-results-${++serial}`;process.env.GUILD_ID=id;resetFiles(['gameResults.json',`standings_${id}.json`]);state.leagueConfig.proAm={[id]:{id,teams:['Bears','Lions']}};return{state,id,input:{homeTeam:'Bears',awayTeam:'Lions',homeScore:21,awayScore:14,week:1,leagueId:id},standings:()=>json.loadJson(`standings_${id}.json`,{})};}
test('F01 preserve renamed moved and retopiced manifest channels and untracked lookalikes',async()=>{
 for(const field of ['name','topic','_parentId']){
  const g=mockGuild(),cat=g._makeChannel({name:'Old',type:ChannelType.GuildCategory}),other=g._makeChannel({name:'Other',type:ChannelType.GuildCategory});
  const ch=g._makeChannel({name:'rules',parent:cat});ch.topic='Rules channel for Test';
  json.saveJson('templateBuildManifest.json',{[g.id]:{channels:[{id:ch.id,name:ch.name,topic:ch.topic,parentId:cat.id}]}});
  ch[field]=field==='_parentId'?other.id:'manual';
  const svc=require('../src/services/templateReconciliationService');await svc.reconcile(g,svc.capture(g),[]);assert(g.channels.cache.has(ch.id),field);
 }
 const g=mockGuild(),cat=g._makeChannel({name:'Manual',type:ChannelType.GuildCategory}),ch=g._makeChannel({name:'notes',parent:cat});ch.topic='Rules channel for Test';
 const svc=require('../src/services/templateReconciliationService');await svc.reconcile(g,svc.capture(g),[]);assert(g.channels.cache.has(ch.id));
});
test('F02 final membership commit failure compensates newly granted role',async()=>{
 const g=mockGuild(),held=new Set(),member={id:'rollback-user',roles:{cache:{has:id=>held.has(id)},add:async id=>held.add(id),remove:async id=>held.delete(id)}};
 registry.upsertLeague({id:'privacy',guildId:g.id,status:'ACTIVE',memberRoleId:'private-role'});
 const original=critical.transact;let n=0,error;
 critical.transact=async(...args)=>{if(++n===2)throw Error('DB finalization unavailable');return original(...args);};
 try{await require('../src/services/leagueVisibilityService').grantMemberAccessToLeague(g,member,{},'privacy');}catch(e){error=e;}finally{critical.transact=original;}
 assert(error);eq([...held],[]);assert(!await require('../src/services/leagueVisibilityService').hasMembership(g.id,member.id,'privacy'));
});
test('F02 failed compensation is durably repairable and restart recovery revokes access',async()=>{
 const g=mockGuild(),held=new Set(),member={id:'repair-user',roles:{cache:{has:id=>held.has(id)},add:async id=>held.add(id),remove:async()=>{throw Error('Discord unavailable');}}};g.members.cache.set(member.id,member);
 registry.upsertLeague({id:'repair-league',guildId:g.id,status:'ACTIVE',memberRoleId:'repair-role'});
 const original=critical.transact;let n=0;
 critical.transact=async(...args)=>{if(++n===2)throw Error('DB finalization unavailable');return original(...args);};
 try{await require('../src/services/leagueVisibilityService').grantMemberAccessToLeague(g,member,{},'repair-league');}catch{}finally{critical.transact=original;}
 assert(held.has('repair-role'));member.roles.remove=async id=>held.delete(id);
 const repaired=await require('../src/services/leagueVisibilityService').recover(g);assert(repaired.some(x=>x.repaired));eq([...held],[]);
});
test('F03 three scoped player records use canonical keys without double prefixes',()=>{
 const root={players:new Map()},state=require('../src/league/scopedState').wrap(root);
 for(const id of ['A','B','C'])scope.run(id,()=>state.players.set('ravens',{userId:id}));
 for(const id of ['A','B','C'])eq(scope.run(id,()=>state.players.get('ravens').userId),id);
 scope.run('A',()=>state.players.set('A::ravens',{...state.players.get('ravens'),displayTeam:'Custom'}));eq(root.players.size,3);
 scope.run('A',()=>state.players.delete('ravens'));eq(root.players.size,2);
});
test('F04 archive failure leaves no active event or created resources',async()=>{
 const g=mockGuild();g.id='event-rc6';let deleted=false;g.roles.create=async()=>({id:'event-role',delete:async()=>{deleted=true;}});
 const original=history.archiveCompetition;history.archiveCompetition=async()=>{throw Error('archive failure');};let error;
 try{await require('../src/services/eventSpaceService').create(g,{name:'Rollback'});}catch(e){error=e;}finally{history.archiveCompetition=original;}
 assert(error&&deleted);eq(g.channels.cache.size,0);assert(!registry.listActiveLeagues().some(x=>x.guildId===g.id));
});
test('F05 concurrent result retries count once in standings and lifetime authority',async()=>{
 const f=fixture();const rows=await Promise.all(Array.from({length:10},()=>results.submitGameResult(f.input,{state:f.state})));
 eq(rows.filter(r=>!r.deduped).length,1);eq(f.standings().Bears.w,1);
 const snap=await history.snapshot(f.id);eq(Object.keys(snap.results).length,1);
});
test('F06 failure inside transaction changes neither standings nor lifetime; retries retract once',async()=>{
 const f=fixture();await results.submitGameResult(f.input,{state:f.state});await results.submitGameResult({...f.input,week:2},{state:f.state});
 const original=critical.transact;critical.transact=(key,fb,fn)=>original(key,fb,async data=>{await fn(data);throw Error('before commit');});let error;
 try{await results.retractGameResult({week:1,team1:'Bears',team2:'Lions',leagueId:f.id},{state:f.state});}catch(e){error=e;}finally{critical.transact=original;}
 assert(error);eq(f.standings().Bears.w,2);eq(Object.values((await history.snapshot(f.id)).results).filter(x=>x.status==='ACTIVE').length,2);
 const out=await Promise.all([1,2].map(()=>results.retractGameResult({week:1,team1:'Bears',team2:'Lions',leagueId:f.id},{state:f.state})));
 eq(out.reduce((n,r)=>n+r.removed,0),1);eq(f.standings().Bears.w,1);
});
test('committed score projections rebuild from durable authority after cache loss',async()=>{
 const f=fixture();await results.submitGameResult(f.input,{state:f.state});json.saveJson('gameResults.json',null);json.saveJson(`standings_${f.id}.json`,{});f.state.ocrGameResults=[];
 await results.recoverProjections(f.id,f.state);eq(f.standings().Bears.w,1);eq(results.listResults().length,1);eq(f.state.ocrGameResults.length,1);
});
test('F07 different destructive commands contend for one guild lock',async()=>{
 const locks=require('../src/services/guildLockService');assert(await locks.acquire('locks','initialize-server','a'));eq(await locks.acquire('locks','trash-the-bot','b'),false);await locks.release('locks','initialize-server');
 let release;const hold=new Promise(r=>{release=r;});let entered;
 const started=new Promise(r=>{entered=r;});const first=critical.withExclusive('structure-test',async()=>{entered();await hold;});await started;
 eq((await critical.withExclusive('structure-test',async()=>{})).acquired,false);release();await first;assert((await critical.withExclusive('structure-test',async()=>{})).acquired);
});
test('F08 normalized private IPv6 and mapped forms are blocked',()=>{
 const {validateExternalUrl}=require('../src/utils/httpIntake');
 for(const host of ['[::ffff:127.0.0.1]','[::ffff:7f00:1]','[::1]','[fc00::1]','[fe80::1]','127.1','2130706433'])assert(!validateExternalUrl(`https://${host}/`).ok,host);
});
test('F08 connection DNS rejects mixed private answers and pins validated addresses',async()=>{
 const {validatedLookup}=require('../src/utils/httpIntake');
 const invoke=addresses=>new Promise(resolve=>validatedLookup((_h,_o,cb)=>cb(null,addresses))('example.com',{},(err,address,family)=>resolve({err,address,family})));
 assert((await invoke([{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}])).err);
 const good=await invoke([{address:'93.184.216.34',family:4}]);eq([good.address,good.family],['93.184.216.34',4]);
});
test('F09 normal YouTube watch live and short URLs remain supported',()=>{
 const {STREAM_RX,parseStreamUrl}=require('../src/services/streamCreditService');for(const url of ['https://www.youtube.com/watch?v=abc','https://youtube.com/live/abc','https://youtu.be/abc','https://twitch.tv/channel','https://kick.com/channel'])assert(STREAM_RX.test(url)&&parseStreamUrl(url),url);
 assert(!STREAM_RX.test('https://youtube.com.evil.invalid/watch?v=abc'));
 for(const bad of ['https://youtube.com/watch?v=&t=3','https://youtube.com/watch?v=','https://youtu.be/','https://youtube.com/live/?t=1'])eq(parseStreamUrl(bad),null);
});
test('F10 active check failure is isolated and late joiners are not charged',async()=>{
 json.saveJson('activeLeagues.json',{});const g=mockGuild(),a=g._makeChannel({name:'active-check'}),b=g._makeChannel({name:'active-check'});a.send=async()=>{throw Error('failed first league');};
 const svc=require('../src/services/leagueFeatureService');for(const [id,ch]of [['aa',a],['bb',b]]){registry.upsertLeague({id,guildId:g.id});svc.setLeague(id,{activeCheckEnabled:true,channelId:ch.id,lastPostedAt:null,windowEndsAt:null});}
 const state={openTeamRegistry:[{leagueId:'aa',ownerId:'a'},{leagueId:'bb',ownerId:'b'}]};const out=await svc.processDueActiveChecks(g,state);eq(out.errors.length,1);assert(svc.getLeague('bb').windowEndsAt);eq(svc.getLeague('aa').windowEndsAt,null);
 state.openTeamRegistry.push({leagueId:'bb',ownerId:'late'});svc.setLeague('bb',{windowEndsAt:Date.now()-1});await svc.processDueActiveChecks(g,state);eq(svc.getLeague('bb').consecutiveMisses.late,undefined);
});
test('F11 intentional team-like nickname without provenance is preserved',async()=>{
 let changed=false;await require('../src/services/nicknamePolicyService').syncMemberNickname({id:'manual',nickname:'Lions (EDT)',manageable:true,setNickname:async()=>{changed=true;}},{openTeamRegistry:[{ownerId:'manual',displayTeam:'Lions'}]});eq(changed,false);
});
test('F12 reward rollover retains cooldown and durable duplicate identity',async()=>{
 const input={messageId:'sixteenth',userId:'streamer',leagueId:'streams',game:'madden',seasonId:'current',cooldown:3600000,rewards:[{count:16,label:'Reward'}]};
 const a=await history.creditStream('stream-test',input,{count:15,lastCreditAt:Date.now()-7200000});assert(a.ok);eq(a.nextCount,0);
 eq((await history.creditStream('stream-test',{...input,messageId:'next'})).reason,'cooldown');eq((await history.creditStream('stream-test',input)).reason,'duplicate');eq((await history.career('stream-test','streamer')).awards.length,1);
});
test('F13 failed community deletion reports failure and retry uses recorded IDs',async()=>{
 const g=mockGuild(),cat=g._makeChannel({name:'Community',type:ChannelType.GuildCategory}),ch=g._makeChannel({name:'chat',parent:cat});const original=ch.delete;ch.delete=async()=>{throw Error('Missing Permissions');};let error;
 const svc=require('../src/services/spaceAutoGenService');try{await svc.deleteCommunityChannels(g,'Community');}catch(e){error=e;}assert(error);assert(g.channels.cache.has(cat.id));
 ch.name='renamed-after-failure';ch.delete=original;await svc.deleteCommunityChannels(g,'Community');eq(g.channels.cache.size,0);
});
test('manual stream adjustments are durable, retry-safe and preserve earned history/cooldown',async()=>{
 const player={leagueId:'manual-stream',userId:'manual-streamer',baseTeam:'Lions',streamCount:4,lastStreamCreditAt:Date.now()};
 const state={players:new Map([['manual-stream::lions',player]])},ops=require('../src/services/streamOpsService');
 const ctx={guildId:'manual-stream-guild',operationId:'adjust-one'};
 await ops.addCount(state,player.userId,'',ctx);eq(player.streamCount,5);
 await ops.addCount(state,player.userId,'',ctx);eq(player.streamCount,5);
 await history.award(ctx.guildId,{id:'earned',userId:player.userId,leagueId:player.leagueId,title:'Earned Award'});
 const last=player.lastStreamCreditAt;
 await ops.resetAll(state,{...ctx,operationId:'reset'});eq(player.streamCount,0);eq(player.lastStreamCreditAt,last);
 eq((await history.career(ctx.guildId,player.userId)).awards.length,1);
 eq(json.loadJson('players.json',[]).find(x=>x.userId===player.userId).key,'manual-stream::lions');
 eq((await history.snapshot(ctx.guildId)).streamAccounts['manual-stream:manual-streamer'].count,0);
});
test('readiness checks current dependencies, disconnection during probe, and stale heartbeat',async()=>{
 const readiness=require('../src/services/readinessService'),prisma=require('../src/storage/prisma');
 const oldProbe=prisma.probePrisma,oldDb=process.env.DATABASE_URL,oldWorker=process.env.ENABLE_QUEUE_WORKER;
 process.env.DATABASE_URL='stubbed';process.env.ENABLE_QUEUE_WORKER='false';let connected=true;
 try{
  prisma.probePrisma=async()=>({schemaReady:true,reachable:true});await readiness.start({isReady:()=>connected});assert(readiness.read().ready);
  prisma.probePrisma=async()=>({schemaReady:true,reachable:false});await readiness.check();eq(readiness.read().ready,false);
  prisma.probePrisma=async()=>{connected=false;return{schemaReady:true,reachable:true};};await readiness.check();eq(readiness.read().ready,false);
  readiness.write(true,{at:Date.now()-readiness.MAX_AGE_MS-1});eq(readiness.read().reason,'stale-heartbeat');
 }finally{await readiness.stop();prisma.probePrisma=oldProbe;process.env.DATABASE_URL=oldDb||'';process.env.ENABLE_QUEUE_WORKER=oldWorker||'';}
});
test('membership recovery removes pending personal overwrites even after a member leaves',async()=>{
 const g=mockGuild();g.id='departed-recovery';const ch=g._makeChannel({name:'chat'});let removed=false;
 ch.permissionOverwrites.cache=new Map([['departed',{}]]);ch.permissionOverwrites.delete=async()=>{removed=true;};
 g.members.fetch=async()=>{const e=Error('Unknown Member');e.code=10007;throw e;};
 await critical.transact(`v204:memberships:${g.id}`,{members:{}},data=>{data.members['league:departed']={leagueId:'league',userId:'departed',token:'pending',status:'PENDING',overwrites:[{id:ch.id,existed:false}]};});
 const report=await require('../src/services/leagueVisibilityService').recover(g);assert(removed);assert(report.every(x=>x.repaired));
});
run('rc6Faults.test.js');
