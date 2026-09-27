/*
 * NAVIGATION HEADER
 * FILE: scripts/changelog-guard.js
 * LAYER: Maintenance / release safety
 * PURPOSE: Requires changelog.txt to contain the exact package version being packaged.
 * LOOK HERE FIRST WHEN DEBUGGING: package.json version and the first changelog entry.
 * NOTE: Do not hard-code an old release label here. The package version is the executable release contract.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const changelogPath = path.join(root, 'changelog.txt');
const packagePath = path.join(root, 'package.json');

if (!fs.existsSync(changelogPath)) {
  console.error('[changelog-guard] FAIL changelog.txt is missing. Update the changelog before packaging.');
  process.exit(1);
}
if (!fs.existsSync(packagePath)) {
  console.error('[changelog-guard] FAIL package.json is missing.');
  process.exit(1);
}

const version = String(JSON.parse(fs.readFileSync(packagePath, 'utf8')).version || '').trim();
const content = fs.readFileSync(changelogPath, 'utf8');
if (!version) {
  console.error('[changelog-guard] FAIL package.json has no version.');
  process.exit(1);
}
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const versionPattern = new RegExp(`(?:package\\s+|v)${escaped}(?:\\b|\\s|\\]|\\))`, 'i');
if (!versionPattern.test(content)) {
  console.error(`[changelog-guard] FAIL changelog.txt does not contain the current package version ${version}.`);
  process.exit(1);
}
console.log(`[changelog-guard] PASS changelog.txt contains package ${version}.`);
