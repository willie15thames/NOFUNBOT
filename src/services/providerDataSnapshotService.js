/*
 * Canonical read-only provider data store. This is the normalization boundary for non-schedule provider data.
 * It never grants Discord roles or changes ownership. Downstream features may project validated data explicitly.
 * v204.7: stage writes are revision-aware so delayed provider deliveries cannot overwrite newer canonical data.
 */
'use strict';
const { loadJson, saveJson } = require('../storage/jsonStore');
const FILE='providerDataSnapshots.json';
function _store(){const s=loadJson(FILE,{version:2,providers:{}});return s&&typeof s==='object'?{version:2,...s,providers:s.providers||{}}:{version:2,providers:{}};}
function _num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function _time(v){if(v==null||v==='')return null;const n=_num(v);if(n!=null)return n;const t=Date.parse(String(v));return Number.isFinite(t)?t:null;}
function _isStale(existing,meta={}){
  if(!existing)return false;
  const prev=existing.meta||{};
  const a=_num(meta.revision), b=_num(prev.revision);
  if(a!=null&&b!=null&&a<b)return true;
  const at=_time(meta.sourceUpdatedAt ?? meta.updatedAt ?? meta.completedAt);
  const bt=_time(prev.sourceUpdatedAt ?? prev.updatedAt ?? prev.completedAt);
  if(at!=null&&bt!=null&&at<bt)return true;
  const ar=_time(meta.receivedAt), br=_time(prev.receivedAt);
  if(a==null&&b==null&&at==null&&bt==null&&ar!=null&&br!=null&&ar<br)return true;
  return false;
}
function saveStage(provider,stage,data,meta={}){
  const s=_store();const key=String(provider||'unknown');const stageKey=String(stage||'unknown');
  s.providers[key]=s.providers[key]||{stages:{}};s.providers[key].stages=s.providers[key].stages||{};
  const existing=s.providers[key].stages[stageKey]||null;
  if(_isStale(existing,meta)) return {...existing,ignoredStale:true};
  const row={stage:stageKey,data,meta:{...meta},updatedAt:Date.now(),ignoredStale:false};
  s.providers[key].stages[row.stage]=row;s.providers[key].latestStage=row.stage;s.providers[key].updatedAt=row.updatedAt;saveJson(FILE,s);return row;
}
function getStage(provider,stage){return _store().providers?.[String(provider)]?.stages?.[String(stage)]||null;}
function getProvider(provider){return _store().providers?.[String(provider)]||null;}
function summary(provider){const p=getProvider(provider);if(!p)return {provider,stages:[]};return {provider,stages:Object.values(p.stages||{}).map(x=>({stage:x.stage,updatedAt:x.updatedAt,count:Array.isArray(x.data)?x.data.length:null,meta:x.meta||{}})),latestStage:p.latestStage||null,updatedAt:p.updatedAt||null};}
module.exports={FILE,saveStage,getStage,getProvider,summary,_isStale};
