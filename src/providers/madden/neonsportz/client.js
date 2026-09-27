/*
 * NAVIGATION HEADER
 * FILE: src/providers/madden/neonsportz/client.js
 * LAYER: Provider adapter layer (v204.7)
 * PURPOSE: NeonSportz read-only DATA provider. A webhook is only a trigger; data is read from configured public
 *          JSON endpoints. Supports one legacy snapshot URL and an optional resource URL map so teams/players/
 *          games/stats can be fetched independently without inventing private NeonSportz endpoints.
 * SECURITY: NeonSportz public reads require no key. Optional Bearer token support remains for commissioner-owned
 *           gateways/proxies. All outbound reads use utils/httpIntake.
 */
'use strict';

const { createProvider, notConfigured } = require('../../gameProvider');
const { fetchExternal } = require('../../../utils/httpIntake');
const { mapSnapshot } = require('./mapper');

const KEY = 'neonsportz';

function _jsonEnv(name){ try{const x=JSON.parse(String(process.env[name]||'{}'));return x&&typeof x==='object'?x:{};}catch{return{};} }
function _managed(){
  try {
    const leagueId=require('../../../league/spaceContext').current();
    if(!leagueId)return null;
    return require('../../../services/providerConnectionService').getConnection(leagueId,KEY);
  } catch { return null; }
}
function _config() {
  const managed=_managed();
  let secret='';
  if(managed){ try{secret=require('../../../services/providerConnectionService').getSecret(managed.leagueId,KEY)||'';}catch{} }
  return {
    snapshotUrl: String(managed?.endpointUrl || process.env.NEONSPORTZ_SNAPSHOT_URL || '').trim(),
    token: String(secret || process.env.NEONSPORTZ_API_TOKEN || '').trim(),
    leagueId: String(managed?.externalLeagueId || process.env.NEONSPORTZ_LEAGUE_ID || '').trim(),
    resourceUrls: { ..._jsonEnv('NEONSPORTZ_RESOURCE_URLS_JSON'), ...(managed?.config?.resourceUrls || {}) },
  };
}

async function _sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function _path(obj,path){ return String(path||'').split('.').filter(Boolean).reduce((v,k)=>v?.[k],obj); }
async function _getJson(url, token='', extraHeaders={}) {
  const headers={Accept:'application/json',...extraHeaders}; if(token)headers.Authorization=`Bearer ${token}`;
  let last=null;
  for(let attempt=0;attempt<3;attempt++){
    const r=await fetchExternal({url,headers,parse:'json',expectedContentTypes:['application/json','text/json','application/*+json','text/plain'],timeoutMs:20000});
    if(r.ok)return {ok:true,data:r.data,headers:r.headers||{},status:r.status};
    last={ok:false,reason:`fetch-${r.reason}`,status:r.status||null,retryAfter:r.headers?.retryAfter||null};
    const retryable=r.status===429 || (Number(r.status)>=500&&Number(r.status)<600) || r.reason==='timeout' || r.reason==='network-error';
    if(!retryable || attempt===2)break;
    const sec=Math.max(0,Math.min(10,Number(r.headers?.retryAfter||0)||0));
    await _sleep(sec?sec*1000:250*(attempt+1));
  }
  return last || {ok:false,reason:'fetch-failed'};
}
async function _fetchResourceSpec(name,spec,cfg){
  const conf=typeof spec==='string'?{url:spec}:spec||{};
  let url=String(conf.url||'').trim(); if(!url)return {ok:false,reason:'resource-url-missing',resource:name};
  const maxPages=Math.max(1,Math.min(25,Number(conf.maxPages||10)||10));
  const items=[]; let first=null,lastHeaders={},pages=0;
  for(;pages<maxPages && url;pages++){
    const r=await _getJson(url,cfg.token); if(!r.ok)return {...r,resource:name,pages};
    if(first==null)first=r.data; lastHeaders=r.headers||{};
    if(conf.itemsPath){ const arr=_path(r.data,conf.itemsPath); if(Array.isArray(arr))items.push(...arr); else return {ok:false,reason:'resource-items-path-invalid',resource:name}; }
    const next=conf.nextPath?_path(r.data,conf.nextPath):null;
    url=next?String(next):'';
  }
  if(url)return {ok:false,reason:'resource-pagination-cap',resource:name,pages};
  return {ok:true,data:conf.itemsPath?items:first,pages:Math.max(1,pages),headers:lastHeaders};
}
async function _fetchResources(cfg){
  const out={}, cursors={};
  for(const [name,spec] of Object.entries(cfg.resourceUrls||{})){
    if(!spec)continue;
    const r=await _fetchResourceSpec(name,spec,cfg);
    if(!r.ok)return {...r,resource:name};
    out[name]=r.data;
    cursors[name]={pages:r.pages||1,etag:r.headers?.etag||null,lastModified:r.headers?.lastModified||null,updatedAt:Date.now()};
  }
  return {ok:true,resources:out,cursors};
}
async function _fetchSnapshot() {
  const cfg = _config();
  let raw=null, resources={};
  if(cfg.snapshotUrl){
    const res=await _getJson(cfg.snapshotUrl,cfg.token); if(!res.ok)return { ...res, providerId:KEY }; raw=res.data;
  }
  if(Object.keys(cfg.resourceUrls||{}).length){
    const rr=await _fetchResources(cfg); if(!rr.ok)return {...rr,providerId:KEY}; resources=rr.resources;
    if (Object.keys(rr.cursors||{}).length) { try { const pcs=require('../../../services/providerConnectionService'); const id=require('../../../league/spaceContext').current(); const c=id&&pcs.getConnection(id,KEY); if(c) pcs.upsertConnection({...c,config:{...(c.config||{}),resourceCursors:rr.cursors}}); } catch {} }
    if(!raw) raw=resources.games || resources.schedule || resources.league || Object.values(resources)[0] || null;
  }
  if(!raw)return notConfigured(KEY,['NEONSPORTZ_SNAPSHOT_URL','NEONSPORTZ_RESOURCE_URLS_JSON']);
  const mapped=mapSnapshot(raw);
  const revision=mapped.revision||String(Date.now());
  const projection=require('../../../services/providerProjectionService');
  for(const [name,data] of Object.entries(resources)) projection.applyResource(KEY,name,data,{revision,leagueId:cfg.leagueId||null});
  return {ok:true,providerId:KEY,snapshot:mapped.snapshot,revision,raw,resources};
}

module.exports = createProvider({
  key: KEY,
  label: 'NeonSportz (webhook-triggered, read-only public/API data)',
  verified: () => { const c=_config(); return !!(c.snapshotUrl||Object.keys(c.resourceUrls||{}).length); },
  capabilities: { dataImport: true, readSchedule: true, readLeagueState: true, readStats: true, webhook: true, advanceWeek: false, markReady: false, autoPilot: false, forceResult: false },
  methods: {
    async healthCheck() {
      const cfg=_config();
      if(!cfg.snapshotUrl&&!Object.keys(cfg.resourceUrls||{}).length) return {ok:false,providerId:KEY,healthy:false,reason:'not-configured',missing:['NEONSPORTZ_SNAPSHOT_URL','NEONSPORTZ_RESOURCE_URLS_JSON']};
      const r=await _fetchSnapshot();
      return r.ok?{ok:true,providerId:KEY,healthy:true,configured:true,resources:Object.keys(r.resources||{})}:{ok:false,providerId:KEY,healthy:false,reason:r.reason,status:r.status||null};
    },
    async getCurrentWeek() { const r=await _fetchSnapshot(); if(!r.ok)return r; return {ok:true,providerId:KEY,week:r.snapshot.currentWeek!=null?Number(r.snapshot.currentWeek):null,revision:r.revision}; },
    async fetchLeagueSnapshot() { return _fetchSnapshot(); },
    async fetchWeek(ctx,week) { const r=await _fetchSnapshot(); if(!r.ok)return r; const games=r.snapshot.weeks?.[String(week)]||[]; if(!games.length)return {ok:false,reason:'week-not-in-snapshot',providerId:KEY,week:Number(week)}; return {ok:true,providerId:KEY,week:Number(week),games,revision:r.revision}; },
    async ingestImport(input) {
      const r=await _fetchSnapshot(); if(!r.ok)return r;
      const projection=require('../../../services/providerProjectionService'); const reg=projection.applyScheduleSnapshot(r.snapshot,{source:KEY});
      projection.applyResource(KEY,'league_snapshot',r.raw,{importId:input?.importId||null,revision:r.revision});
      return {ok:true,providerId:KEY,currentWeek:reg.currentWeek,storedWeeks:reg.storedWeeks,revision:r.revision,importId:input?.importId||null,resources:Object.keys(r.resources||{})};
    },
  },
});
