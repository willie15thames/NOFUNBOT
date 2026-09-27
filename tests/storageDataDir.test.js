'use strict';
const { test, run, assert, eq } = require('./_harness');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('explicit BOT_DATA_DIR does not silently fall back when unavailable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfl-dir-check-'));
  try {
    const blocked = path.join(root, 'file');
    fs.writeFileSync(blocked, 'not a directory');
    const child = spawnSync(process.execPath, ['-e', "require('./src/storage/jsonStore')"], {
      cwd: path.join(__dirname, '..'), encoding: 'utf8',
      env: { ...process.env, BOT_DATA_DIR: blocked },
    });
    assert(child.status !== 0, 'startup should fail');
    assert(child.stderr.includes('BOT_DATA_DIR is unavailable'), 'failure names the configured directory');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('explicit writable BOT_DATA_DIR remains the selected directory', () => {
  eq(require('../src/storage/jsonStore').getDataDir(), process.env.BOT_DATA_DIR, 'selected directory');
});

run('storageDataDir.test.js');
