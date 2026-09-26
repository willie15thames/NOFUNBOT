#!/usr/bin/env node
/*
 * NAVIGATION HEADER
 * FILE: scripts/install-git-hooks.js
 * LAYER: Maintenance and operational scripts
 * PURPOSE: Provides a project script for setup, auditing, deployment, or maintenance.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually run manually or from package.json / deployment hooks.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

const { execSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const hooksPath = path.join(root, '.githooks');

try {
  execSync(`git config core.hooksPath "${hooksPath}"`, { stdio: 'inherit' });
  console.log(`[hooks] core.hooksPath set to ${hooksPath}`);
  console.log('[hooks] pre-commit enforcement is now active for this repo.');
} catch (error) {
  console.error('[hooks] Failed to set core.hooksPath. Run this from inside the git repo.');
  process.exit(1);
}
