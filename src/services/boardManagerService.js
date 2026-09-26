/*
 * NAVIGATION HEADER
 * FILE: src/services/boardManagerService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */


'use strict';

const crypto = require('crypto');
const SUPPRESS_NOTIFICATIONS_FLAG = 1 << 12;
const { getBoard, setBoard, getHash, setHash } = require('./stateEngineService');

function normalizePayload(payload) {
  const cloned = JSON.parse(JSON.stringify(payload || {}));
  if (Array.isArray(cloned.embeds)) {
    for (const embed of cloned.embeds) {
      if (embed && typeof embed === 'object') {
        delete embed.timestamp;
      }
    }
  }
  return cloned;
}

function hashPayload(payload) {
  return crypto.createHash('sha1')
    .update(JSON.stringify(normalizePayload(payload)))
    .digest('hex');
}

async function defaultFetchMessageById(channel, messageId) {
  try {
    return await channel.messages.fetch(messageId);
  } catch {
    return null;
  }
}

async function upsertBoardMessage({ boardKey, channel, payload, fetchMessageById = defaultFetchMessageById }) {
  payload = { ...(payload || {}), flags: SUPPRESS_NOTIFICATIONS_FLAG };
  const nextHash = hashPayload(payload);
  const prevHash = getHash(boardKey);

  if (prevHash && prevHash === nextHash) {
    return { skipped: true, reason: 'unchanged' };
  }

  const existing = getBoard(boardKey);

  if (existing && existing.messageId) {
    try {
      const message = await fetchMessageById(channel, existing.messageId);
      if (message) {
        await message.edit(payload);
        setHash(boardKey, nextHash);
        setBoard(boardKey, { messageId: existing.messageId, channelId: channel.id });
        return { edited: true, messageId: existing.messageId };
      }
    } catch {
      // fall through to send a new message
    }
  }

  const sent = await channel.send(payload);
  setHash(boardKey, nextHash);
  setBoard(boardKey, { messageId: sent.id, channelId: channel.id });
  return { sent: true, messageId: sent.id };
}

module.exports = {
  normalizePayload,
  hashPayload,
  upsertBoardMessage,
};
