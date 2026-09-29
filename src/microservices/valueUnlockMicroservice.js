/*
 * NAVIGATION HEADER
 * FILE: src/microservices/valueUnlockMicroservice.js
 * LAYER: Operational microservice layer
 * PURPOSE: Prevents duplicate execution and protects single-consumer / idempotent behavior.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually coordinates larger multi-step operations and touches several services.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const state = require('../state');
const { getCh } = require('../services/channels/channelResolver');
const { aiCall, MODELS, getAIStatus } = require('../services/ai/anthropicService');
const { getTeamEmoji } = require('../utils/teamUtils');
const { applyBotIdentity } = require('../services/botIdentityService');

module.exports = {
  key: 'valueUnlockSystems',
  label: 'Phase 3 · Value Unlock Systems',
  async start({ guild, client, logger }) {
    logger.info('Starting Phase 3 · Value Unlock Systems');
    const rewardBoards = require('../services/rewardBoardService');
    const openTeams = require('../services/openTeamsService');
    const activeLeagueService = require('../services/activeLeagueService');
    const { startHubReleaseTimer, startScheduleTimer } = require('../services/hubReleaseService');

    const hasActiveLeague = activeLeagueService.listOperationalLeagues().length > 0 || !!(
      state.leagueConfig?.leagueTypeId &&
      state.leagueConfig?.leagueName &&
      Array.isArray(state.openTeamRegistry) &&
      state.openTeamRegistry.length > 0
    );

    if (hasActiveLeague) {
      await openTeams.refreshOpenTeamsBoard(guild);
      await rewardBoards.refresh(guild);
      logger.info('Board-like modules posted ✅');
    } else {
      logger.info('Board-like modules idle — no active board-enabled community is ready yet.');
    }

    const aiStatus = getAIStatus();
    if (state.hubWeeklyData.week) {
      startHubReleaseTimer(guild, client, state, { getCh, aiCall, MODELS });
      logger.info(`Hub release timer restored for Week ${state.hubWeeklyData.week} ✅${aiStatus.ready ? '' : ' (AI follow-ups will stay disabled until configured)'}`);
    } else {
      logger.info('Release timer idle — run /set-hub-week to begin.');
    }

    if (state.scheduleState.week && state.scheduleState.matchups.length) {
      startScheduleTimer(guild, state, getCh, getTeamEmoji);
      logger.info('Schedule timer restored ✅');
    }

    await applyBotIdentity(client, guild).catch(() => null);
    logger.info('Phase 3 complete ✅');
    return { hasActiveLeague, aiStatus };
  },
};
