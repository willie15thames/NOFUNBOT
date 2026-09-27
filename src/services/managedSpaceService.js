'use strict';
const { randomUUID } = require('crypto');
const store = require('../storage/criticalStore');
const counted = new Set(['PREPARING', 'ACTIVE', 'PAUSED', 'ARCHIVING', 'REPAIR_REQUIRED']);
const key = guildId => `v204:spaces:${guildId}`;
async function list(guildId) { return Object.values((await store.read(key(guildId), { spaces: {} })).spaces); }
async function reserve(guildId, input = {}) {
  if (!guildId || !String(input.name || '').trim()) throw new Error('Guild and space name are required');
  return store.transact(key(guildId), { spaces: {} }, data => {
    // Adopt legacy active records once so existing leagues consume slots too.
    for (const old of require('./activeLeagueService').listActiveLeagues()) {
      if (old.guildId && old.guildId !== guildId) continue;
      if (!data.spaces[old.id]) data.spaces[old.id] = { ...old, name: old.leagueName, guildId, kind: old.kind || 'league', status: 'ACTIVE' };
    }
    const spaces = Object.values(data.spaces);
    // The space ID scopes categories; a short display code may repeat.
    if (spaces.filter(s => counted.has(s.status)).length >= 3) throw new Error('This server already has three active or pending leagues/events. Erase or archive one first.');
    if (spaces.some(s => counted.has(s.status) && s.name.toLowerCase() === input.name.trim().toLowerCase())) throw new Error('An active space already uses this name');
    const item = { id: randomUUID(), guildId, kind: input.kind || 'league', name: input.name.trim(), status: 'PREPARING', createdAt: Date.now(), ...input };
    data.spaces[item.id] = item;
    return item;
  });
}
async function transition(guildId, id, status, patch = {}) {
  return store.transact(key(guildId), { spaces: {} }, data => {
    const item = data.spaces[id]; if (!item) throw new Error('Space reservation not found');
    Object.assign(item, patch, { status, updatedAt: Date.now() }); return item;
  });
}
module.exports = { list, reserve, transition };
