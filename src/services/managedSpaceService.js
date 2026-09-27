'use strict';
const { randomUUID } = require('crypto');
const store = require('../storage/criticalStore');

// Only usable or genuinely pending spaces consume the public three-space limit.
// ARCHIVING and REPAIR_REQUIRED are operational states, not active league slots.
const COUNTED_STATUSES = new Set(['PREPARING', 'ACTIVE', 'PAUSED']);
const key = guildId => `v204:spaces:${guildId}`;
const STALE_PREPARING_MS = Math.max(5 * 60_000, Number(process.env.SPACE_PREPARING_TTL_MS || 30 * 60_000));

async function list(guildId) {
  return Object.values((await store.read(key(guildId), { spaces: {} })).spaces);
}

function _normalizeStatus(value) {
  return String(value || 'ACTIVE').trim().toUpperCase();
}

function _archiveStalePreparing(data, now = Date.now()) {
  for (const item of Object.values(data.spaces || {})) {
    if (_normalizeStatus(item.status) !== 'PREPARING') continue;
    const created = Number(item.createdAt || item.updatedAt || 0);
    if (!created || now - created <= STALE_PREPARING_MS) continue;
    item.status = 'ARCHIVED';
    item.updatedAt = now;
    item.archiveReason = 'stale-preparing-reservation';
  }
}

async function reserve(guildId, input = {}) {
  if (!guildId || !String(input.name || '').trim()) throw new Error('Guild and space name are required');

  return store.transact(key(guildId), { spaces: {} }, data => {
    _archiveStalePreparing(data);

    // Adopt legacy usable league records once. Do not resurrect archived,
    // archiving, failed-repair, or deleted records as ACTIVE.
    for (const old of require('./activeLeagueService').listActiveLeagues()) {
      if (old.guildId && old.guildId !== guildId) continue;
      const oldStatus = _normalizeStatus(old.status);
      if (['ARCHIVING', 'ARCHIVED', 'DELETED', 'REPAIR_REQUIRED', 'FAILED'].includes(oldStatus)) continue;
      if (!data.spaces[old.id]) {
        data.spaces[old.id] = {
          ...old,
          name: old.leagueName,
          guildId,
          kind: old.kind || 'league',
          status: oldStatus === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
        };
      }
    }

    const spaces = Object.values(data.spaces);
    const occupied = spaces.filter(s => COUNTED_STATUSES.has(_normalizeStatus(s.status)));
    if (occupied.length >= 3) {
      const labels = occupied.map(s => `${s.name || s.id} (${_normalizeStatus(s.status)})`).join(', ');
      throw new Error(`This server already has three active or pending leagues/events: ${labels}. Erase, archive, or finish one first.`);
    }

    const requestedName = input.name.trim().toLowerCase();
    if (spaces.some(s => COUNTED_STATUSES.has(_normalizeStatus(s.status)) && String(s.name || '').toLowerCase() === requestedName)) {
      throw new Error('An active space already uses this name');
    }

    const item = {
      id: randomUUID(),
      guildId,
      kind: input.kind || 'league',
      name: input.name.trim(),
      status: 'PREPARING',
      createdAt: Date.now(),
      ...input,
    };
    data.spaces[item.id] = item;
    return item;
  });
}

async function transition(guildId, id, status, patch = {}) {
  return store.transact(key(guildId), { spaces: {} }, data => {
    const item = data.spaces[id];
    if (!item) throw new Error('Space reservation not found');
    Object.assign(item, patch, { status, updatedAt: Date.now() });
    return item;
  });
}

module.exports = {
  list,
  reserve,
  transition,
  COUNTED_STATUSES,
  STALE_PREPARING_MS,
  _archiveStalePreparing,
};
