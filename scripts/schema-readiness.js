'use strict';
// Run after migration deployment, before the bot accepts interactions.
const {Pool}=require('pg');
async function main(){
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required for stable production state');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 try{
  for(const table of ['BotKv','guild_locks','member_ledger','member_profiles']){
   const r=await pool.query('SELECT to_regclass($1) AS name',[`public."${table}"`]);
   if(!r.rows[0].name)throw new Error(`Missing ${table}. Back up the database, then run npm run prisma:migrate:deploy against this DATABASE_URL.`);
  }
  const failed=await pool.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL');
  if(failed.rowCount)throw new Error('Unfinished database migration; repair migration history before starting');
  console.log('[schema] required production tables ready');
 }finally{await pool.end();}
}
main().catch(e=>{console.error('[schema]',e.message);process.exitCode=1;});
