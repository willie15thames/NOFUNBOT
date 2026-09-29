'use strict';
const assert = require('node:assert/strict');
const registry = require('../src/services/activeLeagueService');
const router = require('../src/routing/interactionRouter');

(async()=>{
  const guild={id:'autocomplete-boundary-guild'};
  const channel={id:'autocomplete-boundary-channel',guild,parentId:null};
  registry.upsertLeague({id:'autocomplete-boundary-league',guildId:guild.id,leagueName:'Private League',status:'ACTIVE',builtChannelIds:[channel.id]});
  router.init({state:{openTeamRegistry:[],commissionerIds:[]},getCh:()=>null,client:{},aiCall:async()=>null,MODELS:{},services:{}});
  let responses=0,replies=0;
  const interaction={guild,guildId:guild.id,channel,channelId:channel.id,user:{id:'not-a-member'},member:{roles:{cache:new Map()},permissions:{has:()=>false}},commandName:'select-team',options:{getFocused:()=>({name:'team',value:'Rav'})},isAutocomplete:()=>true,respond:async choices=>{responses++;assert.deepEqual(choices,[]);},reply:async()=>{replies++;throw new Error('autocomplete cannot reply');}};
  await router.handleInteraction(interaction);
  assert.equal(responses,1);
  assert.equal(replies,0);
  console.log('G0 autocomplete boundary: 1 passed, 0 failed');
})().catch(err=>{console.error(err);process.exitCode=1;});
