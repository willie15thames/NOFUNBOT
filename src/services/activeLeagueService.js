/* Canonical active-league registry and lifecycle selectors. */
'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const types = () => require('./leagueSetupService').LEAGUE_TYPES;
const FILE = 'activeLeagues.json';
const OPERATIONAL = new Set(['ACTIVE','PAUSED']);
const JOINABLE = new Set(['ACTIVE']);
const RESETTABLE = new Set(['ACTIVE','PAUSED','REPAIR_REQUIRED']);
const DELETABLE_BLOCKED = new Set(['DELETED']);

function getRegistry() {
  const raw = loadJson(FILE, {}) || {};
  return typeof raw === 'object' && raw ? raw : {};
}
function saveRegistry(reg) { saveJsonDebounced(FILE, reg, 300); return reg; }
function _status(row) { return String(row?.status || 'ACTIVE').toUpperCase(); }
function _records({ guildId = null } = {}) {
  const gid = guildId ? String(guildId) : null;
  return Object.entries(getRegistry()).map(([id, league]) => ({ id, ...league, status:_status(league) }))
    .filter(row => !gid || String(row.guildId || '') === gid);
}
function listLeagueRecords(options = {}) { return _records(options); }
function listOperationalLeagues(options = {}) { return _records(options).filter(l => OPERATIONAL.has(_status(l))); }
function listJoinableLeagues(options = {}) { return _records(options).filter(l => JOINABLE.has(_status(l)) && l.kind !== 'event'); }
function listProgressionEligibleLeagues(options = {}) { return listJoinableLeagues(options).filter(l => l.progressionDisabled !== true); }
function listEvents(options = {}) { return _records(options).filter(l => l.kind === 'event'); }
function listDeletableLeagues(options = {}) { return _records(options).filter(l => l.kind !== 'event' && !DELETABLE_BLOCKED.has(_status(l))); }
function listProviderTargets({ guildId = null, includePaused = false } = {}) {
  const allowed = includePaused ? OPERATIONAL : JOINABLE;
  return _records({ guildId }).filter(l => allowed.has(_status(l)) && l.kind !== 'event');
}
function listResettableLeagues(options = {}) { return _records(options).filter(l => RESETTABLE.has(_status(l)) && l.kind !== 'event'); }
// Compatibility name preserves the historical broad registry behavior. New code MUST choose an explicit selector.
function listActiveLeagues(options = {}) { return listLeagueRecords(options); }
function getLeague(id) {
  const reg = getRegistry();
  const row = reg[String(id || '')];
  return row ? { id:String(id), ...row, status:_status(row) } : null;
}
function getCurrentLeagueFallback(state) {
  if (!state?.leagueConfig?.leagueTypeId) return null;
  return {
    id:'current', source:'legacy-fallback', status:'LEGACY_FALLBACK',
    leagueTypeId:state.leagueConfig.leagueTypeId,
    leagueName:state.leagueConfig.leagueName || 'Current League',
    game:state.leagueConfig.game || (types()[state.leagueConfig.leagueTypeId]?.game || null),
    builtCategoryIds:state.leagueConfig.builtCategoryIds || [], builtChannelIds:state.leagueConfig.builtChannelIds || [],
    isCustom:!!state.leagueConfig.isCustom, createdAt:state.leagueConfig.createdAt || Date.now(),
  };
}
function listResetOptions(state, options = {}) {
  const listed = listResettableLeagues({ guildId:options.guildId || null });
  if (listed.length || options.includeLegacyFallback === false) return listed;
  const fallback = getCurrentLeagueFallback(state);
  return fallback ? [fallback] : [];
}
function leagueTypeLabel(typeId) { return types()[typeId]?.label || typeId || 'Unknown'; }
function formatResetChoice(league) {
  const typeLabel = leagueTypeLabel(league.leagueTypeId);
  const game = league.game ? ` • ${String(league.game).toUpperCase()}` : '';
  return { name:`${league.leagueName} — ${typeLabel}${game}`.slice(0,100), value:String(league.id).slice(0,100) };
}
function upsertLeague(league) {
  if (!league?.id) throw new Error('league id is required');
  const reg = getRegistry();
  reg[String(league.id)] = {
    ...reg[String(league.id)], ...league,
    status:_status(league), leagueTypeId:league.leagueTypeId, leagueName:league.leagueName,
    game:league.game || (types()[league.leagueTypeId]?.game || null),
    builtCategoryIds:Array.isArray(league.builtCategoryIds) ? league.builtCategoryIds : [],
    builtChannelIds:Array.isArray(league.builtChannelIds) ? league.builtChannelIds : [],
    isCustom:!!league.isCustom, createdAt:league.createdAt || reg[String(league.id)]?.createdAt || Date.now(), updatedAt:Date.now(),
  };
  saveRegistry(reg); return { id:String(league.id), ...reg[String(league.id)] };
}
function clearGuild(guildId, options = {}) {
  const gid = String(guildId || ''); const includeLegacyUnscoped = options.includeLegacyUnscoped !== false; const reg=getRegistry(); let removed=0;
  for (const [id, league] of Object.entries(reg)) if (String(league.guildId || '')===gid || (includeLegacyUnscoped && !league.guildId)) { delete reg[id]; removed++; }
  saveRegistry(reg); return removed;
}
function removeLeague(id) { const reg=getRegistry(); delete reg[String(id)]; saveRegistry(reg); return reg; }
function setDataSourceMode(id, mode) {
  const leagueId=String(id||'').trim(); if(!leagueId) throw new Error('league id is required');
  const normalized=String(mode||'').toLowerCase()==='external_sync'?'external_sync':'custom_bot_managed'; const reg=getRegistry();
  if(!reg[leagueId]) throw new Error('league-not-found'); reg[leagueId]={...reg[leagueId],dataSourceMode:normalized,updatedAt:Date.now()}; saveRegistry(reg); return {id:leagueId,...reg[leagueId]};
}
function getDataSourceMode(id) { const row=getRegistry()[String(id||'').trim()]; return row?.dataSourceMode==='external_sync'?'external_sync':'custom_bot_managed'; }
function findLeagueForChannel(channelOrId) {
  const channel=channelOrId&&typeof channelOrId==='object'?channelOrId:null; const channelId=String(channel?.id||channelOrId||''); if(!channelId)return null; const parentId=String(channel?.parentId||'');
  for(const league of listOperationalLeagues({ guildId:channel?.guild?.id || null })) { const ch=(league.builtChannelIds||[]).map(String), cats=(league.builtCategoryIds||[]).map(String); if(ch.includes(channelId)||(parentId&&cats.includes(parentId)))return league; }
  return null;
}
module.exports={getRegistry,saveRegistry,listLeagueRecords,listActiveLeagues,listOperationalLeagues,listJoinableLeagues,listProgressionEligibleLeagues,listProviderTargets,listResettableLeagues,listDeletableLeagues,listEvents,getLeague,getCurrentLeagueFallback,listResetOptions,formatResetChoice,leagueTypeLabel,upsertLeague,removeLeague,clearGuild,setDataSourceMode,getDataSourceMode,findLeagueForChannel};
