/*
 * NAVIGATION HEADER
 * FILE: src/services/validationPipelineService.js
 * LAYER: Service layer
 * PURPOSE: Performs validation, security checks, or escalation/governance control.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * validationPipelineService.js
 *
 * Build Map Phase 2 — Centralized Validation Pipeline.
 *
 * Provides a unified pre-execution check system for all commands. Replaces
 * scattered permission and state checks scattered across 200+ case blocks
 * with a single call that can be wired into the router.
 *
 * Usage:
 *   const vp = require('./validationPipelineService');
 *   const result = await vp.validate(interaction, { state, guild });
 *   if (!result.ok) return interaction.reply({ content: result.reason, flags: 64 });
 *
 * Checks run in order — first failure short-circuits.
 */

const { makeLogger } = require('../utils/logger');
const log = makeLogger('validation');

// ── Command Classification (Build Map Phase 1) ───────────────────────────────
// instant      — no defer needed, responds <1s (status checks, reads)
// transactional — may take 1–3s (DB writes, config updates) — deferReply recommended
// orchestrated  — long-running (builds, resets, syncs) — MUST deferReply + status card

const COMMAND_CLASS = {
  // Instant reads
  'bot-status':              'instant',
  'audit-wiring':            'instant',
  'hub-status':              'instant',
  'hierarchy-status':        'instant',
  'list-communities':        'instant',
  'list-admins':             'instant',
  'open-teams':              'instant',
  'rewards-board':           'instant',
  'stream-board':            'instant',
  'my-streams':              'instant',
  'schedule':                'instant',
  'weekly-automation-status':'instant',
  'team-registry-status':    'instant',
  'live-sync-status':        'instant',
  'schedule-registry-status':'instant',
  'dashboard':               'instant',
  'workflow':                'instant',
  'audit-log':               'instant',
  'manual':                  'instant',
  'manual-server':           'instant',
  'manual-league':           'instant',
  'manual-setup':            'instant',
  'manual-commands':         'instant',
  'manual-actions':          'instant',
  'suggestions':             'instant',

  // Transactional
  'set-timezone':            'transactional',
  'select-team':             'transactional',
  'register-team':           'transactional',
  'release-team':            'transactional',
  'setup-league':            'transactional',
  'set-bot-identity':        'transactional',
  'set-bot-tone':            'transactional',
  'set-rules':               'transactional',
  'append-rule':             'transactional',
  'update-rule':             'transactional',
  'set-hub-week':            'transactional',
  'release-week':            'transactional',
  'advance-week':            'transactional',
  'report-result':           'transactional',
  'create-game':             'transactional',
  'warn-player':             'transactional',
  'ban':                     'transactional',
  'set-weekly-automation':   'transactional',
  'live-sync-now':           'transactional',
  'schedule-load-week':      'transactional',
  'schedule-import':         'transactional',
  'league-data-ingest':      'transactional',
  'propose-trade':           'transactional',
  'transaction':             'transactional',
  'player-of-the-week':      'transactional',
  'yearly-award':            'transactional',
  'superbowl-champion':      'transactional',
  'setup-community':         'transactional',
  'delete-community':        'transactional',
  'setup-event':             'transactional',
  'setup-team':              'transactional',
  'setup-server':            'transactional',
  'post-server-guide':       'transactional',
  'process-builder':         'transactional',
  'process-run':             'transactional',

  // Orchestrated (must use deferReply + status card)
  'trash-the-bot':           'orchestrated',
  'initialize-server':       'orchestrated',
  'reset-league':            'orchestrated',
  'delete-league':           'orchestrated',
  'live-sync-now':           'orchestrated',
  'sync-emojis':             'orchestrated',
  'lock-bot-access':         'orchestrated',
  'game-channels':           'orchestrated',
};

function getCommandClass(commandName) {
  return COMMAND_CLASS[commandName] || 'transactional';
}

// ── Bot System State ─────────────────────────────────────────────────────────
const BOT_STATES = {
  LIVE:       'live',
  INSTALLING: 'installing',
  REBUILDING: 'rebuilding',
  DEGRADED:   'degraded',
  KILLED:     'killed',
};

function getSystemState(settings, wizardState) {
  if ((settings?.botStatus || 'active') === 'killed') return BOT_STATES.KILLED;
  if (wizardState?.installationMode)                   return BOT_STATES.INSTALLING;
  if (!settings?.serverInitialized)                    return BOT_STATES.INSTALLING;
  return BOT_STATES.LIVE;
}

// ── Dependency Checks ────────────────────────────────────────────────────────

async function checkDependencies(guild, commandName) {
  const failures = [];

  // Channel checks for commands that need specific channels
  const CHANNEL_DEPS = {
    'post-server-guide': ['adminHq'],
    'release-week':      ['announcements'],
    'advance-week':      ['schedule'],
  };
  const needed = CHANNEL_DEPS[commandName];
  if (needed && guild) {
    for (const key of needed) {
      const found = guild.channels.cache.find(c => c.name?.includes(key.toLowerCase()));
      if (!found) failures.push(`Channel dependency missing: #${key}`);
    }
  }

  return failures;
}

// ── Preflight checks for destructive commands ────────────────────────────────

const DESTRUCTIVE_PREFLIGHTS = new Set([
  'trash-the-bot',
  'initialize-server',
  'reset-league',
  'delete-league',
  'delete-community',
]);

function isDestructiveCommand(commandName) {
  return DESTRUCTIVE_PREFLIGHTS.has(commandName);
}

// ── Main Validate Entry Point ────────────────────────────────────────────────

/**
 * Run the full validation pipeline for an interaction.
 * Returns { ok: true } or { ok: false, reason: string, code: string }.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{ state: object, guild: object, isComm: boolean }} ctx
 */
async function validate(interaction, ctx = {}) {
  const { state, guild, isComm = false } = ctx;
  const cmd = interaction.commandName;

  try {
    const serverSettings = require('./serverSettingsService');
    const wizardStateService = require('./wizardStateService');
    const settings = serverSettings.getSettings();
    const wizardState = wizardStateService.getState();

    // 1. System state gate
    const sysState = getSystemState(settings, wizardState);
    if (sysState === BOT_STATES.KILLED) {
      const killedAllow = new Set(['ignite-bot', 'bot-status', 'kill-bot', 'trash-the-bot']);
      if (!killedAllow.has(cmd)) {
        return { ok: false, reason: '🛑 Bot is killed. Use `/ignite-bot` to restore.', code: 'BOT_KILLED' };
      }
    }

    // 2. Commissioner-only preflight for destructive commands
    if (isDestructiveCommand(cmd) && !isComm) {
      return { ok: false, reason: '❌ This command requires commissioner access.', code: 'PERM_DENIED' };
    }

    // 3. Dependency checks
    const depFailures = await checkDependencies(guild, cmd);
    if (depFailures.length) {
      log.warn(`[validate] ${cmd} dependency failures: ${depFailures.join(', ')}`);
      // Dependency failures are warnings, not hard blocks — log but allow
    }

    return { ok: true, commandClass: getCommandClass(cmd), systemState: sysState };

  } catch (err) {
    log.warn(`[validate] pipeline error for ${cmd}:`, err.message);
    return { ok: true }; // Pipeline failures are non-fatal — allow interaction to proceed
  }
}

// ── Structured interaction log entry ────────────────────────────────────────

function buildInteractionLogEntry(interaction) {
  return {
    commandName: interaction.commandName || interaction.customId || '?',
    commandClass: getCommandClass(interaction.commandName),
    userId: interaction.user?.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    timestamp: Date.now(),
  };
}

module.exports = {
  validate,
  getCommandClass,
  getSystemState,
  isDestructiveCommand,
  buildInteractionLogEntry,
  BOT_STATES,
  COMMAND_CLASS,
};
