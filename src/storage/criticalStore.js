'use strict';
// Critical business records: awaited PostgreSQL transaction, never best-effort fallback.
const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { getDataDir } = require('./jsonStore');
let pool;
const queues = new Map();
const clone = value => JSON.parse(JSON.stringify(value));
function db() {
  if (!pool) pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  return pool;
}
function file(key) { return path.join(getDataDir(), `critical-${createHash('sha256').update(key).digest('hex')}.json`); }
function localRead(key, fallback) {
  try { return JSON.parse(fs.readFileSync(file(key), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return clone(fallback); throw err; }
}
function localWrite(key, value) {
  const target = file(key), tmp = `${target}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, target);
  const dir = fs.openSync(getDataDir(), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
async function read(key, fallback = {}) {
  if (!process.env.DATABASE_URL) return localRead(key, fallback);
  const res = await db().query('SELECT value FROM "bot_kv" WHERE key=$1', [key]);
  return res.rows.length ? res.rows[0].value : clone(fallback);
}
async function transact(key, fallback, mutate) {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') throw new Error('PostgreSQL is required for critical production writes');
    const before = queues.get(key) || Promise.resolve();
    const work = before.catch(() => {}).then(async () => {
      const value = localRead(key, fallback);
      const result = await mutate(value);
      localWrite(key, value);
      return result;
    });
    queues.set(key, work);
    try { return await work; } finally { if (queues.get(key) === work) queues.delete(key); }
  }
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
    const rows = await client.query('SELECT value FROM "bot_kv" WHERE key=$1 FOR UPDATE', [key]);
    const value = rows.rows.length ? rows.rows[0].value : clone(fallback);
    const result = await mutate(value);
    await client.query('INSERT INTO "bot_kv" (key,value,source,"updatedAt") VALUES ($1,$2::jsonb,$3,NOW()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,source=EXCLUDED.source,"updatedAt"=NOW()', [key, JSON.stringify(value), 'v204-critical']);
    await client.query('COMMIT');
    return result;
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; }
  finally { client.release(); }
}
async function close() { if (pool) { await pool.end(); pool = null; } }
module.exports = { read, transact, close };
