/*
 * NAVIGATION HEADER
 * FILE: src/services/workflowEngineService.js
 * LAYER: Service layer
 * PURPOSE: Defines, routes, or executes workflow / flow logic.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * workflowEngineService.js
 *
 * Trigger-based workflow engine for NOFUNLEAGUE.
 * Allows commands and background jobs to fire conditional follow-up
 * actions, chained steps, and event-driven automations without
 * hardcoding logic into the interaction router.
 *
 * Usage:
 *   const workflow = require('./workflowEngineService');
 *
 *   // Register a named workflow
 *   workflow.define('post-build', [
 *     { step: 'deploy-commands', fn: async (ctx) => { ... } },
 *     { step: 'publish-patch-notes', fn: async (ctx) => { ... } },
 *   ]);
 *
 *   // Run it
 *   await workflow.run('post-build', { guild, state });
 *
 *   // Register a trigger
 *   workflow.onEvent('job:trash-the-bot:completed', async (ctx) => { ... });
 *   workflow.emit('job:trash-the-bot:completed', { guild, result });
 */

const { makeLogger } = require('../utils/logger');
const log = makeLogger('workflow');

/** @type {Map<string, Array<{step:string, fn:Function, condition?:Function}>>} */
const _workflows = new Map();

/** @type {Map<string, Array<Function>>} */
const _eventListeners = new Map();

/** @type {Array<{workflowId:string, step:string, status:string, startedAt:number, error?:string}>} */
const _runLog = [];
const MAX_LOG = 200;

// ── Workflow definitions ────────────────────────────────────

/**
 * Define a named multi-step workflow.
 * Steps run in sequence; a step with `condition` is skipped when condition returns false.
 */
function define(name, steps) {
  if (!name || !Array.isArray(steps)) throw new Error('workflow.define: name + steps[] required');
  _workflows.set(String(name), steps);
  log.info(`workflow defined: ${name} (${steps.length} steps)`);
}

/**
 * Run a named workflow with the given context object.
 * Returns { ok, results, errors }.
 */
async function run(name, ctx = {}) {
  const steps = _workflows.get(String(name));
  if (!steps) {
    log.warn(`workflow.run: unknown workflow "${name}"`);
    return { ok: false, results: [], errors: [`Unknown workflow: ${name}`] };
  }
  const workflowId = `wf-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  log.info(`▶ workflow "${name}" started (${workflowId})`);
  const results = [];
  const errors = [];

  // V191: Make step results accessible to subsequent steps via ctx._stepResults and ctx._errors
  ctx._stepResults = ctx._stepResults || {};
  ctx._errors = errors;

  for (const { step, fn, condition } of steps) {
    if (typeof condition === 'function') {
      let skip = false;
      try { skip = !(await condition(ctx)); } catch { skip = true; }
      if (skip) {
        _pushLog(workflowId, step, 'skipped');
        log.info(`  ⏭ step "${step}" skipped`);
        continue;
      }
    }
    _pushLog(workflowId, step, 'running');
    try {
      const result = await fn(ctx);
      results.push({ step, result });
      ctx._stepResults[step] = result;
      _pushLog(workflowId, step, 'completed');
      log.info(`  ✅ step "${step}" done`);
    } catch (err) {
      const msg = err?.message || String(err);
      errors.push({ step, error: msg });
      _pushLog(workflowId, step, 'failed', msg);
      log.error(`  ❌ step "${step}" failed: ${msg}`);
      // Continue remaining steps unless ctx.stopOnError is set
      if (ctx.stopOnError) break;
    }
  }

  const ok = errors.length === 0;
  log.info(`${ok ? '✅' : '⚠️'} workflow "${name}" finished — ${results.length} ok, ${errors.length} errors`);
  return { ok, workflowId, results, errors };
}

// ── Event bus ───────────────────────────────────────────────

/**
 * Register a listener for a named event.
 * Event names can include wildcards: 'job:*:completed'
 */
function onEvent(eventName, handler) {
  if (typeof handler !== 'function') throw new Error('onEvent: handler must be a function');
  if (!_eventListeners.has(eventName)) _eventListeners.set(eventName, []);
  _eventListeners.get(eventName).push(handler);
}

/**
 * Emit an event and run all matching listeners.
 * Listeners run in parallel; errors are logged but do not throw.
 */
async function emit(eventName, ctx = {}) {
  const matched = [];
  for (const [pattern, handlers] of _eventListeners) {
    if (_matchEvent(pattern, eventName)) matched.push(...handlers);
  }
  if (!matched.length) return;
  log.info(`event "${eventName}" → ${matched.length} listener(s)`);
  await Promise.allSettled(matched.map(h => {
    try { return Promise.resolve(h({ ...ctx, _event: eventName })); }
    catch (e) { return Promise.reject(e); }
  })).then(results => {
    results.forEach((r, i) => {
      if (r.status === 'rejected') log.error(`event "${eventName}" listener[${i}] failed:`, r.reason?.message);
    });
  });
}

function _matchEvent(pattern, event) {
  if (pattern === event) return true;
  // Support simple glob: 'job:*:completed'
  const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^:]+') + '$');
  return re.test(event);
}

// ── Convenience: job lifecycle hooks ────────────────────────

/**
 * Emit a job lifecycle event so any registered workflow can react.
 * Call this from backgroundJobService after mark* calls.
 */
async function emitJobEvent(jobType, lifecycle, ctx = {}) {
  await emit(`job:${jobType}:${lifecycle}`, ctx);
}

// ── Run log ─────────────────────────────────────────────────

function _pushLog(workflowId, step, status, error) {
  _runLog.push({ workflowId, step, status, startedAt: Date.now(), error });
  if (_runLog.length > MAX_LOG) _runLog.splice(0, _runLog.length - MAX_LOG);
}

function getRunLog(limit = 50) {
  return _runLog.slice(-limit).reverse();
}

function listWorkflows() {
  return [..._workflows.entries()].map(([name, steps]) => ({ name, stepCount: steps.length }));
}

// ── Built-in workflow definitions ────────────────────────────
// These are registered here so any caller can `run('post-build', ctx)`.

define('post-build', [
  {
    step: 'deploy-commands',
    condition: ctx => !!ctx.state,
    fn: async ctx => {
      const { deployCommandsForCurrentState } = require('./commandRegistryService');
      await deployCommandsForCurrentState(ctx.state).catch(e => log.warn('deploy-commands:', e.message));
    },
  },
  {
    step: 'publish-patch-notes',
    condition: ctx => !!ctx.guild,
    fn: async ctx => {
      const patchNotes = require('./patchNotesService');
      await patchNotes.publishPatchNotes(ctx.guild).catch(e => log.warn('publish-patch-notes:', e.message));
    },
  },
  {
    step: 'apply-bot-identity',
    condition: ctx => !!(ctx.client && ctx.guild),
    fn: async ctx => {
      const botIdentity = require('./botIdentityService');
      await botIdentity.applyBotIdentity(ctx.client, ctx.guild).catch(e => log.warn('apply-bot-identity:', e.message));
    },
  },
  {
    step: 'lock-bot-access',
    condition: ctx => !!ctx.guild,
    fn: async ctx => {
      const botAccess = require('./botAccessService');
      const { COMM_ROLE } = require('../config/env');
      const commRole = ctx.guild.roles.cache.find(r => r.name === COMM_ROLE || r.id === COMM_ROLE);
      await botAccess.lockBotAccessGuildWide(ctx.guild, commRole?.id).catch(e => log.warn('lock-bot-access:', e.message));
    },
  },
]);

define('post-trash', [
  {
    step: 'force-refresh-guides',
    condition: ctx => !!ctx.guild,
    fn: async ctx => {
      const guideLifecycle = require('./guideLifecycleService');
      guideLifecycle.forceRefreshAll(ctx.guild.id);
    },
  },
  {
    step: 'post-automation-status',
    condition: ctx => !!ctx.guild,
    fn: async ctx => {
      const onboardingAuto = require('./onboardingAutomationService');
      await onboardingAuto.postAutomationStatus(ctx.guild).catch(e => log.warn('post-automation-status:', e.message));
    },
  },
]);

define('post-league-reset', [
  {
    step: 'sync-team-registry',
    condition: ctx => !!(ctx.state && ctx.teamRegistry),
    fn: async ctx => {
      ctx.teamRegistry.syncFromState(ctx.state);
    },
  },
  {
    step: 'refresh-open-teams-board',
    condition: ctx => !!(ctx.guild && ctx.openTeamsService),
    fn: async ctx => {
      await ctx.openTeamsService.refreshOpenTeamsBoard(ctx.guild).catch(e => log.warn('refresh-open-teams:', e.message));
    },
  },
  {
    step: 'reset-hub-week',
    condition: ctx => !!(ctx.hubReleaseService && ctx.state),
    fn: async ctx => {
      ctx.hubReleaseService.resetHubWeek(1, ctx.state);
    },
  },
]);

module.exports = {
  define,
  run,
  onEvent,
  emit,
  emitJobEvent,
  getRunLog,
  listWorkflows,
};


// ── Managed process bootstrap ──────────────────────────────────────────────
try {
  const processBuilder = require('./processBuilderService');
  processBuilder.ensureSeedProcesses();
} catch (err) {
  log.warn(`managed process bootstrap skipped: ${err.message}`);
}

// ── V191: Register all flow definitions ────────────────────────────────────
try {
  const flowDefinitions = require('./flowDefinitions');
  flowDefinitions.registerAll(module.exports);
} catch (err) {
  log.warn(`flow definitions registration skipped: ${err.message}`);
}
