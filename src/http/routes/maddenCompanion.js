/*
 * NAVIGATION HEADER
 * FILE: src/http/routes/maddenCompanion.js
 * LAYER: HTTP transport (V202, spec §8)
 * PURPOSE: Transport adapter for POST /v1/providers/madden/companion/export/{leagueToken}. Reads the body under a
 *          hard size cap, delegates to exportGateway.receiveExport (durable receipt + dedupe), responds 2xx fast, and
 *          returns only after the receipt/artifact is durable. Processing is owned by the recovery/sync worker, so a process crash after 202 cannot strand work.
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
  const r = await gateway.receiveExportDurable({ leagueToken: params.leagueToken, leagueId: require('../../league/spaceContext').current(), contentType: req.headers['content-type'] || '', body });
  return { status: r.status, body: r.body };
}

function resolveSpace(params) { const r = gateway.resolveLeagueToken(params?.leagueToken); return r.valid ? r.leagueId : null; }
module.exports = { ROUTE, routeName: 'madden-companion-export', match, handle, resolveSpace, maxBytes: gateway.MAX_PAYLOAD_BYTES };
