/*
 * NAVIGATION HEADER
 * FILE: scripts/export-postgres-to-json.js
 * LAYER: Maintenance and operational scripts
 * PURPOSE: Provides a project script for setup, auditing, deployment, or maintenance.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually run manually or from package.json / deployment hooks.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.log('DATABASE_URL not set. Skipping Postgres export.'); process.exit(0); }

const dataDir = process.env.BOT_DATA_DIR || path.join(require('os').tmpdir(), 'nofunleague-data');
const pool = new Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });

function sanitizeExportKey(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) return null;
  if (key.includes('..') || key.includes('/') || key.includes('\\')) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(key)) return null;
  if (!key.toLowerCase().endsWith('.json')) return null;
  return key;
}

(async () => {
  const res = await pool.query('SELECT "key", "value" FROM "BotKv" ORDER BY "key" ASC');
  let count = 0, skipped = 0;
  for (const row of res.rows) {
    const safeKey = sanitizeExportKey(row.key);
    if (!safeKey) { skipped += 1; console.warn(`Skipped unsafe export key: ${String(row.key)}`); continue; }
    const targetPath = path.resolve(dataDir, safeKey);
    if (!targetPath.startsWith(path.resolve(dataDir) + path.sep)) { skipped += 1; console.warn(`Skipped path escape attempt: ${String(row.key)}`); continue; }
    fs.writeFileSync(targetPath, JSON.stringify(row.value, null, 2), 'utf8');
    count += 1;
  }
  console.log(`Exported ${count} Postgres records back to JSON. Skipped ${skipped} unsafe record(s).`);
  await pool.end();
})().catch(async err => {
  console.error('Export failed:', err.message);
  await pool.end().catch(() => null);
  process.exit(1);
});
