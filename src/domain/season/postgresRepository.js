'use strict';
class PostgresSeasonRepository {
  constructor(pool){ if(!pool) throw Error('PostgreSQL pool required'); this.pool=pool; }
  async createSeason(row){
    const r=await this.pool.query(`INSERT INTO "seasons" ("id","guildId","leagueId","ordinal","year","state")
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [row.id,row.guildId,row.leagueId,row.ordinal,row.year,row.state||'PRESEASON_SETUP']);
    return r.rows[0];
  }
  async createPolicyVersion(row){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      // Lock the parent season. PostgreSQL cannot combine an aggregate MAX()
      // with FOR UPDATE, and concurrent policy edits must serialize.
      const season=await client.query('SELECT id,state FROM "seasons" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 FOR UPDATE',[row.seasonId,row.guildId,row.leagueId]);
      if(!season.rowCount)throw Object.assign(new Error('Season not found in this league'),{code:'SEASON_NOT_FOUND'});
      if(season.rows[0].state!=='PRESEASON_SETUP'&&!row.retroactiveConfirmed)throw Object.assign(new Error('Explicit policy override confirmation required outside preseason setup'),{code:'RETROACTIVE_CONFIRMATION_REQUIRED'});
      const current=await client.query('SELECT COALESCE(MAX(version),0)::int AS v FROM "progression_policy_versions" WHERE "seasonId"=$1',[row.seasonId]);
      const version=Number(current.rows[0].v)+1;
      const r=await client.query(`INSERT INTO "progression_policy_versions"
        ("id","guildId","leagueId","seasonId","version","effectiveAt","policy","createdBy")
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *`,
        [row.id,row.guildId,row.leagueId,row.seasonId,version,row.effectiveAt,JSON.stringify(row.policy),row.createdBy]);
      await client.query('UPDATE "seasons" SET "policyVersionId"=$2,"updatedAt"=NOW() WHERE id=$1',[row.seasonId,row.id]);
      await client.query(`INSERT INTO "audit_events" ("guildId","userId","eventType",category,payload,outcome) VALUES($1,$2,'progression-policy-version','G2',$3::jsonb,'success')`,[row.guildId,row.createdBy,JSON.stringify({leagueId:row.leagueId,seasonId:row.seasonId,policyVersionId:row.id,version,retroactiveConfirmed:!!row.retroactiveConfirmed})]);
      await client.query('COMMIT'); return r.rows[0];
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async getSeasonForUpdate({guildId,seasonId}){
    const r=await this.pool.query('SELECT * FROM "seasons" WHERE id=$1 AND "guildId"=$2',[seasonId,guildId]);return r.rows[0]||null;
  }
  async updateSeasonState({guildId,seasonId,state}){
    const r=await this.pool.query('UPDATE "seasons" SET state=$3,"updatedAt"=NOW() WHERE id=$1 AND "guildId"=$2 RETURNING *',[seasonId,guildId,state]);return r.rows[0]||null;
  }
  async transitionSeason({guildId,seasonId,to,override=false}){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const row=(await client.query('SELECT * FROM "seasons" WHERE id=$1 AND "guildId"=$2 FOR UPDATE',[seasonId,guildId])).rows[0];
      if(!row){await client.query('ROLLBACK');return{ok:false,code:'NOT_FOUND'};}
      const {transition}=require('./stateMachine');
      const decision=transition(row.state,to,{override});
      if(!decision.ok){await client.query('ROLLBACK');return decision;}
      if(!override&&to==='PRESEASON_ACTIVE'){
        if(!row.policyVersionId){await client.query('ROLLBACK');return{ok:false,code:'POLICY_REQUIRED'};}
        const counts=(await client.query(`SELECT (SELECT COUNT(*)::int FROM "teams" WHERE "leagueId"=$1) AS teams,(SELECT COUNT(*)::int FROM "tier_assignments" WHERE "seasonId"=$2) AS tiers`,[row.leagueId,seasonId])).rows[0];
        if(!counts.teams||counts.tiers!==counts.teams){await client.query('ROLLBACK');return{ok:false,code:'TIERS_NOT_FINALIZED'};}
        const policy=(await client.query('SELECT policy FROM "progression_policy_versions" WHERE id=$1',[row.policyVersionId])).rows[0];
        const initial=require('../progression/policy').normalizePolicy(policy.policy).initial;
        if(initial.attributeBudget||initial.devTraits||initial.ageResets){
          const kinds=[initial.attributeBudget?'ATTRIBUTE_POINTS':null,initial.devTraits?'DEV_TRAIT':null,initial.ageResets?'AGE_RESET':null].filter(Boolean);
          const granted=(await client.query(`SELECT COUNT(*)::int AS n FROM "progression_grants" WHERE "seasonId"=$1 AND "ownerType"='TEAM' AND "sourceType"='INITIAL_TEAM' AND "rewardType"=ANY($2::text[])`,[seasonId,kinds])).rows[0].n;
          if(granted!==counts.teams*kinds.length){await client.query('ROLLBACK');return{ok:false,code:'INITIAL_GRANTS_INCOMPLETE'};}
        }
      }
      if(!override&&to==='POSTSEASON_ACTIVE'){
        const bracket=(await client.query('SELECT id FROM "postseason_brackets" WHERE "seasonId"=$1 AND status=$2',[seasonId,'ACTIVE'])).rows[0];
        if(!bracket){await client.query('ROLLBACK');return{ok:false,code:'BRACKET_REQUIRED'};}
      }
      if(!override&&row.state==='POSTSEASON_ACTIVE'&&to==='OFFSEASON'){
        const bracket=(await client.query('SELECT id FROM "postseason_brackets" WHERE "seasonId"=$1 AND status=$2',[seasonId,'COMPLETE'])).rows[0];
        if(!bracket){await client.query('ROLLBACK');return{ok:false,code:'BRACKET_INCOMPLETE'};}
      }
      const updated=(await client.query('UPDATE "seasons" SET state=$3,"updatedAt"=NOW() WHERE id=$1 AND "guildId"=$2 RETURNING *',[seasonId,guildId,to])).rows[0];
      await client.query('COMMIT');return{ok:true,season:updated};
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
}
module.exports={PostgresSeasonRepository};
