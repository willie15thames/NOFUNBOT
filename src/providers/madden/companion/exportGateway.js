/*
 * NAVIGATION HEADER
 * FILE: src/providers/madden/companion/exportGateway.js
 * LAYER: Provider adapter layer (V202, spec §8)
 * PURPOSE: Receiver logic for POST /v1/providers/madden/companion/export/{leagueToken}. Pure request-processing
 *          (no HTTP server here): token check → content-type/size → immutable artifact + hash → duplicate detection
 *          → durable receipt → returns 2xx decision; parse/normalize/validate runs as a separate step
 *          (processImportRun) so a slow parser never blocks the receiver.
 * LOOK HERE FIRST WHEN DEBUGGING: receiveExport(), processImportRun().
 * RELATED FLOW: http/routes/maddenCompanion.js (transport), importRunService, companion parser/normalizer/validator.
 * NOTE: Logs importId, leagueId, provider, size, hash, receivedAt — never credentials or raw auth headers.
 */

'use strict';

const importRuns = require('../../../league/importRunService');
const { parseExportBody } = require('./parser');
const { normalizeSchedule } = require('./normalizer');
const { validateCompanionSnapshot } = require('./validator');
const { makeLogger } = require('../../../utils/logger');

const log = makeLogger('companionGateway');
const PROVIDER = 'companion_export';
const MAX_PAYLOAD_BYTES = 6 * 1024 * 1024;
const FILE = 'companionSnapshots.json';

function _firstArray(obj, keys) {
  for (const k of keys) if (Array.isArray(obj?.[k])) return obj[k];
  return [];
}
function _canonicalizeStage(stage, data) {
  if (stage === 'league') return data?.leagueInfo || data?.league || data;
  if (stage === 'teams') {
    const rows = _firstArray(data, ['leagueTeamInfoList','teams','teamInfoList']);
    return rows.map(t => ({
      externalTeamId: t.teamId ?? t.id ?? t.rosterId ?? null,
      displayName: t.displayName || t.teamName || [t.cityName || t.city, t.nickName || t.nickname].filter(Boolean).join(' ').trim() || t.abbrName || t.abbr || null,
      city: t.cityName || t.city || null,
      nickname: t.nickName || t.nickname || null,
      abbreviation: t.abbrName || t.abbr || t.teamAbbr || null,
      conference: t.conferenceName || t.conference || null,
      division: t.divisionName || t.division || null,
      wins: Number.isFinite(Number(t.totalWins ?? t.wins)) ? Number(t.totalWins ?? t.wins) : null,
      losses: Number.isFinite(Number(t.totalLosses ?? t.losses)) ? Number(t.totalLosses ?? t.losses) : null,
      raw: t,
    }));
  }
  if (stage === 'roster') {
    const rows = _firstArray(data, ['rosterInfoList','roster','players','playerInfoList']);
    return rows.map(p => ({
      externalPlayerId: p.rosterId ?? p.playerId ?? p.id ?? null,
      externalTeamId: p.teamId ?? p.teamIndex ?? null,
      firstName: p.firstName || p.first || null,
      lastName: p.lastName || p.last || null,
      position: p.position || p.positionName || null,
      overall: Number.isFinite(Number(p.playerBestOvr ?? p.overallRating ?? p.overall)) ? Number(p.playerBestOvr ?? p.overallRating ?? p.overall) : null,
      raw: p,
    }));
  }
  if (stage === 'stats') {
    const groups = {};
    for (const [k,v] of Object.entries(data || {})) if (Array.isArray(v) && /stat/i.test(k)) groups[k] = v;
    if (Array.isArray(data?.stats)) groups.stats = data.stats;
    return groups;
  }
  return data;
}


function _validateProjectedStage(stage, canonical) {
  if (stage === 'unknown') return { ok:false, reason:'unsupported-companion-stage' };
  if (stage === 'league') {
    if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical) || !Object.keys(canonical).length) return { ok:false, reason:'empty-league-payload' };
    return { ok:true };
  }
  if (stage === 'teams' || stage === 'roster') {
    if (!Array.isArray(canonical) || !canonical.length) return { ok:false, reason:`empty-${stage}-payload` };
    return { ok:true };
  }
  if (stage === 'stats') {
    if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical) || !Object.values(canonical).some(Array.isArray)) return { ok:false, reason:'empty-stats-payload' };
    return { ok:true };
  }
  return { ok:false, reason:`unsupported-companion-stage:${stage}` };
}

function _tokenMap() {
  try {
    const raw = JSON.parse(String(process.env.COMPANION_EXPORT_TOKENS_JSON || '{}'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}
function resolveLeagueToken(token) {
  const presented = String(token || '').trim();
  try {
    const managed = require('../../../services/providerConnectionService').resolveRouteToken(PROVIDER, presented);
    if (managed.valid) return { valid:true, leagueId:managed.leagueId, mode:'connection-registry' };
  } catch {}
  const map = _tokenMap();
  let managedConfigured = false;
  try { managedConfigured = require('../../../services/providerConnectionService').listConnections().some(c => c.providerKey === PROVIDER && c.hasRouteToken); } catch {}
  for (const [leagueId, configured] of Object.entries(map)) {
    if (_timingSafeEqual(presented, String(configured || '').trim())) return { valid:true, leagueId:String(leagueId), mode:'map' };
  }
  const single = String(process.env.COMPANION_EXPORT_TOKEN || '').trim();
  if (single && _timingSafeEqual(presented, single)) return { valid:true, leagueId:String(process.env.PROVIDER_HTTP_SPACE_ID || '').trim() || null, mode:'legacy-single' };
  // A configured gateway must hide whether a presented token is valid.
  // Keep the configuration mode even on mismatch so callers return 404, not
  // the misleading 503 "gateway-not-configured" response.
  return {
    valid:false,
    leagueId:null,
    mode: managedConfigured ? 'connection-registry' : (Object.keys(map).length ? 'map' : (single ? 'legacy-single' : 'unconfigured')),
  };
}

function _timingSafeEqual(a, b) {
  const crypto = require('crypto');
  const ba = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length || !ba.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * @param {object} req { leagueToken, contentType, body(Buffer|string), contentLength, headers? }
 * @returns {{ status:number, body:object, importId?:string }}
 */
function receiveExport(req = {}) {
  const tokenResolution = resolveLeagueToken(req.leagueToken);
  if (tokenResolution.mode === 'unconfigured') return { status: 503, body: { ok: false, reason: 'gateway-not-configured' } };
  if (!tokenResolution.valid) return { status: 404, body: { ok: false, reason: 'not-found' } }; // do not reveal token validity
  if (req.leagueId && tokenResolution.leagueId && String(req.leagueId) !== String(tokenResolution.leagueId)) return { status:409, body:{ ok:false, reason:'route-league-mismatch' } };
  const size = Buffer.isBuffer(req.body) ? req.body.length : Buffer.byteLength(String(req.body ?? ''), 'utf8');
  if (size > MAX_PAYLOAD_BYTES) return { status: 413, body: { ok: false, reason: 'payload-too-large', max: MAX_PAYLOAD_BYTES } };
  if (!size) return { status: 400, body: { ok: false, reason: 'empty-body' } };
  const ct = String(req.contentType || '').toLowerCase();
  if (ct && !/json|text\/plain|octet-stream/.test(ct)) return { status: 415, body: { ok: false, reason: 'unsupported-content-type' } };

  const payloadHash = importRuns.hashPayload(req.body);
  const receipt = importRuns.recordReceipt({
    provider: PROVIDER,
    leagueId: tokenResolution.leagueId || req.leagueId || null,
    leagueToken: req.leagueToken,
    payloadHash,
    size,
    meta: { contentType: ct || null, stageHint: req.stageHint || null },
    rawPayload: req.body,
  });
  const { run, duplicate } = receipt;
  if (!receipt.durable && !duplicate) return { status: 503, body: { ok:false, reason: receipt.reason || 'receipt-not-durable' } };
  log.info(`receipt importId=${run.id} provider=${PROVIDER} size=${size} hash=${payloadHash.slice(0, 12)} duplicate=${duplicate} receivedAt=${run.receivedAt}`);
  if (duplicate) return { status: 200, body: { ok: true, duplicate: true, importId: run.id }, importId: run.id, duplicate: true };
  importRuns.markStatus(run.id, importRuns.IMPORT_STATUS.QUEUED);
  return { status: 202, body: { ok: true, importId: run.id, queued: true }, importId: run.id, duplicate: false };
}

async function receiveExportDurable(req = {}) {
  const tokenResolution = resolveLeagueToken(req.leagueToken);
  if (tokenResolution.mode === 'unconfigured') return { status: 503, body: { ok:false, reason:'gateway-not-configured' } };
  if (!tokenResolution.valid) return { status:404, body:{ ok:false, reason:'not-found' } };
  if (req.leagueId && tokenResolution.leagueId && String(req.leagueId) !== String(tokenResolution.leagueId)) return { status:409, body:{ ok:false, reason:'route-league-mismatch' } };
  const size = Buffer.isBuffer(req.body) ? req.body.length : Buffer.byteLength(String(req.body ?? ''), 'utf8');
  if (size > MAX_PAYLOAD_BYTES) return { status:413, body:{ ok:false, reason:'payload-too-large', max:MAX_PAYLOAD_BYTES } };
  if (!size) return { status:400, body:{ ok:false, reason:'empty-body' } };
  const ct = String(req.contentType || '').toLowerCase();
  if (ct && !/json|text\/plain|octet-stream/.test(ct)) return { status:415, body:{ ok:false, reason:'unsupported-content-type' } };
  const payloadHash = importRuns.hashPayload(req.body);
  const receipt = await importRuns.recordReceiptDurable({
    provider:PROVIDER, leagueId:tokenResolution.leagueId || req.leagueId || null, leagueToken:req.leagueToken,
    payloadHash, size, meta:{ contentType:ct || null, stageHint:req.stageHint || null }, rawPayload:req.body,
  });
  if (!receipt?.durable || !receipt.run) return { status:503, body:{ ok:false, reason:receipt?.reason || 'receipt-not-durable' } };
  const { run, duplicate } = receipt;
  log.info(`durable receipt importId=${run.id} provider=${PROVIDER} size=${size} hash=${payloadHash.slice(0,12)} duplicate=${duplicate} authority=${receipt.authority || 'json'}`);
  if (duplicate) return { status:200, body:{ ok:true, duplicate:true, importId:run.id }, importId:run.id, duplicate:true };
  await importRuns.markStatusDurable(run.id, importRuns.IMPORT_STATUS.QUEUED);
  return { status:202, body:{ ok:true, importId:run.id, queued:true }, importId:run.id, duplicate:false };
}

/**
 * Parse → normalize → validate → store snapshot. Never publishes a week to Discord (that is the advance engine's job).
 */
function processImportRun(importId, ctx = {}) {
  const runs = importRuns.listRecent(300);
  const run = runs.find(r => r.id === importId);
  if (!run) return { ok: false, reason: 'import-not-found' };
  const body = importRuns.getArtifact(run.payloadHash);
  if (body == null) { importRuns.markStatus(importId, importRuns.IMPORT_STATUS.FAILED, { error: 'artifact-missing' }); return { ok: false, reason: 'artifact-missing' }; }
  importRuns.markStatus(importId, importRuns.IMPORT_STATUS.PARSING);
  const parsed = parseExportBody(body, run.meta?.contentType || '');
  if (!parsed.ok) { importRuns.markStatus(importId, importRuns.IMPORT_STATUS.FAILED, { error: parsed.reason }); return { ok: false, reason: parsed.reason }; }
  if (parsed.stage !== 'schedule') {
    const canonical = _canonicalizeStage(parsed.stage, parsed.data);
    const stageValidation = _validateProjectedStage(parsed.stage, canonical);
    if (!stageValidation.ok) {
      importRuns.markStatus(importId, importRuns.IMPORT_STATUS.FAILED, { error:stageValidation.reason, stage:parsed.stage });
      return { ok:false, reason:stageValidation.reason, stage:parsed.stage };
    }
    const projected = require('../../../services/providerProjectionService').applyResource(PROVIDER, parsed.stage, canonical, {
      importId, payloadHash: run.payloadHash, receivedAt: run.receivedAt,
    });
    importRuns.markStatus(importId, importRuns.IMPORT_STATUS.APPLIED, { stage: parsed.stage, appliedTo: 'provider-data-snapshot', updatedAt: projected.updatedAt });
    return { ok: true, stage: parsed.stage, applied: true, target: 'provider-data-snapshot', count: projected.count };
  }
  const normalized = normalizeSchedule(parsed.data, ctx);
  if (!normalized.ok) { importRuns.markStatus(importId, importRuns.IMPORT_STATUS.FAILED, { error: normalized.reason }); return { ok: false, reason: normalized.reason }; }
  const validation = validateCompanionSnapshot(normalized.snapshot, { knownTeams: ctx.knownTeams || null });
  if (!validation.ok) { importRuns.markStatus(importId, importRuns.IMPORT_STATUS.FAILED, { error: validation.errors.join(',') }); return { ok: false, reason: 'validation-failed', errors: validation.errors }; }
  const { loadJson, saveJsonDebounced } = require('../../../storage/jsonStore');
  const store = loadJson(FILE, { schema: 'nofunleague-companion-snapshots', version: 1, latest: null }) || {};
  const snapshot = { ...normalized.snapshot, importId, payloadHash: run.payloadHash, receivedAt: run.receivedAt, validatedAt: Date.now(), warnings: validation.warnings };
  saveJsonDebounced(FILE, { schema: 'nofunleague-companion-snapshots', version: 1, latest: snapshot, previous: store.latest || null }, 300);
  importRuns.markStatus(importId, importRuns.IMPORT_STATUS.APPLIED, { stage: 'schedule', currentWeek: snapshot.currentWeek, weeks: Object.keys(snapshot.weeks).length });
  log.info(`validated importId=${importId} currentWeek=${snapshot.currentWeek} weeks=${Object.keys(snapshot.weeks).length}`);
  return { ok: true, stage: 'schedule', applied: true, snapshot };
}

function getLatestSnapshot() {
  const { loadJson } = require('../../../storage/jsonStore');
  return (loadJson(FILE, null) || {}).latest || null;
}

module.exports = { PROVIDER, MAX_PAYLOAD_BYTES, FILE, resolveLeagueToken, receiveExport, receiveExportDurable, processImportRun, getLatestSnapshot };
