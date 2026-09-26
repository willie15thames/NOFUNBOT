/*
 * NAVIGATION HEADER
 * FILE: src/storage/jsonStore.js
 * LAYER: Persistence/storage layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

// src/storage/jsonStore.js
// Hybrid JSON + Postgres + BullMQ persistence.
// Synchronous reads stay fast through in-memory cache and local JSON mirrors.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createHash } = require('crypto');

function resolveWritableDataDir() {
  const candidates = [
    process.env.BOT_DATA_DIR,
    path.join(process.cwd(), 'data'),
    path.join(os.tmpdir(), 'nofunleague-data'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
      return candidate;
    } catch (err) {
      console.warn(`[store] Data dir unavailable (${candidate}): ${err.message}`);
    }
  }

  throw new Error('No writable data directory available. Set BOT_DATA_DIR to a writable path.');
}

const DATA_DIR = resolveWritableDataDir();

const cache = new Map();
let dbPool = null;
let dbEnabled = false;
let bootstrapped = false;

function getFilePath(filename) {
  return path.join(DATA_DIR, filename);
}

function checksum(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function tryReadFile(filename, fallback) {
  const file = getFilePath(filename);
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[store] Failed to load ${filename}: ${err.message}`);
    return fallback;
  }
}

function mirrorToDisk(filename, data) {
  const file = getFilePath(filename);
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[store] Failed to save ${filename}: ${err.message}`);
  }
}

function getPgSslConfig() {
  if (process.env.NODE_ENV !== 'production') return undefined;
  const certPath = process.env.RAILWAY_SSL_CERT_PATH;
  if (!certPath) return undefined;
  try {
    return { rejectUnauthorized: true, ca: fs.readFileSync(certPath, 'utf8') };
  } catch (err) {
    console.warn(`[store] Failed to read RAILWAY_SSL_CERT_PATH (${certPath}): ${err.message}`);
    return { rejectUnauthorized: true };
  }
}

async function ensureDb() {
  if (dbPool || !process.env.DATABASE_URL) return dbPool;
  const { Pool } = require('pg');
  dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: getPgSslConfig(),
  });
  // MED-01 FIX: DDL removed from runtime — Prisma migration owns the BotKv schema.
  // The table is created by prisma/migrations/0001_init/migration.sql.
  dbEnabled = true;
  return dbPool;
}

async function initStore() {
  if (bootstrapped) return;
  bootstrapped = true;

  const filenames = fs.readdirSync(DATA_DIR).filter(name => name.endsWith('.json'));
  for (const filename of filenames) {
    cache.set(filename, tryReadFile(filename, null));
  }

  if (!process.env.DATABASE_URL) return;
  try {
    const pool = await ensureDb();
    const res = await pool.query('SELECT "key", "value" FROM "BotKv"');
    for (const row of res.rows) {
      cache.set(row.key, row.value);
      mirrorToDisk(row.key, row.value);
    }
    console.log(`[store] Postgres cache warmup complete (${res.rowCount} records).`);
  } catch (err) {
    dbEnabled = false;
    console.warn(`[store] Postgres init skipped: ${err.message}`);
  }
}

async function writeThroughToDb(filename, data, source = 'runtime') {
  if (!dbEnabled) return false;
  try {
    const pool = await ensureDb();
    await pool.query(
      `INSERT INTO "BotKv" ("key","value","source","checksum","updatedAt")
       VALUES ($1,$2::jsonb,$3,$4,NOW())
       ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value", "source"=EXCLUDED."source", "checksum"=EXCLUDED."checksum", "updatedAt"=NOW()`,
      [filename, JSON.stringify(data), source, checksum(data)]
    );
    return true;
  } catch (err) {
    console.warn(`[store] Postgres write failed for ${filename}: ${err.message}`);
    return false;
  }
}

function loadJson(filename, fallback) {
  if (cache.has(filename)) {
    const cached = cache.get(filename);
    return cached == null ? fallback : cached;
  }
  const data = tryReadFile(filename, fallback);
  cache.set(filename, data);
  return data;
}

function saveJson(filename, data) {
  cache.set(filename, data);
  mirrorToDisk(filename, data);
  writeThroughToDb(filename, data).catch(() => null);
}

const _timers = {};
function saveJsonDebounced(filename, data, delayMs = 2000) {
  cache.set(filename, data);
  if (_timers[filename]) clearTimeout(_timers[filename]);
  _timers[filename] = setTimeout(async () => {
    // BUG-06 FIX: always read the CURRENT cache value at write time, not the
    // value captured in the closure when the debounce was scheduled.
    // Prevents saveJson() overwriting stale debounced data.
    const currentData = cache.has(filename) ? cache.get(filename) : data;
    mirrorToDisk(filename, currentData);
    try {
      const { enqueueStorageSync } = require('../queue/queues');
      const queued = await enqueueStorageSync(filename, currentData).catch(() => false);
      if (!queued) await writeThroughToDb(filename, currentData, 'debounced');
    } catch {
      await writeThroughToDb(filename, currentData, 'debounced');
    }
    delete _timers[filename];
  }, delayMs);
}

function getDataDir() { return DATA_DIR; }
function getDataFilePath(filename) { return getFilePath(filename); }

module.exports = { loadJson, saveJson, saveJsonDebounced, initStore, writeThroughToDb, getDataDir, getDataFilePath };
