/*
 * NAVIGATION HEADER
 * FILE: src/services/ambientConversationService.js
 * LAYER: Service layer
 * PURPOSE: Passive, short-lived channel awareness. Records ordinary human conversation WITHOUT causing a reply
 *          or AI call. Recent context is only surfaced when the bot is later explicitly @mentioned.
 * PRIVACY / SAFETY: memory-only, channel-local, TTL-bound, no DMs, no bots/webhooks, no persistence.
 */
'use strict';

const { makeLogger } = require('../utils/logger');
const log = makeLogger('ambientConversation');

const MINUTE = 60 * 1000;
const TTL_MS = Math.max(5, Math.min(120, Number(process.env.BOT_AMBIENT_CONTEXT_MINUTES || 30) || 30)) * MINUTE;
const MAX_MESSAGES = Math.max(8, Math.min(80, Number(process.env.BOT_AMBIENT_CONTEXT_MAX_MESSAGES || 32) || 32));
const MAX_CHARS_PER_MESSAGE = Math.max(80, Math.min(600, Number(process.env.BOT_AMBIENT_CONTEXT_MESSAGE_CHARS || 280) || 280));
const MAX_RENDER_CHARS = Math.max(500, Math.min(6000, Number(process.env.BOT_AMBIENT_CONTEXT_RENDER_CHARS || 2600) || 2600));

// Operational / sensitive channels should not become conversational context by default.
const DEFAULT_EXCLUDED_CHANNEL_RX = /(?:^|[-_])(audit|mod[-_]?log|logs?|it[-_]?ops|setup[-_]?wizard|security|incidents?|appeals?)(?:$|[-_])/i;
const MAX_CHANNEL_BUCKETS = Math.max(50, Math.min(2000, Number(process.env.BOT_AMBIENT_CONTEXT_MAX_CHANNELS || 500) || 500));
const _channels = new Map();
function _csvIds(name){ return new Set(String(process.env[name] || '').split(',').map(x=>x.trim()).filter(Boolean)); }
function _channelPolicy(){ return { allow:_csvIds('BOT_AMBIENT_CHANNEL_ALLOWLIST'), deny:_csvIds('BOT_AMBIENT_CHANNEL_DENYLIST') }; }

function _key(guildId, channelId) { return `${String(guildId)}:${String(channelId)}`; }
function _clean(text) {
  return String(text || '')
    .replace(/<@!?\d+>/g, '@member')
    .replace(/<@&\d+>/g, '@role')
    .replace(/<#\d+>/g, '#channel')
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/\b(?:api[_ -]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi, '[secret redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS_PER_MESSAGE);
}
function _excluded(message) {
  if (!message?.guild || !message?.channel?.id) return true;
  if (message.author?.bot || message.webhookId) return true;
  const id = String(message.channel.id);
  const policy = _channelPolicy();
  if (policy.deny.has(id)) return true;
  if (policy.allow.size && !policy.allow.has(id)) return true;
  try { if (require('./channelTopologyService').isStaffRepairChannel(message.channel)) return true; } catch {}
  const name = String(message.channel?.name || '');
  if (DEFAULT_EXCLUDED_CHANNEL_RX.test(name)) return true;
  return false;
}
function prune(now = Date.now()) {
  let removed = 0;
  for (const [key, bucket] of _channels.entries()) {
    bucket.entries = bucket.entries.filter(e => now - e.at <= TTL_MS);
    if (!bucket.entries.length) { _channels.delete(key); removed++; }
  }
  return removed;
}
function observe(message, now = Date.now()) {
  if (_excluded(message)) return { observed: false, reason: 'excluded' };
  const text = _clean(message.content);
  if (!text) return { observed: false, reason: 'empty' };
  prune(now);
  const key = _key(message.guild.id, message.channel.id);
  if (!_channels.has(key) && _channels.size >= MAX_CHANNEL_BUCKETS) _channels.delete(_channels.keys().next().value);
  const bucket = _channels.get(key) || { guildId: String(message.guild.id), channelId: String(message.channel.id), entries: [] };
  bucket.entries.push({
    messageId: String(message.id || ''),
    at: now,
    userId: String(message.author?.id || ''),
    display: String(message.member?.displayName || message.author?.globalName || message.author?.username || 'member').slice(0, 80),
    text,
    explicitlyMentionedBot: !!message.mentions?.users?.has?.(message.client?.user?.id),
  });
  while (bucket.entries.length > MAX_MESSAGES) bucket.entries.shift();
  _channels.set(key, bucket);
  return { observed: true, count: bucket.entries.length };
}
function getRecent(meta = {}, options = {}, now = Date.now()) {
  prune(now);
  const bucket = _channels.get(_key(meta.guildId, meta.channelId));
  if (!bucket) return [];
  const excludeMessageId = options.excludeMessageId ? String(options.excludeMessageId) : null;
  const max = Math.max(1, Math.min(MAX_MESSAGES, Number(options.max || 16) || 16));
  const includeBotMentions = options.includeBotMentions === true;
  let eligible = bucket.entries.filter(e => includeBotMentions || !e.explicitlyMentionedBot);
  if (excludeMessageId) eligible = eligible.filter(e => String(e.messageId || '') !== excludeMessageId);
  return eligible.slice(-max).map(e => ({ ...e }));
}
function renderForPrompt(meta = {}, options = {}, now = Date.now()) {
  const rows = getRecent(meta, options, now);
  if (!rows.length) return 'none';
  let out = rows.map(e => `${e.display}: ${e.text}`).join('\n');
  if (out.length > MAX_RENDER_CHARS) out = out.slice(out.length - MAX_RENDER_CHARS);
  return out;
}

function updateMessage(message, now = Date.now()) {
  if (!message?.guild || !message?.channel?.id || !message?.id) return { updated:false, reason:'invalid' };
  const bucket = _channels.get(_key(message.guild.id, message.channel.id));
  if (!bucket) return { updated:false, reason:'not-observed' };
  const idx = bucket.entries.findIndex(e => String(e.messageId) === String(message.id));
  if (idx === -1) return { updated:false, reason:'not-observed' };
  if (_excluded(message)) { bucket.entries.splice(idx,1); return { updated:true, removed:true }; }
  const text = _clean(message.content);
  if (!text) { bucket.entries.splice(idx,1); return { updated:true, removed:true }; }
  bucket.entries[idx] = { ...bucket.entries[idx], at: now, text, display: String(message.member?.displayName || message.author?.globalName || message.author?.username || bucket.entries[idx].display || 'member').slice(0,80), explicitlyMentionedBot: !!message.mentions?.users?.has?.(message.client?.user?.id) };
  return { updated:true };
}
function removeMessage(message) {
  if (!message?.guild?.id || !message?.channel?.id || !message?.id) return false;
  const key = _key(message.guild.id, message.channel.id);
  const bucket = _channels.get(key); if (!bucket) return false;
  const before = bucket.entries.length;
  bucket.entries = bucket.entries.filter(e => String(e.messageId) !== String(message.id));
  if (!bucket.entries.length) _channels.delete(key);
  return bucket.entries.length !== before;
}

function clearChannel(guildId, channelId) { return _channels.delete(_key(guildId, channelId)); }
function clearAll() { const n = _channels.size; _channels.clear(); return n; }
function stats() { prune(); const p=_channelPolicy(); return { channels:_channels.size, ttlMs:TTL_MS, maxMessages:MAX_MESSAGES, allowlistCount:p.allow.size, denylistCount:p.deny.size }; }

const _timer = setInterval(() => { const n = prune(); if (n) log.debug(`pruned ${n} ambient channel contexts`); }, 60 * 1000);
_timer.unref?.();

module.exports = { TTL_MS, MAX_MESSAGES, observe, updateMessage, removeMessage, getRecent, renderForPrompt, clearChannel, clearAll, prune, stats };
