'use strict';
const {createHash}=require('crypto');
const TIERS=Object.freeze(['T1','T2','T3','T4']);
function assignTiers(teamIds,{mode='BASIC',count=4,seed,manual={}}={}){
 const ids=(teamIds||[]).map(String);
 if(!ids.length||new Set(ids).size!==ids.length||ids.some(x=>!x||['default','current','global'].includes(x.toLowerCase())))throw Object.assign(Error('Canonical unique teams required'),{code:'INVALID_TEAMS'});
 if(!Number.isInteger(count)||count<1||count>TIERS.length)throw Object.assign(Error('Invalid tier count'),{code:'INVALID_TIER_COUNT'});
 mode=String(mode).toUpperCase();
 if(!['BASIC','RANDOM','MANUAL'].includes(mode))throw Object.assign(Error('Invalid tier mode'),{code:'INVALID_TIER_MODE'});
 if(mode==='RANDOM'&&!seed)throw Object.assign(Error('Auditable random seed required'),{code:'MISSING_SEED'});
 if(mode==='MANUAL'&&(Object.keys(manual).length!==ids.length||ids.some(id=>!TIERS.slice(0,count).includes(manual[id]))))throw Object.assign(Error('Every team requires a valid manual tier'),{code:'INVALID_MANUAL_TIERS'});
 const ordered=mode==='RANDOM'?ids.sort((a,b)=>createHash('sha256').update(`${seed}:${a}`).digest('hex').localeCompare(createHash('sha256').update(`${seed}:${b}`).digest('hex'))):ids.sort();
 return ordered.map((teamId,index)=>({teamId,tier:mode==='MANUAL'?manual[teamId]:TIERS[Math.min(count-1,Math.floor(index*count/ids.length))],mode,sourceSeed:mode==='RANDOM'?String(seed):null}));
}
module.exports={TIERS,assignTiers};
