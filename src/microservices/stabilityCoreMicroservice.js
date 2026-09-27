/*
 * NAVIGATION HEADER
 * FILE: src/microservices/stabilityCoreMicroservice.js
 * LAYER: Operational microservice layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually coordinates larger multi-step operations and touches several services.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const state = require('../state');
const { loadJson } = require('../storage/jsonStore');
const { resolveAllChannels, getCh } = require('../services/channels/channelResolver');
const { aiCall, MODELS, getAIStatus } = require('../services/ai/anthropicService');
const { getTeamEmoji } = require('../utils/teamUtils');
const timezoneGateService = require('../services/timezoneGateService');

const service = {
  key: 'stabilityCore',
  label: 'Phase 1 · Stability Core',
  async start({ guild, client, wireEvents, logger }) {
    logger.info('Starting Phase 1 · Stability Core');

    // ── Phase 0: DB bootstrap — must happen before any Prisma writes ─────
    // Ensures ServerConfig row exists and sets canonical guildId for all services
    try {
      const { bootstrapServerConfig } = require('../services/serverConfigBootstrap');
      await bootstrapServerConfig(guild.id);
      logger.info(`DB: ServerConfig bootstrapped for guild ${guild.id}`);
    } catch (err) {
      logger.warn(`DB bootstrap skipped: ${err.message}`);
    }

    await resolveAllChannels(guild);

    try {
      await require('../services/baseInitService').normalizeBaseChannelPolicies(guild);
    } catch (err) {
      logger.warn(`Base policy normalization skipped: ${err.message}`);
    }

    // V188 PERF: Nickname sync runs in background — iterates all members, can take seconds on large servers
    try {
      require('../services/nicknamePolicyService').syncGuildNicknames(guild, state).catch(err => {
        logger.warn(`Nickname sync failed (non-fatal): ${err.message}`);
      });
      logger.info('Nickname sync started (background)');
    } catch (err) {
      logger.warn(`Nickname sync skipped: ${err.message}`);
    }

    const settings = require('../services/serverSettingsService').getSettings() || {};
    if (settings.requireTimezone) {
      try {
        await timezoneGateService.enforceGuildTimezoneGate(guild);
      } catch (err) {
        logger.warn(`Timezone gate enforcement skipped: ${err.message}`);
      }
    }

    const persisted = loadPersistedState();
    await require('../services/spaceMigrationService').migrate(guild.id,state);
    const membershipRecovery=await require('../services/leagueVisibilityService').recover(guild);
    if(membershipRecovery.some(x=>!x.repaired))throw Error('Membership access repair required; inspect Discord permissions and restart.');
    const services = initCoreServices({ guild, client });

    // V202 (BUG-007/BUG-003): durable game sessions → state.games + reminder/deadline re-arm (needs gameChannels.init above).
    try {
      const gameSessions = require('../league/gameSessionService');
      const { armReminders } = require('../services/gameChannelService');
      const r = gameSessions.rehydrate(guild, state, armReminders);
      gameSessions.pruneStale();
      logger.info(`Game sessions rehydrated: restored=${r.restored} missingChannel=${r.missing} pastDeadline=${r.finished}`);
    } catch (err) {
      logger.warn(`Game session rehydrate failed: ${err.message}`);
    }

    require('../services/trashTalkBank').load();
    require('../services/conversationContextService').startSweeper();
    wireEvents();

    const aiStatus = getAIStatus();
    logger.info(`Phase 1 complete ✅ players=${persisted.savedPlayersCount}, rosterOverrides=${persisted.rosterOverrideCount}, ai=${aiStatus.ready ? 'ready' : aiStatus.reason}`);
    return { settings, persisted, services, aiStatus };
  },
};

function loadPersistedState() {
  // V202 (BUG-007): hydrate schedule/leagueConfig/hub/rewards/pending state from the warmed store BEFORE timers arm.
  try {
    const hydrated = state.hydrateRuntimeState();
    if (Object.keys(hydrated).length) console.log(`[stabilityCore] hydrated: ${JSON.stringify(hydrated)}`);
  } catch (err) {
    console.warn(`[stabilityCore] hydrateRuntimeState failed: ${err.message}`);
  }
  const savedPlayers = loadJson('players.json', []);
  state.players.clear();
  for (const entry of savedPlayers) {
    const { key, ...data } = entry || {};
    const team=String(data.baseTeam||data.team||'').trim().toLowerCase();
    const restoredKey=key||(team&&data.leagueId?`${data.leagueId}::${team}`:null);
    if(!restoredKey)throw Error('Player entry has no identifiable key; repair players.json before startup');
    const existing=state.players.get(restoredKey);
    if(existing?.userId&&data.userId&&existing.userId!==data.userId)throw Error('Conflicting player entries; repair players.json before startup');
    state.players.set(restoredKey, { ...data, streamLog: data?.streamLog || [] });
  }

  const savedRoster = loadJson('rosterOverrides.json', {});
  state.rosterOverrides.clear();
  for (const [key, value] of Object.entries(savedRoster || {})) {
    state.rosterOverrides.set(key, value);
  }

  // O-08: Load offenseCooldowns from DB so they survive restarts
  const { prismaSafe } = require('../storage/prisma');
  prismaSafe(async prisma => {
    const rows = await prisma.offenseCooldown.findMany();
    for (const row of rows) {
      if (row.userId && row.lastFlaggedAt) {
        state.offenseCooldowns.set(row.userId, new Date(row.lastFlaggedAt).getTime());
      }
    }
  }, null).catch(() => null);

  return {
    savedPlayersCount: savedPlayers.length,
    rosterOverrideCount: Object.keys(savedRoster || {}).length,
  };
}

function initCoreServices({ guild, client }) {
  const statLeaders = require('../services/statLeaderService');
  const rewardBoards = require('../services/rewardBoardService');
  const openTeams = require('../services/openTeamsService');
  const gameChannels = require('../services/gameChannelService');
  const memberLedger = require('../services/memberLedgerService');

  const deps = { getCh, state, aiCall, MODELS, guild, client, getTeamEmoji };
  statLeaders.init(deps);
  rewardBoards.init(deps);
  openTeams.init(deps);
  gameChannels.init(deps);
  memberLedger.init({ getCh, state, guild, client });

  return { statLeaders, rewardBoards, openTeams, gameChannels, memberLedger };
}

module.exports = service;
