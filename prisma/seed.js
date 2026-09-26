/*
 * NAVIGATION HEADER
 * FILE: prisma/seed.js
 * LAYER: Database schema and seed layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Used by persistence code and deployment/bootstrap workflows.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const guildId = process.env.GUILD_ID || 'default';
const flags = [
  'aiMentionEnabled',
  'guideLifecycleEnabled',
  'backgroundJobsEnabled',
  'wizardAutopostEnabled',
  'auditLogEnabled',
  'queueWorkerEnabled',
];

async function main() {
  await prisma.serverConfig.upsert({
    where: { guildId },
    update: {
      botStatus: 'active',
      filterMode: 'strict',
      setupComplete: false,
      serverInitialized: false,
    },
    create: {
      guildId,
      botStatus: 'active',
      filterMode: 'strict',
      setupComplete: false,
      serverInitialized: false,
    },
  });

  await prisma.wizardState.upsert({
    where: { guildId },
    update: {
      currentStep: 'flow',
      installationMode: true,
      editMode: false,
      completedSteps: [],
    },
    create: {
      guildId,
      currentStep: 'flow',
      installationMode: true,
      editMode: false,
      completedSteps: [],
    },
  });

  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { guildId_flag: { guildId, flag } },
      update: { enabled: true, metadata: { seededBy: 'prisma/seed.js' } },
      create: { guildId, flag, enabled: true, metadata: { seededBy: 'prisma/seed.js' } },
    });
  }

  console.log(`Prisma seed complete for guild ${guildId}. Seeded ${flags.length} feature flags.`);
}

main()
  .catch(err => {
    console.error('Prisma seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
