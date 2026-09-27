'use strict';
// Compatibility view: existing service references read the selected space at access time.
const context=require('./spaceContext');
const {loadJson,saveJson}=require('../storage/jsonStore');
const fields=new Set(['leagueConfig','scheduleState','hubWeeklyData','leagueMemory','ocrGameResults','potwHistory','yearlyAwardHistory','superbowlHistory','streamMilestones','currentStatLeaders','rewardsBoardIds']);
const maps=new Set(['players','games','pendingTrades','pendingAttrBoosts']);
const states=new Map();
function blank(root,id){
  const league=require('../services/activeLeagueService').getLeague(id)||{};
  return {leagueConfig:{rulesText:root.leagueConfig.rulesText,commissionerRoleId:root.leagueConfig.commissionerRoleId,...league,leagueId:id,proAm:{}},scheduleState:{week:null,matchups:[],pinnedMsgId:null,lastPosted:null,timerId:null},hubWeeklyData:{week:null,scores:[],statLines:[],standings:null,potwCandidate:null,released:false,releaseTimerId:null,potwTimerId:null},leagueMemory:{scores:[],statLines:[],potw:[],superbowls:[],weeklyStats:[],lastUpdated:null},ocrGameResults:[],potwHistory:[],yearlyAwardHistory:[],superbowlHistory:[],streamMilestones:[],currentStatLeaders:null,rewardsBoardIds:{}};
}
function state(root,id){
  if(!states.has(id))states.set(id,{...blank(root,id),...(loadJson('spaceState.json',null)||{})});
  return states.get(id);
}
function mapView(map,id,field){
  const owns=v=>String(v?.leagueId||'')===id;
  const key=k=>{if(field!=='players')return k;const raw=String(k);if(raw.includes('::')&&!raw.startsWith(`${id}::`))throw new Error('Cross-league map key rejected');return raw.startsWith(`${id}::`)?raw:`${id}::${raw}`;};
  const existingKey=k=>targetKey(map,k);
  function targetKey(target,k){const qualified=key(k);return target.has(qualified)?qualified:(owns(target.get(k))?k:qualified);}
  return new Proxy(map,{get(target,prop){
    if(prop==='set')return(k,v)=>{target.set(key(k),{...v,leagueId:id});if(key(k)!==k&&owns(target.get(k)))target.delete(k);return mapView(target,id,field);};
    if(prop==='get')return k=>{const v=target.get(existingKey(k));return owns(v)?v:undefined;};
    if(prop==='has')return k=>owns(target.get(existingKey(k)));
    if(prop==='delete')return k=>owns(target.get(existingKey(k)))?target.delete(existingKey(k)):false;
    if(prop==='clear')return()=>{for(const[k,v]of target)if(owns(v))target.delete(k);};
    if(prop==='size')return [...target.values()].filter(owns).length;
    if(prop==='values')return function*(){for(const v of target.values())if(owns(v))yield v;};
    if(prop==='entries'||prop===Symbol.iterator)return function*(){for(const item of target)if(owns(item[1]))yield item;};
    if(prop==='keys')return function*(){for(const[k,v]of target)if(owns(v))yield k;};
    if(prop==='forEach')return fn=>{for(const[k,v]of target)if(owns(v))fn(v,k,mapView(target,id,field));};
    return Reflect.get(target,prop,target);
  }});
}
function arrayView(array,id){
  const view=array.filter(x=>String(x.leagueId||'')===id);
  view.push=(...items)=>array.push(...items.map(x=>({...x,leagueId:id})));
  view.splice=(start,count,...items)=>{const removed=Array.prototype.splice.call(view,start,count,...items);for(const item of removed){const i=array.indexOf(item);if(i>=0)array.splice(i,1);}for(const item of items)if(!array.includes(item))array.push({...item,leagueId:id});return removed;};
  return view;
}
function wrap(root){
  return new Proxy(root,{get(target,prop,receiver){
    const id=context.current();
    if(prop==='flushSpace')return()=>{if(id&&states.has(id))saveJson('spaceState.json',JSON.parse(JSON.stringify(states.get(id),(k,v)=>/timerId|TimerId$/.test(k)?null:v)));};
    if(!id)return Reflect.get(target,prop,receiver);
    if(fields.has(prop))return state(target,id)[prop];
    if(maps.has(prop))return mapView(target[prop],id,prop);
    if(prop==='openTeamRegistry')return arrayView(target.openTeamRegistry,id);
    return Reflect.get(target,prop,receiver);
  },set(target,prop,value){const id=context.current();if(id&&fields.has(prop)){state(target,id)[prop]=value;return true;}target[prop]=value;return true;}});
}
module.exports={wrap};
