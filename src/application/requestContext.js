'use strict';
const { randomUUID } = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const storage = new AsyncLocalStorage();

function requiredString(name, value) {
  const v = String(value || '').trim();
  if (!v || ['default','current','global'].includes(v.toLowerCase())) {
    const err = new Error(`${name} must be a canonical non-placeholder id`);
    err.code = 'INVALID_CONTEXT';
    throw err;
  }
  return v;
}

function createRequestContext(input = {}) {
  return Object.freeze({
    guildId: requiredString('guildId', input.guildId),
    leagueId: input.leagueId == null ? null : requiredString('leagueId', input.leagueId),
    seasonId: input.seasonId == null ? null : requiredString('seasonId', input.seasonId),
    teamId: input.teamId == null ? null : requiredString('teamId', input.teamId),
    membershipId: input.membershipId == null ? null : requiredString('membershipId', input.membershipId),
    actorId: requiredString('actorId', input.actorId || 'system'),
    channelId: input.channelId ? String(input.channelId) : null,
    interactionId: input.interactionId ? String(input.interactionId) : null,
    correlationId: String(input.correlationId || randomUUID()),
  });
}

function run(input, fn) {
  const ctx = input && input.guildId && Object.isFrozen(input) ? input : createRequestContext(input);
  return storage.run(ctx, fn);
}
function current() { return storage.getStore() || null; }
function currentGuildId() { return current()?.guildId || null; }
function currentLeagueId() { return current()?.leagueId || null; }
function requireCurrent() {
  const ctx=current();
  if(!ctx){const err=new Error('trusted request context required');err.code='MISSING_REQUEST_CONTEXT';throw err;}
  return ctx;
}

module.exports = { createRequestContext, requiredString, run, current, currentGuildId, currentLeagueId, requireCurrent };
