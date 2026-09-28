/*
 * NAVIGATION HEADER
 * FILE: src/utils/teamUtils.js
 * LAYER: Utility/helper layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const {norm} = require('./helpers');
const {TEAM_EMOJI_MAP,TEAM_SLANG,ATTRS_BY_CATEGORY} = require('../config/teams');
const emojiBank = require('../config/emojiBank');

function resolveTeamSlang(input){if(!input)return input;return TEAM_SLANG[input.toLowerCase().trim()]||input;}

function getTeamEmoji(guild, teamName) {
  if (!teamName) return '';
  // Try emojiBank first (new nfl_/nba_ names + legacy fallback)
  const bankResult = emojiBank.getTeamEmoji(guild, teamName);
  if (bankResult) return bankResult;
  // Fall back to old TEAM_EMOJI_MAP for anything not in the bank
  const key = teamName.toLowerCase().trim();
  let name = TEAM_EMOJI_MAP[key];
  if (!name) {
    for (const [mk, mv] of Object.entries(TEAM_EMOJI_MAP)) {
      if (mk.startsWith('_')) continue;
      if (key.includes(mk) || mk.includes(key)) { name = mv; break; }
    }
  }
  if (!name) return '';
  // Never leak internal custom-emoji keys such as ':1804panthers:' into member-facing text.
  // If the guild does not actually have the mapped custom emoji, degrade cleanly to no emoji.
  if (!guild) return '';
  const found = guild.emojis.cache.find(e => e.name === name);
  return found ? found.toString() : '';
}

function getDevEmoji(guild,devTrait){const map={'star':'stardev','superstar':'Superstar','x-factor':'Xfactor','xfactor':'Xfactor'};const name=map[(devTrait||'').toLowerCase().trim()];if(!name||!guild)return'';const found=guild.emojis.cache.find(e=>e.name===name);return found?found.toString():'';}
function getTeamDataByAnyName(teamInput,players){const needle=norm(resolveTeamSlang(teamInput));if(!needle)return null;for(const d of players.values()){if(norm(d.baseTeam)===needle||norm(d.displayTeam)===needle)return d;}return null;}
function findPlayerByUserId(userId,players){return[...players.values()].find(p=>p.userId===userId)||null;}
function isSingleAttrCategory(cat){return(ATTRS_BY_CATEGORY[cat]||[]).length===1;}
function resolveAttrInput(input,category){const list=category?(ATTRS_BY_CATEGORY[category]||[]):Object.values(ATTRS_BY_CATEGORY).flat();if(category&&list.length===1)return list[0].full;if(!input)return null;const u=input.toUpperCase().trim(),l=input.toLowerCase().trim();return(list.find(a=>a.abbr===u)||list.find(a=>a.full.toLowerCase()===l)||list.find(a=>a.full.toLowerCase().includes(l)))?.full||input.trim();}
function getAttrSuggestions(typed,category){const list=category?(ATTRS_BY_CATEGORY[category]||[]):Object.values(ATTRS_BY_CATEGORY).flat();const u=(typed||'').toUpperCase(),l=(typed||'').toLowerCase();return list.filter(a=>!typed||a.abbr.startsWith(u)||a.full.toLowerCase().includes(l)).slice(0,25).map(a=>({name:`${a.abbr} — ${a.full}`,value:a.abbr}));}
const PHYSICAL=['speed','acceleration','agility','strength','jumping','stamina','toughness','injury'];
function isPhysicalAttr(a){return PHYSICAL.some(p=>(a||'').toLowerCase().includes(p));}
module.exports = {resolveTeamSlang,getTeamEmoji,getDevEmoji,getTeamDataByAnyName,findPlayerByUserId,isSingleAttrCategory,resolveAttrInput,getAttrSuggestions,isPhysicalAttr,ATTRS_BY_CATEGORY};
