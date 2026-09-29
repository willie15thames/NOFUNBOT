'use strict';

// Composition root for provider implementations. Concrete providers are wired here, never in the registry or contract.
const registry = require('./providerRegistry');
let bootstrapped = false;

function bootstrap() {
  if (bootstrapped) return registry.list();
  bootstrapped = true;
  registry.register(require('./local'));
  for (const provider of require('./madden')) registry.register(provider);
  for (const provider of require('./nba2k')) registry.register(provider);
  return registry.list();
}

function resetForTests() { bootstrapped = false; registry.clearForTests(); }
module.exports = { bootstrap, resetForTests };
