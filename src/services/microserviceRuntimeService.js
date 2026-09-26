/*
 * NAVIGATION HEADER
 * FILE: src/services/microserviceRuntimeService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { makeLogger } = require('../utils/logger');

function createRuntime(opts = {}) {
  const logger = opts.logger || makeLogger('microservices');
  const statuses = new Map();

  async function start(service, context = {}) {
    const key = String(service?.key || service?.name || 'service');
    const label = service?.label || key;
    const startedAt = Date.now();
    logger.info(`▶ Starting ${label}`);
    try {
      const result = await service.start(context);
      const status = { key, label, ok: true, startedAt, finishedAt: Date.now(), error: null };
      statuses.set(key, status);
      logger.info(`✅ ${label} online`);
      return { ...status, result };
    } catch (err) {
      const status = { key, label, ok: false, startedAt, finishedAt: Date.now(), error: err?.message || 'Unknown microservice failure' };
      statuses.set(key, status);
      logger.error(`❌ ${label} failed: ${status.error}`);
      throw err;
    }
  }

  async function startAll(services = [], context = {}) {
    const results = [];
    for (const service of services) results.push(await start(service, context));
    return results;
  }

  function getStatuses() {
    return [...statuses.values()];
  }

  return { start, startAll, getStatuses };
}

module.exports = { createRuntime };
