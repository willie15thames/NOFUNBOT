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

const STREAM_RX = /https?:\/\/(www\.)?(twitch\.tv|youtube\.com\/(live|watch)|youtu\.be|kick\.com)\/\S+/i;
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

  const match = message.content?.match(STREAM_RX);
  if (!match) return false;

  const entry = [...state.players.values()].find(p => p.userId === message.author.id);
  if (!entry) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Not Registered').setDescription('Your account is not linked to a team. Use `/select-team` to claim one.')] }).catch(() => null);
    return false;
  }

  if (entry.streamLog.findIndex(s => s.msgId === message.id) !== -1) return false;

  const last = entry.streamLog[entry.streamLog.length - 1];
  if (last && (Date.now() - last.timestamp) < STREAM_COOLDOWN) {
    const rem = Math.ceil((STREAM_COOLDOWN - (Date.now() - last.timestamp)) / 60000);
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xf39c12).setTitle('⏳ Stream On Cooldown').setDescription(`You can earn another stream credit in **${rem} minute${rem !== 1 ? 's' : ''}**.`)] }).catch(() => null);
    return false;
  }

  await require('./lifetimeHistoryService').recordStat(message.guild.id,{id:`stream:${message.id}`,leagueId:entry.leagueId,userId:message.author.id,metric:'stream_credits',value:1,game:state.leagueConfig?.game||'community',seasonId:state.leagueConfig?.seasonId||'current'});
  entry.streamLog.push({ url: match[0], timestamp: Date.now(), msgId: message.id });
  entry.streamCount = entry.streamLog.length;

  await prismaSafe(prisma => prisma.streamCredit.upsert({
    where: { guildId_messageId: { guildId: String(message.guild.id), messageId: String(message.id) } },
    update: {
      userId: String(message.author.id),
      teamName: String(entry.displayTeam || ''),
      streamUrl: String(match[0] || ''),
      rewardLabel: REWARDS.find(t => t.count === entry.streamCount)?.label || null,
    },
    create: {
      guildId: String(message.guild.id),
      userId: String(message.author.id),
      teamName: String(entry.displayTeam || ''),
      streamUrl: String(match[0] || ''),
      messageId: String(message.id),
      rewardLabel: REWARDS.find(t => t.count === entry.streamCount)?.label || null,
    },
  }), null);

  const reward = REWARDS.find(t => t.count === entry.streamCount);
  if(reward)await require('./lifetimeHistoryService').award(message.guild.id,{id:`stream-award:${message.id}`,leagueId:entry.leagueId,userId:message.author.id,title:reward.label});
  const embed = new EmbedBuilder()
    .setColor(reward ? 0xf1c40f : 0x9b59b6)
    .setTitle(reward ? '🏆 Stream Logged — Reward Unlocked!' : '📺 Stream Logged')
    .addFields(
      { name: 'Player', value: `${message.author}`, inline: true },
      { name: 'Team', value: entry.displayTeam, inline: true },
      { name: 'Total Streams', value: `**${entry.streamCount}**`, inline: true },
      { name: 'Progress', value: buildProgressBar(entry.streamCount, 16), inline: false },
    )
    .setTimestamp();
  if (reward) embed.addFields({ name: `🏆 Reward — ${reward.label}`, value: `Contact commissioner to claim.\n**Bonus:** ${reward.attrBonus}` });

  await message.channel.send({ embeds: [embed] }).catch(() => null);
  if (entry.streamCount >= 16) { entry.streamLog = []; entry.streamCount = 0; }
  if (refreshRewards) await refreshRewards(message.guild).catch(() => null);
  return true;
}

module.exports = { addStreamCredit, STREAM_RX, STREAM_COOLDOWN, REWARDS };
