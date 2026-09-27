/*
 * NAVIGATION HEADER
 * FILE: src/queue/worker.js
 * LAYER: Queue/background execution layer
 * PURPOSE: Durable storage-sync worker backed by Redis/BullMQ and PostgreSQL.
 * LOOK HERE FIRST WHEN DEBUGGING: main(), startWorker(), shutdown().
 * RELATED FLOW: scripts/railway-start.sh, BullMQ storage-sync queue, BotKv/QueueAudit tables.
 * NOTE: This is a dedicated worker process. Missing required infrastructure is fatal so Railway can restart/alert it.
 */

'use strict';

const fs = require('fs');
const { Worker } = require('bullmq');
const { Pool } = require('pg');
const IORedis = require('ioredis');
const { createHash } = require('crypto');

function getPgSslConfig() {
  if (process.env.NODE_ENV !== 'production' && process.env.APP_ENV !== 'production') return undefined;
  const certPath = process.env.RAILWAY_SSL_CERT_PATH;
  if (!certPath) return undefined;
  try {
    return { rejectUnauthorized: true, ca: fs.readFileSync(certPath, 'utf8') };
  } catch (err) {
    console.warn(`[worker] Failed to read RAILWAY_SSL_CERT_PATH (${certPath}): ${err.message}`);
    return { rejectUnauthorized: true };
  }
}

function checksum(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function startWorker(redisUrl, databaseUrl) {
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: 5000,
  });
  const pool = new Pool({ connectionString: databaseUrl, ssl: getPgSslConfig() });

  async function audit(status, jobName, payload, result, error) {
    try {
      await pool.query(
        'INSERT INTO "queue_audit" ("queueName","jobName","status","payload","result","error") VALUES ($1,$2,$3,$4,$5,$6)',
        ['storage-sync', jobName, status, payload || null, result || null, error || null]
      );
    } catch (err) {
      console.warn(`[worker] queue audit write failed: ${err.message}`);
    }
  }

  await Promise.all([connection.ping(), pool.query('SELECT 1')]);

  const worker = new Worker('storage-sync', async job => {
    const { filename, data } = job.data || {};
    if (!filename) throw new Error('storage-sync job missing filename');
    const sum = checksum(data);
    await pool.query(
      `INSERT INTO "bot_kv" ("key","value","source","checksum","updatedAt")
       VALUES ($1,$2::jsonb,$3,$4,NOW())
       ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value", "source"=EXCLUDED."source", "checksum"=EXCLUDED."checksum", "updatedAt"=NOW()`,
      [filename, JSON.stringify(data), 'bullmq', sum]
    );
    await audit('completed', job.name, job.data, { filename, checksum: sum }, null);
    return { filename, checksum: sum };
  }, { connection });

  worker.on('ready', () => console.log('[worker] storage-sync ready'));
  worker.on('error', err => console.error('[worker] error:', err?.message || err));
  worker.on('failed', async (job, err) => {
    console.error('[worker] failed:', job?.name, err?.message);
    await audit('failed', job?.name || 'unknown', job?.data || null, null, err?.message || 'unknown error');
  });

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    console.log(`[worker] shutdown requested (${signal})`);
    try { await worker.close(); } catch {}
    try { await connection.quit(); } catch { try { connection.disconnect(); } catch {} }
    try { await pool.end(); } catch {}
  }
  process.once('SIGTERM', () => shutdown('SIGTERM').finally(() => process.exit(0)));
  process.once('SIGINT', () => shutdown('SIGINT').finally(() => process.exit(0)));

  return { worker, connection, pool, shutdown };
}

async function main() {
  const redisUrl = String(process.env.REDIS_URL || '').trim();
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  const missing = [];
  if (!redisUrl) missing.push('REDIS_URL');
  if (!databaseUrl) missing.push('DATABASE_URL');
  if (missing.length) {
    console.error(`[worker] fatal: missing ${missing.join(', ')}. Dedicated queue worker cannot run safely.`);
    process.exitCode = 1;
    return;
  }
  try {
    await startWorker(redisUrl, databaseUrl);
  } catch (err) {
    console.error(`[worker] fatal startup failure: ${err?.message || err}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { startWorker, main, checksum };
