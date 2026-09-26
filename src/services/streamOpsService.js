/*
 * NAVIGATION HEADER
 * FILE: src/services/streamOpsService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const FILE = 'streamOps.json';
const DEFAULTS = {
  channelId: null,
  pingRoleId: null,
  enabled: true,
};

function getConfig() {
  const raw = loadJson(FILE, DEFAULTS) || {};
  return { ...DEFAULTS, ...raw, enabled: raw.enabled !== false };
}

function saveConfig(next) {
  const merged = { ...getConfig(), ...(next || {}) };
  saveJsonDebounced(FILE, merged, 200);
  return merged;
}

function _findPlayerByAny(state, teamOrUser) {
  const raw = String(teamOrUser || '').trim().toLowerCase();
  return [...state.players.values()].find(p =>
    String(p.userId || '').toLowerCase() === raw ||
    String(p.baseTeam || '').toLowerCase() === raw ||
    String(p.displayTeam || '').toLowerCase() === raw
  ) || null;
}

function addCount(state, teamOrUser, url = '') {
  const player = _findPlayerByAny(state, teamOrUser);
  if (!player) return null;
  player.streamLog = Array.isArray(player.streamLog) ? player.streamLog : [];
  player.streamLog.push({ timestamp: Date.now(), url: String(url || '').trim(), manual: true });
  player.streamCount = player.streamLog.length;
  return player;
}

function removeCount(state, teamOrUser) {
  const player = _findPlayerByAny(state, teamOrUser);
  if (!player) return null;
  player.streamLog = Array.isArray(player.streamLog) ? player.streamLog : [];
  if (player.streamLog.length) player.streamLog.pop();
  player.streamCount = player.streamLog.length;
  return player;
}

function resetAll(state) {
  let count = 0;
  for (const player of state.players.values()) {
    player.streamLog = [];
    player.streamCount = 0;
    count++;
  }
  return count;
}

module.exports = {
  getConfig,
  saveConfig,
  addCount,
  removeCount,
  resetAll,
};
