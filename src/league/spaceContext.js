'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const scope = new AsyncLocalStorage();
function current() { return scope.getStore() || null; }
function run(spaceId, fn) { return scope.run(spaceId ? String(spaceId) : null, fn); }
module.exports = { current, run };
