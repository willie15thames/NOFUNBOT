/*
 * NAVIGATION HEADER
 * FILE: src/services/responseGuardService.js
 * LAYER: Service layer
 * PURPOSE: Prevents duplicate execution and protects single-consumer / idempotent behavior.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

/**
 * Response Guard Service
 *
 * Purpose:
 * - prevent duplicate interaction execution
 * - prevent duplicate AI/message responses
 * - dedupe repeated sends within a short window
 *
 * This is intentionally in-memory. It protects against duplicate listeners,
 * rapid retries, Discord retries, and overlapping async paths inside a single process.
 */

const executionLocks = new Map();
const settledResponses = new Map();
const sendFingerprints = new Map();

function _now() {
  return Date.now();
}

function _sweep(map) {
  const now = _now();
  for (const [key, expiresAt] of map.entries()) {
    if (!expiresAt || expiresAt <= now) map.delete(key);
  }
}

function _claim(map, key, ttlMs) {
  if (!key) return true;
  _sweep(map);
  const now = _now();
  const expiresAt = map.get(key);
  if (expiresAt && expiresAt > now) return false;
  map.set(key, now + Math.max(250, Number(ttlMs) || 2500));
  return true;
}

function claimInteractionExecution(interaction, ttlMs = 8000) {
  const id = interaction?.id;
  return _claim(executionLocks, id ? `ix:${id}` : null, ttlMs);
}

function markInteractionSettled(interaction, ttlMs = 15 * 60 * 1000) {
  const id = interaction?.id;
  if (!id) return false;
  settledResponses.set(`ix:${id}:settled`, _now() + Math.max(1000, ttlMs));
  return true;
}

function isInteractionSettled(interaction) {
  const id = interaction?.id;
  if (!id) return false;
  _sweep(settledResponses);
  return settledResponses.has(`ix:${id}:settled`);
}


function claimMessageRoute(message, ttlMs = 15000) {
  const id = message?.id || message;
  return _claim(executionLocks, id ? `msgroute:${id}` : null, ttlMs);
}

function claimMessageResponse(message, scope = 'default', ttlMs = 12000) {
  const id = message?.id || message;
  return _claim(executionLocks, id ? `msg:${id}:${scope}` : null, ttlMs);
}

function payloadFingerprint(channelId, payload = {}, ctx = {}) {
  try {
    const embedTitles = Array.isArray(payload.embeds)
      ? payload.embeds.map(e => {
          const raw = typeof e?.toJSON === 'function' ? e.toJSON() : e || {};
          return [raw.title || '', raw.description || '', (raw.fields || []).map(f => `${f.name}:${f.value}`).join('|')].join('::');
        }).join('||')
      : '';
    const files = Array.isArray(payload.files) ? payload.files.map(f => String(f?.name || f || '')).join('|') : '';
    return [
      channelId || 'no-channel',
      ctx.action || 'send',
      String(payload.content || ''),
      embedTitles,
      files,
      ctx.dedupeKey || ''
    ].join('##').slice(0, 4000);
  } catch {
    return `${channelId || 'no-channel'}##${ctx.action || 'send'}##fallback`;
  }
}

function claimSend(channelId, payload = {}, ctx = {}, ttlMs = 4000) {
  return _claim(sendFingerprints, payloadFingerprint(channelId, payload, ctx), ttlMs);
}

function releaseInteractionExecution(interaction) {
  const id = interaction?.id;
  if (!id) return;
  executionLocks.delete(`ix:${id}`);
}

module.exports = {
  claimInteractionExecution,
  claimMessageRoute,
  releaseInteractionExecution,
  markInteractionSettled,
  isInteractionSettled,
  claimMessageResponse,
  claimSend,
  payloadFingerprint,
};
