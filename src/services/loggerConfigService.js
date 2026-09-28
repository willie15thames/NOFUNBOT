/*
 * NAVIGATION HEADER
 * FILE: src/services/loggerConfigService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const { redactString } = require('../utils/redact');
const FILE = 'loggerConfig.json';
const DEFAULTS = {
  enabled: false,
  channelId: null,
};

function getConfig() {
  const raw = loadJson(FILE, DEFAULTS) || {};
  return { ...DEFAULTS, ...raw, enabled: !!raw.enabled, channelId: raw.channelId || null };
}

function saveConfig(next) {
  const merged = { ...getConfig(), ...(next || {}) };
  saveJsonDebounced(FILE, merged, 200);
  return merged;
}

async function logToConfiguredChannel(guild, text) {
  const cfg = getConfig();
  if (!cfg.enabled || !cfg.channelId || !guild) return false;
  const ch = guild.channels.cache.get(cfg.channelId) || await guild.channels.fetch(cfg.channelId).catch(() => null);
  if (!ch?.isTextBased?.()) return false;
  await ch.send(redactString(text, 1900)).catch(() => null);
  return true;
}

module.exports = {
  getConfig,
  saveConfig,
  logToConfiguredChannel,
};
