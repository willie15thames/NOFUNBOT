/*
 * FILE: src/config/constants.js
 * PURPOSE: Single source of truth for all timing constants, cooldowns, TTLs,
 *          and default role names used across the bot.
 *          Import from here instead of hardcoding magic numbers in service files.
 * NOTE: V192 — introduced to eliminate scattered magic numbers.
 */

'use strict';

// ── Dedup / Claim TTLs (milliseconds) ────────────────────────
const DEDUP = Object.freeze({
  EVENT_CLAIM_TTL:        15_000,   // eventClaimService — per Discord event
  MESSAGE_ROUTE_TTL:      15_000,   // responseGuard — per message AI route claim
  MESSAGE_RESPONSE_TTL:   12_000,   // responseGuard — per message+scope response claim
  INTERACTION_EXEC_TTL:    8_000,   // responseGuard — per interaction execution claim
  INTERACTION_SETTLE_TTL: 15 * 60_000, // responseGuard — mark interaction fully settled
  SEND_FINGERPRINT_TTL:    4_000,   // sendMessageService — payload fingerprint dedup
  MEMBER_PROCESSED_TTL:   30_000,   // memberMentionHandler — per message dedup
  MEMBER_COOLDOWN_TTL:     3_000,   // memberMentionHandler — per user cooldown
  COMM_PROCESSED_TTL:     30_000,   // commissionerHandler — per message dedup
  IN_FLIGHT_TTL:          60_000,   // messageCreate in-flight lock
});

// ── Rate Limits ──────────────────────────────────────────────
const RATE_LIMITS = Object.freeze({
  USER_AI_WINDOW_MS:     5 * 60_000,    // commissioner AI — per-user rate window (5 min)
  USER_AI_MAX:           10,             // commissioner AI — max calls per user window
  GUILD_AI_WINDOW_MS:    24 * 60 * 60_000, // commissioner AI — guild-wide rate window (24h)
  GUILD_AI_MAX:          200,            // commissioner AI — max calls per guild window
});

// ── Periodic Timers ──────────────────────────────────────────
const TIMERS = Object.freeze({
  SELF_HEAL_INTERVAL_MS:     30 * 60_000,  // periodic self-heal sweep
  IDLE_GUIDE_INTERVAL_MS:     5 * 60_000,  // idle guide sweep
  IDLE_GUIDE_FIRST_MS:       30_000,       // first idle guide sweep after deferred boot
  DEFERRED_BOOT_DELAY_MS:    3_000,        // post-boot deferred work delay
  IDLE_GUIDE_WINDOW_MS:     15 * 60_000,   // how long a channel must be idle before guide posts
  ACTIVE_CHECK_INTERVAL_MS: 60 * 60_000,   // active check scheduler
});

// ── Spam Detection ───────────────────────────────────────────
const SPAM = Object.freeze({
  WINDOW_MS:   5_000,
  LIMIT:       5,
  MUTE_MS:     5 * 60_000,
  BAN_STRIKES: 3,
});

// ── AI Service ───────────────────────────────────────────────
const AI = Object.freeze({
  DEFAULT_TIMEOUT_MS:   22_000,
  MAX_RESPONSE_CAP:     500,
  MAX_RESPONSE_CAP_R:   900,  // R-rated audience gets higher cap
});

// ── Default Role Names ───────────────────────────────────────
// These are fallbacks when serverSettings doesn't specify custom names.
// Server settings fields: memberRoleName, commissionerRoleName
const ROLE_DEFAULTS = Object.freeze({
  MEMBER:        'Member',
  COMMISSIONER:  'Commissioner',
});

// ── Active Check ─────────────────────────────────────────────
const ACTIVE_CHECK = Object.freeze({
  INTERVAL_DAYS:          4,          // days between active checks
  RESPONSE_WINDOW_HOURS:  48,         // hours to respond before miss counted
  CONSECUTIVE_MISS_BOOT:  5,          // auto-boot after this many consecutive misses
  WARN_THRESHOLD:         3,          // escalate to commissioner after this many consecutive misses
});

module.exports = { DEDUP, RATE_LIMITS, TIMERS, SPAM, AI, ROLE_DEFAULTS, ACTIVE_CHECK };
