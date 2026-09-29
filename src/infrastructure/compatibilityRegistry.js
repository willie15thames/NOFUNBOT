'use strict';
const localHits=new Map();
const manifest=Object.freeze([
 {compatId:'legacy-active-league-registry',owner:'league-domain',replacement:'PostgreSQL League repository selectors',removalCondition:'all league writes/read-model hydration use canonical repository',deadlineRelease:'post-G3'},
 {compatId:'legacy-pending-attr-boosts',owner:'progression-domain',replacement:'ProgressionClaim + entitlements/wallets',removalCondition:'legacy pending boost migration reports zero active records',deadlineRelease:'G2-cutover'},
 {compatId:'legacy-game-identity-fallbacks',owner:'season-domain',replacement:'RequestContext canonical guild/league/season IDs',removalCondition:'no new placeholder identity writes and migration parity passes',deadlineRelease:'G3'},
 {compatId:'legacy-json-provider-snapshots',owner:'provider-domain',replacement:'validated provider repository/projection',removalCondition:'provider projection/restart parity passes in production',deadlineRelease:'post-G3'},
]);
function all(){return manifest.map(x=>({...x}));}
async function registerAll(pool){
 if(!pool)return all();
 for(const e of manifest) await pool.query(`INSERT INTO "compatibility_paths" ("compatId","owner","replacement","removalCondition","deadlineRelease")
 VALUES($1,$2,$3,$4,$5) ON CONFLICT ("compatId") DO UPDATE SET owner=EXCLUDED.owner,replacement=EXCLUDED.replacement,"removalCondition"=EXCLUDED."removalCondition","deadlineRelease"=EXCLUDED."deadlineRelease","updatedAt"=NOW()`,
 [e.compatId,e.owner,e.replacement,e.removalCondition,e.deadlineRelease]);
 return all();
}
async function hit(pool,compatId){
 const e=manifest.find(x=>x.compatId===compatId);if(!e)throw Object.assign(Error(`Unknown compatibility path ${compatId}`),{code:'UNKNOWN_COMPATIBILITY'});
 localHits.set(compatId,(localHits.get(compatId)||0)+1);
 if(pool)await pool.query('UPDATE "compatibility_paths" SET hits=hits+1,"lastHitAt"=NOW(),"updatedAt"=NOW() WHERE "compatId"=$1',[compatId]);
 return e;
}

function retirementReport({hitCounts={},conditions={}}={}){
 return manifest.map(e=>{
  const hits=Object.prototype.hasOwnProperty.call(hitCounts,e.compatId)?Number(hitCounts[e.compatId]||0):Number(localHits.get(e.compatId)||0);
  const conditionMet=conditions[e.compatId]===true;
  return {...e,hits,conditionMet,ready:conditionMet&&hits===0};
 });
}
function assertRetirementReady(compatId,options={}){
 const row=retirementReport(options).find(x=>x.compatId===compatId);
 if(!row)throw Object.assign(Error(`Unknown compatibility path ${compatId}`),{code:'UNKNOWN_COMPATIBILITY'});
 if(!row.ready)throw Object.assign(Error(`Compatibility path ${compatId} is not retirement-ready`),{code:'COMPATIBILITY_NOT_READY',details:row});
 return row;
}
function telemetrySnapshot(){return Object.fromEntries(manifest.map(e=>[e.compatId,Number(localHits.get(e.compatId)||0)]));}
function resetTelemetryForTests(){localHits.clear();}
module.exports={all,registerAll,hit,retirementReport,assertRetirementReady,telemetrySnapshot,resetTelemetryForTests};
