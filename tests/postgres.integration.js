'use strict';
// Explicit CI gate: real PostgreSQL, not a mock. Never runs against production implicitly.
const assert=require('node:assert/strict');
const {randomUUID}=require('crypto');
const {Pool}=require('pg');
const store=require('../src/storage/criticalStore');
async function main(){
 if(!process.env.DATABASE_URL)throw new Error('Set a disposable DATABASE_URL for this integration test');
 const key=`v204-ci:${randomUUID()}`;
 try{
  await Promise.all(Array.from({length:12},()=>store.transact(key,{n:0},d=>{d.n++;})));
  assert.equal((await store.read(key,{})).n,12);
  await assert.rejects(store.transact(key,{},d=>{d.n=999;throw new Error('rollback');}));
  assert.equal((await store.read(key,{})).n,12);
  console.log('PostgreSQL critical-store concurrency and rollback passed');
 }finally{
  const pool=new Pool({connectionString:process.env.DATABASE_URL});await pool.query('DELETE FROM "BotKv" WHERE key=$1',[key]);await pool.end();await store.close();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
