'use strict';
// Explicit CI gate: disposable PostgreSQL with the complete migration chain applied.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const {execFileSync}=require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const store = require('../src/storage/criticalStore');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set a disposable DATABASE_URL for this integration test');
  if (process.env.NODE_ENV === 'production') throw new Error('Do not run database integration fixtures in production');
  const key = `v204-ci:${randomUUID()}`;
  const scoreGuild=`rc6-ci-${randomUUID()}`;
  const scoreKey=`v204:lifetime:${scoreGuild}`;
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

    const contender=()=>JSON.parse(execFileSync(process.execPath,['-e',
      `const s=require('./src/storage/criticalStore');s.withExclusive(process.env.CI_LOCK_KEY,async()=>true).then(async r=>{console.log(JSON.stringify(r));await s.close();}).catch(e=>{console.error(e.message);process.exit(1)});`
    ],{cwd:path.join(__dirname,'..'),env:{...process.env,CI_LOCK_KEY:key},encoding:'utf8',timeout:15000}));
    await store.withExclusive(key,async()=>assert.equal(contender().acquired,false));
    assert.equal(contender().acquired,true);
    console.log('PASS session structural lock excludes another process and releases after completion');

    const history=require('../src/services/lifetimeHistoryService');
    const results=require('../src/league/gameResultService');
    process.env.GUILD_ID=scoreGuild;
    const state={leagueConfig:{game:'madden',proAm:{[scoreGuild]:{id:scoreGuild,teams:['Bears','Lions']}}},scheduleState:{},ocrGameResults:[],openTeamRegistry:[{leagueId:scoreGuild,baseTeam:'Bears',ownerId:'winner'},{leagueId:scoreGuild,baseTeam:'Lions',ownerId:'loser'}],games:new Map()};
    const input={homeTeam:'Bears',awayTeam:'Lions',homeScore:21,awayScore:14,week:1,leagueId:scoreGuild};
    const submitted=await Promise.all(Array.from({length:10},()=>results.submitGameResult(input,{state})));
    assert.equal(submitted.filter(x=>!x.deduped).length,1);
    assert.equal((await history.career(scoreGuild,'winner')).wins,1);
    const retracted=await Promise.all(Array.from({length:5},()=>results.retractGameResult({week:1,team1:'Bears',team2:'Lions',leagueId:scoreGuild},{state})));
    assert.equal(retracted.reduce((n,x)=>n+x.removed,0),1);
    assert.equal((await history.career(scoreGuild,'winner')).wins,0);
    await store.close();
    assert.equal(Object.values((await history.snapshot(scoreGuild)).results)[0].status,'RETRACTED');
    console.log('PASS concurrent score submissions/retractions and lifetime state after connection reopen');


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
    await pool.query('DELETE FROM public.bot_kv WHERE key = ANY($1::text[])', [[key, jsonKey,scoreKey]]);
    await require('../src/storage/jsonStore').closeStore();
    await prisma.$disconnect();
    await pool.end();
    await store.close();
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
