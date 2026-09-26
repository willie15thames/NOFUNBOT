/*
 * NAVIGATION HEADER
 * FILE: src/microservices/automationAccessMicroservice.js
 * LAYER: Operational microservice layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually coordinates larger multi-step operations and touches several services.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const state = require('../state');
const { resolveCommissionerRoleId } = require('../services/accessPolicyService');

let _activeCheckTimer = null; // V202: single scheduler handle (re-entry safe)

module.exports = {
  key: 'automationAndAccess',
  label: 'Phase 4 · Automation + Access',
  async start({ guild, processDueActiveChecks, logger }) {
    logger.info('Starting Phase 4 · Automation + Access');
    try {
      const botAccess = require('../services/botAccessService');
      const { COMM_ROLE } = require('../config/env');
      const commRoleId = resolveCommissionerRoleId(guild, COMM_ROLE);
      const isAdmin = botAccess.checkBotGuildAdmin(guild);
      if (!isAdmin) {
        logger.warn('⚠️ Bot does NOT have Administrator permission at guild level. Some features may fail.');
      } else {
        logger.info('🔒 Bot access: Administrator confirmed ✅');
      }
      const fixed = await botAccess.lockBotAccessGuildWide(guild, commRoleId).catch(() => 0);
      if (fixed > 0) logger.info(`🔒 Bot access lock: restored on ${fixed} channel(s).`);
    } catch (err) {
      logger.warn(`Bot access lock startup check failed: ${err.message}`);
    }

    // V202 (BUG-008): SINGLE owner of the hourly active-check scheduler (behavior identical to pre-V202 Phase 4:
    // immediate run + hourly). Re-entry clears the previous handle, and leagueFeatureService.processDueActiveChecks
    // is single-flight so overlapping runs cannot double-process a league window. Per-league enablement is still
    // decided inside processDueActiveChecks (activeCheckEnabled + channelId).
    if (typeof processDueActiveChecks === 'function') {
      if (_activeCheckTimer) { clearInterval(_activeCheckTimer); _activeCheckTimer = null; }
      const runActiveChecks = () => {
        const liveGuild = guild.client?.guilds?.cache?.get(guild.id) || guild;
        processDueActiveChecks(liveGuild, state).catch(err => logger.warn(`Active check cycle error: ${err.message}`));
      };
      _activeCheckTimer = setInterval(runActiveChecks, 60 * 60 * 1000);
      if (typeof _activeCheckTimer.unref === 'function') _activeCheckTimer.unref();
      runActiveChecks();
      logger.info('Active check scheduler armed (single owner) ✅');
    }

    // V202: league advance wake-up scheduler (timer = wake-up only; deadline/state are persisted in leagueRuntime.json)
    let advanceSchedulerArmed = false;
    try {
      const r = require('../services/leagueAutomationService').start({ guild, state });
      advanceSchedulerArmed = !!r.started;
      logger.info(`League advance scheduler ${advanceSchedulerArmed ? 'armed ✅' : `not armed (${r.reason})`}`);
    } catch (err) {
      logger.warn(`League advance scheduler failed to start: ${err.message}`);
    }

    // V202: provider ingestion receiver (Companion export / NeonSportz webhook). Off unless ENABLE_PROVIDER_HTTP=true.
    try {
      const http = require('../http/providerHttpServer').start();
      if (http.started) logger.info(`Provider HTTP receiver started on :${http.port} ✅`);
    } catch (err) {
      logger.warn(`Provider HTTP receiver failed to start: ${err.message}`);
    }

    logger.info('Phase 4 complete ✅');
    return { activeChecksArmed: typeof processDueActiveChecks === 'function', advanceSchedulerArmed };
  },
};
