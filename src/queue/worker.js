/*
 * NAVIGATION HEADER
 * FILE: src/queue/worker.js
 * LAYER: Queue/background execution layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const fs = require('fs');
const { Worker } = require('bullmq');
const { Pool } = require('pg');
const { createHash } = require('crypto');

const redisUrl = process.env.REDIS_URL;
const databaseUrl = process.env.DATABASE_URL;

// FIX: Graceful degradation instead of hard process.exit(1).
// The worker runs as a background process — crashing it silently leaves the bot
// without queue processing and no recovery mechanism.
if (!redisUrl) {
  console.warn('[worker] REDIS_URL is not set — worker entering idle mode. Will retry every 30s.');
}
if (!databaseUrl) {
  console.warn('[worker] DATABASE_URL is not set — worker entering idle mode. Will retry every 30s.');
}

if (!redisUrl || !databaseUrl) {
  // Poll until both become available (Railway may inject vars after process start)
  const _retryInterval = setInterval(() => {
    const r = process.env.REDIS_URL;
    const d = process.env.DATABASE_URL;
    if (r && d) {
      console.log('[worker] REDIS_URL and DATABASE_URL now available — restarting worker.');
      clearInterval(_retryInterval);
      startWorker(r, d);
    }
  }, 30_000);
  if (typeof _retryInterval.unref === 'function') _retryInterval.unref();
  // Keep process alive
  _retryInterval.unref?.();
} else {
  startWorker(redisUrl, databaseUrl);
}

function startWorker(redis, database) {

function getPgSslConfig() {
  if (process.env.NODE_ENV !== 'production') return undefined;
  const certPath = process.env.RAILWAY_SSL_CERT_PATH;
  if (!certPath) return undefined;
  try {
    return { rejectUnauthorized: true, ca: fs.readFileSync(certPath, 'utf8') };
  } catch (err) {
    console.warn(`[worker] Failed to read RAILWAY_SSL_CERT_PATH (${certPath}): ${err.message}`);
    return { rejectUnauthorized: true };
  }
}

const pool = new Pool({ connectionString: database, ssl: getPgSslConfig() });

function checksum(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function audit(status, jobName, payload, result, error) {
  await pool.query(
    'INSERT INTO "QueueAudit" ("queueName","jobName","status","payload","result","error") VALUES ($1,$2,$3,$4,$5,$6)',
    ['storage-sync', jobName, status, payload || null, result || null, error || null]
  ).catch(() => null);
}

(async () => {
  const worker = new Worker('storage-sync', async job => {
    const { filename, data } = job.data || {};
    const sum = checksum(data);
    await pool.query(
      `INSERT INTO "BotKv" ("key","value","source","checksum","updatedAt")
       VALUES ($1,$2::jsonb,$3,$4,NOW())
       ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value", "source"=EXCLUDED."source", "checksum"=EXCLUDED."checksum", "updatedAt"=NOW()`,
      [filename, JSON.stringify(data), 'bullmq', sum]
    );
    await audit('completed', job.name, job.data, { filename, checksum: sum }, null);
    return { filename, checksum: sum };
  }, { connection: { url: redis } });

  worker.on('ready', () => console.log('[worker] storage-sync ready'));
  worker.on('failed', async (job, err) => {
    console.error('[worker] failed:', job?.name, err?.message);
    await audit('failed', job?.name || 'unknown', job?.data || null, null, err?.message || 'unknown error');
  });
})();

} // end startWorker
