/*
 * NAVIGATION HEADER
 * FILE: src/services/leagueAutomationService.js
 * LAYER: Service layer (V202)
 * PURPOSE: The single wake-up scheduler for the advance engine. Owns ONE process timer per guild, re-armed after
 *          every tick to the earliest of: nextAdvanceAt, nextRetryAt, or a 15-minute poll (AWAITING_SOURCE_ADVANCE
 *          read-back / approaching-deadline checks). The timer is NOT the authority — nextAdvanceAt and the state
 *          machine live in leagueRuntime.json, so a restart re-arms from persisted intent (rule 18/19).
 *          Generation token + single-flight in the engine prevent overlapping ticks.
 * LOOK HERE FIRST WHEN DEBUGGING: start(), stop(), status().
 * RELATED FLOW: automationAccessMicroservice (Phase 4 starts it), league/advanceEngine.tick.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const log = makeLogger('leagueAutomation');

const POLL_MS = 15 * 60 * 1000;
const MIN_DELAY_MS = 5 * 1000;
const _timers = new Map(); // guildId → { handle, generation, nextWakeAt }

function _entry(guildId) {
  if (!_timers.has(guildId)) _timers.set(guildId, { handle: null, generation: 0, nextWakeAt: null, started: false });
  return _timers.get(guildId);
}

function _computeDelay() {
  const rt = require('../league/runtimeService').getRuntime();
  const now = Date.now();
  const candidates = [now + POLL_MS];
  if (rt.nextAdvanceAt) candidates.push(Number(rt.nextAdvanceAt));
  if (rt.nextRetryAt) candidates.push(Number(rt.nextRetryAt));
  return Math.max(MIN_DELAY_MS, Math.min(...candidates) - now);
}

function stop(guildId) {
  const id = require('../league/spaceContext').current();
  const timerKey = id ? `${guildId}:${id}` : String(guildId || 'global');
  const e = _entry(timerKey);
  e.generation += 1;
  if (e.handle) clearTimeout(e.handle);
  e.handle = null; e.nextWakeAt = null; e.started = false;
  return e.generation;
}

function _arm(guild, state, generation) {
  const id = require('../league/spaceContext').current();
  const e = _entry(id ? `${guild.id}:${id}` : guild.id);
  if (e.generation !== generation) return;
  const delay = _computeDelay();
  e.nextWakeAt = Date.now() + delay;
  e.handle = setTimeout(async () => {
    if (e.generation !== generation) return;
    try {
      const spaceId = require('../league/spaceContext').current();
      if (spaceId && (!require('./activeLeagueService').getLeague(spaceId) || require('./activeLeagueService').getLeague(spaceId).status === 'ARCHIVING')) { stop(guild.id); return; }
      const live = guild.client?.guilds?.cache?.get(guild.id) || guild;
      await require('../league/advanceEngine').tick({ guild: live, state, reason: 'scheduler' });
      state.flushSpace?.();
      await require('../storage/jsonStore').flushSpaceWrites();
    } catch (err) { log.warn(`tick error: ${err.message}`); }
    _arm(guild, state, generation);
  }, delay);
  if (typeof e.handle.unref === 'function') e.handle.unref();
}

/** Start (or restart) the scheduler for a guild. Safe to call repeatedly — previous timer is cancelled. */
function start({ guild, state } = {}) {
  const scope = require('../league/spaceContext');
  if (guild?.id && !scope.current()) {
    const leagues = require('./activeLeagueService').listProviderTargets();
    if (leagues.length) return {started:true,spaces:leagues.map(l=>scope.run(l.id,()=>start({guild,state})))};
  }
  if (!guild?.id) return { started: false, reason: 'no-guild' };
  state = state || require('../state');
  const generation = stop(guild.id);
  const id = require('../league/spaceContext').current();
  const e = _entry(id ? `${guild.id}:${id}` : guild.id);
  e.started = true;
  require('../league/advanceEngine').recoverOnBoot(state);
  _arm(guild, state, generation);
  log.info(`scheduler armed (gen ${generation}) next wake in ${Math.round((e.nextWakeAt - Date.now()) / 60000)}m`);
  return { started: true, generation, nextWakeAt: e.nextWakeAt };
}

/** Re-arm immediately after a manual action so the next wake reflects new deadlines. */
function rearm({ guild, state } = {}) {
  if (!guild?.id) return null;
  const id = require('../league/spaceContext').current();
  const e = _entry(id ? `${guild.id}:${id}` : guild.id);
  if (!e.started) return null;
  return start({ guild, state });
}

function status(guildId) {
  const id = require('../league/spaceContext').current();
  const e = _timers.get(id ? `${guildId}:${id}` : String(guildId || ''));
  return e ? { started: e.started, generation: e.generation, nextWakeAt: e.nextWakeAt } : { started: false, generation: 0, nextWakeAt: null };
}

module.exports = { start, stop, rearm, status, POLL_MS };
