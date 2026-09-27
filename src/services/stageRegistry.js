/*
 * NAVIGATION HEADER
 * FILE: src/services/stageRegistry.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * stageRegistry.js — Wizard Stage Metadata V135
 *
 * Blueprint Step 6: stage description strings extracted from wizardRendererService
 * into a data map. Adding a new wizard stage requires changing only this file.
 *
 * Each stage entry defines:
 *   label       — short display label used in the embed field header
 *   description — body text shown in the wizard embed field
 *   nextLabel   — text for the Next button when on this stage
 */

const STAGE_REGISTRY = {
  flow: {
    label: '🧭 Flow Guide',
    description: 'Confirm this guide to open the main setup wizard.',
    nextLabel: '⚡ Start Setup',
  },
  mode: {
    label: '🏗️ Structure + Template',
    description: 'Choose one **Structure strategy**. BASE builds core bot/server lanes with no template. TEMPLATE adds one template and its relevant subtemplate. CUSTOM lets you combine multiple templates and optional subtemplates.',
    nextLabel: '▶ Audience & AI Tone',
  },
  custom_structure: {
    label: '🧩 Custom Structure',
    description: 'Choose one or more templates, then optionally add relevant subtemplates. The bot deduplicates overlapping categories/channels while preserving your selections.',
    nextLabel: '▶ Audience & AI Tone',
  },
  tone: {
    label: '🎭 Audience + AI Tone',
    description: 'Set **Audience level** first — it gates the tone list. Then pick AI personalities for member chat and commissioner chat.',
    nextLabel: '▶ Final Review',
  },
  finalize: {
    label: '🚀 Final Review',
    description: 'Review everything, configure identity or rules if needed, then hit **🚀 Build Server Now**.',
    nextLabel: '🚀 Build Server Now',
  },
};

/**
 * Get stage metadata by step name.
 * Falls back to safe defaults if stage is unknown.
 */
function getStage(step) {
  return STAGE_REGISTRY[step] || {
    label: '🛠️ Setup',
    description: 'Complete each required field to advance.',
    nextLabel: '▶ Next',
  };
}

/**
 * Get the Next button label for a given stage.
 * isEditMode changes the finalize label.
 */
function getNextLabel(step, isEditMode = false) {
  if (step === 'finalize') return isEditMode ? '💾 Apply Changes' : '🚀 Build Server Now';
  return getStage(step).nextLabel;
}

/**
 * Get a map of stage -> label for use in embed field headers.
 */
function getAllStageLabels() {
  return Object.fromEntries(Object.entries(STAGE_REGISTRY).map(([k, v]) => [k, v.label]));
}

module.exports = { STAGE_REGISTRY, getStage, getNextLabel, getAllStageLabels };
