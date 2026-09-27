'use strict';
const registry = require('./activeLeagueService');
const critical = require('../storage/criticalStore');
const {randomUUID}=require('crypto');
const {PermissionFlagsBits:P}=require('discord.js');
const key = guildId => `v204:memberships:${guildId}`;
function staffOnly(ch) { return /admin|commissioner|commish|scoresheets|staff/i.test(`${ch.name} ${ch.parent?.name || ''}`); }
function previousPermissions(overwrite){return Object.fromEntries(['ViewChannel','ReadMessageHistory','SendMessages'].map(name=>[name,overwrite?.allow?.has?.(P[name])?true:overwrite?.deny?.has?.(P[name])?false:null]));}
async function compensate(guild,member,op){
 if(op.addedRole&&member)await member.roles.remove(op.addedRole,'Rollback incomplete membership');
 const userId=member?.id||op.userId;
 for(const change of op.overwrites||[]){
  const ch=guild.channels.cache.get(change.id);if(!ch)continue;
  if(change.existed)await ch.permissionOverwrites.edit(userId,change.previous);
  else if(ch.permissionOverwrites.cache?.has(userId))await ch.permissionOverwrites.delete(userId);
 }
}
async function grantMemberAccessToLeague(guild, member, state, leagueId) {
 const target=registry.getLeague(leagueId);
 if(!target||(target.guildId&&target.guildId!==guild.id)||target.status&&target.status!=='ACTIVE')throw Error('Selected league is unavailable');
 const id=`${leagueId}:${member.id}`,token=randomUUID();
 const op={token,leagueId,userId:member.id,status:'PENDING',updatedAt:Date.now(),addedRole:target.memberRoleId&&!member.roles.cache?.has(target.memberRoleId)?target.memberRoleId:null,overwrites:[]};
 if(!target.memberRoleId)for(const channelId of target.builtChannelIds||[]){
  const ch=guild.channels.cache.get(channelId);if(!ch)throw Error(`Missing league channel ${channelId}`);
  if(!staffOnly(ch)){const old=ch.permissionOverwrites.cache?.get(member.id);op.overwrites.push({id:channelId,existed:!!old,previous:previousPermissions(old)});}
 }
 const before=await critical.transact(key(guild.id),{members:{}},data=>{
  const old=data.members[id];if(['PENDING','REPAIR_REQUIRED','REVOKING'].includes(old?.status))throw Error('Membership repair is pending; retry after recovery');
  data.members[id]={...op,previousStatus:old?.status||'LEFT'};return old||null;
 });
 try{
  if(target.memberRoleId)await member.roles.add(target.memberRoleId,'League membership');
  else for(const channelId of target.builtChannelIds||[]){const ch=guild.channels.cache.get(channelId);await ch.permissionOverwrites.edit(guild.roles.everyone.id,{ViewChannel:false});if(!staffOnly(ch))await ch.permissionOverwrites.edit(member.id,{ViewChannel:true,ReadMessageHistory:true,SendMessages:!/(rules|announcements|server-guide|open-teams)$/.test(ch.name)});}
  await critical.transact(key(guild.id),{members:{}},data=>{if(data.members[id]?.token!==token)throw Error('Membership operation changed');data.members[id]={leagueId,userId:member.id,status:'ACTIVE',updatedAt:Date.now()};});
 }catch(error){
  let rollbackError;
  try{await compensate(guild,member,op);}catch(e){rollbackError=e;}
  try{await critical.transact(key(guild.id),{members:{}},data=>{if(data.members[id]?.token===token)data.members[id]=rollbackError?{...op,previousStatus:before?.status||'LEFT',status:'REPAIR_REQUIRED',error:rollbackError.message}:before||{leagueId,userId:member.id,status:'LEFT'};});}catch(e){error.message+=`; repair journal pending: ${e.message}`;}
  if(rollbackError)error.message+=`; access rollback requires repair: ${rollbackError.message}`;
  throw error;
 }
 return{granted:target.builtChannelIds?.length||0,league:target};
}
async function revokeMemberAccess(guild,userId,leagueId){
 const id=`${leagueId}:${userId}`;
 const target=registry.getLeague(leagueId);
 const op=await critical.transact(key(guild.id),{members:{}},data=>{
  const old=data.members[id];
  if(['PENDING','REPAIR_REQUIRED'].includes(old?.status))throw Error('Membership repair must finish before removal');
  if(!target&&old?.status!=='REVOKING')throw Error('Selected league is unavailable');
  data.members[id]={...old,leagueId,userId,status:'REVOKING',memberRoleId:target?.memberRoleId||old?.memberRoleId,builtChannelIds:target?.builtChannelIds||old?.builtChannelIds||[],updatedAt:Date.now()};return data.members[id];
 });
 let member=guild.members.cache.get(userId);
 if(!member&&guild.members.fetch)try{member=await guild.members.fetch(userId);}catch(e){if(e.code!==10007)throw e;}
 if(member&&op.memberRoleId)await member.roles.remove(op.memberRoleId,'League membership ended');
 for(const cid of op.builtChannelIds||[]){const ch=guild.channels.cache.get(cid);if(ch?.permissionOverwrites?.cache?.has(userId))await ch.permissionOverwrites.delete(userId);}
 await critical.transact(key(guild.id),{members:{}},data=>{data.members[id]={leagueId,userId,status:'LEFT',updatedAt:Date.now()};});
}
async function recover(guild){
 const data=await critical.read(key(guild.id),{members:{}}),out=[];
 for(const [id,op]of Object.entries(data.members)){
  if(!['PENDING','REPAIR_REQUIRED','REVOKING'].includes(op.status))continue;
  try{
   if(op.status==='REVOKING'){await revokeMemberAccess(guild,op.userId,op.leagueId);}
   else{
    let member=guild.members.cache.get(op.userId);
    if(!member)try{member=await guild.members.fetch(op.userId);}catch(e){if(e.code!==10007)throw e;}
    await compensate(guild,member,op);
    await critical.transact(key(guild.id),{members:{}},d=>{if(d.members[id]?.token===op.token)d.members[id]={leagueId:op.leagueId,userId:op.userId,status:op.previousStatus||'LEFT',updatedAt:Date.now()};});
   }
   out.push({id,repaired:true});
  }catch(e){out.push({id,repaired:false,error:e.message});}
 }
 return out;
}
async function hasMembership(guildId,userId,leagueId){const data=await critical.read(key(guildId),{members:{}});return data.members[`${leagueId}:${userId}`]?.status==='ACTIVE';}
module.exports={grantMemberAccessToLeague,revokeMemberAccess,hasMembership,recover};
