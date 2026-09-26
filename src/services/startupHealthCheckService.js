/*
 * NAVIGATION HEADER
 * FILE: src/services/startupHealthCheckService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * startupHealthCheckService.js
 *
 * Runs once at bot startup (before clientReady event).
 * Checks all 5 known locks and logs a clear status table.
 * Non-fatal — bot always starts, but operators see exactly
 * what is and isn't working.
 */

const { makeLogger } = require('../utils/logger');
const log = makeLogger('healthCheck');

async function runStartupHealthCheck() {
  const results = [];

  // ── Lock 1: Persistent storage ──────────────────────────────
  const dataDir = process.env.BOT_DATA_DIR || '/tmp/nofunleague-data';
  const isEphemeral = !process.env.BOT_DATA_DIR || dataDir.startsWith('/tmp');
  results.push({
    name: 'Persistent storage (BOT_DATA_DIR)',
    ok: !isEphemeral,
    value: dataDir,
    fix: isEphemeral
      ? 'Add a Railway Volume, mount at /data, set BOT_DATA_DIR=/data — state resets on every restart until this is fixed'
      : null,
  });

  // ── Lock 2: Commissioner role ────────────────────────────────
  const commRole = process.env.COMMISSIONER_ROLE_ID;
  results.push({
    name: 'Commissioner role (COMMISSIONER_ROLE_ID)',
    ok: !!commRole,
    value: commRole ? `set (${commRole})` : 'NOT SET — falling back to Discord Administrator',
    fix: !commRole
      ? 'Set COMMISSIONER_ROLE_ID to your commissioner role\'s Discord ID for reliable access control'
      : null,
  });

  // ── Lock 3: Redis ────────────────────────────────────────────
  const redisUrl = process.env.REDIS_URL;
  results.push({
    name: 'Redis / BullMQ (REDIS_URL)',
    ok: !!redisUrl,
    value: redisUrl ? 'set' : 'NOT SET — queue worker inert, jobs fire-and-forget',
    fix: !redisUrl
      ? 'Add a Railway Redis service and set REDIS_URL from its Variables tab'
      : null,
  });

  // ── Lock 4: Database ─────────────────────────────────────────
  const dbUrl = process.env.DATABASE_URL;
  let dbReachable = false;
  if (dbUrl) {
    try {
      const { getPrisma } = require('../storage/prisma');
      const prisma = getPrisma();
      if (prisma) {
        await prisma.$queryRaw`SELECT 1`;
        dbReachable = true;
      }
    } catch (err) {
      log.warn('DB ping failed:', err.message);
    }
  }
  results.push({
    name: 'PostgreSQL / Prisma (DATABASE_URL)',
    ok: dbUrl && dbReachable,
    value: !dbUrl
      ? 'NOT SET — all DB writes no-op'
      : dbReachable
        ? 'connected ✅'
        : 'set but unreachable — check DATABASE_URL and network',
    fix: !dbUrl
      ? 'Add a Railway Postgres service and set DATABASE_URL'
      : !dbReachable
        ? 'DATABASE_URL is set but connection failed — verify credentials and Railway networking'
        : null,
  });

  // ── Lock 5: .env variable names ─────────────────────────────
  // This is a deploy-time issue already addressed in .env.example and env.js
  // Just check if COMMISSIONER_IDS is set when COMMISSIONER_ROLE_ID is not
  const commIds = process.env.COMMISSIONER_IDS;
  const hasAnyCommAuth = !!commRole || (!!commIds && commIds.trim().length > 0);
  results.push({
    name: 'Commissioner auth configured',
    ok: hasAnyCommAuth,
    value: hasAnyCommAuth
      ? (commRole ? `role ID set` : `user IDs only (${commIds})`)
      : 'NONE — no COMMISSIONER_ROLE_ID or COMMISSIONER_IDS set',
    fix: !hasAnyCommAuth
      ? 'Set COMMISSIONER_ROLE_ID (preferred) or COMMISSIONER_IDS=your_discord_user_id'
      : null,
  });

  // ── Print summary ────────────────────────────────────────────
  const allOk = results.every(r => r.ok);
  log.info('');
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info('  NOFUNLEAGUE startup health check');
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const r of results) {
    const icon = r.ok ? '✅' : '⚠️ ';
    log.info(`  ${icon} ${r.name}`);
    log.info(`       ${r.value}`);
    if (r.fix) {
      log.warn(`       FIX: ${r.fix}`);
    }
  }
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (allOk) {
    log.info('  All systems operational.');
  } else {
    const issues = results.filter(r => !r.ok).length;
    log.warn(`  ${issues} degraded system(s). Bot will still run but functionality is limited.`);
    log.warn('  Fix the items above and redeploy to reach full operation.');
  }
  log.info('');

  return { ok: allOk, results };
}

module.exports = { runStartupHealthCheck };
