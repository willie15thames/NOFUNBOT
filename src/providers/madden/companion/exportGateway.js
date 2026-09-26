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

function _expectedToken() {
  return String(process.env.COMPANION_EXPORT_TOKEN || '').trim();
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
  const expected = _expectedToken();
  if (!expected) return { status: 503, body: { ok: false, reason: 'gateway-not-configured' } };
  if (!_timingSafeEqual(req.leagueToken, expected)) return { status: 404, body: { ok: false, reason: 'not-found' } }; // do not reveal token validity
  const size = Buffer.isBuffer(req.body) ? req.body.length : Buffer.byteLength(String(req.body ?? ''), 'utf8');
  if (size > MAX_PAYLOAD_BYTES) return { status: 413, body: { ok: false, reason: 'payload-too-large', max: MAX_PAYLOAD_BYTES } };
  if (!size) return { status: 400, body: { ok: false, reason: 'empty-body' } };
  const ct = String(req.contentType || '').toLowerCase();
  if (ct && !/json|text\/plain|octet-stream/.test(ct)) return { status: 415, body: { ok: false, reason: 'unsupported-content-type' } };

  const payloadHash = importRuns.hashPayload(req.body);
  const { run, duplicate } = importRuns.recordReceipt({
    provider: PROVIDER,
    leagueId: req.leagueId || null,
    leagueToken: req.leagueToken,
    payloadHash,
    size,
    meta: { contentType: ct || null, stageHint: req.stageHint || null },
    rawPayload: req.body,
  });
  log.info(`receipt importId=${run.id} provider=${PROVIDER} size=${size} hash=${payloadHash.slice(0, 12)} duplicate=${duplicate} receivedAt=${run.receivedAt}`);
  if (duplicate) return { status: 200, body: { ok: true, duplicate: true, importId: run.id }, importId: run.id, duplicate: true };
  importRuns.markStatus(run.id, importRuns.IMPORT_STATUS.QUEUED);
  return { status: 202, body: { ok: true, importId: run.id, queued: true }, importId: run.id, duplicate: false };
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
    importRuns.markStatus(importId, importRuns.IMPORT_STATUS.VALIDATED, { stage: parsed.stage, note: 'non-schedule stage stored as artifact only' });
    return { ok: true, stage: parsed.stage, applied: false };
  }
  const normalized = normalizeSchedule(parsed.data, ctx);
  if (!normalized.ok) { importRuns.markStatus(importId, importRuns.IMPORT_STATUS.FAILED, { error: normalized.reason }); return { ok: false, reason: normalized.reason }; }
  const validation = validateCompanionSnapshot(normalized.snapshot, { knownTeams: ctx.knownTeams || null });
  if (!validation.ok) { importRuns.markStatus(importId, importRuns.IMPORT_STATUS.FAILED, { error: validation.errors.join(',') }); return { ok: false, reason: 'validation-failed', errors: validation.errors }; }
  const { loadJson, saveJsonDebounced } = require('../../../storage/jsonStore');
  const store = loadJson(FILE, { schema: 'nofunleague-companion-snapshots', version: 1, latest: null }) || {};
  const snapshot = { ...normalized.snapshot, importId, payloadHash: run.payloadHash, receivedAt: run.receivedAt, validatedAt: Date.now(), warnings: validation.warnings };
  saveJsonDebounced(FILE, { schema: 'nofunleague-companion-snapshots', version: 1, latest: snapshot, previous: store.latest || null }, 300);
  importRuns.markStatus(importId, importRuns.IMPORT_STATUS.VALIDATED, { stage: 'schedule', currentWeek: snapshot.currentWeek, weeks: Object.keys(snapshot.weeks).length });
  log.info(`validated importId=${importId} currentWeek=${snapshot.currentWeek} weeks=${Object.keys(snapshot.weeks).length}`);
  return { ok: true, stage: 'schedule', applied: true, snapshot };
}

function getLatestSnapshot() {
  const { loadJson } = require('../../../storage/jsonStore');
  return (loadJson(FILE, null) || {}).latest || null;
}

module.exports = { PROVIDER, MAX_PAYLOAD_BYTES, FILE, receiveExport, processImportRun, getLatestSnapshot };
