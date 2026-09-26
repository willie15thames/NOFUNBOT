/*
 * NAVIGATION HEADER
 * FILE: src/services/broadcastsService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const FILE = 'broadcasts.json';
const DEFAULTS = {
  channelId: null,
  pingRoleId: null,
  keyword: '',
  youtube: [],
  twitch: [],
  notes: 'Auto-live polling needs provider credentials or feed support; this build stores and manages sources safely.',
};

function getConfig() {
  const raw = loadJson(FILE, DEFAULTS) || {};
  return {
    ...DEFAULTS,
    ...raw,
    youtube: Array.isArray(raw.youtube) ? raw.youtube : [],
    twitch: Array.isArray(raw.twitch) ? raw.twitch : [],
  };
}

function saveConfig(next) {
  const merged = { ...getConfig(), ...(next || {}) };
  saveJsonDebounced(FILE, merged, 200);
  return merged;
}

function addSource(type, value) {
  const cfg = getConfig();
  const key = type === 'twitch' ? 'twitch' : 'youtube';
  const clean = String(value || '').trim();
  if (!clean) return cfg;
  if (!cfg[key].includes(clean)) cfg[key].push(clean);
  return saveConfig(cfg);
}

function removeSource(type, value) {
  const cfg = getConfig();
  const key = type === 'twitch' ? 'twitch' : 'youtube';
  const clean = String(value || '').trim();
  cfg[key] = cfg[key].filter(v => String(v) !== clean);
  return saveConfig(cfg);
}

function recordBroadcast(guildId, content, authorId) {
  const config = getConfig();
  if (!Array.isArray(config.history)) config.history = [];
  config.history.push({ guildId, content: String(content).slice(0, 500), authorId, ts: Date.now() });
  if (config.history.length > 100) config.history.splice(0, config.history.length - 100);
  saveConfig(config);
}

module.exports = {
  getConfig,
  saveConfig,
  addSource,
  removeSource,
  recordBroadcast,
};
