/*
 * NAVIGATION HEADER
 * FILE: health-server.js
 * LAYER: Project file
 * PURPOSE: Exposes Railway health and deploy-context status while the bot boots and runs.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for request routing and payload generation.
 * RELATED FLOW: Railway deploy health checks and startup observability.
 * NOTE: Keep responses secret-free and safe for public health probing.
 */

'use strict';
// Standalone health server — starts immediately when Railway container boots.
// Keeps the healthcheck green while the bot runs its setup scripts.
const http = require('http');
const { getFeatureFlags } = require('./src/config/featureFlags');
const PORT = process.env.PORT || 3000;

function buildHealthPayload() {
  const flags = getFeatureFlags(process.env);
  return {
    status: 'ok',
    service: 'nofunleague-bot',
    timestamp: new Date().toISOString(),
    environment: flags.appEnv,
    releaseChannel: flags.releaseChannel,
    version: flags.releaseVersion,
    flags: {
      runPrismaMigrationsOnBoot: flags.runPrismaMigrationsOnBoot,
      runDbBootstrapOnBoot: flags.runDbBootstrapOnBoot,
      runJsonMigrationOnBoot: flags.runJsonMigrationOnBoot,
      enableQueueWorker: flags.enableQueueWorker,
    },
    checks: {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      hasRedisUrl: !!process.env.REDIS_URL,
      botDataDir: String(process.env.BOT_DATA_DIR || ''),
    },
  };
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    const payload = buildHealthPayload();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ status: 'not_found' }));
});

server.listen(PORT, () => {
  console.log(`[health] ok :${PORT}`);
});

server.on('error', err => {
  // Non-fatal — log and exit cleanly so the main process can take the port
  console.warn(`[health] port ${PORT} unavailable: ${err.message}`);
  process.exit(0);
});
