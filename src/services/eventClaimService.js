/*
 * NAVIGATION HEADER
 * FILE: src/services/eventClaimService.js
 * LAYER: Service layer
 * PURPOSE: Handles event-driven execution or event-bus coordination.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

/**
 * eventClaimService.js
 *
 * Durable single-consumer gate for Discord events.
 * Goal:
 * - one Discord message/update/interaction should have one legal consumer globally
 * - support multi-instance deployments via Redis SET NX PX
 * - fall back to local acceptance when Redis is unavailable
 *
 * Notes:
 * - Claims are short-lived and auto-expire.
 * - A release path exists for interactions, but message/update claims normally
 *   rely on TTL because the event should only be consumed once.
 */

let RedisCtor = null;
try { RedisCtor = require('ioredis'); } catch {}

let redisClient = null;
let redisReady = false;
const localFallback = new Map();

function _now() {
  return Date.now();
}

function _ttl(ttlMs, fallback = 15000) {
  const n = Number(ttlMs);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1000, Math.floor(n));
}

function _sweepLocal() {
  const now = _now();
  for (const [key, exp] of localFallback.entries()) {
    if (!exp || exp <= now) localFallback.delete(key);
  }
}

function _claimLocal(key, ttlMs) {
  if (!key) return true;
  _sweepLocal();
  const exp = localFallback.get(key);
  const now = _now();
  if (exp && exp > now) return false;
  localFallback.set(key, now + _ttl(ttlMs));
  return true;
}

function _releaseLocal(key) {
  if (!key) return;
  localFallback.delete(key);
}

function getRedis() {
  if (!RedisCtor) return null;
  if (redisClient) return redisReady ? redisClient : null;

  const url = String(process.env.REDIS_URL || '').trim();
  if (!url) return null;

  try {
    redisClient = new RedisCtor(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    redisClient.on('ready', () => { redisReady = true; });
    redisClient.on('error', () => { redisReady = false; });
    redisClient.connect?.().catch(() => null);
  } catch {
    redisClient = null;
    redisReady = false;
    return null;
  }
  return redisReady ? redisClient : null;
}

function _recordClaim(type, data) {
  try { require('./observabilityService').recordClaimAttempt(type, data); } catch {}
}

async function claim(key, ttlMs = 15000) {
  if (!key) return true;
  const redis = getRedis();
  if (!redis) {
    const won = _claimLocal(key, ttlMs);
    _recordClaim(won ? 'claimed' : 'rejected', { key, source: 'local', eventType: _eventTypeFromKey(key) });
    return won;
  }
  try {
    const result = await redis.set(key, String(process.pid), 'PX', _ttl(ttlMs), 'NX');
    const won = result === 'OK';
    _recordClaim(won ? 'claimed' : 'rejected', { key, source: 'redis', eventType: _eventTypeFromKey(key) });
    return won;
  } catch {
    const won = _claimLocal(key, ttlMs);
    _recordClaim(won ? 'claimed' : 'rejected', { key, source: 'local-fallback', eventType: _eventTypeFromKey(key) });
    return won;
  }
}

function _eventTypeFromKey(key) {
  if (!key) return 'unknown';
  if (key.includes(':messageCreate:')) return 'messageCreate';
  if (key.includes(':messageUpdate:')) return 'messageUpdate';
  if (key.includes(':interaction:')) return 'interaction';
  if (key.includes(':aiResponse:')) return 'aiResponse';
  return 'unknown';
}

async function release(key) {
  if (!key) return;
  const redis = getRedis();
  if (!redis) return _releaseLocal(key);
  try {
    await redis.del(key);
  } catch {
    _releaseLocal(key);
  }
}

function messageCreateKey(message) {
  const gid = String(message?.guildId || message?.guild?.id || 'dm');
  const mid = String(message?.id || '');
  return mid ? `nofun:event:messageCreate:${gid}:${mid}` : null;
}

function messageUpdateKey(message) {
  const gid = String(message?.guildId || message?.guild?.id || 'dm');
  const mid = String(message?.id || '');
  return mid ? `nofun:event:messageUpdate:${gid}:${mid}` : null;
}

function interactionKey(interaction) {
  const gid = String(interaction?.guildId || interaction?.guild?.id || 'dm');
  const iid = String(interaction?.id || '');
  return iid ? `nofun:event:interaction:${gid}:${iid}` : null;
}


function aiResponseKey(message) {
  const gid = String(message?.guildId || message?.guild?.id || 'dm');
  const mid = String(message?.id || '');
  return mid ? `nofun:event:aiResponse:${gid}:${mid}` : null;
}


module.exports = {
  claim,
  release,
  messageCreateKey,
  messageUpdateKey,
  interactionKey,
  aiResponseKey,
};
