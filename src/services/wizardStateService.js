/*
 * NAVIGATION HEADER
 * FILE: src/services/wizardStateService.js
 * LAYER: Service layer
 * PURPOSE: Supports setup wizard rendering, state, routing, or lifecycle behavior.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * wizardStateService.js — Wizard State Machine V134
 *
 * Single source of truth for wizard state. Replaces scattered wizard stage
 * strings across router, wizard, commAI, gate logic, and build paths.
 *
 * State shape:
 *   currentStep      — active wizard stage (flow | mode | custom_structure | tone | finalize)
 *   subStep          — optional sub-stage within currentStep
 *   completedSteps   — Set of steps the user has completed and advanced past
 *   activeMessageId  — the one wizard message id that gets edited in place
 *   installationMode — true during setup, false after build
 *   editMode         — true after first successful build
 *   lastAdvancedAt   — timestamp of last step transition
 *   lastBuildAt      — timestamp of last successful server build
 *
 * Enforced rules (matches Section 3.2–3.4 of the blueprint):
 *   - Only one active step at a time
 *   - Only one active wizard message (activeMessageId)
 *   - Step transitions must go forward or explicitly back
 *   - Cannot advance to finalize without completing required fields
 */

const { loadJson, saveJson } = require('../storage/jsonStore');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('wizardState');

const FILE = 'wizardState.json';

// Canonical ordered step list — the only valid wizard stages
const STEPS = ['flow', 'mode', 'custom_structure', 'tone', 'finalize'];
const STEP_SET = new Set(STEPS);

const DEFAULTS = {
  currentStep: 'flow',
  subStep: null,
  completedSteps: [],
  activeMessageId: null,
  installationMode: true,
  editMode: false,
  lastAdvancedAt: null,
  lastBuildAt: null,
  selectedSetupMode: null,   // 'standard' | 'custom'
};

// ── Persistence ───────────────────────────────────────────────────────────

function _load() {
  return { ...DEFAULTS, ...loadJson(FILE, DEFAULTS) };
}

function _save(state) {
  saveJson(FILE, state);

  // Dual-write to Prisma (non-blocking — JSON is still primary)
  try {
    const { getGuildId } = require('./serverConfigBootstrap');
    const { prismaSafe } = require('../storage/prisma');
    const guildId = getGuildId();
    if (guildId) {
      const dbFields = {
        currentStep: state.currentStep || 'flow',
        subStep: state.subStep || null,
        completedSteps: state.completedSteps || [],
        activeMessageId: state.activeMessageId || null,
        installationMode: !!state.installationMode,
        editMode: !!state.editMode,
        selectedSetupMode: state.selectedSetupMode || null,
        lastAdvancedAt: state.lastAdvancedAt ? new Date(state.lastAdvancedAt) : null,
        lastBuildAt: state.lastBuildAt ? new Date(state.lastBuildAt) : null,
        updatedAt: new Date(),
      };
      prismaSafe(prisma => prisma.wizardState.upsert({
        where: { guildId: String(guildId) },
        create: { guildId: String(guildId), ...dbFields },
        update: dbFields,
      }), null).catch(() => null);
    }
  } catch (_e) {}

  return state;
}

// ── Getters ───────────────────────────────────────────────────────────────

function getState() {
  return _load();
}

function getCurrentStep() {
  return _load().currentStep || 'flow';
}

function getActiveMessageId() {
  return _load().activeMessageId || null;
}

function isInstallationMode() {
  return !!_load().installationMode;
}

function isEditMode() {
  return !!_load().editMode;
}

function hasCompleted(step) {
  const state = _load();
  return (state.completedSteps || []).includes(step);
}

// ── Mutations ─────────────────────────────────────────────────────────────

/**
 * Advance to the next logical step.
 * Returns { ok, step, reason } — callers must check ok before proceeding.
 */
function advanceStep(fromStep, opts = {}) {
  const state = _load();
  const current = state.currentStep || 'flow';

  if (fromStep && current !== fromStep) {
    return { ok: false, step: current, reason: `Current step is ${current}, not ${fromStep}` };
  }

  const idx = STEPS.indexOf(current);
  if (idx === -1) {
    // Unknown step — reset to mode
    const next = 'mode';
    return _save({ ...state, currentStep: next, lastAdvancedAt: Date.now() }) && { ok: true, step: next };
  }

  // custom_structure only appears when structureMode === 'custom'
  const serverSettings = require('./serverSettingsService');
  const settings = serverSettings.getSettings();
  const needsCustom = (settings.customStructureMode === 'custom') && current === 'mode';

  const nextStep = needsCustom ? 'custom_structure' : STEPS[idx + 1] || 'finalize';

  const completed = Array.from(new Set([...(state.completedSteps || []), current]));
  const next = { ...state, currentStep: nextStep, completedSteps: completed, lastAdvancedAt: Date.now() };
  _save(next);
  log.info(`Wizard advanced: ${current} → ${nextStep}`);
  return { ok: true, step: nextStep, previous: current };
}

/**
 * Go back one step.
 * Uses completedSteps traversal history — NOT current settings state —
 * so changing structure mode mid-wizard doesn't land the Back button on the wrong step.
 */
function retreatStep(fromStep) {
  const state = _load();
  const current = state.currentStep || 'flow';

  if (fromStep && current !== fromStep) {
    return { ok: false, step: current, reason: `Current step is ${current}, not ${fromStep}` };
  }

  // Derive previous step from the actual traversal history (completedSteps),
  // not from current settings which may have changed since we arrived here.
  const completed = Array.isArray(state.completedSteps) ? state.completedSteps : [];
  const currentIdx = completed.indexOf(current);

  let prev;
  if (currentIdx > 0) {
    // Walk back through what was actually visited
    prev = completed[currentIdx - 1];
  } else if (completed.length > 0) {
    // current wasn't in completedSteps (we're on a fresh step) — go to last completed
    prev = completed[completed.length - 1];
  } else {
    // No history at all — fall back to STEPS order
    const idx = STEPS.indexOf(current);
    prev = idx > 0 ? STEPS[idx - 1] : 'flow';
  }

  if (!STEP_SET.has(prev)) prev = 'flow';

  const next = { ...state, currentStep: prev, lastAdvancedAt: Date.now() };
  _save(next);
  log.info(`Wizard retreated: ${current} → ${prev}`);
  return { ok: true, step: prev, previous: current };
}

/**
 * Jump directly to a specific step (use sparingly — prefer advance/retreat).
 */
function setStep(step, opts = {}) {
  if (!STEP_SET.has(step)) {
    log.warn(`setStep: invalid step "${step}" — ignored`);
    return { ok: false, reason: `Unknown step: ${step}` };
  }
  const state = _load();
  const next = { ...state, currentStep: step, ...opts, lastAdvancedAt: Date.now() };
  _save(next);
  return { ok: true, step };
}

/**
 * Record which message is the active in-place wizard message.
 * Callers should update this whenever the wizard sends or edits its message.
 */
function setActiveMessageId(messageId) {
  const state = _load();
  _save({ ...state, activeMessageId: messageId || null });
}

/**
 * Mark installation as started — sets installationMode: true.
 */
function beginInstallation(opts = {}) {
  const state = _load();
  _save({
    ...state,
    installationMode: true,
    editMode: false,
    currentStep: opts.step || state.currentStep || 'flow',
    selectedSetupMode: opts.selectedSetupMode || state.selectedSetupMode,
    lastAdvancedAt: Date.now(),
    ...opts,
  });
}

/**
 * Mark build complete — flips installationMode → false, editMode → true.
 */
function completeBuild(messageId = null) {
  const state = _load();
  _save({
    ...state,
    installationMode: false,
    editMode: true,
    currentStep: 'finalize',
    completedSteps: [...STEPS],
    activeMessageId: messageId || state.activeMessageId,
    lastBuildAt: Date.now(),
  });
}

/**
 * Full reset — back to defaults (used by /trash-the-bot, /initialize-server).
 */
function resetState(opts = {}) {
  _save({ ...DEFAULTS, ...opts });
  log.info('Wizard state reset to defaults');
}

/**
 * Merge partial updates without overwriting unrelated fields.
 */
function patch(partial = {}) {
  const state = _load();
  _save({ ...state, ...partial });
}

// ── Validation helpers ────────────────────────────────────────────────────

/**
 * Returns { canAdvance, missing } for the current step.
 * Used to decide whether the Next button is disabled.
 */
function canAdvanceFrom(step, settings, prefs) {
  if (step === 'flow') return { canAdvance: true, missing: [] };

  if (step === 'mode') {
    const missing = [];
    if (!settings.customStructureMode) missing.push('structure mode');
    if (settings.customStructureMode === 'template') {
      if (!settings.serverTemplate) missing.push('server template');
      const { getTemplateSubtemplateOptions } = require('./templateRegistryService');
      if (settings.serverTemplate && getTemplateSubtemplateOptions(settings.serverTemplate).length && !settings.serverSubtemplate) missing.push('subtemplate');
    }
    return { canAdvance: missing.length === 0, missing };
  }

  if (step === 'custom_structure') {
    const missing = [];
    if (!Array.isArray(settings.customTemplateSelections) || !settings.customTemplateSelections.length) {
      missing.push('custom templates');
    }
    return { canAdvance: missing.length === 0, missing };
  }

  if (step === 'tone') {
    const missing = [];
    if (!settings.audienceRating) missing.push('audience level');
    return { canAdvance: missing.length === 0, missing };
  }

  if (step === 'finalize') {
    const missing = [];
    if (!settings.customStructureMode) missing.push('structure mode');
    if (settings.customStructureMode === 'template' && !settings.serverTemplate) missing.push('server template');
    if (settings.customStructureMode === 'custom' && (!Array.isArray(settings.customTemplateSelections) || !settings.customTemplateSelections.length)) missing.push('custom templates');
    if (!settings.audienceRating) missing.push('audience level');
    return { canAdvance: missing.length === 0, missing };
  }

  return { canAdvance: true, missing: [] };
}

module.exports = {
  STEPS,
  getState,
  getCurrentStep,
  getActiveMessageId,
  isInstallationMode,
  isEditMode,
  hasCompleted,
  advanceStep,
  retreatStep,
  setStep,
  setActiveMessageId,
  beginInstallation,
  completeBuild,
  resetState,
  patch,
  canAdvanceFrom,
};
