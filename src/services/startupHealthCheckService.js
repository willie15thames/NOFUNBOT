/*
 * NAVIGATION HEADER
 * FILE: src/services/startupHealthCheckService.js
 * LAYER: Service layer
 * PURPOSE: On-demand/startup dependency health: persistence, auth, Redis, PostgreSQL, AI configuration.
 * LOOK HERE FIRST WHEN DEBUGGING: runStartupHealthCheck().
 * RELATED FLOW: /health-status, startup diagnostics.
 * NOTE: A configured client/URL is not treated as healthy until a real dependency probe succeeds.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const log = makeLogger('healthCheck');
const { getFeatureFlags } = require('../config/featureFlags');

async function _probeRedis(redisUrl) {
  if (!redisUrl) return { reachable: false, reason: 'not-configured' };
  let client = null;
  try {
    const Redis = require('ioredis');
    client = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 0,
      enableReadyCheck: true,
      retryStrategy: () => null,
    });
    await client.connect();
    const pong = await Promise.race([
      client.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 3500)),
    ]);
    return { reachable: pong === 'PONG', reason: pong === 'PONG' ? null : `unexpected ping response: ${pong}` };
  } catch (err) {
    return { reachable: false, reason: String(err?.message || err).slice(0, 300) };
  } finally {
    if (client) {
      try { client.disconnect(); } catch {}
    }
  }
}

async function runStartupHealthCheck() {
  const results = [];
  const flags = getFeatureFlags(process.env);

  const dataDir = process.env.BOT_DATA_DIR || '/tmp/nofunleague-data';
  const isEphemeral = !process.env.BOT_DATA_DIR || dataDir.startsWith('/tmp') || dataDir === './data';
  results.push({
    name: 'Persistent storage (BOT_DATA_DIR)',
    ok: !isEphemeral,
    value: dataDir,
    fix: isEphemeral ? 'Use PostgreSQL as authority and/or mount a Railway Volume at /data; set BOT_DATA_DIR=/data for JSON compatibility files.' : null,
    blocking: isEphemeral,
  });

  const commRole = process.env.COMMISSIONER_ROLE_ID;
  results.push({
    name: 'Commissioner role (COMMISSIONER_ROLE_ID)',
    ok: !!commRole,
    value: commRole ? `set (${commRole})` : 'NOT SET — falling back to Discord Administrator',
    fix: !commRole ? 'Set COMMISSIONER_ROLE_ID to the commissioner role ID for reliable access control.' : null,
    blocking: false,
  });

  const redisUrl = process.env.REDIS_URL;
  const redis = await _probeRedis(redisUrl);
  results.push({
    name: 'Redis / BullMQ (REDIS_URL)',
    ok: !!redisUrl && redis.reachable,
    value: !redisUrl ? 'NOT SET — queue worker unavailable' : redis.reachable ? 'connected ✅' : `set but unreachable — ${redis.reason}`,
    fix: !redisUrl ? 'Add Railway Redis and reference its REDIS_URL.' : !redis.reachable ? 'Verify REDIS_URL points to the Railway Redis service and is reachable from NOFUNBOT.' : null,
    blocking: !!flags.enableQueueWorker,
  });

  const dbUrl = process.env.DATABASE_URL;
  let db = null;
  try { db = await require('../storage/prisma').probePrisma({ checkSchema: true }); }
  catch (err) { db = { configured: !!dbUrl, reachable: false, lastError: err.message }; }
  const dbOk = !!dbUrl && db?.reachable === true && db?.schemaReady !== false;
  results.push({
    name: 'PostgreSQL / Prisma (DATABASE_URL)',
    ok: dbOk,
    value: !dbUrl
      ? 'NOT SET — DB persistence disabled'
      : db?.reachable !== true
        ? `set but unreachable${db?.lastErrorCode ? ` (${db.lastErrorCode})` : ''}${db?.circuitState === 'open' ? ' — circuit open' : ''}`
        : db?.schemaReady === false
          ? 'connected, but Prisma schema is not ready'
          : 'connected + schema ready ✅',
    fix: !dbUrl
      ? 'Add Railway Postgres and reference its DATABASE_URL.'
      : db?.reachable !== true
        ? 'Verify DATABASE_URL credentials/host and Railway networking; localhost is invalid for a separate Railway DB service.'
        : db?.schemaReady === false
          ? 'Run the intended Prisma migration/bootstrap before enabling authoritative automation.'
          : null,
    blocking: !!(flags.enableQueueWorker || flags.runPrismaMigrationsOnBoot || flags.runDbBootstrapOnBoot),
  });

  const commIds = process.env.COMMISSIONER_IDS;
  const hasAnyCommAuth = !!commRole || (!!commIds && commIds.trim().length > 0);
  results.push({
    name: 'Commissioner auth configured',
    ok: hasAnyCommAuth,
    value: hasAnyCommAuth ? (commRole ? 'role ID set' : 'commissioner user IDs set') : 'NONE',
    fix: !hasAnyCommAuth ? 'Set COMMISSIONER_ROLE_ID (preferred) or COMMISSIONER_IDS.' : null,
    blocking: false,
  });

  let ai = { ready: false, reason: 'unknown' };
  try { ai = require('./ai/anthropicService').getAIStatus(); } catch (err) { ai = { ready: false, reason: err.message }; }
  const aiEnabled = String(process.env.AI_ENABLED ?? 'true').toLowerCase() !== 'false';
  results.push({
    name: 'AI provider',
    ok: !aiEnabled || ai.ready,
    value: !aiEnabled ? 'disabled by configuration' : ai.ready ? 'configured ✅' : `unavailable — ${ai.reason}`,
    fix: aiEnabled && !ai.ready ? 'Set a valid provider API key or disable AI_ENABLED until a key is configured. Placeholder keys are rejected.' : null,
    blocking: false,
  });

  const blockingFailures = results.filter(r => !r.ok && r.blocking);
  const warnings = results.filter(r => !r.ok && !r.blocking);
  const allOk = results.every(r => r.ok);
  const ready = blockingFailures.length === 0;
  log.info('');
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info('  NOFUNLEAGUE startup health check');
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const r of results) {
    const icon = r.ok ? '✅' : '⚠️ ';
    log.info(`  ${icon} ${r.name}`);
    log.info(`       ${r.value}`);
    if (r.fix) log.warn(`       FIX: ${r.fix}`);
  }
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (allOk) log.info('  All checked systems operational.');
  else if (ready) log.warn(`  Core readiness is GREEN with ${warnings.length} non-blocking warning(s).`);
  else log.warn(`  Core readiness is BLOCKED by ${blockingFailures.length} dependency issue(s). Authoritative automation must remain disabled.`);
  log.info('');

  return { ok: allOk, ready, blockingFailures: blockingFailures.length, warnings: warnings.length, results };
}

module.exports = { runStartupHealthCheck };
