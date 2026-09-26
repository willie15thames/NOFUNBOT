/*
 * NAVIGATION HEADER
 * FILE: src/services/gameChannelCompatService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const weeklyAutomation = require('./weeklyAutomationService');
const { deleteAllGameChannels } = require('./gameChannelService');

const FILE = 'gameChannelConfig.json';
const DEFAULTS = {
  categoryId: null,
  adminRoleId: null,
  waitRoleId: null,
  scoreboardChannelId: null,
};

function getConfig() {
  const raw = loadJson(FILE, DEFAULTS) || {};
  return { ...DEFAULTS, ...raw };
}

function saveConfig(next) {
  const merged = { ...getConfig(), ...(next || {}) };
  saveJsonDebounced(FILE, merged, 200);
  return merged;
}

async function createFromCurrentSchedule(guild, state, players) {
  return weeklyAutomation.createChannelsForCurrentSchedule(guild, state, players);
}

async function clearCurrent(guild, reason = 'Manual clear') {
  const deleted = await deleteAllGameChannels(guild, reason).catch(() => 0);
  return { deleted };
}

async function notifyActiveGames(guild, state, note = 'Commissioner reminder: please schedule or finish this matchup.') {
  let sent = 0;
  for (const [channelId, game] of state.games.entries()) {
    if (game?.finished) continue;
    const ch = guild.channels.cache.get(channelId);
    if (!ch?.isTextBased?.()) continue;
    const mentions = [game.user1Id, game.user2Id].filter(Boolean).map(id => `<@${id}>`).join(' ');
    await ch.send(`${mentions}\n⏰ ${note}`).catch(() => null);
    sent++;
  }
  return { sent };
}

module.exports = {
  getConfig,
  saveConfig,
  createFromCurrentSchedule,
  clearCurrent,
  notifyActiveGames,
};
