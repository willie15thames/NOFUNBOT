'use strict';
const assert = require('assert');
process.env.BOT_DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'nofun-space-'));
const svc = require('../src/services/managedSpaceService');

assert(svc.COUNTED_STATUSES.has('ACTIVE'));
assert(svc.COUNTED_STATUSES.has('PREPARING'));
assert(!svc.COUNTED_STATUSES.has('REPAIR_REQUIRED'));
assert(!svc.COUNTED_STATUSES.has('ARCHIVING'));

const data = { spaces: { old: { id:'old', name:'Old', status:'PREPARING', createdAt:1 } } };
svc._archiveStalePreparing(data, svc.STALE_PREPARING_MS + 2);
assert.equal(data.spaces.old.status, 'ARCHIVED');

console.log('Managed space regression: 5 passed, 0 failed');
