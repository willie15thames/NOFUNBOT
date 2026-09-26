/*
 * FILE: scripts/boot-preflight.js
 * PURPOSE: Consolidated boot preflight — runs predeploy checks, infra checks, and release context
 *          in a SINGLE Node.js process instead of three separate cold starts.
 * NOTE: V195 — replaces sequential calls to predeploy-check.js, check-infra.js, release-context.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getFeatureFlags } = require('../src/config/featureFlags');

const root = path.resolve(__dirname, '..');
let exitCode = 0;

// ── Phase 1: Required files (from predeploy-check.js) ──────────────────────
const requiredFiles = [
  'index.js', 'health-server.js', 'scripts/railway-start.sh',
  'prisma/schema.prisma', 'package.json',
];
const missingFiles = requiredFiles.filter(f => !fs.existsSync(path.join(root, f)));
if (missingFiles.length) {
  console.error(`[boot-preflight] FAIL missing required files: ${missingFiles.join(', ')}`);
  exitCode = 1;
} else {
  console.log('[boot-preflight] OK   all required files present');
}

// ── Phase 2: Environment / infra checks (from check-infra.js) ───────────────
const envChecks = [
  { key: 'DISCORD_TOKEN', required: true },
  { key: 'CLIENT_ID', required: true },
  { key: 'GUILD_ID', required: true },
  { key: 'COMMISSIONER_ROLE_ID', required: false },
  { key: 'BOT_DATA_DIR', required: false },
  { key: 'DATABASE_URL', required: false },
  { key: 'REDIS_URL', required: false },
];
for (const item of envChecks) {
  if (process.env[item.key]) {
    console.log(`[boot-preflight] OK   ${item.key}`);
  } else if (item.required) {
    console.error(`[boot-preflight] FAIL ${item.key} is required`);
    exitCode = 1;
  } else {
    console.log(`[boot-preflight] WARN ${item.key} not set`);
  }
}

const dbUrl = String(process.env.DATABASE_URL || '').trim();
if (dbUrl && !/^postgres(ql)?:\/\//.test(dbUrl)) {
  console.error('[boot-preflight] FAIL DATABASE_URL must start with postgres:// or postgresql://');
  exitCode = 1;
}

// ── Phase 3: Release context (from release-context.js) ──────────────────────
const flags = getFeatureFlags(process.env);
console.log('[boot-preflight] release-context: ' + JSON.stringify({
  appEnv: flags.appEnv,
  releaseChannel: flags.releaseChannel,
  releaseVersion: flags.releaseVersion,
  hasDatabaseUrl: !!process.env.DATABASE_URL,
  hasRedisUrl: !!process.env.REDIS_URL,
  runMigrations: flags.runPrismaMigrationsOnBoot,
  runBootstrap: flags.runDbBootstrapOnBoot,
}));

process.exitCode = exitCode;
