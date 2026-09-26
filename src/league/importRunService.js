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
const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');

const FILE = 'importRuns.json';
const ARTIFACT_FILE = 'importArtifacts.json';
const MAX_RUNS = 300;
const MAX_ARTIFACTS = 40;            // raw payloads are large; keep the last N only
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

const IMPORT_STATUS = Object.freeze({ RECEIVED: 'received', QUEUED: 'queued', PARSING: 'parsing', VALIDATED: 'validated', FAILED: 'failed', DUPLICATE: 'duplicate', APPLIED: 'applied' });

function _load() {
  const raw = loadJson(FILE, { schema: 'nofunleague-import-runs', version: 1, runs: [] }) || {};
  return { schema: 'nofunleague-import-runs', version: 1, runs: Array.isArray(raw.runs) ? raw.runs : [] };
}
function _save(store) {
  if (store.runs.length > MAX_RUNS) store.runs.splice(0, store.runs.length - MAX_RUNS);
  saveJsonDebounced(FILE, store, 200);
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
  const provider = String(input.provider || 'unknown');
  const existing = (input.externalEventId && findByEventId(provider, input.externalEventId)) || (input.payloadHash && findByHash(provider, input.payloadHash, input.leagueToken || null)) || null;
  if (existing) {
    const store = _load();
    const idx = store.runs.findIndex(r => r.id === existing.id);
    if (idx !== -1) { store.runs[idx].duplicateDeliveries = (store.runs[idx].duplicateDeliveries || 0) + 1; store.runs[idx].lastDuplicateAt = Date.now(); _save(store); }
    return { run: existing, duplicate: true };
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
  const store = _load();
  store.runs.push(run);
  _save(store);
  if (input.rawPayload != null && input.payloadHash) storeArtifact(input.payloadHash, input.rawPayload, { importId: run.id, provider });
  return { run, duplicate: false };
}

function storeArtifact(hash, rawPayload, meta = {}) {
  const text = Buffer.isBuffer(rawPayload) ? rawPayload.toString('utf8') : (typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload));
  if (Buffer.byteLength(text, 'utf8') > MAX_ARTIFACT_BYTES) return { stored: false, reason: 'artifact-too-large' };
  const store = _loadArtifacts();
  store.artifacts[hash] = { hash, meta, size: Buffer.byteLength(text, 'utf8'), storedAt: Date.now(), body: text };
  const keys = Object.keys(store.artifacts).sort((a, b) => store.artifacts[a].storedAt - store.artifacts[b].storedAt);
  while (keys.length > MAX_ARTIFACTS) delete store.artifacts[keys.shift()];
  saveJsonDebounced(ARTIFACT_FILE, store, 500);
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
  return store.runs[idx];
}

function listRecent(limit = 10) {
  return _load().runs.slice(-limit).reverse();
}

function getStatusSummary() {
  const runs = _load().runs;
  const last = runs[runs.length - 1] || null;
  return { total: runs.length, last: last ? { id: last.id, provider: last.provider, status: last.status, receivedAt: last.receivedAt, completedAt: last.completedAt, error: last.error } : null };
}

module.exports = { FILE, ARTIFACT_FILE, IMPORT_STATUS, hashPayload, tokenTag, recordReceipt, storeArtifact, getArtifact, markStatus, findByEventId, findByHash, listRecent, getStatusSummary };
