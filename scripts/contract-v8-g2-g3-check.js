'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
let failures=[];
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const schema=read('prisma/schema.prisma');
for(const model of ['Season','ProgressionPolicyVersion','TierAssignment','ProgressionGrant','ProgressionWallet','ProgressionClaim','PlayerMutation','EntitlementConsumption','MembershipTenure','PostseasonBracket','PostseasonMatch','OperationFence','CompatibilityPath']){
 if(!schema.includes(`model ${model}`))failures.push(`schema missing ${model}`);
}
for(const f of ['src/domain/progression/service.js','src/domain/progression/policy.js','src/domain/progression/postgresRepository.js','src/domain/season/service.js','src/domain/postseason/bracket.js']){
 const t=read(f);
 if(/jsonStore|pendingAttrBoosts/.test(t))failures.push(`${f}: legacy JSON/pending boost authority forbidden`);
 if(/['"](default|current|global)['"]/.test(t) && !/INVALID_CONTEXT/.test(t))failures.push(`${f}: placeholder identity literal in canonical core`);
}


// G2 completion/cutover gates.
for(const model of ['LegacyProgressionMigration']) if(!schema.includes(`model ${model}`)) failures.push(`schema missing ${model}`);
const projection=read('src/domain/g2/canonicalProjection.js');
const setup=read('src/services/leagueSetupService.js');
const openTeams=read('src/services/openTeamsService.js');
const overflow=read('src/domain/progression/overflow.js');
const g2UseCase=read('src/application/g2ProgressionUseCase.js');
const providerEvidence=read('src/domain/progression/providerRosterEvidence.js');
const legacyMigration=read('src/domain/progression/legacyMigration.js');
if(!setup.includes('projectLeague')) failures.push('G2 league build does not project canonical PostgreSQL rows');
if(!openTeams.includes('projectTeamClaim')||!openTeams.includes('projectTeamRelease')) failures.push('G2 team lifecycle is not wired to canonical membership tenure');
if(!projection.includes('membershipId(guildId,leagueId,userId)')) failures.push('G2 stable membership identity helper missing');
for(const mode of ['REJECT','BANK_LOCKED','CONVERT','EXPIRE']) if(!overflow.includes(`mode==='${mode}'`) && mode!=='REJECT') failures.push(`G2 overflow mode ${mode} not implemented`);
if(!overflow.includes("mode==='REJECT'")) failures.push('G2 overflow mode REJECT not implemented');
if(!g2UseCase.includes('migrate-legacy')||!g2UseCase.includes('importPendingBoostReview')) failures.push('G2 durable legacy cutover operation missing');
if(!legacyMigration.includes('REVIEW_REQUIRED')||!legacyMigration.includes('issueMemberReward')) failures.push('G2 legacy rewards do not fail safely into review/canonical grants');
for(const provider of ['companion_export','neonsportz','custom_endpoint']) if(!providerEvidence.includes(provider)) failures.push(`G2 provider evidence missing ${provider}`);
const migrationRoot=path.join(root,'prisma','migrations'); let migrationSql='';
(function walkMigrations(dir){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory())walkMigrations(full);else if(e.name==='migration.sql')migrationSql+=fs.readFileSync(full,'utf8')+'\n';}})(migrationRoot);
if(!migrationSql.includes('legacy_progression_migrations')) failures.push('G2 legacy migration durable table migration missing');
if(!migrationSql.includes('membership_tenures_one_active_user_per_season')) failures.push('G2 active tenure uniqueness migration missing');

// G3 architecture convergence gates.
const commissioner=read('src/handlers/commissionerHandler.js');
const router=read('src/routing/interactionRouter.js');
const patchNotes=read('src/services/patchNotesService.js');
if(/require\(['"]\.\.\/routing\/interactionRouter['"]\)/.test(commissioner)) failures.push('commissionerHandler must not import interactionRouter');
if(/require\(['"]\.\.\/handlers\/commissionerHandler['"]\)/.test(router)) failures.push('interactionRouter must not import commissionerHandler');
if(/require\(['"]\.\/baseInitService['"]\)/.test(patchNotes)) failures.push('patchNotesService must not import baseInitService');
for(const f of ['src/services/commissionerAuthorizationService.js','src/services/setupWizardBridgeService.js']) if(!fs.existsSync(path.join(root,f))) failures.push(`missing G3 boundary service ${f}`);


const allSource=[];
(function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory())walk(full);else if(e.isFile()&&e.name.endsWith('.js'))allSource.push(full);}})(path.join(root,'src'));
for(const full of allSource){
 const rel=path.relative(root,full).replace(/\\/g,'/');
 if(rel==='src/services/interactionExecutionContext.js') continue;
 const t=fs.readFileSync(full,'utf8');
 if(/\binteraction\.(?:reply|deferReply|deferUpdate|editReply|update|followUp)\s*\(/.test(t)) failures.push(`${rel}: direct interaction settlement outside InteractionExecutionContext`);
}

const queues=read('src/queue/queues.js');
if(!queues.includes('storageJobId(filename,data,scope)'))failures.push('storage queue lacks scoped deterministic multi-instance jobId');
if(!queues.includes("code:'BACKPRESSURE'"))failures.push('storage queue lacks backpressure');
const compat=require(path.join(root,'src/infrastructure/compatibilityRegistry'));
for(const row of compat.all())for(const k of ['compatId','owner','replacement','removalCondition','deadlineRelease'])if(!row[k])failures.push(`compat ${row.compatId||'?'} missing ${k}`);
if(failures.length){console.error('Contract v8 G2/G3 static gate FAILED');for(const f of failures)console.error(' - '+f);process.exit(1);}
console.log('Contract v8 G2/G3 static gate passed.');
