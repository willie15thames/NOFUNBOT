/*
 * NAVIGATION HEADER
 * FILE: src/services/spamService.js
 * LAYER: Service layer
 * PURPOSE: Spam detection, strike tracking, muting, and ban escalation.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for handleSpam.
 * RELATED FLOW: messageCreate handler in index.js.
 * NOTE: V185 — extracted from inline index.js code.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const { isAdminMember, canBotModerate } = require('../utils/helpers');
const log = makeLogger('spam');

const SPAM_WINDOW = 5000;
const SPAM_LIMIT  = 7;
const SPAM_MUTE   = 10 * 60 * 1000;
const SPAM_BAN    = 3;

/**
 * Check a message for spam and escalate if needed.
 * @param {Object} message - Discord message
 * @param {Object} ctx - { state, commRole, getCommissioners, getCh }
 * @returns {boolean} true if the message was spam (caller should stop processing)
 */
async function handleSpam(message, ctx) {
  const { author, member, guild, channel } = message;
  const { state, commRole, getCommissioners, getCh } = ctx;
  if (!member || !guild) return false;
  if (isAdminMember(member, commRole, getCommissioners())) return false;

  const now = Date.now();
  if (!state.spamTracker.has(author.id)) {
    state.spamTracker.set(author.id, { timestamps: [], strikes: 0 });
  }
  const d = state.spamTracker.get(author.id);
  d.timestamps = d.timestamps.filter(t => now - t < SPAM_WINDOW);
  d.timestamps.push(now);
  if (d.timestamps.length < SPAM_LIMIT) return false;

  d.timestamps = [];
  d.strikes++;

  // Delete recent messages from the spammer
  try {
    const r = await channel.messages.fetch({ limit: 20 });
    for (const [, m] of r.filter(m => m.author.id === author.id)) {
      await m.delete().catch(() => null);
    }
  } catch {}

  const logCh = getCh(guild, 'bootLog');

  if (d.strikes >= SPAM_BAN) {
    const banOk = await guild.members.ban(author.id, { reason: 'Spam — repeated' })
      .then(() => true).catch(() => false);
    if (banOk) {
      state.spamTracker.delete(author.id);
      if (logCh) await logCh.send(`🔨 **${author.tag}** banned for repeated spam.`).catch(() => null);
    } else {
      if (logCh) await logCh.send(`⚠️ **${author.tag}** spam ban FAILED (missing permissions?). Strike count preserved.`).catch(() => null);
    }
    return true;
  }

  if (canBotModerate(member)) await member.timeout(SPAM_MUTE, 'Spam').catch(() => null);
  if (logCh) await logCh.send(`⚠️ **${author.tag}** spam strike ${d.strikes}/${SPAM_BAN}.`).catch(() => null);
  return true;
}

module.exports = { handleSpam, SPAM_WINDOW, SPAM_LIMIT, SPAM_MUTE, SPAM_BAN };
