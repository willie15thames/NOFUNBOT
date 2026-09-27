/*
 * NAVIGATION HEADER
 * FILE: src/services/channelTopologyService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { CHANNEL_KEYS, STAFF_REPAIR_CHANNEL_KEYS, READ_ONLY_BASE_CHANNEL_KEYS } = require('../config/channels');
// Dynamic naming policy — resolves brand/template-aware channel names
let _namingPolicy = null;
function _getNamingPolicy() {
  if (!_namingPolicy) {
    try { _namingPolicy = require('./channelNamingPolicyService'); } catch { _namingPolicy = null; }
  }
  return _namingPolicy;
}

function getConfiguredChannelName(key) {
  return CHANNEL_KEYS[key] || null;
}

function normalizeChannelName(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesConfiguredChannel(subject, key, opts = {}) {
  const expected = normalizeChannelName(getConfiguredChannelName(key));
  if (!expected) return false;
  const actual = normalizeChannelName(typeof subject === 'string' ? subject : subject?.name);
  if (!actual) return false;
  return opts.includes ? actual.includes(expected) : actual === expected;
}

function findConfiguredChannel(guild, key, opts = {}) {
  if (!guild?.channels?.cache) return null;
  const candidates = [...guild.channels.cache.values()].filter(channel => {
    if (opts.textOnly && !channel.isTextBased?.()) return false;
    return matchesConfiguredChannel(channel, key, { includes: !!opts.includes });
  });
  const base = candidates.find(c => /^👋 Welcome to/i.test(String(c.parent?.name || '')));
  const staff = candidates.find(c => /Staff & Commissioner/i.test(String(c.parent?.name || '')));
  if (['welcome','rules','serverGuide','howToJoin','announcements'].includes(key) && base) return base;
  if (['commAI','adminHq','commishHub','scoresheets'].includes(key) && staff) return staff;
  // A league's plain #rules/#announcements is not a server-wide destination.
  return candidates.find(c => !require('./activeLeagueService').findLeagueForChannel(c)) || null;
}

function getConfiguredChannelNames(keys = []) {
  return keys.map(key => getConfiguredChannelName(key)).filter(Boolean);
}

function getStaffRepairChannelNames() {
  return getConfiguredChannelNames(STAFF_REPAIR_CHANNEL_KEYS);
}

function getReadOnlyBaseChannelNames(settings) {
  // Use dynamic policy if available (returns policy-resolved names including patchNotes)
  const policy = _getNamingPolicy();
  if (policy && settings) return [...policy.getReadOnlyChannelNames(settings)];
  // Fallback: static config — includes patchNotes since it is now in READ_ONLY_BASE_CHANNEL_KEYS
  return getConfiguredChannelNames(READ_ONLY_BASE_CHANNEL_KEYS);
}

function isStaffRepairChannel(subject) {
  return STAFF_REPAIR_CHANNEL_KEYS.some(key => matchesConfiguredChannel(subject, key));
}

module.exports = {
  getConfiguredChannelName,
  normalizeChannelName,
  matchesConfiguredChannel,
  findConfiguredChannel,
  getConfiguredChannelNames,
  getStaffRepairChannelNames,
  getReadOnlyBaseChannelNames,
  isStaffRepairChannel,
};
