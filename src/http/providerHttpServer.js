/*
 * NAVIGATION HEADER
 * FILE: src/http/providerHttpServer.js
 * LAYER: HTTP transport (V202, spec §8/§9/§31)
 * PURPOSE: In-process HTTP listener for provider ingestion routes (Companion export gateway, NeonSportz webhook).
 *          Runs INSIDE the bot process so receipts land in the same jsonStore cache the engine reads.
 *          FEATURE-FLAGGED: starts only when ENABLE_PROVIDER_HTTP=true (default off → zero behavior change).
 *          Listens on PROVIDER_HTTP_PORT (default 3100). health-server.js keeps owning PORT — unchanged.
 * LOOK HERE FIRST WHEN DEBUGGING: start(), _readBody().
 * NOTE: Body is read with a hard cap per route; oversize requests are cut off with 413. No request bodies or
 *       auth headers are logged.
 */

'use strict';

const http = require('http');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('providerHttp');

const ROUTES = [require('./routes/maddenCompanion'), require('./routes/neonsportzWebhook')];
let _server = null;

function _readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) { reject(Object.assign(new Error('payload-too-large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function _send(res, status, body) {
  const text = JSON.stringify(body || {});
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

async function _handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  for (const route of ROUTES) {
    const params = route.match(req.method, url.pathname);
    if (!params) continue;
    try {
      const body = await _readBody(req, route.maxBytes);
      const leagues=require('../services/activeLeagueService').listActiveLeagues().filter(x=>x.kind!=='event');
      const selected=process.env.PROVIDER_HTTP_SPACE_ID || (leagues.length===1?leagues[0].id:null);
      if(leagues.length>1 && !selected)return _send(res,409,{ok:false,reason:'Configure PROVIDER_HTTP_SPACE_ID for this receiver'});
      if(selected&&!leagues.some(x=>x.id===selected))return _send(res,409,{ok:false,reason:'Configured provider space is not active'});
      const r = await require('../league/spaceContext').run(selected,()=>route.handle(params, req, body, Object.fromEntries(url.searchParams)));
      return _send(res, r.status, r.body);
    } catch (e) {
      return _send(res, e.status || 500, { ok: false, reason: e.status === 413 ? 'payload-too-large' : 'internal-error' });
    }
  }
  return _send(res, 404, { ok: false, reason: 'not-found' });
}

function start() {
  const { toBoolean } = require('../config/featureFlags');
  if (!toBoolean(process.env.ENABLE_PROVIDER_HTTP, false)) return { started: false, reason: 'disabled' };
  if (_server) return { started: true, port: _server.address()?.port };
  const port = Number(process.env.PROVIDER_HTTP_PORT || 3100);
  _server = http.createServer((req, res) => { _handle(req, res).catch(() => _send(res, 500, { ok: false })); });
  _server.requestTimeout = 30000;
  _server.listen(port, () => log.info(`provider HTTP receiver listening on :${port}`));
  _server.on('error', e => log.error(`provider HTTP receiver error: ${e.message}`));
  return { started: true, port };
}

function stop() { if (_server) { _server.close(); _server = null; } }

module.exports = { start, stop, _handle };
