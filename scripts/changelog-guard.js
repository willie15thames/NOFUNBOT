/*
 * NAVIGATION HEADER
 * FILE: scripts/changelog-guard.js
 * LAYER: Maintenance and operational scripts
 * PURPOSE: Prevents duplicate execution and protects single-consumer / idempotent behavior.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually run manually or from package.json / deployment hooks.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const changelogPath = path.join(__dirname, '..', 'changelog.txt');
if (!fs.existsSync(changelogPath)) { console.error('changelog.txt is missing. Update the changelog before packaging.'); process.exit(1); }
const content = fs.readFileSync(changelogPath, 'utf8');
if (!/v141/i.test(content)) { console.error('changelog.txt does not contain the current release entry (v141).'); process.exit(1); }
console.log('changelog.txt present and current release entry detected.');
