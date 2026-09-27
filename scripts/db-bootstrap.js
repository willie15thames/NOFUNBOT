/*
 * NAVIGATION HEADER
 * FILE: scripts/db-bootstrap.js
 * LAYER: Maintenance and operational scripts
 * PURPOSE: Provides a project script for setup, auditing, deployment, or maintenance.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually run manually or from package.json / deployment hooks.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log('DATABASE_URL not set. Skipping Database bootstrap.');
  process.exit(0);
}

const pool = new Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "BotKv" (
      "key" TEXT PRIMARY KEY,
      "value" JSONB NOT NULL,
      "source" TEXT NOT NULL DEFAULT 'json',
      "checksum" TEXT,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "GuildSetting" (
      "guildId" TEXT PRIMARY KEY,
      "botStatus" TEXT NOT NULL DEFAULT 'active',
      "audience" TEXT,
      "filterMode" TEXT DEFAULT 'strict',
      "toneVisible" TEXT DEFAULT 'public',
      "timezone" TEXT,
      "payload" JSONB,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "QueueAudit" (
      "id" BIGSERIAL PRIMARY KEY,
      "queueName" TEXT NOT NULL,
      "jobName" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "payload" JSONB,
      "result" JSONB,
      "error" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('Database bootstrap complete.');
  await pool.end();
})().catch(async err => {
  console.error('Database bootstrap failed:', err.message);
  await pool.end().catch(() => null);
  process.exit(1);
});
