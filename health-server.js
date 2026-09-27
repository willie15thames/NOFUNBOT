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
    status: 'alive',
    readiness: require('./src/services/readinessService').read(),
    service: 'nofunleague-bot',
    timestamp: new Date().toISOString(),
    environment: flags.appEnv,
    releaseChannel: flags.releaseChannel,
    version: flags.releaseVersion,
    publicRelease: {
      version: flags.publicReleaseVersion,
      channel: flags.publicReleaseChannel,
    },
    flags: {
      runPrismaMigrationsOnBoot: flags.runPrismaMigrationsOnBoot,
      runDbBootstrapOnBoot: flags.runDbBootstrapOnBoot,
      runJsonMigrationOnBoot: flags.runJsonMigrationOnBoot,
      enableQueueWorker: flags.enableQueueWorker,
      publicPatchNotesEnabled: flags.publicPatchNotesEnabled,
      runtimeIncidentCaptureEnabled: flags.runtimeIncidentCaptureEnabled,
    },
    checks: {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      hasRedisUrl: !!process.env.REDIS_URL,
      botDataDir: String(process.env.BOT_DATA_DIR || ''),
      providerIngressEnabled: String(process.env.ENABLE_PROVIDER_HTTP || '').toLowerCase() === 'true',
      providerReceiverPort: Number(process.env.PROVIDER_HTTP_PORT || 3100),
      providerPublicBaseConfigured: !!(process.env.PUBLIC_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN),
      providerSecretEncryptionConfigured: !!(process.env.PROVIDER_SECRET_KEY || process.env.NOFUN_CONNECTION_MASTER_KEY),
    },
  };
}


function proxyProviderRequest(req, res) {
  const targetPort = Number(process.env.PROVIDER_HTTP_PORT || 3100);
  const headers = { ...req.headers, host: `127.0.0.1:${targetPort}` };
  const upstream = http.request({ hostname: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers }, up => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.setTimeout(30000, () => upstream.destroy(new Error('provider-upstream-timeout')));
  upstream.on('error', err => {
    if (res.headersSent) return res.destroy();
    res.writeHead(503, { 'Content-Type':'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok:false, reason:'provider-receiver-unavailable' }));
    console.warn(`[health] provider proxy unavailable: ${err.message}`);
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  if (String(req.url || '').startsWith('/v1/providers/')) { proxyProviderRequest(req, res); return; }
  if(req.url==='/ready'){const ready=require('./src/services/readinessService').read();res.writeHead(ready.ready?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify(ready));return;}
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
