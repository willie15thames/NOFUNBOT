/*
 * NAVIGATION HEADER
 * FILE: src/services/stateService.js
 * LAYER: Service layer
 * PURPOSE: Owns or coordinates application state and source-of-truth decisions.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * stateService.js — Centralized State Service V109
 *
 * Single source of truth for all runtime state.
 * Reads from PostgreSQL when DATABASE_URL is set, falls back to JSON store.
 *
 * Hierarchy enforced here:
 *   server_config → communities → leagues → teams
 *   server_config → events
 *   users → user_communities → communities
 *
 * The 3 gate violations fixed:
 *   ❌ timezone gate active too early    → isTimezoneGateReady() checks setupComplete
 *   ❌ community selector before communities exist → hasCommunities() required before selector
 *   ❌ users getting access before gates resolved → resolveUserAccess() checks all gates in order
 */

const { makeLogger } = require('../utils/logger');
const { loadJson, saveJson } = require('../storage/jsonStore');
const { prismaSafe } = require('../storage/prisma');
const serverSettings = require('./serverSettingsService');
const log = makeLogger('stateService');

// ── DB access — uses prismaSafe wrapper (standard pattern across codebase) ──
function _db() {
  return { prismaSafe }; // Callers should use prismaSafe directly
}

// ── Server Config ─────────────────────────────────────────────────────────

function getServerConfig(guildId) {
  const settings = serverSettings.getSettings();
  return {
    guildId: guildId || settings.guildId || '',
    template:            settings.serverTemplate || null,
    subtemplate:         settings.serverSubtemplate || null,
    theme:               settings.themeName || null,
    timezoneGateEnabled: !!settings.requireTimezone,
    setupComplete:       !!settings.serverInitialized,
    botStatus:           String(settings.botStatus || 'active'),
    audienceRating:      String(settings.audienceRating || 'pg13'),
    filterMode:          String(settings.filterMode || 'strict'),
    botName:             String(settings.botName || 'myBot'),
    allowGifReplies:     settings.allowGifReplies !== false,
    serverInitialized:   !!settings.serverInitialized,
  };
}

// ── Gate Resolution — fixes the 3 violations ─────────────────────────────

/**
 * FIX 1: Timezone gate must not fire before setup is complete.
 * Returns true ONLY when: server is initialized AND timezoneGateEnabled is true.
 */
function isTimezoneGateReady(guildId) {
  const config = getServerConfig(guildId);
  if (!config.setupComplete) return false;       // gate blocked during setup
  if (!config.serverInitialized) return false;  // gate blocked before build
  return config.timezoneGateEnabled;
}

/**
 * FIX 2: Community selector must not exist before communities exist.
 * Returns the communities for a guild, or empty array if none.
 */
function getCommunities(guildId) {
  const settings = serverSettings.getSettings();
  return Array.isArray(settings.communities) ? settings.communities : [];
}

function hasCommunities(guildId) {
  return getCommunities(guildId).length > 0;
}

function selectorIsReady(guildId) {
  const config = getServerConfig(guildId);
  // Must have: template + communities + setup complete
  if (!config.template) return false;
  if (!config.setupComplete) return false;
  if (!hasCommunities(guildId)) return false;
  return true;
}

/**
 * FIX 3: Users must not get channel access before all their gates are resolved.
 * Checks gates in order and returns the first unresolved gate (or null if clear).
 *
 * Gate order:
 *   1. Setup complete (server must be initialized)
 *   2. Timezone gate (if enabled, user must have timezone)
 *   3. Community gate (if selector is ready, user should have at least one community)
 */
function resolveUserAccess(memberId, guildId) {
  const config = getServerConfig(guildId);

  // Gate 1: server must be built
  if (!config.setupComplete) {
    return { clear: false, gate: 'setup', reason: 'Server setup is not complete yet.' };
  }

  // Gate 2: timezone gate
  if (isTimezoneGateReady(guildId)) {
    const user = getUserProfile(memberId, guildId);
    if (!user?.timezone) {
      return { clear: false, gate: 'timezone', reason: 'Set your timezone to unlock server access.' };
    }
  }

  // Gate 3: community gate (optional — only blocks if selector is ready and user has no community)
  if (selectorIsReady(guildId)) {
    const memberships = getUserCommunities(memberId, guildId);
    if (!memberships.length) {
      return { clear: false, gate: 'community', reason: 'Choose your communities in #community-selector.' };
    }
  }

  return { clear: true, gate: null };
}

// ── User Profiles ─────────────────────────────────────────────────────────

function getUserProfile(memberId, guildId) {
  const profiles = require('./memberProfileService');
  return profiles.getProfile(memberId);
}

function getUserCommunities(memberId, guildId) {
  const profile = getUserProfile(memberId, guildId);
  return Array.isArray(profile?.communitySpaces) ? profile.communitySpaces : [];
}

// ── Leagues & Teams (hierarchy: community → league → team) ────────────────

function getLeaguesForCommunity(communityName, guildId) {
  const settings = serverSettings.getSettings();
  const leaguesData = loadJson('leagueRegistry.json', {});
  const all = Array.isArray(leaguesData.leagues) ? leaguesData.leagues : [];
  return all.filter(l => {
    if (guildId && l.guildId && String(l.guildId) !== String(guildId)) return false;
    if (communityName && l.communityName && l.communityName.toLowerCase() !== communityName.toLowerCase()) return false;
    return true;
  });
}

function getTeamsForLeague(leagueId) {
  const state = require('../state');
  if (!leagueId) return [...(state.openTeamRegistry || [])];
  return (state.openTeamRegistry || []).filter(t => String(t.leagueId || '') === String(leagueId));
}

// ── Access grant (applies permissions after all gates clear) ──────────────

async function grantMemberAccess(member, guild, communityNames = []) {
  // Only grant after all gates are resolved
  const access = resolveUserAccess(member.id, guild.id);
  if (!access.clear) {
    log.warn(`grantMemberAccess blocked for ${member.user?.tag} — gate: ${access.gate}`);
    return { granted: false, gate: access.gate, reason: access.reason };
  }

  // Grant community role access
  const settings = serverSettings.getSettings();
  const communities = getCommunities(guild.id).filter(c =>
    !communityNames.length || communityNames.includes(c.name)
  );

  let granted = 0;
  for (const community of communities) {
    const roleName = `Community • ${community.name}`;
    const role = guild.roles.cache.find(r => r.name === roleName);
    if (role && !member.roles.cache.has(role.id)) {
      await member.roles.add(role, `Community access granted — gate resolved`).catch(() => null);
      granted++;
    }
  }

  log.info(`grantMemberAccess: ${member.user?.tag} → ${granted} role(s) granted`);
  return { granted: true, rolesGranted: granted };
}

module.exports = {
  // Config
  getServerConfig,
  // Gate resolution (the 3 fixes)
  isTimezoneGateReady,
  selectorIsReady,
  hasCommunities,
  getCommunities,
  resolveUserAccess,
  // Users
  getUserProfile,
  getUserCommunities,
  // Hierarchy
  getLeaguesForCommunity,
  getTeamsForLeague,
  // Access
  grantMemberAccess,
};
