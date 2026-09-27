'use strict';
// Compatibility entry point: committed migrations own the complete schema.
// Do not recreate legacy BotKv/QueueAudit tables after Prisma renamed them.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for database bootstrap');
  process.exitCode = 1;
} else {
  const cli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'inherit',
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status == null ? 1 : result.status;
}
