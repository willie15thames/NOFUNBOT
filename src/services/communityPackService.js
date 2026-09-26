/*
 * NAVIGATION HEADER
 * FILE: src/services/communityPackService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * communityPackService.js
 *
 * Implements the Community Expansion Breakdown three-layer model:
 *   Core engine (shared) → Community pack (operating shape) → Niche overlay (flavor)
 *
 * The five community families:
 *   competitive     — Madden, fantasy, tournaments, ladders
 *   interest        — BMW, football, gaming, cybersecurity, veterans
 *   professional    — Cyber jobs, founder circles, veteran support
 *   service         — Plumbing, home improvement, tech teams, agencies
 *   premium         — Masterminds, paid sports, premium cyber, coaching
 */

// ── Community family definitions ──────────────────────────────
const COMMUNITY_FAMILIES = {
  competitive: {
    label:       'Competitive / League',
    description: 'Onboarding, roles, schedules, scoreboards, disputes, rewards, announcements, resets.',
    icon:        '🏆',
    corePacks:   ['onboarding', 'league-ops', 'rewards', 'moderation'],
    channels:    ['general-chat', 'server-guide', 'open-teams', 'game-results', 'weekly-schedule', 'highlights', 'rewards', 'warnings-log', 'boot-log'],
    roles:       ['Commissioner', 'Player', 'Free Agent', 'CPU', 'Referee'],
    aiHints:     ['Focus on game results, schedules, trade disputes, and league rules.'],
  },
  interest: {
    label:       'Interest-Based',
    description: 'Topic lanes, events, Q&A, resources, polls, recognition, moderation, knowledge.',
    icon:        '💬',
    corePacks:   ['onboarding', 'community-hub', 'events', 'moderation'],
    channels:    ['general-chat', 'server-guide', 'introductions', 'resources', 'events', 'media-share', 'polls', 'off-topic'],
    roles:       ['Admin', 'Moderator', 'Member', 'New Member', 'Event Host'],
    aiHints:     ['Focus on community topics, resources, events, and member help.'],
  },
  professional: {
    label:       'Professional / Career',
    description: 'Skill-based onboarding, jobs, mentorship, office hours, reminders, accountability.',
    icon:        '💼',
    corePacks:   ['onboarding', 'professional', 'mentorship', 'moderation'],
    channels:    ['network-chat', 'resource-hub', 'job-board', 'mentorship', 'introductions', 'events', 'off-topic'],
    roles:       ['Admin', 'Mentor', 'Member', 'Recruiter', 'Job Seeker', 'Expert'],
    aiHints:     ['Focus on career resources, job leads, mentorship, and professional growth.'],
  },
  service: {
    label:       'Service / Business',
    description: 'Tasks, approvals, updates, reporting, automation, dashboards, audit trails.',
    icon:        '🔧',
    corePacks:   ['onboarding', 'ops', 'task-management', 'moderation'],
    channels:    ['workspace', 'ops-board', 'job-board', 'dispatch', 'team-chat', 'updates', 'reports'],
    roles:       ['Owner', 'Admin', 'Dispatcher', 'Technician', 'Client', 'Contractor'],
    aiHints:     ['Focus on task coordination, job dispatch, status updates, and team operations.'],
  },
  premium: {
    label:       'Premium / Private',
    description: 'Gated access, tier roles, lifecycle automation, renewals, perks, analytics.',
    icon:        '⭐',
    corePacks:   ['onboarding', 'premium', 'gated-access', 'moderation'],
    channels:    ['members-lounge', 'member-guide', 'resources', 'events', 'introductions', 'accountability'],
    roles:       ['Owner', 'Admin', 'Premium Member', 'Trial Member', 'Alumni', 'Moderator'],
    aiHints:     ['Focus on member benefits, exclusive content, accountability, and premium experience.'],
  },
};

// ── Niche overlays ─────────────────────────────────────────────
// Maps niche key to label, parent family, and flavor overrides.
const NICHE_OVERLAYS = {
  madden:         { label: 'Madden Franchise',        family: 'competitive', wave: 1 },
  'fantasy-sports':{ label: 'Fantasy Sports',         family: 'competitive', wave: 1 },
  nba2k:          { label: 'NBA 2K League',           family: 'competitive', wave: 1 },
  cybersecurity:  { label: 'Cybersecurity',           family: 'professional', wave: 1 },
  business:       { label: 'Business / Entrepreneur', family: 'professional', wave: 1 },
  veterans:       { label: 'Veterans Community',      family: 'professional', wave: 2 },
  bmw:            { label: 'BMW / Car Enthusiast',    family: 'interest',    wave: 2 },
  football:       { label: 'Football Fan',            family: 'interest',    wave: 2 },
  basketball:     { label: 'Basketball Fan',          family: 'interest',    wave: 2 },
  plumbing:       { label: 'Plumbing / Trades',       family: 'service',     wave: 3 },
  'home-improvement': { label: 'Home Improvement',   family: 'service',     wave: 3 },
  'tech-agency':  { label: 'Tech Agency',             family: 'service',     wave: 3 },
  mastermind:     { label: 'Mastermind Group',        family: 'premium',     wave: 1 },
  coaching:       { label: 'Coaching Community',      family: 'premium',     wave: 2 },
};

// ── Modular channel packs ──────────────────────────────────────
const CHANNEL_PACKS = {
  onboarding:       ['welcome', 'rules', 'how-to-join', 'announcements'],
  'league-ops':     ['open-teams', 'server-guide', 'game-results', 'weekly-schedule', 'active-check', 'force-wins'],
  rewards:          ['rewards', 'stat-leaders', 'player-of-the-week', 'highlights'],
  moderation:       ['warnings-log', 'boot-log'],
  'community-hub':  ['general-chat', 'polls', 'introductions', 'off-topic', 'media-share'],
  events:           ['events', 'event-signups', 'event-results'],
  professional:     ['job-board', 'resources', 'network-chat', 'introductions'],
  mentorship:       ['mentorship', 'office-hours', 'accountability'],
  ops:              ['workspace', 'ops-board', 'dispatch', 'reports'],
  'task-management':['job-board', 'active-jobs', 'completed-jobs'],
  premium:          ['members-lounge', 'premium-content', 'member-updates'],
  'gated-access':   ['member-guide', 'resources', 'events'],
};

// ── Modular role packs ─────────────────────────────────────────
const ROLE_PACKS = {
  'league-ops':   ['Commissioner', 'Player', 'Free Agent', 'CPU', 'Referee'],
  professional:   ['Admin', 'Mentor', 'Member', 'Recruiter', 'Expert'],
  community:      ['Admin', 'Moderator', 'Member', 'New Member'],
  service:        ['Owner', 'Dispatcher', 'Technician', 'Client'],
  premium:        ['Admin', 'Premium Member', 'Trial Member', 'Alumni'],
  events:         ['Event Host', 'Attendee'],
};

// ── Public API ─────────────────────────────────────────────────

/**
 * Get the community family definition for a given family key.
 */
function getFamily(familyKey) {
  return COMMUNITY_FAMILIES[String(familyKey || '').toLowerCase()] || null;
}

/**
 * Get the niche overlay for a given niche key.
 */
function getNiche(nicheKey) {
  return NICHE_OVERLAYS[String(nicheKey || '').toLowerCase()] || null;
}

/**
 * Get all channel packs for a given list of pack names.
 * Returns deduplicated flat array of channel name slugs.
 */
function resolveChannelPack(packNames) {
  const seen = new Set();
  const out  = [];
  for (const name of (packNames || [])) {
    for (const ch of (CHANNEL_PACKS[name] || [])) {
      if (!seen.has(ch)) { seen.add(ch); out.push(ch); }
    }
  }
  return out;
}

/**
 * Get all roles for a given list of role pack names.
 */
function resolveRolePack(packNames) {
  const seen = new Set();
  const out  = [];
  for (const name of (packNames || [])) {
    for (const r of (ROLE_PACKS[name] || [])) {
      if (!seen.has(r)) { seen.add(r); out.push(r); }
    }
  }
  return out;
}

/**
 * Get all available family options for the setup wizard community selector.
 */
function getFamilyOptions() {
  return Object.entries(COMMUNITY_FAMILIES).map(([key, def]) => ({
    label: `${def.icon} ${def.label}`,
    value: key,
    description: def.description.slice(0, 100),
  }));
}

/**
 * Get niche options for a given family (for setup wizard subtemplate selector).
 */
function getNicheOptions(familyKey) {
  return Object.entries(NICHE_OVERLAYS)
    .filter(([, v]) => v.family === familyKey)
    .sort((a, b) => a[1].wave - b[1].wave)
    .map(([key, def]) => ({
      label: def.label,
      value: key,
      description: `Wave ${def.wave} — ${def.family} family`,
    }));
}

/**
 * Resolve AI hints for a given settings object.
 * Combines family hints + niche-specific guidance.
 */
function resolveAIHints(settings) {
  const s        = settings || require('./serverSettingsService').getSettings();
  const template = String(s.serverTemplate || '').toLowerCase();
  const sub      = String(s.serverSubtemplate || '').toLowerCase();
  const family   = getFamily(template);
  const niche    = getNiche(sub);
  const hints    = [...(family?.aiHints || [])];
  if (niche?.label) hints.unshift(`This is a ${niche.label} community.`);
  return hints;
}

/**
 * Get the expansion wave for a given niche (1 = launch, 2 = wave 2, 3 = wave 3).
 */
function getExpansionWave(nicheKey) {
  return NICHE_OVERLAYS[nicheKey]?.wave || 3;
}

module.exports = {
  COMMUNITY_FAMILIES,
  NICHE_OVERLAYS,
  CHANNEL_PACKS,
  ROLE_PACKS,
  getFamily,
  getNiche,
  resolveChannelPack,
  resolveRolePack,
  getFamilyOptions,
  getNicheOptions,
  resolveAIHints,
  getExpansionWave,
};
