/*
 * NAVIGATION HEADER
 * FILE: src/services/backgroundJobService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { prismaSafe } = require('../storage/prisma');
const { makeLogger, setJobContext } = require('../utils/logger');
const log = makeLogger('backgroundJobs');

async function createJob({ guildId, jobType, triggeredBy, payload, status = 'queued' }) {
  const fallback = {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    guildId: String(guildId || ''),
    jobType: String(jobType || 'unknown'),
    triggeredBy: triggeredBy ? String(triggeredBy) : null,
    payload: payload || null,
    status,
    progress: null,
    result: null,
    errorMsg: null,
  };
  const created = await prismaSafe(prisma => prisma.backgroundJob.create({
    data: {
      guildId: String(guildId || ''),
      jobType: String(jobType || 'unknown'),
      triggeredBy: triggeredBy ? String(triggeredBy) : null,
      payload: payload || null,
      status: String(status || 'queued'),
    },
  }), fallback);
  log.info(`job created ${created.id} (${created.jobType})`);
  setJobContext(created.id);
  return created;
}

async function markStarted(jobId, progress) {
  if (!jobId) return null;
  return prismaSafe(prisma => prisma.backgroundJob.update({
    where: { id: String(jobId) },
    data: { status: 'running', startedAt: new Date(), progress: progress || null },
  }), { id: String(jobId), status: 'running', progress: progress || null });
}

async function markProgress(jobId, progress) {
  if (!jobId) return null;
  return prismaSafe(prisma => prisma.backgroundJob.update({
    where: { id: String(jobId) },
    data: { status: 'running', progress: progress || null },
  }), { id: String(jobId), status: 'running', progress: progress || null });
}

async function markCompleted(jobId, result) {
  if (!jobId) return null;
  return prismaSafe(prisma => prisma.backgroundJob.update({
    where: { id: String(jobId) },
    data: { status: 'completed', completedAt: new Date(), result: result || null },
  }), { id: String(jobId), status: 'completed', result: result || null });
}

async function markFailed(jobId, error, progress) {
  if (!jobId) return null;
  require('./runtimeIncidentService').capture(error, {
    source: 'background-job',
    eventType: 'background-job-failed',
    jobId,
    severity: 'error',
  }).catch(() => null);
  return prismaSafe(prisma => prisma.backgroundJob.update({
    where: { id: String(jobId) },
    data: {
      status: 'failed',
      completedAt: new Date(),
      errorMsg: error ? String(error).slice(0, 1000) : 'unknown error',
      progress: progress || null,
    },
  }), { id: String(jobId), status: 'failed', errorMsg: error ? String(error) : 'unknown error', progress: progress || null });
}

module.exports = { createJob, markStarted, markProgress, markCompleted, markFailed };
