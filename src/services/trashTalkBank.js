/*
 * NAVIGATION HEADER
 * FILE: src/services/trashTalkBank.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
// src/services/trashTalkBank.js
// Optional culture-learning bank. Disabled by default in v204.7; only explicit opt-in may persist derived chat data:
//   - Slang and phrases members use with each other
//   - Nicknames players give each other
//   - Inside jokes and recurring bits
//   - What roasts actually landed (got emoji reactions or replies)
// Caps at 100 entries per category so it never bloats.
// Gets injected into SLJ persona prompts to make roasts feel personal.

const { makeLogger }        = require('../utils/logger');
const { saveJsonDebounced, loadJson } = require('../storage/jsonStore');
const { isSafeToPersist, filterSafeTextList } = require('./contentSafetyService');
const log = makeLogger('trashBank');

const BANK_CAP     = 100;  // max entries per bucket
const LEARN_EVERY  = 6;    // run extraction every N messages per channel
const REACTION_MIN = 2;    // min emoji reactions for a message to count as a "gold roast"

function isEnabled() { return String(process.env.ENABLE_TRASH_TALK_LEARNING || '').toLowerCase() === 'true'; }

// ── In-memory bank ────────────────────────────────────────────
let _bank = {
  // Global league culture: phrases, slang, inside jokes the whole server uses
  // Array of { text, source, timestamp }
  culture: [],

  // Per-player learned data: key = userId
  // { userId, displayName, phrases: string[], nicknames: string[], style: string, lastUpdated }
  players: {},

  // Gold roasts — messages that got strong reactions
  // { text, authorId, targetId, reactions, timestamp }
  goldRoasts: [],

  // Message counters per channel to throttle AI extraction
  channelCounts: {},
};

// ── Persistence ───────────────────────────────────────────────
function load() {
  if (!isEnabled()) return;
  const saved = loadJson('trashTalkBank.json', null);
  if (saved) {
    _bank.culture    = saved.culture    || [];
    _bank.players    = saved.players    || {};
    _bank.goldRoasts = saved.goldRoasts || [];
    log.info(`Trash talk bank loaded: ${_bank.culture.length} culture entries, ${Object.keys(_bank.players).length} players, ${_bank.goldRoasts.length} gold roasts.`);
  }
}

function save() {
  if (!isEnabled()) return;
  const toSave = { culture: _bank.culture, players: _bank.players, goldRoasts: _bank.goldRoasts };
  saveJsonDebounced('trashTalkBank.json', toSave, 5000);
}

function _cap(arr, max = BANK_CAP) {
  if (arr.length > max) arr.splice(0, arr.length - max);
}

// ── Add entries ───────────────────────────────────────────────
function addCulture(text, source) {
  if (!isEnabled()) return;
  if (!text || text.length < 3) return;
  if (!isSafeToPersist(text)) return;
  // Deduplicate
  if (_bank.culture.some(e => e.text.toLowerCase() === text.toLowerCase())) return;
  _bank.culture.push({ text, source, timestamp: Date.now() });
  _cap(_bank.culture);
  save();
}

function addPlayerData(userId, displayName, data) {
  if (!isEnabled()) return;
  if (!_bank.players[userId]) {
    _bank.players[userId] = { userId, displayName, phrases: [], nicknames: [], style: '', lastUpdated: 0 };
  }
  const p = _bank.players[userId];
  p.displayName = displayName || p.displayName;
  if (data.phrases) {
    for (const ph of filterSafeTextList(data.phrases)) {
      if (!p.phrases.includes(ph)) p.phrases.push(ph);
    }
    _cap(p.phrases);
  }
  if (data.nicknames) {
    for (const n of filterSafeTextList(data.nicknames)) {
      if (!p.nicknames.includes(n)) p.nicknames.push(n);
    }
    _cap(p.nicknames);
  }
  if (data.style && isSafeToPersist(data.style)) p.style = data.style;
  p.lastUpdated = Date.now();
  save();
}

function addGoldRoast(text, authorId, targetId, reactionCount) {
  if (!isEnabled()) return;
  if (!isSafeToPersist(text)) return;
  _bank.goldRoasts.push({ text, authorId, targetId, reactions: reactionCount, timestamp: Date.now() });
  _bank.goldRoasts.sort((a, b) => b.reactions - a.reactions); // best first
  _cap(_bank.goldRoasts, 50);
  save();
}

// ── Build context string for AI prompt injection ──────────────
function buildContext(targetUserId = null, opponentUserId = null) {
  if (!isEnabled()) return null;
  const lines = [];

  // Gold roasts (top 5 that landed)
  if (_bank.goldRoasts.length) {
    lines.push('ROASTS THAT LANDED HARD (use these as style reference):');
    _bank.goldRoasts.slice(0, 5).forEach(r => lines.push(`  "${r.text}" (${r.reactions} reactions)`));
  }

  // Target player data
  if (targetUserId && _bank.players[targetUserId]) {
    const p = _bank.players[targetUserId];
    if (p.phrases?.length)   lines.push(`${p.displayName || 'Target'} says: ${p.phrases.slice(0, 6).join(', ')}`);
    if (p.nicknames?.length) lines.push(`Their nicknames: ${p.nicknames.slice(0, 4).join(', ')}`);
    if (p.style)             lines.push(`Their vibe: ${p.style}`);
  }

  // Opponent player data
  if (opponentUserId && _bank.players[opponentUserId] && opponentUserId !== targetUserId) {
    const p = _bank.players[opponentUserId];
    if (p.phrases?.length)   lines.push(`Opponent (${p.displayName || 'Opponent'}) says: ${p.phrases.slice(0, 4).join(', ')}`);
    if (p.nicknames?.length) lines.push(`Opponent nicknames: ${p.nicknames.slice(0, 3).join(', ')}`);
  }

  // League culture slang (last 10)
  if (_bank.culture.length) {
    lines.push('League slang and inside jokes:');
    _bank.culture.slice(-10).forEach(e => lines.push(`  "${e.text}"`));
  }

  return lines.join('\n') || null;
}

// ── Stats ─────────────────────────────────────────────────────
function getStats() {
  return {
    culture:    _bank.culture.length,
    players:    Object.keys(_bank.players).length,
    goldRoasts: _bank.goldRoasts.length,
    capRemaining: BANK_CAP - Math.max(_bank.culture.length, _bank.goldRoasts.length),
  };
}

// Staff channels that should never feed the trash bank
const STAFF_CHANNELS = new Set([
  'commissioner-ai', 'commish-hub', 'admin-hq', 'setup-wizard',
  'patch-notes', 'warnings-log', 'boot-log', 'scoresheets',
]);

// ── Passive learning from messages ────────────────────────────
// Called on every message — throttled internally per channel
async function learnFromMessage(message, aiCall, MODELS) {
  if (!isEnabled()) return;
  if (message.author.bot) return;
  if (!message.content || message.content.length < 5) return;
  // Never learn from staff/admin lanes — keeps commissioner ops private
  const chName = String(message.channel?.name || '').toLowerCase().replace(/^[^a-z0-9]+/, '');
  if (STAFF_CHANNELS.has(chName)) return;

  const chId = message.channel.id;
  _bank.channelCounts[chId] = (_bank.channelCounts[chId] || 0) + 1;
  if (_bank.channelCounts[chId] % LEARN_EVERY !== 0) return; // throttle

  // Skip very short messages or pure links
  const text = message.content.trim();
  if (text.length < 10 || /^https?:\/\//.test(text)) return;

  try {
    const res = await aiCall({
      model: MODELS.FAST,
      max_tokens: 250,
      messages: [{
        role: 'user',
        content: `You are passively learning how this Discord sports league talks.
Extract from this message ONLY what's genuinely interesting for future trash talk personalization.
Return ONLY raw JSON or null if nothing interesting:
{
  "culture": ["phrase or slang worth remembering"] or [],
  "playerPhrase": "memorable thing this specific person said" or null,
  "playerStyle": "one-phrase description of their vibe" or null,
  "nicknameFor": "any nickname they gave someone" or null
}

Author: ${message.author.username} (${message.author.id})
Message: "${text.slice(0, 300)}"

Be selective — only extract genuinely interesting slang, inside jokes, trash talk patterns, or nicknames. Skip generic filler.`,
      }],
    });

    const raw    = res.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
    if (raw === 'null' || !raw.startsWith('{')) return;
    const parsed = JSON.parse(raw);

    if (parsed.culture?.length) {
      for (const c of filterSafeTextList(parsed.culture)) addCulture(c, message.author.username);
    }
    if (parsed.playerPhrase || parsed.playerStyle || parsed.nicknameFor) {
      addPlayerData(message.author.id, message.author.username, {
        phrases:   parsed.playerPhrase ? [parsed.playerPhrase] : [],
        nicknames: parsed.nicknameFor  ? [parsed.nicknameFor]  : [],
        style:     parsed.playerStyle  || '',
      });
    }
  } catch {
    // Silent — learning failures are non-fatal
  }
}

// ── Gold roast detection (messageReactionAdd) ─────────────────
async function checkGoldRoast(reaction, user) {
  if (!isEnabled()) return;
  if (user.bot) return;
  const msg = reaction.message;
  if (msg.author.bot) return;
  if (!msg.content) return;

  // Count total reactions on this message
  const totalReactions = msg.reactions.cache.reduce((sum, r) => sum + r.count, 0);
  if (totalReactions < REACTION_MIN) return;

  // Check if we already logged it
  const alreadyLogged = _bank.goldRoasts.some(r =>
    r.text === msg.content.slice(0, 200) &&
    r.authorId === msg.author.id
  );
  if (alreadyLogged) return;

  addGoldRoast(msg.content.slice(0, 200), msg.author.id, null, totalReactions);
  log.debug(`Gold roast logged from ${msg.author.username} (${totalReactions} reactions)`);
}

module.exports = { isEnabled,
  load,
  save,
  buildContext,
  getStats,
  learnFromMessage,
  checkGoldRoast,
  addCulture,
  addPlayerData,
  addGoldRoast,
  BANK_CAP,
};
