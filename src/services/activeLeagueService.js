/* Canonical active-league registry and lifecycle selectors. */
'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const compatibilityRegistry = require('../infrastructure/compatibilityRegistry');
const requestContext = require('../application/requestContext');
const LEAGUE_TYPE_META = Object.freeze({
  madden_franchise:{label:'Madden Franchise (Standard)',game:'madden'},
  madden_fantasy:{label:'Madden Fantasy Draft',game:'madden'},
  madden_alltime:{label:'Madden All-Time Greats',game:'madden'},
  madden_sim:{label:'NFL Sim League (No Cheese)',game:'madden'},
  madden_dual:{label:'Dual Division (AFC + NFC)',game:'madden'},
  nba2k_franchise:{label:'NBA 2K MyNBA Franchise',game:'nba2k'},
  nba2k_fantasy:{label:'NBA 2K Fantasy Draft',game:'nba2k'},
  nba2k_alltime:{label:'NBA 2K All-Time Legends',game:'nba2k'},
  nba2k_proam_8:{label:'NBA 2K Pro-Am 8-Team Custom League',game:'nba2k'},
  nba2k_proam_10:{label:'NBA 2K Pro-Am 10-Team Custom League',game:'nba2k'},
  madden_2v2_custom_10:{label:'Madden 2v2 Custom League (10 Teams)',game:'madden'},
  madden_3v3_custom_10:{label:'Madden 3v3 Custom League (10 Teams)',game:'madden'},
  ncaa_2v2_custom_10:{label:'NCAA 2v2 Custom League (10 Teams)',game:'ncaa'},
  ncaa_3v3_custom_10:{label:'NCAA 3v3 Custom League (10 Teams)',game:'ncaa'},
  ncaa_dynasty:{label:'NCAA CFB Dynasty',game:'ncaa'},
  ncaa_fantasy:{label:'NCAA CFB Fantasy Draft',game:'ncaa'},
});
function typeMeta(typeId){ return LEAGUE_TYPE_META[String(typeId||'')] || null; }
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
  const inherited = requestContext.currentGuildId();
  const gid = guildId ? String(guildId) : (inherited ? String(inherited) : null);
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
function listActiveLeagues(options = {}) { void compatibilityRegistry.hit(null,'legacy-active-league-registry'); return listLeagueRecords(options); }
function getLeague(id, options = {}) {
  const reg = getRegistry();
  const row = reg[String(id || '')];
  if (!row) return null;
  const gid = options.guildId ? String(options.guildId) : requestContext.currentGuildId();
  if (gid && String(row.guildId || '') !== String(gid)) return null;
  return { id:String(id), ...row, status:_status(row) };
}
function getCurrentLeagueFallback(state) {
  if (!state?.leagueConfig?.leagueTypeId) return null;
  void compatibilityRegistry.hit(null,'legacy-game-identity-fallbacks');
  return {
    id:'current', source:'legacy-fallback', status:'LEGACY_FALLBACK',
    leagueTypeId:state.leagueConfig.leagueTypeId,
    leagueName:state.leagueConfig.leagueName || 'Current League',
    game:state.leagueConfig.game || (typeMeta(state.leagueConfig.leagueTypeId)?.game || null),
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
function leagueTypeLabel(typeId) { return typeMeta(typeId)?.label || typeId || 'Unknown'; }
function formatResetChoice(league) {
  const typeLabel = leagueTypeLabel(league.leagueTypeId);
  const game = league.game ? ` • ${String(league.game).toUpperCase()}` : '';
  return { name:`${league.leagueName} — ${typeLabel}${game}`.slice(0,100), value:String(league.id).slice(0,100) };
}
function upsertLeague(league) {
  if (!league?.id) throw new Error('league id is required');
  const scopedGuildId = String(league.guildId || requestContext.currentGuildId() || '').trim();
  if (!scopedGuildId) throw Object.assign(new Error('guildId is required for league writes'), { code:'INVALID_SCOPE' });
  league = { ...league, guildId: scopedGuildId };
  const reg = getRegistry();
  reg[String(league.id)] = {
    ...reg[String(league.id)], ...league,
    status:_status(league), leagueTypeId:league.leagueTypeId, leagueName:league.leagueName,
    game:league.game || (typeMeta(league.leagueTypeId)?.game || null),
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
function removeLeague(id, options = {}) { const reg=getRegistry(); const key=String(id); const gid=options.guildId?String(options.guildId):requestContext.currentGuildId(); const row=reg[key]; if(row && gid && String(row.guildId||'')!==gid) throw Object.assign(new Error('league belongs to another guild'),{code:'LEAGUE_WRONG_GUILD'}); delete reg[key]; saveRegistry(reg); return reg; }
function setDataSourceMode(id, mode) {
  const leagueId=String(id||'').trim();
  if(!leagueId) throw Object.assign(new Error('league id is required'), { code:'INVALID_STATE' });
  const normalized=String(mode||'').trim().toLowerCase();
  const allowed=new Set(['external_sync','custom_bot_managed']);
  if(!allowed.has(normalized)) {
    throw Object.assign(new Error(`unsupported data source mode: ${String(mode||'')}`), { code:'INVALID_STATE' });
  }
  const reg=getRegistry();
  if(!reg[leagueId]) throw Object.assign(new Error('league-not-found'), { code:'NOT_FOUND' });
  reg[leagueId]={...reg[leagueId],dataSourceMode:normalized,updatedAt:Date.now()};
  saveRegistry(reg);
  return {id:leagueId,...reg[leagueId]};
}
function getDataSourceMode(id) { const row=getRegistry()[String(id||'').trim()]; return row?.dataSourceMode==='external_sync'?'external_sync':'custom_bot_managed'; }
function findLeagueForChannel(channelOrId) {
  const channel=channelOrId&&typeof channelOrId==='object'?channelOrId:null; const channelId=String(channel?.id||channelOrId||''); if(!channelId)return null; const parentId=String(channel?.parentId||'');
  for(const league of listOperationalLeagues({ guildId:channel?.guild?.id || null })) { const ch=(league.builtChannelIds||[]).map(String), cats=(league.builtCategoryIds||[]).map(String); if(ch.includes(channelId)||(parentId&&cats.includes(parentId)))return league; }
  return null;
}
module.exports={getRegistry,saveRegistry,listLeagueRecords,listActiveLeagues,listOperationalLeagues,listJoinableLeagues,listProgressionEligibleLeagues,listProviderTargets,listResettableLeagues,listDeletableLeagues,listEvents,getLeague,getCurrentLeagueFallback,listResetOptions,formatResetChoice,leagueTypeLabel,upsertLeague,removeLeague,clearGuild,setDataSourceMode,getDataSourceMode,findLeagueForChannel};
