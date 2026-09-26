/*
 * NAVIGATION HEADER
 * FILE: src/actions/confirmationService.js
 * LAYER: AI action layer (V202, directive rule 31, audit §28 "confirmation")
 * PURPOSE: Application-enforced confirmation state for destructive AI actions. A plan that needs confirmation is
 *          stored here under an unguessable token; ONLY the original requester pressing the Confirm button (routed
 *          by interactionRouter, which re-checks commissioner authorization) can execute it, exactly once, within
 *          the TTL. Prose such as "yes, do it" never executes anything.
 * LOOK HERE FIRST WHEN DEBUGGING: create(), consume(), cancel().
 * NOTE: Map is a TTL guard (rule 17): swept every minute + max-size cap. Pending confirmations are intentionally
 *       ephemeral — after a restart the commissioner simply asks again (no destructive action is lost or replayed).
 */

'use strict';

const { randomBytes } = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 200;
const _pending = new Map(); // token → { guildId, channelId, requesterId, actions, summary, createdAt, expiresAt }

function _sweep(now = Date.now()) {
  for (const [token, entry] of _pending) if (entry.expiresAt <= now) _pending.delete(token);
  while (_pending.size > MAX_PENDING) _pending.delete(_pending.keys().next().value);
}
setInterval(() => _sweep(), 60 * 1000).unref?.();

function create({ guildId, channelId, requesterId, actions, summary }) {
  _sweep();
  const token = randomBytes(12).toString('hex');
  const now = Date.now();
  _pending.set(token, { guildId: String(guildId || ''), channelId: String(channelId || ''), requesterId: String(requesterId || ''), actions: actions || [], summary: summary || '', createdAt: now, expiresAt: now + TTL_MS });
  return { token, expiresAt: now + TTL_MS };
}

/** Consume exactly once. @returns {{ok:true, entry}|{ok:false, reason:'not-found'|'expired'|'wrong-user'|'wrong-guild'}} */
function consume(token, userId, guildId) {
  const entry = _pending.get(String(token || ''));
  if (!entry) return { ok: false, reason: 'not-found' };
  if (entry.expiresAt <= Date.now()) { _pending.delete(token); return { ok: false, reason: 'expired' }; }
  if (guildId && entry.guildId && entry.guildId !== String(guildId)) return { ok: false, reason: 'wrong-guild' };
  if (entry.requesterId !== String(userId || '')) return { ok: false, reason: 'wrong-user' };
  _pending.delete(token);
  return { ok: true, entry };
}

function cancel(token, userId) {
  const entry = _pending.get(String(token || ''));
  if (!entry) return { ok: false, reason: 'not-found' };
  if (entry.requesterId !== String(userId || '')) return { ok: false, reason: 'wrong-user' };
  _pending.delete(token);
  return { ok: true };
}

function size() { _sweep(); return _pending.size; }

module.exports = { TTL_MS, MAX_PENDING, create, consume, cancel, size };
