'use strict';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; console.log(`✅ ${name}`); }
  else { failed++; console.error(`❌ ${name}`); }
}
const svc = fs.readFileSync(path.join(__dirname,'../src/services/cleanSlateResetService.js'),'utf8');
const router = fs.readFileSync(path.join(__dirname,'../src/routing/interactionRouter.js'),'utf8');
check('clean slate clears shared/direct conversation state', /conversationContextService'\)\.clearGuild/.test(svc));
check('clean slate clears ambient conversation state', /ambientConversationService'\)\.clearGuild/.test(svc));
check('clean slate clears media-analysis cache', /mediaContextService'\)\.clearGuild/.test(svc));
check('clean slate clears active league registry', /activeLeagueService'\)\.clearGuild/.test(svc));
check('clean slate clears managed-space reservations', /managedSpaceService'\)\.clearGuild/.test(svc));
check('clean slate clears lifetime history', /lifetimeHistoryService'\)\.clearGuild/.test(svc));
check('provider state is deleted by league id instead of nonexistent guildId', /leagueId:\s*\{\s*in:/.test(svc));
check('server config is reset in place so active background job is not cascade-deleted', /serverConfig\.upsert/.test(svc) && !/serverConfig\.deleteMany/.test(svc));
check('initialize-server uses clean slate service', /case 'initialize-server':[\s\S]{0,5000}cleanSlateResetService/.test(router));
check('trash-the-bot uses same clean slate service', /case 'trash-the-bot':[\s\S]{0,5000}cleanSlateResetService/.test(router));
check('full reboot has a defined memoryReset before completion', /const memoryReset = await require\('\.\.\/services\/cleanSlateResetService'\)/.test(router));
console.log(`Clean-slate reset regression: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
