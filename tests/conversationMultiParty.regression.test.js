'use strict';
const assert = require('assert');
const ctx = require('../src/services/conversationContextService');
const gate = require('../src/services/explicitMentionGateService');

ctx.clearAll();
const metaA={guildId:'g1',channelId:'c1',userId:'u1',scope:'member'};
const metaB={guildId:'g1',channelId:'c1',userId:'u2',scope:'member'};
ctx.appendShared(metaA,'user','what is this server?',{userId:'u1',display:'Erika',messageId:'m1'});
ctx.appendShared(metaA,'assistant','It is a Madden league server.',{display:'Bot'});
ctx.appendShared(metaB,'user','what about trades?',{userId:'u2',display:'Willie',messageId:'m2',replyToMessageId:'bot1'});
const rendered=ctx.renderShared(metaB,{max:10});
assert(rendered.includes('Erika: what is this server?'));
assert(rendered.includes('Bot: It is a Madden league server.'));
assert(rendered.includes('Willie: what about trades?'));
assert.equal(ctx.getSharedHistory(metaA).length,3);
assert.equal(ctx.clearGuild('g1')>0,true);
assert.equal(ctx.getSharedHistory(metaB).length,0);

const client={user:{id:'bot'}};
const replyViaMention={guild:{},author:{bot:false},mentions:{users:{has:()=>false},repliedUser:{id:'bot'}},channel:{messages:{cache:{get:()=>null}}}};
assert.equal(gate.isExplicitBotMention(replyViaMention,client),true);
const replyViaCache={guild:{},author:{bot:false},mentions:{users:{has:()=>false}},reference:{messageId:'x'},channel:{messages:{cache:{get:()=>({author:{id:'bot'}})}}}};
assert.equal(gate.isExplicitBotMention(replyViaCache,client),true);
const unrelated={guild:{},author:{bot:false},mentions:{users:{has:()=>false}},channel:{messages:{cache:{get:()=>null}}}};
assert.equal(gate.isExplicitBotMention(unrelated,client),false);
console.log('Multi-party conversation regression: 10 passed, 0 failed');
