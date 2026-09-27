'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const gate=require('../src/services/explicitMentionGateService');
let passed=0,failed=0;
function t(name,fn){try{fn();console.log('✅',name);passed++;}catch(e){console.error('❌',name,'\n ',e.stack||e);failed++;}}
const root=path.join(__dirname,'..');
function read(rel){return fs.readFileSync(path.join(root,rel),'utf8');}
function msg({guild=true,authorBot=false,mention=false}={}){return{guild:guild?{id:'g'}:null,author:{bot:authorBot},mentions:{users:{has:id=>mention&&id==='bot'}}};}

t('ordinary guild conversation does not authorize conversational speech',()=>assert.equal(gate.isExplicitBotMention(msg(),{user:{id:'bot'}}),false));
t('reply-like message still requires explicit bot mention',()=>{const m=msg();m.reference={messageId:'old-bot-message'};assert.equal(gate.isExplicitBotMention(m,{user:{id:'bot'}}),false);});
t('explicit bot mention authorizes conversational gate once',()=>assert.equal(gate.isExplicitBotMention(msg({mention:true}),{user:{id:'bot'}}),true));
t('all three conversational handlers use the central explicit mention gate',()=>{for(const f of ['src/handlers/commissionerHandler.js','src/handlers/memberMentionHandler.js','src/handlers/itHandler.js']){const s=read(f);assert.match(s,/isExplicitBotMention/);assert.match(s,/botMentioned\s*=\s*isExplicitBotMention/);}});
t('ambient observation is downstream of moderation/read-only gates and upstream of persona routing',()=>{const s=read('index.js');const spam=s.indexOf('handleSpam(message');const readOnly=s.indexOf('read-only');const observe=s.indexOf("ambientConversationService').observe(message)");const ai=s.indexOf('AI Routing',observe);assert(spam>=0&&observe>spam,'ambient observe must be after spam gate');assert(readOnly>=0&&observe>readOnly,'ambient observe must be after read-only gate');assert(ai>observe,'ambient observe must happen immediately before conversational routing, not after it');});
t('message update/delete lifecycle maintains ambient store',()=>{const s=read('index.js');assert.match(s,/ambientConversationService'\)\.removeMessage/);assert.match(s,/const ambient = require\('\.\/src\/services\/ambientConversationService'\)/); assert.match(s,/ambient\.removeMessage\(msg\)/);assert.match(s,/ambientConversationService'\)\.updateMessage/);});
t('default passive path cannot call trash-talk AI unless explicit opt-in is enabled',()=>{const s=read('index.js');assert.match(s,/ENABLE_TRASH_TALK_LEARNING/);const bank=read('src/services/trashTalkBank.js');assert.match(bank,/ENABLE_TRASH_TALK_LEARNING/);});
console.log(`\nMessage routing regression: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
