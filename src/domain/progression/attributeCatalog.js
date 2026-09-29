'use strict';
/* Canonical game/version attribute catalog. UI may filter these entries but must not invent attribute keys. */
const MADDEN_26 = [
 ['throw_accuracy_short','throwAccuracyShort','Short Throw Accuracy','SAC','SKILL',['QB']],
 ['throw_accuracy_mid','throwAccuracyMid','Medium Throw Accuracy','MAC','SKILL',['QB']],
 ['throw_accuracy_deep','throwAccuracyDeep','Deep Throw Accuracy','DAC','SKILL',['QB']],
 ['throw_on_run','throwOnRun','Throw on Run','TOR','SKILL',['QB']],
 ['throw_under_pressure','throwUnderPressure','Throw Under Pressure','TUP','MENTAL',['QB']],
 ['throw_power','throwPower','Throw Power','THP','PHYSICAL',['QB']],
 ['play_action','playAction','Play Action','PAC','MENTAL',['QB']],
 ['awareness','awareness','Awareness','AWR','MENTAL',[]],
 ['play_recognition','playRecognition','Play Recognition','PRC','MENTAL',['LB','CB','S','DL']],
 ['pursuit','pursuit','Pursuit','PUR','SKILL',['LB','CB','S','DL']],
 ['short_route','routeRunningShort','Short Route Running','SRR','SKILL',['WR','TE','RB']],
 ['medium_route','routeRunningMedium','Medium Route Running','MRR','SKILL',['WR','TE','RB']],
 ['deep_route','routeRunningDeep','Deep Route Running','DRR','SKILL',['WR','TE']],
 ['release','release','Release','REL','SKILL',['WR','TE']],
 ['catching','catching','Catching','CTH','SKILL',['WR','TE','RB','DB']],
 ['catch_in_traffic','catchInTraffic','Catch in Traffic','CIT','SKILL',['WR','TE','RB']],
 ['spectacular_catch','spectacularCatch','Spectacular Catch','SPC','SKILL',['WR','TE','RB']],
 ['truck','trucking','Trucking','TRK','PHYSICAL',['RB','WR','TE','QB']],
 ['break_tackle','breakTackle','Break Tackle','BTK','SKILL',['RB','WR','TE','QB']],
 ['stiff_arm','stiffArm','Stiff Arm','SFA','SKILL',['RB','WR','TE','QB']],
 ['spin_move','spinMove','Spin Move','SPM','SKILL',['RB','WR','TE','QB']],
 ['juke_move','jukeMove','Juke Move','JKM','SKILL',['RB','WR','TE','QB']],
 ['run_block','runBlock','Run Block','RBK','SKILL',['OL','TE','FB']],
 ['pass_block','passBlock','Pass Block','PBK','SKILL',['OL','TE','FB']],
 ['impact_block','impactBlock','Impact Block','IBK','PHYSICAL',['OL','TE','FB','DL']],
 ['block_shedding','blockShedding','Block Shedding','BSH','SKILL',['DL','LB']],
 ['power_moves','powerMoves','Power Moves','PWM','SKILL',['DL','LB']],
 ['finesse_moves','finesseMoves','Finesse Moves','FNM','SKILL',['DL','LB']],
 ['hit_power','hitPower','Hit Power','HTP','PHYSICAL',['LB','S','CB','DL']],
 ['man_coverage','manCoverage','Man Coverage','MCV','SKILL',['CB','S','LB']],
 ['zone_coverage','zoneCoverage','Zone Coverage','ZCV','SKILL',['CB','S','LB']],
 ['press','press','Press','PRS','SKILL',['CB']],
 ['tackle','tackle','Tackle','TAK','SKILL',['LB','S','CB','DL']],
 ['kick_power','kickPower','Kick Power','KPW','PHYSICAL',['K','P']],
 ['kick_accuracy','kickAccuracy','Kick Accuracy','KAC','SKILL',['K','P']],
 ['speed','speed','Speed','SPD','PHYSICAL',[]],
 ['acceleration','acceleration','Acceleration','ACC','PHYSICAL',[]],
 ['agility','agility','Agility','AGI','PHYSICAL',[]],
 ['strength','strength','Strength','STR','PHYSICAL',[]],
].map(([key,providerField,displayName,abbreviation,group,positionsAllowed])=>Object.freeze({
 gameId:'madden', gameVersion:'26', key, providerField, displayName, abbreviation, group, positionsAllowed,
 minValue:0,maxValue:99,defaultPointCost:1,active:true,
}));
const CATALOG=Object.freeze([...MADDEN_26]);
function listAttributes({gameId,gameVersion,position,policy}={}){
 return CATALOG.filter(x=>(!gameId||x.gameId===gameId)&&(!gameVersion||x.gameVersion===String(gameVersion))&&x.active)
 .filter(x=>!position||!x.positionsAllowed.length||x.positionsAllowed.includes(String(position).toUpperCase()))
 .filter(x=>!policy?.attribute?.allowedGroups?.length||policy.attribute.allowedGroups.includes(x.group))
 .filter(x=>!policy?.attribute?.allowlist?.length||policy.attribute.allowlist.includes(x.key))
 .filter(x=>!policy?.attribute?.denylist?.includes(x.key));
}
function resolveAttribute(ref,opts={}){const n=String(ref||'').trim().toLowerCase();return listAttributes(opts).find(x=>[x.key,x.providerField,x.displayName,x.abbreviation].some(v=>String(v).toLowerCase()===n))||null;}
module.exports={CATALOG,listAttributes,resolveAttribute};
