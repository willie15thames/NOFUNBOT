/*
 * NAVIGATION HEADER
 * FILE: src/services/wizardPreferencesService.js
 * LAYER: Service layer
 * PURPOSE: Supports setup wizard rendering, state, routing, or lifecycle behavior.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * setupUiPrefsService (wizardPreferencesService) — UI-only wizard preferences.
 *
 * Blueprint Step 8: This file now stores ONLY UI preferences that gate nothing.
 * State that gates command access (installationMode, currentStep, completedSteps)
 * lives exclusively in wizardStateService.
 *
 * Remaining fields:
 *   selectedSetupMode      — 'standard' | 'custom' | null
 *   standardSelected       — bool, mirrors selectedSetupMode === 'standard'
 *   customSelected         — bool, mirrors selectedSetupMode === 'custom'
 *   awaitingAvatarUpload   — bool, true while waiting for commissioner file upload
 *   avatarPromptMessageId  — id of the upload prompt message, for cleanup
 *   currentTemplate        — mirrors serverSettings.serverTemplate, for display only
 *   currentStructureMode   — mirrors serverSettings.customStructureMode, for display only
 */
const { loadJson, saveJson } = require('../storage/jsonStore');
const FILE = 'wizardPreferences.json';

const DEFAULTS = {
  selectedSetupMode: null,
  standardSelected: false,
  customSelected: false,
  currentTemplate: '',
  currentStructureMode: '',
  awaitingAvatarUpload: false,
  avatarPromptMessageId: null,
  updatedAt: null,
};

function getPrefs() {
  const raw = loadJson(FILE, null);
  return { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
}

function savePrefs(next) {
  // Strip any state fields that should only live in wizardStateService
  const { installationMode, editMode, lastBuildAt, lastWizardOpenedAt, lastWizardPostedAt, lastTimezoneAt,
    ruleSelectionsA, ruleSelectionsB, customRulesText,
    wizardStage, wizardStarterMessageId, wizardMessageIds, // retired — wizardStateService owns these
    ...safe } = next || {};
  const out = { ...getPrefs(), ...safe, updatedAt: Date.now() };
  saveJson(FILE, out);
  return out;
}

function resetPrefs() {
  const out = { ...DEFAULTS, updatedAt: Date.now() };
  saveJson(FILE, out);
  return out;
}

module.exports = { DEFAULTS, getPrefs, savePrefs, resetPrefs };

