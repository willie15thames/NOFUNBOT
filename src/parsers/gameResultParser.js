/*
 * NAVIGATION HEADER
 * FILE: src/parsers/gameResultParser.js
 * LAYER: Parsing and transformation layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * gameResultParser.js
 *
 * Extracted from index.js (TODO resolved — Build Map Phase 1).
 * Handles routing of messages inside active game channels:
 *   - Delegates to gameChannelService for full game channel message logic
 *   - Called from the messageCreate handler in index.js
 *
 * Keeping this as a thin router so gameChannelService owns all business logic.
 */

const { makeLogger } = require('../utils/logger');
const log = makeLogger('gameResultParser');

/**
 * Route a message from inside an active game channel.
 * Returns true if the message was handled, false otherwise.
 *
 * @param {import('discord.js').Message} message
 * @param {{ state: object, getCh: Function }} ctx
 */
async function handleGameChannelMessage(message, { state, getCh } = {}) {
  if (!message.guild || !message.channel) return false;

  const game = state?.games?.get(message.channel.id);
  if (!game) return false;

  try {
    const gameChannelService = require('../services/gameChannelService');
    await gameChannelService.handleGameChannelMessage(message);
    return true;
  } catch (err) {
    log.warn('gameChannelMessage handler failed:', err.message);
    return false;
  }
}

/**
 * Check whether the current channel is an active game channel.
 *
 * @param {string} channelId
 * @param {object} state
 */
function isGameChannel(channelId, state) {
  return !!(state?.games?.has(channelId));
}

module.exports = { handleGameChannelMessage, isGameChannel };
