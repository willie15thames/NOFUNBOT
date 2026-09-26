/*
 * NAVIGATION HEADER
 * FILE: src/services/channels/channelResolver.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const { CHANNEL_KEYS, REQUIRED_CHANNELS } = require('../../config/channels');
const { loadJson } = require('../../storage/jsonStore');
const { makeLogger } = require('../../utils/logger');
const { matchesConfiguredChannel } = require('../channelTopologyService');
const log = makeLogger('channels');
const _reg = {};

async function resolveAllChannels(guild) {
  await guild.channels.fetch();
  // MED-05 FIX: use EXACT match for startup resolution to prevent "welcome-archive"
  // matching the "welcome" key. includes:true is only for fuzzy search helpers.
  for (const key of Object.keys(CHANNEL_KEYS)) {
    const found = guild.channels.cache.find(channel => channel.isTextBased?.() && matchesConfiguredChannel(channel, key, { includes: false }));
    _reg[key] = found?.id || null;
  }
  const activeLeagues = loadJson('activeLeagues.json', {}) || {};
  const leagueConfig = loadJson('leagueConfig.json', {}) || {};
  const hasActiveLeague = Object.keys(activeLeagues).length > 0 || !!leagueConfig.leagueTypeId;
  const required = hasActiveLeague ? REQUIRED_CHANNELS : ['welcome','rules','announcements','serverGuide','activeCheck','warningsLog','bootLog','commAI','adminHq','commishHub','scoresheets'];
  const missing = required.filter(key => !_reg[key]);
  if (missing.length) {
    log.warn(`MISSING CHANNELS (${missing.length}):`);
    missing.forEach(key => log.warn(`  • ${key}  (needs "${CHANNEL_KEYS[key]}" in name)`));
  } else {
    log.info('All required channels resolved ✅');
  }
  for (const [key, id] of Object.entries(_reg)) if (id) log.info(`  ${key.padEnd(18)} → #${guild.channels.cache.get(id)?.name}`);
}

function getCh(guild, key) {
  const id = _reg[key];
  if (!id) return null;
  return guild.channels.cache.get(id) || null;
}

function invalidateChannel(guild, channelId) {
  for (const [key, id] of Object.entries(_reg)) {
    if (id !== channelId) continue;
    const found = guild.channels.cache.find(channel => channel.isTextBased?.() && matchesConfiguredChannel(channel, key, { includes: true }));
    _reg[key] = found?.id || null;
  }
}

function getChannelByNameIncludes(guild, piece) {
  if (!piece) return null;
  const needle = String(piece).toLowerCase().replace(/[^a-z0-9\-]/gi, '');
  return guild.channels.cache.find(channel => {
    if (!channel.isTextBased?.()) return false;
    const clean = String(channel.name || '').replace(/[^a-z0-9\-]/gi, '').toLowerCase();
    return clean.includes(needle) || needle.includes(clean);
  }) || null;
}

module.exports = { resolveAllChannels, getCh, invalidateChannel, getChannelByNameIncludes };
