/*
 * NAVIGATION HEADER
 * FILE: src/services/responseLifecycleService.js
 * LAYER: Service layer
 * PURPOSE: Centralized response lifecycle: receive → validate → claim → route → respond/defer → settle → log.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for executeLifecycle and _settleResponse.
 * RELATED FLOW: All AI handler paths (commissioner, member, IT), persona arbiter, event claims.
 * NOTE: V184 — introduced as part of the reliability hardening program.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const responseGuard = require('./responseGuardService');
const eventClaim = require('./eventClaimService');
const observability = require('./observabilityService');
const log = makeLogger('responseLifecycle');

/**
 * Lifecycle phases.
 */
const PHASE = Object.freeze({
  RECEIVE:  'receive',
  VALIDATE: 'validate',
  CLAIM:    'claim',
  ROUTE:    'route',
  RESPOND:  'respond',
  SETTLE:   'settle',
  LOG:      'log',
});

/**
 * Outcome codes for the lifecycle.
 */
const OUTCOME = Object.freeze({
  SUCCESS:       'success',
  DEDUPED:       'deduped',
  VALIDATION_FAIL: 'validation-fail',
  CLAIM_LOST:    'claim-lost',
  NO_ROUTE:      'no-route',
  HANDLER_ERROR: 'handler-error',
  SETTLED:       'settled',
});

/** @type {Map<string, Object>} Active lifecycle contexts keyed by message/interaction ID */
const _active = new Map();
const MAX_ACTIVE = 500;

function _sweep() {
  if (_active.size <= MAX_ACTIVE) return;
  const now = Date.now();
  for (const [key, ctx] of _active.entries()) {
    if (now - ctx.startedAt > 120_000) _active.delete(key);
    if (_active.size <= MAX_ACTIVE * 0.8) break;
  }
}

/**
 * Begin a response lifecycle for a message-based AI route.
 *
 * @param {Object} opts
 * @param {Object} opts.message - Discord message
 * @param {string} opts.persona - Winning persona from arbiter
 * @param {Function} opts.handler - Async handler function to execute
 * @param {Object} [opts.handlerArgs] - Extra args to pass to handler
 * @param {Object} [opts.validators] - Optional preflight validators { name: () => boolean }
 * @returns {Promise<{outcome: string, phase: string, error?: string, durationMs: number}>}
 */
async function executeLifecycle(opts = {}) {
  const { message, persona, handler, handlerArgs = {}, validators = {} } = opts;
  const messageId = String(message?.id || 'unknown');
  const startedAt = Date.now();

  _sweep();

  const ctx = {
    messageId,
    persona,
    startedAt,
    phase: PHASE.RECEIVE,
    outcome: null,
  };
  _active.set(messageId, ctx);

  try {
    // ── VALIDATE ──
    ctx.phase = PHASE.VALIDATE;
    for (const [name, validator] of Object.entries(validators)) {
      try {
        const ok = typeof validator === 'function' ? await validator() : !!validator;
        if (!ok) {
          ctx.outcome = OUTCOME.VALIDATION_FAIL;
          log.info(`[LIFECYCLE] validation failed: ${name} — msg=${messageId} persona=${persona}`);
          return _finish(ctx);
        }
      } catch (valErr) {
        ctx.outcome = OUTCOME.VALIDATION_FAIL;
        log.error(`[LIFECYCLE] validator ${name} threw — msg=${messageId}`, valErr.message);
        return _finish(ctx);
      }
    }

    // ── CLAIM ──
    ctx.phase = PHASE.CLAIM;
    if (!responseGuard.claimMessageRoute(message, 20000)) {
      ctx.outcome = OUTCOME.DEDUPED;
      log.info(`[LIFECYCLE] route deduped — msg=${messageId} persona=${persona}`);
      return _finish(ctx);
    }
    const distributedResponseKey = eventClaim.aiResponseKey(message);
    if (!(await eventClaim.claim(distributedResponseKey, 20000))) {
      ctx.outcome = OUTCOME.CLAIM_LOST;
      log.info(`[LIFECYCLE] distributed response claim lost — msg=${messageId} persona=${persona}`);
      return _finish(ctx);
    }
    if (!responseGuard.claimMessageResponse(message, persona, 12000)) {
      ctx.outcome = OUTCOME.CLAIM_LOST;
      log.info(`[LIFECYCLE] response claim lost — msg=${messageId} persona=${persona}`);
      return _finish(ctx);
    }

    // ── ROUTE → RESPOND ──
    ctx.phase = PHASE.RESPOND;
    if (typeof handler !== 'function') {
      ctx.outcome = OUTCOME.NO_ROUTE;
      log.warn(`[LIFECYCLE] no handler — msg=${messageId} persona=${persona}`);
      return _finish(ctx);
    }

    await handler(message, handlerArgs);
    ctx.outcome = OUTCOME.SUCCESS;

  } catch (handlerErr) {
    ctx.outcome = OUTCOME.HANDLER_ERROR;
    ctx.error = handlerErr?.message || String(handlerErr);
    log.error(`[LIFECYCLE] handler error — msg=${messageId} persona=${persona}:`, ctx.error);
  }

  // ── SETTLE + LOG ──
  return _finish(ctx);
}

function _finish(ctx) {
  ctx.phase = PHASE.SETTLE;
  const durationMs = Date.now() - ctx.startedAt;
  _active.delete(ctx.messageId);

  // Emit to observability
  observability.recordFlowOutcome('response-lifecycle', {
    messageId: ctx.messageId,
    persona: ctx.persona,
    outcome: ctx.outcome,
    durationMs,
    error: ctx.error || null,
  });

  ctx.phase = PHASE.LOG;
  log.info(`[LIFECYCLE] ${ctx.outcome} — msg=${ctx.messageId} persona=${ctx.persona} ${durationMs}ms`);

  return {
    outcome: ctx.outcome,
    phase: ctx.phase,
    error: ctx.error || undefined,
    durationMs,
  };
}

/**
 * Execute a lifecycle for an interaction (slash command, button, modal, autocomplete).
 */
async function executeInteractionLifecycle(opts = {}) {
  const { interaction, handler, handlerArgs = {} } = opts;
  const interactionId = String(interaction?.id || 'unknown');
  const commandName = interaction?.commandName || interaction?.customId || 'unknown';
  const startedAt = Date.now();

  _sweep();

  const ctx = {
    messageId: interactionId,
    persona: `interaction:${commandName}`,
    startedAt,
    phase: PHASE.RECEIVE,
    outcome: null,
  };
  _active.set(interactionId, ctx);

  try {
    // ── CLAIM ──
    ctx.phase = PHASE.CLAIM;
    if (!responseGuard.claimInteractionExecution(interaction, 8000)) {
      ctx.outcome = OUTCOME.DEDUPED;
      log.info(`[LIFECYCLE:IX] deduped — ix=${interactionId} cmd=${commandName}`);
      return _finish(ctx);
    }
    if (responseGuard.isInteractionSettled(interaction)) {
      ctx.outcome = OUTCOME.SETTLED;
      log.info(`[LIFECYCLE:IX] already settled — ix=${interactionId} cmd=${commandName}`);
      return _finish(ctx);
    }

    // ── RESPOND ──
    ctx.phase = PHASE.RESPOND;
    if (typeof handler !== 'function') {
      ctx.outcome = OUTCOME.NO_ROUTE;
      return _finish(ctx);
    }

    await handler(interaction, handlerArgs);
    ctx.outcome = OUTCOME.SUCCESS;

    responseGuard.markInteractionSettled(interaction);

  } catch (handlerErr) {
    ctx.outcome = OUTCOME.HANDLER_ERROR;
    ctx.error = handlerErr?.message || String(handlerErr);
    log.error(`[LIFECYCLE:IX] error — ix=${interactionId} cmd=${commandName}:`, ctx.error);
  }

  return _finish(ctx);
}

/**
 * Returns count of currently active lifecycles (diagnostic).
 */
function getActiveCount() {
  return _active.size;
}

module.exports = {
  executeLifecycle,
  executeInteractionLifecycle,
  getActiveCount,
  PHASE,
  OUTCOME,
};
