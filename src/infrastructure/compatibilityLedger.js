'use strict';
const entries=new Map();
const counters=new Map();
function register(entry){
  for(const k of ['compatId','owner','replacement','removalCondition','deadlineRelease']) if(!entry?.[k]) throw Object.assign(new Error(`Compatibility entry missing ${k}`),{code:'INVALID_COMPATIBILITY_ENTRY'});
  if(entries.has(entry.compatId)) throw Object.assign(new Error(`Duplicate compatibility id ${entry.compatId}`),{code:'DUPLICATE_COMPATIBILITY_ID'});
  entries.set(entry.compatId,Object.freeze({...entry}));
}
function hit(compatId){if(!entries.has(compatId))throw Object.assign(new Error(`Unregistered compatibility path ${compatId}`),{code:'UNKNOWN_COMPATIBILITY'});counters.set(compatId,(counters.get(compatId)||0)+1);}
function report(){return [...entries.values()].map(e=>({...e,hits:counters.get(e.compatId)||0}));}
module.exports={register,hit,report};
