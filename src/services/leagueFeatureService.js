/*
 * NAVIGATION HEADER
 * FILE: src/services/leagueFeatureService.js
 * LAYER: Service layer
 * PURPOSE: Active check scheduling, miss tracking, auto-boot at 5 consecutive misses,
 *          league feature toggles, and active-check response recording.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for processDueActiveChecks, recordActiveCheckResponse, _executeAutoBoots.
 * RELATED FLOW: flowDefinitions.js (active-check-cycle), escalationService.js, memberLedgerService.js.
 * NOTE: V195 — added consecutive miss tracking per user and auto-boot at 5 misses.
 */

'use strict';

const { loadJson, saveJsonDebounced } = require('../storage/jsonStore');
const { EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const ledger = require('./memberLedgerService');
const { makeLogger } = require('../utils/logger');
const { ACTIVE_CHECK } = require('../config/constants');
const { leagueChannelName, matchesLeagueChannelKey } = require('./leagueNamingService');
const log = makeLogger('leagueFeatures');

const FILE = 'leagueFeatures.json';
const DEFAULTS = {};

function getAll() {
  const raw = loadJson(FILE, DEFAULTS) || {};
  return raw && typeof raw === 'object' ? raw : {};
}
function saveAll(v) { saveJsonDebounced(FILE, v); return v; }

function getLeague(id) {
  return getAll()[String(id)] || {
    activeCheckEnabled: false,
    intervalDays: ACTIVE_CHECK.INTERVAL_DAYS,
    responseWindowHours: ACTIVE_CHECK.RESPONSE_WINDOW_HOURS,
    channelId: null,
    lastPostedAt: null,
    windowEndsAt: null,
    respondedUserIds: [],
    consecutiveMisses: {},
  };
}

function setLeague(id, patch) {
  const all = getAll();
  all[String(id)] = { ...getLeague(id), ...patch };
  saveAll(all);
  return all[String(id)];
}

// ── Channel provisioning ────────────────────────────────────────

async function ensureLeagueActiveCheckChannel(guild, league) {
  const desiredName = leagueChannelName(league.leagueName, 'active-check', league.leagueName || 'league');
  const ownedCategories = new Set((league.builtCategoryIds || []).map(String));
  const stored = guild.channels.cache.get(getLeague(league.id).channelId || '');
  const existing = (stored && ownedCategories.has(String(stored.parentId)) ? stored : null)
    || guild.channels.cache.find(c => c.isTextBased?.() && ownedCategories.has(String(c.parentId)) && matchesLeagueChannelKey(c.name,'active-check'));
  if (existing) {
    if (!league.memberRoleId) throw new Error('League member role is missing; repair private access before enabling active checks');
    await existing.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
    await existing.permissionOverwrites.edit(league.memberRoleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    return existing;
  }

  let parent = null;
  for (const id of league.builtCategoryIds || []) {
    const ch = guild.channels.cache.get(id);
    if (ch?.type === ChannelType.GuildCategory && /gameplay|league/i.test(String(ch.name || ''))) { parent = ch; break; }
  }
  if (!parent) parent = (league.builtCategoryIds || []).map(id => guild.channels.cache.get(id)).find(c => c?.type === ChannelType.GuildCategory) || null;
  if (!parent || !league.memberRoleId) throw new Error('This league needs its private category and member role repaired before active checks can be enabled');

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: league.memberRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  if (guild.members?.me?.id) overwrites.push({
    id: guild.members.me.id,
    allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
  });

  const ch = await guild.channels.create({
    name: desiredName,
    type: ChannelType.GuildText,
    parent: parent?.id,
    topic: `${league.leagueName} active check channel`,
    permissionOverwrites: overwrites,
  });
  const builtChannelIds = [...new Set([...(league.builtChannelIds || []), ch.id])];
  require('./activeLeagueService').upsertLeague({ ...league, builtChannelIds });
  const managed = await require('./managedSpaceService').list(guild.id);
  if (managed.some(s => s.id === league.id)) await require('./managedSpaceService').transition(guild.id, league.id, 'ACTIVE', { builtChannelIds });
  return ch;
}

// ── Toggle ──────────────────────────────────────────────────────

async function toggleActiveCheckForLeague(guild, league, state) {
  const current = getLeague(league.id);
  if (current.activeCheckEnabled) {
    return {
      enabled: false,
      settings: setLeague(league.id, { activeCheckEnabled: false, windowEndsAt: null, respondedUserIds: [], consecutiveMisses: {} }),
    };
  }
  const ch = await ensureLeagueActiveCheckChannel(guild, league);
  const next = setLeague(league.id, {
    activeCheckEnabled: true,
    channelId: ch?.id || null,
    intervalDays: ACTIVE_CHECK.INTERVAL_DAYS,
    responseWindowHours: ACTIVE_CHECK.RESPONSE_WINDOW_HOURS,
    lastPostedAt: null,
    windowEndsAt: null,
    respondedUserIds: [],
    consecutiveMisses: {},
  });
  return { enabled: true, settings: next, channel: ch };
}

// ── Response recording ──────────────────────────────────────────

function recordActiveCheckResponse(channelId, userId) {
  const all = getAll();
  let touched = false;

  for (const [leagueId, cfg] of Object.entries(all)) {
    if (!cfg.activeCheckEnabled || !cfg.channelId || String(cfg.channelId) !== String(channelId) || !cfg.windowEndsAt) continue;
    const arr = Array.isArray(cfg.respondedUserIds) ? cfg.respondedUserIds : [];
    if (!arr.includes(String(userId))) arr.push(String(userId));
    cfg.respondedUserIds = arr;
    // V195: Reset consecutive miss counter on response
    const misses = cfg.consecutiveMisses || {};
    if (misses[String(userId)]) {
      misses[String(userId)] = 0;
      cfg.consecutiveMisses = misses;
    }
    touched = true;
  }
  if (touched) saveAll(all);
}

// ── Get miss count for a user ──────────────────────────────────

function getConsecutiveMisses(leagueId, userId) {
  const cfg = getLeague(leagueId);
  return (cfg.consecutiveMisses || {})[String(userId)] || 0;
}

// ── Core scheduler ──────────────────────────────────────────────

// V202 (BUG-008): single-flight — an overlapping call (slow Discord, duplicate scheduler) is a no-op.
let _activeChecksInFlight = false;
async function processDueActiveChecks(guild, state) {
  if (_activeChecksInFlight) return { skipped: 'in-flight' };
  _activeChecksInFlight = true;
  try { return await _processDueActiveChecksOnce(guild, state); }
  finally { _activeChecksInFlight = false; }
}

async function _processDueActiveChecksOnce(guild, state) {
  const activeLeagueService = require('./activeLeagueService');
  const all = getAll();
  const leagues = activeLeagueService.listActiveLeagues();
  const now = Date.now();

  const outcome={errors:[],processed:[]};
  for (const league of leagues) {
    try {
    const cfg = getLeague(league.id);
    if (!cfg.activeCheckEnabled || !cfg.channelId) continue;
    const ch = guild.channels.cache.get(cfg.channelId);
    if (!ch) continue;

    const removalJournal=await require('../storage/criticalStore').read(`v204:active-removals:${guild.id}:${league.id}`,{pending:[]});
    const pending=[...new Set([...(cfg.pendingRemovals||[]),...removalJournal.pending])];
    if(pending.length){const retried=await executeDurableRemovals(guild,state,league,pending,cfg.consecutiveMisses||{});setLeague(league.id,{pendingRemovals:retried.failed,consecutiveMisses:cfg.consecutiveMisses});}
    const teamEntries = (state.openTeamRegistry || [])
      .filter(t => String(t.leagueId || '') === String(league.id) && t.ownerId)
    const members = [...new Set(teamEntries.map(t => String(t.ownerId)))];
    if (!members.length) continue;

    const intervalMs = (cfg.intervalDays || ACTIVE_CHECK.INTERVAL_DAYS) * 24 * 60 * 60 * 1000;
    const windowMs = (cfg.responseWindowHours || ACTIVE_CHECK.RESPONSE_WINDOW_HOURS) * 60 * 60 * 1000;

    // ── Post new active check if interval elapsed and no window open ──
    if (!cfg.windowEndsAt && (!cfg.lastPostedAt || now - cfg.lastPostedAt >= intervalMs)) {
      const roleTag = league.memberRoleId ? `<@&${league.memberRoleId}>` : '';
      const names = members.map(id => {
        const team = require('./nicknamePolicyService').getDisplayForLeague(state, id, league.id);
        return `<@${id}>${team ? ` — ${team}` : ''}`;
      });
      const mentions = [roleTag, ...names].filter(Boolean).join('\n').slice(0, 1900);
      await ch.send({
        content: mentions,
        embeds: [new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('✅ Active Check')
          .setDescription(
            `League roll call. Reply in this channel within **${cfg.responseWindowHours || ACTIVE_CHECK.RESPONSE_WINDOW_HOURS} hours** or risk an inactivity warning.\n\n` +
            `**${ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT} consecutive misses = removal from this league only. Other memberships remain.**`
          )
          .setFooter({ text: `This active check repeats every ${cfg.intervalDays || ACTIVE_CHECK.INTERVAL_DAYS} days while enabled.` })
          .setTimestamp()],
        // One role ping reaches this league. Member labels provide context
        // without giving a member a channel-dependent Discord nickname.
        allowedMentions: roleTag ? { roles: [league.memberRoleId], parse: [] } : { users: members, parse: [] },
      });
      setLeague(league.id, { lastPostedAt: now, windowEndsAt: now + windowMs, respondedUserIds: [], notifiedUserIds: members });
      continue;
    }

    // ── Process window expiration ──
    if (cfg.windowEndsAt && now >= cfg.windowEndsAt) {
      const responded = new Set((cfg.respondedUserIds || []).map(String));
      const misses = (cfg.notifiedUserIds || []).filter(id => members.includes(String(id)) && !responded.has(String(id))); // Legacy windows without an audience snapshot cannot charge absences.
      const consecutiveMisses = { ...(cfg.consecutiveMisses || {}) };

      // Reset counter for people who responded
      for (const uid of responded) {
        if (consecutiveMisses[uid]) consecutiveMisses[uid] = 0;
      }

      const bootList = [];
      const warnList = [];

      for (const uid of misses) {
        consecutiveMisses[uid] = (consecutiveMisses[uid] || 0) + 1;
        const count = consecutiveMisses[uid];
        ledger.recordWarning(uid, 'inactivity', `Missed active check (${count} consecutive)`);

        if (count >= ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT) {
          bootList.push(uid);
        } else if (count >= ACTIVE_CHECK.WARN_THRESHOLD) {
          warnList.push(uid);
        }
      }

      // Save updated miss counters
      setLeague(league.id, { windowEndsAt: null, respondedUserIds: [], consecutiveMisses, pendingRemovals: [...new Set([...(cfg.pendingRemovals||[]),...bootList])] });

      // ── Post missed check warning to warnings-log ──
      const warnCh = guild.channels.cache.find(c => c.isTextBased?.() && c.name === 'warnings-log' && (league.builtCategoryIds||[]).includes(c.parentId));
      if (misses.length && warnCh) {
        const lines = misses.map(id => {
          const count = consecutiveMisses[id] || 0;
          const icon = count >= ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT ? '🔴' : count >= ACTIVE_CHECK.WARN_THRESHOLD ? '🟠' : '🟡';
          return `${icon} <@${id}> — **${count}** consecutive miss${count !== 1 ? 'es' : ''}`;
        });
        await warnCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0xe67e22)
            .setTitle(`⚠️ Active Check Missed — ${league.leagueName || 'League'}`)
            .setDescription(lines.join('\n'))
            .setFooter({ text: `${ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT} consecutive misses = auto-boot` })
            .setTimestamp()],
          allowedMentions: { parse: [] },
        }).catch(() => null);
      }

      // ── Escalate members near boot threshold ──
      if (warnList.length) {
        try {
          const escalation = require('./escalationService');
          await escalation.escalate('active-check-warn', {
            guild,
            message: `${warnList.length} member(s) at ${ACTIVE_CHECK.WARN_THRESHOLD}+ consecutive active check misses:\n` +
              warnList.map(id => `<@${id}> (${consecutiveMisses[id]} misses)`).join('\n'),
            force: true,
          });
        } catch {}
      }

      // ── Auto-boot members at 5 consecutive misses ──
      let bootResult={succeeded:[],failed:[]};
      if (bootList.length) bootResult=await executeDurableRemovals(guild, state, league, bootList, consecutiveMisses);
      setLeague(league.id,{consecutiveMisses,pendingRemovals:bootResult.failed});

      // ── Observability ──
      try {
        require('./observabilityService').recordFlowOutcome('active-check-cycle', {
          outcome: 'processed',
          leagueId: league.id,
          responded: responded.size,
          missed: misses.length,
          booted: bootResult.succeeded.length,
          warned: warnList.length,
        });
      } catch {}
    }
    outcome.processed.push(league.id);
    }catch(err){outcome.errors.push({leagueId:league.id,error:err.message});log.error(`Active check failed for ${league.id}: ${err.message}`);}
  }
  return outcome;
}

// ── Auto-boot execution ─────────────────────────────────────────

async function executeDurableRemovals(guild,state,league,ids,misses){
  const store=require('../storage/criticalStore'),key=`v204:active-removals:${guild.id}:${league.id}`;
  const pending=await store.transact(key,{pending:[]},data=>{data.pending=[...new Set([...data.pending,...ids])];return data.pending;});
  const result=await _executeAutoBoots(guild,state,league,pending,misses);
  await store.transact(key,{pending:[]},data=>{data.pending=data.pending.filter(id=>!result.succeeded.includes(id));});
  return result;
}

async function _executeAutoBoots(guild, state, league, bootList, consecutiveMisses) {
  const bootCh = require('./channelTopologyService').findConfiguredChannel(guild, 'bootLog', { textOnly: true });

  const result={succeeded:[],failed:[]};
  for (const userId of bootList) {
    const member = await guild.members.fetch(userId).catch(() => null);
    const tag = member?.user?.tag || member?.user?.username || userId;

    // Remove only this league's membership. Kicking from the guild also
    // removes access to other leagues and events and is never appropriate
    // for one league's inactivity policy.
    let teamEntry;
    try {
      teamEntry = await require('./openTeamsService').releaseByUserId(guild, userId, league.id);
      if (!teamEntry) await require('./leagueVisibilityService').revokeMemberAccess(guild, userId, league.id);
      if (teamEntry) ledger.recordTeamRelease(userId, league.id);
    } catch (err) {
      result.failed.push(userId);
      log.error(`League inactivity removal failed for ${tag}: ${err.message}`);
      continue;
    }

    // Post to boot log
    if (bootCh) {
      await bootCh.send({
        embeds: [new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('🥾 League Removal — Inactivity')
          .setDescription(`**${tag}** has been removed from **${league.leagueName}** for missing **${ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT}** consecutive active checks. Other memberships remain.`)
          .addFields(
            { name: 'League', value: league.leagueName || 'Unknown', inline: true },
            { name: 'Consecutive Misses', value: String(consecutiveMisses[userId] || ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT), inline: true },
            { name: 'Team Released', value: teamEntry?.displayTeam || 'None', inline: true },
          )
          .setTimestamp()],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }

    result.succeeded.push(userId);
    // Reset their miss counter
    consecutiveMisses[userId] = 0;
    log.info(`Removed ${tag} from ${league.leagueName} — ${ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT} consecutive misses`);
  }

  // Escalate to commissioner
  try {
    const escalation = require('./escalationService');
    await escalation.escalate('active-check-boot', {
      guild,
      message: `${bootList.length} member(s) reached the inactivity removal threshold in **${league.leagueName || 'League'}**. Verify the league-only removal log; other memberships remain.`,
      force: true,
    });
  } catch {}
  return result;
}

// ── Status query ────────────────────────────────────────────────

function getActiveCheckStatus(leagueId) {
  const cfg = getLeague(leagueId);
  return {
    enabled: !!cfg.activeCheckEnabled,
    intervalDays: cfg.intervalDays || ACTIVE_CHECK.INTERVAL_DAYS,
    responseWindowHours: cfg.responseWindowHours || ACTIVE_CHECK.RESPONSE_WINDOW_HOURS,
    lastPostedAt: cfg.lastPostedAt,
    windowEndsAt: cfg.windowEndsAt,
    respondedCount: (cfg.respondedUserIds || []).length,
    consecutiveMisses: cfg.consecutiveMisses || {},
  };
}

module.exports = {
  getAll,
  getLeague,
  setLeague,
  toggleActiveCheckForLeague,
  processDueActiveChecks,
  recordActiveCheckResponse,
  getConsecutiveMisses,
  getActiveCheckStatus,
  _internals: { executeAutoBoots: _executeAutoBoots },
};
