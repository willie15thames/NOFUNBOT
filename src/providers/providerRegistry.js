'use strict';

// Pure registry. This module MUST NOT import any concrete provider implementation.
const providers = new Map();

function register(provider) {
  if (!provider?.key) throw new Error('cannot register provider without key');
  providers.set(String(provider.key), provider);
  return provider;
}
function get(key) { return providers.get(String(key || '')) || null; }
function list() { return [...providers.values()].map(p => p.describe()); }
function clearForTests() { providers.clear(); }
function size() { return providers.size; }

module.exports = { register, get, list, clearForTests, size };
