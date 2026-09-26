/*
 * NAVIGATION HEADER
 * FILE: src/services/processBuilderService.js
 * LAYER: Service layer
 * PURPOSE: Builds or manages reusable processes and process lifecycle behavior.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * processBuilderService.js
 *
 * PURPOSE:
 * Declarative process builder and management layer for commissioner workflows.
 * Each managed process stores a name, trigger, preset, conditional rules, and
 * a comment policy so future AI/dev edits keep the process self-documented.
 *
 * COMMENT POLICY:
 * Every newly created process carries required comment headers. Any AI or dev
 * extending a process should preserve these notes so the intent never drifts.
 */

const { loadJson, saveJson } = require('../storage/jsonStore');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('process-builder');

const STORE_FILE = 'processBuilder.json';
const MAX_RUN_HISTORY = 100;

const REQUIRED_COMMENT_HEADERS = [
  'PROCESS NAME',
  'PURPOSE',
  'TRIGGER',
  'CONDITIONS',
  'FAILSAFE',
  'ROLLBACK',
];

const PRESETS = {
  'onboarding-foundation': {
    label: 'Onboarding Foundation',
    description: 'Bootstraps the core setup and governance experience after setup completion.',
    trigger: 'setup-complete',
    steps: [
      { action: 'deploy-commands', label: 'Deploy Commands', runIf: ['hasGuild'] },
      { action: 'apply-bot-identity', label: 'Apply Bot Identity', runIf: ['hasClient', 'hasGuild'] },
      { action: 'publish-patch-notes', label: 'Publish Patch Notes', runIf: ['hasGuild'] },
      { action: 'post-automation-status', label: 'Post Automation Status', runIf: ['hasGuild'] },
    ],
  },
  'governance-recovery': {
    label: 'Governance Recovery',
    description: 'Re-applies patch notes, guides, and validation surfaces after resets.',
    trigger: 'reset-complete',
    steps: [
      { action: 'force-refresh-guides', label: 'Refresh Guides', runIf: ['hasGuild'] },
      { action: 'publish-patch-notes', label: 'Publish Patch Notes', runIf: ['hasGuild'] },
      { action: 'validate-settings', label: 'Validate Settings', runIf: [] },
    ],
  },
  'live-ops-loop': {
    label: 'Live Ops Loop',
    description: 'Weekly operational rhythm for patch notes, automation, and command freshness.',
    trigger: 'weekly-schedule',
    steps: [
      { action: 'deploy-commands', label: 'Refresh Commands', runIf: ['hasGuild'] },
      { action: 'post-automation-status', label: 'Automation Status', runIf: ['hasGuild'] },
      { action: 'publish-patch-notes', label: 'Patch Notes Snapshot', runIf: ['hasGuild'] },
    ],
  },
  'community-launch': {
    label: 'Community Launch',
    description: 'Promotes the fresh community experience once core structure is created.',
    trigger: 'community-created',
    steps: [
      { action: 'lock-bot-access', label: 'Lock Bot Access', runIf: ['hasGuild'] },
      { action: 'post-automation-status', label: 'Automation Status', runIf: ['hasGuild'] },
      { action: 'validate-settings', label: 'Validate Settings', runIf: [] },
    ],
  },
  'patch-publish': {
    label: 'Patch Publish',
    description: 'Publishes change context after a code or configuration update.',
    trigger: 'manual',
    steps: [
      { action: 'publish-patch-notes', label: 'Publish Patch Notes', runIf: ['hasGuild'] },
      { action: 'validate-settings', label: 'Validate Settings', runIf: [] },
    ],
  },
};

function _defaultStore() {
  return {
    version: 1,
    policies: {
      requireCommentsForNewProcesses: true,
      requiredCommentHeaders: [...REQUIRED_COMMENT_HEADERS],
      mustReviewPatchNotes: true,
      mustReviewLogs: true,
    },
    definitions: {},
    runHistory: [],
  };
}

function _loadStore() {
  const store = loadJson(STORE_FILE, _defaultStore()) || _defaultStore();
  if (!store.policies) store.policies = _defaultStore().policies;
  if (!store.definitions) store.definitions = {};
  if (!Array.isArray(store.runHistory)) store.runHistory = [];
  return store;
}

function _saveStore(store) {
  saveJson(STORE_FILE, store);
  return store;
}

function _slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function _commentScaffold(name, trigger, description) {
  return [
    `PROCESS NAME: ${name}`,
    `PURPOSE: ${description || 'Managed process definition'}`,
    `TRIGGER: ${trigger || 'manual'}`,
    'CONDITIONS: Verify guild state, permissions, and required services before executing.',
    'FAILSAFE: Abort safely if required context is missing or the interaction is already settled.',
    'ROLLBACK: CONTAINMENT ONLY (ABORT) — if a step fails, stop creating new side effects and log the failing step. Resources already created are NOT removed automatically; compensation must be defined per step when true rollback is possible.',
  ];
}

function listPresets() {
  return Object.entries(PRESETS).map(([key, value]) => ({
    key,
    label: value.label,
    description: value.description,
    trigger: value.trigger,
    stepCount: value.steps.length,
  }));
}

function validateDefinition(input = {}) {
  const errors = [];
  const name = String(input.name || '').trim();
  const preset = String(input.preset || '').trim();
  const trigger = String(input.trigger || PRESETS[preset]?.trigger || 'manual').trim();
  if (!name) errors.push('Name is required.');
  if (!_slug(name)) errors.push('Name must contain letters or numbers.');
  if (!preset || !PRESETS[preset]) errors.push('A valid preset is required.');
  if (!trigger) errors.push('Trigger is required.');
  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      id: _slug(name),
      name,
      description: String(input.description || PRESETS[preset]?.description || '').trim(),
      preset,
      trigger,
      enabled: input.enabled !== false,
      conditions: Array.isArray(input.conditions) ? input.conditions : [],
      tags: Array.isArray(input.tags) ? input.tags : [],
    },
  };
}

function createProcess(input = {}) {
  const store = _loadStore();
  const validation = validateDefinition(input);
  if (!validation.ok) return validation;
  const { normalized } = validation;
  if (store.definitions[normalized.id]) {
    return { ok: false, errors: [`Process ${normalized.name} already exists.`] };
  }
  const preset = PRESETS[normalized.preset];
  const definition = {
    ...normalized,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    steps: preset.steps.map((step, index) => ({ order: index + 1, ...step })),
    commentPolicy: {
      required: true,
      headers: [...REQUIRED_COMMENT_HEADERS],
      scaffold: _commentScaffold(normalized.name, normalized.trigger, normalized.description),
    },
  };
  store.definitions[definition.id] = definition;
  _saveStore(store);
  return { ok: true, definition };
}

function listProcesses() {
  const store = _loadStore();
  return Object.values(store.definitions)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map(def => ({
      id: def.id,
      name: def.name,
      preset: def.preset,
      trigger: def.trigger,
      enabled: def.enabled !== false,
      stepCount: Array.isArray(def.steps) ? def.steps.length : 0,
      updatedAt: def.updatedAt || def.createdAt || 0,
    }));
}

function getProcess(identifier) {
  const store = _loadStore();
  const id = _slug(identifier);
  return store.definitions[id] || null;
}

function deleteProcess(identifier) {
  const store = _loadStore();
  const id = _slug(identifier);
  if (!store.definitions[id]) return { ok: false, error: 'Process not found.' };
  const removed = store.definitions[id];
  delete store.definitions[id];
  _saveStore(store);
  return { ok: true, removed };
}

function toggleProcess(identifier, enabled) {
  const store = _loadStore();
  const id = _slug(identifier);
  const def = store.definitions[id];
  if (!def) return { ok: false, error: 'Process not found.' };
  def.enabled = !!enabled;
  def.updatedAt = Date.now();
  _saveStore(store);
  return { ok: true, definition: def };
}

function getRunHistory(limit = 20) {
  const store = _loadStore();
  return store.runHistory.slice(-limit).reverse();
}

function auditProcesses() {
  const store = _loadStore();
  const items = Object.values(store.definitions).map(def => ({
    id: def.id,
    name: def.name,
    enabled: def.enabled !== false,
    hasCommentPolicy: !!def.commentPolicy?.required,
    missingCommentHeaders: REQUIRED_COMMENT_HEADERS.filter(h => !(def.commentPolicy?.headers || []).includes(h)),
    stepCount: Array.isArray(def.steps) ? def.steps.length : 0,
  }));
  return {
    processCount: items.length,
    enabledCount: items.filter(item => item.enabled).length,
    commentPolicyCoverage: items.filter(item => item.hasCommentPolicy).length,
    items,
  };
}

function _conditionsPass(runIf = [], ctx = {}) {
  const guards = {
    hasGuild: !!ctx.guild,
    hasClient: !!ctx.client,
    hasState: !!ctx.state,
  };
  return runIf.every(key => guards[key] !== false);
}

async function _runAction(action, ctx = {}) {
  switch (action) {
    case 'deploy-commands': {
      const commandRegistry = require('./commandRegistryService');
      return commandRegistry.deployCommandsForCurrentState(ctx.state).catch(err => ({ warning: err.message }));
    }
    case 'publish-patch-notes': {
      const patchNotes = require('./patchNotesService');
      return patchNotes.publishPatchNotes(ctx.guild).catch(err => ({ warning: err.message }));
    }
    case 'apply-bot-identity': {
      const botIdentity = require('./botIdentityService');
      return botIdentity.applyBotIdentity(ctx.client, ctx.guild).catch(err => ({ warning: err.message }));
    }
    case 'lock-bot-access': {
      const botAccess = require('./botAccessService');
      const { COMM_ROLE } = require('../config/env');
      const commRole = ctx.guild?.roles?.cache?.find?.(r => r.name === COMM_ROLE || r.id === COMM_ROLE);
      return botAccess.lockBotAccessGuildWide(ctx.guild, commRole?.id).catch(err => ({ warning: err.message }));
    }
    case 'force-refresh-guides': {
      const guideLifecycle = require('./guideLifecycleService');
      if (ctx.guild?.id) guideLifecycle.forceRefreshAll(ctx.guild.id);
      return { ok: true };
    }
    case 'post-automation-status': {
      const onboardingAuto = require('./onboardingAutomationService');
      return onboardingAuto.postAutomationStatus(ctx.guild).catch(err => ({ warning: err.message }));
    }
    case 'validate-settings': {
      const serverSettings = require('./serverSettingsService');
      const settings = serverSettings.getSettings();
      return {
        ok: true,
        template: settings.serverTemplate || null,
        audience: settings.audienceRating || null,
        initialized: !!settings.serverInitialized,
      };
    }
    default:
      throw new Error(`Unsupported process action: ${action}`);
  }
}

async function runProcess(identifier, ctx = {}) {
  const store = _loadStore();
  const id = _slug(identifier);
  const def = store.definitions[id];
  if (!def) return { ok: false, error: 'Process not found.' };
  if (def.enabled === false) return { ok: false, error: 'Process is disabled.' };

  const results = [];
  for (const step of def.steps || []) {
    if (!_conditionsPass(step.runIf, ctx)) {
      results.push({ step: step.label, status: 'skipped', reason: 'conditions-not-met' });
      continue;
    }
    try {
      const result = await _runAction(step.action, ctx);
      results.push({ step: step.label, status: 'completed', result });
    } catch (err) {
      const failure = { step: step.label, status: 'failed', error: err.message || String(err) };
      results.push(failure);
      _recordRun(store, def, ctx, results, false);
      _saveStore(store);
      return { ok: false, definition: def, results, error: failure.error };
    }
  }

  _recordRun(store, def, ctx, results, true);
  _saveStore(store);
  return { ok: true, definition: def, results };
}

function _recordRun(store, def, ctx, results, ok) {
  store.runHistory.push({
    processId: def.id,
    processName: def.name,
    trigger: def.trigger,
    ok,
    guildId: ctx.guild?.id || null,
    startedAt: Date.now(),
    resultCount: results.length,
    failedSteps: results.filter(item => item.status === 'failed').map(item => item.step),
  });
  if (store.runHistory.length > MAX_RUN_HISTORY) {
    store.runHistory.splice(0, store.runHistory.length - MAX_RUN_HISTORY);
  }
}

function ensureSeedProcesses() {
  const store = _loadStore();
  if (Object.keys(store.definitions).length) return listProcesses();
  createProcess({ name: 'Onboarding Foundation', preset: 'onboarding-foundation' });
  createProcess({ name: 'Governance Recovery', preset: 'governance-recovery' });
  return listProcesses();
}

module.exports = {
  REQUIRED_COMMENT_HEADERS,
  PRESETS,
  listPresets,
  validateDefinition,
  createProcess,
  listProcesses,
  getProcess,
  deleteProcess,
  toggleProcess,
  runProcess,
  getRunHistory,
  auditProcesses,
  ensureSeedProcesses,
};
