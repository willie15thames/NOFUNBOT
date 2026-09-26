/*
 * NAVIGATION HEADER
 * FILE: src/utils/helpers.js
 * LAYER: Utility/helper layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const norm     = (s='')=>String(s).toLowerCase().trim().replace(/\s+/g,' ');
const sanitize = (s='',max=1000)=>String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,'').trim().slice(0,max);
function buildDisplayTeam(loc,name,fb=''){const l=(loc||'').trim(),n=(name||'').trim();if(l&&n)return`${l} ${n}`;return n||l||fb;}
function buildProgressBar(count,max){const f=Math.min(Math.round((count/max)*10),10);return'█'.repeat(f)+'░'.repeat(10-f)+`  ${count}/${max}`;}
function splitLongText(text,max=1800){const c=[];let r=text;while(r.length>max){let at=r.lastIndexOf('\n',max);if(at<200)at=max;c.push(r.slice(0,at));r=r.slice(at).trimStart();}if(r.length)c.push(r);return c;}
function isAdminMember(member,commRoleId,commissionerIds){
  try {
    return require('../services/accessPolicyService').isElevatedMember(member,{ commRoleId, commissionerIds, allowAdministrator:true, allowManageGuild:false });
  } catch {
    return false;
  }
}
function canBotModerate(member){if(!member)return false;if(member.id===member.guild.ownerId)return false;const bot=member.guild.members.me;if(!bot)return false;return bot.roles.highest.position>member.roles.highest.position;}
async function safeFetchMember(guild,userId){
  if(!userId)return null;
  const clean=String(userId).trim();
  if(/^\d{15,20}$/.test(clean)){const m=await guild.members.fetch(clean).catch(()=>null);if(m)return m;}
  const id2=clean.match(/\[userId:(\d{15,20})\]/)?.[1];
  if(id2){const m=await guild.members.fetch(id2).catch(()=>null);if(m)return m;}
  const needle=clean.replace(/^@/,'').toLowerCase();
  await guild.members.fetch({limit:1000}).catch(()=>null);
  return guild.members.cache.find(m=>m.user.username.toLowerCase()===needle||m.user.globalName?.toLowerCase()===needle||m.displayName.toLowerCase()===needle)||null;
}
/**
 * Returns a unified Set of commissioner IDs from env config + live state.
 * Single canonical implementation — used by both index.js and interactionRouter.
 * @param {object} state - The live state object (may have commissionerIds Set or Array)
 * @param {Set|Array} baseIds - Base COMMISSIONER_IDS from env config
 */
function getActiveCommissionerIds(state, baseIds = []) {
  try {
    const ids = new Set([...(baseIds || [])]);
    const dynamic = state?.commissionerIds;
    if (dynamic instanceof Set) {
      for (const id of dynamic) ids.add(String(id));
    } else if (Array.isArray(dynamic)) {
      for (const id of dynamic) ids.add(String(id));
    }
    return ids;
  } catch {
    return new Set([...(baseIds || [])]);
  }
}

/**
 * Strip Discord mention syntax and sanitize content for safe use in AI prompts.
 * Replaces <@userId>, <@&roleId>, <#channelId> with safe placeholders.
 * @param {string} content
 * @param {number} max - max length after strip (default 2000)
 */
function stripMentions(content, max = 2000) {
  return sanitize(
    String(content || '')
      .replace(/<@!?\d+>/g, '@user')
      .replace(/<@&\d+>/g, '@role')
      .replace(/<#\d+>/g, '#channel')
      .replace(/\s+/g, ' ')
      .trim(),
    max
  );
}

/**
 * Validate a Discord snowflake ID.
 * @param {string} id
 * @returns {boolean}
 */
function isValidSnowflake(id) {
  return /^\d{17,20}$/.test(String(id || '').trim());
}

// IT role check — IT role holders, IT_IDS allowlist, AND commissioners all get IT access
function isITMember(member, itRoleId, itIds, commRoleId, commissionerIds) {
  if (!member) return false;
  // Explicit IT role
  if (itRoleId && member.roles?.cache?.has(itRoleId)) return true;
  // Explicit IT user ID
  if (itIds && itIds.has(String(member.id))) return true;
  // Commissioners always have IT access
  return isAdminMember(member, commRoleId, commissionerIds);
}

module.exports = {norm,sanitize,buildDisplayTeam,buildProgressBar,splitLongText,isAdminMember,isITMember,canBotModerate,safeFetchMember,getActiveCommissionerIds,stripMentions,isValidSnowflake};
