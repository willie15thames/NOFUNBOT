/*
 * NAVIGATION HEADER
 * FILE: src/services/diagnosticService.js
 * LAYER: Service layer
 * PURPOSE: Centralized bot self-diagnosis. Collects environment, runtime, state, DB, channel,
 *          permission, flow, and component health into a structured report. Used by:
 *          - /diagnose slash command (on-demand report)
 *          - Commissioner AI system prompt (awareness block)
 *          - IT handler AI system prompt (already had per-handler collectors — now shared)
 * LOOK HERE FIRST WHEN DEBUGGING: Search for runFullDiagnosis, collectAll.
 * RELATED FLOW: itHandler.js, commissionerHandler.js, interactionRouter.js.
 * NOTE: V197 — introduced. Does NOT introduce a dedup layer.
 */

'use strict';

const { EmbedBuilder } = require('discord.js');
const { makeLogger } = require('../utils/logger');
const { CHANNEL_KEYS } = require('../config/channels');
const log = makeLogger('diagnostic');

// ── Environment ─────────────────────────────────────────────────

function collectEnv() {
  const bool = v => v ? '✅' : '❌';
  return {
    DISCORD_TOKEN: bool(process.env.DISCORD_TOKEN),
    CLIENT_ID: bool(process.env.CLIENT_ID),
    GUILD_ID: process.env.GUILD_ID || '❌ NOT SET',
    COMMISSIONER_ROLE_ID: process.env.COMMISSIONER_ROLE_ID || '⚠️ NOT SET',
    IT_ROLE_ID: process.env.IT_ROLE_ID || '⚠️ NOT SET',
    ANTHROPIC_API_KEY: bool(process.env.ANTHROPIC_API_KEY),
    DATABASE_URL: bool(process.env.DATABASE_URL),
    REDIS_URL: bool(process.env.REDIS_URL),
    BOT_DATA_DIR: process.env.BOT_DATA_DIR || '⚠️ /tmp (ephemeral)',
    NODE_ENV: process.env.NODE_ENV || 'not set',
  };
}

// ── Runtime ─────────────────────────────────────────────────────

function collectRuntime(state, client) {
  const uptime = process.uptime();
  const mem = process.memoryUsage();
  return {
    uptimeMinutes: Math.floor(uptime / 60),
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
    guilds: client?.guilds?.cache?.size || 0,
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
  };
}

// ── State ───────────────────────────────────────────────────────

function collectState(state) {
  if (!state) return { error: 'state not loaded' };
  return {
    players: state.players?.size || 0,
    openTeams: (state.openTeamRegistry || []).length,
    claimedTeams: (state.openTeamRegistry || []).filter(t => t.ownerId).length,
    pendingTrades: state.pendingTrades?.size || 0,
    pendingBoosts: state.pendingAttrBoosts?.size || 0,
    pendingOffenses: state.pendingOffenses?.size || 0,
    currentWeek: state.scheduleState?.week || null,
    matchups: state.scheduleState?.matchups?.length || 0,
    potwHistory: state.potwHistory?.length || 0,
    superbowlHistory: state.superbowlHistory?.length || 0,
  };
}

// ── Database ────────────────────────────────────────────────────

async function collectDb() {
  try {
    const { isPrismaAvailable, prismaSafe } = require('../storage/prisma');
    if (!isPrismaAvailable()) return { status: '❌ Prisma unavailable' };
    const count = await prismaSafe(p => p.serverConfig.count(), 0);
    return { status: '✅ Connected', serverConfigs: count };
  } catch (e) {
    return { status: `❌ ${e.message}` };
  }
}

// ── Channels ────────────────────────────────────────────────────

function collectChannels(guild, getCh) {
  if (!guild || !getCh) return { found: 0, total: 0, missing: [] };
  const keys = Object.keys(CHANNEL_KEYS);
  const found = [];
  const missing = [];
  for (const key of keys) {
    const ch = getCh(guild, key);
    if (ch) {
      found.push(key);
    } else {
      missing.push(key);
    }
  }
  return { found: found.length, total: keys.length, missing };
}

// ── Permissions ─────────────────────────────────────────────────

function collectPermissions(guild) {
  if (!guild?.members?.me) return { error: 'bot member not cached' };
  const perms = guild.members.me.permissions;
  const critical = [
    { name: 'ManageChannels', has: perms.has('ManageChannels') },
    { name: 'ManageRoles', has: perms.has('ManageRoles') },
    { name: 'ManageMessages', has: perms.has('ManageMessages') },
    { name: 'SendMessages', has: perms.has('SendMessages') },
    { name: 'ViewChannel', has: perms.has('ViewChannel') },
    { name: 'ReadMessageHistory', has: perms.has('ReadMessageHistory') },
    { name: 'EmbedLinks', has: perms.has('EmbedLinks') },
    { name: 'KickMembers', has: perms.has('KickMembers') },
    { name: 'BanMembers', has: perms.has('BanMembers') },
    { name: 'ManageGuild', has: perms.has('ManageGuild') },
  ];
  const missingPerms = critical.filter(p => !p.has).map(p => p.name);
  return { all: critical.map(p => `${p.has ? '✅' : '❌'} ${p.name}`), missing: missingPerms };
}

// ── Server Settings ─────────────────────────────────────────────

function collectSettings() {
  try {
    const ss = require('./serverSettingsService').getSettings();
    return {
      serverInitialized: !!ss.serverInitialized,
      serverTemplate: ss.serverTemplate || 'none',
      serverSubtemplate: ss.serverSubtemplate || 'none',
      audienceRating: ss.audienceRating || 'pg13',
      filterMode: ss.filterMode || 'strict',
      botStatus: ss.botStatus || 'active',
      requireTimezone: !!ss.requireTimezone,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Flows & Components ──────────────────────────────────────────

function collectFlows() {
  try {
    const wf = require('./workflowEngineService');
    const workflows = wf.listWorkflows();
    const runLog = wf.getRunLog(10);
    const recentFails = runLog.filter(r => r.status === 'failed');
    return {
      registeredWorkflows: workflows.length,
      recentRuns: runLog.length,
      recentFailures: recentFails.length,
      failedSteps: recentFails.map(f => `${f.step}: ${f.error || 'unknown'}`),
    };
  } catch (e) {
    return { error: e.message };
  }
}

function collectComponents() {
  try {
    const comp = require('./componentRegistryService');
    const all = comp.listAll();
    return {
      total: all.length,
      enabled: all.filter(c => c.enabled).map(c => c.id),
      disabled: all.filter(c => !c.enabled).map(c => c.id),
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Escalations ─────────────────────────────────────────────────

function collectEscalations() {
  try {
    const esc = require('./escalationService');
    const recent = esc.getRecentEscalations(10);
    return {
      recentCount: recent.length,
      items: recent.map(r => ({ type: r.type, severity: r.severity, ts: r.ts })),
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Duplicate Detection ─────────────────────────────────────────

function collectDuplicates(guild) {
  const { ChannelType } = require('discord.js');
  if (!guild) return { duplicateCategories: 0, details: [] };
  const normName = n => String(n || '').toLowerCase().replace(/^[^\w]+/, '').trim();
  const catGroups = new Map();
  for (const ch of guild.channels.cache.values()) {
    if (ch.type !== ChannelType.GuildCategory) continue;
    const key = normName(ch.name);
    if (!key) continue;
    if (!catGroups.has(key)) catGroups.set(key, []);
    catGroups.get(key).push(ch.name);
  }
  const dupes = [...catGroups.entries()].filter(([, v]) => v.length > 1);
  return {
    duplicateCategories: dupes.length,
    details: dupes.map(([key, names]) => `"${key}" x${names.length}`),
  };
}

// ── Full Diagnosis ──────────────────────────────────────────────

/**
 * Run all diagnostic collectors and return a structured report.
 * @param {Object} guild - Discord guild
 * @param {Function} getCh - Channel resolver
 * @param {Object} state - Bot state
 * @param {Object} client - Discord client
 * @returns {{ sections: Object, issues: string[], score: string }}
 */
async function runFullDiagnosis(guild, getCh, state, client) {
  const sections = {
    env: collectEnv(),
    runtime: collectRuntime(state, client),
    settings: collectSettings(),
    state: collectState(state),
    db: await collectDb(),
    channels: collectChannels(guild, getCh),
    permissions: collectPermissions(guild),
    flows: collectFlows(),
    components: collectComponents(),
    escalations: collectEscalations(),
    duplicates: collectDuplicates(guild),
  };

  // Auto-detect issues
  const issues = [];

  // Env issues
  if (!process.env.DISCORD_TOKEN) issues.push('CRITICAL: DISCORD_TOKEN not set');
  if (!process.env.ANTHROPIC_API_KEY) issues.push('CRITICAL: ANTHROPIC_API_KEY not set — AI disabled');
  if (!process.env.DATABASE_URL) issues.push('WARNING: DATABASE_URL not set — no Postgres persistence');
  if (!process.env.REDIS_URL) issues.push('WARNING: REDIS_URL not set — no distributed locks or queue');
  if (!process.env.BOT_DATA_DIR || process.env.BOT_DATA_DIR.startsWith('/tmp')) issues.push('WARNING: BOT_DATA_DIR is ephemeral — state lost on restart');

  // Settings issues
  if (!sections.settings.serverInitialized) issues.push('INFO: Server not initialized — run /setup-wizard');
  if (sections.settings.botStatus === 'killed') issues.push('CRITICAL: Bot status is KILLED — ignoring all messages');

  // Channel issues
  if (sections.channels.missing.length > 0) {
    const crit = sections.channels.missing.filter(k => ['commAI', 'adminHq', 'welcome', 'rules'].includes(k));
    if (crit.length) issues.push(`WARNING: Critical channels missing: ${crit.join(', ')}`);
    if (sections.channels.missing.length > 5) issues.push(`INFO: ${sections.channels.missing.length} channels not resolved (some may be template-specific)`);
  }

  // Permission issues
  if (sections.permissions.missing && sections.permissions.missing.length) {
    issues.push(`WARNING: Bot missing permissions: ${sections.permissions.missing.join(', ')}`);
  }

  // Flow issues
  if (sections.flows.recentFailures > 0) {
    issues.push(`WARNING: ${sections.flows.recentFailures} recent workflow failure(s): ${sections.flows.failedSteps.slice(0, 3).join('; ')}`);
  }

  // Duplicate issues
  if (sections.duplicates.duplicateCategories > 0) {
    issues.push(`WARNING: ${sections.duplicates.duplicateCategories} duplicate category group(s) detected: ${sections.duplicates.details.join(', ')}. Run /fix-duplicates to clean.`);
  }

  // Memory issues
  if (sections.runtime.heapUsedMB > 400) issues.push(`WARNING: High memory usage: ${sections.runtime.heapUsedMB}MB heap`);

  // Escalation issues
  if (sections.escalations.recentCount > 5) issues.push(`INFO: ${sections.escalations.recentCount} recent escalations — review #commissioner-ai`);

  // Score
  const critCount = issues.filter(i => i.startsWith('CRITICAL')).length;
  const warnCount = issues.filter(i => i.startsWith('WARNING')).length;
  const score = critCount > 0 ? '🔴 CRITICAL' : warnCount > 0 ? '🟡 DEGRADED' : '🟢 HEALTHY';

  return { sections, issues, score };
}

// ── Embed Builder ───────────────────────────────────────────────

function buildDiagnosticEmbed(diagnosis) {
  const { sections, issues, score } = diagnosis;
  const color = score.includes('CRITICAL') ? 0xff0000 : score.includes('DEGRADED') ? 0xf39c12 : 0x2ecc71;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🔬 Bot Diagnostic Report — ${score}`)
    .setTimestamp();

  // Runtime
  embed.addFields({
    name: '⚙️ Runtime',
    value: `Uptime: **${sections.runtime.uptimeMinutes}m** | Heap: **${sections.runtime.heapUsedMB}/${sections.runtime.heapTotalMB}MB** | RSS: **${sections.runtime.rssMB}MB** | Node: ${sections.runtime.nodeVersion}`,
    inline: false,
  });

  // Settings
  const s = sections.settings;
  embed.addFields({
    name: '🛠️ Settings',
    value: `Initialized: ${s.serverInitialized ? '✅' : '❌'} | Template: **${s.serverTemplate}** | Rating: **${s.audienceRating}** | Status: **${s.botStatus}**`,
    inline: false,
  });

  // State
  const st = sections.state;
  embed.addFields({
    name: '📊 State',
    value: `Players: **${st.players}** | Teams: **${st.claimedTeams}/${st.openTeams}** | Week: **${st.currentWeek || 'N/A'}** | Matchups: **${st.matchups}** | Trades: **${st.pendingTrades}**`,
    inline: false,
  });

  // Channels
  embed.addFields({
    name: '📡 Channels',
    value: `Resolved: **${sections.channels.found}/${sections.channels.total}**${sections.channels.missing.length ? `\nMissing: ${sections.channels.missing.slice(0, 8).join(', ')}${sections.channels.missing.length > 8 ? ` (+${sections.channels.missing.length - 8} more)` : ''}` : ''}`,
    inline: false,
  });

  // Infra
  const env = sections.env;
  embed.addFields({
    name: '🏗️ Infrastructure',
    value: `DB: ${env.DATABASE_URL} | Redis: ${env.REDIS_URL} | AI: ${env.ANTHROPIC_API_KEY} | Data: ${sections.env.BOT_DATA_DIR}`,
    inline: false,
  });

  // Flows
  embed.addFields({
    name: '🔄 Workflows',
    value: `Registered: **${sections.flows.registeredWorkflows || 0}** | Recent runs: **${sections.flows.recentRuns || 0}** | Failures: **${sections.flows.recentFailures || 0}**`,
    inline: false,
  });

  // Components
  const comp = sections.components;
  embed.addFields({
    name: '🧩 Components',
    value: `Enabled: **${(comp.enabled || []).length}/${comp.total || 0}** — ${(comp.enabled || []).join(', ') || 'none'}`,
    inline: false,
  });

  // Issues
  if (issues.length) {
    embed.addFields({
      name: `⚠️ Issues (${issues.length})`,
      value: issues.map(i => {
        const icon = i.startsWith('CRITICAL') ? '🔴' : i.startsWith('WARNING') ? '🟡' : 'ℹ️';
        return `${icon} ${i}`;
      }).join('\n').slice(0, 1024),
      inline: false,
    });
  } else {
    embed.addFields({ name: '✅ No Issues Detected', value: 'All systems operational.', inline: false });
  }

  return embed;
}

// ── AI Awareness Block ──────────────────────────────────────────

/**
 * Build a compact text block for injection into AI system prompts.
 * Commissioner/IT AI can reference this to answer "what's broken?" questions.
 */
async function buildAwarenessBlock(guild, getCh, state, client) {
  const diag = await runFullDiagnosis(guild, getCh, state, client);
  const lines = [`BOT HEALTH: ${diag.score}`];
  if (diag.issues.length) {
    lines.push(`KNOWN ISSUES (${diag.issues.length}):`);
    for (const issue of diag.issues.slice(0, 10)) {
      lines.push(`  • ${issue}`);
    }
  } else {
    lines.push('NO KNOWN ISSUES — all systems operational.');
  }
  const s = diag.sections;
  lines.push(`RUNTIME: uptime ${s.runtime.uptimeMinutes}m, heap ${s.runtime.heapUsedMB}MB, ${s.runtime.nodeVersion}`);
  lines.push(`CHANNELS: ${s.channels.found}/${s.channels.total} resolved`);
  lines.push(`WORKFLOWS: ${s.flows.registeredWorkflows || 0} registered, ${s.flows.recentFailures || 0} recent failures`);
  lines.push(`COMPONENTS: ${(s.components.enabled || []).length} enabled`);
  if (s.duplicates.duplicateCategories > 0) {
    lines.push(`DUPLICATES: ${s.duplicates.duplicateCategories} duplicate category groups — run /fix-duplicates`);
  }
  if (s.escalations.recentCount > 0) {
    lines.push(`ESCALATIONS: ${s.escalations.recentCount} recent`);
  }
  return lines.join('\n');
}

module.exports = {
  collectEnv,
  collectRuntime,
  collectState,
  collectDb,
  collectChannels,
  collectPermissions,
  collectSettings,
  collectFlows,
  collectComponents,
  collectEscalations,
  collectDuplicates,
  runFullDiagnosis,
  buildDiagnosticEmbed,
  buildAwarenessBlock,
};
