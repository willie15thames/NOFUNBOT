/*
 * NAVIGATION HEADER
 * FILE: scripts/predeploy-check.js
 * LAYER: Maintenance and operational scripts
 * PURPOSE: Verifies Railway-critical files and warns on risky runtime configuration before deploy.
 * LOOK HERE FIRST WHEN DEBUGGING: Read the checks array and warning conditions top to bottom.
 * RELATED FLOW: Railway staging -> production pipeline and release preflight.
 * NOTE: This script warns on env issues and only fails for missing required project files.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getFeatureFlags } = require('../src/config/featureFlags');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'index.js',
  'health-server.js',
  'scripts/railway-start.sh',
  'prisma/schema.prisma',
  'package.json',
];

const missingFiles = requiredFiles.filter(relativePath => !fs.existsSync(path.join(root, relativePath)));
if (missingFiles.length) {
  console.error(`[predeploy-check] Missing required files: ${missingFiles.join(', ')}`);
  process.exit(1);
}

const flags = getFeatureFlags(process.env);
const { validateRuntimeEnvironment } = require('../src/config/runtimeValidation');
console.log('[predeploy-check] Required files present ✅');
console.log(`[predeploy-check] appEnv=${flags.appEnv} channel=${flags.releaseChannel} version=${flags.releaseVersion}`);
console.log(`[predeploy-check] migrations=${flags.runPrismaMigrationsOnBoot} bootstrap=${flags.runDbBootstrapOnBoot} jsonMigration=${flags.runJsonMigrationOnBoot} worker=${flags.enableQueueWorker}`);

if (!process.env.BOT_DATA_DIR) {
  console.warn('[predeploy-check] WARN BOT_DATA_DIR is unset. Railway volume-backed persistence is recommended.');
}
if (!process.env.DATABASE_URL) {
  console.warn('[predeploy-check] WARN DATABASE_URL is unset. Prisma-backed persistence will be skipped.');
}
if (!process.env.REDIS_URL && flags.enableQueueWorker) {
  console.warn('[predeploy-check] WARN REDIS_URL is unset while queue worker is enabled. Worker startup will be skipped.');
}
if (flags.runJsonMigrationOnBoot) {
  console.warn('[predeploy-check] WARN RUN_JSON_MIGRATION_ON_BOOT=true. Keep this enabled only for intentional one-time migrations.');
}

const runtimeValidation = validateRuntimeEnvironment(process.env, {
  enableQueueWorker: flags.enableQueueWorker,
  runPrismaMigrationsOnBoot: flags.runPrismaMigrationsOnBoot,
  runDbBootstrapOnBoot: flags.runDbBootstrapOnBoot,
});
for (const issue of runtimeValidation.issues) {
  const fn = issue.severity === 'error' ? console.error : console.warn;
  fn(`[predeploy-check] ${issue.severity.toUpperCase()} ${issue.key}: ${issue.message}`);
}
if (!runtimeValidation.ok) process.exitCode = 1;
