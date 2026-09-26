/*
 * NAVIGATION HEADER
 * FILE: src/services/conversationContextService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const log = makeLogger('conversationCtx');

const MINUTE = 60 * 1000;
const MAX_ENTRIES = Math.max(4, Math.min(20, Number(process.env.BOT_CONTEXT_MAX_ENTRIES || 10) || 10));
const TTLS = {
  casual: Math.max(1, Number(process.env.BOT_CONTEXT_CASUAL_MINUTES || 10) || 10) * MINUTE,
  prompt: Math.max(1, Number(process.env.BOT_CONTEXT_PROMPT_MINUTES || 5) || 5) * MINUTE,
  action: Math.max(1, Number(process.env.BOT_CONTEXT_ACTION_MINUTES || 5) || 5) * MINUTE,
};
const FOLLOW_UP_RX = /\b(continue|keep going|finish|more|again|same|that one|do that|do it|what about that|next|and then|keep it going|pick up where we left off)\b/i;
const ACTION_RX = /\b(?:set|create|delete|remove|update|change|rename|build|reset|wipe|trash|start|stop|open|close|lock|unlock|post|send|refresh|free|release|assign|configure|advance|apply|turn|make|add|drop|ban|unban|warn|kick|boot|clear|rebuild|initialize|publish|sync|import|export|list)\b/i;
const PROMPT_RX = /(^|\b)(what|when|where|who|why|how|which|can i|can you|do i|is there|are there|tell me|show me|help|rules|schedule|teams|open teams|available teams|what are|what's|whats|give me|explain|lookup|check|status)(\b|\?)/i;

const _sessions = new Map();
let _sweeper = null;

function ttlFor(lane = 'casual') {
  return TTLS[lane] || TTLS.casual;
}

function ttlLabel(lane = 'casual') {
  return `${Math.round(ttlFor(lane) / MINUTE)} minute${Math.round(ttlFor(lane) / MINUTE) === 1 ? '' : 's'}`;
}

function normalizeLane(lane) {
  const val = String(lane || '').toLowerCase();
  return ['casual', 'prompt', 'action'].includes(val) ? val : 'casual';
}

function sessionKey(meta = {}, lane = 'casual') {
  const guildId = String(meta.guildId || 'dm');
  const channelId = String(meta.channelId || 'unknown-channel');
  const userId = String(meta.userId || 'unknown-user');
  const scope = String(meta.scope || 'member');
  return `${scope}:${guildId}:${channelId}:${userId}:${normalizeLane(lane)}`;
}

function getActiveLanes(meta = {}, now = Date.now()) {
  pruneExpired(now);
  const scope = String(meta.scope || 'member');
  const guildId = String(meta.guildId || 'dm');
  const channelId = String(meta.channelId || 'unknown-channel');
  const userId = String(meta.userId || 'unknown-user');
  const matches = [];
  for (const [key, session] of _sessions.entries()) {
    if (session.scope !== scope || session.guildId !== guildId || session.channelId !== channelId || session.userId !== userId) continue;
    matches.push({ key, lane: session.lane, lastTouchedAt: session.lastTouchedAt, expiresAt: session.expiresAt });
  }
  return matches.sort((a, b) => b.lastTouchedAt - a.lastTouchedAt);
}

function detectLane(text, meta = {}) {
  const raw = String(text || '').replace(/<@!?\d+>/g, ' ').replace(/\s+/g, ' ').trim();
  const normalized = raw.toLowerCase();
  if (!normalized) return 'casual';

  if (FOLLOW_UP_RX.test(normalized)) {
    const active = getActiveLanes(meta);
    if (active.length) return active[0].lane;
  }

  if (ACTION_RX.test(normalized)) {
    if (/\?|\bwhat\b|\bwhich\b|\bshow me\b|\blist\b|\blookup\b|\bstatus\b/i.test(normalized)) return 'prompt';
    return 'action';
  }

  if (PROMPT_RX.test(normalized) || /\?$/.test(normalized)) return 'prompt';
  return 'casual';
}

function ensureSession(meta = {}, lane = 'casual', now = Date.now()) {
  const normalizedLane = normalizeLane(lane);
  const key = sessionKey(meta, normalizedLane);
  let session = _sessions.get(key);
  const ttl = ttlFor(normalizedLane);
  if (!session || now > session.expiresAt) {
    session = {
      key,
      lane: normalizedLane,
      scope: String(meta.scope || 'member'),
      guildId: String(meta.guildId || 'dm'),
      channelId: String(meta.channelId || 'unknown-channel'),
      userId: String(meta.userId || 'unknown-user'),
      createdAt: now,
      lastTouchedAt: now,
      expiresAt: now + ttl,
      entries: [],
    };
    _sessions.set(key, session);
  } else {
    session.lastTouchedAt = now;
    session.expiresAt = now + ttl;
  }
  return session;
}

function append(meta = {}, lane = 'casual', role = 'user', content = '', now = Date.now()) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const session = ensureSession(meta, lane, now);
  session.entries.push({ role: role === 'assistant' ? 'assistant' : 'user', content: text.slice(0, 2000), timestamp: now });
  while (session.entries.length > MAX_ENTRIES) session.entries.shift();
  session.lastTouchedAt = now;
  session.expiresAt = now + ttlFor(session.lane);
  return session.entries.slice();
}

function getHistory(meta = {}, lane = 'casual', now = Date.now()) {
  const key = sessionKey(meta, lane);
  const session = _sessions.get(key);
  if (!session) return [];
  if (now > session.expiresAt) {
    _sessions.delete(key);
    return [];
  }
  session.lastTouchedAt = now;
  session.expiresAt = now + ttlFor(session.lane);
  return session.entries.slice();
}

function getSessionState(meta = {}, lane = 'casual', now = Date.now()) {
  const key = sessionKey(meta, lane);
  const session = _sessions.get(key);
  if (!session || now > session.expiresAt) return null;
  return {
    lane: session.lane,
    ttlMs: ttlFor(session.lane),
    expiresInMs: Math.max(0, session.expiresAt - now),
    count: session.entries.length,
    lastTouchedAt: session.lastTouchedAt,
  };
}

function clear(meta = {}, lane) {
  if (lane) {
    _sessions.delete(sessionKey(meta, lane));
    return 1;
  }
  let removed = 0;
  for (const item of getActiveLanes(meta)) {
    if (_sessions.delete(item.key)) removed += 1;
  }
  return removed;
}

function clearAll() {
  const count = _sessions.size;
  _sessions.clear();
  return count;
}

function pruneExpired(now = Date.now()) {
  let removed = 0;
  for (const [key, session] of _sessions.entries()) {
    if (now > session.expiresAt) {
      _sessions.delete(key);
      removed += 1;
    }
  }
  return removed;
}

function startSweeper(intervalMs = 60 * 1000) {
  if (_sweeper) return _sweeper;
  _sweeper = setInterval(() => {
    const removed = pruneExpired();
    if (removed) log.debug(`Cleared ${removed} expired conversation sessions.`);
  }, Math.max(15 * 1000, intervalMs));
  if (typeof _sweeper.unref === 'function') _sweeper.unref();
  return _sweeper;
}

function stopSweeper() {
  if (_sweeper) clearInterval(_sweeper);
  _sweeper = null;
}

module.exports = {
  TTLS,
  ttlFor,
  ttlLabel,
  detectLane,
  append,
  getHistory,
  getSessionState,
  getActiveLanes,
  clear,
  clearAll,
  pruneExpired,
  startSweeper,
  stopSweeper,
};
