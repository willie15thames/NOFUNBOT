/*
 * NAVIGATION HEADER
 * FILE: src/http/routes/neonsportzWebhook.js
 * LAYER: HTTP transport (V202, spec §9)
 * PURPOSE: Transport adapter for POST /v1/providers/neonsportz/import-completed. Delegates to the idempotent
 *          webhook receiver. The receipt is durable before 202; processing is owned by the recovery/sync worker so restarts are safe.
 */

'use strict';

const webhook = require('../../providers/madden/neonsportz/webhook');

function match(method, pathname) {
  if (method !== 'POST') return null;
  const m=String(pathname||'').match(/^(?:\/v1\/providers\/neonsportz\/import-completed(?:\/([A-Za-z0-9_-]{16,128}))?|\/n\/([A-Za-z0-9_-]{16,128}))\/?$/);
  return m ? { routeToken:m[1]||m[2]||null } : null;
}


async function handle(params, req, body, query) {
  const r = await webhook.receiveImportCompletedDurable({ headers: req.headers, body, query, routeToken: params.routeToken });
  return { status: r.status, body: r.body };
}

function resolveSpace(params){ if(!params?.routeToken)return null; const r=webhook.resolveRouteToken(params.routeToken); return r.valid?r.leagueId:null; }
module.exports = { routeName: 'neonsportz-import-completed', match, handle, resolveSpace, maxBytes: webhook.MAX_BODY_BYTES };
