/*
 * NAVIGATION HEADER
 * FILE: src/providers/madden/neonsportz/webhook.js
 * LAYER: Provider adapter layer (V202, spec §9)
 * PURPOSE: Receiver logic for POST /v1/providers/neonsportz/import-completed. The webhook is a TRIGGER, not the
 *          payload: verify event name → dedupe by X-NeonSportz-Delivery / eventId → validate league mapping →
 *          record receipt → return 2xx quickly. Data is fetched afterwards through the read client (sync step).
 *          NeonSportz retries deliveries (network errors, 408, 429, 5xx, up to eight attempts) so this receiver
 *          MUST be idempotent — the same delivery id never produces a second sync.
 * LOOK HERE FIRST WHEN DEBUGGING: receiveImportCompleted(), REQUIRED_EVENT.
 * RELATED FLOW: http/routes/neonsportzWebhook.js (transport), importRunService, neonsportz/client.js.
 */

'use strict';

const importRuns = require('../../../league/importRunService');
const { makeLogger } = require('../../../utils/logger');

const log = makeLogger('neonsportzWebhook');
const PROVIDER = 'neonsportz';
const REQUIRED_EVENT = 'league_import_completed';
const MAX_BODY_BYTES = 256 * 1024;

function _secret() { return String(process.env.NEONSPORTZ_WEBHOOK_SECRET || '').trim(); }

function _timingSafeEqual(a, b) {
  const crypto = require('crypto');
  const ba = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length || !ba.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * @param {object} req { headers:{[lowercase]:string}, body:Buffer|string, query?:{token?} }
 * @returns {{ status:number, body:object, importId?:string, duplicate?:boolean, event?:object }}
 */
function receiveImportCompleted(req = {}) {
  const headers = Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [String(k).toLowerCase(), Array.isArray(v) ? v[0] : v]));
  const secret = _secret();
  if (!secret) return { status: 503, body: { ok: false, reason: 'webhook-not-configured' } };
  const presented = headers['x-neonsportz-secret'] || headers['x-webhook-secret'] || headers['authorization']?.replace(/^Bearer\s+/i, '') || req.query?.token || '';
  if (!_timingSafeEqual(presented, secret)) return { status: 401, body: { ok: false, reason: 'unauthorized' } };

  const size = Buffer.isBuffer(req.body) ? req.body.length : Buffer.byteLength(String(req.body ?? ''), 'utf8');
  if (size > MAX_BODY_BYTES) return { status: 413, body: { ok: false, reason: 'payload-too-large' } };
  let event;
  try { event = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '{}')); }
  catch { return { status: 400, body: { ok: false, reason: 'invalid-json' } }; }
  if (!event || typeof event !== 'object') return { status: 400, body: { ok: false, reason: 'invalid-event' } };

  const eventName = String(event.event || event.type || '').toLowerCase();
  if (eventName !== REQUIRED_EVENT) {
    log.info(`ignored event=${eventName || 'none'}`);
    return { status: 200, body: { ok: true, ignored: true, reason: 'event-not-handled' } }; // 2xx so NeonSportz does not retry
  }
  const deliveryId = headers['x-neonsportz-delivery'] || event.deliveryId || event.eventId || event.id || null;
  if (!deliveryId) return { status: 400, body: { ok: false, reason: 'missing-delivery-id' } };

  const expectedLeague = String(process.env.NEONSPORTZ_LEAGUE_ID || '').trim();
  const league = event.league?.id ?? event.leagueId ?? event.league ?? null;
  if (expectedLeague && String(league ?? '') !== expectedLeague) {
    log.warn(`unknown league in webhook delivery=${deliveryId}`);
    return { status: 200, body: { ok: true, ignored: true, reason: 'unknown-league' } };
  }

  const { run, duplicate } = importRuns.recordReceipt({
    provider: PROVIDER,
    leagueId: league != null ? String(league) : null,
    externalEventId: String(deliveryId),
    payloadHash: importRuns.hashPayload(event),
    size,
    meta: {
      event: eventName,
      seasonIndex: event.seasonIndex ?? event.season?.index ?? null,
      weekIndex: event.weekIndex ?? event.week?.index ?? null,
      importType: event.importType ?? null,
      completedThrough: event.completedThrough ?? null,
    },
  });
  log.info(`receipt importId=${run.id} delivery=${String(deliveryId).slice(0, 24)} duplicate=${duplicate} receivedAt=${run.receivedAt}`);
  if (duplicate) return { status: 200, body: { ok: true, duplicate: true, importId: run.id }, importId: run.id, duplicate: true };
  importRuns.markStatus(run.id, importRuns.IMPORT_STATUS.QUEUED);
  return { status: 202, body: { ok: true, importId: run.id, queued: true }, importId: run.id, duplicate: false, event };
}

module.exports = { PROVIDER, REQUIRED_EVENT, MAX_BODY_BYTES, receiveImportCompleted };
