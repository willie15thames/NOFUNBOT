'use strict';
const {ChannelType,PermissionFlagsBits:P}=require('discord.js');
const spaces=require('./managedSpaceService');
const registry=require('./activeLeagueService');
async function create(guild,{name,description='',commissionerRoleId=null}){
  const slot=await spaces.reserve(guild.id,{kind:'event',name});
  const created=[];let role;
  try{
    role=await guild.roles.create(require('./spaceRoleService').membershipRoleOptions('event',name,slot.id));
    await spaces.transition(guild.id,slot.id,'PREPARING',{memberRoleId:role.id});
    const perms=[{id:guild.roles.everyone.id,deny:[P.ViewChannel]},{id:role.id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory]},{id:guild.members.me.id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.ManageChannels]}];
    if(commissionerRoleId)perms.push({id:commissionerRoleId,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.ManageChannels]});
    const cat=await guild.channels.create({name:`Event ${slot.id.slice(0,8)} ${name}`.slice(0,100),type:ChannelType.GuildCategory,permissionOverwrites:perms});created.push(cat);
    await spaces.transition(guild.id,slot.id,'PREPARING',{builtCategoryIds:[cat.id]});
    const ch=await guild.channels.create({name:`event-${slot.id.slice(0,8)}`,type:ChannelType.GuildText,parent:cat.id,topic:description.slice(0,1024)||name,permissionOverwrites:perms});created.push(ch);
    const record={id:slot.id,guildId:guild.id,kind:'event',leagueTypeId:'event',leagueName:name,memberRoleId:role.id,builtCategoryIds:[cat.id],builtChannelIds:[ch.id],description,status:'ACTIVE'};
    await spaces.transition(guild.id,slot.id,'ACTIVE',record);
    await require('./lifetimeHistoryService').archiveCompetition(guild.id,record);
    registry.upsertLeague(record);
    return record;
  }catch(err){
    registry.removeLeague(slot.id);
    const failures=[];for(const ch of created.reverse()){try{await ch.delete('Failed event build');}catch(e){failures.push(e.message);}}
    if(role){try{await role.delete('Failed event build');}catch(e){failures.push(e.message);}}
    await spaces.transition(guild.id,slot.id,failures.length?'REPAIR_REQUIRED':'ARCHIVED',{error:err.message,rollbackErrors:failures});throw err;
  }
}
module.exports={create};
