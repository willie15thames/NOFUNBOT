/*
 * NAVIGATION HEADER
 * FILE: src/services/waitlistService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const FILE = 'waitlist.json';

function _state() {
  const raw = loadJson(FILE, { entries: [] }) || { entries: [] };
  raw.entries = Array.isArray(raw.entries) ? raw.entries : [];
  return raw;
}

function _save(data) {
  saveJsonDebounced(FILE, data, 200);
  return data;
}

function list() {
  return _state().entries.sort((a, b) => (a.position || 9999) - (b.position || 9999) || (a.addedAt || 0) - (b.addedAt || 0));
}

function _reindex(entries) {
  entries.forEach((entry, idx) => {
    entry.position = idx + 1;
  });
  return entries;
}

function add(user, note = '', desiredPosition = null) {
  const data = _state();
  const entries = data.entries.filter(e => String(e.userId) !== String(user.id));
  const entry = {
    userId: String(user.id),
    tag: user.tag || user.username || String(user.id),
    note: String(note || '').trim(),
    addedAt: Date.now(),
  };
  if (desiredPosition && Number(desiredPosition) > 0) {
    entries.splice(Math.max(0, Number(desiredPosition) - 1), 0, entry);
  } else {
    entries.push(entry);
  }
  data.entries = _reindex(entries);
  _save(data);
  return data.entries.find(e => e.userId === entry.userId);
}

function removeByUserId(userId) {
  const data = _state();
  const before = data.entries.length;
  data.entries = data.entries.filter(e => String(e.userId) !== String(userId));
  _reindex(data.entries);
  _save(data);
  return before !== data.entries.length;
}

function popTop() {
  const data = _state();
  const top = data.entries.shift() || null;
  _reindex(data.entries);
  _save(data);
  return top;
}

async function notifyTop(client, count = 1, message = 'A team may be opening up soon.') {
  const entries = list().slice(0, Math.max(1, Number(count || 1)));
  let sent = 0;
  let failed = 0;
  for (const entry of entries) {
    try {
      const user = await client.users.fetch(entry.userId);
      await user.send(`🏟️ CommishAI update: ${message}`);
      sent++;
    } catch {
      failed++;
    }
  }
  return { sent, failed, entries };
}

module.exports = {
  list,
  add,
  removeByUserId,
  popTop,
  notifyTop,
};
