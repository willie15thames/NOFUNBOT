'use strict';
const assert=require('assert');
const {isExplicitBotMention}=require('../src/services/explicitMentionGateService');
const client={user:{id:'bot'}};
function msg({guild=true,bot=false,mention=false}={}){return {guild:guild?{id:'g'}:null,author:{bot},mentions:{users:{has:id=>mention&&id==='bot'}}};}
assert.equal(isExplicitBotMention(msg({mention:false}),client),false,'ordinary conversation must not authorize speech');
assert.equal(isExplicitBotMention(msg({mention:true}),client),true,'explicit @mention must authorize conversational routing');
assert.equal(isExplicitBotMention(msg({guild:false,mention:true}),client),false,'DM is not guild conversational lane');
assert.equal(isExplicitBotMention(msg({bot:true,mention:true}),client),false,'bot/webhook messages never wake persona');
console.log('Speech gate regression: 4 passed, 0 failed');
