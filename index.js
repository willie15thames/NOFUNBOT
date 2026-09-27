/*
 * NAVIGATION HEADER
 * FILE: index.js
 * LAYER: Application entrypoint
 * PURPOSE: Bootstraps the bot, wires core listeners, and starts application services.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * NOFUNLEAGUE Bot — Entry Point
 *
 * This file contains ONLY:
 *   1. Env validation (via src/config/env.js)
 *   2. Discord client creation
 *   3. Slash command deployment
 *   4. Event routing wiring
 *   5. client.login()
 *
 * Zero business logic. Zero stat handling. Zero team release logic.
 * Zero OCR. Zero trade systems. Zero reward updates.
 * All of that lives in src/services/, src/handlers/, src/parsers/.
 */

// ── 1. Env (hard-fails on missing vars) ──────────────────────
const { TOKEN, CLIENT_ID, GUILD_ID, COMM_ROLE, COMMISSIONER_IDS } = require('./src/config/env');

// ── 2. Discord client ─────────────────────────────────────────
let Client;
let GatewayIntentBits;
let Partials;
let REST;
let Routes;
let PermissionFlagsBits;

try {
  ({
    Client, GatewayIntentBits, Partials,
    REST, Routes, PermissionFlagsBits,
  } = require('discord.js'));
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message || '').includes("discord.js")) {
    console.error('❌ Missing dependency: discord.js');
    console.error('Run these commands from the project root:');
    console.error('  rm -rf node_modules package-lock.json');
    console.error('  npm install');
    console.error('  npm install discord.js');
    console.error('  npm restart');
    console.error('If npm install fails with an auth error, clear stale npm credentials and try again.');
    process.exit(1);
  }
  throw err;
}


const runtimeIncidents = require('./src/services/runtimeIncidentService');

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL GUARD] Unhandled rejection:', reason?.stack || reason);
  runtimeIncidents.capture(reason, { source: 'process', eventType: 'unhandled-rejection', severity: 'error' }).catch(() => null);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL GUARD] Uncaught exception:', err?.stack || err);
  runtimeIncidents.capture(err, { source: 'process', eventType: 'uncaught-exception', severity: 'fatal' }).catch(() => null);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.GuildMember, Partials.User],
});

client.on('error', err => {
  runtimeIncidents.capture(err, { source: 'discord-client', eventType: 'discord-client-error', severity: 'error' }).catch(() => null);
});
client.on('shardError', err => {
  runtimeIncidents.capture(err, { source: 'discord-shard', eventType: 'discord-shard-error', severity: 'error' }).catch(() => null);
});

// ── 3. Slash command definitions ──────────────────────────────
const { getCommandsForCurrentState, deployCommandsForCurrentState } = require('./src/services/commandRegistryService');
const responseGuard = require('./src/services/responseGuardService');
const eventClaim = require('./src/services/eventClaimService');
const personaArbiter = require('./src/services/personaArbiterService');
const responseLifecycle = require('./src/services/responseLifecycleService');

// Canonical commissioner ID resolver — imported from helpers (single source of truth)
// Replaces the duplicate inline function that existed here and in interactionRouter.js
const { getActiveCommissionerIds } = require('./src/utils/helpers');
const { prismaSafe } = require('./src/storage/prisma');
function dynamicCommissioners(stateStore = null) {
  return getActiveCommissionerIds(stateStore, COMMISSIONER_IDS);
}

const recentWelcomeJoins = new Map(); // joinKey → expiry timestamp
const WELCOME_JOIN_TTL = 20000; // 20s dedup window


function _isTimezoneOptionalForMember(member) {
  try {
    const profiles = require('./src/services/memberProfileService');
    return !!profiles.getProfile(member?.id)?.timezone;
  } catch {
    return false;
  }
}

async function _postTimezoneOnboardingPrompt(member) {
  try {
    if (_isTimezoneOptionalForMember(member)) return;
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
    const settings = require('./src/services/serverSettingsService').getSettings();
    const timezoneGateService = require('./src/services/timezoneGateService');
    if (settings.requireTimezone) {
      await timezoneGateService.postGatePrompt(member).catch(() => null);
      await timezoneGateService.lockMemberToTimezoneGate(member).catch(() => null);
      return;
    }
    const welcomeCh = getCh(member.guild, 'welcome');
    if (!welcomeCh) return;
    await welcomeCh.send({
      content: `${member}`,
      embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🕒 Set Your Timezone')
        .setDescription(
          `Save your timezone so schedules, reminders, and league channels make sense for you.

` +
          `Use the button below to save it. Once saved, myBot can keep your display like **wthames (PST)** or **Ravens (PST)** inside the right spaces.`
        )
        .setFooter({ text: 'Triggered automatically after build, when timezone gate is toggled on, and when a new member joins.' })
        .setTimestamp()],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('timezone_onboarding_button').setLabel('Set Timezone').setStyle(ButtonStyle.Primary)
      )],
      allowedMentions: { users: [member.id], parse: [] },
    }).catch(() => null);
  } catch {}
}


async function _tryHandlePracticalTimezoneMessage(message) {
  try {
    if (!message?.guild || !message.member || message.author?.bot) return false;
    const { normalizeTimezone } = require('./src/services/timezoneService');
    const memberProfiles = require('./src/services/memberProfileService');
    const nicknamePolicy = require('./src/services/nicknamePolicyService');
    const channelName = String(message.channel?.name || '').toLowerCase();
    const raw = String(message.content || '').trim();
    if (!raw) return false;
    const looksDirect = /^([A-Za-z_\/+\-]{2,40})$/.test(raw) || /^my timezone is\s+/i.test(raw) || /^timezone\s*[:=]/i.test(raw);
    if (!looksDirect && !matchesConfiguredChannel(message.channel, 'timezoneGate')) return false;
    const timezone = normalizeTimezone(raw);
    if (!timezone) return false;
    const liveMember = await message.guild.members.fetch(message.member.id).catch(() => message.member);
    const label = String(nicknamePolicy.timezoneLabel(timezone) || timezone || '').toUpperCase();
    memberProfiles.upsertProfile(liveMember.id, {
      timezone,
      timezoneLabel: label,
      lastSeenDisplayName: nicknamePolicy.stripTimezoneSuffix(liveMember.displayName || liveMember.user?.username || '')
    });
    try {
      for (const player of state.players.values()) {
        if (!player || String(player.userId || '') !== String(liveMember.id)) continue;
        player.timezone = timezone;
      }
    } catch {}
    await nicknamePolicy.syncMemberNickname(liveMember, state, { reason: 'Practical timezone message save', channel: message.channel, channelId: message.channelId }).catch(() => null);
    await timezoneGateService.releaseMemberFromTimezoneGate(liveMember).catch(() => null);
    if (matchesConfiguredChannel(message.channel, 'timezoneGate')) {
      await message.delete().catch(() => null);
      await message.channel.send({ content: `✅ Timezone saved as **${timezone}** (${label}).`, allowedMentions: { parse: [] } }).then(async sent => {
        setTimeout(() => sent.delete().catch(() => null), 5000);
      }).catch(() => null);
    } else {
      await message.reply(`✅ Timezone saved as **${timezone}** (${label}).`).catch(() => null);
    }
    return true;
  } catch {
    return false;
  }
}

async function _syncMemberDisplay(member) {
  return _syncMemberDisplayForChannel(member, null, { reason: 'Member display sync' });
}

async function _syncMemberDisplayForChannel(member, channel = null, extra = {}) {
  try {
    const profiles = require('./src/services/memberProfileService');
    const nicknames = require('./src/services/nicknamePolicyService');
    const profile = profiles.getProfile(member.id);
    if (!profile?.timezone) return;
    await nicknames.syncMemberNickname(member, state, { ...extra, channel, channelId: channel?.id || null }).catch(() => null);
  } catch {}
}

async function deployCommands() {
  // FIX: Add timeout — Discord REST API can hang on rate limits or network issues.
  // Without this, the entire boot stalls and client.login() never runs.
  const DEPLOY_TIMEOUT_MS = 15000;
  try {
    const result = await Promise.race([
      deployCommandsForCurrentState(state),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT: slash command deploy exceeded 15s')), DEPLOY_TIMEOUT_MS)),
    ]);
    console.log(`   ✅ Slash commands registered (${result.count}) [installationMode=${result.installationMode ? 'yes' : 'no'}]`);
  } catch (err) {
    console.warn(`   ⚠️ Slash command deploy failed (non-fatal): ${err.message}`);
    console.warn('   Commands will be registered on next successful attempt.');
  }
}

// ── 4. Event routing ─────────────────────────────────────────
const { resolveAllChannels, getCh, invalidateChannel } = require('./src/services/channels/channelResolver');
const channelNamingPolicy = require('./src/services/channelNamingPolicyService');
const guideLifecycle       = require('./src/services/guideLifecycleService');

// Module-scope constant — built ONCE at startup from the naming policy.
// SECURITY FIX: was rebuilt inside messageCreate on every message (MED-08).
// patchNotes is always included via READ_ONLY_BASE_CHANNEL_KEYS in channels.js.
const READ_ONLY_BASE_CHANNELS = new Set(
  require('./src/services/channelTopologyService').getReadOnlyBaseChannelNames()
    .map(name => String(name || '').toLowerCase())
);
const { matchesConfiguredChannel, getReadOnlyBaseChannelNames, getConfiguredChannelName } = require('./src/services/channelTopologyService');
const { aiCall, MODELS }      = require('./src/services/ai/anthropicService');
const { getTeamEmoji }        = require('./src/utils/teamUtils');
const state                   = require('./src/state');
const { loadJson, initStore }  = require('./src/storage/jsonStore');
let processDueActiveChecks = async () => {};
try { ({ processDueActiveChecks } = require('./src/services/leagueFeatureService')); } catch {}
const { applyBotIdentity } = require('./src/services/botIdentityService');
const timezoneGateService = require('./src/services/timezoneGateService');

// Lazy-require handlers so they don't initialize before state is ready
function wireEvents() {
  const { handleCommissionerAI, shouldHandleCommAI } = require('./src/handlers/commissionerHandler');
  const { shouldHandleMemberAI, handleMemberMention }= require('./src/handlers/memberMentionHandler');
  const { shouldHandleIT, handleIT }                 = require('./src/handlers/itHandler');
  const { handleInteraction }   = require('./src/routing/interactionRouter');
  const { handleCommishHubScreenshot, handleAnywhereSchedule } = require('./src/parsers/hubScreenshotParser');
  // handleGameChannelMessage is called via gameResultParser (line 533), not directly here
  // gameChannelService is still required indirectly through gameResultParser
  const { isAdminMember, canBotModerate } = require('./src/utils/helpers');
  const { refreshOpenTeamsBoard, releaseTeamByUserId: releaseByUserId, announceTeamOpen } = require('./src/services/openTeamsService');
  const { runWeeklyRelease, startHubReleaseTimer, startScheduleTimer, postScheduleEmbed } = require('./src/services/hubReleaseService');
  const { refresh: refreshRewards }    = require('./src/services/rewardBoardService');
  const { makeLogger }                 = require('./src/utils/logger');
  const log = makeLogger('router');

  client.on('guildCreate', async guild => {
    try {
      if (String(guild.id) !== String(GUILD_ID)) return;
      const wizardState = require('./src/services/wizardStateService');
      const router = require('./src/routing/interactionRouter');
      if (wizardState.isInstallationMode()) {
        await deployCommandsForCurrentState(state).catch(() => null);
        await require('./src/services/patchNotesService').publishPatchNotes(guild).catch(() => null);
        const ch = await router.ensureSetupWizardChannel(guild, { reveal: true }).catch(() => null);
        await router.ensureSetupWizardStarterMessage?.(ch, 'Fresh install detected. Setup is waiting in this lane.').catch(() => null);
        await router.postSetupWizardMessage(guild, 'Fresh install detected. The setup wizard was opened automatically.').catch(() => null);
      }
    } catch (err) {
      log.warn(`guildCreate setup wizard auto-open failed: ${err.message}`);
    }
  });

  // ── Spam tracker (V185: extracted to src/services/spamService.js) ──
  const spamService = require('./src/services/spamService');
  async function handleSpam(message) {
    return spamService.handleSpam(message, { state, commRole: COMM_ROLE, getCommissioners: () => dynamicCommissioners(state), getCh });
  }

  const withMessageSpace = fn => async (...args) => {
    const message=args[args.length-1];
    const registry=require('./src/services/activeLeagueService');
    const league=registry.findLeagueForChannel(message?.channel);
    return require('./src/league/spaceContext').run(league?.id,async()=>{
      try { return await fn(...args); }
      finally { state.flushSpace?.(); await require('./src/storage/jsonStore').flushSpaceWrites(); }
    });
  };

  // ── Stream credit (V185: extracted to src/services/streamCreditService.js) ──
  const streamCreditService = require('./src/services/streamCreditService');
  const STREAM_RX = streamCreditService.STREAM_RX;
  const { EmbedBuilder } = require('discord.js');
  async function addStreamCredit(message) {
    return streamCreditService.addStreamCredit(message, { state, getCh, refreshRewards });
  }

  // ── Auto-offense detection (V185: extracted to src/services/offenseDetectionService.js) ──
  const offenseDetectionService = require('./src/services/offenseDetectionService');
  async function detectAndRouteOffense(message) {
    return offenseDetectionService.detectAndRouteOffense(message, { state, commRole: COMM_ROLE, getCommissioners: () => dynamicCommissioners(state), getCh, aiCall, MODELS });
  }

  // ── Periodic cleanup for spamTracker ──
  setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [userId, d] of state.spamTracker.entries()) {
      const lastSeen = d.timestamps.length ? Math.max(...d.timestamps) : 0;
      if (lastSeen < cutoff) state.spamTracker.delete(userId);
    }
  }, 60 * 60 * 1000).unref?.();

  // ── messageCreate ──────────────────────────────────────────
  // ── messageCreate early lock — prevents messageUpdate from double-firing AI ──
  // Discord fires messageUpdate (embed resolution) within ms of messageCreate.
  // The AI routing claim happens late in messageCreate (after 15+ checks).
  // This lock tells messageUpdate "messageCreate is already handling this message".
  const _messageCreateInFlight = new Map(); // msgId → timestamp
  const MC_INFLIGHT_TTL = 60000; // 60s

  client.on('messageCreate', withMessageSpace(async message => {
    if (!(await eventClaim.claim(eventClaim.messageCreateKey(message), 30000))) {
      console.log('[messageCreate] globally deduped', message.id);
      return;
    }
    // Lock immediately — before any other work
    if (message.id) {
      const now = Date.now();
      for (const [k, ts] of _messageCreateInFlight.entries()) { if (now - ts > MC_INFLIGHT_TTL) _messageCreateInFlight.delete(k); }
      _messageCreateInFlight.set(message.id, now);
    }
    // Content scanning — audience-gated, runs before all other handlers
    if (!message.author?.bot && message.guild) {
      try {
        const contentScan = require('./src/services/contentScanService');
        const serverSettings = require('./src/services/serverSettingsService');
        const settings = serverSettings.getSettings();
        if (settings.serverInitialized) {
          const blocked = await contentScan.enforceScan(message, settings.audienceRating);
          if (blocked) return; // Message deleted, stop all further processing
        }
      } catch (_scanErr) { /* scan failures are non-fatal */ }
    }
    if (message.author.bot) return;
    try {
      const settings = require('./src/services/serverSettingsService').getSettings();
      if (String(settings.botStatus || 'active').toLowerCase() === 'killed') {
        if (message.guild && /^\s*\/??ignite-bot\b/i.test(String(message.content || ''))) return;
        return;
      }
    } catch {}

    if (message.guild && message.member?.partial) try { await message.member.fetch(); } catch {}

    // Track member activity in ledger (every message = proof of life)
    if (message.guild && message.author) {
      require('./src/services/memberLedgerService').trackActivity(
        message.author.id, message.author.tag || message.author.username
      );
    }
    require('./src/services/leagueFeatureService').recordActiveCheckResponse(message.channel.id, message.author.id);

    // Guide lifecycle: record activity + check for idle refresh
    if (message.guild && message.channel?.id) {
      guideLifecycle.recordActivity(message.guild.id, message.channel.id);
    }

    if (message.guild && message.member) {
      // Native nicknames do not depend on message/channel activity.
    }

    if (await handleSpam(message).catch(()=>false)) return;

    if (await _tryHandlePracticalTimezoneMessage(message).catch(()=>false)) return;

    // Setup wizard avatar upload handshake
    if (message.guild && isAdminMember(message.member, COMM_ROLE, dynamicCommissioners(state)) && matchesConfiguredChannel(message.channel, 'setupWizard') && message.attachments?.size) {
      const wizardPrefs = require('./src/services/wizardPreferencesService');
      const prefs = wizardPrefs.getPrefs();
      const attachments = [...message.attachments.values()];
      const supportedImage = (a) => {
        const type = String(a.contentType || '').toLowerCase();
        const name = String(a.name || '').toLowerCase();
        const looksImageByExt = /\.(png|jpe?g|gif|webp)$/i.test(name);
        const looksImageByMime = type.startsWith('image/');
        const blocked = /\.(pdf|docx?|txt|py|zip|rar|7z|js|ts|json|csv)$/i.test(name) || /application\/(pdf|msword|vnd|zip|x-python-code)/i.test(type);
        return !blocked && (looksImageByMime || looksImageByExt);
      };
      if (prefs.awaitingAvatarUpload) {
        if (attachments.length !== 1) {
          await message.reply('❌ Upload exactly **one** supported image file for the bot avatar.').catch(() => null);
          return;
        }
        const bad = attachments.find(a => !supportedImage(a));
        if (bad) {
          await message.reply(`❌ **${bad.name || 'That file'}** is not a supported bot avatar upload. Use only **PNG, JPG, JPEG, GIF, or WEBP** in **#${getConfiguredChannelName('setupWizard') || 'setup-wizard'}**.`).catch(() => null);
          return;
        }
        const image = attachments[0];
        if (!image?.url) {
          await message.reply('❌ Upload exactly one supported image file for the bot avatar.').catch(() => null);
          return;
        }
        const serverSettings = require('./src/services/serverSettingsService');
        const promptId = prefs.avatarPromptMessageId || null;
        serverSettings.setBotIdentity({ avatarMode: 'url', avatarUrl: image.url });
        wizardPrefs.savePrefs({ awaitingAvatarUpload: false, avatarPromptMessageId: null });
        await require('./src/services/botIdentityService').applyBotIdentity(client, message.guild).catch(err => ({ ok:false, reason: err?.message || 'apply_failed' }));
        const router = require('./src/routing/interactionRouter');
        const setupCh = await router.ensureSetupWizardChannel(message.guild).catch(() => null);
        if (setupCh) await router.ensureSetupWizardStarterMessage(setupCh, 'Bot identity changed live.').catch(() => null);
        if (promptId) {
          const promptMsg = await message.channel.messages.fetch(promptId).catch(() => null);
          if (promptMsg) await promptMsg.delete().catch(() => null);
        }
        const recent = await message.channel.messages.fetch({ limit: 25 }).catch(() => null);
        for (const pending of (recent ? [...recent.values()] : [])) {
          if (pending.author?.id !== client.user.id) continue;
          const content = String(pending.content || '');
          if (/Upload one supported image/i.test(content) || /Avatar upload mode is live/i.test(content)) await pending.delete().catch(() => null);
        }
        await message.delete().catch(() => null);
        return;
      }
    }

// ── Read-only channel guard — runs on every message for non-admins ──
const senderIsAdmin = isAdminMember(message.member, COMM_ROLE, dynamicCommissioners(state));
if (!senderIsAdmin && READ_ONLY_BASE_CHANNELS.has(String(message.channel?.name || '').toLowerCase())) {
  const wasMention = message.mentions.users?.has(client.user.id) || false;
  const channelName = String(message.channel?.name || '').toLowerCase();
  await message.delete().catch(() => null);
  if (wasMention) {
    const guidance = channelName === 'polls'
      ? `📊 **${message.guild?.name || 'This server'}** polls are vote-only. Use the poll buttons or picklists when a poll is posted. For questions, use **#general-chat**.`
      : `📘 **${message.guild?.name || 'This server'}** info channels are read-only. Ask me in **#general-chat** instead, or use **/join-league** if you want into a league.`;
    await message.author.send(guidance).catch(() => null);
  }
  return;
}

    // Legacy AI-assisted trash-talk learning is opt-in and never runs on ordinary passive messages by default.
    if (String(process.env.ENABLE_TRASH_TALK_LEARNING || '').toLowerCase() === 'true' && message.mentions.users?.has(client.user.id)) {
      require('./src/services/trashTalkBank').learnFromMessage(message, aiCall, MODELS).catch(()=>null);
    }

    if (await handleCommishHubScreenshot(message,{getCh,state,aiCall,MODELS,isAdminMember:(m)=>isAdminMember(m,COMM_ROLE,dynamicCommissioners(state)),COMM_ROLE}).catch(()=>false)) return;

    const intakeEligibleChannel = ['commish-hub','scoresheets'].includes(String(message.channel?.name || '').toLowerCase());
    if (message.attachments.size > 0 && isAdminMember(message.member, COMM_ROLE, COMMISSIONER_IDS) && (intakeEligibleChannel || message.mentions.users?.has(client.user.id))) {
      const fileIntakeService = require('./src/services/fileIntakeService');
      if (await fileIntakeService.tryHandleLeagueDataIntakeMessage(message, { aiCall, MODELS, state }).catch(()=>false)) return;
    }

    // Commissioner @mentions bot with an image outside of #commish-hub → try schedule OCR
    if (message.attachments.size > 0 && isAdminMember(message.member, COMM_ROLE, COMMISSIONER_IDS) &&
        message.mentions.users?.has(client.user.id)) {
      if (await handleAnywhereSchedule(message,{getCh,state,aiCall,MODELS,isAdminMember:(m)=>isAdminMember(m,COMM_ROLE,dynamicCommissioners(state)),COMM_ROLE}).catch(()=>false)) return;
    }

    // Game result routing — extracted to src/parsers/gameResultParser.js (Build Map Phase 1)
    await addStreamCredit(message).catch(() => null);
    if (message.guild) {
      if (require('./src/parsers/gameResultParser').isGameChannel(message.channel.id, state)) {
        require('./src/parsers/gameResultParser').handleGameChannelMessage(message, { state, getCh }).catch(() => null);
      }
      detectAndRouteOffense(message).catch(() => null);
    }

    // V204.7 passive conversation awareness runs only after moderation, read-only, setup/file intake,
    // game-result and offense-routing gates have accepted the message. Observation is memory-only and silent.
    if (message.guild) {
      try { require('./src/services/ambientConversationService').observe(message); } catch (_ambientErr) { /* non-fatal */ }
    }

    // ── AI Routing (V184: persona arbiter + response lifecycle) ──────
    // Priority: IT (technical diagnostics) → Commissioner AI → Member AI
    // The persona arbiter ensures exactly ONE persona responds per message.
    const _itMatch = shouldHandleIT(message, client, getCh);
    const _commAIMatch = !_itMatch && shouldHandleCommAI(message, client, getCh);
    const _memberAIMatch = !_itMatch && !_commAIMatch && shouldHandleMemberAI(message, client, state);

    if (_itMatch || _commAIMatch || _memberAIMatch) {
      const wizardState = require('./src/services/wizardStateService');
      const settings = require('./src/services/serverSettingsService').getSettings();

      const decision = personaArbiter.arbitrate({
        isIT: _itMatch,
        isCommissioner: _commAIMatch,
        isMember: _memberAIMatch,
        message,
        setupActive: !!wizardState.getState().installationMode && !settings.serverInitialized,
        botKilled: String(settings.botStatus || 'active').toLowerCase() === 'killed',
      });

      console.log(`[AI-ROUTE] user=${message.author?.tag} channel=#${message.channel?.name} winner=${decision.winner} reason=${decision.reason} candidates=${decision.candidates.join(',')}`);

      if (decision.winner) {
        const handlerMap = {
          'it-ai': (msg, args) => handleIT(msg, { getCh, state, client, ...args }),
          'commissioner-ai': (msg, args) => handleCommissionerAI(msg, { getCh, state, aiCall, MODELS, client, ...args }),
          'member-ai': (msg, args) => handleMemberMention(msg, { aiCall, MODELS, state, ...args }),
        };

        const result = await responseLifecycle.executeLifecycle({
          message,
          persona: decision.winner,
          handler: handlerMap[decision.winner],
          handlerArgs: {},
        });

        if (result.outcome === 'deduped' || result.outcome === 'claim-lost') {
          console.log(`[AI-ROUTE] lifecycle ${result.outcome} — msg=${message.id} persona=${decision.winner}`);
        }
        return;
      }
    }
  }));

  // ── messageDelete ─────────────────────────────────────────
  client.on('messageDelete', withMessageSpace(async msg => {
    if (msg?.author?.bot) return;
    try { require('./src/services/ambientConversationService').removeMessage(msg); } catch (_ambientDeleteErr) {}
  }));

  client.on('messageDeleteBulk', withMessageSpace(async messages => {
    try {
      const ambient = require('./src/services/ambientConversationService');
      for (const msg of (messages?.values?.() || [])) if (!msg?.author?.bot) ambient.removeMessage(msg);
    } catch (_ambientBulkDeleteErr) {}
  }));

  // ── messageUpdate ─────────────────────────────────────────
  // Handles: stream link edits AND edited messages that @mention the bot
  client.on('messageUpdate', withMessageSpace(async (_old, msg) => {
    if (!(await eventClaim.claim(eventClaim.messageUpdateKey(msg), 30000))) {
      console.log('[messageUpdate] globally deduped', msg.id);
      return;
    }
    if (msg.author?.bot) return;
    // Keep already-observed ambient context accurate when a human edits a message. This never creates a response.
    try { require('./src/services/ambientConversationService').updateMessage(msg); } catch (_ambientUpdateErr) {}
    if (msg.partial) try { await msg.fetch(); } catch { return; }

    // Stream credit: link added or removed via edit
    const hadLink=STREAM_RX.test(_old.content||''), hasLink=STREAM_RX.test(msg.content||'');
    const entry=[...state.players.values()].find(p=>p.userId===msg.author?.id);
    const alreadyCounted=entry&&entry.streamLog.findIndex(s=>s.msgId===msg.id)!==-1;
    if (!hadLink&&hasLink&&!alreadyCounted) await addStreamCredit(msg).catch(()=>null);
    else if (hadLink&&!hasLink&&alreadyCounted) {
      entry.streamLog.splice(entry.streamLog.findIndex(s=>s.msgId===msg.id),1);
      entry.streamCount=entry.streamLog.length;
    }

    // AI routing: respond if the edit added a bot @mention that wasn't there before
    if (!msg.guild) return;
    if (msg.member?.partial) try { await msg.member.fetch(); } catch {}

    // V184 FIX: If messageCreate is already handling or has handled this message, skip AI routing.
    // This prevents the embed-resolution messageUpdate from triggering a second AI response.
    if (_messageCreateInFlight.has(msg.id)) {
      console.log(`[messageUpdate] skipping AI route — messageCreate in-flight for msg=${msg.id}`);
      return;
    }

    const oldMentionedBot = (_old.mentions?.users?.has(client.user.id)) ?? false;
    const nowMentionsBot  = (msg.mentions?.users?.has(client.user.id)) ?? false;
    if (!oldMentionedBot && nowMentionsBot) {
      // V184: Route through persona arbiter + lifecycle, same as messageCreate
      const _itMatch = shouldHandleIT(msg, client, getCh);
      const _commAIMatch = !_itMatch && shouldHandleCommAI(msg, client, getCh);
      const _memberAIMatch = !_itMatch && !_commAIMatch && shouldHandleMemberAI(msg, client, state);

      if (_itMatch || _commAIMatch || _memberAIMatch) {
        const decision = personaArbiter.arbitrate({
          isIT: _itMatch,
          isCommissioner: _commAIMatch,
          isMember: _memberAIMatch,
          message: msg,
        });

        if (decision.winner) {
          const handlerMap = {
            'it-ai': (m, args) => handleIT(m, { getCh, state, client, ...args }),
            'commissioner-ai': (m, args) => handleCommissionerAI(m, { getCh, state, aiCall, MODELS, client, ...args }),
            'member-ai': (m, args) => handleMemberMention(m, { aiCall, MODELS, state, ...args }),
          };

          await responseLifecycle.executeLifecycle({
            message: msg,
            persona: decision.winner,
            handler: handlerMap[decision.winner],
            handlerArgs: {},
          });
        }
      }
    }
  }));

  // ── interactionCreate ─────────────────────────────────────
  const router = require('./src/routing/interactionRouter');
  const securityMiddleware = require('./src/services/securityMiddlewareService');
  router.init({ getCh, state, aiCall, MODELS, client, services: {} });
  const { resolveInteractionAlias } = require('./src/services/commandAliasService');
  client.on('interactionCreate', async interaction => {
    const startedAt = Date.now();
    // V203: grouped aliases (e.g. /game-channels hub status → hub-status) resolve before ANY gate reads commandName.
    try { resolveInteractionAlias(interaction); } catch (aliasErr) { console.warn('[interactionCreate] alias resolve failed', aliasErr.message); }
    console.log('[interactionCreate]', {
      type: interaction.type,
      commandName: interaction.commandName ?? null,
      customId: interaction.customId ?? null,
      user: interaction.user?.tag ?? null,
      guildId: interaction.guildId ?? null,
    });

    let watchdog = null;
    const armAckWatchdog = () => {
      if (interaction.isAutocomplete?.() || interaction.isModalSubmit?.()) return;
      watchdog = setTimeout(async () => {
        try {
          if (interaction.replied || interaction.deferred) return;
          if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
            await interaction.deferUpdate().catch(() => null);
            console.log('[interactionCreate] watchdog deferUpdate', interaction.customId || interaction.commandName || 'unknown');
            return;
          }
          if (interaction.isChatInputCommand?.() || interaction.isMessageContextMenuCommand?.()) {
            await interaction.deferReply({ flags: 64 }).catch(() => null);
            console.log('[interactionCreate] watchdog deferReply', interaction.commandName || interaction.customId || 'unknown');
          }
        } catch (watchdogErr) {
          console.error('[interactionCreate watchdog failed]', watchdogErr);
        }
      }, 1200);
    };

    try {
      armAckWatchdog();
      if (!(await eventClaim.claim(eventClaim.interactionKey(interaction), 15000))) {
        console.log('[interactionCreate] globally deduped', interaction.commandName || interaction.customId || interaction.id);
        return;
      }
      if (!responseGuard.claimInteractionExecution(interaction, 10000)) {
        console.log('[interactionCreate] deduped', interaction.commandName || interaction.customId || interaction.id);
        return;
      }
      // ── Security gate: rate limiting ─────────────────────────
      if (!interaction.isAutocomplete?.()) {
        const blocked = await securityMiddleware.guardInteraction(interaction);
        if (blocked) return;
      }
      if (interaction.guild && interaction.member) {
        try { if (interaction.member.partial) await interaction.member.fetch(); } catch {}
        // Community labels are rendered by the selected league, not native nicknames.
      }
      const { handleSetupInteraction, handleProAmTeamModal } = require('./src/services/leagueSetupService');
      const { handleJoinInteraction, handleJoinModal } = require('./src/services/joinLeagueService');
      // Setup wizard: select menus and pro-am team buttons
      if (interaction.isStringSelectMenu?.() && interaction.customId?.startsWith('setup_') && !interaction.customId?.startsWith('setup_wizard_')) {
        return await handleSetupInteraction(interaction, state);
      }
      if (interaction.isButton?.() && interaction.customId === 'setup_proam_next_team') {
        return await handleSetupInteraction(interaction, state);
      }
      // Pro-Am team name modal
      if (interaction.isModalSubmit?.() && interaction.customId === 'setup_proam_team_modal') {
        return await handleProAmTeamModal(interaction, state, aiCall, MODELS);
      }
      // Join-league wizard interactions
      if ((interaction.isStringSelectMenu?.() && interaction.customId?.startsWith('join_')) || (interaction.isButton?.() && interaction.customId?.startsWith('join_'))) {
        return await handleJoinInteraction(interaction, state);
      }
      if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('join_')) {
        const { grantMemberAccessToLeague } = require('./src/services/leagueVisibilityService');
        return await handleJoinModal(interaction, state, interaction.guild, grantMemberAccessToLeague);
      }
      await router.handleInteraction(interaction);
    } catch (e) {
      console.error('[interactionCreate fatal]', e);
      try {
        if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ Interaction failed. Check logs.', flags: 64 }).catch(() => null);
        } else if (interaction.isRepliable?.() && interaction.deferred) {
          await interaction.editReply({ content: '❌ Interaction failed. Check logs.' }).catch(() => null);
        }
      } catch (replyErr) {
        console.error('[interactionCreate fallback failed]', replyErr);
      }
    } finally {
      responseGuard.releaseInteractionExecution(interaction);
      await eventClaim.release(eventClaim.interactionKey(interaction)).catch(() => null);
      if (watchdog) clearTimeout(watchdog);
      if (interaction.isChatInputCommand?.() && interaction.deferred && !interaction.replied && !interaction.__nofunFinalized) {
        try {
          await interaction.editReply({ content: '✅ Request accepted. The action is still running in the background.' }).catch(() => null);
          interaction.__nofunFinalized = true;
        } catch {}
      }
      console.log('[interactionCreate done]', {
        commandName: interaction.commandName ?? null,
        customId: interaction.customId ?? null,
        ms: Date.now() - startedAt,
        replied: !!interaction.replied,
        deferred: !!interaction.deferred,
      });
    }
  });

  // ── messageReactionAdd ────────────────────────────────────
  client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    try {
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();
    } catch { return; }
    // Gold roast detection — messages with 2+ reactions become trash talk material
    require('./src/services/trashTalkBank').checkGoldRoast(reaction, user).catch(()=>null);
  });

  // ── guildMemberRemove ─────────────────────────────────────
  client.on('guildMemberRemove', async member => {
    const ledger = require('./src/services/memberLedgerService');

    // Determine if this was a kick, ban, or voluntary leave via audit log
    let departureType = 'leave';
    let departureReason = 'Left the server voluntarily';
    let departureBy = null;
    try {
      const auditLogs = await member.guild.fetchAuditLogs({ limit: 5, type: 20 });
      const kickEntry = auditLogs.entries.find(e =>
        e.target?.id === member.id && (Date.now() - e.createdTimestamp) < 10_000
      );
      if (kickEntry) {
        departureType = 'kick';
        departureReason = kickEntry.reason || 'No reason specified';
        departureBy = kickEntry.executor?.id || null;
      } else {
        const banLogs = await member.guild.fetchAuditLogs({ limit: 5, type: 22 });
        const banEntry = banLogs.entries.find(e =>
          e.target?.id === member.id && (Date.now() - e.createdTimestamp) < 10_000
        );
        if (banEntry) {
          departureType = 'ban';
          departureReason = banEntry.reason || 'No reason specified';
          departureBy = banEntry.executor?.id || null;
        }
      }
    } catch {}

    // Record in permanent ledger
    ledger.recordLeave(member, departureType, departureReason, departureBy);
    await require('./src/services/lifetimeHistoryService').presence(member.guild.id,member.id,'LEFT').catch(err=>log.error('Lifetime departure write failed:',err.message));
    for (const space of require('./src/services/activeLeagueService').listActiveLeagues()) await require('./src/services/leagueVisibilityService').revokeMemberAccess(member.guild,member.id,space.id).catch(err=>log.error('Membership revocation failed:',err.message));

    const released = await releaseByUserId(member.guild, member.id).catch(()=>null);
    if (released) {
      ledger.recordTeamRelease(member.id);
      await announceTeamOpen(member.guild, released, 'the previous owner left the server').catch(()=>null);
    }
    const bootCh = getCh(member.guild, 'bootLog');
    if (bootCh) {
      const icon = departureType === 'ban' ? '🔨' : departureType === 'kick' ? '🥾' : '📤';
      const title = departureType === 'ban' ? 'Member Banned' : departureType === 'kick' ? 'Member Kicked' : 'Member Left';
      const rec = ledger.getRecord(member.id);
      const priorKicks = rec.kickHistory.length;
      const totalWarnings = rec.warnings.total;
      await bootCh.send({embeds:[new EmbedBuilder().setColor(departureType === 'ban' ? 0xff0000 : departureType === 'kick' ? 0xff4400 : 0xffc107)
        .setTitle(`${icon} ${title}`)
        .setDescription(`**${member.user.tag}** ${departureType === 'leave' ? 'left' : `was ${departureType}ed`}.${released ? `\n**${released.displayTeam}** is now open.` : ''}`)
        .addFields(
          { name: 'Reason', value: departureReason, inline: false },
          { name: 'Prior Kicks/Bans', value: String(priorKicks), inline: true },
          { name: 'Total Warnings', value: String(totalWarnings), inline: true },
        )
        .setTimestamp()]}).catch(()=>null);
    }
  });

  // ── guildMemberAdd ────────────────────────────────────────
  // When a member joins:
  //   1. Check if they have prior history (kicks, bans, warnings) → alert commissioner
  //   2. DM them with a direct jump link to #rules
  //   3. Post a welcome card in #welcome
  client.on('guildMemberAdd', async member => {
    const joinKey = `${member.guild.id}:${member.id}`;
    const now = Date.now();
    // Sweep expired entries (no timer handles needed)
    for (const [k, exp] of recentWelcomeJoins.entries()) { if (exp <= now) recentWelcomeJoins.delete(k); }
    const prevExp = recentWelcomeJoins.get(joinKey);
    if (prevExp && prevExp > now) return;
    recentWelcomeJoins.set(joinKey, now + WELCOME_JOIN_TTL);
    const guild       = member.guild;
    const ledger      = require('./src/services/memberLedgerService');

    // Record join in permanent ledger
    ledger.recordJoin(member);
    await require('./src/services/lifetimeHistoryService').presence(member.guild.id,member.id,'PRESENT').catch(err=>log.error('Lifetime rejoin write failed:',err.message));

    const serverSettings = require('./src/services/serverSettingsService');
    const settings = serverSettings.getSettings();
    const audienceWarning = serverSettings.requiresAgeWarning(settings.audienceRating) && settings.ageWarningEnabled
      ? serverSettings.getAudienceWarning(settings.audienceRating, settings.filterMode)
      : null;

    // ── RETURNING MEMBER CHECK — PREVIOUSLY KICKED ──
    // If they were kicked/banned before, alert commissioner with approve/kick buttons
    const rec = ledger.getRecord(member.id);
    const wasKicked = rec.kickHistory.length > 0;
    const wasBanned = rec.isBanned;

    if ((wasKicked || wasBanned) && ledger.isReturningMember(member.id)) {
      const adminCh = getCh(guild, 'adminHq') || getCh(guild, 'commAI');
      if (adminCh) {
        const kicks = rec.kickHistory.length;
        const lastKick = rec.kickHistory[rec.kickHistory.length - 1];
        const lastBan = rec.banHistory[rec.banHistory.length - 1];

        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const embed = new EmbedBuilder()
          .setColor(wasBanned ? 0x8b0000 : 0xff4500)
          .setTitle(`🚨 ${wasBanned ? 'BANNED' : 'KICKED'} MEMBER JUST WALKED BACK IN`)
          .setDescription(
            `Well well well... **${member.user.tag}** just had the audacity to rejoin this server.\n\n` +
            `This motherf***er has been ${wasBanned ? '**BANNED**' : '**KICKED**'} before. ` +
            `${kicks} time${kicks !== 1 ? 's' : ''} to be exact. ` +
            `And here they are, strolling back in like nothing happened.\n\n` +
            `**Commissioner, your call.** Let them stay, or send them right back where they came from.`
          )
          .addFields(
            { name: 'Times Kicked', value: String(kicks), inline: true },
            { name: 'Total Warnings', value: String(rec.warnings.total), inline: true },
            { name: 'Banned Before', value: wasBanned ? '⚠️ YES' : 'No', inline: true },
          );
        if (lastKick) embed.addFields({ name: 'Last Kick Reason', value: `${lastKick.reason}\n*<t:${Math.floor(lastKick.timestamp / 1000)}:R>*` });
        if (rec.teamHistory.length > 0) embed.addFields({ name: 'Previous Team', value: rec.teamHistory[rec.teamHistory.length - 1].team, inline: true });
        embed.setFooter({ text: `User ID: ${member.id}` }).setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rejoin_allow_${member.id}`).setLabel('✅ Let Them Stay').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`rejoin_kick_${member.id}`).setLabel('🥾 Kick Their Ass Out').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`rejoin_ban_${member.id}`).setLabel('🔨 Ban Permanently').setStyle(ButtonStyle.Danger),
        );

        await adminCh.send({
          content: COMM_ROLE ? `<@&${COMM_ROLE}> 🚨 **Previously ${wasBanned ? 'banned' : 'kicked'} member just rejoined**` : '🚨 **Previously kicked member just rejoined**',
          embeds: [embed],
          components: [row],
          allowedMentions: COMM_ROLE ? { roles: [COMM_ROLE] } : {},
        }).catch(() => null);
      }
    }
    // Regular returning member (left voluntarily, no kicks) — just log it
    else if (ledger.isReturningMember(member.id)) {
      const adminCh = getCh(guild, 'adminHq') || getCh(guild, 'commAI');
      if (adminCh) {
        const embed = ledger.buildReturningAlert(member);
        if (embed) {
          await adminCh.send({
            content: 'ℹ️ **Returning member** (no prior kicks)',
            embeds: [embed],
          }).catch(() => null);
        }
      }
    }

    const rulesCh     = getCh(guild, 'rules');
    const openTeamsCh = getCh(guild, 'openTeams');
    const welcomeCh   = getCh(guild, 'welcome');
    try {
      const profiles = require('./src/services/memberProfileService');
      const nicknames = require('./src/services/nicknamePolicyService');
      profiles.upsertProfile(member.id, { lastSeenDisplayName: nicknames.stripTimezoneSuffix(member.displayName) });
    } catch {}

    // Step 1: DM with a direct jump link to #rules (template-aware, not league-assumed)
    if (rulesCh) {
      const rulesLink = `https://discord.com/channels/${guild.id}/${rulesCh.id}`;
      const templateLogic = require('./src/services/serverTemplateLogicService');
      const tmplProfile = templateLogic.getTemplateProfile(settings);
      const joinHelp = tmplProfile?.joinHelp || 'Check the server channels to get started.';
      await member.send({
        embeds: [new EmbedBuilder()
          .setColor(0x00b4d8)
          .setTitle(`📖 Welcome to ${guild.name}`)
          .setDescription(
            `**[👉 Jump to #rules](${rulesLink})**\n\n` +
            `${audienceWarning ? `⚠️ **Audience note:** ${audienceWarning}\n\n` : ''}` +
            `${joinHelp}\n\n` +
            `Use \`/set-timezone\` or tell the bot \`my timezone is PST\` to save your timezone.`
          )
          .setFooter({ text: 'Rules first. Everything else second.' })
          .setTimestamp()],
      }).catch(() => null); // DMs may be disabled — fail silently
    }

    // Step 2: Welcome card in #welcome
    if (!welcomeCh) return;
    try {
      const recent = await welcomeCh.messages.fetch({ limit: 10 }).catch(() => null);
      const alreadyWelcomed = recent && [...recent.values()].some(m =>
        m.author?.id === client.user.id &&
        m.mentions?.users?.has?.(member.id) &&
        (Date.now() - (m.createdTimestamp || 0)) < 5 * 60 * 1000
      );
      if (alreadyWelcomed) return;
    } catch {}
    await welcomeCh.send({
      content: `${member}`,
      embeds: [new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('👋 Welcome to the League')
        .setDescription(
          `Welcome ${member}!\n\n` +
          `> 📖 ${rulesCh ? `<#${rulesCh.id}>` : '\`#rules\`'} — **read this first** ← check your DMs for a direct link\n` +
          `> 🏟 ${openTeamsCh ? `<#${openTeamsCh.id}>` : '\`#open-teams\`'} — see available teams\n\n` +
          `Use \`/set-timezone timezone:<your-zone>\` or tell the bot \`my timezone is PST\` to save your timezone first. Everyone needs a timezone while the timezone gate is on. ` +
          `${audienceWarning ? `\n\n⚠️ **Audience warning:** ${audienceWarning}` : ''}`
        )
        .setTimestamp()],
      allowedMentions: { users: [member.id], parse: [] },
    }).catch(() => null);
    if (settings.requireTimezone && settings.serverInitialized) {
      await _postTimezoneOnboardingPrompt(member).catch(() => null);
      await timezoneGateService.lockMemberToTimezoneGate(member).catch(() => null);
    }
    // Plug-and-play onboarding automation — sends template-aware DM if autoWelcomeDm is on
    // (runs after the standard welcome card so the two don't race)
    try {
      const onboardingAuto = require('./src/services/onboardingAutomationService');
      if (onboardingAuto.getSettings().autoWelcomeDm && settings.serverInitialized) {
        await onboardingAuto.handleMemberJoin(member, guild).catch(() => null);
      }
    } catch (_e) {}
  });

  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    // One policy owns the guild-wide nickname. The old hierarchy handler
    // enforced the account name while message sync enforced a channel team.
    await _syncMemberDisplay(newMember).catch(() => null);
  });

  // ── channelUpdate ─────────────────────────────────────────
  client.on('channelUpdate', (oldCh, newCh) => {
    if (oldCh.name !== newCh.name && newCh.guild) invalidateChannel(newCh.guild, newCh.id);
  });
}

// ── clientReady ───────────────────────────────────────────────
client.once('clientReady', async () => {
  const { makeLogger } = require('./src/utils/logger');
  const log = makeLogger('startup');
  const _bootStart = Date.now();

  log.info(`✅ NOFUNLEAGUE Bot online as: ${client.user.tag}`);
  log.info(`   Guild: ${GUILD_ID}`);

  // ── Health check — fire and forget (non-blocking, logs its own results) ──
  const { runStartupHealthCheck } = require('./src/services/startupHealthCheckService');
  runStartupHealthCheck().catch(e => log.warn('Health check failed (non-fatal):', e.message));

  try {
    const guild = await client.guilds.fetch(GUILD_ID);

    // V188 PERF: Parallelize Discord API fetches — saves 2-5s vs serial
    await Promise.all([
      guild.channels.fetch(),
      guild.members.fetch(),
      guild.emojis.fetch(),
    ]);
    log.info(`Discord cache populated in ${Date.now() - _bootStart}ms`);

    // Public release feed is production-only, version-deduped, and reads only PUBLIC_PATCH_NOTES.md.
    await require('./src/services/patchNotesService').publishPatchNotes(guild).catch(err => {
      runtimeIncidents.capture(err, {
        source: 'public-patch-notes',
        eventType: 'public-patch-publication-failed',
        guildId: guild.id,
        severity: 'warn',
      }).catch(() => null);
    });

    // Permission check — sync, instant from cache
    const botMember = guild.members.cache.get(client.user.id);
    if (botMember) {
      if (botMember.permissions.has(PermissionFlagsBits.Administrator)) {
        log.info('Bot has Administrator permission ✅');
      } else {
        log.warn('Bot does NOT have Administrator permission. Checking granular perms...');
        const REQUIRED_PERMS = [
          ['ManageChannels',  PermissionFlagsBits.ManageChannels],
          ['ManageRoles',     PermissionFlagsBits.ManageRoles],
          ['ManageMessages',  PermissionFlagsBits.ManageMessages],
          ['SendMessages',    PermissionFlagsBits.SendMessages],
          ['EmbedLinks',      PermissionFlagsBits.EmbedLinks],
          ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
          ['ViewChannel',     PermissionFlagsBits.ViewChannel],
          ['KickMembers',     PermissionFlagsBits.KickMembers],
          ['BanMembers',      PermissionFlagsBits.BanMembers],
          ['ModerateMembers', PermissionFlagsBits.ModerateMembers],
        ];
        for (const [name, bit] of REQUIRED_PERMS) {
          const has = botMember.permissions.has(bit);
          log.info(`  ${has ? '✅' : '❌'} ${name}`);
        }
      }
    }

    // ── Phase 1: Stability Core (must be serial — wires events, loads state) ──
    const startupBuildOrder = require('./src/services/startupBuildOrderService');
    const phase1 = await startupBuildOrder.runStabilityCore({ guild, client, wireEvents, logger: log });
    log.info(`Loaded ${phase1.persisted.savedPlayersCount} players from disk.`);
    log.info('All services initialized ✅');

    // ── Phase 2: Server Operating System (must follow Phase 1 — needs settings) ──
    try {
      const phase2 = await startupBuildOrder.runServerOperatingSystem({ guild, logger: log });
      if (phase2.wizardChannel) {
        log.info(`Setup wizard auto-posted in ${phase2.wizardChannel?.name || (getConfiguredChannelName('setupWizard') || 'setup-wizard')} ✅`);
      }
    } catch (err) {
      log.warn(`Setup wizard auto-post skipped: ${err.message}`);
    }

    // V188 PERF: Phase 3 + Phase 4 in parallel — they don't depend on each other
    await Promise.all([
      startupBuildOrder.runValueUnlockSystems({ guild, client, logger: log }).catch(e => log.warn('Phase 3 error:', e.message)),
      startupBuildOrder.runAutomationAndAccess({ guild, processDueActiveChecks, logger: log }).catch(e => log.warn('Phase 4 error:', e.message)),
    ]);

    log.info('📡 Listening. @mention the bot or commissioner to activate AI.');
    log.info('💡 /audit-wiring to verify all channels and services are healthy.');
    log.info(`⚡ Boot completed in ${Date.now() - _bootStart}ms\n`);

    // ── V188 PERF: Defer non-critical post-boot work — don't block "ready" ──
    // Self-heal, state audit, guide scans, and periodic timer setup all run
    // after a short delay so the bot is responsive immediately.
    setTimeout(async () => {
      try {
        // State ownership audit
        try {
          const stateOwnership = require('./src/services/stateOwnershipMapService');
          const deprecated = stateOwnership.auditDeprecatedAccess();
          if (deprecated.length) log.warn(`State ownership: ${deprecated.length} deprecated field(s) still registered`);
        } catch {}

        // Workflow registry audit
        try {
          const workflowRegistry = require('./src/services/workflowRegistryService');
          const workflows = workflowRegistry.listWorkflows();
          log.info(`Workflow registry: ${workflows.length} flows registered`);
        } catch {}

        // Redis warning
        if (!process.env.REDIS_URL?.trim()) {
          log.warn('⚠️  REDIS_URL not set — event claims use local-only fallback.');
        }

        // Startup self-heal
        try {
          const selfHeal = require('./src/services/recoverySelfHealService');
          const settings = require('./src/services/serverSettingsService').getSettings();
          if (settings.serverInitialized) {
            const healResult = await selfHeal.runFullRecovery({
              guild,
              settings,
              wizardChannel: getCh(guild, 'setupWizard'),
              patchNotesService: require('./src/services/patchNotesService'),
              singleMessageWizardService: require('./src/services/singleMessageWizardService'),
            });
            if (healResult.healedCount > 0 || healResult.failedCount > 0) {
              log.info(`[STARTUP SELF-HEAL] ${healResult.healedCount} healed, ${healResult.failedCount} failed`);
            }
          }
        } catch {}

        // Periodic self-heal sweep
        try {
          const selfHealPeriodic = require('./src/services/recoverySelfHealService');
          const _healSettings = require('./src/services/serverSettingsService').getSettings();
          if (_healSettings.serverInitialized) {
            setInterval(async () => {
              try {
                const _s = require('./src/services/serverSettingsService').getSettings();
                if (!_s.serverInitialized) return;
                const _g = await client.guilds.fetch(GUILD_ID).catch(() => null);
                if (!_g) return;
                await selfHealPeriodic.runFullRecovery({
                  guild: _g, settings: _s,
                  wizardChannel: getCh(_g, 'setupWizard'),
                  patchNotesService: require('./src/services/patchNotesService'),
                  singleMessageWizardService: require('./src/services/singleMessageWizardService'),
                });
              } catch {}
            }, 30 * 60 * 1000).unref?.();
          }
        } catch {}

        // Guide lifecycle startup scan
        try {
          const settings = require('./src/services/serverSettingsService').getSettings();
          const staleChannels = guideLifecycle.startupScan(guild, state, settings);
          if (staleChannels.length) log.info(`Guide lifecycle: ${staleChannels.length} channel(s) queued for refresh.`);
        } catch {}

        // Idle guide sweep
        try {
          const _idleSettings = require('./src/services/serverSettingsService').getSettings();
          if (_idleSettings.serverInitialized) {
            setTimeout(async () => {
              try {
                const _g = await client.guilds.fetch(GUILD_ID).catch(() => null);
                if (_g) await guideLifecycle.sweepIdleGuides(_g);
              } catch {}
            }, 30_000); // 30s after deferred block starts
            setInterval(async () => {
              try {
                const _g = await client.guilds.fetch(GUILD_ID).catch(() => null);
                if (!_g) return;
                const _s = require('./src/services/serverSettingsService').getSettings();
                if (!_s.serverInitialized) return;
                await guideLifecycle.sweepIdleGuides(_g);
              } catch {}
            }, 5 * 60 * 1000).unref?.();
          }
        } catch {}

        // V202 (BUG-008): the hourly active-check scheduler has exactly ONE owner —
        // src/microservices/automationAccessMicroservice.js (Phase 4). The second hourly interval that lived here
        // (V195) duplicated it (hourly processing ran twice) and was removed.

        log.info(`[DEFERRED] Post-boot tasks completed in ${Date.now() - _bootStart}ms total`);
      } catch (deferErr) {
        log.warn('Deferred post-boot tasks error:', deferErr.message);
      }
    }, 3000); // 3 seconds after boot — bot is already responding by then

    await require('./src/services/readinessService').start(client);
  } catch (err) {
    const { makeLogger } = require('./src/utils/logger');
    require('./src/services/readinessService').write(false);
    makeLogger('startup').error('Startup error:', err.message);
    process.exit(1); // Supervised restart; never leave an incompletely initialized bot accepting work.
  }
});

// Bounded shutdown closes intake, flushes pending compatibility writes and releases connections.
let shuttingDown=false;
async function shutdownBot(signal){
  if(shuttingDown)return;shuttingDown=true;
  console.log(`[shutdown] ${signal}`);
  const deadline=setTimeout(()=>process.exit(1),15000);deadline.unref();
  let failed=false;
  try{
    await require('./src/services/readinessService').stop();
    client.destroy();
    await require('./src/storage/jsonStore').flushPendingWrites();
  }catch(error){failed=true;console.error(`[shutdown] ${error.message}`);}
  const closed=await Promise.allSettled([
    require('./src/queue/queues').closeQueues(),
    require('./src/storage/prisma').disconnectPrisma(),
    require('./src/storage/criticalStore').close(),
    require('./src/storage/jsonStore').closeStore(),
  ]);
  if(closed.some(x=>x.status==='rejected'))failed=true;
  clearTimeout(deadline);process.exit(failed?1:0);
}
process.once('SIGTERM',()=>void shutdownBot('SIGTERM'));
process.once('SIGINT',()=>void shutdownBot('SIGINT'));

client.on('shardDisconnect',()=>require('./src/services/readinessService').write(false));
client.on('shardResume',()=>void require('./src/services/readinessService').check());

// ── 5. Railway keepalive ─────────────────────────────────────
// Health server runs as a SEPARATE process (health-server.js) started by railway-start.sh
// BEFORE this file loads — so it's already answering /health when Railway checks.
// This block sets up the self-ping to keep the container warm.
// FIX: Use localhost instead of external domain — saves egress, faster, and avoids proxy round-trip.
{
  const _keepalivePort = process.env.PORT || 3000;
  const _keepaliveUrl = `http://localhost:${_keepalivePort}/health`;
  const _keepaliveHttp = require('http');
  const _doPing = () => {
    try {
      const req = _keepaliveHttp.get(_keepaliveUrl, () => null);
      req.on('error', () => null);
      req.end();
    } catch (_e) {}
  };
  setTimeout(() => {
    _doPing();
    setInterval(_doPing, 10 * 60 * 1000).unref?.();
  }, 20000); // 20s after bot starts
  console.log(`[keepalive] Self-ping armed → ${_keepaliveUrl} every 10 min`);
}

// ── 6. Boot ───────────────────────────────────────────────────
(async () => {
  console.log('[boot] Step 1/3: initStore...');
  await initStore();
  console.log('[boot] Step 2/3: deployCommands...');
  await deployCommands();
  console.log('[boot] Step 3/3: client.login...');
  await client.login(TOKEN);
  console.log('[boot] ✅ client.login() complete — waiting for clientReady event...');
})().catch(err => {
  console.error('[FATAL] Bot failed to start:', err.message);
  process.exit(1);
});
// Global error handlers are registered once at the top of this file (lines 48-53).
// Do NOT add duplicates here — Node fires all listeners, causing double-logged errors.
