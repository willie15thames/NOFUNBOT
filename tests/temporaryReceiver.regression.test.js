'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nofunbot-temp-receiver-'));
process.env.BOT_DATA_DIR = dir;
process.env.PUBLIC_BASE_URL = 'https://bot.example.test';
process.env.APP_ENV = 'test';
process.env.ENABLE_PROVIDER_HTTP = 'true';
process.env.ALLOW_JSON_PROVIDER_CONNECTIONS = 'true';

const connections = require('../src/services/providerConnectionService');
const actions = require('../src/services/providerConnectionActionService');
const maddenRoute = require('../src/http/routes/maddenCompanion');
const neonRoute = require('../src/http/routes/neonsportzWebhook');

(async () => {
  let passed = 0;
  function ok(name, fn) { fn(); passed++; console.log(`  ✔ ${name}`); }

  const out = await actions.temporaryUrl({ leagueId:'league-a', provider:'companion_export', minutes:15 });
  ok('temporary Madden receiver uses short public URL', () => {
    assert.equal(out.ok, true);
    assert.match(out.receiverUrl, /^https:\/\/bot\.example\.test\/x\/[A-Za-z0-9_-]{16,128}$/);
    assert.ok(out.expiresAt > Date.now());
  });
  const token = out.receiverUrl.split('/').pop();
  ok('short Madden route resolves', () => assert.deepEqual(maddenRoute.match('POST', `/x/${token}`), { leagueToken: token }));
  ok('legacy Madden route remains compatible', () => assert.deepEqual(maddenRoute.match('POST', `/v1/providers/madden/companion/export/${token}`), { leagueToken: token }));
  ok('valid token resolves to exact league', () => {
    const r = connections.resolveRouteToken('companion_export', token);
    assert.equal(r.valid, true); assert.equal(r.leagueId, 'league-a');
  });

  const rotated = await actions.temporaryUrl({ leagueId:'league-a', provider:'companion_export', minutes:60 });
  const token2 = rotated.receiverUrl.split('/').pop();
  ok('generating a new URL invalidates the old token', () => {
    assert.equal(connections.resolveRouteToken('companion_export', token).valid, false);
    assert.equal(connections.resolveRouteToken('companion_export', token2).valid, true);
  });

  connections.upsertConnection({ leagueId:'league-expired', providerKey:'companion_export', routeToken:'expired-token-1234567890', config:{receiverExpiresAt:Date.now()-10} });
  ok('expired receiver token is rejected', () => {
    const r = connections.resolveRouteToken('companion_export', 'expired-token-1234567890');
    assert.equal(r.valid, false); assert.equal(r.expired, true);
  });

  const neon = await actions.temporaryUrl({ leagueId:'league-b', provider:'neonsportz', minutes:30 });
  const nToken = neon.receiverUrl.split('/').pop();
  ok('NeonSportz gets a short receiver path', () => {
    assert.match(neon.receiverUrl, /^https:\/\/bot\.example\.test\/n\//);
    assert.deepEqual(neonRoute.match('POST', `/n/${nToken}`), { routeToken:nToken });
  });

  console.log(`Temporary receiver regression: ${passed} passed, 0 failed`);
})().catch(err => { console.error(err); process.exit(1); });
