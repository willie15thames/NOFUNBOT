'use strict';
// Template edits remove only channels identified as bot-created template assets.
// A changed name/topic/parent is treated as a manual edit and is preserved.
const { ChannelType } = require('discord.js');
const { loadJson, saveJson } = require('../storage/jsonStore');
const FILE = 'templateBuildManifest.json';
const isTemplateTopic = topic => /^.+ channel for .+$/i.test(String(topic || '')) || /^Custom space: .+$/i.test(String(topic || ''));

function capture(guild) {
  const saved = loadJson(FILE, {}) || {};
  const prior = saved[guild.id]?.channels || [];
  const candidates = new Map();
  for (const ch of guild.channels.cache.values()) {
    if (!ch.isTextBased?.() || !ch.parentId) continue;
    const recorded = prior.find(x => String(x.id) === String(ch.id));
    if (recorded && recorded.name === ch.name && recorded.topic === ch.topic && String(recorded.parentId) === String(ch.parentId)) {
      candidates.set(ch.id, recorded);
    } else if (!recorded && isTemplateTopic(ch.topic)) {
      // Untracked legacy topics are insufficient proof of ownership. Preserve for review.
    }
  }
  return { candidates: [...candidates.values()], saved };
}


function recordDesired(guild, specs) {
  const saved = loadJson(FILE, {}) || {};
  const channels = [];
  for (const spec of specs || []) {
    const cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === spec.name);
    if (!cat) continue;
    for (const [name] of spec.channels || []) {
      const ch = guild.channels.cache.find(c => c.isTextBased?.() && c.name === name && c.parentId === cat.id);
      if (!ch || !isTemplateTopic(ch.topic)) continue;
      channels.push({ id: ch.id, name: ch.name, topic: ch.topic, parentId: ch.parentId });
    }
  }
  saved[guild.id] = { channels, updatedAt: Date.now() };
  saveJson(FILE, saved);
  return { recorded: channels.length };
}
async function reconcile(guild, snapshot, specs, isProtectedCategory = () => false) {
  const wanted = new Set(specs.flatMap(spec => (spec.channels || []).map(([name]) => `${spec.name}\0${name}`)));
  const desired = [];
  for (const spec of specs) {
    const cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === spec.name);
    if (!cat) throw new Error(`Template category missing after build: ${spec.name}`);
    for (const [name] of spec.channels || []) {
      const ch = guild.channels.cache.find(c => c.isTextBased?.() && c.name === name && c.parentId === cat.id);
      if (!ch) throw new Error(`Template channel missing after build: ${spec.name}/#${name}`);
      if (isTemplateTopic(ch.topic)) desired.push({ id: ch.id, name: ch.name, topic: ch.topic, parentId: ch.parentId });
    }
  }
  let deletedChannels = 0, deletedCategories = 0, preserved = 0;
  const candidateParents = new Set();
  for (const item of snapshot.candidates) {
    const ch = guild.channels.cache.get(item.id);
    if (!ch) continue;
    const cat = guild.channels.cache.get(ch.parentId);
    if (!cat || isProtectedCategory(cat) || ch.name !== item.name || ch.topic !== item.topic || String(ch.parentId) !== String(item.parentId)) { preserved++; continue; }
    if (wanted.has(`${cat.name}\0${ch.name}`)) continue;
    candidateParents.add(cat.id);
    await ch.delete('Template option removed by commissioner');
    deletedChannels++;
  }
  for (const id of candidateParents) {
    const cat = guild.channels.cache.get(id);
    if (!cat || isProtectedCategory(cat) || wanted.size && specs.some(s => s.name === cat.name)) continue;
    if (guild.channels.cache.some(c => c.parentId === id)) { preserved++; continue; }
    await cat.delete('Empty category from previous template');
    deletedCategories++;
  }
  snapshot.saved[guild.id] = { channels: desired, updatedAt: Date.now() };
  saveJson(FILE, snapshot.saved);
  return { deletedChannels, deletedCategories, preserved };
}
module.exports = { capture, reconcile, recordDesired, isTemplateTopic };
