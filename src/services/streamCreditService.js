/*
 * NAVIGATION HEADER
 * FILE: src/services/streamCreditService.js
 * LAYER: Service layer
 * PURPOSE: Stream credit tracking, cooldown, reward unlocks, DB persistence.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for addStreamCredit.
 * RELATED FLOW: messageCreate handler in index.js, livestreams channel.
 * NOTE: V185 — extracted from inline index.js code.
 */

'use strict';

const { EmbedBuilder } = require('discord.js');
const { buildProgressBar } = require('../utils/helpers');
const { prismaSafe } = require('../storage/prisma');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('streamCredit');

const STREAM_RX = /https?:\/\/(?:www\.)?(?:twitch\.tv\/|youtube\.com\/(?:live\/|watch\?(?:[^\s]*&)?v=)|youtu\.be\/|kick\.com\/)\S+/i;
function parseStreamUrl(text){
  const candidate=String(text||'').match(STREAM_RX)?.[0]?.replace(/[).,>\]]+$/,'');
  if(!candidate)return null;
  try{
    const url=new URL(candidate),host=url.hostname.toLowerCase().replace(/^www\./,'');
    if(url.username||url.password||url.port)return null;
    const parts=url.pathname.split('/').filter(Boolean);
    if(host==='youtube.com'){
      const id=url.pathname==='/watch'?url.searchParams.get('v'):(parts[0]==='live'?parts[1]:null);
      if(!id||!/^[A-Za-z0-9_-]+$/.test(id))return null;
    }else if(host==='youtu.be'){
      if(parts.length!==1||!/^[A-Za-z0-9_-]+$/.test(parts[0]))return null;
    }else if(!['twitch.tv','kick.com'].includes(host)||!parts.length)return null;
    return url.toString();
  }catch{return null;}
}
const STREAM_COOLDOWN = 60 * 60 * 1000; // 1 hour
const REWARDS = [
  { count: 8,  label: 'Superstar Dev Trait', devTrait: 'Superstar', attrBonus: '+2 non-physical attribute' },
  { count: 16, label: 'Dev Upgrade or Age Reset', devTrait: 'Xfactor', attrBonus: '+2 non-physical attribute' },
];

/**
 * Process a message for stream credit.
 * @param {Object} message - Discord message
 * @param {Object} ctx - { state, getCh, refreshRewards }
 * @returns {boolean} true if a stream credit was processed
 */
async function addStreamCredit(message, ctx) {
  const { state, getCh, refreshRewards } = ctx;
  const lsCh = getCh(message.guild, 'livestreams');
  if (!lsCh || message.channel.id !== lsCh.id) return false;

  const streamUrl = parseStreamUrl(message.content);
  if (!streamUrl) return false;

  const entry = [...state.players.values()].find(p => p.userId === message.author.id);
  if (!entry) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Not Registered').setDescription('Your account is not linked to a team. Use `/select-team` to claim one.')] }).catch(() => null);
    return false;
  }

  entry.streamLog=Array.isArray(entry.streamLog)?entry.streamLog:[];
  const last=entry.streamLog[entry.streamLog.length-1];
  const credit=await require('./lifetimeHistoryService').creditStream(message.guild.id,{messageId:message.id,userId:message.author.id,leagueId:entry.leagueId,game:state.leagueConfig?.game||'community',seasonId:state.leagueConfig?.seasonId||'current',cooldown:STREAM_COOLDOWN,rewards:REWARDS},{count:entry.streamCount,lastCreditAt:entry.lastStreamCreditAt||last?.timestamp||0});
  if(!credit.ok){
    if(credit.reason==='cooldown')await message.reply({content:`Stream credit is on cooldown for ${Math.ceil(credit.remainingMs/60000)} more minute(s).`}).catch(()=>null);
    return false;
  }
  entry.streamLog.push({url:streamUrl,timestamp:credit.lastCreditAt,msgId:message.id});
  entry.streamLog=entry.streamLog.slice(-16);entry.lastStreamCreditAt=credit.lastCreditAt;entry.streamCount=credit.nextCount;
  require('../storage/jsonStore').saveJsonDebounced('players.json',[...state.players].map(([key,player])=>({key,...player})));

  await prismaSafe(prisma => prisma.streamCredit.upsert({
    where: { guildId_messageId: { guildId: String(message.guild.id), messageId: String(message.id) } },
    update: {
      userId: String(message.author.id),
      teamName: String(entry.displayTeam || ''),
      streamUrl: String(streamUrl || ''),
      rewardLabel: credit.reward?.label || null,
    },
    create: {
      guildId: String(message.guild.id),
      userId: String(message.author.id),
      teamName: String(entry.displayTeam || ''),
      streamUrl: String(streamUrl || ''),
      messageId: String(message.id),
      rewardLabel: credit.reward?.label || null,
    },
  }), null);

  const reward=credit.reward;
  const embed = new EmbedBuilder()
    .setColor(reward ? 0xf1c40f : 0x9b59b6)
    .setTitle(reward ? '🏆 Stream Logged — Reward Unlocked!' : '📺 Stream Logged')
    .addFields(
      { name: 'Player', value: `${message.author}`, inline: true },
      { name: 'Team', value: entry.displayTeam, inline: true },
      { name: 'Total Streams', value: `**${credit.count}**`, inline: true },
      { name: 'Progress', value: buildProgressBar(credit.count, 16), inline: false },
    )
    .setTimestamp();
  if (reward) embed.addFields({ name: `🏆 Reward — ${reward.label}`, value: `Contact commissioner to claim.\n**Bonus:** ${reward.attrBonus}` });

  await message.channel.send({ embeds: [embed] }).catch(() => null);

  if (refreshRewards) await refreshRewards(message.guild).catch(() => null);
  return true;
}

module.exports = { addStreamCredit, parseStreamUrl, STREAM_RX, STREAM_COOLDOWN, REWARDS };
