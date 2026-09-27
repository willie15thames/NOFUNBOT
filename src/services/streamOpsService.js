/*
 * NAVIGATION HEADER
 * FILE: src/services/streamOpsService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const FILE = 'streamOps.json';
const DEFAULTS = {
  channelId: null,
  pingRoleId: null,
  enabled: true,
};

function getConfig() {
  const raw = loadJson(FILE, DEFAULTS) || {};
  return { ...DEFAULTS, ...raw, enabled: raw.enabled !== false };
}

function saveConfig(next) {
  const merged = { ...getConfig(), ...(next || {}) };
  saveJsonDebounced(FILE, merged, 200);
  return merged;
}

function _findPlayerByAny(state, teamOrUser) {
  const raw = String(teamOrUser || '').trim().toLowerCase();
  return [...state.players.values()].find(p =>
    String(p.userId || '').toLowerCase() === raw ||
    String(p.baseTeam || '').toLowerCase() === raw ||
    String(p.displayTeam || '').toLowerCase() === raw
  ) || null;
}

async function adjust(state,teamOrUser,delta,ctx={}){
 const player=_findPlayerByAny(state,teamOrUser);if(!player)return null;
 const progress=await require('./lifetimeHistoryService').adjustStreamProgress(ctx.guildId||process.env.GUILD_ID,player,delta,ctx.operationId);
 player.streamCount=progress.count;player.lastStreamCreditAt=progress.lastCreditAt;
 saveJsonDebounced('players.json',[...state.players].map(([key,value])=>({key,...value})));
 return player;
}
async function addCount(state,teamOrUser,url='',ctx={}){return adjust(state,teamOrUser,1,ctx);}
async function removeCount(state,teamOrUser,ctx={}){return adjust(state,teamOrUser,-1,ctx);}
async function resetAll(state,ctx={}){
 let count=0;
 for(const player of state.players.values()){
  await adjust(state,player.userId,null,{...ctx,operationId:ctx.operationId?`${ctx.operationId}:${player.leagueId}:${player.userId}`:undefined});count++;
 }
 return count;
}

module.exports = {
  getConfig,
  saveConfig,
  addCount,
  removeCount,
  resetAll,
};
