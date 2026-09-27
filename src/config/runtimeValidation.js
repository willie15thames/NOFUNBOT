/*
 * NAVIGATION HEADER
 * FILE: src/config/runtimeValidation.js
 * LAYER: Configuration / deployment safety
 * PURPOSE: Pure validation helpers for production environment variables. Never logs or exposes secret values.
 * LOOK HERE FIRST WHEN DEBUGGING: validateRuntimeEnvironment().
 * RELATED FLOW: boot-preflight.js, predeploy-check.js, check-infra.js.
 */

'use strict';

function toBool(value, fallback = false) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return fallback;
  if (['1','true','yes','on'].includes(v)) return true;
  if (['0','false','no','off'].includes(v)) return false;
  return fallback;
}

function isRailway(env = process.env) {
  return !!(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID);
}

function isProduction(env = process.env) {
  return isRailway(env) || String(env.APP_ENV || env.NODE_ENV || '').toLowerCase() === 'production';
}

function parseHost(urlValue) {
  const raw = String(urlValue || '').trim();
  if (!raw) return null;
  try { return new URL(raw).hostname.toLowerCase(); }
  catch { return null; }
}

function isLocalhostUrl(value) {
  const host = parseHost(value);
  return ['localhost','127.0.0.1','::1','0.0.0.0'].includes(host);
}

function isPlaceholderSecret(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return false;
  return [
    'your_anthropic_api_key', 'your_discord_token', 'your_token_here',
    'replace_me', 'replace-me', 'changeme', 'change_me', 'password',
  ].includes(v) || /^your[_-].*[_-](?:key|token|password)$/.test(v);
}

function hasPlaceholderUrlCredentials(value) {
  try {
    const u = new URL(String(value || '').trim());
    const user = decodeURIComponent(u.username || '').trim().toLowerCase();
    const pass = decodeURIComponent(u.password || '').trim().toLowerCase();
    return ['user','username','postgres','default'].includes(user) && ['password','changeme','replace_me','postgres'].includes(pass)
      || ['password','changeme','replace_me'].includes(pass);
  } catch { return false; }
}

function isDiscordSnowflake(value) {
  return /^\d{17,20}$/.test(String(value || '').trim());
}

function _issue(severity, key, message) { return { severity, key, message }; }

function validateRuntimeEnvironment(env = process.env, opts = {}) {
  const issues = [];
  const prod = isProduction(env);
  const enableWorker = opts.enableQueueWorker ?? toBool(env.ENABLE_QUEUE_WORKER, true);
  const runMigrations = opts.runPrismaMigrationsOnBoot ?? toBool(env.RUN_PRISMA_MIGRATIONS_ON_BOOT, false);
  const runBootstrap = opts.runDbBootstrapOnBoot ?? toBool(env.RUN_DB_BOOTSTRAP_ON_BOOT, false);
  const aiEnabled = toBool(env.AI_ENABLED, true);
  const provider = String(env.AI_PROVIDER || 'anthropic').trim().toLowerCase();

  for (const key of ['DISCORD_TOKEN','CLIENT_ID','GUILD_ID']) {
    if (!String(env[key] || '').trim()) issues.push(_issue('error', key, `${key} is required`));
  }
  if (isPlaceholderSecret(env.DISCORD_TOKEN)) issues.push(_issue('error', 'DISCORD_TOKEN', 'placeholder token is not allowed'));
  if (env.CLIENT_ID && !isDiscordSnowflake(env.CLIENT_ID)) issues.push(_issue('error', 'CLIENT_ID', 'must be a Discord snowflake (17-20 digits)'));
  if (env.GUILD_ID && !isDiscordSnowflake(env.GUILD_ID)) issues.push(_issue('error', 'GUILD_ID', 'must be a Discord snowflake (17-20 digits)'));
  if (env.COMMISSIONER_ROLE_ID && !isDiscordSnowflake(env.COMMISSIONER_ROLE_ID)) issues.push(_issue('error', 'COMMISSIONER_ROLE_ID', 'must be a Discord snowflake (17-20 digits)'));

  const db = String(env.DATABASE_URL || '').trim();
  if (db && !/^postgres(?:ql)?:\/\//i.test(db)) issues.push(_issue('error', 'DATABASE_URL', 'must start with postgres:// or postgresql://'));
  if (prod && db && isLocalhostUrl(db)) issues.push(_issue('error', 'DATABASE_URL', 'localhost cannot reach a separate production/Railway PostgreSQL service'));
  if (prod && db && hasPlaceholderUrlCredentials(db)) issues.push(_issue('error', 'DATABASE_URL', 'placeholder database credentials are not allowed in production'));
  if ((runMigrations || runBootstrap) && !db) issues.push(_issue('error', 'DATABASE_URL', 'required while DB migration/bootstrap-on-boot is enabled'));
  if (enableWorker && !db) issues.push(_issue(prod ? 'error' : 'warn', 'DATABASE_URL', 'required while queue worker is enabled'));

  const redis = String(env.REDIS_URL || '').trim();
  if (redis && !/^rediss?:\/\//i.test(redis)) issues.push(_issue('error', 'REDIS_URL', 'must start with redis:// or rediss://'));
  if (prod && redis && isLocalhostUrl(redis)) issues.push(_issue('error', 'REDIS_URL', 'localhost cannot reach a separate production/Railway Redis service'));
  if (prod && redis && hasPlaceholderUrlCredentials(redis)) issues.push(_issue('error', 'REDIS_URL', 'placeholder Redis credentials are not allowed in production'));
  if (enableWorker && !redis) issues.push(_issue(prod ? 'error' : 'warn', 'REDIS_URL', 'required while queue worker is enabled'));

  if (aiEnabled && provider === 'anthropic') {
    const key = String(env.ANTHROPIC_API_KEY || '').trim();
    if (!key) issues.push(_issue(prod ? 'error' : 'warn', 'ANTHROPIC_API_KEY', 'AI is enabled but no Anthropic API key is configured'));
    else if (isPlaceholderSecret(key)) issues.push(_issue('error', 'ANTHROPIC_API_KEY', 'placeholder API key is not allowed'));
  }

  const dataDir = String(env.BOT_DATA_DIR || '').trim();
  if (prod && (!dataDir || dataDir.startsWith('/tmp') || dataDir === './data')) {
    issues.push(_issue('warn', 'BOT_DATA_DIR', 'JSON compatibility state is ephemeral; use /data volume or rely on PostgreSQL authority'));
  }

  const providerHttp = toBool(env.ENABLE_PROVIDER_HTTP, false);
  if (providerHttp) {
    const providerPort = Number(env.PROVIDER_HTTP_PORT || 3100);
    const publicPort = Number(env.PORT || 3000);
    if (!Number.isInteger(providerPort) || providerPort < 1 || providerPort > 65535) issues.push(_issue('error', 'PROVIDER_HTTP_PORT', 'must be a valid TCP port'));
    if (providerPort === publicPort) issues.push(_issue('error', 'PROVIDER_HTTP_PORT', 'must differ from PORT because health-server proxies public provider requests to the internal receiver'));
    if (prod && !db && !toBool(env.ALLOW_JSON_PROVIDER_RECEIPTS, false)) issues.push(_issue('error', 'DATABASE_URL', 'provider ingress requires PostgreSQL durability in production'));
    if (prod && !String(env.PUBLIC_BASE_URL || env.RAILWAY_PUBLIC_DOMAIN || '').trim()) issues.push(_issue('error', 'PUBLIC_BASE_URL', 'provider ingress needs a public callback base URL (PUBLIC_BASE_URL or RAILWAY_PUBLIC_DOMAIN)'));
    if (prod && !String(env.PROVIDER_SECRET_KEY || env.NOFUN_CONNECTION_MASTER_KEY || '').trim()) issues.push(_issue('error', 'PROVIDER_SECRET_KEY', 'provider connection secrets require an encryption key in production'));
  }

  return { ok: !issues.some(i => i.severity === 'error'), production: prod, issues };
}

module.exports = { toBool, isRailway, isProduction, parseHost, isLocalhostUrl, isPlaceholderSecret, hasPlaceholderUrlCredentials, isDiscordSnowflake, validateRuntimeEnvironment };
