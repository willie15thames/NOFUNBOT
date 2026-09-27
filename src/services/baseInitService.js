/*
 * NAVIGATION HEADER
 * FILE: src/services/baseInitService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { saveJson } = require('../storage/jsonStore');
const { buildServerRulesText } = require('./serverRulesService');
const serverSettings = require('./serverSettingsService');
const templateLogic = require('./serverTemplateLogicService');
const { resolveServerName } = require('./serverBrandService');
const { resolveTemplateProfile, getServerTemplatesMap } = require('./templateRegistryService');
const SERVER_TEMPLATES = getServerTemplatesMap();
const patchNotesService = require('./patchNotesService');
const { getStaffRoles: getConfiguredStaffRoles } = require('./accessPolicyService');
const { getReadOnlyBaseChannelNames, isStaffRepairChannel, findConfiguredChannel } = require('./channelTopologyService');


function isDeletableGuildChannel(ch, opts = {}) {
  if (!ch) return false;
  if (ch.type === ChannelType.DM || ch.type === ChannelType.GroupDM) return false;
  if (!opts.includeProtected && patchNotesService.isProtectedPatchAsset(ch)) return false;
  const preserveChannelIds = new Set(Array.isArray(opts.preserveChannelIds) ? opts.preserveChannelIds.filter(Boolean) : []);
  const preserveCategoryIds = new Set(Array.isArray(opts.preserveCategoryIds) ? opts.preserveCategoryIds.filter(Boolean) : []);
  if (preserveChannelIds.has(ch.id)) return false;
  if (preserveCategoryIds.has(ch.id)) return false;
  if (ch.parentId && preserveCategoryIds.has(ch.parentId)) return false;
  return true;
}

async function flushServerChannels(guild, opts = {}) {
  const all = [...guild.channels.cache.values()].filter(ch => isDeletableGuildChannel(ch, opts));
  const nonCategories = all.filter(c => c.type !== ChannelType.GuildCategory);
  const categories = all.filter(c => c.type === ChannelType.GuildCategory);
  let deletedChannels = 0, deletedCategories = 0;
  const failures = [];
  // V198 FIX: Delete in parallel batches instead of one-by-one.
  // Non-categories first (must be empty before parent category can be deleted).
  const chResults = await Promise.allSettled(nonCategories.map(ch =>
    ch.delete('Base initialization flush').then(() => 'ok').catch(err => { failures.push(`${ch.name || ch.id}: ${err.message}`); return 'fail'; })
  ));
  deletedChannels = chResults.filter(r => r.value === 'ok').length;
  // Then categories in parallel
  const catResults = await Promise.allSettled(categories.map(cat =>
    cat.delete('Base initialization flush').then(() => 'ok').catch(err => { failures.push(`${cat.name || cat.id}: ${err.message}`); return 'fail'; })
  ));
  deletedCategories = catResults.filter(r => r.value === 'ok').length;
  return { deletedChannels, deletedCategories, failures };
}


async function reorderBaseCategoryStack(guild) {
  const cats = [...guild.channels.cache.values()].filter(c => c.type === ChannelType.GuildCategory);
  const find = (re) => cats.find(c => re.test(String(c.name || '')));
  const welcome = find(/welcome to/i);
  const discipline = find(/discipline & activity/i);
  const staff = find(/staff & commissioner/i);
  const middle = cats.filter(c => c.id !== welcome?.id && c.id !== discipline?.id && c.id !== staff?.id)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const ordered = [welcome, ...middle, discipline, staff].filter(Boolean);
  // V198 FIX: Set all positions in parallel
  await Promise.allSettled(ordered.map((c, i) => c.setPosition(i).catch(() => null)));
}

function resetBotState(state) {
  if (!state) return;
  try {
    state.players?.clear?.(); state.teamLookup?.clear?.(); state.userTeamLookup?.clear?.(); state.rosterOverrides?.clear?.(); state.games?.clear?.(); state.pendingTrades?.clear?.();
    state.pendingAttrBoosts?.clear?.(); state.pendingOffenses?.clear?.();
    state.offenseCooldowns?.clear?.(); state.spamTracker?.clear?.();
    state.activeLeagues?.clear?.();
    if (Array.isArray(state.openTeamRegistry)) state.openTeamRegistry.splice(0, state.openTeamRegistry.length);
    if (Array.isArray(state.ocrGameResults)) state.ocrGameResults.length = 0;
    // Preserve potwHistory for lifetime migration and archive.
    // Preserve yearlyAwardHistory for lifetime migration and archive.
    // Preserve superbowlHistory for lifetime migration and archive.
    // Preserve streamMilestones for lifetime migration and archive.
    if (state.leagueMemory) {
      state.leagueMemory.scores = []; state.leagueMemory.statLines = []; state.leagueMemory.potw = [];
      state.leagueMemory.superbowls = []; state.leagueMemory.weeklyStats = []; state.leagueMemory.lastUpdated = null;
    }
    if (state.scheduleState) {
      state.scheduleState.week = null; state.scheduleState.matchups = []; state.scheduleState.pinnedMsgId = null;
      state.scheduleState.lastPosted = null; state.scheduleState.timerId = null;
    }
    if (state.leagueConfig) {
      state.leagueConfig.leagueTypeId = null; state.leagueConfig.leagueName = null; state.leagueConfig.game = null;
      state.leagueConfig.seasonType = null; state.leagueConfig.seasonWeeks = null;
      state.leagueConfig.builtCategoryIds = []; state.leagueConfig.builtChannelIds = []; state.leagueConfig.createdAt = null;
    }
  } catch {}
  saveJson('openTeamRegistry.json', []);
  saveJson('activeLeagues.json', {});
  saveJson('teamRegistry.json', { schema:'nofunleague-team-registry', version:1, teams:[], lastSyncedAt:null, notes:'Reset during base initialization.' });
  saveJson('scheduleRegistry.json', { schema:'nofunleague-schedule-registry', version:1, source:'local', currentWeek:null, weeks:{}, teams:[], lastImportAt:null, lastExportAt:null });
  saveJson('leagueConfig.json', { leagueTypeId:null, leagueName:null, seasonType:null, game:null, seasonWeeks:null, builtCategoryIds:[], builtChannelIds:[], createdAt:null });
  saveJson('stateEngine.json', { boards:{}, timers:{}, lastHashes:{}, meta:{ purpose:'Cleared during base initialization flush.' } });
  saveJson('players.json', []);
  saveJson('rosterOverrides.json', {});
  // Member identity and earned history survive server reinitialization.

  saveJson('broadcasts.json', {});
  saveJson('gameChannelConfig.json', {});
  saveJson('leagues.json', {});
  saveJson('liveSync.json', {});
  saveJson('loggerConfig.json', {});
  saveJson('polls.json', {});
  saveJson('streamOps.json', {});
  saveJson('teamsConfig.json', {});
  saveJson('waitlist.json', {});
  saveJson('weeklyAutomation.json', {});

}


function getStaffRoles(guild) {
  return getConfiguredStaffRoles(guild, { includeAdministrator: true, includeManageGuild: false, includeRoleNameFallback: false });
}

function buildReadOnlyOverwrites(guild) {
  const denies = [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.UseApplicationCommands,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.SendMessagesInThreads,
  ];
  const allow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.UseApplicationCommands,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ManageChannels,
  ];
  const perms = [{ id: guild.roles.everyone.id, deny: denies }];
  const staffRoles = getStaffRoles(guild);
  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.roles.everyone.id) continue;
    if (staffRoles.has(role.id)) continue;
    perms.push({ id: role.id, deny: denies });
  }
  if (guild.members?.me?.id) perms.push({ id: guild.members.me.id, allow: [...allow, PermissionFlagsBits.ManageRoles] });
  for (const role of staffRoles.values()) perms.push({ id: role.id, allow });
  return perms;
}

function staffRoleOverwrites(guild) {

  const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages];
  const perms = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
  if (guild.members?.me?.id) perms.push({ id: guild.members.me.id, allow: [...allow, PermissionFlagsBits.ManageRoles] });
  const staffRoles = getStaffRoles(guild);
  for (const role of staffRoles.values()) perms.push({ id: role.id, allow });
  return perms;
}

async function createCategory(guild, name, permissionOverwrites) {
  return guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites });
}

async function createText(guild, category, name, topic = '', opts = {}) {
  const { staffOnly = false, readOnly = false } = opts;
  let permissionOverwrites = undefined;
  if (staffOnly) {
    permissionOverwrites = staffRoleOverwrites(guild);
  } else if (readOnly) {
    permissionOverwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.UseApplicationCommands, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.AddReactions] },
    ];
    if (guild.members?.me?.id) permissionOverwrites.push({ id: guild.members.me.id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.UseApplicationCommands] });
    const staffRoles = getStaffRoles(guild);
    for (const role of staffRoles.values()) permissionOverwrites.push({ id: role.id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.UseApplicationCommands] });
  }
  // V198 FIX: Removed _guaranteeBotAccess call — channel already has correct permissions
  // from permissionOverwrites above. Guild-wide lockBotAccessGuildWide runs once post-build.
  return guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, topic, permissionOverwrites });
}

/**
 * Guarantee bot always has access on a channel after any permission operation.
 * Called internally — use botAccessService directly for external callers.
 */
async function _guaranteeBotAccess(channel, guild) {
  try {
    const botAccess = require('./botAccessService');
    await botAccess.lockBotAccessOnChannel(channel, guild);
  } catch (_e) {}
}

// V194 FIX: Per-build in-memory creation registry.
// Keyed by `${guildId}:${normalizedName}`. Stores the channel object just created
// so that a second call within the same build run returns it immediately — before
// Discord propagates the new channel back into guild.channels.cache.
// Swept when a new build run starts (see _clearBuildRegistry).
const _buildCategoryRegistry = new Map();
const _buildTextRegistry = new Map(); // V196: Also track text channels

/** Call at the start of every createTemplateStructure / applyEditChanges run. */
function _clearBuildRegistry(guildId) {
  for (const key of _buildCategoryRegistry.keys()) {
    if (key.startsWith(`${guildId}:`)) _buildCategoryRegistry.delete(key);
  }
  for (const key of _buildTextRegistry.keys()) {
    if (key.startsWith(`${guildId}:`)) _buildTextRegistry.delete(key);
  }
}

function _normalizeKey(guildId, name) {
  const stripped = String(name || '').toLowerCase().replace(/^[^\w]+/, '').trim();
  return `${guildId}:${stripped}`;
}

async function findOrCreateCategory(guild, name, permissionOverwrites) {
  const lowerName = String(name || '').toLowerCase();
  const regKey = _normalizeKey(guild.id, name);

  // V194: Check in-build registry first — catches races before Discord cache updates
  const cached = _buildCategoryRegistry.get(regKey);
  if (cached) return cached;

  // Exact match against live cache
  const exact = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && String(c.name || '').toLowerCase() === lowerName);
  if (exact) { _buildCategoryRegistry.set(regKey, exact); return exact; }

  // V187 FIX: Also match by stripping emoji prefixes — handles emoji/whitespace variation
  const stripped = lowerName.replace(/^[^\w]+/, '').trim();
  if (stripped.length > 3) {
    const fuzzy = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && String(c.name || '').toLowerCase().replace(/^[^\w]+/, '').trim() === stripped);
    if (fuzzy) { _buildCategoryRegistry.set(regKey, fuzzy); return fuzzy; }
  }

  const created = await createCategory(guild, name, permissionOverwrites);

  // V201 FIX: Race-safe double-check — another parallel call may have registered this name
  // while we were awaiting the Discord API. If so, delete our duplicate and return the winner.
  const raceWinner = _buildCategoryRegistry.get(regKey);
  if (raceWinner && raceWinner.id !== created.id) {
    await created.delete('V201 race-safe: duplicate category removed').catch(() => null);
    return raceWinner;
  }

  _buildCategoryRegistry.set(regKey, created);
  return created;
}

async function findOrCreateText(guild, category, name, topic = '', opts = {}) {
  const lowerName = String(name || '').toLowerCase();
  // Names repeat across categories. The parent ID is part of channel identity.
  const regKey = `${guild.id}:${category.id}:${lowerName}`;

  // V196: Check text registry first
  const cached = _buildTextRegistry.get(regKey);
  if (cached) return cached;

  const exactParent = guild.channels.cache.find(c => c.isTextBased?.() && String(c.name || '').toLowerCase() === lowerName && c.parentId === category.id);
  if (exactParent) { _buildTextRegistry.set(regKey, exactParent); return exactParent; }

  const created = await createText(guild, category, name, topic, opts);

  // V201 FIX: Race-safe double-check — another parallel call may have registered this name
  const raceWinner = _buildTextRegistry.get(regKey);
  if (raceWinner && raceWinner.id !== created.id) {
    await created.delete('V201 race-safe: duplicate channel removed').catch(() => null);
    return raceWinner;
  }

  _buildTextRegistry.set(regKey, created);
  return created;
}

function getTemplateSummary(template) {
  const cats = template?.categories || [];
  const names = [];
  for (const cat of cats) {
    for (const [chName] of (cat.channels || [])) names.push(`#${chName}`);
  }
  return names.join(', ');
}

/**
 * V196: Silent post-build dedup sweep.
 * Runs after every createTemplateStructure and applyEditChanges.
 * Finds duplicate categories by normalised name, moves orphan children to the winner,
 * and deletes the empty losers. Zero user output — only logs.
 * This catches duplicates from ANY source: template overlap, cache staleness,
 * services that bypass findOrCreateCategory (gameChannelService, leagueSetupService, etc.).
 */
/**
 * V202 (BUG-009): scope identity for destructive dedup. A category is "scoped" (never merged/deleted by the
 * silent sweep, never robbed of channels by findOrCreateText) when it is a weekly-games category, a team space,
 * or recorded as built by a league (activeLeagues / leagueConfig builtCategoryIds).
 */
function _isProtectedScopeCategory(guild, cat) {
  if (!cat || cat.type !== ChannelType.GuildCategory) return false;
  const raw = String(cat.name || '');
  if (/WEEK(LY)? GAMES/i.test(raw)) return true;
  if (raw.startsWith('🏟')) return true;
  try {
    const { loadJson } = require('../storage/jsonStore');
    const leagues = loadJson('activeLeagues.json', {}) || {};
    for (const l of Object.values(leagues)) if ((l?.builtCategoryIds || []).includes(cat.id)) return true;
    const lc = loadJson('leagueConfig.json', {}) || {};
    if ((lc.builtCategoryIds || []).includes(cat.id)) return true;
  } catch {}
  return false;
}

async function _silentDedupSweep(guild) {
  try {
    await guild.channels.fetch().catch(() => null);
    const normName = n => String(n || '').toLowerCase().replace(/^[^\w]+/, '').trim();
    // V202 (BUG-009): destructive merge/delete is limited to category names THIS build run touched
    // (the per-build registry). Any other same-name group is reported only — a display name is not a global identity.
    const buildKeys = new Set();
    for (const key of _buildCategoryRegistry.keys()) if (key.startsWith(`${guild.id}:`)) buildKeys.add(key.slice(guild.id.length + 1));
    const reportOnly = [];
    const catGroups = new Map();
    for (const ch of guild.channels.cache.values()) {
      if (ch.type !== ChannelType.GuildCategory) continue;
      const key = normName(ch.name);
      if (!key) continue;
      if (!catGroups.has(key)) catGroups.set(key, []);
      catGroups.get(key).push(ch);
    }
    let mergedTotal = 0;
    let deletedChTotal = 0;
    let deletedCatTotal = 0;
    for (const [groupKey, allInGroup] of catGroups.entries()) {
      if (allInGroup.length < 2) continue;
      const group = allInGroup.filter(c => !_isProtectedScopeCategory(guild, c));
      if (!buildKeys.has(groupKey) || group.length < 2) {
        reportOnly.push(`${groupKey} ×${allInGroup.length}`);
        continue;
      }
      // Winner = most populated
      group.sort((a, b) => {
        const aCount = guild.channels.cache.filter(c => c.parentId === a.id).size;
        const bCount = guild.channels.cache.filter(c => c.parentId === b.id).size;
        return bCount - aCount;
      });
      const winner = group[0];
      for (const loser of group.slice(1)) {
        const children = guild.channels.cache.filter(c => c.parentId === loser.id);
        for (const child of children.values()) {
          const alreadyExists = guild.channels.cache.find(
            c => c.parentId === winner.id && normName(c.name) === normName(child.name)
          );
          if (!alreadyExists) {
            // Unique child — move to winner
            await child.setParent(winner.id, { lockPermissions: false, reason: 'V200 post-build dedup' }).catch(() => null);
            mergedTotal++;
          } else {
            // V200 FIX: Duplicate child — delete it from the loser. The winner already has this channel.
            await child.delete('V200 post-build dedup: duplicate channel removed').catch(() => null);
            deletedChTotal++;
          }
        }
        // Refresh cache after child operations
        await guild.channels.fetch().catch(() => null);
        const remaining = guild.channels.cache.filter(c => c.parentId === loser.id).size;
        if (remaining === 0) {
          await loser.delete('V200 post-build dedup: empty duplicate category removed').catch(() => null);
          deletedCatTotal++;
        }
      }
    }
    if (mergedTotal || deletedChTotal || deletedCatTotal) {
      const { makeLogger } = require('../utils/logger');
      makeLogger('baseInit').info(`[dedup-sweep] merged ${mergedTotal} ch, deleted ${deletedChTotal} dupe ch, deleted ${deletedCatTotal} empty categor${deletedCatTotal === 1 ? 'y' : 'ies'}`);
    }
    if (reportOnly.length) {
      require('../utils/logger').makeLogger('baseInit').warn(`[dedup-sweep] report-only (not built this run or scoped): ${reportOnly.join(', ')} — use /fix-duplicates to review`);
    }
  } catch (e) {
    try { require('../utils/logger').makeLogger('baseInit').warn(`[dedup-sweep] error: ${e.message}`); } catch {}
  }
}



async function postBaseGuideMessages(guild) {
  const channelGuideService = require('./channelGuideService');
  const welcome = findConfiguredChannel(guild, 'welcome', { textOnly: true });
  const rules = findConfiguredChannel(guild, 'rules', { textOnly: true });
  const settings_pbgm = serverSettings.getSettings();
  const guideChName = templateLogic.getGuideChannelName(settings_pbgm);
  const guide = findConfiguredChannel(guild, 'serverGuide', { textOnly: true })
    || guild.channels.cache.find(c => c.isTextBased?.() && c.name === guideChName && /^👋 Welcome to/i.test(String(c.parent?.name || '')));
  const join = findConfiguredChannel(guild, 'howToJoin', { textOnly: true });
  const polls = findConfiguredChannel(guild, 'polls', { textOnly: true });

  async function replaceBotPosts(ch, embed) {
    if (!ch) return;
    const recent = await ch.messages.fetch({ limit: 20 });
    await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
    for (const m of (recent ? [...recent.values()] : [])) {
      if (m.author?.id !== guild.members.me?.id) continue;
      const title = String(m.embeds?.[0]?.title || '');
      if (title && (title === embed.title || /Server Rules|Base Server Guide|League Guide|Server Guide|How to Join|Welcome to|Polls & Voting/i.test(title))) await m.delete().catch(() => null);
    }
  }

  const settings = serverSettings.getSettings();
  const hasLeague = require('./activeLeagueService').listActiveLeagues().length > 0;
  const guideTitle = '🧭 Server Guide';
  // V199 FIX: Append commands/actions block to every core channel guide
  const _cmdBlock = channelGuideService.getCommandsBlock;
  await Promise.all([
    replaceBotPosts(welcome, { color: 0x2ecc71, title: '👋 Welcome to the Server', description: `${templateLogic.buildWelcomeText(guild.name, settings)}\n\nThis channel is read-only on purpose so the important info stays visible.${_cmdBlock('welcome')}`, timestamp: new Date().toISOString() }),
    replaceBotPosts(rules, { color: 0x4da3ff, title: '📖 Server Rules', description: `${buildServerRulesText()}${_cmdBlock('rules')}`, timestamp: new Date().toISOString() }),
    replaceBotPosts(guide, { color: 0x5865f2, title: guideTitle, description: `${templateLogic.buildBaseGuideText(settings)}\n\n• Staff-only tools stay hidden from members.\n• Trash talk is allowed. Slurs and hateful nonsense are not.${_cmdBlock('server-guide')}`, timestamp: new Date().toISOString() }),
    replaceBotPosts(join, { color: 0x2ecc71, title: '✅ How to Join', description: `${templateLogic.buildHowToJoinText(settings, hasLeague)}${_cmdBlock('how-to-join')}`, timestamp: new Date().toISOString() }),
    replaceBotPosts(polls, { color: 0xf1c40f, title: '📊 Polls & Voting', description: `This channel is vote-only.\n\n• Members use the posted picklists to vote\n• No free-form chat here\n• Staff can post or refresh votes here${_cmdBlock('polls')}`, timestamp: new Date().toISOString() }),
  ]);

  // ── V187: Register all template channels with guideLifecycle for idle-triggered guide posting ──
  // Guides populate AFTER inactivity, not eagerly on build. This keeps channels clean during active use.
  const guideLifecycle = require('./guideLifecycleService');
  const coreNames = new Set(['welcome', 'rules', String(guideChName || '').toLowerCase(), 'server-guide', 'server-guide', 'how-to-join', 'polls'].filter(Boolean));
  const staffParentRx = /staff & commissioner|bot setup|patch notes/i;

  for (const ch of guild.channels.cache.values()) {
    if (!ch.isTextBased?.()) continue;
    // League guides are posted by the selected league's lifecycle.
    if (require('./activeLeagueService').findLeagueForChannel(ch)) continue;
    const rawName = String(ch.name || '').toLowerCase();
    const cleanName = rawName.replace(/^[^\w-]+/, '').trim();
    if (coreNames.has(cleanName)) continue;
    if (staffParentRx.test(String(ch.parent?.name || ''))) continue;
    if (!channelGuideService.hasGuide(cleanName)) continue;

    // Register with guideLifecycle — guide will post when idle window elapses
    guideLifecycle.registerChannel(guild.id, ch.id, 'template-channel', {
      idleRefreshAfterMs: 15 * 60 * 1000, // 15 minutes
      lastActivityAt: Date.now(), // treat build time as last activity — guide won't fire immediately
    });
  }
}


async function normalizeBaseChannelPolicies(guild) {
  const readOnly = new Set(getReadOnlyBaseChannelNames().concat(['server-guide']).map(name => String(name || '').toLowerCase()));
  // V198 FIX: Batch permission edits with Promise.allSettled — each channel is independent.
  // Previously: sequential await per channel per overwrite = O(channels × overwrites) serial API calls.
  // Now: all channels queued in parallel, Discord rate limiter handles pacing.
  const tasks = [];
  for (const ch of guild.channels.cache.values()) {
    if (!ch.isTextBased?.()) continue;
    // Plain league channel names must retain their private league overwrites.
    if (require('./activeLeagueService').findLeagueForChannel(ch) || _isProtectedScopeCategory(guild, ch.parent)) continue;
    const name = String(ch.name || '').toLowerCase();
    const parentName = String(ch.parent?.name || '').toLowerCase();
    const isStaff = isStaffRepairChannel(ch) || isStaffRepairChannel(parentName) || /staff & commissioner/i.test(parentName);
    if (isStaff) {
      tasks.push(ch.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false }));
      continue;
    }
    if (readOnly.has(name)) {
      const overwrites = buildReadOnlyOverwrites(guild);
      for (const ow of overwrites) {
        tasks.push(ch.permissionOverwrites.edit(ow.id, {
          ViewChannel: ow.allow?.includes?.(PermissionFlagsBits.ViewChannel) ? true : undefined,
          ReadMessageHistory: ow.allow?.includes?.(PermissionFlagsBits.ReadMessageHistory) ? true : undefined,
          SendMessages: (() => {
            if (ow.allow?.includes?.(PermissionFlagsBits.SendMessages)) return true;
            if (ow.deny?.includes?.(PermissionFlagsBits.SendMessages)) return false;
            return undefined;
          })(),
          AddReactions: (() => {
            if (ow.allow?.includes?.(PermissionFlagsBits.AddReactions)) return true;
            if (ow.deny?.includes?.(PermissionFlagsBits.AddReactions)) return false;
            return undefined;
          })(),
          UseApplicationCommands: (() => {
            if (ow.allow?.includes?.(PermissionFlagsBits.UseApplicationCommands)) return true;
            if (ow.deny?.includes?.(PermissionFlagsBits.UseApplicationCommands)) return false;
            return undefined;
          })(),
          CreatePublicThreads: ow.deny?.includes?.(PermissionFlagsBits.CreatePublicThreads) ? false : undefined,
          CreatePrivateThreads: ow.deny?.includes?.(PermissionFlagsBits.CreatePrivateThreads) ? false : undefined,
          SendMessagesInThreads: ow.deny?.includes?.(PermissionFlagsBits.SendMessagesInThreads) ? false : undefined,
          ManageMessages: ow.allow?.includes?.(PermissionFlagsBits.ManageMessages) ? true : undefined,
          ManageChannels: ow.allow?.includes?.(PermissionFlagsBits.ManageChannels) ? true : undefined,
        }));
      }
    }
  }
  const results = await Promise.allSettled(tasks);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}


async function resetToInstallationMode(guild, state, options = {}) {
  const flushSummary = await flushServerChannels(guild, {
    includeProtected: !!options.fullReboot,
    preserveChannelIds: options.preserveChannelIds || [],
    preserveCategoryIds: options.preserveCategoryIds || [],
  });
  resetBotState(state);
  return { serverName: resolveServerName(guild, 'this server'), flushSummary, installationMode: true, fullReboot: !!options.fullReboot };
}



function serverRulesChannelTopic(settings) {
  // V192: Data-driven — derives from template name instead of hardcoded leagueFriendly conditional
  const profile = settings.serverTemplate
    ? require('./serverTemplateLogicService').getTemplateProfile(settings)
    : null;
  if (!profile?.name) return 'Server rules and conduct expectations.';
  return `${profile.name} rules and conduct expectations.`;
}

async function createTemplateStructure(guild, state, templateKey = 'gaming', options = {}) {
  _clearBuildRegistry(guild.id);
  const snap = { ...serverSettings.getSettings(), ...(options.settings || {}) };
  const serverName = guild.name || 'Server';
  const modeRaw = String(options.structureMode || snap.customStructureMode || 'base').toLowerCase();
  const mode = ['base','template','custom'].includes(modeRaw) ? modeRaw : 'base';
  let flushSummary = { deletedChannels: 0, deletedCategories: 0 };

  // Every supported structure starts from the same stable bot/server core. BASE stops there.
  const base = await initializeBaseStructure(guild, state, { flush: true, ...options, settings: snap });
  flushSummary = base.flushSummary || flushSummary;
  await guild.channels.fetch().catch(() => null);

  let desiredTemplateSpecs = [];
  let templateLabel = 'Base Structure';
  let templateSummary = 'Core bot/server lanes only. No template or subtemplate is applied.';

  if (mode === 'template') {
    if (!snap.serverTemplate) throw new Error('Template Structure requires a server template');
    const profile = resolveTemplateProfile({ ...snap, serverTemplate: String(templateKey || snap.serverTemplate).toLowerCase() });
    const specs = (profile.categories || [])
      .map(c => ({ name: String(c.name || '').replace('{server}', serverName), channels: c.channels || [] }))
      .filter(c => !/welcome to|discipline|staff & commissioner/i.test(c.name));
    const catMap = new Map();
    await Promise.all(specs.map(async spec => { catMap.set(spec.name, await findOrCreateCategory(guild, spec.name)); }));
    await Promise.all(specs.flatMap(spec => (spec.channels || []).map(([chName, readOnly]) =>
      findOrCreateText(guild, catMap.get(spec.name), chName, `${profile.name} channel for ${serverName}`, { readOnly: !!readOnly }))));
    desiredTemplateSpecs = specs;
    templateLabel = profile.name;
    templateSummary = getTemplateSummary(profile);
  } else if (mode === 'custom') {
    const templateSelections = Array.isArray(options.customTemplateSelections) ? options.customTemplateSelections : (snap.customTemplateSelections || []);
    const subtemplateSelections = Array.isArray(options.customSubtemplateSelections) ? options.customSubtemplateSelections : (snap.customSubtemplateSelections || []);
    let specs = require('./templateMixService').buildTemplateMixSpecs(templateSelections, subtemplateSelections)
      .map(c => ({ name: String(c.name || '').replace('{server}', serverName), channels: c.channels || [] }))
      .filter(c => !/welcome to|discipline|staff & commissioner/i.test(c.name));
    // Compatibility bridge for pre-v204.7 custom-pack settings. It is read-only fallback, not the new wizard model.
    if (!specs.length && Array.isArray(options.customSelections) && options.customSelections.length) {
      specs = require('./customMixService').buildChannelSpecs(options.customSelections).map(s => ({ name: s.categoryName, channels: s.channels || [] }));
    }
    if (!specs.length) throw new Error('Custom Structure requires at least one template selection');
    const catMap = new Map();
    await Promise.all(specs.map(async spec => { catMap.set(spec.name, await findOrCreateCategory(guild, spec.name)); }));
    await Promise.all(specs.flatMap(spec => (spec.channels || []).map(([chName, readOnly]) =>
      findOrCreateText(guild, catMap.get(spec.name), chName, `Custom template mix for ${serverName}`, { readOnly: !!readOnly }))));
    desiredTemplateSpecs = specs;
    templateLabel = 'Custom Structure';
    templateSummary = require('./templateMixService').buildSelectionSummary(templateSelections, subtemplateSelections);
  }

  const templateReconciliation = require('./templateReconciliationService');
  const finalResults = await Promise.allSettled([
    normalizeBaseChannelPolicies(guild),
    reorderBaseCategoryStack(guild),
    postBaseGuideMessages(guild),
    patchNotesService.publishPatchNotes(guild).catch(() => null),
  ]);
  const finalFailure = finalResults.find(result => result.status === 'rejected');
  if (finalFailure) throw finalFailure.reason;
  await _silentDedupSweep(guild);
  templateReconciliation.recordDesired(guild, desiredTemplateSpecs);
  return { serverName, flushSummary, template: templateLabel, structureMode: mode, templateSummary,
    customSelections: mode === 'custom' ? (options.customSelections || []) : [],
    customTemplateSelections: mode === 'custom' ? (options.customTemplateSelections || snap.customTemplateSelections || []) : [],
    customSubtemplateSelections: mode === 'custom' ? (options.customSubtemplateSelections || snap.customSubtemplateSelections || []) : [] };
}


async function initializeBaseStructure(guild, state, options = {}) {
  const { flush = true } = options;
  // V195: Reset per-build category registry at start of base init too
  _clearBuildRegistry(guild.id);
  // Blueprint: one local settings snapshot — never pulled from outer scope
  const snap = {
    ...serverSettings.getSettings(),
    ...(options.settings || {}),
    serverTemplate: String(options?.settings?.serverTemplate ?? serverSettings.getSettings().serverTemplate ?? '').toLowerCase(),
  };
  const serverName = resolveServerName(guild, 'this server');
  const flushSummary = flush ? await flushServerChannels(guild, options) : { deletedChannels:0, deletedCategories:0 };
  if (flush) {
    resetBotState(state);
    // V186 FIX: Refresh channel cache after flush so findOrCreate sees the real state
    await guild.channels.fetch().catch(() => null);
  }

  // V198 FIX: Create base categories in parallel — they are independent
  const [welcomeCat, communityCat, disciplineCat, staffCat] = await Promise.all([
    findOrCreateCategory(guild, `👋 Welcome to ${serverName}`),
    findOrCreateCategory(guild, '💬 Community'),
    findOrCreateCategory(guild, '⚖️ Discipline & Activity'),
    findOrCreateCategory(guild, '🧠 Staff & Commissioner', staffRoleOverwrites(guild)),
  ]);

  // V198 FIX: Create base channels in parallel per category group
  await Promise.all([
    findOrCreateText(guild, welcomeCat, 'welcome', `Welcome members to ${serverName}.`, { readOnly: true }),
    findOrCreateText(guild, welcomeCat, 'rules', serverRulesChannelTopic(snap), { readOnly: true }),
    findOrCreateText(guild, welcomeCat, templateLogic.getGuideChannelName(snap), templateLogic.getGuideChannelTopic(snap), { readOnly: true }),
    findOrCreateText(guild, welcomeCat, 'how-to-join', 'How new members join the server and reach the right areas.', { readOnly: true }),
    findOrCreateText(guild, welcomeCat, 'announcements', 'Commissioner and bot announcements only.', { readOnly: true }),
    findOrCreateText(guild, communityCat, 'general-chat', 'General server chat and member discussion.', {}),
    findOrCreateText(guild, communityCat, 'polls', 'Community polls and votes. Members vote through poll picklists only.', { readOnly: true }),
    findOrCreateText(guild, disciplineCat, 'active-check', 'Member activity checks and roll calls.', {}),
    findOrCreateText(guild, disciplineCat, 'warnings-log', 'Commissioner/admin warnings and discipline record.', { readOnly: true }),
    findOrCreateText(guild, disciplineCat, 'boot-log', 'Boot/removal actions and discipline trail.', { readOnly: true }),
  ]);

  // V198 FIX: Set positions in parallel
  await Promise.allSettled([
    welcomeCat.setPosition(0),
    communityCat.setPosition(1),
    disciplineCat.setPosition(2),
    staffCat.setPosition(3),
  ]);

  // V198 FIX: Create staff channels in parallel
  await Promise.all([
    findOrCreateText(guild, staffCat, 'commissioner-ai', 'AI commissioner tools and staff requests.', { staffOnly: true }),
    findOrCreateText(guild, staffCat, 'admin-hq', 'Admin-only bot operations and league controls.', { staffOnly: true }),
    findOrCreateText(guild, staffCat, 'commish-hub', 'Commissioner screenshots, notes, and workflow hub.', { staffOnly: true }),
    findOrCreateText(guild, staffCat, 'scoresheets', 'Private score/stat processing intake.', { staffOnly: true }),
  ]);

  // V198 FIX: normalizeBaseChannelPolicies, reorderBaseCategoryStack, postBaseGuideMessages,
  // and publishPatchNotes are NOT called here anymore. They run ONCE in createTemplateStructure
  // and applyEditChanges AFTER all channels (base + template) are created. Previously they ran
  // here AND again in the caller — doubling every permission edit, message post, and reorder.

  return {
    serverName,
    flushSummary,
    categories: { welcome: welcomeCat.id, community: communityCat.id, discipline: disciplineCat.id, staff: staffCat.id }
  };
}

/**
 * V186: Non-destructive edit path.
 * Applies template/settings changes WITHOUT flushing existing channels.
 * Only creates missing channels/categories and updates permissions/policies.
 * Called when the wizard is in edit mode (after first successful build).
 *
 * @param {Object} guild
 * @param {Object} state
 * @param {string} templateKey
 * @param {Object} options - { settings, structureMode, customSelections, arrangementMode }
 */
async function applyEditChanges(guild, state, templateKey = 'gaming', options = {}) {
  _clearBuildRegistry(guild.id);
  const snap = { ...serverSettings.getSettings(), ...(options.settings || {}) };
  const serverName = guild.name || 'Server';
  const modeRaw = String(options.structureMode || snap.customStructureMode || 'base').toLowerCase();
  const mode = ['base','template','custom'].includes(modeRaw) ? modeRaw : 'base';
  await guild.channels.fetch().catch(() => null);
  const templateReconciliation = require('./templateReconciliationService');
  const priorTemplate = templateReconciliation.capture(guild);

  // Edit mode is non-destructive for core lanes. Ensure the base core exists without flushing.
  await initializeBaseStructure(guild, state, { flush: false, ...options, settings: snap });
  await guild.channels.fetch().catch(() => null);

  let desiredSpecs = [];
  let templateLabel = 'Base Structure';
  let templateSummary = 'Core bot/server lanes only. No template or subtemplate is applied.';

  if (mode === 'template') {
    if (!snap.serverTemplate) throw new Error('Template Structure requires a server template');
    const profile = resolveTemplateProfile({ ...snap, serverTemplate: String(templateKey || snap.serverTemplate).toLowerCase() });
    desiredSpecs = (profile.categories || [])
      .map(c => ({ name: String(c.name || '').replace('{server}', serverName), channels: c.channels || [] }))
      .filter(c => !/welcome to|discipline|staff & commissioner/i.test(c.name));
    templateLabel = profile.name; templateSummary = getTemplateSummary(profile);
  } else if (mode === 'custom') {
    const ts = Array.isArray(options.customTemplateSelections) ? options.customTemplateSelections : (snap.customTemplateSelections || []);
    const ss = Array.isArray(options.customSubtemplateSelections) ? options.customSubtemplateSelections : (snap.customSubtemplateSelections || []);
    desiredSpecs = require('./templateMixService').buildTemplateMixSpecs(ts, ss)
      .map(c => ({ name: String(c.name || '').replace('{server}', serverName), channels: c.channels || [] }))
      .filter(c => !/welcome to|discipline|staff & commissioner/i.test(c.name));
    if (!desiredSpecs.length && Array.isArray(options.customSelections) && options.customSelections.length) {
      desiredSpecs = require('./customMixService').buildChannelSpecs(options.customSelections).map(s => ({ name: s.categoryName, channels: s.channels || [] }));
    }
    if (!desiredSpecs.length) throw new Error('Custom Structure requires at least one template selection');
    templateLabel = 'Custom Structure'; templateSummary = require('./templateMixService').buildSelectionSummary(ts, ss);
  }

  const catMap = new Map();
  await Promise.all(desiredSpecs.map(async spec => { catMap.set(spec.name, await findOrCreateCategory(guild, spec.name)); }));
  await Promise.all(desiredSpecs.flatMap(spec => (spec.channels || []).map(([chName, readOnly]) =>
    findOrCreateText(guild, catMap.get(spec.name), chName, `${templateLabel} channel for ${serverName}`, { readOnly: !!readOnly }))));

  const templateCleanup = await templateReconciliation.reconcile(guild, priorTemplate, desiredSpecs, cat => _isProtectedScopeCategory(guild, cat));
  const finalResults = await Promise.allSettled([ normalizeBaseChannelPolicies(guild), reorderBaseCategoryStack(guild), postBaseGuideMessages(guild) ]);
  const finalFailure = finalResults.find(result => result.status === 'rejected');
  if (finalFailure) throw finalFailure.reason;
  await _silentDedupSweep(guild);
  templateReconciliation.recordDesired(guild, desiredSpecs);
  return { serverName, flushSummary: templateCleanup, template: templateLabel, structureMode: 'edit-apply', templateSummary,
    customSelections: mode === 'custom' ? (options.customSelections || []) : [],
    customTemplateSelections: mode === 'custom' ? (options.customTemplateSelections || snap.customTemplateSelections || []) : [],
    customSubtemplateSelections: mode === 'custom' ? (options.customSubtemplateSelections || snap.customSubtemplateSelections || []) : [] };
}


module.exports = { initializeBaseStructure, ensureBaseStructure: initializeBaseStructure, normalizeBaseChannelPolicies, resetToInstallationMode, createTemplateStructure, applyEditChanges, reorderBaseCategoryStack, findOrCreateCategory, findOrCreateText, SERVER_TEMPLATES, _internals: { _silentDedupSweep, _isProtectedScopeCategory } };
