/*
 * NAVIGATION HEADER
 * FILE: src/services/processManagementService.js
 * LAYER: Service layer
 * PURPOSE: Builds or manages reusable processes and process lifecycle behavior.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * processManagementService.js
 *
 * PURPOSE:
 * Human-readable management helpers around the declarative process builder.
 * This is the orchestration layer used by slash commands, audits, and future UI.
 */

const processBuilder = require('./processBuilderService');

function buildProcessSummary() {
  const audit = processBuilder.auditProcesses();
  const recent = processBuilder.getRunHistory(10);
  return {
    ...audit,
    recentRuns: recent,
    presets: processBuilder.listPresets(),
  };
}

function buildInspectableDefinition(identifier) {
  const definition = processBuilder.getProcess(identifier);
  if (!definition) return null;
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    trigger: definition.trigger,
    preset: definition.preset,
    enabled: definition.enabled !== false,
    steps: definition.steps || [],
    commentPolicy: definition.commentPolicy,
  };
}

function ensureProcessManagementReady() {
  processBuilder.ensureSeedProcesses();
  return buildProcessSummary();
}

module.exports = {
  buildProcessSummary,
  buildInspectableDefinition,
  ensureProcessManagementReady,
};
