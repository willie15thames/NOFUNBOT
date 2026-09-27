/*
 * NAVIGATION HEADER
 * FILE: src/handlers/itHandler.js
 * LAYER: Event/message handler layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually triggered from index.js event listeners and delegates into services.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const { isExplicitBotMention } = require('../services/explicitMentionGateService');
// src/handlers/itHandler.js
// IT role AI handler. Routes when:
//   - Sender has IT_ROLE or is in IT_IDS (or is commissioner — they inherit IT)
//   - Bot is @mentioned, OR message is in #it-ops channel
//
// Unlike commissioner AI: no persona, no trash talk, pure technical diagnostics.
// Unlike member AI: full infra access, destructive actions allowed, raw system state exposed.

const { EmbedBuilder } = require('discord.js');
const { makeLogger } = require('../utils/logger');
const { isITMember } = require('../utils/helpers');
const { COMM_ROLE, COMMISSIONER_IDS, IT_ROLE, IT_IDS } = require('../config/env');
const { probePrisma } = require('../storage/prisma');
const { aiCall, MODELS, getAIStatus, RAILWAY_TIMEOUT_MS } = require('../services/ai/anthropicService');
const conversationCtx = require('../services/conversationContextService');
const log = makeLogger('itAI');

// ── Diagnostics collectors ────────────────────────────────────

function collectEnvDiagnostics() {
  const mask = (v) => v ? `${v.slice(0, 4)}...${v.slice(-4)}` : 'NOT SET';
  const bool = (v) => v ? '✅ SET' : '❌ NOT SET';
  return {
    DISCORD_TOKEN:       bool(process.env.DISCORD_TOKEN),
    CLIENT_ID:           bool(process.env.CLIENT_ID),
    GUILD_ID:            process.env.GUILD_ID || 'NOT SET',
    COMMISSIONER_ROLE_ID: process.env.COMMISSIONER_ROLE_ID || 'NOT SET',
    IT_ROLE_ID:          process.env.IT_ROLE_ID || 'NOT SET',
    ANTHROPIC_API_KEY:   bool(process.env.ANTHROPIC_API_KEY),
    AI_PROVIDER:         process.env.AI_PROVIDER || 'anthropic (default)',
    AI_ENABLED:          process.env.AI_ENABLED || 'true (default)',
    AI_TIMEOUT_MS:       process.env.AI_TIMEOUT_MS || `${RAILWAY_TIMEOUT_MS} (default)`,
    DATABASE_URL:        bool(process.env.DATABASE_URL),
    REDIS_URL:           bool(process.env.REDIS_URL),
    BOT_DATA_DIR:        process.env.BOT_DATA_DIR || '/tmp/nofunleague-data (EPHEMERAL)',
    RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN || 'NOT SET',
    NODE_ENV:            process.env.NODE_ENV || 'not set',
    PORT:                process.env.PORT || '3000 (default)',
  };
}

function collectRuntimeDiagnostics(state, client) {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const hrs = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const secs = Math.floor(uptime % 60);

  return {
    uptime: `${hrs}h ${mins}m ${secs}s`,
    memory: {
      heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`,
      heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`,
      rss: `${(mem.rss / 1024 / 1024).toFixed(1)} MB`,
      external: `${(mem.external / 1024 / 1024).toFixed(1)} MB`,
    },
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
    botUser: client?.user?.tag || 'unknown',
    guilds: client?.guilds?.cache?.size || 0,
    wsStatus: client?.ws?.status ?? 'unknown',
    wsPing: client?.ws?.ping ? `${client.ws.ping}ms` : 'unknown',
  };
}

function collectStateDiagnostics(state) {
  return {
    players: state.players?.size || 0,
    games: state.games?.size || 0,
    openTeams: state.openTeamRegistry?.length || 0,
    openTeamsOpen: state.openTeamRegistry?.filter(t => t.isOpen)?.length || 0,
    pendingTrades: state.pendingTrades?.size || 0,
    pendingBoosts: state.pendingAttrBoosts?.size || 0,
    pendingOffenses: state.pendingOffenses?.size || 0,
    spamTrackerEntries: state.spamTracker?.size || 0,
    activeLeagues: state.activeLeagues?.size || 0,
    commissionerIds: [...(state.commissionerIds || [])].join(', ') || 'none',
    hubWeek: state.hubWeeklyData?.week || 'not set',
    hubScores: state.hubWeeklyData?.scores?.length || 0,
    scheduleWeek: state.scheduleState?.week || 'not set',
    leagueName: state.leagueConfig?.leagueName || 'none',
    leagueType: state.leagueConfig?.leagueTypeId || 'none',
  };
}

async function collectDbDiagnostics() {
  const h = await probePrisma({ checkSchema: true });
  return {
    prismaAvailable: !!h.clientInitialized,
    pgPool: h.reachable === true,
    schemaReady: h.schemaReady,
    circuitState: h.circuitState,
    consecutiveFailures: h.consecutiveFailures || 0,
    lastSuccessAt: h.lastSuccessAt || null,
    lastFailureAt: h.lastFailureAt || null,
    lastErrorCode: h.lastErrorCode || null,
    lastError: h.lastError || null,
    serverConfigs: h.serverConfigs ?? null,
  };
}

function collectChannelDiagnostics(guild, getCh) {
  const { CHANNEL_KEYS } = require('../config/channels');
  // The full catalog lists optional channels from unrelated templates and
  // league spaces. Count only the server-level channels this diagnostic uses.
  const keys = ['welcome','rules','announcements','serverGuide','howToJoin','commAI','adminHq'];
  const missing = [];
  const found = [];
  for (const key of keys) {
    const defaultName = CHANNEL_KEYS[key];
    const ch = getCh(guild, key);
    if (ch) {
      found.push(`✅ ${key} → #${ch.name}`);
    } else {
      missing.push(`❌ ${key} (expected: ${defaultName})`);
    }
  }
  return { found, missing, total: keys.length };
}

function collectPermissionDiagnostics(guild) {
  const { PermissionFlagsBits } = require('discord.js');
  const bot = guild.members.me;
  if (!bot) return { error: 'Bot member not found in cache' };
  const PERMS = [
    ['Administrator', PermissionFlagsBits.Administrator],
    ['ManageChannels', PermissionFlagsBits.ManageChannels],
    ['ManageRoles', PermissionFlagsBits.ManageRoles],
    ['ManageMessages', PermissionFlagsBits.ManageMessages],
    ['SendMessages', PermissionFlagsBits.SendMessages],
    ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
    ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
    ['ViewChannel', PermissionFlagsBits.ViewChannel],
    ['KickMembers', PermissionFlagsBits.KickMembers],
    ['BanMembers', PermissionFlagsBits.BanMembers],
    ['ModerateMembers', PermissionFlagsBits.ModerateMembers],
    ['ManageNicknames', PermissionFlagsBits.ManageNicknames],
  ];
  const results = {};
  for (const [name, bit] of PERMS) {
    results[name] = bot.permissions.has(bit) ? '✅' : '❌';
  }
  results.highestRole = `${bot.roles?.highest?.name} (pos ${bot.roles?.highest?.position})`;
  return results;
}

// ── Fast diagnostic commands (no AI needed) ────────────────────

const DIAG_COMMANDS = {
  'status':      { fn: 'fullStatus',   desc: 'Full system status overview' },
  'env':         { fn: 'envCheck',     desc: 'Environment variable audit' },
  'memory':      { fn: 'memoryCheck',  desc: 'Runtime memory and uptime' },
  'state':       { fn: 'stateCheck',   desc: 'In-memory state sizes' },
  'db':          { fn: 'dbCheck',      desc: 'Database connection and record counts' },
  'channels':    { fn: 'channelAudit', desc: 'Channel resolution audit' },
  'permissions': { fn: 'permCheck',    desc: 'Bot permission audit' },
  'ai':          { fn: 'aiCheck',      desc: 'AI provider status and config' },
  'help':        { fn: 'helpMenu',     desc: 'List all IT diagnostic commands' },
  'railway':     { fn: 'railwayCheck', desc: 'Railway-specific deployment diagnostics' },
};

function parseDiagCommand(content) {
  const text = content.replace(/<@!?\d+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const [cmd, meta] of Object.entries(DIAG_COMMANDS)) {
    if (text === cmd || text.startsWith(cmd + ' ') || text === `diag ${cmd}` || text === `diagnose ${cmd}`) {
      return { command: cmd, ...meta };
    }
  }
  // Check for natural language triggers
  if (/what.?s wrong|why.*(not|won.?t|isn.?t).*(work|run|start|deploy|connect)/.test(text)) return { command: 'status', ...DIAG_COMMANDS['status'] };
  if (/env|environment|variable|config/.test(text)) return { command: 'env', ...DIAG_COMMANDS['env'] };
  if (/memory|ram|heap|uptime/.test(text)) return { command: 'memory', ...DIAG_COMMANDS['memory'] };
  if (/database|postgres|prisma|db|sql/.test(text)) return { command: 'db', ...DIAG_COMMANDS['db'] };
  if (/channel|missing|resolve/.test(text)) return { command: 'channels', ...DIAG_COMMANDS['channels'] };
  if (/permission|perms|access|role/.test(text)) return { command: 'permissions', ...DIAG_COMMANDS['permissions'] };
  if (/railway|deploy|host|infra|server|container/.test(text)) return { command: 'railway', ...DIAG_COMMANDS['railway'] };
  if (/ai|anthropic|claude|model/.test(text)) return { command: 'ai', ...DIAG_COMMANDS['ai'] };
  return null;
}

async function runDiagCommand(command, guild, getCh, state, client) {
  switch (command) {
    case 'fullStatus': {
      const env = collectEnvDiagnostics();
      const runtime = collectRuntimeDiagnostics(state, client);
      const stateD = collectStateDiagnostics(state);
      const db = await collectDbDiagnostics();
      const chDiag = collectChannelDiagnostics(guild, getCh);
      const aiStatus = getAIStatus();

      const issues = [];
      if (env.DATABASE_URL === '❌ NOT SET') issues.push('DATABASE_URL not set — no persistent storage');
      if (env.REDIS_URL === '❌ NOT SET') issues.push('REDIS_URL not set — queue worker inert');
      if (env.BOT_DATA_DIR.includes('EPHEMERAL') || env.BOT_DATA_DIR === './data') issues.push('BOT_DATA_DIR is not on a confirmed persistent volume');
      if (!aiStatus.ready) issues.push(`AI unavailable: ${aiStatus.reason}`);
      if (!db.pgPool) issues.push('PostgreSQL is unreachable');
      else if (db.schemaReady === false) issues.push('PostgreSQL reachable, required schema check failed');
      if (chDiag.missing.length) issues.push(`${chDiag.missing.length}/${chDiag.total} channels missing`);
      if (runtime.wsStatus !== 0 && runtime.wsStatus !== 'unknown') issues.push(`WebSocket status: ${runtime.wsStatus} (expected 0)`);

      return new EmbedBuilder()
        .setColor(issues.length ? 0xFF4444 : 0x00CC66)
        .setTitle(issues.length ? `⚠️ System Status — ${issues.length} issue(s)` : '✅ System Status — All Clear')
        .addFields(
          { name: '🔧 Runtime', value: `Uptime: ${runtime.uptime}\nHeap: ${runtime.memory.heapUsed}/${runtime.memory.heapTotal}\nRSS: ${runtime.memory.rss}\nNode: ${runtime.nodeVersion}\nWS Ping: ${runtime.wsPing}`, inline: true },
          { name: '📊 State', value: `Players: ${stateD.players}\nGames: ${stateD.games}\nOpen Teams: ${stateD.openTeamsOpen}/${stateD.openTeams}\nPending: ${stateD.pendingTrades}T/${stateD.pendingBoosts}B/${stateD.pendingOffenses}O\nLeague: ${stateD.leagueName}`, inline: true },
          { name: '🗄️ Infra', value: `DB: ${db.pgPool ? (db.schemaReady ? '✅ ready' : '⚠️ schema check failed') : '❌ offline'}\nRedis: ${env.REDIS_URL === '❌ NOT SET' ? '❌ not configured' : '✅ configured'}\nData Dir: ${env.BOT_DATA_DIR}\nAI: ${aiStatus.ready ? '✅ ready' : `❌ ${aiStatus.reason}`}`, inline: true },
        )
        .addFields(
          { name: 'Channels', value: `${chDiag.found.length}/${chDiag.total} resolved, ${chDiag.missing.length} missing`, inline: true },
          { name: issues.length ? '🚨 Issues' : '✅ No Issues', value: issues.length ? issues.map(i => `• ${i}`).join('\n') : 'All systems operational.', inline: false },
        )
        .setFooter({ text: `PID ${runtime.pid} | ${runtime.platform} | ${runtime.botUser}` })
        .setTimestamp();
    }

    case 'envCheck': {
      const env = collectEnvDiagnostics();
      const lines = Object.entries(env).map(([k, v]) => `**${k}**: ${v}`).join('\n');
      return new EmbedBuilder().setColor(0x3498db).setTitle('🔧 Environment Variables').setDescription(lines).setTimestamp();
    }

    case 'memoryCheck': {
      const r = collectRuntimeDiagnostics(state, client);
      return new EmbedBuilder().setColor(0x9b59b6).setTitle('💾 Runtime Diagnostics')
        .addFields(
          { name: 'Uptime', value: r.uptime, inline: true },
          { name: 'Heap Used', value: r.memory.heapUsed, inline: true },
          { name: 'Heap Total', value: r.memory.heapTotal, inline: true },
          { name: 'RSS', value: r.memory.rss, inline: true },
          { name: 'External', value: r.memory.external, inline: true },
          { name: 'WS Ping', value: r.wsPing, inline: true },
          { name: 'Node', value: r.nodeVersion, inline: true },
          { name: 'PID', value: String(r.pid), inline: true },
          { name: 'WS Status', value: String(r.wsStatus), inline: true },
        ).setTimestamp();
    }

    case 'stateCheck': {
      const s = collectStateDiagnostics(state);
      const lines = Object.entries(s).map(([k, v]) => `**${k}**: ${v}`).join('\n');
      return new EmbedBuilder().setColor(0xe67e22).setTitle('📊 State Snapshot').setDescription(lines).setTimestamp();
    }

    case 'dbCheck': {
      const db = await collectDbDiagnostics();
      const env = collectEnvDiagnostics();
      return new EmbedBuilder().setColor(db.prismaAvailable ? 0x27ae60 : 0xe74c3c).setTitle('🗄️ Database Status')
        .addFields(
          { name: 'DATABASE_URL', value: env.DATABASE_URL, inline: true },
          { name: 'Prisma Client', value: db.prismaAvailable ? '✅ Connected' : '❌ Unavailable', inline: true },
          { name: 'PG Pool', value: db.pgPool ? '✅ Active' : '❌ Inactive', inline: true },
          { name: 'BotKv Records', value: String(db.botKvRecords), inline: true },
          { name: 'REDIS_URL', value: env.REDIS_URL, inline: true },
        ).setTimestamp();
    }

    case 'channelAudit': {
      const diag = collectChannelDiagnostics(guild, getCh);
      const desc = diag.missing.length
        ? `**Missing (${diag.missing.length}):**\n${diag.missing.join('\n')}\n\n**Found (${diag.found.length}/${diag.total})**`
        : `All ${diag.total} channels resolved. ✅`;
      return new EmbedBuilder().setColor(diag.missing.length ? 0xf39c12 : 0x27ae60)
        .setTitle('📡 Channel Audit').setDescription(desc.slice(0, 4000)).setTimestamp();
    }

    case 'permCheck': {
      const perms = collectPermissionDiagnostics(guild);
      if (perms.error) return new EmbedBuilder().setColor(0xe74c3c).setTitle('🔒 Permission Audit').setDescription(perms.error);
      const lines = Object.entries(perms).map(([k, v]) => `**${k}**: ${v}`).join('\n');
      return new EmbedBuilder().setColor(0x3498db).setTitle('🔒 Permission Audit').setDescription(lines).setTimestamp();
    }

    case 'aiCheck': {
      const status = getAIStatus();
      const env = collectEnvDiagnostics();
      return new EmbedBuilder().setColor(status.ready ? 0x27ae60 : 0xe74c3c).setTitle('🤖 AI Status')
        .addFields(
          { name: 'Ready', value: status.ready ? '✅ Yes' : '❌ No', inline: true },
          { name: 'Provider', value: status.provider, inline: true },
          { name: 'Reason', value: status.reason, inline: true },
          { name: 'API Key', value: env.ANTHROPIC_API_KEY, inline: true },
          { name: 'Timeout', value: `${env.AI_TIMEOUT_MS}`, inline: true },
          { name: 'Models', value: `Fast: ${env.AI_PROVIDER === 'anthropic (default)' ? 'claude-haiku-4-5' : env.AI_PROVIDER}\nSmart: claude-sonnet-4-6`, inline: true },
        ).setTimestamp();
    }

    case 'railwayCheck': {
      const env = collectEnvDiagnostics();
      const runtime = collectRuntimeDiagnostics(state, client);
      const issues = [];
      if (env.BOT_DATA_DIR.includes('EPHEMERAL') || env.BOT_DATA_DIR === './data') issues.push('⚠️ BOT_DATA_DIR is not confirmed persistent. Mount a Railway Volume at /data and set BOT_DATA_DIR=/data');
      if (env.REDIS_URL === '❌ NOT SET') issues.push('⚠️ REDIS_URL not set — add a Redis service in Railway and set the variable');
      if (env.DATABASE_URL === '❌ NOT SET') issues.push('⚠️ DATABASE_URL not set — add a Postgres service in Railway');
      if (!env.RAILWAY_PUBLIC_DOMAIN || env.RAILWAY_PUBLIC_DOMAIN === 'NOT SET') issues.push('ℹ️ RAILWAY_PUBLIC_DOMAIN not set — public access is not configured');
      if (!issues.length) issues.push('✅ Railway configuration looks correct.');
      return new EmbedBuilder().setColor(issues.some(i => i.startsWith('⚠️')) ? 0xFF8800 : 0x27ae60)
        .setTitle('🚂 Railway Deployment Diagnostics')
        .addFields(
          { name: 'Data Dir', value: env.BOT_DATA_DIR, inline: true },
          { name: 'Port', value: env.PORT, inline: true },
          { name: 'Public Domain', value: env.RAILWAY_PUBLIC_DOMAIN, inline: true },
          { name: 'DB', value: env.DATABASE_URL, inline: true },
          { name: 'Redis', value: env.REDIS_URL, inline: true },
          { name: 'Node', value: runtime.nodeVersion, inline: true },
        )
        .addFields({ name: 'Assessment', value: issues.join('\n') })
        .setTimestamp();
    }

    case 'helpMenu': {
      const lines = Object.entries(DIAG_COMMANDS).map(([cmd, meta]) => `**${cmd}** — ${meta.desc}`).join('\n');
      return new EmbedBuilder().setColor(0x5865f2).setTitle('🛠️ IT Diagnostics — Commands')
        .setDescription(`Mention the bot with any of these commands in #it-ops or another channel:\n\n${lines}\n\nYou can also ask natural language questions like "what's wrong" or "why won't it deploy" and the diagnostic engine will route to the right check.`)
        .setTimestamp();
    }
  }
}

// ── Routing gate ──────────────────────────────────────────────

function shouldHandleIT(message, client, getCh) {
  if (!message.guild || message.author?.bot) return false;
  const isIT = isITMember(message.member, IT_ROLE, IT_IDS, COMM_ROLE, COMMISSIONER_IDS);
  if (!isIT) return false;

  // V204.7 hard speech gate: being in #it-ops alone never authorizes AI speech.
  // @mention + IT member — only if message looks technical/diagnostic
  const botMentioned = isExplicitBotMention(message, client);
  if (!botMentioned) return false;

  // Check if the message content looks like an IT/diagnostic query
  const text = message.content.replace(/<@!?\d+>/g, '').trim().toLowerCase();
  const itSignals = /\b(status|diag|diagnose|env|memory|uptime|railway|deploy|infra|database|redis|prisma|channels?|permissions?|health|why.*(not|won.?t|isn.?t).*(work|run|start)|what.?s wrong|system|debug|logs?|error|crash|ping|latency)\b/;
  return itSignals.test(text);
}

// ── Main handler ──────────────────────────────────────────────

async function handleIT(message, { getCh, state, client }) {
  const guild = message.guild;
  if (!guild) return;

  log.info(`IT handler entered: ${message.author.tag} in #${message.channel.name}`);

  const content = message.content.replace(/<@!?\d+>/g, '').trim();
  const diagCmd = parseDiagCommand(content);

  if (diagCmd) {
    await message.channel.sendTyping().catch(() => null);
    try {
      const embed = await runDiagCommand(diagCmd.fn, guild, getCh, state, client);
      if (embed) {
        await message.reply({ embeds: [embed] }).catch(() => null);
      }
    } catch (err) {
      log.error(`IT diag command failed (${diagCmd.command}):`, err.message);
      await message.reply(`❌ Diagnostic failed: ${err.message}`).catch(() => null);
    }
    return;
  }

  // Non-diagnostic query from IT member → fall through to AI with technical system prompt
  await message.channel.sendTyping().catch(() => null);

  const sessionMeta = { guildId: guild.id, channelId: message.channel.id, userId: message.author.id, scope: 'it' };
  conversationCtx.append(sessionMeta, 'technical', 'user', content);
  const history = conversationCtx.getHistory(sessionMeta, 'technical');

  // Build comprehensive system context for AI
  const env = collectEnvDiagnostics();
  const runtime = collectRuntimeDiagnostics(state, client);
  const stateD = collectStateDiagnostics(state);
  const db = await collectDbDiagnostics();
  const chDiag = collectChannelDiagnostics(guild, getCh);
  const perms = collectPermissionDiagnostics(guild);

  const systemCtx = `ENV: ${JSON.stringify(env, null, 0)}
RUNTIME: ${JSON.stringify(runtime, null, 0)}
STATE: ${JSON.stringify(stateD, null, 0)}
DB: ${JSON.stringify(db, null, 0)}
CHANNELS: ${chDiag.found.length}/${chDiag.total} resolved, missing: ${chDiag.missing.map(m => m.replace('❌ ', '')).join(', ') || 'none'}
PERMISSIONS: ${JSON.stringify(perms, null, 0)}`;

  // V197: Append shared diagnostic awareness (flows, components, escalations, duplicates)
  let diagBlock = '';
  try {
    const diagnosticService = require('../services/diagnosticService');
    diagBlock = '\n' + await diagnosticService.buildAwarenessBlock(guild, getCh, state, client);
  } catch {}
  const fullSystemCtx = systemCtx + diagBlock;

  try {
    const res = await aiCall({
      model: MODELS.SMART,
      max_tokens: 600,
      system: `You are the IT diagnostic module for a Discord bot deployed on Railway.
Your role: answer technical questions about the bot's health, infrastructure, and configuration.
Voice: straight technical. No personality, no jokes, no filler. Facts and diagnostics only.
Format: Use short paragraphs. Lead with the direct answer. If there's an issue, state what it is, why it matters, and the exact fix.

LIVE SYSTEM DATA:
${fullSystemCtx}

KNOWN ARCHITECTURE:
- Node.js bot using discord.js v14
- Hosted on Railway with optional Postgres (Prisma) + Redis (BullMQ)
- JSON file persistence in BOT_DATA_DIR with Postgres write-through
- Health server on PORT as sidecar process
- AI via Anthropic API (Claude models)
- State loaded into memory at startup from JSON + Postgres warmup

RULES:
- Answer from the live data above. Do not guess.
- A failed schema probe does not prove the database was never migrated. Ask for the exact migration/schema error; never recommend prisma db push or reset on an existing database.
- Channel counts include only the core channels checked. Other templates and private league categories may have different channels.
- If something is broken, say exactly what is broken and the fix.
- Mask sensitive values (tokens, keys) — never output them.
- You may reference env vars, file paths, service names, and technical details.
- Keep responses under 400 words.`,
      messages: history.map(h => ({ role: h.role, content: h.content })),
    });

    let reply = String(res?.content?.[0]?.text || '').trim();
    if (!reply) reply = 'No diagnostic output. Try a specific command: `status`, `env`, `db`, `railway`, `channels`, `permissions`, `memory`, `ai`.';

    conversationCtx.append(sessionMeta, 'technical', 'assistant', reply);
    await message.reply(reply.slice(0, 1900)).catch(() => null);
  } catch (err) {
    log.error('IT AI call failed:', err.message);
    // Fallback: run full status instead
    const embed = await runDiagCommand('fullStatus', guild, getCh, state, client);
    await message.reply({ content: `AI unavailable (${err.message}). Here's the raw diagnostic:`, embeds: embed ? [embed] : [] }).catch(() => null);
  }
}

module.exports = { shouldHandleIT, handleIT };
