/*
 * NAVIGATION HEADER
 * FILE: src/services/liveSyncService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const scheduleRegistry = require('./scheduleRegistryService');
const weeklyAutomation = require('./weeklyAutomationService');

const FILE = 'liveSync.json';
const DEFAULTS = {
  sourceMode: 'custom_bot_managed', // custom_bot_managed | external_sync
  provider: 'off',                  // off | companion_export | neonsportz | madden_companion | nba2k_companion | custom_endpoint
  endpointUrl: '',
  autoSyncOnTrigger: false,
  loadCurrentWeekIntoLiveSchedule: true,
  runWeeklyAutomationAfterSync: true,
  lastSyncAt: null,
  lastSyncStatus: 'idle',
  lastSyncSummary: null,
};

function _currentLeagueId() {
  try { const id=require('../league/spaceContext').current(); if(id)return String(id); } catch {}
  try { const rows=require('./activeLeagueService').listActiveLeagues().filter(x=>x.kind!=='event'); if(rows.length===1)return String(rows[0].id); } catch {}
  return null;
}

function getLiveSyncConfig() {
  const raw = loadJson(FILE, DEFAULTS) || {};
  const legacy = {
    ...DEFAULTS,
    ...raw,
    sourceMode: raw.sourceMode === 'external_sync' ? 'external_sync' : 'custom_bot_managed',
    provider: ['off', 'companion_export', 'neonsportz', 'madden_companion', 'nba2k_companion', 'custom_endpoint'].includes(raw.provider) ? raw.provider : 'off',
    endpointUrl: String(raw.endpointUrl || '').trim(),
    autoSyncOnTrigger: !!raw.autoSyncOnTrigger,
    loadCurrentWeekIntoLiveSchedule: raw.loadCurrentWeekIntoLiveSchedule !== false,
    runWeeklyAutomationAfterSync: raw.runWeeklyAutomationAfterSync !== false,
  };
  const leagueId=_currentLeagueId();
  if(!leagueId)return legacy;
  try {
    const sourceMode=require('./activeLeagueService').getDataSourceMode(leagueId);
    const rows=require('./providerConnectionService').listConnections(leagueId);
    const active=rows.filter(r=>['active','degraded'].includes(r.status)).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];
    if(!active)return {...legacy,sourceMode,provider:sourceMode==='external_sync'?legacy.provider:'off',leagueId};
    return {
      ...legacy,
      sourceMode,
      provider:active.providerKey,
      endpointUrl:active.endpointUrl || '',
      autoSyncOnTrigger:!!active.config?.autoSyncOnTrigger,
      loadCurrentWeekIntoLiveSchedule:active.config?.loadCurrentWeekIntoLiveSchedule !== false,
      runWeeklyAutomationAfterSync:active.config?.runWeeklyAutomationAfterSync !== false,
      leagueId,
      connectionStatus:active.status,
      healthStatus:active.healthStatus,
    };
  } catch { return {...legacy,leagueId}; }
}
function saveLiveSyncConfig(next) {
  const merged = { ...getLiveSyncConfig(), ...(next || {}) };
  merged.sourceMode = merged.sourceMode === 'external_sync' ? 'external_sync' : 'custom_bot_managed';
  merged.provider = ['off', 'companion_export', 'neonsportz', 'madden_companion', 'nba2k_companion', 'custom_endpoint'].includes(merged.provider) ? merged.provider : 'off';
  saveJsonDebounced(FILE, merged, 300);
  try {
    const leagueId = _currentLeagueId();
    if (leagueId && next && Object.prototype.hasOwnProperty.call(next, 'sourceMode')) {
      require('./activeLeagueService').setDataSourceMode(leagueId, merged.sourceMode);
    }
    if (leagueId && merged.provider !== 'off') {
      const pcs = require('./providerConnectionService');
      const existing = pcs.getConnection(leagueId, merged.provider);
      pcs.upsertConnection({
        leagueId,
        providerKey: merged.provider,
        endpointUrl: merged.endpointUrl || undefined,
        // Compatibility writes must never demote a tested/active league connection back to draft.
        status: existing?.status || 'draft',
        config: {
          autoSyncOnTrigger: !!merged.autoSyncOnTrigger,
          loadCurrentWeekIntoLiveSchedule: merged.loadCurrentWeekIntoLiveSchedule !== false,
          runWeeklyAutomationAfterSync: merged.runWeeklyAutomationAfterSync !== false,
        },
      });
    }
  } catch (e) { console.warn(`[liveSync] connection mirror skipped: ${e.message}`); }
  return merged;
}

function _providerEnv(provider) {
  switch (provider) {
    case 'neonsportz':
      return { url: process.env.NEONSPORTZ_SNAPSHOT_URL || '', token: process.env.NEONSPORTZ_API_TOKEN || '' };
    case 'companion_export':
      return { url: '', token: '' };
    case 'madden_companion':
      return {
        url: process.env.MYBOT_MADDEN_SYNC_URL || '',
        token: process.env.MYBOT_MADDEN_SYNC_TOKEN || '',
      };
    case 'nba2k_companion':
      return {
        url: process.env.MYBOT_NBA2K_SYNC_URL || '',
        token: process.env.MYBOT_NBA2K_SYNC_TOKEN || '',
      };
    case 'custom_endpoint':
      return {
        url: process.env.MYBOT_CUSTOM_SYNC_URL || '',
        token: process.env.MYBOT_CUSTOM_SYNC_TOKEN || '',
      };
    default:
      return { url: '', token: '' };
  }
}

function _resolveSyncTarget(config) {
  const env = _providerEnv(config.provider);
  let managed = null;
  try {
    const leagueId = require('../league/spaceContext').current();
    if (leagueId) managed = require('./providerConnectionService').getConnection(leagueId, config.provider);
  } catch {}
  let managedSecret = '';
  if (managed) {
    try { managedSecret = require('./providerConnectionService').getSecret(managed.leagueId, managed.providerKey) || ''; } catch {}
  }
  return {
    url: config.endpointUrl || managed?.endpointUrl || env.url || '',
    token: managedSecret || env.token || '',
  };
}

// V202 (BUG-010): central intake — https only, no private destinations, 20s timeout, 8 MB cap, JSON content-type.
async function _fetchJson(url, token = '') {
  const { fetchExternal } = require('../utils/httpIntake');
  const headers = { 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetchExternal({ url, headers, parse: 'json', timeoutMs: 20000, expectedContentTypes: ['application/json', 'text/json', 'application/*+json', 'text/plain'] });
  if (!res.ok) throw new Error(`Sync fetch failed: ${res.reason}${res.status ? ` (${res.status})` : ''}`);
  return res.data;
}

async function syncNow(guild, state, players, helpers = {}) {
  const config = getLiveSyncConfig();
  if (config.sourceMode !== 'external_sync') {
    return { ok: false, reason: 'source_mode_is_custom' };
  }
  if (config.provider === 'off') {
    return { ok: false, reason: 'provider_off' };
  }

  const { url, token } = _resolveSyncTarget(config);
  if (!url) {
    return { ok: false, reason: 'missing_endpoint' };
  }

  const payload = await _fetchJson(url, token);
  const reg = scheduleRegistry.importScheduleObject(payload, { source: config.provider });

  let loadedWeek = reg.currentWeek || null;
  if (config.loadCurrentWeekIntoLiveSchedule && reg.currentWeek != null) {
    const games = scheduleRegistry.loadWeekIntoState(state, reg.currentWeek);
    loadedWeek = games && games.length ? reg.currentWeek : loadedWeek;
  }

  let autoResult = { ran: false, cleared: 0, created: 0 };
  if (helpers.postScheduleEmbed && helpers.startScheduleTimer && config.loadCurrentWeekIntoLiveSchedule && state?.scheduleState?.week) {
    await helpers.postScheduleEmbed(guild, state, helpers.getCh, helpers.getTeamEmoji);
    helpers.startScheduleTimer(guild, state, helpers.getCh, helpers.getTeamEmoji);
  }

  if (config.runWeeklyAutomationAfterSync && state?.scheduleState?.week) {
    // V202: this projects the current workflow week idempotently — it does NOT advance the franchise.
    autoResult = await weeklyAutomation.runAdvanceAutomation(guild, state, players).catch(() => ({ ran: false, cleared: 0, created: 0 }));
  }

  const next = saveLiveSyncConfig({
    lastSyncAt: Date.now(),
    lastSyncStatus: 'ok',
    lastSyncSummary: {
      provider: config.provider,
      currentWeek: reg.currentWeek,
      storedWeeks: Object.keys(reg.weeks || {}).length,
      trackedTeams: (reg.teams || []).length,
      autoRan: !!autoResult.ran,
      createdChannels: autoResult.created || 0,
      clearedChannels: autoResult.cleared || 0,
    },
  });

  return {
    ok: true,
    provider: config.provider,
    currentWeek: reg.currentWeek,
    storedWeeks: Object.keys(reg.weeks || {}).length,
    trackedTeams: (reg.teams || []).length,
    loadedWeek,
    auto: autoResult,
    config: next,
  };
}

module.exports = {
  DEFAULTS,
  getLiveSyncConfig,
  saveLiveSyncConfig,
  syncNow,
};
