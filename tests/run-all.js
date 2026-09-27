/*
 * NAVIGATION HEADER
 * FILE: tests/run-all.js
 * LAYER: Tests (V202)
 * PURPOSE: Runs every tests/*.test.js in its own Node process with an isolated BOT_DATA_DIR and placeholder
 *          env (no real tokens). Exit code is non-zero if any test fails. Usage: npm test
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfl-test-'));
  const env = { ...process.env, NODE_ENV: 'test', APP_ENV: 'test', BOT_DATA_DIR: dataDir, DISCORD_TOKEN: 'test-token', CLIENT_ID: '111111111111111111', GUILD_ID: '222222222222222222', AI_ENABLED: 'false', REDIS_URL: '', DATABASE_URL: '' };
  const r = spawnSync(process.execPath, [path.join(dir, f)], { env, encoding: 'utf8', timeout: 120000 });
  const out = `${r.stdout || ''}`.split('\n').filter(l => /^\s*(✔|✘)|passed|^\s{6}/.test(l)).join('\n');
  console.log(out);
  if (r.status !== 0 || !/passed, 0 failed/.test(r.stdout || '')) { failed++; if (r.stderr) console.log(r.stderr.split('\n').filter(l => !/^\[(store|ENV)\]/.test(l)).slice(-15).join('\n')); }
}
console.log(`\n${files.length} test files, ${failed} failed`);
process.exit(failed ? 1 : 0);
