/*
 * NAVIGATION HEADER
 * FILE: src/services/architectureSemanticsService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const serverSettings = require('./serverSettingsService');
const { resolveTemplateProfile } = require('./templateRegistryService');

function slug(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function title(value = '') {
  return String(value || '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

const DEFINITIONS = {
  template: 'Base server structure.',
  subtemplate: 'Specialization inside the base template.',
  community: 'Membership group within the server.',
  event: 'Scheduled activity tied to a date or time.',
  league: 'Structured competitive community type.',
  team: 'Side, roster, or faction within a team-based community.',
  space: 'Channel area for a purpose or community.',
  roleMapping: 'Rules that connect user choices to roles, channel access, and behavior.',
  userProfile: 'Per-user saved server record for onboarding, access, and personalization.',
  serverConfig: 'Saved server blueprint for structure, theme, communities, and automation.',
};

function getHierarchyText() {
  return 'Template → Subtemplate → Community Type → Communities → Spaces → Events / Leagues / Teams';
}

function getArchitectureIntentText() {
  return 'Server Management + Setup Wizard + Personality AI Bot';
}

function getCommunityType(settings = serverSettings.getSettings()) {
  // If communities array exists with an explicit league type, use that
  const communities = Array.isArray(settings.communities) ? settings.communities : [];
  if (communities.some(c => ['league', 'league-enabled', 'competitive'].includes(c.type))) {
    return 'league-enabled';
  }
  if (communities.some(c => ['events', 'event-driven'].includes(c.type))) {
    return 'event-driven';
  }
  const template = slug(settings.serverTemplate || '');
  const subtemplate = slug(settings.serverSubtemplate || '');
  if (template === 'gaming' && /(sports|madden|2k|fifa|nba|nfl|esports|tournament)/.test(subtemplate)) return 'league-enabled';
  if (template === 'sports') return 'league-enabled';
  if (template === 'events' || /(watch-party|watch|movie|anime|wrestling|ufc|boxing|conference|launch|tournament)/.test(subtemplate)) return 'event-driven';
  return 'community-driven';
}

function classifySpace(rawName = '', settings = serverSettings.getSettings()) {
  const key = slug(rawName);
  const template = slug(settings.serverTemplate || '');
  const subtemplate = slug(settings.serverSubtemplate || '');
  const communityType = getCommunityType(settings);

  if (!key) return null;
  if (['teams', 'team', 'roster', 'rosters', 'lineups'].includes(key)) {
    return {
      key: 'teams',
      name: 'Teams',
      type: 'team',
      selectorVisible: false,
      description: 'Team lanes only appear after teams exist in this server.',
    };
  }

  if (['watch-party', 'watch-party-planning', 'watch-along', 'events', 'event', 'event-chat', 'event-calendar', 'calendar', 'live-event-reactions', 'game-night', 'game-nights', 'match-lobby'].includes(key)) {
    return {
      key: 'events',
      name: 'Events',
      type: 'event',
      selectorVisible: true,
      description: 'Scheduled watch parties, live events, and time-based activities.',
    };
  }

  if (communityType === 'league-enabled' && ['scores', 'scores-and-standings', 'standings', 'schedule-board', 'schedule', 'gameday', 'game-day', 'league', 'fixtures', 'results-board', 'bracket-board'].includes(key)) {
    return {
      key: 'league',
      name: 'League',
      type: 'league',
      selectorVisible: true,
      description: 'Structured competition, scores, standings, and match flow.',
    };
  }

  if (communityType === 'league-enabled' && key === 'fantasy') {
    return {
      key: 'fantasy',
      name: 'Fantasy',
      type: 'community',
      selectorVisible: true,
      description: 'Fantasy-specific community access.',
    };
  }

  if (template === 'fandom') {
    return {
      key,
      name: title(rawName),
      type: 'community',
      selectorVisible: true,
      description: `${title(rawName)} community access.`,
    };
  }

  if (template === 'events') {
    return {
      key,
      name: title(rawName),
      type: key.includes('schedule') || key.includes('qa') || key.includes('updates') ? 'event' : 'space',
      selectorVisible: !key.includes('qa') || true,
      description: `${title(rawName)} access.`,
    };
  }

  if (template === 'gaming' && /(sports|madden|2k|fifa|nba|nfl)/.test(subtemplate) && ['scores', 'fantasy', 'watch-party'].includes(key)) {
    return classifySpace(key, { ...settings, serverTemplate: 'sports' });
  }

  return {
    key,
    name: title(rawName),
    type: 'community',
    selectorVisible: true,
    description: `${title(rawName)} access.`,
  };
}

function getSelectorCommunities(settings = serverSettings.getSettings()) {
  const profile = resolveTemplateProfile(settings);
  const source = [
    ...(Array.isArray(profile?.subservers) ? profile.subservers : []),
    ...(Array.isArray(profile?.communityOptions) ? profile.communityOptions : []),
  ];
  const seen = new Set();
  const out = [];
  for (const item of source) {
    const classified = classifySpace(item, settings);
    if (!classified?.key || !classified.selectorVisible || seen.has(classified.key)) continue;
    seen.add(classified.key);
    out.push(classified);
    if (out.length >= 20) break;
  }
  return out;
}

function getTemplateSpaceSummary(settings = serverSettings.getSettings()) {
  const profile = resolveTemplateProfile(settings);
  const source = Array.isArray(profile?.subservers) ? profile.subservers : [];
  const normalized = source
    .map(item => classifySpace(item, settings))
    .filter(Boolean)
    .map(item => item.name);
  return normalized.length ? normalized.join(', ') : 'Choose template first';
}

module.exports = {
  DEFINITIONS,
  getHierarchyText,
  getArchitectureIntentText,
  getCommunityType,
  classifySpace,
  getSelectorCommunities,
  getTemplateSpaceSummary,
  slug,
  title,
};
