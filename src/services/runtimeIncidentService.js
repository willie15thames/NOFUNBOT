/*
 * NAVIGATION HEADER
 * FILE: src/services/runtimeIncidentService.js
 * LAYER: Runtime observability
 * PURPOSE: Captures production runtime failures into the existing AuditEvent table.
 * NOTE: Never persist tokens, API keys, request bodies, chat bodies, provider payloads, or database credentials.
 */

'use strict';

const { createHash } = require('crypto');
const { getPrisma } = require('../storage/prisma');
const { makeLogger, RUN_ID } = require('../utils/logger');
const { toBoolean } = require('../config/featureFlags');

const log = makeLogger('runtimeIncident');
const recent = new Map();
const DEFAULT_WINDOW_MS = 60_000;

function enabled(env = process.env) {
  if (String(env.APP_ENV || '').toLowerCase() !== 'production') return false;
  return toBoolean(env.RUNTIME_INCIDENT_CAPTURE_ENABLED, true);
}

function sanitizeText(value, max = 3500) {
  let s = String(value ?? '');
  s = s
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/redis:\/\/[^\s"'`]+/gi, '[REDACTED_REDIS_URL]')
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password|webhook[_-]?secret|provider[_-]?secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_KEY]')
    .replace(/\b[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_TOKEN]');
  return s.slice(0, max);
}

function stableMessage(value) {
  return sanitizeText(value, 1000)
    .replace(/\b\d{15,22}\b/g, '<id>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprintIncident(error, context = {}) {
  const name = sanitizeText(error?.name || 'Error', 120);
  const message = stableMessage(error?.message || error || 'unknown error');
  const source = sanitizeText(context.source || context.module || 'unknown', 180);
  return createHash('sha256').update(`${source}|${name}|${message}`).digest('hex').slice(0, 24);
}

function normalizeContext(context = {}) {
  const allowed = {};
  for (const key of [
    'source','module','severity','eventType','guildId','channelId','userId',
    'interactionId','jobId','commandName','customId','provider','leagueId',
    'route','status','phase','releaseVersion'
  ]) {
    if (context[key] !== undefined && context[key] !== null) {
      allowed[key] = sanitizeText(context[key], 300);
    }
  }
  return allowed;
}

function shouldSuppress(fingerprint, now = Date.now()) {
  const windowMs = Math.max(5_000, Number(process.env.RUNTIME_INCIDENT_DEDUPE_MS || DEFAULT_WINDOW_MS));
  const prev = recent.get(fingerprint);
  if (prev && now - prev < windowMs) return true;
  recent.set(fingerprint, now);
  if (recent.size > 1000) {
    for (const [key, ts] of recent) if (now - ts > windowMs * 4) recent.delete(key);
  }
  return false;
}

async function capture(error, context = {}) {
  if (!enabled()) return { captured: false, reason: 'disabled' };

  const err = error instanceof Error ? error : new Error(String(error || 'unknown runtime error'));
  const ctx = normalizeContext(context);
  const fingerprint = fingerprintIncident(err, ctx);
  if (shouldSuppress(fingerprint)) return { captured: false, reason: 'duplicate', fingerprint };

  const prisma = getPrisma();
  if (!prisma) {
    log.error('incident DB unavailable', fingerprint, sanitizeText(err.message, 500));
    return { captured: false, reason: 'database-unavailable', fingerprint };
  }

  const payload = {
    fingerprint,
    runId: RUN_ID,
    releaseVersion: String(process.env.PUBLIC_RELEASE_VERSION || process.env.RELEASE_VERSION || process.env.npm_package_version || 'unknown').slice(0, 80),
    context: ctx,
    errorName: sanitizeText(err.name || 'Error', 120),
    stack: sanitizeText(err.stack || '', 3500),
  };

  try {
    const row = await prisma.auditEvent.create({
      data: {
        guildId: String(ctx.guildId || process.env.GUILD_ID || 'system'),
        userId: ctx.userId ? String(ctx.userId) : null,
        eventType: String(ctx.eventType || 'runtime-incident').slice(0, 120),
        category: String(ctx.source || ctx.module || 'runtime').slice(0, 120),
        channelId: ctx.channelId ? String(ctx.channelId) : null,
        payload,
        outcome: 'error',
        errorMsg: sanitizeText(err.message || err, 1000),
      },
    });
    log.error(`captured incident ${fingerprint}`);
    return { captured: true, fingerprint, id: String(row.id) };
  } catch (writeErr) {
    log.error('incident persistence failed', sanitizeText(writeErr.message, 500), fingerprint);
    return { captured: false, reason: 'write-failed', fingerprint };
  }
}

function resetForTests() {
  recent.clear();
}

module.exports = {
  capture,
  enabled,
  sanitizeText,
  fingerprintIncident,
  shouldSuppress,
  resetForTests,
};
