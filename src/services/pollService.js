/*
 * NAVIGATION HEADER
 * FILE: src/services/pollService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */


'use strict';

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');

const FILE = 'polls.json';

function getAll() {
  const raw = loadJson(FILE, null);
  return raw && typeof raw === 'object' ? raw : { polls: {} };
}
function saveAll(all) { saveJsonDebounced(FILE, all); }

function _buildEmbed(poll) {
  const counts = {};
  for (const key of poll.options) counts[key] = 0;
  for (const choice of Object.values(poll.votes || {})) if (counts[choice] != null) counts[choice]++;
  const lines = poll.options.map((opt, i) => `**${i+1}. ${opt}** — ${counts[opt] || 0} vote(s)`);
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('📊 Poll')
    .setDescription(`**${poll.question}**\n\n${lines.join('\n')}`)
    .setFooter({ text: 'Use the picklist below to vote. One vote per person.' })
    .setTimestamp();
}
function _buildRow(pollId, poll) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`poll_vote::${pollId}`)
      .setPlaceholder('Cast your vote...')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(poll.options.map((opt, i) => ({ label: opt.slice(0,100), value: opt, description: `Option ${i+1}` })))
  );
}

async function createPoll(guild, question, options) {
  const pollsCh = guild.channels.cache.find(c => c.isTextBased?.() && c.name === 'polls');
  if (!pollsCh) throw new Error('Polls channel not found.');
  const cleanOpts = [...new Set((options || []).map(s => String(s||'').trim()).filter(Boolean))].slice(0, 5);
  if (cleanOpts.length < 2) throw new Error('Need at least 2 poll options.');
  const all = getAll();
  const pollId = `poll_${Date.now()}`;
  const poll = { id: pollId, question: String(question || '').trim().slice(0, 300), options: cleanOpts, votes: {}, createdAt: Date.now(), channelId: pollsCh.id, messageId: null };
  const msg = await pollsCh.send({ embeds:[_buildEmbed(poll)], components:[_buildRow(pollId, poll)], allowedMentions:{ parse:[] } });
  poll.messageId = msg.id;
  all.polls[pollId] = poll;
  saveAll(all);
  return { poll, message: msg };
}

async function handleVote(interaction) {
  const pollId = String(interaction.customId || '').split('::')[1];
  const choice = interaction.values?.[0];
  const all = getAll();
  const poll = all.polls[pollId];
  if (!poll) return interaction.reply({ content:'⚠️ This poll no longer exists.', flags:64 });
  poll.votes[String(interaction.user.id)] = choice;
  all.polls[pollId] = poll;
  saveAll(all);
  const msg = interaction.message;
  await msg.edit({ embeds:[_buildEmbed(poll)], components:[_buildRow(pollId, poll)] }).catch(()=>null);
  return interaction.reply({ content:`✅ Your vote has been recorded: **${choice}**`, flags:64 });
}

module.exports = { createPoll, handleVote };
