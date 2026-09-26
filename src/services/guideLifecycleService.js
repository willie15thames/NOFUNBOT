/*
 * NAVIGATION HEADER
 * FILE: src/services/guideLifecycleService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * guideLifecycleService.js
 *
 * Implements Blueprint Section 2 — Inactivity-Based Guide Refresh.
 * Owns: idle timers, guide anchor IDs, state-hash-gated re-render.
 *
 * Guide channel roles:
 *   setup-wizard   → managed by wizardRendererService; guideLifecycle defers to wizard state hash
 *   welcome        → refresh on member join burst + inactivity
 *   server-guide   → refresh on week advance, wizard state change, template change
 *   community      → refresh on inactivity only
 *   patch-notes    → refresh on each publishPatchNotes() call; always read-only
 *
 * Storage: guide_state table (V110 migration) or jsonStore fallback.
 */

const { createHash }  = require('crypto');
const { makeLogger }  = require('../utils/logger');
const { loadJson, saveJson } = require('../storage/jsonStore');
const serverSettings  = require('./serverSettingsService');
const log = makeLogger('guideLifecycle');

const STORE_FILE = 'guideState.json';

// Default idle window: 15 minutes
const DEFAULT_IDLE_MS = 15 * 60 * 1000;

// ── Guide channel role registry ────────────────────────────────
const GUIDE_ROLES = {
  setupWizard:  'setup-wizard',
  welcome:      'welcome',
  serverGuide:  'server-guide',
  communityChat:'community',
  patchNotes:   'patch-notes',
};

// ── State store (JSON fallback until Prisma is wired) ──────────
function _loadStore() {
  return loadJson(STORE_FILE, {});
}

function _saveStore(data) {
  saveJson(STORE_FILE, data);
}

function _storeKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function getGuideState(guildId, channelId) {
  const store = _loadStore();
  return store[_storeKey(guildId, channelId)] || null;
}

function setGuideState(guildId, channelId, patch) {
  const store = _loadStore();
  const key   = _storeKey(guildId, channelId);
  store[key]  = { ...(store[key] || {}), ...patch, updatedAt: Date.now() };
  _saveStore(store);
  return store[key];
}

// ── State hash computation ─────────────────────────────────────
// Hashes only guide-relevant fields so unrelated state changes don't trigger re-renders.
function _computeHash(role, guild, state, settings) {
  try {
    const s = settings || serverSettings.getSettings();
    let fields = {};
    if (role === 'welcome') {
      fields = {
        serverName: guild?.name,
        template: s.serverTemplate,
        audienceRating: s.audienceRating,
      };
    } else if (role === 'server-guide') {
      fields = {
        leagueName:  state?.leagueConfig?.leagueName,
        currentWeek: state?.scheduleState?.week,
        template:    s.serverTemplate,
        subtemplate: s.serverSubtemplate,
        rulesHash:   createHash('md5').update(String(state?.leagueConfig?.rulesText || '')).digest('hex').slice(0, 8),
      };
    } else if (role === 'setup-wizard') {
      fields = {
        template:    s.serverTemplate,
        structure:   s.customStructureMode,
        audience:    s.audienceRating,
        initialized: s.serverInitialized,
      };
    } else if (role === 'community') {
      fields = {
        serverName:  guild?.name,
        template:    s.serverTemplate,
        subtemplate: s.serverSubtemplate,
      };
    } else if (role === 'patch-notes') {
      fields = { patchNotesTs: Date.now() }; // always refresh
    }
    return createHash('sha256').update(JSON.stringify(fields)).digest('hex').slice(0, 16);
  } catch {
    return String(Date.now());
  }
}

// ── Core operations ────────────────────────────────────────────

/**
 * Record user activity in a channel.
 * Called from messageCreate for all managed guide channels.
 */
function recordActivity(guildId, channelId) {
  setGuideState(guildId, channelId, { lastActivityAt: Date.now() });
}

/**
 * Check if a channel's guide needs refreshing due to inactivity.
 * Returns true if idle window has elapsed since last activity.
 */
function isIdleRefreshDue(guildId, channelId) {
  const gs = getGuideState(guildId, channelId);
  if (!gs) return false;
  const idleMs = gs.idleRefreshAfterMs || DEFAULT_IDLE_MS;
  const last   = gs.lastActivityAt || 0;
  return (Date.now() - last) > idleMs;
}

/**
 * Check if a guide re-render is needed based on state hash change.
 */
function isStateHashStale(guildId, channelId, newHash) {
  const gs = getGuideState(guildId, channelId);
  if (!gs) return true;
  return gs.lastRenderedStateHash !== newHash;
}

/**
 * Main check function. Called on messageCreate for managed channels.
 * Returns { shouldRefresh, reason } — callers decide what to render.
 */
function checkChannel(guildId, channelId, guild, state, settings) {
  const gs = getGuideState(guildId, channelId);
  if (!gs?.guideChannelRole) return { shouldRefresh: false, reason: 'not-managed' };

  const hash = _computeHash(gs.guideChannelRole, guild, state, settings);

  // State change always wins over idle check
  if (isStateHashStale(guildId, channelId, hash)) {
    return { shouldRefresh: true, reason: 'state-change', hash };
  }
  if (isIdleRefreshDue(guildId, channelId)) {
    return { shouldRefresh: true, reason: 'idle-refresh', hash };
  }
  return { shouldRefresh: false, reason: 'up-to-date' };
}

/**
 * Register a channel as a managed guide lane.
 * Must be called when a channel is first created/resolved.
 */
function registerChannel(guildId, channelId, role, opts = {}) {
  setGuideState(guildId, channelId, {
    guideChannelRole:     role,
    idleRefreshAfterMs:   opts.idleRefreshAfterMs || DEFAULT_IDLE_MS,
    guideAnchorMessageId: opts.anchorMessageId    || null,
    pinnedGuideMessageId: opts.pinnedMessageId    || null,
    lastActivityAt:       opts.lastActivityAt     || Date.now(),
  });
  log.info(`Guide channel registered: ${role} → ${channelId}`);
}

/**
 * Update the anchor message ID after a guide post/edit.
 */
function setAnchorMessage(guildId, channelId, messageId) {
  setGuideState(guildId, channelId, { guideAnchorMessageId: messageId });
}

/**
 * Mark a guide as freshly rendered with the given hash and reason.
 */
function markRendered(guildId, channelId, hash, reason) {
  setGuideState(guildId, channelId, {
    lastRenderedStateHash: hash,
    lastRefreshReason:     reason,
    lastRefreshAt:         Date.now(),
  });
  log.info(`Guide refreshed [${reason}]: ${channelId} hash=${hash}`);
}

/**
 * Startup scan — check all registered guide channels for staleness.
 * Called from clientReady after all channels are resolved.
 * Returns array of { guildId, channelId, reason } objects needing refresh.
 */
function startupScan(guild, state, settings) {
  const store  = _loadStore();
  const stale  = [];
  for (const [key, gs] of Object.entries(store)) {
    if (!gs?.guideChannelRole) continue;
    const [guildId, channelId] = key.split(':');
    if (guildId !== guild?.id) continue;
    const hash   = _computeHash(gs.guideChannelRole, guild, state, settings);
    const reason = isStateHashStale(guildId, channelId, hash) ? 'state-change'
      : isIdleRefreshDue(guildId, channelId)                  ? 'idle-refresh'
      : null;
    if (reason) stale.push({ guildId, channelId, reason, hash, role: gs.guideChannelRole });
  }
  if (stale.length) log.info(`Startup scan: ${stale.length} guide channel(s) need refresh.`);
  return stale;
}

/**
 * Get the anchor message for a channel. Verifies bot ownership before trusting.
 * Returns null if the anchor is missing or not owned by the bot.
 */
async function getAnchorMessage(channel, botUserId) {
  const gs = getGuideState(channel.guild?.id, channel.id);
  if (!gs?.guideAnchorMessageId) return null;
  try {
    const msg = await channel.messages.fetch(gs.guideAnchorMessageId).catch(() => null);
    if (!msg) return null;
    if (msg.author?.id !== botUserId) {
      // Anchor was deleted and a non-bot message took the ID — clear it
      setGuideState(channel.guild?.id, channel.id, { guideAnchorMessageId: null });
      return null;
    }
    return msg;
  } catch {
    return null;
  }
}

/**
 * Force refresh all guide channels in a guild.
 * Called after server build and trash-rebuild completes.
 * Returns array of registered channel IDs.
 */
function forceRefreshAll(guildId) {
  const store = _loadStore();
  const affected = [];
  for (const [key, gs] of Object.entries(store)) {
    if (!key.startsWith(guildId + ':')) continue;
    const [, channelId] = key.split(':');
    // Clear hash so next checkChannel returns shouldRefresh=true
    store[key] = { ...gs, lastRenderedStateHash: null, lastActivityAt: Date.now() };
    affected.push(channelId);
  }
  _saveStore(store);
  log.info(`forceRefreshAll: ${affected.length} channels marked stale in ${guildId}`);
  return affected;
}

module.exports = {
  GUIDE_ROLES,
  getGuideState,
  setGuideState,
  registerChannel,
  recordActivity,
  checkChannel,
  isIdleRefreshDue,
  isStateHashStale,
  setAnchorMessage,
  markRendered,
  startupScan,
  getAnchorMessage,
  forceRefreshAll,
  sweepIdleGuides,
};

/**
 * V187: Sweep all registered template channels and post guide embeds
 * for any that have been idle past their window.
 *
 * Guide embeds only appear after inactivity — never during active conversation.
 * If a guide already exists (by title match), it's skipped.
 * If the channel has new activity since last check, the guide is deferred.
 *
 * @param {Object} guild - Discord guild
 * @returns {{ posted: number, skipped: number, errors: number }}
 */
async function sweepIdleGuides(guild) {
  if (!guild?.channels?.cache) return { posted: 0, skipped: 0, errors: 0 };

  let channelGuideService;
  try { channelGuideService = require('./channelGuideService'); } catch { return { posted: 0, skipped: 0, errors: 0 }; }

  const store = _loadStore();
  let posted = 0, skipped = 0, errors = 0;

  for (const [key, gs] of Object.entries(store)) {
    if (!gs?.guideChannelRole || gs.guideChannelRole !== 'template-channel') continue;
    const [guildId, channelId] = key.split(':');
    if (guildId !== guild.id) continue;

    // Check idle window
    const idleMs = gs.idleRefreshAfterMs || DEFAULT_IDLE_MS;
    const lastActivity = gs.lastActivityAt || 0;
    if (Date.now() - lastActivity < idleMs) { skipped++; continue; }

    // Already posted a guide since last activity?
    const lastRefresh = gs.lastRefreshAt || 0;
    if (lastRefresh > lastActivity) { skipped++; continue; }

    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased?.()) { skipped++; continue; }

    const cleanName = String(channel.name || '').toLowerCase().replace(/^[^\w-]+/, '').trim();
    const guideEntry = channelGuideService.getGuideForChannel(cleanName);
    if (!guideEntry) { skipped++; continue; }

    try {
      // Check if a matching guide embed already exists (don't duplicate)
      const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
      if (recent) {
        const hasGuide = [...recent.values()].some(m =>
          m.author?.id === guild.members.me?.id && m.embeds?.[0]?.title === guideEntry.title
        );
        if (hasGuide) {
          markRendered(guildId, channelId, 'idle-guide', 'already-exists');
          skipped++;
          continue;
        }
      }

      await channel.send({
        embeds: [{
          color: guideEntry.color,
          title: guideEntry.title,
          description: guideEntry.description,
          footer: { text: 'This guide appears after channel inactivity.' },
          timestamp: new Date().toISOString(),
        }],
        allowedMentions: { parse: [] },
      });

      markRendered(guildId, channelId, 'idle-guide', 'idle-refresh');
      posted++;
    } catch (err) {
      log.warn(`sweepIdleGuides failed for #${channel.name}: ${err.message}`);
      errors++;
    }
  }

  if (posted > 0) log.info(`[IDLE-GUIDES] Posted ${posted} guide(s), skipped ${skipped}, errors ${errors}`);
  return { posted, skipped, errors };
}
