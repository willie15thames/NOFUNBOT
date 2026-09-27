/*
 * v204.7 provider projection boundary. Provider adapters normalize data; this service performs the explicit,
 * idempotent write into existing canonical stores. It never advances workflowWeek and never grants team ownership.
 */
'use strict';
function applyScheduleSnapshot(snapshot,{source='provider'}={}){
  const registry=require('./scheduleRegistryService');
  const reg=registry.importScheduleObject(snapshot,{source});
  return {ok:true,resource:'schedule',currentWeek:reg.currentWeek,storedWeeks:Object.keys(reg.weeks||{}).length,trackedTeams:(reg.teams||[]).length};
}
function applyResource(provider,resource,data,meta={}){
  const row=require('./providerDataSnapshotService').saveStage(provider,resource,data,meta);
  return {ok:true,resource,updatedAt:row.updatedAt,count:Array.isArray(data)?data.length:null,ignoredStale:!!row.ignoredStale};
}
module.exports={applyScheduleSnapshot,applyResource};
