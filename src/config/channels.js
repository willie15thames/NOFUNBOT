/*
 * NAVIGATION HEADER
 * FILE: src/config/channels.js
 * LAYER: Configuration layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

// src/config/channels.js
// Single source of truth for every channel key → default name.
// channelNamingPolicyService resolves brand/template overrides at runtime.
// channelResolver.js resolves Discord channel objects once at startup.

const CHANNEL_KEYS = {
  // ── Info / onboarding ──────────────────────────────────────
  announcements:  'announcements',
  rules:          'rules',
  welcome:        'welcome',
  openTeams:      'open-teams',
  serverGuide:    'server-guide',
  howToJoin:      'how-to-join',
  polls:          'polls',
  highlights:     'highlights',

  // ── Community expansion ────────────────────────────────────
  general:        'general',
  generalChat:    'general-chat',
  introductions:  'introductions',
  resources:      'resources',
  events:         'events',
  jobBoard:       'job-board',
  mentorship:     'mentorship',
  premiumLounge:  'premium-lounge',
  supportDesk:    'support-desk',
  offTopic:       'off-topic',
  mediaShare:     'media-share',

  // ── Sports / league specific ───────────────────────────────
  livestreams:    'livestreams',
  teambuilder:    'teambuilder-imports',
  nflUpdates:     'nfl-updates',
  nflChat:        'nfl-chat',
  nbaChat:        'nba-chat',
  tradeBlock:     'trade-block',

  // ── Rewards / leaderboards ─────────────────────────────────
  rewards:        'rewards',
  statLeaders:    'stat-leaders',
  potw:           'player-of-the-week',
  devUpgrades:    'dev-upgrades',
  superbowl:      'superbowl-history',
  abilityResets:  'ability-resets',

  // ── Trades / transactions ──────────────────────────────────
  pendingTrades:  'pending-trades',
  acceptedTrades: 'accepted-trades',
  declinedTrades: 'declined-trades',
  transactions:   'transactions',

  // ── Scheduling ─────────────────────────────────────────────
  weeklySchedule: 'weekly-schedule',
  activeCheck:    'active-check',
  forceLoss:      'force-wins',
  fairSim:        'fair-sims',

  // ── Game results ───────────────────────────────────────────
  gameResults:    'game-results',
  gotwChannel:    'game-of-the-week',
  overseasGames:  'overseas-games',
  primetimeGames: 'primetime-games',

  // ── Admin / ops ────────────────────────────────────────────
  commAI:         'commissioner-ai',
  adminHq:        'admin-hq',
  commishHub:     'commish-hub',
  scoresheets:    'scoresheets',
  setupWizard:    'setup-wizard',
  patchNotes:     'patch-notes',
  timezoneGate:   'timezone-gate',
  warningsLog:    'warnings-log',
  bootLog:        'boot-log',
  itOps:          'it-ops',
};

const REQUIRED_CHANNELS = [
  'announcements', 'openTeams', 'serverGuide', 'livestreams',
  'rewards', 'statLeaders', 'potw',
  'gameResults', 'commAI', 'commishHub', 'scoresheets',
  'warningsLog', 'bootLog', 'weeklySchedule',
  'acceptedTrades', 'declinedTrades', 'transactions', 'adminHq',
];

const STAFF_REPAIR_CHANNEL_KEYS = [
  'commAI', 'adminHq', 'commishHub', 'scoresheets', 'warningsLog', 'bootLog', 'setupWizard', 'itOps',
];

// READ_ONLY_BASE_CHANNEL_KEYS — members cannot post in these channels.
// patchNotes is ALWAYS read-only: the bot owns it exclusively.
const READ_ONLY_BASE_CHANNEL_KEYS = [
  'welcome', 'rules', 'serverGuide', 'howToJoin', 'announcements',
  'openTeams', 'warningsLog', 'bootLog', 'polls',
  'patchNotes',   // ← REQUIRED: patch-notes is bot-owned, always read-only
  'rewards', 'statLeaders', 'potw', 'superbowl',
];

// Community-expansion read-only keys (used by non-league templates)
const COMMUNITY_READ_ONLY_KEYS = [
  'resources', 'jobBoard', 'events',
];

module.exports = {
  CHANNEL_KEYS,
  REQUIRED_CHANNELS,
  STAFF_REPAIR_CHANNEL_KEYS,
  READ_ONLY_BASE_CHANNEL_KEYS,
  COMMUNITY_READ_ONLY_KEYS,
};
