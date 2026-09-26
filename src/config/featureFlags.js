/*
 * NAVIGATION HEADER
 * FILE: src/config/featureFlags.js
 * LAYER: Configuration
 * PURPOSE: Centralizes runtime deploy flags so health, startup, and release scripts read one source.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for exported flag names and normalization helpers.
 * RELATED FLOW: Railway deploy/startup and operational safety checks.
 * NOTE: Keep defaults conservative for production safety.
 */

'use strict';

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return !!defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return !!defaultValue;
}

function normalizeString(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function getFeatureFlags(env = process.env) {
  return {
    appEnv: normalizeString(env.APP_ENV, 'production'),
    releaseChannel: normalizeString(env.RELEASE_CHANNEL, 'stable'),
    releaseVersion: normalizeString(env.RELEASE_VERSION, normalizeString(env.npm_package_version, 'unknown')),
    runPrismaMigrationsOnBoot: toBoolean(env.RUN_PRISMA_MIGRATIONS_ON_BOOT, false),
    runDbBootstrapOnBoot: toBoolean(env.RUN_DB_BOOTSTRAP_ON_BOOT, false),
    runJsonMigrationOnBoot: toBoolean(env.RUN_JSON_MIGRATION_ON_BOOT, false),
    enableQueueWorker: toBoolean(env.ENABLE_QUEUE_WORKER, true),
  };
}

module.exports = {
  getFeatureFlags,
  toBoolean,
};
