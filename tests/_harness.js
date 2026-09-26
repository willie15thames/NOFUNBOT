/*
 * NAVIGATION HEADER
 * FILE: tests/_harness.js
 * LAYER: Tests (V202)
 * PURPOSE: Minimal zero-dependency test harness + an in-memory Discord guild mock built on discord.js Collection,
 *          so channel/permission/session logic can be exercised without a live guild. Each *.test.js file runs in
 *          its own process with its own BOT_DATA_DIR (see run-all.js).
 */
'use strict';

const { Collection, ChannelType } = require('discord.js');

const results = [];
function test(name, fn) { results.push({ name, fn }); }
async function run(file) {
  let pass = 0, fail = 0;
  // Keep the event loop alive while tests run (production timers are unref'd), and treat an early exit as failure.
  const keepAlive = setInterval(() => {}, 1000);
  process.exitCode = 1;
  for (const t of results) {
    try { await t.fn(); pass++; console.log(`  ✔ ${t.name}`); }
    catch (e) { fail++; console.log(`  ✘ ${t.name}\n      ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e}`); }
  }
  clearInterval(keepAlive);
  console.log(`${file}: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}
function assert(cond, msg) { if (!cond) throw new Error(`assertion failed: ${msg}`); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }

let _id = 100000000000000000n;
function snowflake() { _id += 1n; return String(_id); }

function mockGuild() {
  const guild = { id: '222222222222222222', name: 'Test Guild', memberCount: 10 };
  const cache = new Collection();
  const sent = [];
  const deleted = [];
  function makeChannel({ name, type = ChannelType.GuildText, parent = null, permissionOverwrites = [] }) {
    const id = snowflake();
    const overwrites = new Collection();
    for (const o of permissionOverwrites || []) overwrites.set(String(o.id), o);
    const ch = {
      id, name, type, guild,
      get parentId() { return this._parentId || null; },
      _parentId: parent ? (parent.id || parent) : null,
      get parent() { return this._parentId ? cache.get(this._parentId) : null; },
      isTextBased() { return type === ChannelType.GuildText; },
      isThread() { return false; },
      permissionsFor() { return { has: () => true }; },
      permissionOverwrites: { cache: overwrites, edit: async (uid, perms) => { overwrites.set(String(uid), { id: uid, perms }); } },
      async send(payload) { const m = { id: snowflake(), channelId: id, payload }; sent.push(m); return m; },
      async delete() { cache.delete(id); deleted.push(name); },
      async setParent(pid) { this._parentId = pid; },
      async setName(n) { this.name = n; },
      async setTopic() {},
      messages: { fetch: async () => ({ delete: async () => null }) },
      toString() { return `<#${id}>`; },
    };
    cache.set(id, ch);
    return ch;
  }
  guild.channels = {
    cache,
    create: async (opts) => makeChannel({ name: opts.name, type: opts.type ?? ChannelType.GuildText, parent: opts.parent, permissionOverwrites: opts.permissionOverwrites }),
    fetch: async () => cache,
  };
  guild.roles = { everyone: { id: guild.id }, cache: new Collection() };
  guild.members = { me: { id: '999999999999999999', permissions: { has: () => true } }, cache: new Collection() };
  guild.emojis = { cache: new Collection() };
  guild._sent = sent;
  guild._deleted = deleted;
  guild._makeChannel = makeChannel;
  return guild;
}

function freshState() {
  const state = require('../src/state');
  state.games.clear();
  state.players.clear();
  state.ocrGameResults.length = 0;
  state.openTeamRegistry.length = 0;
  state.scheduleState.week = null;
  state.scheduleState.matchups = [];
  state.leagueConfig.leagueName = 'TESTLG';
  state.leagueConfig.game = 'madden';
  return state;
}

function initGameChannels(state) {
  const gcs = require('../src/services/gameChannelService');
  gcs.init({ state, getCh: () => null, aiCall: async () => ({ content: [{ text: '' }] }), MODELS: {} });
  return gcs;
}

function resetFiles(names) {
  const { saveJson } = require('../src/storage/jsonStore');
  for (const n of names) saveJson(n, null);
}

module.exports = { test, run, assert, eq, mockGuild, freshState, initGameChannels, resetFiles, snowflake, ChannelType };
