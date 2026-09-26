/*
 * NAVIGATION HEADER
 * FILE: src/actions/actionExecutor.js
 * LAYER: AI action layer (V202)
 * PURPOSE: Executes validated AI plans. Confirmation is decided by the APPLICATION (catalog confirmation policy,
 *          or the model asking for it) — never skipped because the model or user "sounds sure". If any action in a
 *          plan needs confirmation the whole plan is held (atomic plan, no partial side effects) and a confirmation
 *          token is issued. Unsupported / invalid actions are reported to the commissioner as structured results.
 *          Failures are reported as failures — never as success (runtime instruction ERROR HANDLING).
 * LOOK HERE FIRST WHEN DEBUGGING: executePlan(), runActions().
 * RELATED FLOW: handlers/commissionerHandler (plan from AI / fast path), routing/interactionRouter (Confirm button).
 * NOTE: Audit records are concise metadata only (type, actor, ok, reason) — no hidden reasoning is stored.
 */

'use strict';

const catalog = require('./actionCatalog');
const confirmation = require('./confirmationService');
const { makeLogger } = require('../utils/logger');

const log = makeLogger('aiActions');

function _audit(type, ctx, outcome) {
  log.info(`[ai-action] type=${type} actor=${ctx.actorId || 'unknown'} ok=${outcome.ok}${outcome.ok ? '' : ` reason=${String(outcome.reason || '').slice(0, 160)}`}`);
  try { require('../services/observabilityService').recordFlowOutcome('ai-action', { outcome: outcome.ok ? 'success' : 'action-failed', type }); } catch {}
}

/** Run already-validated (and, if required, confirmed) actions sequentially. */
async function runActions(validActions, ctx) {
  const results = [];
  for (const { action } of validActions) {
    const def = catalog.getAction(action.type);
    if (!def) { const o = { ok: false, reason: 'unsupported_action' }; _audit(action.type, ctx, o); results.push({ type: action.type, ...o }); continue; }
    let outcome;
    try { outcome = await def.execute(action.fields, ctx); }
    catch (e) { outcome = { ok: false, reason: e.message }; }
    if (!outcome || typeof outcome.ok !== 'boolean') outcome = { ok: false, reason: 'executor returned no result' };
    _audit(action.type, ctx, outcome);
    results.push({ type: action.type, ...outcome });
  }
  return results;
}

function describeAction({ action, def }) {
  const f = action.fields || {};
  const detail = Object.entries(f).filter(([k]) => k !== 'userId').map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`).join(', ');
  return `• **${action.type}**${detail ? ` (${detail})` : ''}${def.destructive ? ' — destructive' : ''}`;
}

/**
 * @param {object} plan  output of actionValidator.validatePlan
 * @param {object} ctx   { guild, channelId, actorId, actorTag, state, client, getCh, aiCall, MODELS, requestId }
 * @returns {Promise<{results:object[], rejected:object[], pending:{token:string, summary:string, expiresAt:number}|null}>}
 */
async function executePlan(plan, ctx) {
  const rejected = (plan.rejected || []).map(r => ({ type: r.type, ok: false, reason: r.code === 'unsupported_action' ? `unsupported action — ${r.reason}` : `invalid action — ${r.reason}` }));
  for (const r of rejected) _audit(r.type || 'unknown', ctx, r);
  const valid = plan.valid || [];
  if (!valid.length) return { results: [], rejected, pending: null };
  const needsConfirm = plan.requiresConfirmation || valid.some(v => catalog.requiresConfirmation(v.def, v.action.fields));
  if (needsConfirm) {
    const summary = valid.map(describeAction).join('\n');
    const { token, expiresAt } = confirmation.create({ guildId: ctx.guild?.id, channelId: ctx.channelId, requesterId: ctx.actorId, actions: valid.map(v => v.action), summary });
    log.info(`[ai-action] confirmation required token=${token.slice(0, 6)}… actions=${valid.map(v => v.action.type).join(',')} actor=${ctx.actorId}`);
    return { results: [], rejected, pending: { token, summary, expiresAt } };
  }
  const results = await runActions(valid, ctx);
  return { results, rejected, pending: null };
}

/** Execute a consumed confirmation entry. Actions are re-validated against the CURRENT catalog before running. */
async function runConfirmed(entry, ctx) {
  const validator = require('./actionValidator');
  const valid = [];
  const rejected = [];
  for (const a of entry.actions || []) {
    const r = validator.validateAction({ type: a.type, ...(a.fields || {}) });
    if (r.ok) valid.push(r); else rejected.push({ type: r.type, ok: false, reason: r.reason });
  }
  const results = await runActions(valid, ctx);
  return { results, rejected };
}

function formatResults({ results = [], rejected = [] }) {
  const lines = [];
  for (const r of results) lines.push(r.ok ? r.message : `❌ \`${r.type}\` failed: ${r.reason}`);
  for (const r of rejected) lines.push(`⚠️ \`${r.type || 'unknown'}\` not executed: ${r.reason}. If this is something you need, use the matching slash command.`);
  return lines.join('\n');
}

module.exports = { executePlan, runActions, runConfirmed, formatResults, describeAction };
