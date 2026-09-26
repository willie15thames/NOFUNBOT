/*
 * NAVIGATION HEADER
 * FILE: src/http/routes/maddenCompanion.js
 * LAYER: HTTP transport (V202, spec §8)
 * PURPOSE: Transport adapter for POST /v1/providers/madden/companion/export/{leagueToken}. Reads the body under a
 *          hard size cap, delegates to exportGateway.receiveExport (durable receipt + dedupe), responds 2xx fast, and
 *          schedules parse/normalize/validate asynchronously so a slow parser never blocks the receiver.
 */

'use strict';

const gateway = require('../../providers/madden/companion/exportGateway');

const ROUTE = /^\/v1\/providers\/madden\/companion\/export\/([A-Za-z0-9_-]{16,128})\/?$/;

function match(method, pathname) {
  if (method !== 'POST') return null;
  const m = String(pathname || '').match(ROUTE);
  return m ? { leagueToken: m[1] } : null;
}

async function handle(params, req, body) {
  const r = gateway.receiveExport({ leagueToken: params.leagueToken, contentType: req.headers['content-type'] || '', body });
  if (r.importId && !r.duplicate && r.status === 202) {
    setImmediate(() => { try { gateway.processImportRun(r.importId, {}); } catch {} });
  }
  return { status: r.status, body: r.body };
}

module.exports = { ROUTE, match, handle, maxBytes: gateway.MAX_PAYLOAD_BYTES };
