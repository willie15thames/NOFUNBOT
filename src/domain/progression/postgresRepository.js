'use strict';
const { randomUUID }=require('crypto');
class PostgresProgressionRepository{
 constructor(pool){if(!pool)throw Error('PostgreSQL pool required');this.pool=pool;}
 async getPolicy(id,client=this.pool){const r=await client.query('SELECT * FROM "progression_policy_versions" WHERE id=$1',[id]);return r.rows[0]||null;}
 async finalizeTiers({guildId,leagueId,seasonId,teamIds,seed,manual,actorId}){
  const client=await this.pool.connect();try{await client.query('BEGIN');
   const season=(await client.query('SELECT * FROM "seasons" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 FOR UPDATE',[seasonId,guildId,leagueId])).rows[0];
   if(!season||season.state!=='PRESEASON_SETUP'||!season.policyVersionId)throw Object.assign(Error('Preseason setup and policy required'),{code:'INVALID_SEASON_STATE'});
   const eligible=(await client.query('SELECT id FROM "teams" WHERE "leagueId"=$1',[leagueId])).rows.map(x=>x.id);
   if(teamIds.length!==eligible.length||teamIds.some(x=>!eligible.includes(x)))throw Object.assign(Error('Tier assignment must cover every canonical league team'),{code:'TEAM_SCOPE'});
   const existing=await client.query('SELECT id FROM "tier_assignments" WHERE "seasonId"=$1 LIMIT 1',[seasonId]);if(existing.rowCount)throw Object.assign(Error('Tiers already finalized'),{code:'TIERS_FINALIZED'});
   const {normalizePolicy}=require('./policy');const p=normalizePolicy((await this.getPolicy(season.policyVersionId,client)).policy);
   const {assignTiers}=require('./tiers');const tiers=assignTiers(teamIds,{mode:p.tier.mode,count:p.tier.count,seed,manual});
   for(const row of tiers)await client.query(`INSERT INTO "tier_assignments" (id,"guildId","leagueId","seasonId","teamId",tier,mode,"sourceSeed","manualActor","finalizedAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,[`tier_${randomUUID()}`,guildId,leagueId,seasonId,row.teamId,row.tier,row.mode,row.sourceSeed,row.mode==='MANUAL'?actorId:null]);
   await client.query('COMMIT');return tiers;
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }
 async grantInitialPackage({guildId,leagueId,seasonId,teamId}){
  const client=await this.pool.connect();try{await client.query('BEGIN');
   const season=(await client.query('SELECT * FROM "seasons" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 FOR UPDATE',[seasonId,guildId,leagueId])).rows[0];
   if(!season?.policyVersionId||season.state!=='PRESEASON_SETUP')throw Object.assign(Error('Preseason policy required'),{code:'INVALID_SEASON_STATE'});
   const team=(await client.query('SELECT id FROM "teams" WHERE id=$1 AND "leagueId"=$2',[teamId,leagueId])).rows[0];
   if(!team)throw Object.assign(Error('Team not in this league'),{code:'TEAM_SCOPE'});
   const policy=await this.getPolicy(season.policyVersionId,client);
   const {normalizePolicy}=require('./policy');const initial=normalizePolicy(policy.policy).initial;
   const specs=[['ATTRIBUTE_POINTS',initial.attributeBudget],['DEV_TRAIT',initial.devTraits],['AGE_RESET',initial.ageResets]];
   const rows=[];
   for(const [rewardType,amount] of specs){if(!amount)continue;
    rows.push(await this.addGrant({guildId,leagueId,seasonId,ownerType:'TEAM',ownerId:teamId,rewardType,quantity:rewardType==='ATTRIBUTE_POINTS'?1:amount,points:rewardType==='ATTRIBUTE_POINTS'?amount:0,sourceType:'INITIAL_TEAM',sourceId:'INITIAL',policyVersionId:season.policyVersionId},client));
   }
   await client.query('COMMIT');return rows;
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }
 async forfeitMemberTenure({guildId,leagueId,seasonId,membershipId,departureType}){
  const client=await this.pool.connect();try{await client.query('BEGIN');
   const season=(await client.query('SELECT * FROM "seasons" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 FOR UPDATE',[seasonId,guildId,leagueId])).rows[0];
   if(!season?.policyVersionId)throw Object.assign(Error('Season policy required'),{code:'POLICY_NOT_FOUND'});
   const {normalizePolicy}=require('./policy');const policy=normalizePolicy((await this.getPolicy(season.policyVersionId,client)).policy);
   const key={LEAVE:'onLeave',KICK:'onKick',BAN:'onBan'}[String(departureType).toUpperCase()];
   if(!key)throw Object.assign(Error('Invalid departure type'),{code:'INVALID_DEPARTURE'});
   await client.query('UPDATE "membership_tenures" SET "leftAt"=NOW(),"departureType"=$5,"updatedAt"=NOW() WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "membershipId"=$4 AND "leftAt" IS NULL',[guildId,leagueId,seasonId,membershipId,departureType]);
   let forfeited=0;
   if(policy.forfeiture[key]){
    const grants=await client.query(`UPDATE "progression_grants" SET status='FORFEITED',"updatedAt"=NOW() WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "ownerType"='MEMBER' AND "ownerId"=$4 AND status='AVAILABLE' RETURNING id`,[guildId,leagueId,seasonId,membershipId]);forfeited=grants.rowCount;
    await client.query(`UPDATE "progression_claims" SET status='FORFEITED',"updatedAt"=NOW() WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "membershipId"=$4 AND status='PENDING'`,[guildId,leagueId,seasonId,membershipId]);
    await client.query(`UPDATE "progression_wallets" SET forfeited=forfeited+GREATEST(0,earned-spent-forfeited-locked),"updatedAt"=NOW() WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "ownerType"='MEMBER' AND "ownerId"=$4`,[guildId,leagueId,seasonId,membershipId]);
   }
   await client.query('COMMIT');return{ok:true,forfeited};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }
 async addGrant(row,client=this.pool){
  const id=row.id||`grant_${randomUUID()}`;
  const r=await client.query(`INSERT INTO "progression_grants"
   ("id","guildId","leagueId","seasonId","ownerType","ownerId","rewardType","quantity","points","sourceType","sourceId","status","expiresAt","policyVersionId")
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'AVAILABLE',$12,$13)
   ON CONFLICT ("seasonId","ownerType","ownerId","rewardType","sourceType","sourceId") DO UPDATE SET "updatedAt"="progression_grants"."updatedAt"
   RETURNING *`,[id,row.guildId,row.leagueId,row.seasonId,row.ownerType,row.ownerId,row.rewardType,row.quantity||1,row.points||0,row.sourceType,row.sourceId||'',row.expiresAt||null,row.policyVersionId]);return r.rows[0];
 }
 async issueMemberReward(row){
  if(!row.sourceType||!row.sourceId)throw Object.assign(Error('Reward provenance required'),{code:'INVALID_PROVENANCE'});
  if(row.rewardType==='ATTRIBUTE_POINTS'&&(!Number.isInteger(row.points)||row.points<=0))throw Object.assign(Error('Positive point budget required'),{code:'INVALID_POINTS'});
  const client=await this.pool.connect();try{await client.query('BEGIN');
   const season=(await client.query('SELECT * FROM "seasons" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 FOR UPDATE',[row.seasonId,row.guildId,row.leagueId])).rows[0];
   if(!season||season.policyVersionId!==row.policyVersionId)throw Object.assign(Error('Effective season policy mismatch'),{code:'POLICY_SCOPE'});
   const tenure=(await client.query(`SELECT id FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "membershipId"=$4 AND "leftAt" IS NULL LIMIT 1`,[row.guildId,row.leagueId,row.seasonId,row.ownerId])).rows[0];
   if(!tenure)throw Object.assign(Error('Active membership required'),{code:'ACTIVE_MEMBERSHIP_REQUIRED'});
   const existing=(await client.query(`SELECT * FROM "progression_grants" WHERE "seasonId"=$1 AND "ownerType"='MEMBER' AND "ownerId"=$2 AND "rewardType"=$3 AND "sourceType"=$4 AND "sourceId"=$5`,[row.seasonId,row.ownerId,row.rewardType,row.sourceType,row.sourceId])).rows[0];
   if(existing){await client.query('COMMIT');return{...existing,idempotent:true};}
   let overflowPlan={ok:true,accepted:row.points||0,locked:0,forfeited:0,convertQuantity:0};
   if(row.rewardType==='ATTRIBUTE_POINTS'){
    const p=require('./policy').normalizePolicy((await this.getPolicy(row.policyVersionId,client)).policy);
    const wallet=(await client.query(`SELECT earned,spent,forfeited,locked FROM "progression_wallets" WHERE "seasonId"=$1 AND "ownerType"='MEMBER' AND "ownerId"=$2 AND currency='ATTRIBUTE_POINTS' FOR UPDATE`,[row.seasonId,row.ownerId])).rows[0]||{earned:0,spent:0,forfeited:0,locked:0};
    overflowPlan=require('./overflow').planOverflow({mode:p.attribute.overflow,cap:p.rewards.memberSeasonEarnedCap,currentEarned:Number(wallet.earned||0),incoming:row.points,conversion:p.attribute.overflowConversion,expiryDays:p.attribute.overflowExpiryDays});
    if(!overflowPlan.ok)throw Object.assign(Error('Member earned reward cap exceeded'),overflowPlan);
   }
   const primaryPoints=row.rewardType==='ATTRIBUTE_POINTS'?Number(overflowPlan.accepted||0):Number(row.points||0);
   let grant=null;
   if(row.rewardType!=='ATTRIBUTE_POINTS'||primaryPoints>0||overflowPlan.mode==='BANK_LOCKED'){
    const id=`grant_${randomUUID()}`;
    const points=row.rewardType==='ATTRIBUTE_POINTS'&&overflowPlan.mode==='BANK_LOCKED'?row.points:primaryPoints;
    const inserted=await client.query(`INSERT INTO "progression_grants" (id,"guildId","leagueId","seasonId","ownerType","ownerId","rewardType",quantity,points,"sourceType","sourceId",status,"expiresAt","policyVersionId",metadata) VALUES($1,$2,$3,$4,'MEMBER',$5,$6,$7,$8,$9,$10,'AVAILABLE',$11,$12,$13::jsonb) RETURNING *`,[id,row.guildId,row.leagueId,row.seasonId,row.ownerId,row.rewardType,row.quantity||1,points,row.sourceType,row.sourceId,row.expiresAt||null,row.policyVersionId,JSON.stringify({overflowMode:overflowPlan.mode||null,lockedPoints:overflowPlan.locked||0,forfeitedPoints:overflowPlan.forfeited||0})]);
    grant=inserted.rows[0];
   }
   if(row.rewardType==='ATTRIBUTE_POINTS'){
    const earnedDelta=row.points;
    await client.query(`INSERT INTO "progression_wallets" (id,"guildId","leagueId","seasonId","ownerType","ownerId",currency,earned,forfeited,locked) VALUES($1,$2,$3,$4,'MEMBER',$5,'ATTRIBUTE_POINTS',$6,$7,$8)
      ON CONFLICT ("seasonId","ownerType","ownerId",currency) DO UPDATE SET earned="progression_wallets".earned+EXCLUDED.earned,forfeited="progression_wallets".forfeited+EXCLUDED.forfeited,locked="progression_wallets".locked+EXCLUDED.locked,"updatedAt"=NOW()`,[`wallet_${randomUUID()}`,row.guildId,row.leagueId,row.seasonId,row.ownerId,earnedDelta,overflowPlan.forfeited||0,overflowPlan.locked||0]);
    if((overflowPlan.convertQuantity||0)>0){
      const conversionId=`grant_${randomUUID()}`;
      await client.query(`INSERT INTO "progression_grants" (id,"guildId","leagueId","seasonId","ownerType","ownerId","rewardType",quantity,points,"sourceType","sourceId",status,"policyVersionId",metadata) VALUES($1,$2,$3,$4,'MEMBER',$5,$6,$7,0,'OVERFLOW_CONVERSION',$8,'AVAILABLE',$9,$10::jsonb)`,[conversionId,row.guildId,row.leagueId,row.seasonId,row.ownerId,overflowPlan.convertRewardType,overflowPlan.convertQuantity,`${row.sourceType}:${row.sourceId}`,row.policyVersionId,JSON.stringify({convertedFrom:'ATTRIBUTE_POINTS',sourcePoints:row.points,remainderLocked:overflowPlan.convertRemainder||0})]);
    }
    if((overflowPlan.forfeited||0)>0){
      await client.query(`INSERT INTO "progression_grants" (id,"guildId","leagueId","seasonId","ownerType","ownerId","rewardType",quantity,points,"sourceType","sourceId",status,"expiresAt","policyVersionId",metadata) VALUES($1,$2,$3,$4,'MEMBER',$5,'ATTRIBUTE_POINTS',1,$6,'OVERFLOW_EXPIRE',$7,'EXPIRED',$8,$9,$10::jsonb)`,[`grant_${randomUUID()}`,row.guildId,row.leagueId,row.seasonId,row.ownerId,overflowPlan.forfeited,`${row.sourceType}:${row.sourceId}`,overflowPlan.expiresAt||new Date(),row.policyVersionId,JSON.stringify({expiredOverflow:true})]);
    }
   }
   await client.query(`INSERT INTO "audit_events" ("guildId","userId","eventType",category,payload,outcome) VALUES($1,$2,'progression-reward-issued','G2',$3::jsonb,'success')`,[row.guildId,row.actorId||row.ownerId,JSON.stringify({leagueId:row.leagueId,seasonId:row.seasonId,membershipId:row.ownerId,rewardType:row.rewardType,sourceType:row.sourceType,sourceId:row.sourceId,overflow:overflowPlan})]);
   await client.query('COMMIT');return{...(grant||{id:null,rewardType:overflowPlan.convertRewardType,quantity:overflowPlan.convertQuantity,status:'CONVERTED'}),idempotent:false,overflow:overflowPlan};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }
 async createClaim(row,client=this.pool){const id=row.id||`claim_${randomUUID()}`;const r=await client.query(`INSERT INTO "progression_claims"
 ("id","guildId","leagueId","seasonId","membershipId","teamId","playerId","grantId","policyVersionId","idempotencyKey","requestedMutations","status","requestedAt","actorId")
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'PENDING',NOW(),$12)
 ON CONFLICT ("guildId","idempotencyKey") DO NOTHING RETURNING *`,
 [id,row.guildId,row.leagueId,row.seasonId,row.membershipId,row.teamId,row.playerId,row.grantId,row.policyVersionId,row.idempotencyKey,JSON.stringify(row.requestedMutations||[]),row.actorId]);
 if(r.rowCount)return r.rows[0];
 const e=await client.query('SELECT * FROM "progression_claims" WHERE "guildId"=$1 AND "idempotencyKey"=$2',[row.guildId,row.idempotencyKey]);
 return {...e.rows[0],idempotent:true};
 }
 async requestAttribute(input,readProviderPlayer){
  const client=await this.pool.connect();try{await client.query('BEGIN');
   const season=(await client.query('SELECT id FROM "seasons" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 FOR UPDATE',[input.seasonId,input.guildId,input.leagueId])).rows[0];
   if(!season){await client.query('ROLLBACK');return{ok:false,code:'SEASON_NOT_FOUND'};}
   const prior=(await client.query('SELECT * FROM "progression_claims" WHERE "guildId"=$1 AND "idempotencyKey"=$2',[input.guildId,input.idempotencyKey])).rows[0];
   if(prior){await client.query('COMMIT');return{ok:true,idempotent:true,claim:prior};}
   const tenure=(await client.query(`SELECT id FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "membershipId"=$4 AND "teamId"=$5 AND "userId"=$6 AND "leftAt" IS NULL FOR UPDATE`,[input.guildId,input.leagueId,input.seasonId,input.membershipId,input.teamId,input.actorId])).rows[0];
   if(!tenure){await client.query('ROLLBACK');return{ok:false,code:'ACTIVE_TEAM_MEMBERSHIP_REQUIRED'};}
   const grant=(await client.query('SELECT * FROM "progression_grants" WHERE id=$1 FOR UPDATE',[input.grantId])).rows[0];
   if(!grant||grant.status!=='AVAILABLE'||grant.guildId!==input.guildId||grant.leagueId!==input.leagueId||grant.seasonId!==input.seasonId||!
       ((grant.ownerType==='MEMBER'&&grant.ownerId===input.membershipId)||(grant.ownerType==='TEAM'&&grant.ownerId===input.teamId))){await client.query('ROLLBACK');return{ok:false,code:'ENTITLEMENT_UNAVAILABLE'};}
   if(grant.expiresAt&&new Date(grant.expiresAt).getTime()<=Date.now()){await client.query('ROLLBACK');return{ok:false,code:'ENTITLEMENT_EXPIRED'};}
   const {validateGrantSpend}=require('./claimValidation');const budget=validateGrantSpend(grant,input.points);if(!budget.ok){await client.query('ROLLBACK');return budget;}
   const baseline=await readProviderPlayer(client,input);if(!baseline.ok){await client.query('ROLLBACK');return baseline;}
   const policy=await this.getPolicy(grant.policyVersionId,client);
   if(!policy||policy.guildId!==input.guildId||policy.leagueId!==input.leagueId||policy.seasonId!==input.seasonId){await client.query('ROLLBACK');return{ok:false,code:'POLICY_SCOPE'};}
   const spent=async(field,value,attributeOnly=false)=>Number((await client.query(`SELECT COALESCE(SUM(points),0)::int AS n FROM "player_mutations" WHERE "seasonId"=$1 AND "mutationType"='ATTRIBUTE' AND status='APPLIED' AND "${field}"=$2 ${attributeOnly?'AND "attributeKey"=$3':''}`,[input.seasonId,value,...(attributeOnly?[input.attributeKey]:[])])).rows[0].n||0);
   const reserved=async(field,value,attributeOnly=false)=>Number((await client.query(`SELECT COALESCE(SUM(("requestedMutations"->0->>'points')::int),0)::int AS n FROM "progression_claims" WHERE "seasonId"=$1 AND status='PENDING' AND "${field}"=$2 ${attributeOnly?'AND "requestedMutations"->0->>\'attributeKey\'=$3':''}`,[input.seasonId,value,...(attributeOnly?[input.attributeKey]:[])])).rows[0].n||0);
   const totals={memberSpent:await spent('membershipId',input.membershipId)+await reserved('membershipId',input.membershipId),teamSpent:await spent('teamId',input.teamId)+await reserved('teamId',input.teamId),playerSpent:await spent('playerId',input.playerId)+await reserved('playerId',input.playerId),attributeSpent:await spent('playerId',input.playerId,true)+await reserved('playerId',input.playerId,true)};
   const {validateAttributeSpend}=require('./policy');const decision=validateAttributeSpend({policy:policy.policy,attribute:input.attributeKey,group:baseline.attributeGroup,points:input.points,totals});
   if(!decision.ok){await client.query('ROLLBACK');return decision;}
   const pending=(await client.query(`SELECT COALESCE(SUM(("requestedMutations"->0->>'points')::int),0)::int AS n FROM "progression_claims" WHERE "grantId"=$1 AND status='PENDING'`,[grant.id])).rows[0].n;
   if(Number(pending)+input.points>Number(grant.points)){await client.query('ROLLBACK');return{ok:false,code:'ENTITLEMENT_RESERVED'};}
   const claim=await this.createClaim({...input,policyVersionId:grant.policyVersionId,requestedMutations:[{type:'ATTRIBUTE',attributeKey:input.attributeKey,attributeGroup:baseline.attributeGroup,points:input.points,before:baseline.rating,baselineProvenance:baseline.provenance}]},client);
   await client.query(`INSERT INTO "audit_events" ("guildId","userId","eventType",category,payload,outcome) VALUES($1,$2,'progression-claim-request','G2',$3::jsonb,'pending')`,[input.guildId,input.actorId,JSON.stringify({claimId:claim.id,leagueId:input.leagueId,seasonId:input.seasonId,grantId:grant.id,baselineSnapshotId:baseline.provenance.snapshotId})]);
   await client.query('COMMIT');return{ok:true,claim};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }
 async requestSpecial(input,readProvider){
  const client=await this.pool.connect();try{await client.query('BEGIN');
   const season=(await client.query('SELECT id FROM "seasons" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 FOR UPDATE',[input.seasonId,input.guildId,input.leagueId])).rows[0];
   if(!season){await client.query('ROLLBACK');return{ok:false,code:'SEASON_NOT_FOUND'};}
   const prior=(await client.query('SELECT * FROM "progression_claims" WHERE "guildId"=$1 AND "idempotencyKey"=$2',[input.guildId,input.idempotencyKey])).rows[0];
   if(prior){await client.query('COMMIT');return{ok:true,idempotent:true,claim:prior};}
   const tenure=(await client.query(`SELECT id FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "membershipId"=$4 AND "teamId"=$5 AND "userId"=$6 AND "leftAt" IS NULL`,[input.guildId,input.leagueId,input.seasonId,input.membershipId,input.teamId,input.actorId])).rows[0];
   if(!tenure){await client.query('ROLLBACK');return{ok:false,code:'ACTIVE_TEAM_MEMBERSHIP_REQUIRED'};}
   const grant=(await client.query('SELECT * FROM "progression_grants" WHERE id=$1 FOR UPDATE',[input.grantId])).rows[0];
   if(!grant||grant.status!=='AVAILABLE'||grant.rewardType!==input.rewardType||grant.quantity<1||grant.guildId!==input.guildId||grant.leagueId!==input.leagueId||grant.seasonId!==input.seasonId||
     !((grant.ownerType==='MEMBER'&&grant.ownerId===input.membershipId)||(grant.ownerType==='TEAM'&&grant.ownerId===input.teamId))){await client.query('ROLLBACK');return{ok:false,code:'ENTITLEMENT_UNAVAILABLE'};}
   if(grant.expiresAt&&new Date(grant.expiresAt).getTime()<=Date.now()){await client.query('ROLLBACK');return{ok:false,code:'ENTITLEMENT_EXPIRED'};}
   const policy=(await this.getPolicy(grant.policyVersionId,client))?.policy;
   if(!policy){await client.query('ROLLBACK');return{ok:false,code:'POLICY_NOT_FOUND'};}
   const rule=require('./policy').normalizePolicy(policy).special;
   const before=await readProvider(client,input);if(!before.ok){await client.query('ROLLBACK');return before;}
   const traitKey=x=>String(x||'').trim().toLowerCase().replace(/[\s_-]+/g,'');
   const target=input.rewardType==='DEV_TRAIT'?traitKey(input.target):rule.ageResetTarget;
   const allowed=input.rewardType==='DEV_TRAIT'?rule.devTraitTransitions.some(x=>traitKey(x.from)===traitKey(before.value)&&traitKey(x.to)===target):
     Number.isInteger(target)&&Number(before.value)>target;
   if(!allowed){await client.query('ROLLBACK');return{ok:false,code:'SPECIAL_POLICY_BLOCKED'};}
   const reserved=Number((await client.query(`SELECT COUNT(*)::int AS n FROM "progression_claims" WHERE "grantId"=$1 AND status='PENDING'`,[grant.id])).rows[0].n);
   if(reserved>=Number(grant.quantity)){await client.query('ROLLBACK');return{ok:false,code:'ENTITLEMENT_RESERVED'};}
   const claim=await this.createClaim({...input,policyVersionId:grant.policyVersionId,requestedMutations:[{type:input.rewardType,before:before.value,after:target,baselineProvenance:before.provenance}]},client);
   await client.query('COMMIT');return{ok:true,claim};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }
 async approveSpecial(input,readProvider){
  const client=await this.pool.connect();try{await client.query('BEGIN');
   const season=(await client.query('SELECT id FROM "seasons" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 FOR UPDATE',[input.seasonId,input.guildId,input.leagueId])).rows[0];
   if(!season){await client.query('ROLLBACK');return{ok:false,code:'SEASON_NOT_FOUND'};}
   const claim=(await client.query('SELECT * FROM "progression_claims" WHERE id=$1 FOR UPDATE',[input.claimId])).rows[0];
   if(!claim||claim.guildId!==input.guildId||claim.leagueId!==input.leagueId||claim.seasonId!==input.seasonId||claim.status!=='PENDING'){await client.query('ROLLBACK');return{ok:false,code:'CLAIM_NOT_PENDING'};}
   const requested=claim.requestedMutations?.[0];
   if(!['DEV_TRAIT','AGE_RESET'].includes(requested?.type)){await client.query('ROLLBACK');return{ok:false,code:'INVALID_CLAIM'};}
   const tenure=(await client.query(`SELECT id FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "membershipId"=$4 AND "teamId"=$5 AND "userId"=$6 AND "leftAt" IS NULL`,[input.guildId,input.leagueId,input.seasonId,claim.membershipId,claim.teamId,claim.actorId])).rows[0];
   if(!tenure){await client.query('ROLLBACK');return{ok:false,code:'ACTIVE_TEAM_MEMBERSHIP_REQUIRED'};}
   const grant=(await client.query('SELECT * FROM "progression_grants" WHERE id=$1 FOR UPDATE',[claim.grantId])).rows[0];
   if(!grant||grant.status!=='AVAILABLE'||grant.quantity<1||grant.rewardType!==requested.type||grant.policyVersionId!==claim.policyVersionId||grant.guildId!==input.guildId||grant.leagueId!==input.leagueId||grant.seasonId!==input.seasonId||
     !((grant.ownerType==='MEMBER'&&grant.ownerId===claim.membershipId)||(grant.ownerType==='TEAM'&&grant.ownerId===claim.teamId))){await client.query('ROLLBACK');return{ok:false,code:'ENTITLEMENT_UNAVAILABLE'};}
   const after=await readProvider(client,{guildId:input.guildId,leagueId:input.leagueId,teamId:claim.teamId,playerId:claim.playerId,rewardType:requested.type,afterReceivedAt:requested.baselineProvenance?.verifiedAt});
   const valueMatches=requested.type==='DEV_TRAIT'?String(after.value||'').trim().toLowerCase().replace(/[\s_-]+/g,'')===String(requested.after||'').trim().toLowerCase().replace(/[\s_-]+/g,''):Number(after.value)===Number(requested.after);
   if(!after.ok||!valueMatches||after.provenance?.provider!==requested.baselineProvenance?.provider||after.provenance?.snapshotId===requested.baselineProvenance?.snapshotId){await client.query('ROLLBACK');return{ok:false,code:'PROVIDER_MUTATION_MISMATCH'};}
   const used=(await client.query(`SELECT id FROM "player_mutations" WHERE "seasonId"=$1 AND "playerId"=$2 AND "mutationType"=$3 AND "providerVerification"->>'snapshotId'=$4 LIMIT 1`,[input.seasonId,claim.playerId,requested.type,after.provenance.snapshotId])).rows[0];
   if(used){await client.query('ROLLBACK');return{ok:false,code:'PROVIDER_EVIDENCE_ALREADY_USED'};}
   const mutationId=`mutation_${randomUUID()}`;
   await client.query(`UPDATE "progression_grants" SET quantity=quantity-1,status=CASE WHEN quantity=1 THEN 'CONSUMED' ELSE status END,"updatedAt"=NOW() WHERE id=$1`,[grant.id]);
   await client.query(`INSERT INTO "player_mutations" (id,"guildId","leagueId","seasonId","membershipId","teamId","playerId","claimId","mutationType",points,before,after,"providerVerification",status,"actorId","appliedAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10::jsonb,$11::jsonb,$12::jsonb,'APPLIED',$13,NOW())`,[mutationId,input.guildId,input.leagueId,input.seasonId,claim.membershipId,claim.teamId,claim.playerId,claim.id,requested.type,JSON.stringify(requested.before),JSON.stringify(after.value),JSON.stringify(after.provenance),input.approvalActorId]);
   await client.query(`INSERT INTO "entitlement_consumptions" (id,"grantId","claimId","mutationId",quantity,"consumedAt") VALUES($1,$2,$3,$4,1,NOW())`,[`consume_${randomUUID()}`,grant.id,claim.id,mutationId]);
   await client.query(`UPDATE "progression_claims" SET status='APPROVED',"approvedBy"=$2,"approvedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1`,[claim.id,input.approvalActorId]);
   await client.query('COMMIT');return{ok:true,claim:{...claim,status:'APPROVED'},mutationId};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }
 async claimAttribute(input,verifyPlayer){
  const client=await this.pool.connect();try{await client.query('BEGIN');
   // All claims in one season serialize before evaluating aggregate caps.
   // The season lock also orders concurrent claims for different grants.
   const season=(await client.query('SELECT id FROM "seasons" WHERE id=$1 AND "guildId"=$2 AND "leagueId"=$3 FOR UPDATE',[input.seasonId,input.guildId,input.leagueId])).rows[0];
   if(!season){await client.query('ROLLBACK');return{ok:false,code:'SEASON_NOT_FOUND'};}
   const prior=(await client.query('SELECT * FROM "progression_claims" WHERE "guildId"=$1 AND "idempotencyKey"=$2',[input.guildId,input.idempotencyKey])).rows[0];
   if(prior&&(!input.existingClaimId||prior.status!=='PENDING')){await client.query('COMMIT');return{ok:true,idempotent:true,claim:prior};}
   if(input.existingClaimId&&(!prior||prior.id!==input.existingClaimId||prior.status!=='PENDING')){await client.query('ROLLBACK');return{ok:false,code:'CLAIM_NOT_PENDING'};}
   const tenure=(await client.query(`SELECT id FROM "membership_tenures" WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "membershipId"=$4 AND "teamId"=$5 AND "userId"=$6 AND "leftAt" IS NULL FOR UPDATE`,[input.guildId,input.leagueId,input.seasonId,input.membershipId,input.teamId,input.actorId])).rows[0];
   if(!tenure){await client.query('ROLLBACK');return{ok:false,code:'ACTIVE_TEAM_MEMBERSHIP_REQUIRED'};}
   const grant=(await client.query('SELECT * FROM "progression_grants" WHERE id=$1 FOR UPDATE',[input.grantId])).rows[0];
   if(!grant||grant.status!=='AVAILABLE'||Number(grant.quantity)<=0){await client.query('ROLLBACK');return{ok:false,code:'ENTITLEMENT_UNAVAILABLE'};}
   if(!((grant.ownerType==='MEMBER'&&grant.ownerId===input.membershipId)||(grant.ownerType==='TEAM'&&grant.ownerId===input.teamId))){await client.query('ROLLBACK');return{ok:false,code:'ENTITLEMENT_OWNERSHIP'};}
   if(grant.guildId!==input.guildId||grant.leagueId!==input.leagueId||grant.seasonId!==input.seasonId){await client.query('ROLLBACK');return{ok:false,code:'ENTITLEMENT_SCOPE'};}
   if(grant.expiresAt&&new Date(grant.expiresAt).getTime()<=Date.now()){await client.query('ROLLBACK');return{ok:false,code:'ENTITLEMENT_EXPIRED'};}
   const {validateGrantSpend,validateProviderEvidence}=require('./claimValidation');
   const budget=validateGrantSpend(grant,input.points);if(!budget.ok){await client.query('ROLLBACK');return budget;}
   const policyRow=await this.getPolicy(grant.policyVersionId,client);if(!policyRow){await client.query('ROLLBACK');return{ok:false,code:'POLICY_NOT_FOUND'};}
   if(policyRow.guildId!==input.guildId||policyRow.leagueId!==input.leagueId||policyRow.seasonId!==input.seasonId){await client.query('ROLLBACK');return{ok:false,code:'POLICY_SCOPE'};}
   const verified=await verifyPlayer(input,client);
   const evidence=validateProviderEvidence(input,verified);if(!evidence.ok){await client.query('ROLLBACK');return evidence;}
   if(prior){const requested=prior.requestedMutations?.[0];if(!requested||requested.attributeKey!==input.attributeKey||requested.points!==input.points||requested.before!==evidence.before||
      requested.baselineProvenance?.snapshotId===verified.provenance.snapshotId){await client.query('ROLLBACK');return{ok:false,code:'CLAIM_EVIDENCE_MISMATCH'};}}
   const used=(await client.query(`SELECT id FROM "player_mutations" WHERE "seasonId"=$1 AND "playerId"=$2 AND "attributeKey"=$3 AND "mutationType"='ATTRIBUTE' AND status='APPLIED' AND "providerVerification"->>'snapshotId'=$4 LIMIT 1`,[input.seasonId,input.playerId,input.attributeKey,verified.provenance.snapshotId])).rows[0];
   if(used){await client.query('ROLLBACK');return{ok:false,code:'PROVIDER_EVIDENCE_ALREADY_USED'};}
   const {validateAttributeSpend}=require('./policy');
   const sum=async(where,args)=>Number((await client.query(`SELECT COALESCE(SUM(points),0)::int AS n FROM "player_mutations" WHERE "seasonId"=$1 AND "mutationType"='ATTRIBUTE' AND status='APPLIED' AND ${where}`,[input.seasonId,...args])).rows[0].n||0);
   const totals={memberSpent:await sum('"membershipId"=$2',[input.membershipId]),teamSpent:await sum('"teamId"=$2',[input.teamId]),playerSpent:await sum('"playerId"=$2',[input.playerId]),attributeSpent:await sum('"playerId"=$2 AND "attributeKey"=$3',[input.playerId,input.attributeKey])};
   const check=validateAttributeSpend({policy:policyRow.policy,attribute:input.attributeKey,group:input.attributeGroup,points:input.points,totals});if(!check.ok){await client.query('ROLLBACK');return check;}
   const claim=prior||await this.createClaim({...input,policyVersionId:grant.policyVersionId,requestedMutations:[{type:'ATTRIBUTE',attributeKey:input.attributeKey,attributeGroup:input.attributeGroup,points:input.points}]},client);
   if(claim.idempotent){await client.query('COMMIT');return{ok:true,idempotent:true,claim};}
   const mutationId=`mutation_${randomUUID()}`;
   await client.query(`UPDATE "progression_grants" SET points=points-$2,quantity=CASE WHEN points-$2=0 THEN 0 ELSE quantity END,status=CASE WHEN points-$2=0 THEN 'CONSUMED' ELSE status END,"updatedAt"=NOW() WHERE id=$1`,[grant.id,input.points]);
   if(grant.ownerType==='MEMBER'){
    const wallet=await client.query(`UPDATE "progression_wallets" SET spent=spent+$5,"updatedAt"=NOW() WHERE "guildId"=$1 AND "leagueId"=$2 AND "seasonId"=$3 AND "ownerType"='MEMBER' AND "ownerId"=$4 AND currency='ATTRIBUTE_POINTS' AND earned-spent-forfeited-locked >= $5 RETURNING id`,[input.guildId,input.leagueId,input.seasonId,input.membershipId,input.points]);
    if(!wallet.rowCount)throw Object.assign(Error('Member wallet balance mismatch'),{code:'WALLET_INSUFFICIENT'});
    // Grant-backed claims keep walletId NULL (the schema requires exactly
    // one claim funding reference). The wallet debit mirrors the grant spend.
   }
   const mut=(await client.query(`INSERT INTO "player_mutations" ("id","guildId","leagueId","seasonId","membershipId","teamId","playerId","claimId","mutationType","attributeKey","points","before","after","providerVerification","status","actorId","appliedAt")
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ATTRIBUTE',$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,'APPLIED',$14,NOW()) RETURNING *`,
 [mutationId,input.guildId,input.leagueId,input.seasonId,input.membershipId,input.teamId,input.playerId,claim.id,input.attributeKey,input.points,JSON.stringify(evidence.before),JSON.stringify(evidence.after),JSON.stringify(verified.provenance),input.actorId])).rows[0];
   await client.query(`INSERT INTO "entitlement_consumptions" ("id","grantId","claimId","mutationId","quantity","consumedAt") VALUES($1,$2,$3,$4,$5,NOW())`,[`consume_${randomUUID()}`,grant.id,claim.id,mutationId,input.points]);
   await client.query(`UPDATE "progression_claims" SET status='APPROVED',"approvedBy"=$2,"approvedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1`,[claim.id,input.approvalActorId||input.actorId]);
   await client.query(`INSERT INTO "audit_events" ("guildId","userId","eventType",category,payload,outcome) VALUES($1,$2,'progression-claim-approved','G2',$3::jsonb,'success')`,[input.guildId,input.approvalActorId||input.actorId,JSON.stringify({claimId:claim.id,mutationId,leagueId:input.leagueId,seasonId:input.seasonId,providerSnapshotId:verified.provenance.snapshotId})]);
   await client.query('COMMIT');return{ok:true,claim:{...claim,status:'APPROVED',approvedBy:input.approvalActorId||input.actorId},mutation:mut};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
}
module.exports={PostgresProgressionRepository};
