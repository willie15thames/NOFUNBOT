'use strict';
// Explicit CI gate: disposable PostgreSQL with the complete migration chain applied.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const store = require('../src/storage/criticalStore');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set a disposable DATABASE_URL for this integration test');
  if (process.env.NODE_ENV === 'production') throw new Error('Do not run database integration fixtures in production');
  const key = `v204-ci:${randomUUID()}`;
  const jsonKey = `v204-ci-${randomUUID()}.json`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient();
  const migration = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20260927030000_v204_kv_table_alignment/migration.sql'), 'utf8');
  try {
    await Promise.all(Array.from({ length: 12 }, () => store.transact(key, { n: 0 }, d => { d.n++; })));
    assert.equal((await store.read(key, {})).n, 12);
    await assert.rejects(store.transact(key, {}, d => { d.n = 999; throw new Error('rollback'); }));
    assert.equal((await store.read(key, {})).n, 12);
    assert.equal((await prisma.botKv.findUnique({ where: { key } })).value.n, 12);
    await store.close();
    assert.equal((await store.read(key, {})).n, 12, 'connection reopen retains the committed record');
    console.log('PASS critical-store concurrency, rollback, reopen and Prisma table agreement');

    const jsonStore = require('../src/storage/jsonStore');
    await jsonStore.initStore();
    assert.equal(await jsonStore.writeThroughToDb(jsonKey, { value: 42 }), true);
    assert.deepEqual(await store.read(jsonKey), { value: 42 });
    assert.deepEqual((await prisma.botKv.findUnique({ where: { key: jsonKey } })).value, { value: 42 });
    console.log('PASS JSON compatibility writes use the same canonical table');

    const client = await pool.connect();
    try {
      assert.equal((await client.query(`SELECT to_regclass('public."BotKv"') AS name`)).rows[0].name, null,
        'migration fixtures require a freshly migrated disposable database without a legacy archive');
      await client.query('BEGIN');
      await client.query('CREATE TABLE public."BotKv" (LIKE public.bot_kv INCLUDING ALL)');
      await client.query('INSERT INTO public."BotKv" (key,value) VALUES ($1,$2)', [`${key}:legacy`, { lifetime: 7 }]);
      await client.query(migration);
      await client.query(migration);
      assert.deepEqual((await client.query('SELECT value FROM public.bot_kv WHERE key=$1', [`${key}:legacy`])).rows[0].value, { lifetime: 7 });
      assert.equal((await client.query('SELECT count(*)::int AS n FROM public."BotKv"')).rows[0].n, 1);
      await client.query('ROLLBACK');
      console.log('PASS legacy records preserved and reconciliation is idempotent');

      await client.query('BEGIN');
      await client.query('CREATE TABLE public."BotKv" (LIKE public.bot_kv INCLUDING ALL)');
      await client.query('INSERT INTO public."BotKv" (key,value) VALUES ($1,$2)', [key, { n: 999 }]);
      await assert.rejects(client.query(migration), /conflicting values/);
      await client.query('ROLLBACK');
      assert.equal((await store.read(key, {})).n, 12);
      console.log('PASS divergent legacy values block migration without overwriting canonical history');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  } finally {
    await pool.query('DELETE FROM public.bot_kv WHERE key = ANY($1::text[])', [[key, jsonKey]]);
    await prisma.$disconnect();
    await pool.end();
    await store.close();
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
