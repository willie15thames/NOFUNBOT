/*
 * NAVIGATION HEADER
 * FILE: src/services/channelNamingPolicyService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * channelNamingPolicyService.js
 *
 * Implements Blueprint Section 4 — Policy-Driven Channel Naming.
 * Resolves brand-aware, template-aware channel display labels and Discord slugs.
 *
 * Priority order (highest wins):
 *   1. Admin override (stored per-channel in serverSettings.channelOverrides)
 *   2. Niche overlay (e.g. "Dynasty Hub" → "dynasty-floor" for community-chat)
 *   3. Mode overlay (e.g. "starter profile" vs "live league profile")
 *   4. Brand tokens (community name, league label)
 *   5. Base profile (default CHANNEL_KEYS values)
 *
 * Usage:
 *   const { resolveChannelName, resolveChannelLabel } = require('./channelNamingPolicyService');
 *   const slug  = resolveChannelName('general', settings);   // → 'dynasty-floor'
 *   const label = resolveChannelLabel('general', settings);  // → 'Dynasty Floor'
 */

const { CHANNEL_KEYS } = require('../config/channels');
const serverSettings   = require('./serverSettingsService');
const templateLogic    = require('./serverTemplateLogicService');

// ── Slug helpers ──────────────────────────────────────────────
function toSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

function toLabel(slug) {
  return String(slug || '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Community family → channel name overrides ─────────────────
// Maps community template key to a set of channel key overrides.
const COMMUNITY_PACK_NAMES = {
  // Competitive / sports league
  gaming:       { general: 'game-chat',        howToJoin: 'how-to-join',   serverGuide: 'server-guide' },
  sports:       { general: 'sports-chat',       howToJoin: 'how-to-join',   serverGuide: 'server-guide' },
  competitive:  { general: 'match-chat',        howToJoin: 'how-to-join',   serverGuide: 'server-guide' },

  // Interest-based
  community:    { general: 'general-chat',      howToJoin: 'start-here',    serverGuide: 'server-guide' },
  fandom:       { general: 'fan-chat',          howToJoin: 'start-here',    serverGuide: 'server-guide' },
  movie:        { general: 'film-chat',         howToJoin: 'start-here',    serverGuide: 'server-guide' },

  // Professional / career
  professional: { general: 'network-chat',      howToJoin: 'onboarding',    serverGuide: 'resource-hub' },
  educational:  { general: 'study-chat',        howToJoin: 'start-here',    serverGuide: 'resource-hub' },
  support:      { general: 'help-chat',         howToJoin: 'getting-started', serverGuide: 'resource-hub' },

  // Service / business
  business:     { general: 'workspace',         howToJoin: 'onboarding',    serverGuide: 'ops-board' },
  service:      { general: 'team-chat',         howToJoin: 'onboarding',    serverGuide: 'ops-board' },

  // Premium / private
  premium:      { general: 'members-lounge',    howToJoin: 'welcome-new',   serverGuide: 'member-guide' },
  mastermind:   { general: 'mastermind-room',   howToJoin: 'welcome-new',   serverGuide: 'member-guide' },
};

// ── Niche overlays ─────────────────────────────────────────────
// Maps subtemplate/niche key to fine-grained name overrides.
const NICHE_OVERLAYS = {
  'cybersecurity': { general: 'ops-chat',       supportDesk: 'help-desk',    resources: 'tools-and-intel' },
  'veterans':      { general: 'base-chat',      supportDesk: 'support-desk', mentorship: 'peer-support' },
  'bmw':           { general: 'car-chat',       events: 'meetups',           mediaShare: 'build-showcase' },
  'entrepreneur':  { general: 'founder-room',   mentorship: 'mentorship',    jobBoard: 'pitch-board' },
  'football':      { general: 'game-talk',      events: 'game-day',          highlights: 'best-plays' },
  'basketball':    { general: 'hoops-chat',     events: 'game-night',        highlights: 'highlights' },
  'nba2k':         { general: 'game-chat',      serverGuide: 'server-guide', openTeams: 'open-teams' },
  'madden':        { general: 'game-chat',      serverGuide: 'server-guide', openTeams: 'open-teams' },
  'cod':           { general: 'deployment',     highlights: 'clips',         events: 'scrim-night' },
  'plumbing':      { general: 'crew-chat',      jobBoard: 'jobs-board',      supportDesk: 'dispatch' },
};

// ── Public API ─────────────────────────────────────────────────

/**
 * Resolve the Discord slug for a given channel key using the full policy stack.
 * Falls back to the base CHANNEL_KEYS value if no override applies.
 */
function resolveChannelName(key, settings) {
  const s = settings || serverSettings.getSettings();

  // 1. Admin override
  const adminOverrides = s.channelOverrides || {};
  if (adminOverrides[key]) return toSlug(adminOverrides[key]);

  const template   = String(s.serverTemplate   || '').toLowerCase().trim();
  const subtemplate = String(s.serverSubtemplate || '').toLowerCase().trim();

  // 2. Niche overlay
  if (subtemplate && NICHE_OVERLAYS[subtemplate]?.[key]) {
    return toSlug(NICHE_OVERLAYS[subtemplate][key]);
  }

  // 3. Mode / community pack
  if (template && COMMUNITY_PACK_NAMES[template]?.[key]) {
    return toSlug(COMMUNITY_PACK_NAMES[template][key]);
  }

  // 4. Base profile default
  return CHANNEL_KEYS[key] || key;
}

/**
 * Resolve the human-readable display label (Title Case) for a channel key.
 */
function resolveChannelLabel(key, settings) {
  return toLabel(resolveChannelName(key, settings));
}

/**
 * Build a full resolved name map for all known channel keys.
 * Used by ChannelNamingPolicy consumers (guide renderer, baseInitService, etc.)
 */
function resolveAllChannelNames(settings) {
  const s = settings || serverSettings.getSettings();
  const result = {};
  for (const key of Object.keys(CHANNEL_KEYS)) {
    result[key] = resolveChannelName(key, s);
  }
  return result;
}

/**
 * Detect if a given Discord channel name matches any key under the current policy.
 * Used by channelResolver to do exact-match startup resolution.
 */
function matchesResolvedName(channelName, key, settings) {
  const resolved = resolveChannelName(key, settings);
  return String(channelName || '').toLowerCase() === resolved.toLowerCase();
}

/**
 * Get the read-only channel slugs for the current template/settings.
 * patchNotes is always included regardless of template.
 */
function getReadOnlyChannelNames(settings) {
  const s = settings || serverSettings.getSettings();
  const { READ_ONLY_BASE_CHANNEL_KEYS, COMMUNITY_READ_ONLY_KEYS } = require('../config/channels');
  const template = String(s.serverTemplate || '').toLowerCase().trim();

  const keys = new Set(READ_ONLY_BASE_CHANNEL_KEYS);

  // Community templates add their own read-only keys
  if (!['gaming','sports','competitive'].includes(template)) {
    for (const k of COMMUNITY_READ_ONLY_KEYS) keys.add(k);
  }

  return new Set([...keys].map(k => resolveChannelName(k, s)));
}

module.exports = {
  resolveChannelName,
  resolveChannelLabel,
  resolveAllChannelNames,
  matchesResolvedName,
  getReadOnlyChannelNames,
  COMMUNITY_PACK_NAMES,
  NICHE_OVERLAYS,
};
