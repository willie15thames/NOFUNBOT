/*
 * NAVIGATION HEADER
 * FILE: scripts/check-infra.js
 * LAYER: Maintenance and operational scripts
 * PURPOSE: Provides a project script for setup, auditing, deployment, or maintenance.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually run manually or from package.json / deployment hooks.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { validateRuntimeEnvironment } = require('../src/config/runtimeValidation');

const checks = [
  { key: 'DISCORD_TOKEN', required: true, note: 'required for bot login' },
  { key: 'CLIENT_ID', required: true, note: 'required for slash command registration' },
  { key: 'GUILD_ID', required: true, note: 'required for guild-scoped deployment' },
  { key: 'COMMISSIONER_ROLE_ID', required: false, note: 'recommended for strict commissioner access' },
  { key: 'BOT_DATA_DIR', required: false, note: 'recommended to point at /data on Railway' },
  { key: 'DATABASE_URL', required: false, note: 'required for Prisma persistence' },
  { key: 'REDIS_URL', required: false, note: 'required for BullMQ worker and durable orchestration' },
];

let hardFail = false;
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const redisUrl = String(process.env.REDIS_URL || '').trim();
const botDataDir = String(process.env.BOT_DATA_DIR || '').trim();
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);

console.log('[infra-check] NOFUNLEAGUE environment summary');
for (const item of checks) {
  const value = process.env[item.key];
  if (value) {
    console.log(`[infra-check] OK   ${item.key}`);
  } else if (item.required) {
    hardFail = true;
    console.log(`[infra-check] FAIL ${item.key} — ${item.note}`);
  } else {
    console.log(`[infra-check] WARN ${item.key} — ${item.note}`);
  }
}

if (!botDataDir) {
  console.log('[infra-check] WARN BOT_DATA_DIR is unset; Railway will fall back to /tmp unless you mount /data.');
} else if (botDataDir.startsWith('/tmp')) {
  console.log('[infra-check] WARN BOT_DATA_DIR points at /tmp; state will be lost on restart.');
}

if (!databaseUrl) {
  console.log('[infra-check] WARN Database persistence is disabled.');
} else {
  if (databaseUrl.startsWith('ipostgresql://')) {
    console.log('[infra-check] FAIL DATABASE_URL uses ipostgresql:// — change it to postgresql://');
    hardFail = true;
  }
  if (databaseUrl.includes('railway.internal') && !isRailway) {
    console.log('[infra-check] FAIL DATABASE_URL uses railway.internal outside Railway. Use the public DATABASE_URL or run inside Railway.');
    hardFail = true;
  }
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    console.log('[infra-check] FAIL DATABASE_URL must start with postgres:// or postgresql://');
    hardFail = true;
  }
}

if (!redisUrl) {
  console.log('[infra-check] WARN Queue worker is disabled; long jobs run in fallback mode.');
}



const runtimeValidation = validateRuntimeEnvironment(process.env);
for (const issue of runtimeValidation.issues) {
  const label = issue.severity === 'error' ? 'FAIL' : 'WARN';
  console.log(`[infra-check] ${label} ${issue.key} — ${issue.message}`);
  if (issue.severity === 'error') hardFail = true;
}

if (hardFail) {
  process.exitCode = 1;
}
