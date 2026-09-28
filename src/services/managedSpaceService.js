'use strict';
const { randomUUID } = require('crypto');
const store = require('../storage/criticalStore');

// Only real live/pending spaces count against the 3-space limit.
// Failed repair/archiving/archived rows are operational history, not live capacity.
const COUNTED_STATUSES = new Set(['PREPARING', 'ACTIVE', 'PAUSED']);
const key = guildId => `v204:spaces:${guildId}`;
const STALE_PREPARING_MS = Math.max(5 * 60_000, Number(process.env.SPACE_PREPARING_TTL_MS || 30 * 60_000));
const _normalizeStatus = value => String(value || 'ACTIVE').trim().toUpperCase();

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

function _repair(data, guildId, now = Date.now()) {
  _archiveStalePreparing(data, now);
  const canonical = new Map(
    require('./activeLeagueService').listOperationalLeagues()
      .filter(x => !x.guildId || String(x.guildId) === String(guildId))
      .map(x => [String(x.id), x])
  );

  for (const item of Object.values(data.spaces || {})) {
    const status = _normalizeStatus(item.status);
    if (['REPAIR_REQUIRED', 'ARCHIVING', 'FAILED', 'DELETED', 'ARCHIVED'].includes(status)) continue;

    // ACTIVE/PAUSED managed rows must have a canonical active league/event record.
    // If the canonical registry has no matching record, the slot is a phantom left
    // by a failed or interrupted build and must never block a new setup.
    if (['ACTIVE', 'PAUSED'].includes(status) && !canonical.has(String(item.id))) {
      item.status = 'ARCHIVED';
      item.updatedAt = now;
      item.archiveReason = 'orphan-managed-space';
    }
  }
}

async function list(guildId) {
  let snapshot = [];
  await store.transact(key(guildId), { spaces: {} }, data => {
    _repair(data, guildId);
    snapshot = Object.values(data.spaces || {}).map(x => ({ ...x }));
    return null;
  });
  return snapshot;
}

async function reserve(guildId, input = {}) {
  if (!guildId || !String(input.name || '').trim()) throw new Error('Guild and space name are required');

  return store.transact(key(guildId), { spaces: {} }, data => {
    _repair(data, guildId);
    const spaces = Object.values(data.spaces || {});
    const occupied = spaces.filter(s => COUNTED_STATUSES.has(_normalizeStatus(s.status)));

    if (occupied.length >= 3) {
      const labels = occupied.map(s => `${s.name || s.id} (${_normalizeStatus(s.status)})`).join(', ');
      throw new Error(`This server already has three active or pending leagues/events: ${labels}. Erase, archive, or finish one first.`);
    }

    const requestedName = String(input.name).trim().toLowerCase();
    if (spaces.some(s => COUNTED_STATUSES.has(_normalizeStatus(s.status)) && String(s.name || '').toLowerCase() === requestedName)) {
      throw new Error('An active space already uses this name');
    }

    const item = {
      id: randomUUID(), guildId: String(guildId), kind: input.kind || 'league',
      name: String(input.name).trim(), status: 'PREPARING', createdAt: Date.now(), ...input,
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

async function clearGuild(guildId) {
  await store.clear(key(guildId));
  return true;
}

module.exports = {
  list, reserve, transition, clearGuild,
  COUNTED_STATUSES, STALE_PREPARING_MS,
  _normalizeStatus, _archiveStalePreparing, _repair,
};
