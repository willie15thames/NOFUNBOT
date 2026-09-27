'use strict';
const { test, run, assert } = require('./_harness');
const { validateRuntimeEnvironment } = require('../src/config/runtimeValidation');

function base() {
  return {
    APP_ENV: 'production',
    RAILWAY_ENVIRONMENT: 'production',
    DISCORD_TOKEN: 'real-looking-token-value',
    CLIENT_ID: '111111111111111111',
    GUILD_ID: '222222222222222222',
    DATABASE_URL: 'postgresql://u:p@postgres.railway.internal:5432/db',
    REDIS_URL: 'redis://default:p@redis.railway.internal:6379',
    ENABLE_QUEUE_WORKER: 'true',
    RUN_PRISMA_MIGRATIONS_ON_BOOT: 'true',
    AI_ENABLED: 'false',
    BOT_DATA_DIR: '/data',
  };
}

test('production rejects localhost database/redis endpoints', () => {
  const env = { ...base(), DATABASE_URL: 'postgresql://u:p@localhost:5432/db', REDIS_URL: 'redis://localhost:6379' };
  const r = validateRuntimeEnvironment(env);
  assert(!r.ok, 'validation fails');
  assert(r.issues.some(i => i.key === 'DATABASE_URL' && i.severity === 'error'), 'database localhost rejected');
  assert(r.issues.some(i => i.key === 'REDIS_URL' && i.severity === 'error'), 'redis localhost rejected');
});

test('enabled AI rejects placeholder key', () => {
  const env = { ...base(), AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'your_anthropic_api_key' };
  const r = validateRuntimeEnvironment(env);
  assert(!r.ok, 'placeholder rejected');
  assert(r.issues.some(i => i.key === 'ANTHROPIC_API_KEY' && i.severity === 'error'), 'AI key issue');
});

test('valid Railway-style production references pass hard validation', () => {
  const r = validateRuntimeEnvironment(base());
  assert(r.ok, 'valid configuration has no hard errors');
});


test('production rejects placeholder URL credentials and malformed Discord IDs', () => {
  const env = {
    ...base(),
    CLIENT_ID: 'not-a-snowflake',
    DATABASE_URL: 'postgresql://user:password@postgres.railway.internal:5432/db',
    REDIS_URL: 'redis://default:password@redis.railway.internal:6379',
  };
  const r = validateRuntimeEnvironment(env);
  assert(!r.ok, 'placeholder/malformed configuration rejected');
  assert(r.issues.some(i => i.key === 'CLIENT_ID' && i.severity === 'error'), 'bad client id rejected');
  assert(r.issues.some(i => i.key === 'DATABASE_URL' && /placeholder/.test(i.message)), 'database placeholder rejected');
  assert(r.issues.some(i => i.key === 'REDIS_URL' && /placeholder/.test(i.message)), 'redis placeholder rejected');
});

run('runtimeValidation.test.js');
