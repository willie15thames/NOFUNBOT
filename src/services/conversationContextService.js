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
const SHARED_MAX_ENTRIES = Math.max(8, Math.min(40, Number(process.env.BOT_SHARED_CONTEXT_MAX_ENTRIES || 20) || 20));
const SHARED_TTL_MS = Math.max(5, Math.min(120, Number(process.env.BOT_SHARED_CONTEXT_MINUTES || 30) || 30)) * MINUTE;
const TTLS = {
  casual: Math.max(1, Number(process.env.BOT_CONTEXT_CASUAL_MINUTES || 10) || 10) * MINUTE,
  prompt: Math.max(1, Number(process.env.BOT_CONTEXT_PROMPT_MINUTES || 5) || 5) * MINUTE,
  action: Math.max(1, Number(process.env.BOT_CONTEXT_ACTION_MINUTES || 5) || 5) * MINUTE,
};
const FOLLOW_UP_RX = /\b(continue|keep going|finish|more|again|same|that one|do that|do it|what about that|next|and then|keep it going|pick up where we left off)\b/i;
const ACTION_RX = /\b(?:set|create|delete|remove|update|change|rename|build|reset|wipe|trash|start|stop|open|close|lock|unlock|post|send|refresh|free|release|assign|configure|advance|apply|turn|make|add|drop|ban|unban|warn|kick|boot|clear|rebuild|initialize|publish|sync|import|export|list)\b/i;
const PROMPT_RX = /(^|\b)(what|when|where|who|why|how|which|can i|can you|do i|is there|are there|tell me|show me|help|rules|schedule|teams|open teams|available teams|what are|what's|whats|give me|explain|lookup|check|status)(\b|\?)/i;

const _sessions = new Map();
const _shared = new Map();
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


function sharedKey(meta = {}) {
  return `${String(meta.guildId || 'dm')}:${String(meta.channelId || 'unknown-channel')}`;
}

function appendShared(meta = {}, role = 'user', content = '', info = {}, now = Date.now()) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text || !meta.guildId || !meta.channelId) return [];
  const key = sharedKey(meta);
  const bucket = _shared.get(key) || { guildId:String(meta.guildId), channelId:String(meta.channelId), entries:[], expiresAt:now + SHARED_TTL_MS };
  const display = String(info.display || info.username || (role === 'assistant' ? 'Bot' : 'Member')).replace(/\s+/g,' ').trim().slice(0,80);
  bucket.entries.push({
    role: role === 'assistant' ? 'assistant' : 'user',
    content: text.slice(0, 2000),
    userId: info.userId ? String(info.userId) : null,
    display,
    messageId: info.messageId ? String(info.messageId) : null,
    replyToMessageId: info.replyToMessageId ? String(info.replyToMessageId) : null,
    isCommissioner: !!info.isCommissioner,
    timestamp: now,
  });
  while (bucket.entries.length > SHARED_MAX_ENTRIES) bucket.entries.shift();
  bucket.expiresAt = now + SHARED_TTL_MS;
  _shared.set(key, bucket);
  return bucket.entries.slice();
}

function getSharedHistory(meta = {}, now = Date.now()) {
  const key = sharedKey(meta);
  const bucket = _shared.get(key);
  if (!bucket) return [];
  if (now > bucket.expiresAt) { _shared.delete(key); return []; }
  bucket.expiresAt = now + SHARED_TTL_MS;
  return bucket.entries.slice();
}

function renderShared(meta = {}, options = {}, now = Date.now()) {
  let rows = getSharedHistory(meta, now);
  const excludeMessageId = options.excludeMessageId ? String(options.excludeMessageId) : null;
  if (excludeMessageId) rows = rows.filter(x => String(x.messageId || '') !== excludeMessageId);
  const max = Math.max(1, Math.min(SHARED_MAX_ENTRIES, Number(options.max || 12) || 12));
  return rows.slice(-max).map(e => `${e.role === 'assistant' ? 'Bot' : e.display}${e.isCommissioner ? ' [commissioner]' : ''}: ${e.content}`).join('\n') || 'none';
}

function clearGuild(guildId) {
  const gid = String(guildId || '');
  let removed = 0;
  for (const [key, session] of _sessions.entries()) if (session.guildId === gid) { _sessions.delete(key); removed++; }
  for (const [key, bucket] of _shared.entries()) if (bucket.guildId === gid) { _shared.delete(key); removed++; }
  return removed;
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
  const count = _sessions.size + _shared.size;
  _sessions.clear();
  _shared.clear();
  return count;
}

function pruneExpired(now = Date.now()) {
  let removed = 0;
  for (const [key, session] of _sessions.entries()) { if (now > session.expiresAt) { _sessions.delete(key); removed += 1; } }
  for (const [key, bucket] of _shared.entries()) { if (now > bucket.expiresAt) { _shared.delete(key); removed += 1; } }
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
  appendShared,
  getSharedHistory,
  renderShared,
  getHistory,
  getSessionState,
  getActiveLanes,
  clear,
  clearGuild,
  clearAll,
  pruneExpired,
  startSweeper,
  stopSweeper,
};
