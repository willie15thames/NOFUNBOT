/*
 * NAVIGATION HEADER
 * FILE: src/services/contentScanService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * contentScanService.js
 * Audience-gated content scanning for all incoming messages.
 *
 * Tier rules:
 *   G / PG  → scan for BOTH hate speech AND curse words → silent delete + soft warn
 *   PG-13   → scan for hate speech only → silent delete + soft warn
 *   R       → scan for hard slurs only (hard block, no exceptions)
 */

const { makeLogger } = require('../utils/logger');
// Import from single source of truth — contentSafetyService owns these regexes
const { HARD_SLUR_RX, SOFT_SLUR_RX } = require('./contentSafetyService');
const log = makeLogger('contentScan');

// Hate speech patterns — blocked at PG-13 and below
const HATE_SPEECH_RX = /\b(?:all\s+(?:blacks?|whites?|jews?|muslims?|gays?|trans\w*|mexicans?|asians?|latinos?)\s+(?:are|should|must|deserve|need\s+to)|die\s+(?:fag|nigger|jew|tranny|spic)|(?:go\s+back\s+to|get\s+out\s+of)\s+\w+\s+(?:country|land)|white\s+(?:power|pride|supremac\w+)|gas\s+the|ethnic\s+cleansing|race\s+war|final\s+solution)\b/i;

// Curse words — blocked at PG and below
const CURSE_WORD_RX = /\b(?:fuck(?:ing|er|ed|s)?|shit(?:ting|ted|s)?|bitch(?:es|ing)?|ass(?:hole|es)?|damn(?:it)?|hell\b|crap|bastard|cock(?:sucker)?|pussy|dick(?:head)?|piss(?:ed)?|cunt)\b/i;

// SOFT_SLUR_RX imported from contentSafetyService (single source of truth — see line 14)

/**
 * Scan a message against the audience tier rules.
 * Returns { blocked: bool, reason: string, tier: string } | null
 */
function scanMessage(content, audienceRating = 'pg13') {
  const text = String(content || '');
  const tier = String(audienceRating || 'pg13').toLowerCase().trim();
  const isR   = tier === 'r';
  const isPG13 = tier === 'pg13';
  const isPGOrLower = ['g', 'pg'].includes(tier);

  // Always block hard slurs regardless of tier
  if (HARD_SLUR_RX.test(text)) {
    return { blocked: true, reason: 'hate_slur_hard', message: 'Hard slurs are blocked on this server.' };
  }

  // Soft slur blocked below R
  if (!isR && SOFT_SLUR_RX.test(text)) {
    return { blocked: true, reason: 'soft_slur', message: 'That language is blocked at this server\'s audience level.' };
  }

  // Hate speech blocked at PG-13 and below
  if (!isR && HATE_SPEECH_RX.test(text)) {
    return { blocked: true, reason: 'hate_speech', message: 'Hate speech is not allowed on this server.' };
  }

  // Curse words blocked at PG and below
  if (isPGOrLower && CURSE_WORD_RX.test(text)) {
    return { blocked: true, reason: 'curse_word', message: 'Profanity is not allowed at this server\'s audience rating (PG or lower).' };
  }

  return null;
}

/**
 * Handle a flagged message:
 * - Delete the message
 * - Send an ephemeral-style DM or channel reply to the member
 * Returns true if action taken
 */
async function enforceScan(message, audienceRating) {
  try {
    const result = scanMessage(message.content, audienceRating);
    if (!result) return false;

    log.info(`contentScan: blocked [${result.reason}] from ${message.author?.tag} (${audienceRating})`);

    // Delete the message
    if (message.deletable) {
      await message.delete().catch(() => null);
    }

    // Notify the member with a short DM (non-disruptive)
    await message.author?.send(
      `Your message in **${message.guild?.name}** was removed: ${result.message}`
    ).catch(() => null);

    return true;
  } catch (err) {
    log.warn('contentScan enforce failed:', err.message);
    return false;
  }
}

module.exports = { scanMessage, enforceScan, HARD_SLUR_RX, HATE_SPEECH_RX, CURSE_WORD_RX };
