/*
 * NAVIGATION HEADER
 * FILE: src/storage/prisma.js
 * LAYER: Persistence/storage layer
 * PURPOSE: Owns Prisma client creation, safe DB execution, connectivity health, and a small circuit breaker.
 * LOOK HERE FIRST WHEN DEBUGGING: getPrisma(), prismaSafe(), probePrisma(), getPrismaHealth().
 * RELATED FLOW: persistence services, startupHealthCheckService, diagnosticService, IT diagnostics.
 * NOTE: Client construction is NOT database health. `reachable` changes only after a real DB operation/probe.
 */

'use strict';

let prismaInstance = null;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 15_000;
const health = {
  configured: !!process.env.DATABASE_URL,
  clientInitialized: false,
  reachable: null,
  schemaReady: null,
  circuitState: 'closed',
  circuitOpenUntil: null,
  consecutiveFailures: 0,
  suppressedOperations: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastErrorCode: null,
  lastError: null,
};

function _errorCode(err) {
  return String(err?.code || err?.errorCode || '').trim() || null;
}

function _isConnectivityError(err) {
  const code = _errorCode(err);
  if (['P1000','P1001','P1002','P1008','P1017'].includes(code)) return true;
  return /can't reach database|cannot reach database|connection (?:refused|closed|terminated)|authentication failed|timed? out/i.test(String(err?.message || ''));
}

function _isSchemaError(err) {
  const code = _errorCode(err);
  return ['P2021','P2022'].includes(code) || /table .* does not exist|column .* does not exist/i.test(String(err?.message || ''));
}

function _markSuccess({ schemaReady = null } = {}) {
  health.reachable = true;
  if (schemaReady != null) health.schemaReady = !!schemaReady;
  health.circuitState = 'closed';
  health.circuitOpenUntil = null;
  health.consecutiveFailures = 0;
  health.lastSuccessAt = Date.now();
  health.lastErrorCode = null;
  health.lastError = null;
}

function _markFailure(err) {
  health.lastFailureAt = Date.now();
  health.lastErrorCode = _errorCode(err);
  health.lastError = String(err?.message || err || 'unknown database error').slice(0, 500);
  if (_isSchemaError(err)) {
    health.reachable = true;
    health.schemaReady = false;
    health.consecutiveFailures = 0;
    health.circuitState = 'closed';
    health.circuitOpenUntil = null;
    return;
  }
  if (_isConnectivityError(err)) {
    health.reachable = false;
    health.consecutiveFailures += 1;
    if (health.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      health.circuitState = 'open';
      health.circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    }
  }
}

function _canAttempt() {
  if (health.circuitState !== 'open') return true;
  if (Date.now() >= Number(health.circuitOpenUntil || 0)) {
    health.circuitState = 'half-open';
    return true;
  }
  health.suppressedOperations += 1;
  return false;
}

function getPrisma() {
  health.configured = !!process.env.DATABASE_URL;
  if (prismaInstance) return prismaInstance;
  if (!process.env.DATABASE_URL) return null;
  try {
    const { PrismaClient } = require('@prisma/client');
    prismaInstance = new PrismaClient({ log: ['error'] });
    health.clientInitialized = true;
    return prismaInstance;
  } catch (err) {
    health.clientInitialized = false;
    _markFailure(err);
    console.warn(`[prisma] unavailable: ${err.message}`);
    return null;
  }
}

async function prismaSafe(fn, fallback = null) {
  const prisma = getPrisma();
  if (!prisma || !_canAttempt()) return fallback;
  try {
    const result = await fn(prisma);
    _markSuccess();
    return result;
  } catch (err) {
    _markFailure(err);
    const suffix = health.circuitState === 'open' ? `; circuit open for ${Math.ceil(CIRCUIT_COOLDOWN_MS / 1000)}s` : '';
    console.warn(`[prisma] operation failed: ${err.message}${suffix}`);
    return fallback;
  }
}

/** Backward-compatible: means a Prisma client can be constructed, not that the DB is reachable. */
function isPrismaAvailable() {
  return !!getPrisma();
}

function getPrismaHealth() {
  return { ...health };
}

/** Real reachability/schema probe used by health and diagnostics. */
async function probePrisma({ checkSchema = true } = {}) {
  const prisma = getPrisma();
  if (!prisma) return getPrismaHealth();
  if (!_canAttempt()) return getPrismaHealth();
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    _markSuccess({ schemaReady: health.schemaReady });
    let serverConfigs = null;
    if (checkSchema) {
      try {
        serverConfigs = await prisma.serverConfig.count();
        _markSuccess({ schemaReady: true });
      } catch (err) {
        _markFailure(err);
      }
    }
    return { ...getPrismaHealth(), serverConfigs };
  } catch (err) {
    _markFailure(err);
    return getPrismaHealth();
  }
}

async function disconnectPrisma() {
  if (!prismaInstance) return;
  const current = prismaInstance;
  prismaInstance = null;
  health.clientInitialized = false;
  try { await current.$disconnect(); } catch {}
}

module.exports = {
  getPrisma,
  prismaSafe,
  isPrismaAvailable,
  getPrismaHealth,
  probePrisma,
  disconnectPrisma,
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_COOLDOWN_MS,
};
