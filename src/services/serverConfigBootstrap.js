/*
 * NAVIGATION HEADER
 * FILE: src/services/serverConfigBootstrap.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * serverConfigBootstrap.js
 * 
 * Ensures a ServerConfig row exists for the bot's guild before any Prisma write.
 * Solves the singleton/guildId blocker: all services can call getGuildId() to get
 * the canonical guildId for DB operations.
 * 
 * Called once at startup from startupBuildOrderService Phase 1.
 * Safe to call multiple times — uses upsert.
 */

const { makeLogger } = require('../utils/logger');
const { prismaSafe } = require('../storage/prisma');
const log = makeLogger('serverConfig');

// The single guildId this bot instance manages
// All singleton services use this as their FK
let _guildId = null;

function getGuildId() {
  return _guildId || process.env.GUILD_ID || null;
}

/**
 * Bootstrap the ServerConfig row for this guild.
 * Must be called before any other Prisma writes.
 * Returns the ServerConfig record (or null if DB unavailable).
 */
async function bootstrapServerConfig(guildId) {
  _guildId = String(guildId);

  const result = await prismaSafe(prisma => prisma.serverConfig.upsert({
    where: { guildId: _guildId },
    create: {
      guildId: _guildId,
      botStatus: 'active',
      setupComplete: false,
      serverInitialized: false,
    },
    update: {
      // Only update non-destructive fields on restart — don't overwrite live settings
      updatedAt: new Date(),
    },
  }), null);

  if (result) {
    log.info(`ServerConfig bootstrapped for guild ${_guildId}`);
  } else {
    log.warn(`ServerConfig bootstrap skipped (DB unavailable) — running in JSON-only mode`);
  }

  return result;
}

/**
 * Read the current ServerConfig from DB.
 * Falls back to null if DB unavailable.
 */
async function readServerConfig() {
  const guildId = getGuildId();
  if (!guildId) return null;
  return prismaSafe(prisma => prisma.serverConfig.findUnique({
    where: { guildId: String(guildId) },
  }), null);
}

/**
 * Patch specific fields on the ServerConfig row.
 * Only updates fields explicitly provided — never clobbers.
 */
async function patchServerConfig(fields = {}) {
  const guildId = getGuildId();
  if (!guildId) return null;
  return prismaSafe(prisma => prisma.serverConfig.update({
    where: { guildId: String(guildId) },
    data: { ...fields, updatedAt: new Date() },
  }), null);
}

module.exports = { getGuildId, bootstrapServerConfig, readServerConfig, patchServerConfig };
