/*
 * NAVIGATION HEADER
 * FILE: scripts/release-context.js
 * LAYER: Maintenance and operational scripts
 * PURPOSE: Emits safe release metadata into logs before app startup.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for the logged fields and redaction policy.
 * RELATED FLOW: Railway deploy/startup observability.
 * NOTE: Keep output non-secret and deterministic.
 */

'use strict';

const { getFeatureFlags } = require('../src/config/featureFlags');

const flags = getFeatureFlags(process.env);
const context = {
  appEnv: flags.appEnv,
  releaseChannel: flags.releaseChannel,
  releaseVersion: flags.releaseVersion,
  nodeEnv: String(process.env.NODE_ENV || 'production'),
  botDataDir: String(process.env.BOT_DATA_DIR || ''),
  hasDatabaseUrl: !!process.env.DATABASE_URL,
  hasRedisUrl: !!process.env.REDIS_URL,
  runPrismaMigrationsOnBoot: flags.runPrismaMigrationsOnBoot,
  runDbBootstrapOnBoot: flags.runDbBootstrapOnBoot,
  runJsonMigrationOnBoot: flags.runJsonMigrationOnBoot,
  enableQueueWorker: flags.enableQueueWorker,
};

console.log('[release-context] ' + JSON.stringify(context));
