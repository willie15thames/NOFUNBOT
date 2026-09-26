/*
 * NAVIGATION HEADER
 * FILE: src/services/componentRegistryService.js
 * LAYER: Service layer
 * PURPOSE: Central registry for optional interactive bot components. Each component gets:
 *          - A toggle (enabled/disabled via /toggle-feature)
 *          - An optional dedicated channel (read-only for members, interaction-only)
 *          - Persistent data storage keyed by component ID
 *          - A flow definition in flowDefinitions.js
 * LOOK HERE FIRST WHEN DEBUGGING: Search for COMPONENT_CATALOG, enableComponent, disableComponent.
 * RELATED FLOW: interactionRouter.js (component interaction handlers), flowDefinitions.js (component flows).
 * NOTE: V195 — introduced as part of optional feature system.
 */

'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { loadJson, saveJsonDebounced, saveJson } = require('../storage/jsonStore');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('components');

const FILE = 'componentRegistry.json';

// ── Component Catalog ───────────────────────────────────────────
// Every optional feature the bot can run. Add new components here.
// channelName: null means component doesn't need its own channel (uses existing)

const COMPONENT_CATALOG = {
  'active-check': {
    id: 'active-check',
    name: 'Active Check',
    description: 'Periodic roll call for league members. 5 consecutive misses = auto-boot.',
    channelName: null, // Uses per-league channels via leagueFeatureService
    category: 'league',
    defaultEnabled: false,
  },
  'polls': {
    id: 'polls',
    name: 'Polls & Voting',
    description: 'Community polls with select-menu voting. Members vote via interaction only.',
    channelName: 'polls',
    category: 'community',
    defaultEnabled: true,
  },
  'mvp-voting': {
    id: 'mvp-voting',
    name: 'MVP Voting',
    description: 'Weekly MVP vote. Members select their pick via dropdown. Results tallied automatically.',
    channelName: 'mvp-voting',
    category: 'league',
    defaultEnabled: false,
  },
  'availability': {
    id: 'availability',
    name: 'Availability Tracker',
    description: 'Members post their weekly availability via buttons. Commissioners see the board.',
    channelName: 'availability',
    category: 'league',
    defaultEnabled: false,
  },
  'rule-ack': {
    id: 'rule-ack',
    name: 'Rule Acknowledgment',
    description: 'Members must click Acknowledge to confirm they read the rules before full access.',
    channelName: null, // Posts in #rules channel
    category: 'server',
    defaultEnabled: false,
  },
  'trade-block': {
    id: 'trade-block',
    name: 'Trade Block',
    description: 'Members post players they want to trade via select menu. Auto-updates the board.',
    channelName: 'trade-block',
    category: 'league',
    defaultEnabled: false,
  },
  'game-results': {
    id: 'game-results',
    name: 'Game Result Submission',
    description: 'Members submit game scores via button + modal. Auto-logs to results channel.',
    channelName: 'game-results',
    category: 'league',
    defaultEnabled: false,
  },
  'predictions': {
    id: 'predictions',
    name: 'Weekly Predictions',
    description: 'Members predict game outcomes each week via select menu. Leaderboard tracked.',
    channelName: 'predictions',
    category: 'league',
    defaultEnabled: false,
  },
  'rewards': {
    id: 'rewards',
    name: 'Reward Boards',
    description: 'POTW, streams, yearly awards, superbowl, and stat leader boards.',
    channelName: 'rewards',
    category: 'league',
    defaultEnabled: false,
  },
  'streams': {
    id: 'streams',
    name: 'Stream Credits',
    description: 'Track livestream credits. Members post stream links, commissioner verifies.',
    channelName: 'livestreams',
    category: 'league',
    defaultEnabled: false,
  },
  'schedule': {
    id: 'schedule',
    name: 'Weekly Schedule',
    description: 'Weekly matchup schedule posting and game channel automation.',
    channelName: 'weekly-schedule',
    category: 'league',
    defaultEnabled: false,
  },
  'transactions': {
    id: 'transactions',
    name: 'Transaction Log',
    description: 'Trades, FA signings, draft picks, and roster moves logged to a dedicated channel.',
    channelName: 'transactions',
    category: 'league',
    defaultEnabled: false,
  },
};

// ── State ───────────────────────────────────────────────────────

function _load() {
  const raw = loadJson(FILE, null);
  return raw && typeof raw === 'object' ? raw : { enabled: {}, data: {}, channels: {} };
}

function _save(state) {
  saveJsonDebounced(FILE, state, 300);
}

// ── Enable / Disable ────────────────────────────────────────────

function isEnabled(componentId) {
  const state = _load();
  if (state.enabled[componentId] !== undefined) return !!state.enabled[componentId];
  const catalog = COMPONENT_CATALOG[componentId];
  return catalog ? catalog.defaultEnabled : false;
}

function enableComponent(componentId) {
  const state = _load();
  state.enabled[componentId] = true;
  _save(state);
  log.info(`Component enabled: ${componentId}`);
  return true;
}

function disableComponent(componentId) {
  const state = _load();
  state.enabled[componentId] = false;
  _save(state);
  log.info(`Component disabled: ${componentId}`);
  return true;
}

function listEnabled() {
  return Object.keys(COMPONENT_CATALOG).filter(id => isEnabled(id));
}

function listAll() {
  return Object.values(COMPONENT_CATALOG).map(c => ({
    ...c,
    enabled: isEnabled(c.id),
  }));
}

function getByCategory(category) {
  return Object.values(COMPONENT_CATALOG)
    .filter(c => c.category === category)
    .map(c => ({ ...c, enabled: isEnabled(c.id) }));
}

// ── Channel Provisioning ────────────────────────────────────────

/**
 * Ensure a component's dedicated channel exists. Creates if missing.
 * Channel is read-only for members (interaction-only).
 */
async function ensureComponentChannel(guild, componentId) {
  const catalog = COMPONENT_CATALOG[componentId];
  if (!catalog || !catalog.channelName) return null;

  const existing = guild.channels.cache.find(c =>
    c.isTextBased?.() && String(c.name || '').toLowerCase() === catalog.channelName
  );
  if (existing) return existing;

  // Find or create parent category
  let parent = guild.channels.cache.find(c =>
    c.type === ChannelType.GuildCategory && /community|league|gameplay/i.test(String(c.name || ''))
  );

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
      ],
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];
  if (guild.members?.me?.id) {
    overwrites.push({
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const ch = await guild.channels.create({
    name: catalog.channelName,
    type: ChannelType.GuildText,
    parent: parent?.id || undefined,
    topic: `${catalog.name} — interact using buttons and menus below. No text chat.`,
    permissionOverwrites: overwrites,
  }).catch(e => {
    log.error(`Failed to create channel for ${componentId}: ${e.message}`);
    return null;
  });

  if (ch) {
    const state = _load();
    state.channels[componentId] = ch.id;
    _save(state);
  }
  return ch;
}

/**
 * Get the channel for a component (from cache or registry).
 */
function getComponentChannel(guild, componentId) {
  const state = _load();
  const chId = state.channels[componentId];
  if (chId) {
    const ch = guild.channels.cache.get(chId);
    if (ch) return ch;
  }
  const catalog = COMPONENT_CATALOG[componentId];
  if (!catalog?.channelName) return null;
  return guild.channels.cache.find(c =>
    c.isTextBased?.() && String(c.name || '').toLowerCase() === catalog.channelName
  ) || null;
}

// ── Component Data Storage ──────────────────────────────────────

function getData(componentId, key = 'default') {
  const state = _load();
  if (!state.data[componentId]) return null;
  return state.data[componentId][key] || null;
}

function setData(componentId, key, value) {
  const state = _load();
  if (!state.data[componentId]) state.data[componentId] = {};
  state.data[componentId][key] = value;
  _save(state);
}

function clearData(componentId) {
  const state = _load();
  delete state.data[componentId];
  _save(state);
}

// ── MVP Voting ──────────────────────────────────────────────────

function recordMvpVote(week, oderId, nomineeUserId) {
  const key = `week_${week}`;
  const votes = getData('mvp-voting', key) || {};
  votes[oderId] = nomineeUserId;
  setData('mvp-voting', key, votes);
}

function getMvpResults(week) {
  const votes = getData('mvp-voting', `week_${week}`) || {};
  const tally = {};
  for (const nominee of Object.values(votes)) {
    tally[nominee] = (tally[nominee] || 0) + 1;
  }
  return Object.entries(tally)
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count);
}

// ── Availability Tracker ────────────────────────────────────────

function recordAvailability(userId, week, status) {
  const key = `week_${week}`;
  const avail = getData('availability', key) || {};
  avail[userId] = { status, updatedAt: Date.now() };
  setData('availability', key, avail);
}

function getAvailability(week) {
  return getData('availability', `week_${week}`) || {};
}

// ── Rule Acknowledgment ─────────────────────────────────────────

function recordRuleAck(userId) {
  const acks = getData('rule-ack', 'acknowledged') || {};
  acks[userId] = Date.now();
  setData('rule-ack', 'acknowledged', acks);
}

function hasAcknowledgedRules(userId) {
  const acks = getData('rule-ack', 'acknowledged') || {};
  return !!acks[userId];
}

function getRuleAckCount() {
  const acks = getData('rule-ack', 'acknowledged') || {};
  return Object.keys(acks).length;
}

// ── Trade Block ─────────────────────────────────────────────────

function updateTradeBlock(userId, players) {
  const blocks = getData('trade-block', 'blocks') || {};
  blocks[userId] = { players: Array.isArray(players) ? players.slice(0, 10) : [], updatedAt: Date.now() };
  setData('trade-block', 'blocks', blocks);
}

function getTradeBlock(userId) {
  const blocks = getData('trade-block', 'blocks') || {};
  return blocks[userId] || null;
}

function getAllTradeBlocks() {
  return getData('trade-block', 'blocks') || {};
}

// ── Game Result Submission ──────────────────────────────────────

function recordGameResult(submitterId, result) {
  const results = getData('game-results', 'submissions') || [];
  results.push({ ...result, submitterId, submittedAt: Date.now() });
  if (results.length > 500) results.splice(0, results.length - 500);
  setData('game-results', 'submissions', results);
}

function getGameResults(week) {
  const results = getData('game-results', 'submissions') || [];
  if (!week) return results;
  return results.filter(r => String(r.week) === String(week));
}

// ── Weekly Predictions ──────────────────────────────────────────

function recordPrediction(userId, week, matchupId, pick) {
  const key = `week_${week}`;
  const preds = getData('predictions', key) || {};
  if (!preds[userId]) preds[userId] = {};
  preds[userId][matchupId] = pick;
  setData('predictions', key, preds);
}

function getPredictions(week) {
  return getData('predictions', `week_${week}`) || {};
}

function scorePredictions(week, actualResults) {
  const preds = getPredictions(week);
  const scores = {};
  for (const [userId, picks] of Object.entries(preds)) {
    let correct = 0;
    for (const [matchupId, pick] of Object.entries(picks)) {
      if (actualResults[matchupId] === pick) correct++;
    }
    scores[userId] = correct;
  }
  return Object.entries(scores)
    .map(([userId, correct]) => ({ userId, correct }))
    .sort((a, b) => b.correct - a.correct);
}

// ── Component Embed Builders ────────────────────────────────────

function buildMvpVotingEmbed(week, players) {
  const results = getMvpResults(week);
  const lines = results.length
    ? results.slice(0, 10).map((r, i) => `**${i + 1}.** <@${r.userId}> — ${r.count} vote${r.count !== 1 ? 's' : ''}`)
    : ['No votes yet. Use the dropdown below to cast your vote.'];
  return new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`🏆 MVP Vote — Week ${week}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'One vote per member. Change your vote anytime.' })
    .setTimestamp();
}

function buildAvailabilityEmbed(week, guildMembers) {
  const avail = getAvailability(week);
  const statusIcons = { available: '🟢', limited: '🟡', unavailable: '🔴' };
  const entries = Object.entries(avail);
  const lines = entries.length
    ? entries.map(([uid, data]) => `${statusIcons[data.status] || '⚪'} <@${uid}> — **${data.status}**`)
    : ['No responses yet. Use the buttons below to set your availability.'];
  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📅 Availability — Week ${week}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Update anytime during the week.' })
    .setTimestamp();
}

function buildAvailabilityButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('comp_avail::available').setLabel('🟢 Available').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('comp_avail::limited').setLabel('🟡 Limited').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('comp_avail::unavailable').setLabel('🔴 Unavailable').setStyle(ButtonStyle.Danger),
  );
}

function buildRuleAckButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('comp_rule_ack').setLabel('✅ I Acknowledge the Rules').setStyle(ButtonStyle.Success),
  );
}

function buildPredictionBoard(week, predictions, matchups) {
  const preds = predictions || getPredictions(week);
  const totalVoters = Object.keys(preds).length;
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`🔮 Predictions — Week ${week}`)
    .setDescription(totalVoters ? `**${totalVoters}** member${totalVoters !== 1 ? 's' : ''} have submitted predictions.` : 'No predictions yet. Use the dropdown below to pick winners.')
    .setFooter({ text: 'Predictions lock when the week advances.' })
    .setTimestamp();
}

// ── Guard: check if component is enabled before processing ──────

function guardEnabled(componentId) {
  if (!isEnabled(componentId)) {
    return { blocked: true, message: `⚠️ The **${COMPONENT_CATALOG[componentId]?.name || componentId}** feature is not enabled. A commissioner can enable it with \`/toggle-feature\`.` };
  }
  return { blocked: false };
}

module.exports = {
  COMPONENT_CATALOG,
  isEnabled,
  enableComponent,
  disableComponent,
  listEnabled,
  listAll,
  getByCategory,
  ensureComponentChannel,
  getComponentChannel,
  getData,
  setData,
  clearData,
  guardEnabled,
  // MVP
  recordMvpVote,
  getMvpResults,
  buildMvpVotingEmbed,
  // Availability
  recordAvailability,
  getAvailability,
  buildAvailabilityEmbed,
  buildAvailabilityButtons,
  // Rule Ack
  recordRuleAck,
  hasAcknowledgedRules,
  getRuleAckCount,
  buildRuleAckButton,
  // Trade Block
  updateTradeBlock,
  getTradeBlock,
  getAllTradeBlocks,
  // Game Results
  recordGameResult,
  getGameResults,
  // Predictions
  recordPrediction,
  getPredictions,
  scorePredictions,
  buildPredictionBoard,
};
