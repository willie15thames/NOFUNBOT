/*
 * NAVIGATION HEADER
 * FILE: src/services/statusCardService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { EmbedBuilder } = require('discord.js');
const sendMessageService = require('./sendMessageService');

function colorFor(status) {
  switch (String(status || '').toLowerCase()) {
    case 'running': return 0x5865f2;
    case 'completed': return 0x57f287;
    case 'failed': return 0xed4245;
    case 'queued': return 0xfee75c;
    default: return 0x99aab5;
  }
}

function buildStatusEmbed({ title, status, summary, fields = [], footer }) {
  const embed = new EmbedBuilder()
    .setColor(colorFor(status))
    .setTitle(title || 'Status')
    .setDescription(summary || 'No summary provided.')
    .setTimestamp();
  if (fields?.length) embed.addFields(fields.slice(0, 10));
  if (footer) embed.setFooter({ text: String(footer).slice(0, 200) });
  return embed;
}

async function findReusableStatusCard(channel, opts = {}) {
  if (!channel?.messages?.fetch) return null;
  const recent = await channel.messages.fetch({ limit: 15 }).catch(() => null);
  if (!recent) return null;
  const title = String(opts.title || '').trim();
  return [...recent.values()].find(m => m.author?.id === channel.guild?.members?.me?.id && String(m.embeds?.[0]?.title || '').trim() === title) || null;
}

async function createStatusCard(channel, opts) {
  if (!channel?.send) return null;
  if (String(channel?.name || '').toLowerCase() === 'setup-wizard') return null;
  const reusable = await findReusableStatusCard(channel, opts).catch(() => null);
  if (reusable?.edit) {
    await reusable.edit(sendMessageService.sanitizePayload({ embeds: [buildStatusEmbed(opts)] })).catch(() => null);
    return reusable;
  }
  const result = await sendMessageService.send(channel, { embeds: [buildStatusEmbed(opts)] }, { action: 'status-card', dedupeKey: String(opts?.title || 'status-card') });
  return result.message || null;
}

async function updateStatusCard(message, opts) {
  if (!message?.edit) return null;
  return message.edit(sendMessageService.sanitizePayload({ embeds: [buildStatusEmbed(opts)] })).catch(() => null);
}

module.exports = { buildStatusEmbed, findReusableStatusCard, createStatusCard, updateStatusCard };
