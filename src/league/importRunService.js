/*
 * NAVIGATION HEADER
 * FILE: src/league/importRunService.js
 * LAYER: League control plane (V202, spec §8/§9/§14 ImportRun)
 * PURPOSE: Idempotent import lifecycle records. Every inbound artifact (Companion export, NeonSportz webhook
 *          delivery, manual attachment) is recorded ONCE by (provider + externalEventId | payloadHash + leagueToken)
 *          before any parsing happens, so duplicate/retried deliveries never produce a second import.
 *          Persisted to importRuns.json (bounded), raw artifacts to importArtifacts.json (bounded, hash-keyed).
 * LOOK HERE FIRST WHEN DEBUGGING: recordReceipt(), markStatus(), findByEventId(), findByHash().
 * RELATED FLOW: http/routes/*, providers/madden/companion/exportGateway, providers/madden/neonsportz/webhook.
 * NOTE: Never stores credentials, cookies, authorization headers or session tokens (spec §8 item 10).
 */

'use strict';

const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadJson, saveJson, getDataDir } = require('../storage/jsonStore');

const FILE = 'importRuns.json';
const ARTIFACT_FILE = 'importArtifacts.json';
const MAX_RUNS = 300;
const MAX_ARTIFACTS = 40;            // raw payloads are large; keep the last N only
const MAX_ARTIFACT_BYTES = 6 * 1024 * 1024;

const IMPORT_STATUS = Object.freeze({ RECEIVED: 'received', QUEUED: 'queued', PARSING: 'parsing', VALIDATED: 'validated', FAILED: 'failed', DUPLICATE: 'duplicate', APPLIED: 'applied' });

const LOCK_STALE_MS = 15000;
function _sleepSync(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {} }
function _receiptLockPath() {
  let scope = 'global';
  try { scope = require('./spaceContext').current() || 'global'; } catch {}
  return path.join(getDataDir(), `.import-receipt-${encodeURIComponent(String(scope))}.lock`);
}
function _withReceiptLock(fn) {
  const lock = _receiptLockPath();
  const deadline = Date.now() + 2500;
  let fd = null;
  while (Date.now() < deadline) {
    try { fd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(fd, `${process.pid}:${Date.now()}`); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { const st = fs.statSync(lock); if (Date.now() - st.mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lock); continue; } } catch {}
      _sleepSync(20);
    }
  }
  if (fd == null) throw new Error('import-receipt-lock-timeout');
  try { return fn(); }
  finally { try { fs.closeSync(fd); } catch {} try { fs.unlinkSync(lock); } catch {} }
}

function _load() {
  const raw = loadJson(FILE, { schema: 'nofunleague-import-runs', version: 1, runs: [] }) || {};
  return { schema: 'nofunleague-import-runs', version: 1, runs: Array.isArray(raw.runs) ? raw.runs : [] };
}
function _save(store) {
  if (store.runs.length > MAX_RUNS) store.runs.splice(0, store.runs.length - MAX_RUNS);
  saveJson(FILE, store);
  return store;
}
function _loadArtifacts() {
  const raw = loadJson(ARTIFACT_FILE, { schema: 'nofunleague-import-artifacts', version: 1, artifacts: {} }) || {};
  return { schema: 'nofunleague-import-artifacts', version: 1, artifacts: raw.artifacts && typeof raw.artifacts === 'object' ? raw.artifacts : {} };
}

function hashPayload(payload) {
  const text = Buffer.isBuffer(payload) ? payload : Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload ?? null), 'utf8');
  return createHash('sha256').update(text).digest('hex');
}

function newImportId() {
  return `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function findByEventId(provider, externalEventId) {
  if (!externalEventId) return null;
  return _load().runs.find(r => r.provider === provider && r.externalEventId === String(externalEventId)) || null;
}

/** One-way tag of a league route token: lets receipts be scoped per token without storing any part of the token. */
function tokenTag(leagueToken) {
  if (leagueToken == null || leagueToken === '') return null;
  return createHash('sha256').update(String(leagueToken)).digest('hex').slice(0, 16);
}

function findByHash(provider, payloadHash, leagueToken = null) {
  const tag = tokenTag(leagueToken);
  return _load().runs.find(r => r.provider === provider && r.payloadHash === payloadHash && (tag == null || r.leagueTokenTag === tag)) || null;
}

/**
 * Record receipt of an inbound artifact. Returns { run, duplicate:boolean }.
 * @param {object} input { provider, leagueId, leagueToken, externalEventId, payloadHash, size, meta, rawPayload }
 */
function recordReceipt(input = {}) {
  return _withReceiptLock(() => {
  const provider = String(input.provider || 'unknown');
  const existing = (input.externalEventId && findByEventId(provider, input.externalEventId)) || (input.payloadHash && findByHash(provider, input.payloadHash, input.leagueToken || null)) || null;
  if (existing) {
    const store = _load();
    const idx = store.runs.findIndex(r => r.id === existing.id);
    if (idx !== -1) { store.runs[idx].duplicateDeliveries = (store.runs[idx].duplicateDeliveries || 0) + 1; store.runs[idx].lastDuplicateAt = Date.now(); _save(store); }
    return { run: existing, duplicate: true, durable: true };
  }
  const run = {
    id: newImportId(),
    provider,
    leagueId: input.leagueId || null,
    leagueTokenTag: tokenTag(input.leagueToken), // one-way tag — no part of the token is stored
    externalEventId: input.externalEventId != null ? String(input.externalEventId) : null,
    payloadHash: input.payloadHash || null,
    size: Number(input.size || 0),
    status: IMPORT_STATUS.RECEIVED,
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
    receivedAt: Date.now(),
    completedAt: null,
    error: null,
    duplicateDeliveries: 0,
  };
  // Store the immutable artifact synchronously before acknowledging the receipt. If a raw payload was supplied
  // and cannot be stored, callers must NOT return 2xx because restart recovery would have nothing to process.
  let artifact = { stored: true, reason: null };
  if (input.rawPayload != null && input.payloadHash) artifact = storeArtifact(input.payloadHash, input.rawPayload, { importId: run.id, provider });
  if (!artifact.stored) return { run, duplicate: false, durable: false, reason: artifact.reason || 'artifact-store-failed' };
  const store = _load();
  store.runs.push(run);
  _save(store);
  return { run, duplicate: false, durable: true };
  });
}

function storeArtifact(hash, rawPayload, meta = {}) {
  const text = Buffer.isBuffer(rawPayload) ? rawPayload.toString('utf8') : (typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload));
  if (Buffer.byteLength(text, 'utf8') > MAX_ARTIFACT_BYTES) return { stored: false, reason: 'artifact-too-large' };
  const store = _loadArtifacts();
  store.artifacts[hash] = { hash, meta, size: Buffer.byteLength(text, 'utf8'), storedAt: Date.now(), body: text };
  const keys = Object.keys(store.artifacts).sort((a, b) => store.artifacts[a].storedAt - store.artifacts[b].storedAt);
  while (keys.length > MAX_ARTIFACTS) delete store.artifacts[keys.shift()];
  saveJson(ARTIFACT_FILE, store);
  return { stored: true };
}

function getArtifact(hash) {
  const a = _loadArtifacts().artifacts[hash];
  return a ? a.body : null;
}

function markStatus(importId, status, patch = {}) {
  const store = _load();
  const idx = store.runs.findIndex(r => r.id === importId);
  if (idx === -1) return null;
  store.runs[idx] = { ...store.runs[idx], ...patch, status, completedAt: [IMPORT_STATUS.VALIDATED, IMPORT_STATUS.FAILED, IMPORT_STATUS.DUPLICATE, IMPORT_STATUS.APPLIED].includes(status) ? Date.now() : store.runs[idx].completedAt };
  _save(store);
  // Best-effort status mirror. Receipt creation is strict/durable; lifecycle updates may lag briefly but are replay-safe.
  try {
    const row = store.runs[idx];
    require('../storage/prisma').prismaSafe(async p => {
      if (!p.providerImportReceipt) return null;
      return p.providerImportReceipt.update({ where:{ id:importId }, data:{ status, stage:row.stage || undefined, error:row.error || null, completedAt:row.completedAt ? new Date(row.completedAt) : null } });
    }, null).catch(() => null);
  } catch {}
  return store.runs[idx];
}

function listRecent(limit = 10) {
  return _load().runs.slice(-limit).reverse();
}

function listByStatus(provider, statuses = []) {
  const wanted = new Set((statuses || []).map(String));
  return _load().runs.filter(r => (!provider || r.provider === provider) && (!wanted.size || wanted.has(r.status)));
}

function getStatusSummary() {
  const runs = _load().runs;
  const last = runs[runs.length - 1] || null;
  return { total: runs.length, last: last ? { id: last.id, provider: last.provider, status: last.status, receivedAt: last.receivedAt, completedAt: last.completedAt, error: last.error } : null };
}

function _artifactText(rawPayload) {
  return Buffer.isBuffer(rawPayload) ? rawPayload.toString('utf8') : (typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload));
}
function _connectionId(input = {}) {
  return String(input.connectionId || `${String(input.leagueId || 'unknown')}:${String(input.provider || 'unknown')}`);
}
function _identityKey(input = {}) {
  if (input.externalEventId != null && String(input.externalEventId).trim()) return `event:${String(input.externalEventId)}`;
  if (input.payloadHash) return `hash:${String(input.payloadHash)}:${tokenTag(input.leagueToken) || 'none'}`;
  return `receipt:${hashPayload(input.rawPayload ?? input.meta ?? Date.now())}`;
}
function _prodRequiresDb() {
  const env = String(process.env.APP_ENV || process.env.NODE_ENV || '').toLowerCase();
  return env === 'production' && String(process.env.ALLOW_JSON_PROVIDER_RECEIPTS || '').toLowerCase() !== 'true';
}
function _upsertJsonMirrorFromDurable(row, rawPayload) {
  const store = _load();
  let idx = store.runs.findIndex(r => r.id === row.id);
  const run = {
    id: row.id, provider: row.providerKey, leagueId: row.leagueId || null, leagueTokenTag: null,
    externalEventId: row.externalEventId || null, payloadHash: row.payloadHash || null, size: Number(row.size || 0),
    status: row.status || IMPORT_STATUS.RECEIVED, meta: row.meta || {},
    receivedAt: row.receivedAt instanceof Date ? row.receivedAt.getTime() : Number(row.receivedAt || Date.now()),
    completedAt: row.completedAt ? (row.completedAt instanceof Date ? row.completedAt.getTime() : Number(row.completedAt)) : null,
    error: row.error || null, duplicateDeliveries: Number(row.duplicateDeliveries || 0),
  };
  if (idx >= 0) store.runs[idx] = { ...store.runs[idx], ...run }; else store.runs.push(run);
  _save(store);
  if (rawPayload != null && row.payloadHash) {
    const a = storeArtifact(row.payloadHash, rawPayload, { importId: row.id, provider: row.providerKey, durableDb: true });
    if (!a.stored) throw Object.assign(new Error(a.reason || 'artifact-store-failed'), { code:'ARTIFACT_STORE_FAILED' });
  }
  return run;
}

/**
 * Production receipt path. Persists immutable artifact + a DB-unique receipt BEFORE the HTTP layer may return 2xx.
 * JSON remains a local compatibility/work mirror, while PostgreSQL is the idempotency authority when configured.
 */
async function recordReceiptDurable(input = {}) {
  const provider = String(input.provider || 'unknown');
  const payloadHash = input.payloadHash || (input.rawPayload != null ? hashPayload(input.rawPayload) : null);
  const size = Number(input.size || (input.rawPayload != null ? Buffer.byteLength(_artifactText(input.rawPayload), 'utf8') : 0));
  if (input.rawPayload != null && size > MAX_ARTIFACT_BYTES) return { durable:false, duplicate:false, reason:'artifact-too-large', run:null };

  const { getPrisma } = require('../storage/prisma');
  const prisma = getPrisma();
  if (!prisma) {
    if (_prodRequiresDb()) return { durable:false, duplicate:false, reason:'database-required-for-provider-receipts', run:null };
    return recordReceipt({ ...input, payloadHash, size });
  }

  const id = newImportId();
  const connectionId = _connectionId({ ...input, provider });
  const identityKey = _identityKey({ ...input, provider, payloadHash });
  const artifactBody = input.rawPayload == null ? null : _artifactText(input.rawPayload);
  const data = {
    id, connectionId, leagueId:String(input.leagueId || 'unknown'), providerKey:provider, identityKey,
    externalEventId: input.externalEventId != null ? String(input.externalEventId) : null, payloadHash,
    stage: input.meta?.stageHint || input.meta?.event || null, size, status:IMPORT_STATUS.RECEIVED, artifactBody,
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {}, receivedAt:new Date(),
  };
  let row, duplicate = false;
  try {
    row = await prisma.providerImportReceipt.create({ data });
  } catch (err) {
    if (String(err?.code || '') !== 'P2002') throw err;
    duplicate = true;
    row = await prisma.providerImportReceipt.findUnique({ where:{ connectionId_identityKey:{ connectionId, identityKey } } });
    if (!row) throw err;
    row = await prisma.providerImportReceipt.update({ where:{ id:row.id }, data:{ duplicateDeliveries:{ increment:1 } } });
  }
  try {
    const mirror = _upsertJsonMirrorFromDurable(row, artifactBody);
    return { run:mirror, duplicate, durable:true, authority:'postgres' };
  } catch (err) {
    // Do not acknowledge. A retry will hit the DB unique receipt and rebuild the mirror/artifact.
    return { run:null, duplicate:false, durable:false, reason:`compatibility-mirror-failed:${err.message}`, authority:'postgres' };
  }
}

async function markStatusDurable(importId, status, patch = {}) {
  const local = markStatus(importId, status, patch);
  try {
    const { getPrisma } = require('../storage/prisma');
    const p = getPrisma();
    if (p?.providerImportReceipt) {
      await p.providerImportReceipt.update({ where:{ id:importId }, data:{ status, stage:local?.stage || undefined, error:patch.error || null, completedAt:[IMPORT_STATUS.VALIDATED,IMPORT_STATUS.FAILED,IMPORT_STATUS.DUPLICATE,IMPORT_STATUS.APPLIED].includes(status)?new Date():undefined, meta:local?.meta || undefined } });
    }
  } catch {}
  return local;
}

async function listRecoverableDurable(provider, statuses = []) {
  try {
    const { getPrisma } = require('../storage/prisma');
    const p = getPrisma();
    if (p?.providerImportReceipt) {
      const rows = await p.providerImportReceipt.findMany({ where:{ providerKey:provider, status:{ in:statuses } }, orderBy:{ receivedAt:'asc' }, take:1000 });
      for (const row of rows) _upsertJsonMirrorFromDurable(row, row.artifactBody);
      return rows.map(r => _load().runs.find(x=>x.id===r.id)).filter(Boolean);
    }
  } catch {}
  return listByStatus(provider, statuses);
}

module.exports = { FILE, ARTIFACT_FILE, IMPORT_STATUS, hashPayload, tokenTag, recordReceipt, recordReceiptDurable, storeArtifact, getArtifact, markStatus, markStatusDurable, findByEventId, findByHash, listRecent, listByStatus, listRecoverableDurable, getStatusSummary };
