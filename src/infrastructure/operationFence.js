'use strict';
const local = new Map();
const metrics = require('./scaleMetrics');

function assertScoped({guildId,key}) {
  if(!guildId || ['global','default'].includes(String(guildId).toLowerCase())) throw Object.assign(new Error('guildId required for operation fence'),{code:'INVALID_SCOPE'});
  if(!key) throw Object.assign(new Error('idempotency key required'),{code:'INVALID_IDEMPOTENCY_KEY'});
}
async function withFence({pool,guildId,key,ttlMs=300000},work){
  assertScoped({guildId,key});
  const full=`${guildId}:${key}`;
  if(!pool){
    const existing=local.get(full);
    if(existing&&existing>Date.now()){metrics.inc('operation_fence_duplicate_total',{mode:'local'});return{acquired:false,duplicate:true};}
    local.set(full,Date.now()+ttlMs);
    const started=Date.now(); metrics.inc('operation_fence_acquired_total',{mode:'local'});
    try{return{acquired:true,value:await work()};}finally{metrics.observe('operation_fence_duration_ms',{mode:'local'},Date.now()-started);local.delete(full);}
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const inserted=await client.query(
      `INSERT INTO "operation_fences" ("guildId","key","expiresAt")
       VALUES ($1,$2,NOW()+($3::text||' milliseconds')::interval)
       ON CONFLICT ("guildId","key") DO NOTHING RETURNING "key"`,[guildId,key,String(ttlMs)]);
    if(!inserted.rowCount){metrics.inc('operation_fence_duplicate_total',{mode:'postgres'});await client.query('ROLLBACK');return{acquired:false,duplicate:true};}
    const started=Date.now(); metrics.inc('operation_fence_acquired_total',{mode:'postgres'});
    const value=await work(client);
    metrics.observe('operation_fence_duration_ms',{mode:'postgres'},Date.now()-started);
    await client.query('COMMIT');
    return{acquired:true,value};
  }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
}
module.exports={withFence,assertScoped};
