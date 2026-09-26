/*
 * NAVIGATION HEADER
 * FILE: src/services/startupBuildOrderService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const { createRuntime } = require('./microserviceRuntimeService');
const stabilityCoreMicroservice = require('../microservices/stabilityCoreMicroservice');
const serverOperatingSystemMicroservice = require('../microservices/serverOperatingSystemMicroservice');
const valueUnlockMicroservice = require('../microservices/valueUnlockMicroservice');
const automationAccessMicroservice = require('../microservices/automationAccessMicroservice');

const log = makeLogger('startupBuildOrder');

const BUILD_ORDER = [
  {
    key: 'stabilityCore',
    label: 'Phase 1 · Stability Core',
    tasks: [
      'channel resolution',
      'base policy normalization',
      'nickname sync',
      'timezone gate enforcement',
      'runtime state hydration (V202)',
      'persisted state load',
      'core service init',
      'game session rehydrate (V202)',
      'conversation sweeper',
      'event wiring',
    ],
  },
  {
    key: 'serverOperatingSystem',
    label: 'Phase 2 · Server Operating System',
    tasks: [
      'patch notes publish',
      'setup wizard lane ensure',
      'install-mode wizard refresh',
    ],
  },
  {
    key: 'valueUnlockSystems',
    label: 'Phase 3 · Value Unlock Systems',
    tasks: [
      'boards refresh',
      'release timer restore',
      'schedule timer restore',
      'bot identity apply',
    ],
  },
  {
    key: 'automationAndAccess',
    label: 'Phase 4 · Automation + Access',
    tasks: [
      'bot access lock',
      'active check scheduler (single owner)',
      'league advance scheduler (V202)',
    ],
  },
];

const MICROSERVICES = [
  stabilityCoreMicroservice,
  serverOperatingSystemMicroservice,
  valueUnlockMicroservice,
  automationAccessMicroservice,
];

function logBuildOrder(logger = log) {
  for (const phase of BUILD_ORDER) logger.info(`${phase.label}: ${phase.tasks.join(' → ')}`);
}

function createStartupRuntime(logger = log) {
  return createRuntime({ logger });
}

function getStartupMicroservices() {
  return [...MICROSERVICES];
}

async function runStabilityCore(context) {
  const runtime = createStartupRuntime(context?.logger || log);
  return (await runtime.start(stabilityCoreMicroservice, context)).result;
}

async function runServerOperatingSystem(context) {
  const runtime = createStartupRuntime(context?.logger || log);
  return (await runtime.start(serverOperatingSystemMicroservice, context)).result;
}

async function runValueUnlockSystems(context) {
  const runtime = createStartupRuntime(context?.logger || log);
  return (await runtime.start(valueUnlockMicroservice, context)).result;
}

async function runAutomationAndAccess(context) {
  const runtime = createStartupRuntime(context?.logger || log);
  return (await runtime.start(automationAccessMicroservice, context)).result;
}

module.exports = {
  BUILD_ORDER,
  getStartupMicroservices,
  createStartupRuntime,
  logBuildOrder,
  runStabilityCore,
  runServerOperatingSystem,
  runValueUnlockSystems,
  runAutomationAndAccess,
};
