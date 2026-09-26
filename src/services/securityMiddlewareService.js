/*
 * NAVIGATION HEADER
 * FILE: src/services/securityMiddlewareService.js
 * LAYER: Service layer
 * PURPOSE: Performs validation, security checks, or escalation/governance control.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * securityMiddlewareService.js
 *
 * Centralized security layer. Provides:
 *   1. Rate limiting (per-user, per-guild, per-command)
 *   2. Input validation and sanitization guards
 *   3. Audit logging for security-sensitive actions
 *   4. Permission enforcement helpers
 *
 * Wire this before the interaction router in index.js:
 *   const sec = require('./src/services/securityMiddlewareService');
 *   if (sec.guardInteraction(interaction)) return; // rate-limited or blocked
 */

const { makeLogger } = require('../utils/logger');
const { prismaSafe } = require('../storage/prisma');
const log = makeLogger('security');

// ── Rate limit store (in-memory, per-process) ───────────────
const _rateBuckets = new Map(); // key → { count, resetAt }

const RATE_LIMITS = {
  // [command]: { max, windowMs }
  default:             { max: 8,  windowMs: 10_000 },
  'trash-the-bot':     { max: 1,  windowMs: 60_000 },
  'initialize-server': { max: 2,  windowMs: 60_000 },
  'reset-league':      { max: 3,  windowMs: 60_000 },
  'delete-league':     { max: 3,  windowMs: 60_000 },
  'setup-bot':         { max: 5,  windowMs: 20_000 },
  'set-bot-identity':  { max: 5,  windowMs: 30_000 },
};

function _rateLimitKey(userId, guildId, cmd) {
  return `${guildId}:${userId}:${cmd}`;
}

/**
 * Returns true if the user should be blocked (rate limited).
 */
function checkRateLimit(userId, guildId, cmd) {
  const cfg = RATE_LIMITS[cmd] || RATE_LIMITS.default;
  const key = _rateLimitKey(userId, guildId, cmd);
  const now = Date.now();
  let bucket = _rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + cfg.windowMs };
    _rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > cfg.max) {
    const remainingMs = Math.max(0, bucket.resetAt - now);
    log.warn(`rate-limit hit: user=${userId} cmd=${cmd} count=${bucket.count} resetIn=${Math.ceil(remainingMs/1000)}s`);
    return { limited: true, resetIn: Math.ceil(remainingMs / 1000) };
  }
  return { limited: false };
}

/**
 * Gate an entire interaction. Call before routing.
 * Returns truthy (reply already sent) if blocked, falsy to proceed.
 */
async function guardInteraction(interaction) {
  const userId = interaction.user?.id;
  const guildId = interaction.guildId;
  const cmd = interaction.commandName || interaction.customId || 'button';

  if (!userId || !guildId) return false;

  const rl = checkRateLimit(userId, guildId, cmd);
  if (rl.limited) {
    try {
      const msg = `⏳ Slow down — you are using this too fast. Try again in **${rl.resetIn}s**.`;
      if (!interaction.replied && !interaction.deferred) {
        if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
          await interaction.reply({ content: msg, flags: 64 }).catch(() => null);
        } else {
          await interaction.reply({ content: msg, flags: 64 }).catch(() => null);
        }
      }
    } catch {}
    return true; // blocked
  }

  return false; // proceed
}

// ── Input validation helpers ────────────────────────────────

const MAX_STRING_LENGTH = 2000;
const DANGEROUS_PATTERNS = [
  /javascript:/i,
  /<script/i,
  /data:text\/html/i,
  /on\w+\s*=/i, // inline event handlers
];

/**
 * Sanitize a string option value. Returns safe string or null.
 */
function sanitizeInput(value, opts = {}) {
  if (value == null) return null;
  let s = String(value).trim();
  if (s.length > (opts.maxLength || MAX_STRING_LENGTH)) {
    s = s.slice(0, opts.maxLength || MAX_STRING_LENGTH);
  }
  for (const rx of DANGEROUS_PATTERNS) {
    if (rx.test(s)) {
      log.warn(`sanitizeInput: rejected dangerous pattern in: ${s.slice(0, 80)}`);
      return null;
    }
  }
  return s;
}

/**
 * Validate a Discord snowflake ID.
 */
function isValidSnowflake(id) {
  return typeof id === 'string' && /^\d{15,20}$/.test(id);
}

/**
 * Validate a URL (must be https).
 */
function isValidHttpsUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Audit log ───────────────────────────────────────────────

const AUDIT_BUFFER = [];
const MAX_AUDIT_BUFFER = 500;

/**
 * Log a security-relevant action. Writes to DB if Prisma is available,
 * otherwise buffers in memory.
 */
async function auditLog({ action, userId, guildId, targetId, details, severity = 'info' }) {
  const entry = {
    action: String(action || 'unknown'),
    userId: userId ? String(userId) : null,
    guildId: guildId ? String(guildId) : null,
    targetId: targetId ? String(targetId) : null,
    details: details ? String(details).slice(0, 500) : null,
    severity: String(severity),
    timestamp: new Date(),
  };

  // Buffer in memory always (fast path for callers)
  AUDIT_BUFFER.push(entry);
  if (AUDIT_BUFFER.length > MAX_AUDIT_BUFFER) AUDIT_BUFFER.splice(0, AUDIT_BUFFER.length - MAX_AUDIT_BUFFER);

  // Persist to DB asynchronously
  prismaSafe(prisma => prisma.auditLog.create({ data: entry }), null).catch(() => null);

  if (severity === 'warn' || severity === 'critical') {
    log.warn(`[AUDIT] ${action} user=${userId} guild=${guildId} target=${targetId} — ${details}`);
  } else {
    log.info(`[AUDIT] ${action} user=${userId}`);
  }
}

/**
 * Return recent audit log entries (in-memory buffer).
 */
function getRecentAuditLog(limit = 50) {
  return AUDIT_BUFFER.slice(-limit).reverse();
}

// ── Permission guards ────────────────────────────────────────

/**
 * Check that the interaction member has at least one of the required permissions.
 * Returns { allowed: bool, reason: string }.
 */
function checkPermissions(member, requiredFlags = []) {
  if (!member) return { allowed: false, reason: 'No member context' };
  for (const flag of requiredFlags) {
    if (member.permissions?.has(flag)) return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Missing required Discord permission: ${requiredFlags.join(' or ')}`,
  };
}

/**
 * Log a permission denial with audit trail.
 */
async function denyWithAudit(interaction, reason) {
  const userId = interaction.user?.id;
  const guildId = interaction.guildId;
  const cmd = interaction.commandName || interaction.customId;
  await auditLog({ action: 'permission-denied', userId, guildId, details: `${cmd}: ${reason}`, severity: 'warn' });
  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: `❌ ${reason}`, flags: 64 }).catch(() => null);
  }
}

// ── Cleanup ─────────────────────────────────────────────────

// Purge expired rate limit buckets every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  let purged = 0;
  for (const [key, bucket] of _rateBuckets) {
    if (now >= bucket.resetAt) { _rateBuckets.delete(key); purged++; }
  }
  if (purged > 0) log.info(`rate limit GC: purged ${purged} expired bucket(s)`);
}, 5 * 60_000).unref?.();

module.exports = {
  guardInteraction,
  checkRateLimit,
  sanitizeInput,
  isValidSnowflake,
  isValidHttpsUrl,
  auditLog,
  getRecentAuditLog,
  checkPermissions,
  denyWithAudit,
};
