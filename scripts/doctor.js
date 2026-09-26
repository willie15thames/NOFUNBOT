/*
 * NAVIGATION HEADER
 * FILE: scripts/doctor.js
 * LAYER: Maintenance and operational scripts
 * PURPOSE: Provides a project script for setup, auditing, deployment, or maintenance.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually run manually or from package.json / deployment hooks.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const deps = ['discord.js', '@anthropic-ai/sdk'];
let failed = false;

for (const dep of deps) {
  try {
    require.resolve(dep);
    console.log(`✅ ${dep} installed`);
  } catch {
    failed = true;
    console.error(`❌ Missing ${dep}`);
  }
}

try {
  require('./../src/config/env');
  console.log('✅ Environment loader OK');
} catch (err) {
  failed = true;
  console.error('❌ Environment loader failed:', err.message);
}

if (failed) {
  console.error('\nRun: npm install');
  process.exit(1);
}

console.log('\nBot dependency check passed.');
