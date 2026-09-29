/*
 * ComponentSession: transient server-side authority for button panels.
 * Values/IDs stay server-side; Discord custom IDs carry only short opaque keys.
 * Sessions are intentionally non-durable. A restart fails closed and the user reopens the flow.
 */
'use strict';

const crypto = require('crypto');

const DEFAULT_TTL_MS = 15 * 60_000;
const MAX_SESSIONS = 2000;
const sessions = new Map();

function _id(bytes = 6) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function _sweep(now = Date.now()) {
  for (const [id, row] of sessions) {
    if (!row || row.expiresAt <= now) sessions.delete(id);
  }
  if (sessions.size <= MAX_SESSIONS) return;
  const ordered = [...sessions.values()].sort((a,b) => a.createdAt - b.createdAt);
  for (const row of ordered.slice(0, sessions.size - MAX_SESSIONS)) sessions.delete(row.id);
}

function create(input = {}) {
  _sweep();
  const id = _id();
  const options = (input.options || []).map((o, index) => ({
    key: index.toString(36),
    label: String(o.label ?? o.name ?? o.value ?? `Option ${index + 1}`).slice(0, 80),
    description: o.description ? String(o.description).slice(0, 100) : '',
    value: String(o.value ?? o.label ?? index),
    emoji: o.emoji || null,
    disabled: !!o.disabled,
    default: !!o.default,
  }));
  const selected = new Set(options.filter(o => o.default).map(o => o.key));
  const row = {
    id,
    guildId: input.guildId ? String(input.guildId) : null,
    actorId: input.actorId ? String(input.actorId) : null,
    public: input.public === true,
    flow: String(input.flow || input.legacyCustomId || 'choice'),
    legacyCustomId: String(input.legacyCustomId || ''),
    options,
    selected,
    actorSelections: new Map(),
    minValues: Math.max(0, Number(input.minValues ?? 1)),
    maxValues: Math.max(1, Number(input.maxValues ?? 1)),
    page: Math.max(0, Number(input.page || 0)),
    pageSize: Math.min(20, Math.max(5, Number(input.pageSize || 20))),
    createdAt: Date.now(),
    expiresAt: Date.now() + Math.max(30_000, Number(input.ttlMs || DEFAULT_TTL_MS)),
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
  };
  sessions.set(id, row);
  return row;
}

function get(id) {
  _sweep();
  return sessions.get(String(id || '')) || null;
}

function remove(id) { return sessions.delete(String(id || '')); }

function clearGuild(guildId) {
  const gid = String(guildId || '');
  let removed = 0;
  for (const [id, row] of sessions) {
    if (String(row.guildId || '') === gid) { sessions.delete(id); removed++; }
  }
  return removed;
}

function access(session, interaction) {
  if (!session) return { ok:false, reason:'expired' };
  const gid = String(interaction?.guildId || interaction?.guild?.id || '');
  const uid = String(interaction?.user?.id || interaction?.member?.id || '');
  if (session.guildId && session.guildId !== gid) return { ok:false, reason:'wrong-guild' };
  if (session.actorId && session.actorId !== uid) return { ok:false, reason:'wrong-user' };
  return { ok:true, userId:uid };
}

function selectionFor(session, userId) {
  if (!session) return new Set();
  if (session.public) {
    const key = String(userId || 'anonymous');
    if (!session.actorSelections.has(key)) session.actorSelections.set(key, new Set());
    return session.actorSelections.get(key);
  }
  return session.selected;
}

function toggle(session, optionKey, userId) {
  const opt = session?.options?.find(o => o.key === String(optionKey));
  if (!session || !opt || opt.disabled) return { ok:false, reason:'invalid-option' };
  const selected = selectionFor(session, userId);
  if (selected.has(opt.key)) selected.delete(opt.key);
  else {
    if (selected.size >= session.maxValues) {
      if (session.maxValues === 1) selected.clear();
      else return { ok:false, reason:'max-values' };
    }
    selected.add(opt.key);
  }
  return { ok:true, selected };
}

function values(session, userId) {
  const selected = selectionFor(session, userId);
  return [...selected].map(key => session.options.find(o => o.key === key)?.value).filter(v => v !== undefined);
}

function option(session, key) {
  return session?.options?.find(o => o.key === String(key)) || null;
}

function setPage(session, page) {
  if (!session) return null;
  const pages = Math.max(1, Math.ceil(session.options.length / session.pageSize));
  session.page = Math.min(pages - 1, Math.max(0, Number(page || 0)));
  return session;
}

function diagnostics() {
  _sweep();
  return { active: sessions.size, max: MAX_SESSIONS, ttlMs: DEFAULT_TTL_MS };
}

module.exports = { create, get, remove, clearGuild, access, selectionFor, toggle, values, option, setPage, diagnostics };
