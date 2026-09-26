/*
 * NAVIGATION HEADER
 * FILE: src/services/memberProfileService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { loadJson, saveJson } = require('../storage/jsonStore');
const FILE = 'memberProfiles.json';

function getStore() {
  const raw = loadJson(FILE, null);
  return raw && typeof raw === 'object' ? raw : { profiles: {}, updatedAt: null };
}

function saveStore(next) {
  const out = { profiles: {}, updatedAt: Date.now(), ...(next || {}) };
  saveJson(FILE, out);
  return out;
}

function getProfile(userId) {
  return getStore().profiles?.[String(userId)] || null;
}

function upsertProfile(userId, patch = {}) {
  const id = String(userId);
  const store = getStore();
  const current = store.profiles?.[id] || { userId: id, timezone: null, timezoneLabel: null, lastSeenDisplayName: null, updatedAt: null };
  store.profiles = { ...(store.profiles || {}), [id]: { ...current, ...patch, userId: id, updatedAt: Date.now() } };
  saveStore(store);
  return store.profiles[id];
}

function ensureProfile(userId, defaults = {}) {
  return getProfile(userId) || upsertProfile(userId, defaults);
}

function clearTimezone(userId) {
  const id = String(userId);
  const store = getStore();
  const current = store.profiles?.[id];
  if (!current) return null;
  store.profiles[id] = { ...current, timezone: null, timezoneLabel: null, updatedAt: Date.now() };
  saveStore(store);
  return store.profiles[id];
}

function clearAllTimezones() {
  const store = getStore();
  for (const id of Object.keys(store.profiles || {})) {
    store.profiles[id] = { ...(store.profiles[id] || {}), timezone: null, timezoneLabel: null, updatedAt: Date.now() };
  }
  saveStore(store);
  return store;
}

module.exports = { FILE, getStore, getProfile, upsertProfile, ensureProfile, clearTimezone, clearAllTimezones };
