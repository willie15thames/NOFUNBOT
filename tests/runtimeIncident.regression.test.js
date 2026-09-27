'use strict';
const assert = require('assert');
process.env.APP_ENV = 'test';
const svc = require('../src/services/runtimeIncidentService');

const dirty = 'postgresql://user:pass@host/db token=abc123 password=hunter2 Authorization: Bearer secret-value';
const clean = svc.sanitizeText(dirty);
assert(!clean.includes('user:pass'), 'database credentials redacted');
assert(!clean.includes('hunter2'), 'password redacted');
assert(!clean.includes('secret-value'), 'authorization redacted');

const a = svc.fingerprintIncident(new Error('Failed for guild 123456789012345678'), { source: 'x' });
const b = svc.fingerprintIncident(new Error('Failed for guild 987654321098765432'), { source: 'x' });
assert.equal(a, b, 'Discord IDs should not create separate fingerprints');

svc.resetForTests();
assert.equal(svc.shouldSuppress('same', 1000), false);
assert.equal(svc.shouldSuppress('same', 1001), true);

console.log('Runtime incident regression: 6 passed, 0 failed');
