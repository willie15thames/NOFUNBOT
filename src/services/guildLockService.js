/*
 * NAVIGATION HEADER
 * FILE: src/services/guildLockService.js
 * LAYER: Service layer
 * PURPOSE: Prevents duplicate execution and protects single-consumer / idempotent behavior.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * guildLockService.js
 * 
 * Guild-level distributed lock for serializing destructive commands.
 * Prevents overlapping /trash-the-bot, /initialize-server, /reset-league.
 * 
 * Uses in-memory Map as primary (fast path) with DB persistence fallback.
 * Locks auto-expire after TTL_MS to prevent stuck states on crash.
 * 
 * Usage:
 *   const lock = require('./guildLockService');
 *   const acquired = await lock.acquire(guildId, 'trash-the-bot', userId);
 *   if (!acquired) return interaction.reply({ content: '⏳ Already running...', flags:64 });
 *   try { ... } finally { await lock.release(guildId, 'trash-the-bot'); }
 */

const { makeLogger } = require('../utils/logger');
const { prismaSafe } = require('../storage/prisma');
const log = makeLogger('guildLock');

const TTL_MS = 5 * 60 * 1000; // 5 minutes max hold time

// In-memory primary store: `${guildId}:${lockType}` → { lockedBy, expiresAt }
const _locks = new Map();

function _key(guildId, lockType) {
  return `${guildId}:${lockType}`;
}

function _isExpired(entry) {
  return entry.expiresAt && Date.now() > entry.expiresAt;
}

/**
 * Attempt to acquire a lock. Returns true if acquired, false if already held.
 * @param {string} guildId
 * @param {string} lockType  e.g. 'trash-the-bot', 'initialize-server', 'reset-league'
 * @param {string} [lockedBy]  userId of requester
 * @param {number} [ttlMs]  override TTL
 */
async function acquire(guildId, lockType, lockedBy, ttlMs = TTL_MS) {
  const key = _key(guildId, lockType);
  const existing = _locks.get(key);

  // Check in-memory — if exists and not expired, deny
  if (existing && !_isExpired(existing)) {
    log.warn(`lock denied: ${lockType} held by ${existing.lockedBy} in guild ${guildId}`);
    return false;
  }

  const expiresAt = Date.now() + ttlMs;
  _locks.set(key, { lockedBy: lockedBy || 'system', expiresAt, acquiredAt: Date.now() });
  _ensurePurgeTimer();

  // Persist to DB (non-blocking, best-effort)
  prismaSafe(prisma => prisma.guildLock.upsert({
    where: { guildId_lockType: { guildId: String(guildId), lockType: String(lockType) } },
    create: { guildId: String(guildId), lockType: String(lockType), lockedBy: lockedBy || null, expiresAt: new Date(expiresAt) },
    update: { lockedBy: lockedBy || null, lockedAt: new Date(), expiresAt: new Date(expiresAt) },
  }), null).catch(() => null);

  log.info(`lock acquired: ${lockType} by ${lockedBy || 'system'} in guild ${guildId} (expires in ${Math.round(ttlMs/1000)}s)`);
  return true;
}

/**
 * Release a lock.
 */
async function release(guildId, lockType) {
  const key = _key(guildId, lockType);
  _locks.delete(key);

  prismaSafe(prisma => prisma.guildLock.deleteMany({
    where: { guildId: String(guildId), lockType: String(lockType) },
  }), null).catch(() => null);

  log.info(`lock released: ${lockType} in guild ${guildId}`);
}

/**
 * Check if a lock is currently held (without acquiring).
 */
function isLocked(guildId, lockType) {
  const key = _key(guildId, lockType);
  const existing = _locks.get(key);
  return !!(existing && !_isExpired(existing));
}

/**
 * Return info about a held lock, or null.
 */
function getLockInfo(guildId, lockType) {
  const key = _key(guildId, lockType);
  const existing = _locks.get(key);
  if (!existing || _isExpired(existing)) return null;
  return {
    lockedBy: existing.lockedBy,
    acquiredAt: existing.acquiredAt,
    expiresAt: existing.expiresAt,
    remainingMs: Math.max(0, existing.expiresAt - Date.now()),
  };
}

/**
 * Release all expired locks (called periodically).
 */
function purgeExpired() {
  let count = 0;
  for (const [key, entry] of _locks) {
    if (_isExpired(entry)) { _locks.delete(key); count++; }
  }
  if (count > 0) log.info(`purged ${count} expired guild lock(s)`);
}

// Lazy auto-purge — only runs when locks exist, stops when empty
let _purgeTimer = null;
function _ensurePurgeTimer() {
  if (_purgeTimer) return;
  _purgeTimer = setInterval(() => {
    purgeExpired();
    if (_locks.size === 0 && _purgeTimer) {
      clearInterval(_purgeTimer);
      _purgeTimer = null;
    }
  }, 2 * 60_000);
  _purgeTimer.unref?.();
}

// Destructive commands that require a guild lock
const DESTRUCTIVE_COMMANDS = new Set([
  'trash-the-bot',
  'initialize-server',
  'reset-league',
  'delete-league',
  'delete-community',
]);

function isDestructiveCommand(commandName) {
  return DESTRUCTIVE_COMMANDS.has(commandName);
}

module.exports = { acquire, release, isLocked, getLockInfo, purgeExpired, isDestructiveCommand, DESTRUCTIVE_COMMANDS };
