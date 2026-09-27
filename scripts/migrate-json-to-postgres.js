/*
 * NAVIGATION HEADER
 * FILE: scripts/migrate-json-to-postgres.js
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
const { createHash } = require('crypto');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log('DATABASE_URL not set. Skipping JSON migration.');
  process.exit(0);
}

const dataDir = process.env.BOT_DATA_DIR || path.join(require('os').tmpdir(), 'nofunleague-data');
const pool = new Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });

function checksum(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

(async () => {
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
  let count = 0;
  for (const filename of files) {
    const full = path.join(dataDir, filename);
    const raw = fs.readFileSync(full, 'utf8') || 'null';
    const data = JSON.parse(raw);
    const sum = checksum(data);
    await pool.query(
      `INSERT INTO "BotKv" ("key","value","source","checksum","updatedAt")
       VALUES ($1,$2::jsonb,$3,$4,NOW())
       ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value", "source"=EXCLUDED."source", "checksum"=EXCLUDED."checksum", "updatedAt"=NOW()`,
      [filename, JSON.stringify(data), 'json-import', sum]
    );
    count += 1;
    if (filename === 'serverSettings.json' && data && typeof data === 'object') {
      await pool.query(
        `INSERT INTO "GuildSetting" ("guildId","botStatus","audience","filterMode","toneVisible","timezone","payload","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
         ON CONFLICT ("guildId") DO UPDATE SET "botStatus"=EXCLUDED."botStatus", "audience"=EXCLUDED."audience", "filterMode"=EXCLUDED."filterMode", "toneVisible"=EXCLUDED."toneVisible", "timezone"=EXCLUDED."timezone", "payload"=EXCLUDED."payload", "updatedAt"=NOW()`,
        ['default', String(data.botStatus || 'active'), data.audienceRating || null, data.filterMode || 'strict', data.toneVisibility || 'public', data.timezone || null, JSON.stringify(data)]
      ).catch(() => null);
    }
  }
  console.log(`Migrated ${count} JSON files into Postgres.`);
  await pool.end();
})().catch(async err => {
  console.error('JSON migration failed:', err.message);
  await pool.end().catch(() => null);
  process.exit(1);
});
