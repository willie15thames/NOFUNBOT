'use strict';

// Persist each transition before continuing. A failed build never becomes an active league.
const { loadJson, saveJson } = require('../../storage/jsonStore');
const FILE = 'leagueBuildSessions.json';
async function save(session) {
  const all = loadJson(FILE, {}) || {};
  all[session.id] = { ...session, updatedAt: Date.now() };
  await require('../../storage/criticalStore').transact(`build:${session.id}`, {}, data => Object.assign(data, all[session.id]));
  saveJson(FILE, all);
  return all[session.id];
}
function get(id) { return (loadJson(FILE, {}) || {})[id] || null; }

async function execute({ guild, plan, createCategory, createChannel, commit }) {
  const id = `${guild.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const session = { id, guildId: guild.id, leagueTypeId: plan.leagueTypeId, state: 'PLANNED', journal: [], createdAt: Date.now(), error: null };
  const builtChannels = {};
  const builtCategoryIds = [];
  const builtChannelIds = [];
  let createdCount = 0;
  await save(session);
  try {
    if (!Array.isArray(plan.categories) || !plan.categories.length) throw new Error('Build plan has no categories');
    const keys = new Set();
    for (const cat of plan.categories) for (const channel of cat.channels) {
      if (keys.has(channel.key)) throw new Error(`Duplicate channel key: ${channel.key}`);
      keys.add(channel.key);
    }
    session.state = 'PREFLIGHT_PASSED'; await save(session);
    session.state = 'APPLYING'; await save(session);
    for (const cat of plan.categories) {
      const before = guild.channels.cache.find(c => c.type === 4 && c.name === cat.name);
      session.pendingResource = { type: 'category', name: cat.name }; await save(session);
      const category = await createCategory(cat);
      if (!category?.id) throw new Error(`Category creation failed: ${cat.name}`);
      const categoryCreated = !before;
      session.journal.push({ type: 'category', key: cat.name, id: category.id, existedBefore: !categoryCreated }); await save(session);
      builtCategoryIds.push(category.id);
      for (const channel of cat.channels) {
        const existing = guild.channels.cache.find(c => c.isTextBased?.() && c.parentId === category.id && c.name === channel.name);
        session.pendingResource = { type: 'channel', name: channel.name, parentId: category.id }; await save(session);
        const resource = existing || await createChannel(channel, category, cat);
        if (!resource?.id) throw new Error(`Channel creation failed: ${channel.name}`);
        session.journal.push({ type: 'channel', key: channel.key, id: resource.id, existedBefore: !!existing }); await save(session);
        builtChannels[channel.key] = resource;
        builtChannelIds.push(resource.id);
        if (!existing) createdCount++;
      }
    }
    session.state = 'VALIDATING'; await save(session);
    for (const cat of plan.categories) for (const channel of cat.channels) {
      if (!builtChannels[channel.key]?.id) throw new Error(`Required channel missing: ${channel.key}`);
    }
    // Commit is the last operation; no active league is visible during Discord mutations.
    const result = await commit({ builtChannels, builtCategoryIds, builtChannelIds, createdCount, buildId: id });
    session.pendingResource = null;
    session.state = 'COMMITTED'; await save(session);
    return { ...result, buildId: id, builtChannels, builtCategoryIds, builtChannelIds, createdCount };
  } catch (err) {
    session.state = 'FAILED'; session.error = String(err?.message || err); await save(session);
    session.state = 'ROLLBACK_PENDING'; await save(session);
    const failures = [];
    for (const item of [...session.journal].reverse()) {
      if (item.existedBefore) continue;
      try {
        const resource = guild.channels.cache.get(item.id);
        if (resource) await resource.delete(`Failed league build ${id}`);
        item.rolledBack = true;
      } catch (rollbackError) { failures.push(`${item.key}: ${rollbackError.message}`); }
      await save(session);
    }
    session.state = failures.length ? 'FAILED_PARTIAL' : 'ROLLED_BACK';
    session.rollbackErrors = failures; await save(session);
    err.buildId = id;
    throw err;
  }
}

module.exports = { execute, get };
