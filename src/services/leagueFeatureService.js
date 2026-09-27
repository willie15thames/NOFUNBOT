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
const { leagueChannelName, legacyTwoCharChannelName } = require('./leagueNamingService');
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
  const legacyName = legacyTwoCharChannelName(league.leagueName, 'active-check');
  const existing = guild.channels.cache.get(getLeague(league.id).channelId || '')
    || guild.channels.cache.find(c => c.isTextBased?.() && (c.name === desiredName || c.name === legacyName));
  if (existing) return existing;

  let parent = null;
  for (const id of league.builtCategoryIds || []) {
    const ch = guild.channels.cache.get(id);
    if (ch?.type === ChannelType.GuildCategory && /gameplay|league/i.test(String(ch.name || ''))) { parent = ch; break; }
  }
  if (!parent) parent = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && /gameplay|league/i.test(String(c.name || ''))) || null;

  const overwrites = [
    { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
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
  }).catch(() => null);
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

  for (const league of leagues) {
    const cfg = getLeague(league.id);
    if (!cfg.activeCheckEnabled || !cfg.channelId) continue;
    const ch = guild.channels.cache.get(cfg.channelId);
    if (!ch) continue;

    const members = (state.openTeamRegistry || [])
      .filter(t => String(t.leagueId || '') === String(league.id) && t.ownerId)
      .map(t => String(t.ownerId));
    if (!members.length) continue;

    const intervalMs = (cfg.intervalDays || ACTIVE_CHECK.INTERVAL_DAYS) * 24 * 60 * 60 * 1000;
    const windowMs = (cfg.responseWindowHours || ACTIVE_CHECK.RESPONSE_WINDOW_HOURS) * 60 * 60 * 1000;

    // ── Post new active check if interval elapsed and no window open ──
    if (!cfg.windowEndsAt && (!cfg.lastPostedAt || now - cfg.lastPostedAt >= intervalMs)) {
      const mentions = members.map(id => `<@${id}>`).join(' ');
      await ch.send({
        content: mentions,
        embeds: [new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('✅ Active Check')
          .setDescription(
            'League roll call. Reply in this channel within **48 hours** or risk an inactivity warning.\n\n' +
            `**${ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT} consecutive misses = automatic removal from the server.**`
          )
          .setFooter({ text: `This active check repeats every ${cfg.intervalDays || ACTIVE_CHECK.INTERVAL_DAYS} days while enabled.` })
          .setTimestamp()],
        allowedMentions: { users: members, parse: [] },
      }).catch(() => null);
      setLeague(league.id, { lastPostedAt: now, windowEndsAt: now + windowMs, respondedUserIds: [] });
      continue;
    }

    // ── Process window expiration ──
    if (cfg.windowEndsAt && now >= cfg.windowEndsAt) {
      const responded = new Set((cfg.respondedUserIds || []).map(String));
      const misses = members.filter(id => !responded.has(String(id)));
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
      setLeague(league.id, { windowEndsAt: null, respondedUserIds: [], consecutiveMisses });

      // ── Post missed check warning to warnings-log ──
      const warnCh = guild.channels.cache.find(c => c.isTextBased?.() && c.name === 'warnings-log');
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
      if (bootList.length) {
        await _executeAutoBoots(guild, state, league, bootList, consecutiveMisses);
      }

      // ── Observability ──
      try {
        require('./observabilityService').recordFlowOutcome('active-check-cycle', {
          outcome: 'processed',
          leagueId: league.id,
          responded: responded.size,
          missed: misses.length,
          booted: bootList.length,
          warned: warnList.length,
        });
      } catch {}
    }
  }
}

// ── Auto-boot execution ─────────────────────────────────────────

async function _executeAutoBoots(guild, state, league, bootList, consecutiveMisses) {
  const bootCh = guild.channels.cache.find(c => c.isTextBased?.() && c.name === 'boot-log');

  for (const userId of bootList) {
    const member = await guild.members.fetch(userId).catch(() => null);
    const tag = member?.user?.tag || member?.user?.username || userId;

    // Release team
    const teamEntry = (state.openTeamRegistry || []).find(t => String(t.ownerId) === String(userId));
    if (teamEntry) {
      teamEntry.ownerId = null;
      teamEntry.isOpen = true;
      ledger.recordTeamRelease(userId);
    }

    // Record in ledger
    ledger.recordLeave(
      { id: userId, user: { id: userId, tag } },
      'kick',
      `Auto-booted: ${ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT} consecutive active check misses`,
      guild.members?.me?.id || 'bot'
    );

    // Post to boot log
    if (bootCh) {
      await bootCh.send({
        embeds: [new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('🥾 Auto-Boot — Inactivity')
          .setDescription(`**${tag}** has been removed for missing **${ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT}** consecutive active checks.`)
          .addFields(
            { name: 'League', value: league.leagueName || 'Unknown', inline: true },
            { name: 'Consecutive Misses', value: String(consecutiveMisses[userId] || ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT), inline: true },
            { name: 'Team Released', value: teamEntry?.displayTeam || 'None', inline: true },
          )
          .setTimestamp()],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }

    // Kick from server
    if (member) {
      await member.kick(`Auto-booted: ${ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT} consecutive active check misses`).catch(e => {
        log.error(`Auto-boot kick failed for ${tag}: ${e.message}`);
      });
    }

    // Reset their miss counter
    consecutiveMisses[userId] = 0;
    log.info(`Auto-booted ${tag} from ${league.leagueName} — ${ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT} consecutive misses`);
  }

  // Escalate to commissioner
  try {
    const escalation = require('./escalationService');
    await escalation.escalate('active-check-boot', {
      guild,
      message: `${bootList.length} member(s) auto-booted from **${league.leagueName || 'League'}** for ${ACTIVE_CHECK.CONSECUTIVE_MISS_BOOT} consecutive active check misses.`,
      force: true,
    });
  } catch {}
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
};
