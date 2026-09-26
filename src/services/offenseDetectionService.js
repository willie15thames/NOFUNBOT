/*
 * NAVIGATION HEADER
 * FILE: src/services/offenseDetectionService.js
 * LAYER: Service layer
 * PURPOSE: AI-powered auto-detection of rule violations in game channels.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for detectAndRouteOffense.
 * RELATED FLOW: messageCreate handler in index.js, game channels, warnings log.
 * NOTE: V185 — extracted from inline index.js code.
 */

'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { isAdminMember } = require('../utils/helpers');
const { findPlayerByUserId } = require('../utils/teamUtils');
const { prismaSafe } = require('../storage/prisma');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('offenseDetection');

const OFFENSE_SIGNAL_RX = /\b(quit|quitting|close app|closed app|d\/c|disconnect|rage quit|forfeit|concede|chew clock|nano blitz|exploit|glitch|dashboard|left the game|backed out|no.?show|didn.?t show|won.?t play|ghost|inactive|inactiv)\b/i;
const OFFENSE_COOLDOWN = 10 * 60 * 1000; // 10 min per user
const OFFENSE_TYPES = {
  QUIT:       { label: 'Quit/Close App',      warnField: 'closeAppWarnings' },
  GAMEPLAY:   { label: 'Gameplay Violation',   warnField: 'warnings' },
  INACTIVITY: { label: 'Inactivity',          warnField: 'inactivityWarnings' },
  CHEAT:      { label: 'Cheating',            warnField: 'warnings' },
};

/**
 * Detect potential rule violations via AI and route to commissioner review.
 * @param {Object} message - Discord message
 * @param {Object} ctx - { state, commRole, getCommissioners, getCh, aiCall, MODELS }
 */
async function detectAndRouteOffense(message, ctx) {
  const { state, commRole, getCommissioners, getCh, aiCall, MODELS } = ctx;
  if (!message.guild || !message.content || isAdminMember(message.member, commRole, getCommissioners())) return;

  const last = state.offenseCooldowns.get(message.author.id);
  if (last && Date.now() - last < OFFENSE_COOLDOWN) return;

  const text = (message.content || '').trim();
  if (!OFFENSE_SIGNAL_RX.test(text) || text.length < 5) return;

  const game = state.games.get(message.channel.id);
  const gameCtx = game ? `Game channel: ${game.team1} vs ${game.team2}, Week ${game.week}.` : 'Public channel.';

  try {
    const res = await aiCall({
      model: MODELS.FAST,
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `Madden franchise rule enforcement. Is this message ACTIVELY reporting a rule violation?\nViolations: QUIT=quit/close app mid-game, GAMEPLAY=chew clock/nano blitz/exploiting, INACTIVITY=24+ hrs no show, CHEAT=score manipulation\nContext: ${gameCtx}\nMessage: "${text.slice(0, 300)}"\nReturn ONLY raw JSON: {"offense":true,"type":"QUIT|GAMEPLAY|INACTIVITY|CHEAT","confidence":"high|medium|low","reasoning":"one sentence"} or {"offense":false}\nBe conservative — trash talk, past-tense gloating = false.`,
      }],
    });

    const raw = res.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
    const det = JSON.parse(raw);
    if (!det.offense || det.confidence === 'low') return;

    state.offenseCooldowns.set(message.author.id, Date.now());
    await prismaSafe(prisma => prisma.offenseCooldown.upsert({
      where: { guildId_userId: { guildId: String(message.guild.id), userId: String(message.author.id) } },
      update: { lastFlaggedAt: new Date() },
      create: { guildId: String(message.guild.id), userId: String(message.author.id), lastFlaggedAt: new Date() },
    }), null);

    const offInfo = OFFENSE_TYPES[det.type] || OFFENSE_TYPES.GAMEPLAY;
    const player = findPlayerByUserId(message.author.id, state.players);
    const teamName = player?.displayTeam || message.author.username;
    const offenseId = state.nextOffenseId();

    state.pendingOffenses.set(offenseId, {
      userId: message.author.id, channelId: message.channel.id, msgId: message.id,
      type: det.type, reasoning: det.reasoning, teamName, ts: Date.now(),
    });

    await prismaSafe(prisma => prisma.pendingOffense.upsert({
      where: { id: String(offenseId) },
      update: {
        guildId: String(message.guild.id), userId: String(message.author.id),
        channelId: String(message.channel.id), messageId: String(message.id),
        offenseType: String(det.type), reasoning: String(det.reasoning || ''),
        teamName: String(teamName || ''), confidence: String(det.confidence || ''),
        status: 'pending', resolvedBy: null, resolvedAt: null,
      },
      create: {
        id: String(offenseId), guildId: String(message.guild.id),
        userId: String(message.author.id), channelId: String(message.channel.id),
        messageId: String(message.id), offenseType: String(det.type),
        reasoning: String(det.reasoning || ''), teamName: String(teamName || ''),
        confidence: String(det.confidence || ''), status: 'pending',
      },
    }), null);

    const warnCh = getCh(message.guild, 'warningsLog');
    if (!warnCh) return;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`offense_warn_${offenseId}`).setLabel('⚠️ Issue Warning').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`offense_boot_${offenseId}`).setLabel('🥾 Boot Player').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`offense_dismiss_${offenseId}`).setLabel('❌ Dismiss').setStyle(ButtonStyle.Secondary),
    );

    await warnCh.send({
      content: commRole ? `<@&${commRole}> — Potential violation flagged.` : '🚨 Potential violation flagged.',
      embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('🚨 AUTO-DETECTED OFFENSE').addFields(
        { name: '🚨 Violation', value: offInfo.label, inline: true },
        { name: '📊 Confidence', value: det.confidence, inline: true },
        { name: '🆔 Offense ID', value: offenseId, inline: true },
        { name: '🤖 AI Reasoning', value: det.reasoning },
        { name: '💬 Message', value: `"${text.slice(0, 300)}"` },
        { name: '👤 Player', value: `${message.author} — ${teamName}` },
      ).setTimestamp()],
      components: [row],
      allowedMentions: commRole ? { roles: [commRole] } : {},
    }).catch(() => null);
  } catch {}
}

module.exports = { detectAndRouteOffense, OFFENSE_SIGNAL_RX, OFFENSE_COOLDOWN };
