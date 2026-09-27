'use strict';
const registry = require('./activeLeagueService');
const critical = require('../storage/criticalStore');
const key = guildId => `v204:memberships:${guildId}`;
function staffOnly(ch) { return /admin|commissioner|commish|scoresheets|staff/i.test(`${ch.name} ${ch.parent?.name || ''}`); }
async function grantMemberAccessToLeague(guild, member, state, leagueId) {
  const target = registry.getLeague(leagueId);
  if (target?.status && target.status !== 'ACTIVE') throw new Error('This space is not accepting members');
  if (!target || (target.guildId && target.guildId !== guild.id)) throw new Error('Selected league is unavailable');
  if (target.memberRoleId) await member.roles.add(target.memberRoleId, 'League membership');
  else {
    // Legacy leagues are migrated to private overwrites before a membership is acknowledged.
    for (const id of target.builtChannelIds || []) {
      const ch=guild.channels.cache.get(id);if(!ch)throw new Error(`Missing league channel ${id}`);
      await ch.permissionOverwrites.edit(guild.roles.everyone.id,{ViewChannel:false});
      if(!staffOnly(ch))await ch.permissionOverwrites.edit(member.id,{ViewChannel:true,ReadMessageHistory:true,SendMessages:!/(rules|announcements|server-guide|open-teams)$/.test(ch.name)});
    }
  }
  await critical.transact(key(guild.id),{members:{}},data=>{data.members[`${leagueId}:${member.id}`]={leagueId,userId:member.id,status:'ACTIVE',updatedAt:Date.now()};});
  return {granted:target.builtChannelIds?.length||0,league:target};
}
async function revokeMemberAccess(guild,userId,leagueId) {
  const target=registry.getLeague(leagueId);if(!target)return;
  let member=guild.members.cache.get(userId);
  if(!member && guild.members.fetch) {try{member=await guild.members.fetch(userId);}catch(err){if(err.code!==10007)throw err;}}
  if(member && target.memberRoleId)await member.roles.remove(target.memberRoleId,'League membership ended');
  for(const id of target.builtChannelIds||[]){const ch=guild.channels.cache.get(id);if(ch?.permissionOverwrites?.cache?.has(userId))await ch.permissionOverwrites.delete(userId);}
  await critical.transact(key(guild.id),{members:{}},data=>{data.members[`${leagueId}:${userId}`]={leagueId,userId,status:'LEFT',updatedAt:Date.now()};});
}
async function hasMembership(guildId,userId,leagueId){const data=await critical.read(key(guildId),{members:{}});return data.members[`${leagueId}:${userId}`]?.status==='ACTIVE';}
module.exports={grantMemberAccessToLeague,revokeMemberAccess,hasMembership};
