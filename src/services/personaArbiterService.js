/*
 * NAVIGATION HEADER
 * FILE: src/services/personaArbiterService.js
 * LAYER: Service layer
 * PURPOSE: Centralized persona arbiter — exactly one winning persona or no reply.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for arbitrate and PRIORITY_ORDER.
 * RELATED FLOW: AI routing in index.js messageCreate, commissioner handler, member handler.
 * NOTE: V184 — introduced as part of the reliability hardening program.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const log = makeLogger('personaArbiter');

/**
 * Persona priority order (highest to lowest).
 * The arbiter evaluates conditions top-down and returns the first match.
 * Only ONE persona ever wins.
 */
const PRIORITY_ORDER = Object.freeze([
  'it-ai',           // Technical diagnostics — highest priority
  'commissioner-ai', // Commissioner brain — admin only
  'member-ai',       // Member trash-talk / help persona
]);

const PERSONA_LABELS = Object.freeze({
  'it-ai': 'IT Diagnostics',
  'commissioner-ai': 'Commissioner AI (Alfred)',
  'member-ai': 'Member AI',
});

/**
 * Decision record for audit trail.
 * @typedef {Object} ArbiterDecision
 * @property {string|null} winner - The winning persona key, or null for no-reply
 * @property {string} reason - Human-readable reason
 * @property {string[]} candidates - Personas that matched conditions
 * @property {number} decidedAt - Timestamp
 * @property {string} messageId - Source message ID
 * @property {string} channelId - Source channel ID
 * @property {string} userId - Author ID
 */

/** @type {ArbiterDecision[]} */
const _decisionLog = [];
const MAX_LOG_SIZE = 500;

function _logDecision(decision) {
  _decisionLog.push(decision);
  if (_decisionLog.length > MAX_LOG_SIZE) _decisionLog.splice(0, _decisionLog.length - MAX_LOG_SIZE);
}

/**
 * Core arbiter function.
 *
 * @param {Object} ctx
 * @param {boolean} ctx.isIT - IT handler match
 * @param {boolean} ctx.isCommissioner - Commissioner handler match
 * @param {boolean} ctx.isMember - Member handler match
 * @param {Object} ctx.message - Discord message object
 * @param {boolean} [ctx.setupActive] - Whether the setup wizard is active (suppresses member AI)
 * @param {boolean} [ctx.botKilled] - Whether the bot is in killed state
 * @returns {ArbiterDecision}
 */
function arbitrate(ctx = {}) {
  const messageId = String(ctx.message?.id || 'unknown');
  const channelId = String(ctx.message?.channel?.id || 'unknown');
  const userId = String(ctx.message?.author?.id || 'unknown');

  // Bot killed — nobody responds
  if (ctx.botKilled) {
    const d = { winner: null, reason: 'bot-killed', candidates: [], decidedAt: Date.now(), messageId, channelId, userId };
    _logDecision(d);
    return d;
  }

  // Collect candidates
  const candidates = [];
  if (ctx.isIT) candidates.push('it-ai');
  if (ctx.isCommissioner) candidates.push('commissioner-ai');
  if (ctx.isMember) candidates.push('member-ai');

  // No candidates — no reply
  if (candidates.length === 0) {
    const d = { winner: null, reason: 'no-matching-persona', candidates, decidedAt: Date.now(), messageId, channelId, userId };
    _logDecision(d);
    return d;
  }

  // Setup active suppresses member-only
  if (ctx.setupActive && candidates.length === 1 && candidates[0] === 'member-ai') {
    const d = { winner: null, reason: 'setup-active-suppresses-member', candidates, decidedAt: Date.now(), messageId, channelId, userId };
    _logDecision(d);
    log.info(`[ARBITER] suppressed member-ai during setup — msg=${messageId}`);
    return d;
  }

  // Priority pick — first match in PRIORITY_ORDER
  let winner = null;
  for (const persona of PRIORITY_ORDER) {
    if (candidates.includes(persona)) {
      winner = persona;
      break;
    }
  }

  const reason = candidates.length > 1
    ? `priority-pick (${candidates.join(', ')} → ${winner})`
    : 'single-candidate';

  const d = { winner, reason, candidates, decidedAt: Date.now(), messageId, channelId, userId };
  _logDecision(d);

  if (candidates.length > 1) {
    log.info(`[ARBITER] multi-candidate: ${candidates.join(', ')} → winner=${winner} msg=${messageId}`);
  }

  return d;
}

/**
 * Returns the last N decisions for diagnostics.
 */
function getRecentDecisions(limit = 20) {
  return _decisionLog.slice(-limit);
}

/**
 * Returns metrics summary.
 */
function getMetrics() {
  const counts = { total: _decisionLog.length, noReply: 0 };
  for (const persona of PRIORITY_ORDER) counts[persona] = 0;

  for (const d of _decisionLog) {
    if (!d.winner) { counts.noReply++; continue; }
    if (counts[d.winner] !== undefined) counts[d.winner]++;
  }
  return counts;
}

module.exports = {
  arbitrate,
  getRecentDecisions,
  getMetrics,
  PRIORITY_ORDER,
  PERSONA_LABELS,
};
