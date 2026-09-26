/*
 * NAVIGATION HEADER
 * FILE: src/http/routes/neonsportzWebhook.js
 * LAYER: HTTP transport (V202, spec §9)
 * PURPOSE: Transport adapter for POST /v1/providers/neonsportz/import-completed. Delegates to the idempotent
 *          webhook receiver; the read-only sync of the new data runs asynchronously after the 2xx acknowledgement.
 */

'use strict';

const webhook = require('../../providers/madden/neonsportz/webhook');

function match(method, pathname) {
  return method === 'POST' && /^\/v1\/providers\/neonsportz\/import-completed\/?$/.test(String(pathname || '')) ? {} : null;
}

async function handle(params, req, body, query) {
  const r = webhook.receiveImportCompleted({ headers: req.headers, body, query });
  if (r.importId && !r.duplicate && r.status === 202) {
    setImmediate(() => {
      require('../../services/leagueSyncService').processQueuedImports('neonsportz').catch(() => null);
    });
  }
  return { status: r.status, body: r.body };
}

module.exports = { match, handle, maxBytes: webhook.MAX_BODY_BYTES };
