/*
 * NAVIGATION HEADER
 * FILE: src/routing/interactionRouter.js
 * LAYER: Routing and dispatch layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually decides which handler/service path should consume an event or interaction.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const processBuilderService = require('../services/processBuilderService');
const processManagementService = require('../services/processManagementService');
// src/routing/interactionRouter.js

// Build mutex — prevents double-fire on Railway slow connections
let _buildInProgress = false;
// Central interaction handler. Routes all slash commands, buttons, autocomplete.
// No business logic lives here — every case delegates to a service or handler.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { makeLogger, setInteractionContext, clearContext } = require('../utils/logger');
const { isAdminMember, sanitize, norm, canBotModerate, safeFetchMember, buildDisplayTeam } = require('../utils/helpers');
const { COMM_ROLE, COMMISSIONER_IDS } = require('../config/env');
const { getTeamEmoji, getDevEmoji, getTeamDataByAnyName, findPlayerByUserId,
        isSingleAttrCategory, resolveAttrInput, getAttrSuggestions, isPhysicalAttr,
        resolveTeamSlang, ATTRS_BY_CATEGORY } = require('../utils/teamUtils');
const { saveJsonDebounced, loadJson } = require('../storage/jsonStore');
const { prismaSafe } = require('../storage/prisma');
const log = makeLogger('interaction');
const { protectInteraction, safeInitialReply, safeEdit, safeDeferred, safeAutocompleteRespond } = require('../services/interactionRouterService');
const autocompleteService = require('../services/autocompleteService');
const componentSessions = require('../services/componentSessionService');
const buttonChoiceService = require('../services/buttonChoiceService');
const statusCardService = require('../services/statusCardService');
const sendMessageService = require('../services/sendMessageService');
const backgroundJobService = require('../services/backgroundJobService');
const fs = require('fs');
const activeLeagueService = require('../services/activeLeagueService');
const leagueResolver = require('../services/leagueResolverService');
const teamAssignmentUseCase = require('../application/teamAssignmentUseCase');
const teamRegistry = require('../services/teamRegistryService');
const leagueVisibility = require('../services/leagueVisibilityService');
const { normalizeTimezone } = require('../services/timezoneService');
const serverSettings = require('../services/serverSettingsService');
const templateLogic = require('../services/serverTemplateLogicService');
const { resolveServerName } = require('../services/serverBrandService');
const memberProfiles = require('../services/memberProfileService');
const nicknamePolicy = require('../services/nicknamePolicyService');
const timezoneGateService = require('../services/timezoneGateService');
const { getTemplateOptions, TEMPLATE_REGISTRY, getTemplateSubtemplateOptions, resolveTemplateProfile } = require('../services/templateRegistryService');
const serverRulesService = require('../services/serverRulesService');
const pollService = require('../services/pollService');
const botIdentityService = require('../services/botIdentityService');
const wizardPrefs = require('../services/wizardPreferencesService');
const { deployCommandsForCurrentState } = require('../services/commandRegistryService');
const patchNotesService = require('../services/patchNotesService');
const templateThemeService = require('../services/templateThemeService');
// architectureSemanticsService used directly in hierarchyEnforcementService and communityAccessService
const wizardStateService = require('../services/wizardStateService');
const wizardRendererService = require('../services/wizardRendererService');
const singleMessageWizardService = require('../services/singleMessageWizardService');
const postRebootFinalizationService = require('../services/postRebootFinalizationService');
const releaseOrchestrationService = require('../services/releaseOrchestrationService');
const recoverySelfHealService = require('../services/recoverySelfHealService');
const validationGateService = require('../services/validationGateService');
const { getStaffRoles: getConfiguredStaffRoles } = require('../services/accessPolicyService');
const { findConfiguredChannel, getConfiguredChannelName, matchesConfiguredChannel } = require('../services/channelTopologyService');

let _getCh, _state, _aiCall, _MODELS, _client, _services;

function init({ getCh, state, aiCall, MODELS, client, services }) {
  _getCh = getCh; _state = state; _aiCall = aiCall;
  _MODELS = MODELS; _client = client; _services = services;
}

function safeUserError(message, fallback = '❌ Something went wrong. Check the server logs for details.') {
  return fallback;
}

async function loadPendingOffenseFromDb(guildId, offenseId) {
  return prismaSafe(prisma => prisma.pendingOffense.findFirst({
    where: { guildId: String(guildId), id: String(offenseId) },
  }), null);
}

async function updatePendingOffenseStatus(guildId, offenseId, status, resolvedBy) {
  return prismaSafe(prisma => prisma.pendingOffense.updateMany({
    where: { guildId: String(guildId), id: String(offenseId) },
    data: { status: String(status), resolvedBy: resolvedBy ? String(resolvedBy) : null, resolvedAt: new Date() },
  }), null);
}

const INSTALLATION_MODE_ALLOWLIST = new Set([
  'list-admins',  // add-admin/remove-admin removed from allowlist — require #admin-hq which only exists post-build
  'setup-bot',
  'setup-wizard-start',
  'initialize-server',
  'customize-server-rules',
  'set-bot-identity',
  'trash-the-bot',
  'fix-duplicates',
  'kill-bot',
  'ignite-bot',
  'bot-status',
  'set-bot-tone',
  'manual',
  'manual-server',
  'manual-league',
  'manual-setup',
  'manual-commands',
  'manual-actions',
  'suggestions',
  'audit-wiring',
  'lock-bot-access',
  'setup-server',
  'hierarchy-status',
  'set-timezone',  // members must be able to set timezone even during install (timezone gate may be on)
]);

function _isInstallationMode() {
  // wizardStateService is the single source of truth for wizard/install state
  return wizardStateService.isInstallationMode();
}

// Canonical commissioner IDs — uses single source from helpers (MED-02 fix)
function _dynamicCommissioners() {
  const { getActiveCommissionerIds } = require('../utils/helpers');
  return getActiveCommissionerIds(_state, COMMISSIONER_IDS);
}

function _guardBotKilledCommand(interaction) {
  const cmd = interaction.commandName;
  const status = String(serverSettings.getSettings().botStatus || 'active').toLowerCase();
  if (status !== 'killed') return false;
  if (new Set(['ignite-bot','bot-status','kill-bot','trash-the-bot']).has(cmd)) return false;
  interaction.reply({
    content: '🛑 Bot is currently killed. Only `/workflow bot ignite`, `/workflow bot status`, `/workflow bot kill`, and `/trash-the-bot` are available right now.',
    flags:64,
  }).catch(() => null);
  return true;
}

function _guardInstallationModeCommand(interaction) {
  const cmd = interaction.commandName;
  if (!_isInstallationMode()) return false;
  if (INSTALLATION_MODE_ALLOWLIST.has(cmd)) return false;
  interaction.reply({
    content: `⚠️ **${interaction.guild?.name || 'This server'}** is still in installation mode. Finish the base setup in \`/setup-wizard-start\` and press **Initialize / Build Server Now** before using \`/${cmd}\`.`,
    flags:64,
  }).catch(() => null);
  return true;
}


function _isTimezoneExempt(_member) {
  return !serverSettings.getSettings().requireTimezone;
}

function _memberTimezoneMissing(member) {
  if (!member || _isTimezoneExempt(member)) return false;
  const profile = memberProfiles.getProfile(member.id);
  return !profile?.timezone;
}

function _timezoneRequiredCommandAllowed(cmd) {
  return new Set([
    'set-timezone','manual','manual-server','manual-league','manual-setup','manual-commands','manual-actions','suggestions',
    'setup-bot','setup-wizard-start','initialize-server','customize-server-rules','set-bot-identity','trash-the-bot','fix-duplicates','kill-bot','ignite-bot','bot-status','set-bot-tone'
  ]).has(cmd);
}

function _guardMemberTimezoneCommand(interaction) {
  const cmd = interaction.commandName;
  if (isAdminMember(interaction.member, COMM_ROLE, _dynamicCommissioners())) return false;
  if (_timezoneRequiredCommandAllowed(cmd)) return false;
  if (!_memberTimezoneMissing(interaction.member)) return false;
  interaction.reply({
    content: '🕒 Save your timezone first with `/set-timezone timezone:<your-zone>` or tell me `my timezone is PST` before using member tools here.',
    flags:64,
  }).catch(() => null);
  return true;
}

async function _promptTimezoneForGuildMembers(guild, opts = {}) {
  if (!guild) return;
  const settings = serverSettings.getSettings();
  const members = guild.members?.cache?.size ? [...guild.members.cache.values()] : [];
  for (const member of members) {
    if (!member || member.user?.bot) continue;
    if (memberProfiles.getProfile(member.id)?.timezone) continue;
    if (settings.requireTimezone) {
      await timezoneGateService.postGatePrompt(member).catch(() => null);
      await timezoneGateService.lockMemberToTimezoneGate(member).catch(() => null);
      continue;
    }
    const welcomeCh = guild.channels.cache.find(c => c.isTextBased?.() && c.name === 'welcome');
    if (!welcomeCh) continue;
    await welcomeCh.send({
      content: `${member}`,
      embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🕒 Timezone Prompt')
        .setDescription('Set your timezone with the button below or tell the bot `my timezone is PST`. This keeps schedules, reminders, and nickname sync clean.')
        .setTimestamp()],
      components: [timezoneGateService.buildTimezoneSelectRow()],
      allowedMentions: { users: [member.id], parse: [] },
    }).catch(() => null);
  }
}

function _guardInstallationModeComponent(interaction) {
  const cid = String(interaction.customId || '');
  if (!_isInstallationMode()) return false;
  // V200.2: Exempt wizard AND league setup interactions — these are started by slash commands
  // that already passed _guardInstallationModeCommand. Blocking their dropdowns kills the flow.
  if (cid.startsWith('setup_wizard_')) return false;
  if (cid.startsWith('setup_game_')) return false;
  if (cid.startsWith('setup_type_')) return false;
  if (cid.startsWith('setup_season_')) return false;
  if (cid.startsWith('setup_proam_')) return false;
  if (cid.startsWith('setup_ruleset_')) return false;
  if (cid === 'setup_game_select') return false;
  if (cid === 'setup_type_select') return false;
  if (cid === 'setup_season_select') return false;
  if (cid.startsWith('setup_')) {
    interaction.reply({
      content: '⚠️ Server setup is not finished yet. Build the base server from **#setup-wizard** before opening league setup.',
      flags:64,
    }).catch(() => null);
    return true;
  }
  return false;
}

async function handleInteraction(interaction) {
  require('../services/commandAliasService').resolveInteractionAlias(interaction);
  const structural=guildLock.isDestructiveCommand(interaction.commandName)||/^(bot_setup_initialize|setup_)/.test(interaction.customId||'');
  if(!structural||!interaction.guild)return _handleInteractionWithContext(interaction);
  const result=await require('../storage/criticalStore').withExclusive(`v204:structure:${interaction.guild.id}`,()=>_handleInteractionWithContext(interaction));
  if(result.acquired)return result.value;
  const payload={content:'A server structure update is already running. Wait for it to finish before trying again.',flags:64};
  return interaction.deferred||interaction.replied?interaction.editReply(payload):interaction.reply(payload);
}
async function _handleInteractionWithContext(interaction) {
  const context=require('../league/spaceContext');
  const registry=require('../services/activeLeagueService');
  const league=registry.findLeagueForChannel(interaction.channel);
  const all=registry.listOperationalLeagues().filter(x=>x.kind!=='event');
  const globalCommand=/^(setup-|delete-league|reset-league|initialize-server|trash-the-bot|member-record|join-league|select-team)/.test(interaction.commandName||'') || /^(setup_|join_)/.test(interaction.customId||'');
  const id=globalCommand?null:(league?.id || (all.length===1?all[0].id:null));
  return context.run(id,async()=>{
    if(league && !isAdminMember(interaction.member,COMM_ROLE,_dynamicCommissioners())) {
      const allowed=await require('../services/leagueVisibilityService').hasMembership(interaction.guild.id,interaction.user.id,league.id);
      const legacyMember=_state.openTeamRegistry.some(t=>t.leagueId===league.id&&t.ownerId===interaction.user.id);
      if(!allowed&&!legacyMember)return interaction.reply({content:'Join this league or event before using its controls.',flags:64});
    }
    try{return await _handleInteractionScoped(interaction);}
    finally{_state.flushSpace?.();await require('../storage/jsonStore').flushSpaceWrites();}
  });
}

async function _handleInteractionScoped(interaction) {
  try { require('../services/commandAliasService').resolveInteractionAlias(interaction); } catch {} // V203: idempotent
  // Autocomplete is a distinct Discord interaction lifecycle. It only supports respond().
  // Handle it before chat-input safety wrapping so a missing reply/followUp method can never break option loading.
  if (interaction.isAutocomplete?.()) {
    try { return await _handleAutocomplete(interaction); }
    catch (err) {
      log.warn(`autocomplete failed for ${interaction.commandName || '?'}: ${err.message}`);
      return safeAutocompleteRespond(interaction, []);
    }
  }
  protectInteraction(interaction);
  const _startMs = Date.now();
  // Generate a short correlation ID for this interaction — ties all logs together
  const _ixId = `ix-${Date.now().toString(36).slice(-5)}-${Math.random().toString(36).slice(2,6)}`;
  setInteractionContext(_ixId);
  const _interactionType = interaction.isButton?.() ? 'button'
    : interaction.isStringSelectMenu?.() ? 'select'
    : interaction.isChatInputCommand?.() ? 'slash'
    : interaction.isModalSubmit?.() ? 'modal'
    : interaction.isAutocomplete?.() ? 'autocomplete'
    : 'other';
  log.info(`[router] ${_interactionType} — ${interaction.customId || interaction.commandName || '?'} id=${_ixId}`);
  try {

if (interaction.isModalSubmit?.()) return _handleModal(interaction);
if (interaction.isButton() || interaction.isStringSelectMenu?.()) return _handleButton(interaction);
if (interaction.isMessageContextMenuCommand?.()) return _handleMessageContextMenu(interaction);
if (!interaction.isChatInputCommand()) return;
if (_guardMemberTimezoneCommand(interaction)) return;
const _validation = await validationPipeline.validate(interaction, { state: _state, guild: interaction.guild, isComm: isAdminMember(interaction.member, COMM_ROLE, _dynamicCommissioners()) });
if (!_validation?.ok) {
  return safeInitialReply(interaction, { content: _validation.reason || '❌ Validation failed.', flags:64 });
}
if (_validation?.commandClass === 'orchestrated' && !interaction.deferred && !interaction.replied) {
  await safeDeferred(interaction, { flags:64 }).catch(() => null);
}
await _handleCommand(interaction, _validation);

  } catch (err) {
    log.error('Interaction error:', err.message, err.stack);
    require('../services/runtimeIncidentService').capture(err, {
      source: 'interaction-router',
      eventType: 'interaction-failure',
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user?.id,
      commandName: interaction.commandName,
      customId: interaction.customId,
      severity: 'error',
    }).catch(() => null);
    const msg = '❌ Something went wrong. The incident was logged for review.';
    if (interaction.replied || interaction.deferred) await safeEdit(interaction, msg).catch(() => null);
    else await safeInitialReply(interaction, { content: msg, flags:64 }).catch(() => null);
  } finally {
    log.info(`[router] completed in ${Date.now() - _startMs}ms`);
    clearContext();
  }
}

// ── Services (hoisted from inline requires for performance + clarity) ──
const openTeamsService        = require('../services/openTeamsService');
const workflowEngine          = require('../services/workflowEngineService');
const securityMiddleware      = require('../services/securityMiddlewareService');
const memberLedgerService     = require('../services/memberLedgerService');
const leagueSetupService      = require('../services/leagueSetupService');
const hubReleaseService       = require('../services/hubReleaseService');
const rewardBoardService      = require('../services/rewardBoardService');
const weeklyAutomationService = require('../services/weeklyAutomationService');
const manualService           = require('../services/manualService');
const scheduleRegistryService = require('../services/scheduleRegistryService');
const communityAccessService  = require('../services/communityAccessService');
const joinLeagueService       = require('../services/joinLeagueService');
const leagueMemberOnboarding  = require('../services/leagueMemberOnboardingService');
const baseInitService         = require('../services/baseInitService');
const hierarchyService        = require('../services/hierarchyEnforcementService');
const gameChannelService      = require('../services/gameChannelService');
const onboardingAutoService   = require('../services/onboardingAutomationService');
const botAccessService        = require('../services/botAccessService');
const spaceAutoGenService     = require('../services/spaceAutoGenService');
const conversationCtxService  = require('../services/conversationContextService');
const dataCleanupService      = require('../services/dataCleanupService');
const streamOpsService        = require('../services/streamOpsService');
const liveSync                = require('../services/liveSyncService');
const broadcastsService       = require('../services/broadcastsService');
const waitlistService         = require('../services/waitlistService');
const gameChannelCompatService = require('../services/gameChannelCompatService');
const validationPipeline      = require('../services/validationPipelineService');
const guildLock               = require('../services/guildLockService');

// ── Hoisted inline requires (moved from case blocks for clarity) ──
// loadJson and saveJsonDebounced declared at top of file with jsonStore import


// ── Autocomplete ──────────────────────────────────────────────
async function _handleAutocomplete(interaction) {
  const _acStartedAt = Date.now();
  const _acFocus = autocompleteService.focused(interaction);
  const focused = _acFocus.value.toLowerCase().trim();
  const optionName = _acFocus.name;
  const cmd = interaction.commandName;
  const respond = (choices, resolverStage = 'router') => autocompleteService.respond(interaction, choices, {
    startedAt:_acStartedAt, optionName, focusedLength:_acFocus.value.length, resolverStage,
  });

if (cmd === 'join-league' && optionName === 'league') {
  try {
    const opts = activeLeagueService.listJoinableLeagues({ guildId:interaction.guildId }).map(activeLeagueService.formatResetChoice);
    const filtered = opts.filter(o => !focused || o.name.toLowerCase().includes(focused) || o.value.toLowerCase().includes(focused)).slice(0,25);
    return respond(filtered.length ? filtered : [{ name: '⚠️ No active leagues to join', value: '_none_' }]);
  } catch (err) {
    log.warn('join-league autocomplete failed:', err.message);
    return respond([{ name:'Use /join-league to open the league picker', value:'_none_' }]).catch(() => null);
  }
}

if (cmd === 'add-member-to-league' && optionName === 'league') {
  const opts = activeLeagueService.listJoinableLeagues({ guildId:interaction.guildId }).map(activeLeagueService.formatResetChoice);
  const filtered = opts.filter(o => !focused || o.name.toLowerCase().includes(focused) || o.value.toLowerCase().includes(focused)).slice(0,25);
  return respond(filtered.length ? filtered : [{ name:'⚠️ No active leagues', value:'_none_' }]);
}

if (cmd === 'league-export' && optionName === 'league') {
  const opts = activeLeagueService.listJoinableLeagues({ guildId:interaction.guildId }).map(activeLeagueService.formatResetChoice);
  const filtered = opts.filter(o => !focused || o.name.toLowerCase().includes(focused) || o.value.toLowerCase().includes(focused)).slice(0,25);
  return respond(filtered.length ? filtered : [{ name:'⚠️ No active leagues', value:'_none_' }]);
}

if (['add-member-to-league','select-team'].includes(cmd) && optionName === 'team') {
  const leagueInput = interaction.options.getString('league');
  const resolved = leagueResolver.resolveLeague(leagueInput, { guildId:interaction.guildId, mode:'joinable' });
  if (!resolved.ok) return respond([{ name:'Choose an active league first', value:'_none_' }]);
  const teams = openTeamsService.getOpenTeamsForLeague(resolved.league.id) || [];
  const opts = teams.map(t => ({ name:`${t.displayTeam} — ${t.baseTeam}`.slice(0,100), value:String(t.baseTeam).slice(0,100) }))
    .filter(o => !focused || o.name.toLowerCase().includes(focused) || o.value.toLowerCase().includes(focused)).slice(0,25);
  return respond(opts.length ? opts : [{ name:'⚠️ No open teams in this league', value:'_none_' }]);
}

if (cmd === 'select-team' && optionName === 'league') {
  const opts = activeLeagueService.listJoinableLeagues({ guildId:interaction.guildId }).map(activeLeagueService.formatResetChoice);
  const filtered = opts.filter(o => !focused || o.name.toLowerCase().includes(focused) || o.value.toLowerCase().includes(focused)).slice(0,25);
  return respond(filtered.length ? filtered : [{ name:'⚠️ No joinable leagues', value:'_none_' }]);
}

// Contract v8: all high-integrity team management carries canonical league scope as a first-class option.
// Autocomplete is convenience only; command execution re-resolves the league and team before mutation.
const LEAGUE_SCOPED_TEAM_COMMANDS = new Set(['register-team','set-team-identity','add-open-team','remove-open-team','set-team-logo','release-team','create-game','report-result','teams']);
if (optionName === 'league' && LEAGUE_SCOPED_TEAM_COMMANDS.has(cmd)) {
  const rows = cmd === 'register-team'
    ? activeLeagueService.listJoinableLeagues({ guildId:interaction.guildId })
    : activeLeagueService.listOperationalLeagues({ guildId:interaction.guildId });
  const opts = rows.map(activeLeagueService.formatResetChoice)
    .filter(o => !focused || o.name.toLowerCase().includes(focused) || o.value.toLowerCase().includes(focused))
    .slice(0,25);
  return respond(opts.length ? opts : [{ name:'⚠️ No eligible leagues', value:'_none_' }], 'league-scope');
}

const SCOPED_TEAM_OPTIONS = new Set(['team','team1','team2','winner','loser','original-team','base-team','replaces-team']);
if (LEAGUE_SCOPED_TEAM_COMMANDS.has(cmd) && SCOPED_TEAM_OPTIONS.has(optionName)) {
  let leagueInput = interaction.options.getString('league');
  if (!leagueInput && cmd === 'report-result') leagueInput = _state.games.get(interaction.channelId)?.leagueId || null;
  const mode = cmd === 'register-team' ? 'joinable' : 'operational';
  const resolved = leagueResolver.resolveLeague(leagueInput, { guildId:interaction.guildId, mode });
  if (!resolved.ok) return respond([{ name:'Choose the league first', value:'_none_' }], 'team-scope');
  const leagueId = resolved.league.id;
  let rows = _state.openTeamRegistry.filter(t => String(t.leagueId || '') === String(leagueId));
  let sub = null;
  if (cmd === 'teams') { try { sub = interaction.options.getSubcommand(false); } catch {} }
  const openOnly = cmd === 'register-team' || (cmd === 'teams' && sub === 'assign');
  const claimedOnly = cmd === 'release-team' || cmd === 'create-game' || cmd === 'report-result' || (cmd === 'teams' && sub === 'free');
  if (openOnly) rows = rows.filter(t => t.isOpen);
  if (claimedOnly) rows = rows.filter(t => !t.isOpen);
  const opts = rows.map(t => ({
    name:`${t.isOpen ? '✅' : '❌'} ${t.displayTeam}${norm(t.displayTeam) !== norm(t.baseTeam) ? ` (${t.baseTeam})` : ''}`.slice(0,100),
    value:String(t.baseTeam).slice(0,100),
  })).filter(o => !focused || o.name.toLowerCase().includes(focused) || o.value.toLowerCase().includes(focused)).slice(0,25);
  return respond(opts.length ? opts : [{ name:'⚠️ No matching teams in this league', value:'_none_' }], 'team-scope');
}


if (cmd === 'set-bot-identity' && optionName === 'imported-emoji') {
  const opts = [...(interaction.guild?.emojis?.cache?.values?.() || [])]
    .filter(e => !e.managed)
    .map(e => ({ name: `${e.name}`.slice(0,100), value: e.name }))
    .filter(o => !focused || o.name.toLowerCase().includes(focused))
    .slice(0,25);
  return respond(opts.length ? opts : [{ name:'⚠️ No imported emojis found', value:'_none_' }]);
}

if (cmd === 'delete-league' && optionName === 'league') {
  const opts = activeLeagueService.listResettableLeagues({ guildId:interaction.guildId }).map(activeLeagueService.formatResetChoice);
  const filtered = opts.filter(o => !focused || o.name.toLowerCase().includes(focused) || o.value.toLowerCase().includes(focused)).slice(0,25);
  return respond(filtered.length ? filtered : [{ name: '⚠️ No active leagues to delete', value: '_none_' }]);
}

  if (cmd === 'reset-league' && optionName === 'league') {
    const opts = activeLeagueService.listResettableLeagues({ guildId:interaction.guildId }).map(activeLeagueService.formatResetChoice);
    const filtered = opts.filter(o => !focused || o.name.toLowerCase().includes(focused) || o.value.toLowerCase().includes(focused)).slice(0,25);
    return respond(filtered.length ? filtered : [{ name: '⚠️ No active leagues to reset', value: '_none_' }]);
  }

  const COMMUNITY_OPTIONS = new Set(['name','community']);
  if (['edit-community','delete-community','toggle-team-mode'].includes(cmd) && COMMUNITY_OPTIONS.has(optionName)) {
    const communities = serverSettings.getSettings().communities || [];
    const options = communities
      .map(c => ({ name: `${c.name} — ${c.type}`.slice(0,100), value: c.name }))
      .filter(o => !focused || o.name.toLowerCase().includes(focused) || o.value.toLowerCase().includes(focused))
      .slice(0,25);
    return respond(options.length ? options : [{ name:'⚠️ No saved communities', value:'_none_' }]);
  }

  const TEAM_OPTIONS = ['team','team1','team2','winner','loser','your-team','target-team','original-team','base-team','display-team'];
  if (TEAM_OPTIONS.includes(optionName)) {
    const allTeams = new Map();
    const activeLeagueId = require('../league/spaceContext').current() || _state.leagueConfig.leagueId || null;

    // For release-team: only show CLAIMED teams in the active league
    if (cmd === 'release-team') {
      for (const t of _state.openTeamRegistry.filter(t => !t.isOpen)) {
        // Filter to active league if one is set
        if (activeLeagueId && t.leagueId && t.leagueId !== activeLeagueId) continue;
        const leagueTag = t.leagueId ? ` [${t.leagueId}]` : '';
        const ownerTag = t.ownerId ? ` — claimed` : '';
        allTeams.set(norm(t.baseTeam), {
          name: `❌ ${t.displayTeam}${t.displayTeam !== t.baseTeam ? ` (${t.baseTeam})` : ''}${ownerTag}${leagueTag}`.slice(0, 100),
          value: `${t.baseTeam}::${t.leagueId || ''}`,
        });
      }
      // If no claimed teams found, show a helpful empty-state
      if (!allTeams.size) {
        return respond([{ name: '⚠️ No claimed teams to release', value: '_none_' }]);
      }
    }
    // For select-team: only show OPEN teams after at least one league has been created
    else if (cmd === 'select-team') {
      const activeLeagues = activeLeagueService.listResetOptions(_state);
      if (!activeLeagues.length) {
        return respond([{ name: '⚠️ No active league yet — commissioner must run /setup-league first', value: '_none_' }]);
      }
      const openTeams = _state.openTeamRegistry.filter(t => t.isOpen);
      if (!openTeams.length) {
        return respond([{ name: '⚠️ No teams configured or all slots are filled', value: '_none_' }]);
      }
      for (const t of openTeams) {
        const leagueTag = t.leagueName ? ` [${t.leagueName}]` : (t.leagueId ? ` [${t.leagueId}]` : '');
        allTeams.set(norm(`${t.baseTeam}:${t.leagueId || ''}`), {
          name: `✅ ${t.displayTeam}${t.displayTeam !== t.baseTeam ? ` (${t.baseTeam})` : ''}${leagueTag}`.slice(0, 100),
          value: `${t.baseTeam}::${t.leagueId || ''}`,
        });
      }
    }
    // For report-result, create-game: show only CLAIMED teams (teams that are in play)
    else if (cmd === 'report-result' || cmd === 'create-game') {
      for (const t of _state.openTeamRegistry.filter(t => !t.isOpen)) {
        allTeams.set(norm(t.baseTeam), {
          name: `${t.displayTeam}${t.displayTeam !== t.baseTeam ? ` (${t.baseTeam})` : ''}`,
          value: `${t.baseTeam}::${t.leagueId || ''}`,
        });
      }
      for (const p of _state.players.values()) {
        if (!allTeams.has(norm(p.baseTeam))) allTeams.set(norm(p.baseTeam), { name: p.displayTeam, value: p.baseTeam });
      }
    }
    // Default: show all teams with status
    else {
      for (const t of _state.openTeamRegistry) {
        const leagueTag = t.leagueId ? ` [${t.leagueId}]` : '';
        allTeams.set(norm(t.baseTeam), {
          name: `${t.displayTeam}${t.displayTeam !== t.baseTeam ? ` (${t.baseTeam})` : ''} — ${t.isOpen ? '✅ Open' : '❌ Claimed'}${leagueTag}`.slice(0, 100),
          value: `${t.baseTeam}::${t.leagueId || ''}`,
        });
      }
      for (const p of _state.players.values()) {
        if (!allTeams.has(norm(p.baseTeam))) allTeams.set(norm(p.baseTeam), { name: p.displayTeam, value: p.baseTeam });
      }
    }

    return respond(
      [...allTeams.values()].filter(t => !focused || t.name.toLowerCase().includes(focused) || t.value.toLowerCase().includes(focused)).slice(0, 25)
    );
  }

  if (optionName==='attribute1'||optionName==='attribute2') {
    const catKey = optionName==='attribute1'
      ? interaction.options.getString('attr1-category')||''
      : interaction.options.getString('attr2-category')||'';
    if (catKey && isSingleAttrCategory(catKey)) {
      const only = ATTRS_BY_CATEGORY[catKey][0];
      return respond([{name:`✅ AUTO — ${only.full}`,value:only.abbr}]);
    }
    return respond(getAttrSuggestions(focused, catKey));
  }
  return respond([]);
}



function _setupWizardFallbackText() {
  return `#${getConfiguredChannelName('setupWizard') || 'setup-wizard'}`;
}

function _getStaffRoles(guild) {
  return getConfiguredStaffRoles(guild, { commRoleId: COMM_ROLE, includeAdministrator: true, includeManageGuild: false, includeRoleNameFallback: false });
}

async function _ensureSetupWizardChannel(guild, { reveal = true } = {}) {
  const patchCat = await patchNotesService.ensurePatchNotesCategory(guild).catch(() => null);
  const patchCatId = patchCat?.id || null;
  const setupWizardName = getConfiguredChannelName('setupWizard') || 'setup-wizard';
  const allSetup = [...guild.channels.cache.values()].filter(c => c.isTextBased?.() && String(c.name || '').toLowerCase() === setupWizardName).sort((a,b)=>a.rawPosition-b.rawPosition);
  let ch = allSetup[0] || null;
  const baseDeny = {
    ViewChannel: false,
    SendMessages: false,
    AddReactions: false,
    UseApplicationCommands: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: false,
  };
  if (!ch) {
    ch = await guild.channels.create({
      name: setupWizardName,
      type: ChannelType.GuildText,
      parent: patchCatId,
      topic: 'Commissioner-only bot setup and installation wizard. This should be the first lane used during installation mode.',
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: Object.keys(baseDeny) }],
    });
  }
  if (patchCatId && ch.parentId !== patchCatId) {
    await ch.setParent(patchCatId).catch(() => null);
  }
  await ch.setPosition(1).catch(() => null);
  await ch.permissionOverwrites.edit(guild.roles.everyone.id, baseDeny).catch(() => null);
  const staffRoles = _getStaffRoles(guild);
  for (const role of staffRoles) {
    await ch.permissionOverwrites.edit(role.id, {
      ViewChannel: !!reveal,
      SendMessages: !!reveal,
      ReadMessageHistory: true,
      UseApplicationCommands: !!reveal,
      ManageMessages: true,
      ManageChannels: true,
    }).catch(() => null);
  }
  if (guild.members?.me?.id) {
    await ch.permissionOverwrites.edit(guild.members.me.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      UseApplicationCommands: true,
      ManageMessages: true,
      ManageChannels: true,
    }).catch(() => null);
  }
  let archiveIndex = 1;
  for (const dup of allSetup.slice(1)) {
    const botOnly = await dup.messages.fetch({ limit: 10 }).then(col => [...col.values()].every(m => m.author?.id === guild.members?.me?.id)).catch(() => true);
    if (botOnly) {
      await dup.delete('Duplicate setup-wizard cleanup').catch(() => null);
      continue;
    }
    await dup.setName(`setup-wizard-archive-${archiveIndex++}`).catch(() => null);
    await dup.permissionOverwrites.edit(guild.roles.everyone.id, baseDeny).catch(() => null);
    for (const role of staffRoles) {
      await dup.permissionOverwrites.edit(role.id, { ViewChannel: false, SendMessages: false, UseApplicationCommands: false }).catch(() => null);
    }
  }
  return ch;
}

async function _archiveSetupWizardChannel(guild) {
  const ch = findConfiguredChannel(guild, 'setupWizard', { textOnly: true });
  if (!ch) return null;
  const staffRoles = _getStaffRoles(guild);
  for (const role of staffRoles) {
    await ch.permissionOverwrites.edit(role.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, UseApplicationCommands: true }).catch(() => null);
  }
  return ch;
}


async function _resolveAdminOpsChannel(guild, currentChannel = null) {
  if (!guild) return currentChannel || null;
  const currentName = String(currentChannel?.name || '').toLowerCase();
  if (currentChannel && currentName && currentName !== 'setup-wizard') return currentChannel;
  try {
    const patchNotesService = require('../services/patchNotesService');
    const ensured = await patchNotesService.ensurePatchNotesChannel(guild).catch(() => null);
    if (ensured?.channel) return ensured.channel;
  } catch {}
  return currentChannel || findConfiguredChannel(guild, 'patchNotes', { textOnly: true }) || null;
}

async function _purgeSetupWizardNoise(ch, keepMessageIds = []) {
  if (!ch) return null;
  const keep = new Set((keepMessageIds || []).filter(Boolean).map(String));
  try {
    const state = wizardStateService.getState();
    if (state.activeMessageId) keep.add(String(state.activeMessageId));
  } catch {}
  const preserveId = [...keep][0] || wizardStateService.getActiveMessageId();
  await singleMessageWizardService.cleanupLane(ch, preserveId, {
    deleteUserMessages: true,
    limit: 100,
  }).catch(() => null);
  return null;
}


function _wizardStatus(settings = serverSettings.getSettings(), prefs = wizardPrefs.getPrefs(), guild = null) {
  const memberTone = serverSettings.getEffectiveToneProfile(settings, 'member');
  const commTone = serverSettings.getEffectiveToneProfile(settings, 'commissioner');
  const missing = [];
  if (!settings.customStructureMode) missing.push('structure mode');
  if (settings.customStructureMode === 'template') {
    if (!settings.serverTemplate) missing.push('server template');
    const subOpts = settings.serverTemplate ? getTemplateSubtemplateOptions(settings.serverTemplate) : [];
    if (subOpts.length && !settings.serverSubtemplate) missing.push('subtemplate');
  }
  if (settings.customStructureMode === 'custom' && (!Array.isArray(settings.customTemplateSelections) || !settings.customTemplateSelections.length)) missing.push('custom templates');
  if (!settings.audienceRating) missing.push('audience level');
  if (!memberTone.length) missing.push('member AI tone');
  if (!settings.useSharedToneProfile && !commTone.length) missing.push('commissioner AI tone');
  return { canInitialize: missing.length === 0, missing };
}

// ── Custom Mix-and-Match Row Builders ─────────────────────────────────────
// Each row represents a themed group. Commissioner picks categories/channels
// from multiple groups to build a completely custom server layout.

function _buildTimezoneModal(profile = {}) {
  const modal = new ModalBuilder().setCustomId('timezone_onboarding_modal').setTitle('Set Your Timezone');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('timezone').setLabel('Timezone').setPlaceholder('America/Los_Angeles or PST').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(profile.timezone || '').slice(0, 80))
    )
  );
  return modal;
}


function _getCommissionerMembers(guild) {
  if (!guild?.members?.cache) return [];
  return [...guild.members.cache.values()].filter(m => !m.user?.bot && isAdminMember(m, COMM_ROLE, _dynamicCommissioners()));
}

function _hasAnyCommissionerTimezone(guild) {
  const commissioners = _getCommissionerMembers(guild);
  if (!commissioners.length) return false;
  return commissioners.some(m => !!memberProfiles.getProfile(m.id)?.timezone);
}

async function _ackLongInteraction(interaction, startingText = '⏳ Working...') {
  // Simplified: always deferUpdate for button interactions, deferReply for slash commands
  // Avoids ghost messages caused by ephemeral reply tokens
  try {
    if (interaction.isChatInputCommand?.()) {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags:64 });
        return 'deferred';
      }
    } else {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
        return 'update';
      }
    }
  } catch (err) {
    log.warn('_ackLongInteraction failed:', err.message);
  }
  return 'none';
}

async function _updateLongInteraction(interaction, ackMode, payload) {
  if (ackMode === 'deferred' || ackMode === 'replied') {
    try { return await interaction.editReply(payload); } catch (_err) {}
    try { return await interaction.followUp(payload); } catch (_err) {}
    return null;
  }
  try { return await interaction.reply(payload); } catch (_err) {}
  try { return await interaction.followUp(payload); } catch (_err) {}
  return null;
}


async function _ensureSetupWizardStarterMessage(ch, note = '') {
  if (!ch) return null;
  const rawPayload = wizardRendererService.buildWizardPayload(ch.guild, note);
  const payload = { ...rawPayload };
  delete payload.files; // single-message wizard: no attachment-based clones
  const starter = await singleMessageWizardService.ensureSingleMessage(ch, payload, {
    action: 'wizard-starter',
    deleteUserMessages: true,
    limit: 100,
  }).catch(() => null);
  if (starter?.id) wizardStateService.setActiveMessageId(starter.id);
  return starter;
}
async function _postSetupWizardMessage(guild, note = '', opts = {}) {
  const settings = serverSettings.getSettings();
  const stage = opts.stage || wizardStateService.getCurrentStep() || 'flow';
  // wizardStateService owns installationMode and currentStep
  wizardStateService.patch({ installationMode: true, currentStep: stage, lastAdvancedAt: Date.now() });
  // wizardPrefs retains only UI fields it still owns
  wizardPrefs.savePrefs({
    currentTemplate: settings.serverTemplate,
    currentStructureMode: settings.customStructureMode,
  });
  const ch = await _ensureSetupWizardChannel(guild, { reveal: true });
  const gate = validationGateService.validateSetupWizardContract(ch);
  if (!gate.ok) log.warn('setup wizard contract validation:', gate.failures.join(','));
  await _ensureSetupWizardStarterMessage(ch, note || 'Installation mode is active.').catch(() => null);
  return ch;
}

async function _sendSetupWizardNudge(_ch, _userId, _reason = 'Setup wizard is ready here.') {
  return null;
}

async function _deferSetupWizardInteraction(interaction) {
  try {
    await interaction.deferReply({ flags:64 });
    return 'reply';
  } catch {}
  try {
    await interaction.deferUpdate();
    return 'update';
  } catch {}
  return 'none';
}

async function _finishSetupWizardInteraction(interaction, ackMode, payload) {
  if (ackMode === 'reply' && (interaction.deferred || interaction.replied)) {
    return interaction.editReply(payload).catch(() => null);
  }
  if (ackMode === 'update') {
    return interaction.followUp(payload).catch(() => null);
  }
  return interaction.reply(payload).catch(() => null);
}

// Apply a wizard payload after deferUpdate has ALREADY been called.
// Always edits in place — no file attachments in wizard (they cause ghost messages).
async function _applyWizardPayload(interaction, payload) {
  const cleanPayload = { ...payload };
  delete cleanPayload.files; // safety: never send files from wizard
  // Prefer update() when the interaction has not yet been acknowledged.
  if (!interaction.deferred && !interaction.replied && (interaction.isButton?.() || interaction.isStringSelectMenu?.())) {
    try { return await interaction.update(cleanPayload); } catch (_e) {}
  }
  if (interaction.deferred || interaction.replied) {
    try { return await interaction.editReply(cleanPayload); } catch (_e) {}
  }
  if (interaction.message?.editable) {
    try { return await interaction.message.edit(cleanPayload); } catch (_e) {}
  }
  const ch = interaction.channel;
  if (ch) {
    const activeId = wizardStateService.getActiveMessageId();
    if (activeId) {
      const activeMsg = await ch.messages.fetch(activeId).catch(() => null);
      if (activeMsg?.editable) {
        try { return await activeMsg.edit(cleanPayload); } catch (_e) {}
      }
    }
    return _ensureSetupWizardStarterMessage(ch, '').catch(() => null);
  }
  return null;
}

async function _safeWizardUpdate(interaction, payload) {
  const hasNewFile = Array.isArray(payload.files) && payload.files.length > 0;
  const ch = interaction.channel;

  if (hasNewFile && ch) {
    try {
      if (!interaction.deferred && !interaction.replied && (interaction.isButton?.() || interaction.isStringSelectMenu?.())) {
        await interaction.deferUpdate();
      }
    } catch (_e) {}
    const oldMsg = interaction.message;
    if (oldMsg?.deletable) await oldMsg.delete().catch(() => null);
    const _sentResult = await sendMessageService.send(ch, payload, { action: 'wizard-starter' });
  const sent = _sentResult.message || null;
    if (sent) {
      wizardStateService.setActiveMessageId(sent.id);
      }
    return sent;
  }

  const cleanPayload = { ...payload };
  delete cleanPayload.files;
  if (!interaction.deferred && !interaction.replied && (interaction.isButton?.() || interaction.isStringSelectMenu?.())) {
    try { return await interaction.update(cleanPayload); } catch (_e) {}
  }
  if (interaction.message?.editable) {
    try { return await interaction.message.edit(cleanPayload); } catch (_e) {}
  }
  try { return await interaction.editReply(cleanPayload); } catch (_e) {}
  if (ch) {
    const activeId = wizardStateService.getActiveMessageId();
    if (activeId) {
      const activeMsg = await ch.messages.fetch(activeId).catch(() => null);
      if (activeMsg?.editable) {
        try { return await activeMsg.edit(cleanPayload); } catch (_e) {}
      }
    }
    return _ensureSetupWizardStarterMessage(ch, '').catch(() => null);
  }
  return null;
}

async function _safeAcknowledgeWizardTap(interaction) {
  // All callers are button/select interactions — always deferUpdate
  // deferReply fallback removed: it creates ghost messages on button interactions
  try { await interaction.deferUpdate(); return 'update'; } catch (_e) {}
  return 'none';
}

async function _followUpWizardTap(interaction, ackMode, content) {
  const payload = { content, flags:64 };
  if (ackMode === 'reply' && (interaction.deferred || interaction.replied)) {
    return interaction.editReply(payload).catch(() => null);
  }
  if (ackMode === 'update') {
    return interaction.followUp(payload).catch(() => null);
  }
  return interaction.reply(payload).catch(() => null);
}

function _starterNoteForMode(mode) {
  if (mode === 'standard') {
    return '✅ Standard Bot Setup selected. Review the wizard panels below, then press **Initialize / Build Server Now** when you are ready.';
  }
  if (mode === 'custom') {
    return '🧩 Custom Bot Setup selected. Pick a structure mode and template in the wizard panels below, then initialize when you are ready.';
  }
  return 'Installation mode is active.';
}

async function _updateStarterMessageFromButton(interaction, note) {
  const payload = wizardRendererService.buildWizardPayload(null, note);
  try {
    await interaction.update(payload);
    return 'updated';
  } catch (err) {
    log.warn('starter button update failed:', err.message);
  }
  try {
    await interaction.deferUpdate();
    if (interaction.message?.editable) {
      await interaction.message.edit(payload);
      return 'deferred';
    }
    return 'deferred';
  } catch (err) {
    log.warn('starter button defer/edit failed:', err.message);
  }
  try {
    await interaction.reply({ content: '✅ Setup selection saved. Scroll this lane for the refreshed wizard cards.', flags:64 });
    return 'reply';
  } catch (err) {
    log.warn('starter button reply failed:', err.message);
  }
  return 'none';
}

function _ephemeralWizardModeMsg(mode, ch) {
  if (mode === 'standard') {
    return `✅ Standard Bot Setup selected. Scroll this lane for the refreshed wizard cards in ${ch ? `<#${ch.id}>` : `\`${_setupWizardFallbackText()}\``}.`;
  }
  return `🧩 Custom Bot Setup selected. Scroll this lane for the refreshed wizard cards in ${ch ? `<#${ch.id}>` : `\`${_setupWizardFallbackText()}\``}.`;
}

function _starterFollowupNeeded(ackMode) {
  return ackMode === 'reply';
}

async function _saveMemberTimezoneAndSync(member, timezoneInput, opts = {}) {
  const timezone = normalizeTimezone(timezoneInput);
  if (!timezone) return { ok: false, reason: 'invalid-timezone' };
  const liveMember = member?.guild?.members?.fetch ? await member.guild.members.fetch(member.id).catch(() => member) : member;
  const label = String(nicknamePolicy.timezoneLabel(timezone) || timezone || '').toUpperCase();
  memberProfiles.upsertProfile(liveMember.id, { timezone, timezoneLabel: label, lastSeenDisplayName: nicknamePolicy.stripTimezoneSuffix(liveMember.displayName || liveMember.user?.username || '') });
  let updated = 0;
  for (const player of _state.players.values()) {
    if (String(player.userId) === String(liveMember.id)) {
      player.timezone = timezone;
      updated += 1;
    }
  }
  const nicknameSync = await nicknamePolicy.syncMemberNickname(liveMember, _state, { reason: 'Timezone profile updated', channelId: opts.channelId || null }).catch(err => ({ ok:false, reason: err.message }));

  let wizardAdvanced = false;
  try {
    const shouldRefreshWizard = opts.refreshWizard !== false
      && liveMember?.guild
      && matchesConfiguredChannel(liveMember.guild.channels?.cache?.get(opts.channelId || ''), 'setupWizard');
    if (shouldRefreshWizard) {
      wizardStateService.patch({ installationMode: true });
    wizardPrefs.savePrefs({ lastTimezoneAt: Date.now() });
      wizardAdvanced = true;
    }
  } catch {}

  if (serverSettings.getSettings().requireTimezone) {
    await timezoneGateService.releaseMemberFromTimezoneGate(liveMember).catch(() => null);
  }
  return { ok: true, timezone, label, updatedPlayers: updated, nicknameSync, wizardAdvanced };
}


function _buildBotIdentityModal(settings = serverSettings.getSettings()) {
  const modal = new ModalBuilder().setCustomId('bot_identity_modal').setTitle('Configure Bot Identity');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('bot_name').setLabel('Bot display name').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('myBot').setValue(String(settings.botName || 'myBot').slice(0, 32))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('avatar_url').setLabel('Avatar URL (optional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('https://... image url').setValue(String(settings.avatarMode === 'url' ? (settings.avatarUrl || '') : '').slice(0, 400))
    )
  );
  return modal;
}

// ── Message Context Menu: Edit Bot Message / Delete Bot Message ───────────────
async function _handleMessageContextMenu(interaction) {
  const guild = interaction.guild;
  const name  = interaction.commandName;

  // Auth check — commissioners only
  const isComm = () => isAdminMember(interaction.member, COMM_ROLE, _dynamicCommissioners());
  if (!isComm()) {
    return interaction.reply({ content: '❌ Commissioners only.', flags:64 }).catch(() => null);
  }

  const targetMsg = interaction.targetMessage;
  if (!targetMsg) {
    return interaction.reply({ content: '❌ Could not resolve the target message.', flags:64 }).catch(() => null);
  }

  // Only allow acting on bot's own messages
  const botId = guild?.members?.me?.id || interaction.applicationId;
  if (targetMsg.author?.id !== botId) {
    return interaction.reply({ content: '❌ You can only edit or delete messages posted by this bot.', flags:64 }).catch(() => null);
  }

  if (name === 'Delete Bot Message') {
    try {
      await targetMsg.delete();
      return interaction.reply({ content: '🗑️ Bot message deleted.', flags:64 }).catch(() => null);
    } catch (err) {
      log.error('Delete bot message failed:', err.message, err.stack);
      return interaction.reply({ content: safeUserError(err, '❌ Could not delete that bot message. Check permissions and try again.'), flags:64 }).catch(() => null);
    }
  }

  if (name === 'Edit Bot Message') {
    // Pull current content from the message (text or first embed description)
    const currentText = targetMsg.content ||
      targetMsg.embeds?.[0]?.description ||
      targetMsg.embeds?.[0]?.title || '';

    const modal = new ModalBuilder()
      .setCustomId(`bot_msg_edit_modal_${targetMsg.id}`)
      .setTitle('Edit Bot Message');
    const input = new TextInputBuilder()
      .setCustomId('edited_content')
      .setLabel('New message content')
      .setStyle(TextInputStyle.Paragraph)
      .setValue(currentText.slice(0, 4000))
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal).catch((err) => {
      log.error('Edit Bot Message modal failed:', err.message);
    });
  }
}

// ── Button Handlers ───────────────────────────────────────────
async function _handleButton(interaction) {
  const guild  = interaction.guild;
  const cid    = interaction.customId;
  const isComm = () => isAdminMember(interaction.member, COMM_ROLE, _dynamicCommissioners());

  // Button-first choice adapter. The custom ID contains only an opaque session/option key;
  // canonical values remain server-side in ComponentSession. Legacy select handlers are
  // reused through a synthetic select interaction until each flow is migrated to its own controller.
  if (String(cid || '').startsWith('uiopen:')) {
    const sessionId = String(cid).split(':')[1] || '';
    const session = componentSessions.get(sessionId);
    const access = componentSessions.access(session, interaction);
    if (!access.ok) {
      const msg = access.reason === 'wrong-user' ? '❌ This control belongs to another member.' : '⌛ This control expired. Reopen the panel.';
      return interaction.reply({ content:msg, flags:64 }).catch(() => null);
    }
    return interaction.update({ components:buttonChoiceService.renderSession(session, access.userId) }).catch(() => null);
  }
  if (String(cid || '').startsWith('ui:')) {
    const [, sessionId, action, optionKey] = String(cid).split(':');
    const session = componentSessions.get(sessionId);
    const access = componentSessions.access(session, interaction);
    if (!access.ok) {
      const msg = access.reason === 'wrong-user' ? '❌ This control belongs to another member.' : '⌛ This control expired. Reopen the command or panel.';
      return interaction.reply({ content: msg, flags:64 }).catch(() => null);
    }
    if (action === 'prev' || action === 'next') {
      componentSessions.setPage(session, session.page + (action === 'next' ? 1 : -1));
      return interaction.update({ components: buttonChoiceService.renderSession(session, access.userId) }).catch(() => null);
    }
    if (action === 'page') return interaction.deferUpdate().catch(() => null);
    if (action === 'pick') {
      const toggled = componentSessions.toggle(session, optionKey, access.userId);
      if (!toggled.ok) {
        if (toggled.reason === 'max-values') return interaction.reply({ content:`⚠️ You can choose at most ${session.maxValues}.`, flags:64 }).catch(() => null);
        return interaction.reply({ content:'⚠️ That option is no longer available.', flags:64 }).catch(() => null);
      }
      if (session.maxValues > 1 || session.minValues === 0) {
        return interaction.update({ components: buttonChoiceService.renderSession(session, access.userId) }).catch(() => null);
      }
    }
    if (action === 'done' || action === 'pick') {
      const values = componentSessions.values(session, access.userId);
      if (values.length < session.minValues) return interaction.reply({ content:`⚠️ Choose at least ${session.minValues} option(s) first.`, flags:64 }).catch(() => null);
      const synthetic = new Proxy(interaction, {
        get(target, prop) {
          if (prop === 'customId') return session.legacyCustomId;
          if (prop === 'values') return values;
          if (prop === 'isStringSelectMenu') return () => true;
          if (prop === 'isButton') return () => false;
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      if (!session.public) componentSessions.remove(session.id);
      return _handleButton(synthetic);
    }
    return interaction.deferUpdate().catch(() => null);
  }

  if (_guardInstallationModeComponent(interaction)) return;

// V202: application-enforced confirmation for destructive commissioner-AI actions.
// Only the original requester may confirm; commissioner-AI authorization is re-checked with the SAME gate the handler uses.
if (cid.startsWith('aiact_confirm::') || cid.startsWith('aiact_cancel::')) {
  const confirmationService = require('../actions/confirmationService');
  const { isCommissionerAiAuthorized } = require('../handlers/commissionerHandler');
  const token = cid.split('::')[1] || '';
  if (!isCommissionerAiAuthorized(interaction.member, interaction.user.id)) {
    return interaction.reply({ content: '❌ Only an authorized commissioner can confirm AI actions.', flags:64 });
  }
  if (cid.startsWith('aiact_cancel::')) {
    const c = confirmationService.cancel(token, interaction.user.id);
    if (!c.ok) return interaction.reply({ content: c.reason === 'wrong-user' ? '❌ Only the commissioner who made the request can cancel it.' : '⚠️ This request already expired or was handled.', flags:64 });
    return interaction.update({ content: `${String(interaction.message?.content || '').slice(0, 1800)}\n\n🚫 Cancelled — nothing was executed.`, components: [] }).catch(() => null);
  }
  const consumed = confirmationService.consume(token, interaction.user.id, guild?.id);
  if (!consumed.ok) {
    const why = consumed.reason === 'wrong-user' ? '❌ Only the commissioner who made the request can confirm it.' : consumed.reason === 'expired' ? '⌛ This confirmation expired — ask again.' : '⚠️ This request was already handled.';
    return interaction.reply({ content: why, flags:64 });
  }
  await interaction.update({ content: `${String(interaction.message?.content || '').slice(0, 1800)}\n\n✅ Confirmed by <@${interaction.user.id}> — executing…`, components: [], allowedMentions: { parse: [] } }).catch(() => null);
  const actionExecutor = require('../actions/actionExecutor');
  const outcome = await actionExecutor.runConfirmed(consumed.entry, {
    guild, channelId: interaction.channelId, actorId: interaction.user.id, actorTag: interaction.user.tag,
    requestId: `confirm:${token}`, state: _state, client: _client, getCh: _getCh, aiCall: _aiCall, MODELS: _MODELS,
  });
  const text = actionExecutor.formatResults(outcome) || 'No actions were executed.';
  return interaction.followUp({ content: text.slice(0, 1990), allowedMentions: { parse: [] } }).catch(() => null);
}

if (interaction.isStringSelectMenu?.() && cid === 'timezone_onboarding_select') {
  const ackMode = await _safeAcknowledgeWizardTap(interaction);
  try {
    const picked = interaction.values?.[0] || '';
    const result = await _saveMemberTimezoneAndSync(interaction.member, picked, { channelId: interaction.channelId, advanceWizard: true });
    if (!result.ok) return _followUpWizardTap(interaction, ackMode, '❌ Invalid timezone choice.');
    const extra = result.updatedPlayers ? ` Linked team records updated: **${result.updatedPlayers}**.` : ' Your member profile is now ready for scheduling and template-aware server flows.';
    return _followUpWizardTap(interaction, ackMode, `✅ Timezone saved as **${result.timezone}** (${result.label}).${extra}`);
  } catch (err) {
    log.error('timezone_onboarding_select failed:', err.message, err.stack);
    return _followUpWizardTap(interaction, ackMode, safeUserError(err, '❌ Timezone save failed. Try again in a moment.'));
  }
}

if (cid === 'timezone_onboarding_button') {
  return interaction.reply({ content:'Use the timezone buttons in this channel, or run `/set-timezone` with any supported IANA timezone.', flags:64 });
}

if (cid === 'setup_wizard_seed_refresh') {
  if (!isComm()) {
    if (!interaction.deferred && !interaction.replied && (interaction.isButton?.() || interaction.isStringSelectMenu?.())) {
      return interaction.update({ content: '❌ Commissioners only.', embeds: [], components: [] }).catch(() => null);
    }
    return interaction.followUp({ content:'❌ Commissioners only.', flags:64 }).catch(() => null);
  }
  try {
    await interaction.deferUpdate().catch(() => null);
    const setupCh = await _ensureSetupWizardChannel(guild, { reveal: true }).catch(() => interaction.channel || null);
    const nextStage = 'mode';
    wizardStateService.patch({ installationMode: true, currentStep: nextStage, lastAdvancedAt: Date.now(), lastGuideRefreshAt: Date.now() });
    wizardPrefs.savePrefs({ selectedSetupMode: null, standardSelected: false, customSelected: false });
    const payload = wizardRendererService.buildWizardPayload(guild, 'Choose a structure strategy and server template to begin.');
    let starter = null;
    if (interaction.message?.editable && interaction.message?.channelId === (setupCh?.id || interaction.channelId)) {
      await interaction.message.edit({ ...payload, files: [] }).catch(() => null);
      starter = interaction.message;
    } else {
      starter = await _ensureSetupWizardStarterMessage(setupCh || interaction.channel, 'Choose a structure strategy and server template to begin.').catch(() => null);
    }
    if (starter?.id) {
      wizardStateService.setActiveMessageId(starter.id);
        await _purgeSetupWizardNoise(setupCh || interaction.channel, [starter.id]).catch(() => null);
    }
  } catch (err) {
    log.error('setup_wizard_seed_refresh failed:', err.message, err.stack);
    try {
      await interaction.followUp({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('⚡ Start Setup')
          .setDescription('Wizard failed to load. Press **⚡ Start Setup** again.')
          .setTimestamp()],
        flags:64,
      });
    } catch (_e) {}
  }
  return null;
}

if (cid === 'bot_setup_back') {
  try { await interaction.deferUpdate(); } catch (_e) {}
  if (!isComm()) return interaction.followUp({ content:'❌ Commissioners only.', flags:64 }).catch(() => null);
  const result = wizardStateService.retreatStep();
  const prev = result.step || 'flow';
  wizardPrefs.savePrefs({ wizardStage: prev }); // keep in sync until wizardPrefs fully retired
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, 'Moved back one step.'));
}

if (cid === 'bot_setup_reset') {
  try { await interaction.deferUpdate(); } catch (_e) {}
  if (!isComm()) return interaction.followUp({ content:'❌ Commissioners only.', flags:64 }).catch(() => null);
  serverSettings.resetInstallationDefaults();
  serverRulesService.resetProfile();
  wizardStateService.resetState({ installationMode: true, currentStep: 'flow', lastTrashAt: Date.now() });
  wizardPrefs.savePrefs({ selectedSetupMode: null, standardSelected: false, customSelected: false, wizardStage: 'flow', awaitingAvatarUpload: false });
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, 'Setup wizard reset. Confirm the guide again to restart clean.'));
}

if (cid === 'wizard_next') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  try {
  const wiz = wizardStateService.getState();
  const settings = serverSettings.getSettings();
  const currentStep = wiz.currentStep || 'mode';

  if (currentStep === 'mode') {
    if (!settings.customStructureMode) {
      return interaction.followUp({ content:'⚠️ Choose a structure strategy before continuing.', flags:64 }).catch(() => null);
    }
    if (settings.customStructureMode === 'template') {
      if (!settings.serverTemplate) return interaction.followUp({ content:'⚠️ Choose a server template before continuing.', flags:64 }).catch(() => null);
      const subOpts = getTemplateSubtemplateOptions(settings.serverTemplate);
      if (subOpts.length && !settings.serverSubtemplate) return interaction.followUp({ content:'⚠️ Choose a subtemplate before continuing.', flags:64 }).catch(() => null);
    }
    const nextStage = settings.customStructureMode === 'custom' ? 'custom_structure' : 'tone';
    wizardStateService.patch({ currentStep: nextStage, lastAdvancedAt: Date.now() });
    wizardPrefs.savePrefs({ wizardStage: nextStage });
    return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild,
      nextStage === 'custom_structure'
        ? 'Now choose the exact custom packs you want. The bot will arrange them by pack.'
        : 'Now choose audience level and AI tones.'));
  }
  if (currentStep === 'custom_structure') {
    if (!Array.isArray(settings.customTemplateSelections) || !settings.customTemplateSelections.length) {
      return interaction.followUp({ content:'⚠️ Choose at least one template for Custom Structure before continuing.', flags:64 }).catch(() => null);
    }
    wizardStateService.patch({ currentStep: 'tone', lastAdvancedAt: Date.now() });
    wizardPrefs.savePrefs({ wizardStage: 'tone' });
    return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, 'Custom templates/subtemplates saved. Now choose audience level and AI tones.'));
  }
  if (currentStep === 'tone') {
    if (!settings.audienceRating) {
      return interaction.followUp({ content:'⚠️ Choose an audience level before continuing (G / PG / PG-13 / R).', flags:64 }).catch(() => null);
    }
    if (!serverSettings.getEffectiveToneProfile(settings, 'member').length) {
      const defaults = serverSettings.getAllowedTonesForAudience
        ? serverSettings.getAllowedTonesForAudience(settings.audienceRating).slice(0,2)
        : ['Straight', 'One-Liner'];
      serverSettings.setToneProfile(defaults, settings.useSharedToneProfile ? 'shared' : 'member');
    }
    if (!settings.useSharedToneProfile && !serverSettings.getEffectiveToneProfile(settings, 'commissioner').length) {
      const defaults = serverSettings.getAllowedTonesForAudience
        ? serverSettings.getAllowedTonesForAudience(settings.audienceRating).slice(0,1)
        : ['Straight'];
      serverSettings.setToneProfile(defaults, 'commissioner');
    }
    wizardStateService.patch({ currentStep: 'finalize', lastAdvancedAt: Date.now() });
    wizardPrefs.savePrefs({ wizardStage: 'finalize' });
    return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, 'Final review. Configure identity or rules, then build when ready.'));
  }
  // Fallback: unrecognized step → push back to mode
  wizardStateService.patch({ currentStep: 'mode' });
  wizardPrefs.savePrefs({ wizardStage: 'mode' });
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, 'Choose structure mode and template to begin.'));
  } catch (wizardErr) {
    log.error('wizard_next failed:', wizardErr.message, wizardErr.stack);
    try {
      return await interaction.followUp({
        content: `❌ Wizard step failed: ${wizardErr.message}. Try clicking again or use **Reset** to restart.`,
        flags:64,
      });
    } catch (_e2) {}
  }
}

if (cid === 'init_server_confirm') {
  return interaction.reply({ content:'ℹ️ `/initialize-server` now runs immediately and opens the setup wizard lane without the extra confirm step.', flags:64 });
}

  
if (interaction.isStringSelectMenu?.() && cid === 'community_membership_select') {
  const ackMode = await _safeAcknowledgeWizardTap(interaction);
  try {
    const communityAccess = communityAccessService;
    const result = await communityAccess.applyCommunityMembership(interaction.member, interaction.values);
    await communityAccess.postSelectorPanel(guild).catch(() => null);
    if (!result.ok) return _followUpWizardTap(interaction, ackMode, '❌ Could not update community access.');
    if (interaction.deferred || interaction.replied) {
      await interaction.deleteReply().catch(() => null);
    }
    return null;
  } catch (err) {
    log.error('community_membership_select failed:', err.message, err.stack);
    return _followUpWizardTap(interaction, ackMode, safeUserError(err, '❌ Could not update community access. Check the server logs for details.'));
  }
}

if (interaction.isStringSelectMenu?.() && cid === 'init_age_rating') {
    if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
    try { await interaction.deferUpdate(); } catch (_e) {}
    const chosen = interaction.values[0];
    serverSettings.saveSettings({ ...serverSettings.getSettings(), audienceRating: chosen === '__clear__' ? '' : chosen });
    return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, chosen === '__clear__' ? 'Audience selection cleared.' : `Audience set to **${String(chosen).toUpperCase()}**. Tone choices have been refreshed for that rating.`));
  }

if (interaction.isStringSelectMenu?.() && cid === 'bot_avatar_emoji_select') {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  const picked = interaction.values[0];
  const found = guild?.emojis?.cache?.find(e => e.name === picked || String(e.name||'').toLowerCase() === String(picked).toLowerCase());
  if (!found) return interaction.reply({ content:'❌ Imported emoji not found.', flags:64 });
  serverSettings.setBotIdentity({ avatarMode: 'emoji_url', avatarUrl: found.imageURL({ extension: 'png', size: 256 }), avatarEmoji: found.name });
  await botIdentityService.applyBotIdentity(_client, guild).catch(()=>null);
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, `Imported emoji avatar saved: **${found.name}**.`));
}

if (interaction.isStringSelectMenu?.() && cid === 'bot_server_template_select') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  try { await interaction.deferUpdate(); } catch (_e) {}
  const selected = interaction.values[0];
  const nextSettings = { ...serverSettings.getSettings(), serverTemplate: selected === '__clear__' ? '' : selected, serverSubtemplate: '' };
  serverSettings.saveSettings(nextSettings);
  const subCount = selected === '__clear__' ? 0 : getTemplateSubtemplateOptions(selected).length;
  const msg = selected === '__clear__'
    ? 'Server template selection cleared.'
    : subCount
      ? `Server template saved: **${templateLogic.getTemplateProfile(serverSettings.getSettings()).baseName || templateLogic.getTemplateProfile(serverSettings.getSettings()).name}**. Choose a subtemplate next for a more precise build.`
      : `Server template saved: **${templateLogic.getTemplateProfile(serverSettings.getSettings()).name}**.`;
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, msg));
}
if (interaction.isStringSelectMenu?.() && cid === 'bot_server_subtemplate_select') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  try { await interaction.deferUpdate(); } catch (_e) {}
  const selected = interaction.values[0];
  const nextVal = (selected === '__clear__' || selected === '__none__') ? '' : selected;
  serverSettings.saveSettings({ ...serverSettings.getSettings(), serverSubtemplate: nextVal });
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, nextVal ? `Subtemplate saved: **${resolveTemplateProfile(serverSettings.getSettings()).subtemplateName || nextVal}**.` : 'Subtemplate selection cleared.'));
}
if (interaction.isStringSelectMenu?.() && cid === 'bot_structure_mode_select') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  try { await interaction.deferUpdate(); } catch (_e) {}
  const selected = interaction.values[0];
  const mode = selected === '__clear__' ? '' : selected;
  const current = serverSettings.getSettings();
  const patch = { ...current, customStructureMode: mode };
  if (mode === 'base') {
    patch.serverTemplate = ''; patch.serverSubtemplate = ''; patch.customTemplateSelections = []; patch.customSubtemplateSelections = [];
  } else if (mode === 'template') {
    patch.customTemplateSelections = []; patch.customSubtemplateSelections = [];
  } else if (mode === 'custom') {
    patch.serverTemplate = ''; patch.serverSubtemplate = '';
  }
  serverSettings.saveSettings(patch);
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, selected === '__clear__' ? 'Structure mode selection cleared.' : `Structure mode saved: **${String(selected).toUpperCase()}**.`));
}
if (interaction.isStringSelectMenu?.() && cid === 'bot_structure_arrangement_select') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  serverSettings.saveSettings({ ...serverSettings.getSettings(), customArrangementMode: interaction.values[0] });
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, `Custom arrangement saved: **${String(interaction.values[0]).toUpperCase()}**.`));
}
if (interaction.isStringSelectMenu?.() && cid === 'bot_custom_template_select') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  try { await interaction.deferUpdate(); } catch (_e) {}
  const current = serverSettings.getSettings();
  const templates = interaction.values.filter(v => v !== '__none__');
  const validSubs = (current.customSubtemplateSelections || []).filter(v => templates.includes(String(v).split(':')[0]));
  serverSettings.saveSettings({ ...current, customTemplateSelections: templates, customSubtemplateSelections: validSubs });
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, `Saved **${templates.length}** custom template(s).`));
}
if (interaction.isStringSelectMenu?.() && cid === 'bot_custom_subtemplate_select') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  try { await interaction.deferUpdate(); } catch (_e) {}
  const values = interaction.values.filter(v => v !== '__none__');
  serverSettings.saveSettings({ ...serverSettings.getSettings(), customSubtemplateSelections: values });
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, `Saved **${values.length}** custom subtemplate(s).`));
}

if (interaction.isStringSelectMenu?.() && cid === 'bot_custom_catalog_select') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  try { await interaction.deferUpdate(); } catch (_e) {}
  serverSettings.saveSettings({ ...serverSettings.getSettings(), customCatalogSelections: interaction.values });
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, `Saved **${interaction.values.length}** custom selection(s).`));
}

// Mix-and-match custom selects — each group merges into customCatalogSelections
if (interaction.isStringSelectMenu?.() && ['custom_mix_gaming','custom_mix_sports','custom_mix_community','custom_mix_media'].includes(cid)) {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64}).catch(() => null);
  try { await interaction.deferUpdate(); } catch (_e) {}
  try {
    const current = serverSettings.getSettings();
    const existing = Array.isArray(current.customCatalogSelections) ? current.customCatalogSelections : [];
    const prefixMap = { custom_mix_gaming:'gaming:', custom_mix_sports:'sports:', custom_mix_community:'community:', custom_mix_media:'media:' };
    const prefix = prefixMap[cid];
    const kept = existing.filter(s => !s.startsWith(prefix));
    const newSels = [...kept, ...interaction.values];
    serverSettings.saveSettings({ ...current, customCatalogSelections: newSels });
    const totalGroups = ['gaming:','sports:','community:','media:'].filter(p => newSels.some(s => s.startsWith(p))).length;
    const note = newSels.length
      ? `✅ **${newSels.length}** space(s) across **${totalGroups}** group(s). Pick more or press **▶ Audience & AI Tone** when ready.`
      : 'Cleared. Select at least one space to continue.';
    return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, note));
  } catch (err) {
    log.error(`${cid} mix handler failed:`, err.message);
    return interaction.followUp({ content:safeUserError(err, '❌ Selection failed. Try again in a moment.'), flags:64 }).catch(() => null);
  }
}

if (interaction.isStringSelectMenu?.() && cid === 'init_tone_profile') {
    if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
    serverSettings.setToneProfile(interaction.values);
    return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, `Shared tone saved: **${serverSettings.getToneSummary(serverSettings.getSettings())}**.`));
  }

if (interaction.isStringSelectMenu?.() && cid === 'member_tone_profile') {
    if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
    try { await interaction.deferUpdate(); } catch (_e) {}
    const vals = interaction.values.includes('__clear__') ? [] : interaction.values;
    serverSettings.setToneProfile(vals, serverSettings.getSettings().useSharedToneProfile ? 'shared' : 'member');
    return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, vals.length ? `Member AI tone saved: **${serverSettings.getToneSummary(serverSettings.getSettings(), 'member')}**.` : 'Member AI tone selection cleared.'));
  }

if (interaction.isStringSelectMenu?.() && cid === 'commissioner_tone_profile') {
    if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
    try { await interaction.deferUpdate(); } catch (_e) {}
    const vals = interaction.values.includes('__clear__') ? [] : interaction.values;
    serverSettings.setToneProfile(vals, 'commissioner');
    return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, vals.length ? `Commissioner AI tone saved: **${serverSettings.getToneSummary(serverSettings.getSettings(), 'commissioner')}**.` : 'Commissioner AI tone selection cleared.'));
  }

if (cid === 'bot_toggle_same_tone') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  try { await interaction.deferUpdate(); } catch (_e) {}
  const current = serverSettings.getSettings();
  const next = !current.useSharedToneProfile;
  const shared = (current.memberToneProfile && current.memberToneProfile.length ? current.memberToneProfile : current.toneProfile) || [];
  serverSettings.saveSettings({ ...current, useSharedToneProfile: next, memberToneProfile: next ? shared : current.memberToneProfile, commissionerToneProfile: next ? shared : current.commissionerToneProfile, setupCompletedAt: Date.now() });
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, next ? 'Commissioner AI will now mirror member AI.' : 'Commissioner AI now has its own separate tone build.'));
}

if (cid === 'bot_toggle_gifs') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  try { await interaction.deferUpdate(); } catch (_e) {}
  const current = serverSettings.getSettings();
  serverSettings.saveSettings({ ...current, allowGifReplies: !current.allowGifReplies, setupCompletedAt: Date.now() });
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, `GIF replies are now **${serverSettings.getSettings().allowGifReplies ? 'ON' : 'OFF'}**.`));
}

if (cid === 'bot_toggle_timezone_gate') {
  try { await interaction.deferUpdate(); } catch (_e) {}
  if (!isComm()) return interaction.followUp({ content:'❌ Commissioners only.', flags:64 }).catch(() => null);
  try {
    const next = !serverSettings.getSettings().requireTimezone;
    serverSettings.saveSettings({ ...serverSettings.getSettings(), requireTimezone: next, setupCompletedAt: Date.now() });
    if (next) {
      // Ensure the gate channel exists FIRST before locking members
      const gateChannel = await timezoneGateService.ensureGateChannel(guild).catch(() => null);
      log.info(`Timezone gate ON — gate channel: ${gateChannel?.name || 'not created'}`);
      // Lock ALL members without timezone immediately (not just a prompt — actual channel restriction)
      let lockedCount = 0;
      const members = guild.members?.cache ? [...guild.members.cache.values()] : [];
      for (const member of members) {
        if (member.user?.bot) continue;
        if (memberProfiles.getProfile(member.id)?.timezone) continue;
        await timezoneGateService.lockMemberToTimezoneGate(member).catch(() => null);
        lockedCount++;
      }
      log.info(`Timezone gate: locked ${lockedCount} member(s) into gate`);
    } else {
      await timezoneGateService.clearAllTimezoneDataAndNicknames(guild, _state).catch(() => null);
      await timezoneGateService.hideGateChannel(guild).catch(() => null);
    }
    const statusMsg = next
      ? `✅ Timezone gate is **ON**. ${(guild.members?.cache?.filter(m => !m.user?.bot && !memberProfiles.getProfile(m.id)?.timezone)?.size || 0)} member(s) without a timezone were moved to the gate channel.`
      : `✅ Timezone gate is **OFF**. Timezone data and nickname suffixes cleared.`;
    return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, statusMsg));
  } catch (err) {
    log.error('bot_toggle_timezone_gate failed:', err.message, err.stack);
    return interaction.followUp({ content: safeUserError(err, '❌ Timezone gate toggle failed. Check the logs and try again.'), flags:64 }).catch(() => null);
  }
}

if (cid === 'bot_automation_status') {
  if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags:64 }).catch(() => null);
  try { await interaction.deferUpdate(); } catch (_e) {}
  const onboardingAuto = onboardingAutoService;
  await onboardingAuto.postAutomationStatus(guild).catch(() => null);
  const autoSettings = onboardingAuto.getSettings();
  const settings = serverSettings.getSettings();
  const embed = onboardingAuto.buildAutomationStatusEmbed(settings, autoSettings);
  try { return await interaction.followUp({ embeds: [embed], flags:64 }); } catch (_e) {}
  return null;
}

if (cid === 'bot_identity_upload_help') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  await interaction.deferUpdate().catch(() => null);
  const setupCh = await _ensureSetupWizardChannel(guild, { reveal: true }).catch(() => null);
  const prompt = setupCh
    ? await setupCh.send({ content:'🖼️ Upload one supported image in **#setup-wizard** now. Accepted: **PNG, JPG, JPEG, WEBP, GIF**. Files like PDF, DOC, TXT, PY, ZIP, and other non-image uploads are rejected.', allowedMentions:{ parse: [] } }).catch(() => null)
    : null;
  wizardPrefs.savePrefs({ awaitingAvatarUpload: true, avatarPromptMessageId: prompt?.id || null });
  return null;
}

if (cid === 'bot_setup_standard') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  wizardStateService.patch({ installationMode: true, currentStep: 'mode' });
  wizardPrefs.savePrefs({ selectedSetupMode: 'standard', standardSelected: true, customSelected: false, wizardStage: 'mode' });
  serverSettings.saveSettings({ ...serverSettings.getSettings(), customStructureMode: 'base' });
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, 'Standard Bot Setup selected. Now choose the server template before continuing.'));
}

if (cid === 'bot_setup_custom') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  wizardStateService.patch({ installationMode: true, currentStep: 'mode' });
  wizardPrefs.savePrefs({ selectedSetupMode: 'custom', standardSelected: false, customSelected: true, wizardStage: 'mode' });
  if (!serverSettings.getSettings().customStructureMode) serverSettings.saveSettings({ ...serverSettings.getSettings(), customStructureMode: 'custom' });
  return _applyWizardPayload(interaction, wizardRendererService.buildWizardPayload(guild, 'Custom Bot Setup selected. Choose structure mode and template, then continue.'));
}

  if (cid.startsWith('setup_')) {
    const { handleSetupInteraction } = leagueSetupService;
    return handleSetupInteraction(interaction, _state);
  }
  if (interaction.isStringSelectMenu?.() && cid.startsWith('league_member_timezone::')) {
    const [, leagueId, targetUserId] = cid.split('::');
    if (String(interaction.user.id) !== String(targetUserId)) {
      return interaction.reply({ content:'❌ This onboarding card belongs to another member.', flags:64 });
    }
    const picked = interaction.values?.[0] || '';
    const result = await _saveMemberTimezoneAndSync(interaction.member, picked, { channelId:interaction.channelId, advanceWizard:false, refreshWizard:false });
    if (!result.ok) return interaction.reply({ content:'❌ Invalid timezone choice.', flags:64 });
    leagueMemberOnboarding.markTimezoneComplete(interaction.user.id, leagueId, result.timezone, result.nicknameSync);
    const league = activeLeagueService.getLeague(leagueId);
    const team = nicknamePolicy.getDisplayForLeague(_state, interaction.user.id, leagueId);
    return interaction.update({
      content:`<@${interaction.user.id}>`,
      embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle(`✅ ${league?.leagueName || 'League'} onboarding complete`).setDescription(`**League:** ${league?.leagueName || leagueId}\n**Team:** ${team || 'Not selected yet'}\n**Timezone:** ${result.label}\n\n${team ? 'You are ready for scheduling and league activity.' : 'Your timezone is saved. Use `/select-team` to claim an available team in this league.'}`).setTimestamp()],
      components:[],
      allowedMentions:{ users:[interaction.user.id], parse:[] },
    });
  }

  if (cid.startsWith('join_')) {
    const { handleJoinInteraction } = joinLeagueService;
    return handleJoinInteraction(interaction, _state);
  }


if (cid === 'bot_setup_apply_custom') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  const ackMode = await _safeAcknowledgeWizardTap(interaction);
  wizardStateService.patch({ installationMode: true });
  wizardPrefs.savePrefs({ selectedSetupMode: 'custom', customSelected: true, standardSelected: false });
  return _followUpWizardTap(interaction, ackMode, '✅ Custom template choices saved. Press **Initialize / Build Server Now** when you are ready.');
}

if (cid === 'bot_setup_initialize') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  // Mutex: prevent double-fire from double-click or Railway retry
  if (_buildInProgress) {
    try { await interaction.deferUpdate(); } catch (_e) {}
    return null;
  }
  _buildInProgress = true;
  // deferUpdate: button press — zero Discord response tokens, no ghost messages.
  const prefs = wizardPrefs.getPrefs();
  const settings = serverSettings.getSettings() || {};
  const status = _wizardStatus(settings, prefs, guild);
  if (!status.canInitialize) {
    _buildInProgress = false; // release before early return
    const setupChFail = findConfiguredChannel(guild, 'setupWizard', { textOnly: true });
    if (setupChFail) await setupChFail.send({ content: `⚠️ Finish required choices first: ${status.missing.join(', ')}.`, allowedMentions: { parse: [] } }).catch(() => null);
    return null;
  }
  let buildProgressMsg = null;
  try {
    // Send progress to setup-wizard channel so it's visible and can be deleted after
    const setupChBuild = await _ensureSetupWizardChannel(guild, { reveal: true }).catch(() => null);
    if (setupChBuild) {
      const recent = await setupChBuild.messages.fetch({ limit: 20 }).catch(() => null);
      for (const m of (recent ? [...recent.values()] : [])) {
        if (m.author?.id !== guild.members.me?.id) continue;
        const title = String(m.embeds?.[0]?.title || '');
        if (/🏗️ Building Server/i.test(title)) await m.delete().catch(() => null);
      }
    }
    let interactionUpdated = false;
    if (!interaction.deferred && !interaction.replied && (interaction.isButton?.() || interaction.isStringSelectMenu?.())) {
      interactionUpdated = await interaction.update({ content: null, embeds: [new EmbedBuilder().setColor(0xf59e0b).setTitle('🏗️ Building Server...').setDescription('Creating channels, applying permissions, syncing identity, and publishing patch notes. This takes 15-30 seconds.').setTimestamp()], components: [] }).then(() => true).catch(() => false);
    }
    // V187 FIX: Only send a separate progress message if the interaction update didn't work.
    // Previously BOTH fired, creating two "Building Server..." embeds.
    if (setupChBuild && !interactionUpdated) {
      buildProgressMsg = await setupChBuild.send({
        embeds: [new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle('🏗️ Building Server...')
          .setDescription('Creating channels, applying permissions, syncing identity, and publishing patch notes. This takes 15-30 seconds.')
          .setTimestamp()],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }
    const { createTemplateStructure, applyEditChanges } = baseInitService;
    // Load one authoritative settings snapshot — never alias as liveSettings or wizardSettings
    const buildSettings = serverSettings.getSettings() || {};
    const templateProfile = templateLogic.getTemplateProfile(buildSettings);
    const chosenStructure = buildSettings.customStructureMode || 'base';

    // V186 FIX: Edit mode uses non-destructive path — no flush, no state reset, no channel deletion.
    // Only a FULL initial build (serverInitialized === false) should flush and rebuild from scratch.
    // Custom structure mode ALSO uses the non-destructive path to layer on top of base.
    const isEditApply = wizardStateService.isEditMode() || !!buildSettings.serverInitialized;
    let result;
    if (isEditApply) {
      log.info('[BUILD] Edit-apply path — non-destructive channel layering (no flush)');
      result = await applyEditChanges(guild, _state, buildSettings.serverTemplate, {
        settings: buildSettings,
        structureMode: chosenStructure,
        arrangementMode: buildSettings.customArrangementMode,
        customSelections: buildSettings.customCatalogSelections,
        customTemplateSelections: buildSettings.customTemplateSelections,
        customSubtemplateSelections: buildSettings.customSubtemplateSelections,
      });
    } else {
      log.info('[BUILD] Full build path — flush + create from template');
      result = await createTemplateStructure(guild, _state, buildSettings.serverTemplate, {
        settings: buildSettings,
        structureMode: chosenStructure,
        arrangementMode: buildSettings.customArrangementMode,
        customSelections: buildSettings.customCatalogSelections,
        customTemplateSelections: buildSettings.customTemplateSelections,
        customSubtemplateSelections: buildSettings.customSubtemplateSelections,
      });
    }
    serverSettings.saveSettings({ ...serverSettings.getSettings(), setupCompletedAt: Date.now(), serverInitialized: true });
    const identityResult = await botIdentityService.applyBotIdentity(_client, guild).catch((err) => ({ ok:false, reason: err?.message || 'identity_apply_failed' }));
    // wizardStateService owns installationMode, editMode, lastBuildAt — completeBuild() handles them all
    wizardStateService.completeBuild();

    // V198 FIX: Run independent post-build tasks in parallel instead of sequential await.
    // postAutomationStatus, lockBotAccessGuildWide, and deployCommands are independent.
    // publishPatchNotes REMOVED — already runs inside createTemplateStructure/applyEditChanges.
    const { COMM_ROLE } = require('../config/env');
    const commRole = guild.roles.cache.find(r => r.name === COMM_ROLE || r.id === COMM_ROLE);
    await Promise.allSettled([
      onboardingAutoService.postAutomationStatus(guild).catch(() => null),
      botAccessService.lockBotAccessGuildWide(guild, commRole?.id).catch(() => null),
      deployCommandsForCurrentState(_state).catch(() => null),
    ]);

    const welcomeCh = guild.channels.cache.find(c => c.isTextBased?.() && c.name === 'welcome');
    const setupCh = await _ensureSetupWizardChannel(guild, { reveal: true }).catch(() => null);
    // Delete the "Building..." progress message now that build is done
    if (buildProgressMsg?.deletable) await buildProgressMsg.delete().catch(() => null);
    await _ensureSetupWizardStarterMessage(setupCh, 'Server built. ✅ You can still adjust bot settings here after build.').catch(() => null);
    // Community access — parallel
    await Promise.allSettled([
      communityAccessService.postSelectorPanel(guild).catch(() => null),
      communityAccessService.syncCommunityChannelPermissions(guild, serverSettings.getSettings()).catch(() => null),
    ]);
    if (serverSettings.getSettings().requireTimezone) {
      await _promptTimezoneForGuildMembers(guild).catch(() => null);
      if (!memberProfiles.getProfile(interaction.user.id)?.timezone) {
        await timezoneGateService.postGatePrompt(interaction.member).catch(() => null);
      }
    }
    const nextLine = templateProfile.leagueFriendly
      ? 'Server commands are now unlocked. Create your Madden league with `/setup-league` when you are ready.'
      : 'Server commands are now unlocked. Communities are optional; `/setup-league` creates an independent managed league space when you are ready.';
    const identityLine = identityResult?.displayName ? `
Bot display synced to: **${identityResult.displayName}**` : '';
    const audienceWarning = serverSettings.requiresAgeWarning(buildSettings.audienceRating)
      ? `

⚠️ Audience warning: ${serverSettings.getAudienceWarning(buildSettings.audienceRating, buildSettings.filterMode)}`
      : '';
    // Post completion directly to setup-wizard — no ephemeral, no token, no ghost
    if (setupCh) {
      await setupCh.send({
        embeds: [new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('✅ Server Build Complete')
          .setDescription(
            `Template: **${result.template}** (${String(result.structureMode || chosenStructure).toUpperCase()})
` +
            `Lanes: ${result.templateSummary || 'template lanes'}

` +
            `Welcome: ${welcomeCh ? `<#${welcomeCh.id}>` : '`#welcome`'} · Setup: <#${setupCh.id}>${identityLine}
` +
            `${nextLine}${audienceWarning}`
          )
          .setTimestamp()],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }
    return null;
  } catch (err) {
    log.error('bot_setup_initialize failed:', err.message, err.stack);
    if (buildProgressMsg?.deletable) await buildProgressMsg.delete().catch(() => null);
    const setupChErr = findConfiguredChannel(guild, 'setupWizard', { textOnly: true });
    if (setupChErr) {
      await setupChErr.send({
        content: safeUserError(err, '❌ Server build failed. Check the logs and try again.'),
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }
  } finally {
    _buildInProgress = false; // always release — success, error, or unhandled throw
  }
}

if (cid === 'bot_identity_config') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  return interaction.showModal(_buildBotIdentityModal());
}

if (cid.startsWith('poll_vote::')) {
  return pollService.handleVote(interaction);
}

// ── Component interaction handlers ──────────────────────────────
// All component interactions use the comp_ prefix.

if (cid.startsWith('comp_avail::')) {
  const compReg = require('../services/componentRegistryService');
  const guard = compReg.guardEnabled('availability');
  if (guard.blocked) return interaction.reply({ content: guard.message, flags: 64 });
  const status = cid.split('::')[1]; // available, limited, unavailable
  const week = _state.scheduleState?.week || 1;
  compReg.recordAvailability(interaction.user.id, week, status);
  return interaction.reply({ content: `✅ Your availability for Week ${week} is set to **${status}**.`, flags: 64 });
}

if (cid.startsWith('comp_mvp::')) {
  const compReg = require('../services/componentRegistryService');
  const guard = compReg.guardEnabled('mvp-voting');
  if (guard.blocked) return interaction.reply({ content: guard.message, flags: 64 });
  const week = parseInt(cid.split('::')[1], 10) || _state.scheduleState?.week || 1;
  const pick = interaction.values?.[0];
  if (!pick) return interaction.reply({ content: '⚠️ No selection detected.', flags: 64 });
  compReg.recordMvpVote(week, interaction.user.id, pick);
  return interaction.reply({ content: `✅ Your MVP vote for Week ${week} has been recorded: <@${pick}>`, flags: 64 });
}

if (cid === 'comp_rule_ack') {
  const compReg = require('../services/componentRegistryService');
  const guard = compReg.guardEnabled('rule-ack');
  if (guard.blocked) return interaction.reply({ content: guard.message, flags: 64 });
  const alreadyAcked = compReg.hasAcknowledgedRules(interaction.user.id);
  compReg.recordRuleAck(interaction.user.id);
  if (alreadyAcked) return interaction.reply({ content: '✅ You have already acknowledged the rules. Thank you!', flags: 64 });
  // Grant access role if configured
  try {
    const settings = require('../services/serverSettingsService').getSettings();
    const memberRoleName = settings.memberRoleName || require('../config/constants').ROLE_DEFAULTS.MEMBER;
    const role = guild.roles.cache.find(r => r.name === memberRoleName);
    if (role && interaction.member && !interaction.member.roles.cache.has(role.id)) {
      await interaction.member.roles.add(role, 'Rule acknowledgment').catch(() => null);
    }
  } catch {}
  return interaction.reply({ content: '✅ Rules acknowledged! You now have full server access.', flags: 64 });
}

if (cid === 'comp_trade_block_edit') {
  const compReg = require('../services/componentRegistryService');
  const guard = compReg.guardEnabled('trade-block');
  if (guard.blocked) return interaction.reply({ content: guard.message, flags: 64 });
  const modal = new ModalBuilder().setCustomId('comp_trade_block_modal').setTitle('Update Trade Block');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('players').setLabel('Players on the block (one per line)').setStyle(2).setMaxLength(500).setRequired(true).setPlaceholder('Patrick Mahomes\nTravis Kelce')),
  );
  return interaction.showModal(modal);
}

if (cid === 'comp_trade_block_modal') {
  const compReg = require('../services/componentRegistryService');
  const players = String(interaction.fields.getTextInputValue('players') || '').split('\n').map(s => s.trim()).filter(Boolean);
  compReg.updateTradeBlock(interaction.user.id, players);
  return interaction.reply({ content: `✅ Trade block updated with ${players.length} player(s): ${players.join(', ')}`, flags: 64 });
}

if (cid === 'comp_game_result_submit') {
  const compReg = require('../services/componentRegistryService');
  const guard = compReg.guardEnabled('game-results');
  if (guard.blocked) return interaction.reply({ content: guard.message, flags: 64 });
  const modal = new ModalBuilder().setCustomId('comp_game_result_modal').setTitle('Submit Game Result');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('your_team').setLabel('Your Team').setStyle(1).setMaxLength(50).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('your_score').setLabel('Your Score').setStyle(1).setMaxLength(5).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('opp_team').setLabel('Opponent Team').setStyle(1).setMaxLength(50).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('opp_score').setLabel('Opponent Score').setStyle(1).setMaxLength(5).setRequired(true)),
  );
  return interaction.showModal(modal);
}

if (cid === 'comp_game_result_modal') {
  const compReg = require('../services/componentRegistryService');
  const yourTeam = interaction.fields.getTextInputValue('your_team');
  const yourScore = parseInt(interaction.fields.getTextInputValue('your_score'), 10);
  const oppTeam = interaction.fields.getTextInputValue('opp_team');
  const oppScore = parseInt(interaction.fields.getTextInputValue('opp_score'), 10);
  if (isNaN(yourScore) || isNaN(oppScore)) return interaction.reply({ content: '❌ Scores must be numbers.', flags: 64 });
  const week = _state.scheduleState?.week || 1;
  // V202 (BUG-006): route through the canonical result owner; it records the componentRegistry projection itself.
  const gameResultService = require('../league/gameResultService');
  const submitted = await gameResultService.submitGameResult({
    homeTeam: yourTeam, awayTeam: oppTeam, homeScore: yourScore, awayScore: oppScore, week,
    source: 'component-modal', submittedBy: interaction.user.id,
  }, { state: _state, guild });
  if (!submitted.ok) return interaction.reply({ content: `❌ ${submitted.reason}`, flags: 64 });
  const resultCh = _getCh(guild, 'gameResults');
  if (resultCh) {
    await sendMessageService.send(resultCh, { embeds: [new EmbedBuilder().setColor(yourScore > oppScore ? 0x2ecc71 : 0xe74c3c)
      .setTitle('📊 Game Result Submitted')
      .setDescription(`**${yourTeam}** ${yourScore} — ${oppScore} **${oppTeam}**`)
      .addFields({ name: 'Submitted By', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Week', value: String(week), inline: true })
      .setTimestamp()], allowedMentions: { parse: [] } }, { action: 'comp-game-result-log' });
  }
  return interaction.reply({ content: `✅ Game result recorded: **${yourTeam}** ${yourScore} – ${oppScore} **${oppTeam}**`, flags: 64 });
}

if (cid.startsWith('comp_predictions_start::')) {
  const compReg = require('../services/componentRegistryService');
  const guard = compReg.guardEnabled('predictions');
  if (guard.blocked) return interaction.reply({ content: guard.message, flags: 64 });
  return interaction.reply({ content: '🔮 Predictions feature is active. Use the matchup buttons posted with the weekly schedule to pick your winners.', flags: 64 });
}

  if (cid === 'server_rules_customize') {
    if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
    return interaction.showModal(serverRulesService.buildRulesModal());
  }

  if (interaction.isStringSelectMenu?.() && cid === 'server_rules_select_all') {
    if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
    const current = serverRulesService.getProfile();
    const selected = [];
    for (const rid of interaction.values || []) {
      const match = serverRulesService.RULE_LIBRARY.find(r => r[0] === rid);
      if (match) { const [id,text,level] = match; selected.push({ id, text, level }); }
    }
    const nextProfile = { ...current, selected };
    serverRulesService.saveProfile(nextProfile);
    await serverRulesService.publishServerRules(guild).catch(()=>null);
    return interaction.update({ embeds:[serverRulesService.buildRulesLiveEmbed(nextProfile)], components:serverRulesService.buildRuleSelectRows(nextProfile) });
  }

  if (cid === 'server_rules_publish_now') {
    if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
    const profile = serverRulesService.getProfile();
    await serverRulesService.publishServerRules(guild).catch(()=>null);
    return interaction.update({ embeds:[serverRulesService.buildRulesLiveEmbed(profile)], components:serverRulesService.buildRuleSelectRows(profile) });
  }

  if (cid.startsWith('toggle_active_check::')) {
    if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
    const leagueId = cid.split('::')[1];
    const league = activeLeagueService.getLeague(leagueId);
    if (!league) return interaction.reply({ content:'❌ League not found.', flags:64 });
    const svc = require('../services/leagueFeatureService');
    const res = await svc.toggleActiveCheckForLeague(guild, league, _state);
    return interaction.reply({ content: res.enabled ? `✅ Active check enabled for **${league.leagueName}**. It will ping league members every 4 days with a 48-hour reply window.` : `✅ Active check disabled for **${league.leagueName}**.`, flags:64 });
  }

  // ── Offense buttons ──
  if (cid.startsWith('offense_')) {
    if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
    const [,action,...rest] = cid.split('_');
    const offenseId = rest.join('_');
    let offense = _state.pendingOffenses.get(offenseId);
    if (!offense) {
      const dbOffense = await loadPendingOffenseFromDb(guild.id, offenseId);
      if (dbOffense && String(dbOffense.status || 'pending') === 'pending') {
        offense = {
          userId: dbOffense.userId,
          channelId: dbOffense.channelId,
          msgId: dbOffense.messageId,
          type: dbOffense.offenseType,
          reasoning: dbOffense.reasoning,
          teamName: dbOffense.teamName,
          ts: dbOffense.createdAt ? new Date(dbOffense.createdAt).getTime() : Date.now(),
        };
      }
    }
    if (!offense) return interaction.reply({content:'⚠️ Offense already processed.',flags:64});
    _state.pendingOffenses.delete(offenseId);
    const disabled = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`offense_warn_${offenseId}`).setLabel('⚠️ Warn').setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId(`offense_boot_${offenseId}`).setLabel('🥾 Boot').setStyle(ButtonStyle.Danger).setDisabled(true),
      new ButtonBuilder().setCustomId(`offense_dismiss_${offenseId}`).setLabel('❌ Dismiss').setStyle(ButtonStyle.Secondary).setDisabled(true),
    );
    await interaction.update({components:[disabled]}).catch(()=>null);
    if (action==='dismiss') {
      await updatePendingOffenseStatus(guild.id, offenseId, 'dismissed', interaction.user.id);
      return interaction.followUp({content:`✅ Offense #${offenseId} dismissed.`,flags:64});
    }
    const OFFENSE_TYPES = {QUIT:{label:'Quit/Close App',warnField:'closeAppWarnings'},GAMEPLAY:{label:'Gameplay Violation',warnField:'warnings'},INACTIVITY:{label:'Inactivity',warnField:'inactivityWarnings'},CHEAT:{label:'Cheating',warnField:'warnings'}};
    const offInfo = OFFENSE_TYPES[offense.type]||OFFENSE_TYPES.GAMEPLAY;
    const member  = await guild.members.fetch(offense.userId).catch(()=>null);
    const player  = findPlayerByUserId(offense.userId, _state.players);
    if (action==='warn' && player) {
      player[offInfo.warnField] = (player[offInfo.warnField]||0)+1;
      const count = player[offInfo.warnField];
      const warnCh = _getCh(guild,'warningsLog');
      if (warnCh) await warnCh.send({embeds:[new EmbedBuilder().setColor(0xffa500).setTitle(`⚠️ Warning — ${offInfo.label}`)
        .addFields({name:'Player',value:member?`${member}`:`<@${offense.userId}>`,inline:true},{name:'Team',value:offense.teamName,inline:true},{name:'Count',value:`${count}/3`,inline:true},{name:'Violation',value:offInfo.label},{name:'Evidence',value:offense.reasoning})
        .setFooter({text:count>=3?'⚠️ 3 STRIKES — consider removal':`${3-count} remaining`}).setTimestamp()]}).catch(()=>null);
      if (member) await member.send(`⚠️ Warning in ${resolveServerName(guild, 'this server')} for **${offInfo.label}**. Count: ${count}/3.`).catch(()=>null);
      await updatePendingOffenseStatus(guild.id, offenseId, 'warned', interaction.user.id);
      return interaction.followUp({content:`✅ Warning issued — <@${offense.userId}> count: ${count}/3.`,flags:64});
    }
    if (action==='boot' && member && canBotModerate(member)) {
      const bootCh = _getCh(guild,'bootLog');
      if (bootCh) await bootCh.send({embeds:[new EmbedBuilder().setColor(0x8b0000).setTitle('🥾 Player Booted')
        .addFields({name:'Player',value:`${member}`,inline:true},{name:'Team',value:offense.teamName,inline:true},{name:'Violation',value:offInfo.label},{name:'Evidence',value:offense.reasoning}).setTimestamp()]}).catch(()=>null);
      await guild.members.kick(member.id,`${offInfo.label}: ${offense.reasoning}`).catch(()=>null);
      await updatePendingOffenseStatus(guild.id, offenseId, 'booted', interaction.user.id);
      return interaction.followUp({content:`🥾 <@${offense.userId}> booted.`,flags:64});
    }
    return interaction.followUp({content:'⚠️ Could not take action.',flags:64});
  }

  // ── Boost buttons ──
  if (cid.startsWith('boost_approve_')||cid.startsWith('boost_deny_')) {
    if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
    const approved = cid.startsWith('boost_approve_');
    const boostId  = cid.replace(/^boost_(approve|deny)_/,'');
    const boost = _state.pendingAttrBoosts.get(boostId);
    if (!boost) return interaction.reply({content:'⚠️ Boost already processed.',flags:64});
    _state.pendingAttrBoosts.delete(boostId);
    const attrsText = boost.attr2?`+2 ${boost.attr1}  |  +2 ${boost.attr2}`:`+2 ${boost.attr1}`;
    const disabled = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`boost_approve_${boostId}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId(`boost_deny_${boostId}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger).setDisabled(true),
    );
    await interaction.update({components:[disabled]}).catch(()=>null);
    const requester = await guild.members.fetch(boost.userId).catch(()=>null);
    if (requester) await requester.send(approved?`✅ Boost **APPROVED** — **${boost.player}** (${boost.teamName}): ${attrsText}. Apply in-game.`:`❌ Boost **DENIED** — **${boost.player}** (${boost.teamName}). Contact commissioner.`).catch(()=>null);
    if (approved) {
      const devCh = _getCh(guild,'devUpgrades');
      if (devCh) await devCh.send({embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Attribute Boost Approved')
        .addFields({name:'Player',value:boost.player,inline:true},{name:'Team',value:boost.teamName,inline:true},{name:'Attributes',value:attrsText,inline:true},{name:'Source',value:boost.sourceLabel,inline:true},{name:'Approved by',value:`${interaction.user}`,inline:true}).setTimestamp()]}).catch(()=>null);
    }
    return interaction.followUp({content:approved?`✅ Boost approved — **${boost.player}** gets **${attrsText}**.`:`❌ Boost denied — **${boost.player}**. Player notified.`,flags:64});
  }

  // ── Trade buttons ──
  if (cid.startsWith('trade_approve_')||cid.startsWith('trade_decline_')) {
    if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
    const approved = cid.startsWith('trade_approve_');
    const tradeId  = cid.replace(/^trade_(approve|decline)_/,'');
    const tradeDecision = require('../services/tradeWorkflowService').decide(_state, tradeId, { approved, actorId:interaction.user.id });
    if (!tradeDecision.ok) return interaction.reply({content:'⚠️ Trade already processed.',flags:64});
    const trade = tradeDecision.trade;
    const destCh = _getCh(guild, approved?'acceptedTrades':'declinedTrades');
    const embed = new EmbedBuilder().setColor(approved?0x2ecc71:0xe74c3c).setTitle(approved?'✅ TRADE APPROVED':'❌ TRADE DECLINED')
      .addFields({name:'Trade ID',value:tradeId,inline:true},{name:'Proposing',value:`${trade.proposerTeam} (${trade.proposerBase})`,inline:true},{name:'Target',value:`${trade.targetTeam} (${trade.targetBase})`,inline:true},{name:'Details',value:trade.details},{name:'Decision By',value:`${interaction.user}`}).setTimestamp();
    if (destCh) await destCh.send({content:approved?'@everyone':undefined,embeds:[embed],allowedMentions:approved?{parse:['everyone']}:{}}).catch(()=>null);
    const proposerM = await guild.members.fetch(trade.proposerId).catch(()=>null);
    const targetEntry = _state.openTeamRegistry.find(t=>norm(t.baseTeam)===norm(trade.targetBase) && String(t.leagueId || '')===String(trade.leagueId || ''));
    const targetM = targetEntry?.ownerId?await guild.members.fetch(targetEntry.ownerId).catch(()=>null):null;
    if (proposerM||targetM) {
      const mentions = [proposerM,targetM].filter(Boolean).map(m=>`${m}`).join(' ');
      await interaction.channel.send({content:`${mentions} — Trade **${tradeId}** has been **${approved?'APPROVED ✅':'DECLINED ❌'}**.`,allowedMentions:{users:[proposerM?.id,targetM?.id].filter(Boolean)}}).catch(()=>null);
    }
    const disabled = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`trade_approve_${tradeId}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId(`trade_decline_${tradeId}`).setLabel('❌ Decline').setStyle(ButtonStyle.Danger).setDisabled(true),
    );
    await interaction.update({components:[disabled]}).catch(()=>null);
  }

  // ── Rejoin buttons (previously kicked member) ──
  if (cid.startsWith('rejoin_')) {
    if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
    const [, action, odid] = cid.match(/^rejoin_(allow|kick|ban)_(\d+)$/) || [];
    if (!action || !odid) return interaction.reply({content:'⚠️ Invalid button.',flags:64});

    const disabled = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rejoin_allow_${odid}`).setLabel('✅ Let Them Stay').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId(`rejoin_kick_${odid}`).setLabel('🥾 Kick').setStyle(ButtonStyle.Danger).setDisabled(true),
      new ButtonBuilder().setCustomId(`rejoin_ban_${odid}`).setLabel('🔨 Ban').setStyle(ButtonStyle.Danger).setDisabled(true),
    );
    await interaction.update({components:[disabled]}).catch(()=>null);

    const targetMember = await guild.members.fetch(odid).catch(() => null);
    const { canBotModerate } = require('../utils/helpers');
    const ledger = memberLedgerService;

    if (action === 'allow') {
      ledger.getRecord(odid).notes.push({ text: `Allowed to stay by ${interaction.user.tag}`, timestamp: Date.now() });
      return interaction.followUp({ content: `✅ **<@${odid}> is allowed to stay.** The commissioner has spoken. Don't make them regret it.`, flags:64 });
    }
    if (action === 'kick') {
      if (!targetMember) return interaction.followUp({content:'⚠️ Member already left.',flags:64});
      if (!canBotModerate(targetMember)) return interaction.followUp({content:'⚠️ Cannot kick — they have higher permissions than the bot.',flags:64});
      const bootCh = _getCh(guild, 'bootLog');
      if (bootCh) await bootCh.send({embeds:[new EmbedBuilder().setColor(0xff4500).setTitle('🥾 Returning Member Kicked')
        .setDescription(`**${targetMember.user.tag}** was kicked upon return by ${interaction.user}.`)
        .setTimestamp()]}).catch(()=>null);
      await guild.members.kick(odid, `Returning kicked member — commissioner declined re-entry`).catch(()=>null);
      return interaction.followUp({ content: `🥾 **${targetMember.user.tag}** has been kicked. Don't let the door hit you on the way out.`, flags:64 });
    }
    if (action === 'ban') {
      if (!targetMember) return interaction.followUp({content:'⚠️ Member already left.',flags:64});
      const bootCh = _getCh(guild, 'bootLog');
      if (bootCh) await bootCh.send({embeds:[new EmbedBuilder().setColor(0x8b0000).setTitle('🔨 Returning Member Permanently Banned')
        .setDescription(`**${targetMember.user.tag}** was permanently banned upon return by ${interaction.user}.`)
        .setTimestamp()]}).catch(()=>null);
      await guild.members.ban(odid, { reason: `Permanently banned — commissioner declined re-entry` }).catch(()=>null);
      ledger.recordBan(odid, 'Commissioner declined re-entry after returning', interaction.user.id);
      return interaction.followUp({ content: `🔨 **${targetMember.user.tag}** is permanently banned and added to the ban list. Use \`/ban list\` to view all bans or \`/ban remove user-id:${odid}\` to reverse.`, flags:64 });
    }
  }
}


async function _handleModal(interaction) {
  const guild = interaction.guild;
  const cid = interaction.customId;
  const isComm = () => isAdminMember(interaction.member, COMM_ROLE, _dynamicCommissioners());

// Edit Bot Message modal submission
if (cid.startsWith('bot_msg_edit_modal_')) {
  if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags:64 }).catch(() => null);
  const targetMsgId = cid.replace('bot_msg_edit_modal_', '');
  const newContent = interaction.fields.getTextInputValue('edited_content') || '';
  try {
    const ch = interaction.channel;
    const targetMsg = await ch.messages.fetch(targetMsgId).catch(() => null);
    if (!targetMsg) return interaction.reply({ content: '❌ Could not find the original message.', flags:64 }).catch(() => null);
    const botId = guild?.members?.me?.id || interaction.applicationId;
    if (targetMsg.author?.id !== botId) return interaction.reply({ content: '❌ Can only edit bot messages.', flags:64 }).catch(() => null);
    await targetMsg.edit({ content: newContent, embeds: [] });
    return interaction.reply({ content: '✅ Message updated.', flags:64 }).catch(() => null);
  } catch (err) {
    log.error('Edit bot message failed:', err.message, err.stack);
    return interaction.reply({ content: safeUserError(err, '❌ Edit failed. Check the logs and try again.'), flags:64 }).catch(() => null);
  }
}

if (cid === 'timezone_onboarding_modal') {
  const result = await _saveMemberTimezoneAndSync(interaction.member, interaction.fields.getTextInputValue('timezone'), { channelId: interaction.channelId, advanceWizard: true });
  if (!result.ok) return interaction.reply({ content:'❌ Invalid timezone. Use a real timezone like America/Los_Angeles, America/New_York, PST, EST, or UTC.', flags:64 });
  const welcomeCh = guild.channels.cache.find(c => c.isTextBased?.() && c.name === 'welcome');
  return interaction.reply({ content:`✅ Timezone saved as **${result.timezone}** (${result.label}).${welcomeCh ? ` Start in <#${welcomeCh.id}>.` : ''}`, flags:64 });
}

if (cid === 'bot_identity_modal') {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  await interaction.deferReply({ flags:64 }).catch(() => null);
  const botName = interaction.fields.getTextInputValue('bot_name');
  const avatarUrl = interaction.fields.getTextInputValue('avatar_url');
  serverSettings.setBotIdentity({ botName, avatarMode: avatarUrl ? 'url' : 'server_image', avatarUrl: avatarUrl || null });
  await botIdentityService.applyBotIdentity(_client, guild).catch(() => null);
  const setupCh = await _ensureSetupWizardChannel(guild, { reveal: true }).catch(() => null);
  if (setupCh) await _ensureSetupWizardStarterMessage(setupCh, 'Bot identity changed live.').catch(() => null);
  return interaction.deleteReply().catch(() => null);
}

  if (cid === 'server_rules_modal') {
    if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags:64 });
    const numbersRaw = interaction.fields.getTextInputValue('rule_numbers');
    const overridesRaw = interaction.fields.getTextInputValue('overrides');
    const customText = interaction.fields.getTextInputValue('custom_text');
    const current = serverRulesService.getProfile();
    const parsed = serverRulesService.parseRuleSelection(numbersRaw, overridesRaw, customText);
    const profile = {
      ...current,
      selected: parsed.selected.length ? parsed.selected : current.selected,
      customText: parsed.customText || current.customText || '',
    };
    serverRulesService.saveProfile(profile);
    await serverRulesService.publishServerRules(guild).catch(() => null);
    await _postSetupWizardMessage(guild, 'Server rules updated and wizard preview refreshed.').catch(() => null);
    return interaction.reply({ embeds:[serverRulesService.buildRulesLiveEmbed(profile)], flags:64 });
  }

  if (cid.startsWith('join_')) {
    const { handleJoinModal } = joinLeagueService;
    return handleJoinModal(interaction, _state, guild, leagueVisibility.grantMemberAccessToLeague);
  }
}

// ── Slash Commands ────────────────────────────────────────────
async function _handleCommand(interaction, commandMeta = null) {
  const guild  = interaction.guild;
  const isComm = () => isAdminMember(interaction.member, COMM_ROLE, _dynamicCommissioners());

  const vpResult = commandMeta || await validationPipeline.validate(interaction, { state: _state, guild, isComm: isComm() });
  if (!vpResult.ok) {
    return interaction.reply({ content: vpResult.reason, flags: 64 }).catch(() => null);
  }
  log.info(`[cmd] ${interaction.commandName} class=${vpResult.commandClass || 'unknown'} user=${interaction.user?.id}`);

  // ── 6-Layer Hierarchy Enforcement ──────────────────────────────────────
  if (!isComm()) { // hierarchy checks apply to non-commissioners
    try {
      const hierarchy = hierarchyService;
      const communityAccess = communityAccessService;
      const settings = serverSettings.getSettings();
      const communities = communityAccess.getAvailableCommunities(settings);
      const check = hierarchy.checkCommandHierarchy(
        interaction.commandName, interaction.member, settings, communities
      );
      if (!check.allowed) {
        const iconMap = { BOT_KILLED:'🛑', INSTALL_MODE:'⚙️', NO_TEMPLATE:'🏗️', NO_COMMUNITIES:'🧩', TEAMS_NOT_ENABLED:'🏆', TIMEZONE_GATE:'🕒' };
        const icon = iconMap[check.code] || '⚠️';
        return interaction.reply({ content: `${icon} ${check.reason}`, flags:64 }).catch(() => null);
      }
    } catch (_e) { /* hierarchy failures non-fatal */ }
  }
  const cmd    = interaction.commandName;
  const activeLeagueCount = activeLeagueService.listResetOptions(_state).length;

  if (_guardInstallationModeCommand(interaction)) return;
  const subserverOnly = new Set(['create-game','respond','report-result','release-team','open-teams','refresh-open-teams','set-stat-leaders','player-of-the-week','potw-confirm','retract-score']);
  if (subserverOnly.has(cmd) && !activeLeagueCount) {
    return interaction.reply({ content:'⚠️ No active league or managed sub-server exists yet. Finish server setup first, then create a league, event, or other managed space before using this action.', flags:64 });
  }

  const scopedCommands = new Set(['create-game','report-result','retract-score','game-channels','schedule-import','schedule-load-week','advance-week','player-of-the-week','potw-confirm','yearly-award','superbowl-champion','attr-award','set-stat-leaders','register-team','release-team','set-team-identity','add-open-team','remove-open-team','set-team-logo','open-teams','refresh-open-teams','streams','stream-board']);
  if (activeLeagueCount > 1 && scopedCommands.has(cmd) && !require('../league/spaceContext').current()) return interaction.reply({content:'Run this command inside the intended private league channel.',flags:64});

  switch (cmd) {
    // ── Admin management ──
    case 'add-admin': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const target = interaction.options.getUser('user');
      _state.commissionerIds.add(target.id);
      const logCh = _getCh(guild,'adminHq')||_getCh(guild,'warningsLog');
      if (logCh) await logCh.send({embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('👑 Admin Promoted').setDescription(`${interaction.user} promoted ${target} to commissioner.`).setTimestamp()]}).catch(()=>null);
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Admin Added').addFields({name:'User',value:`${target}`,inline:true}).setTimestamp()]});
    }
    case 'remove-admin': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const target = interaction.options.getUser('user');
      _state.commissionerIds.delete(target.id);
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0xe74c3c).setTitle('✅ Admin Removed').setDescription(`${target} removed.`).setTimestamp()]});
    }


    case 'process-builder': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const sub = interaction.options.getSubcommand();
      if (sub === 'create') {
        const created = processBuilderService.createProcess({
          name: interaction.options.getString('name'),
          preset: interaction.options.getString('preset'),
          trigger: interaction.options.getString('trigger'),
          description: interaction.options.getString('description'),
          enabled: interaction.options.getBoolean('enabled') !== false,
        });
        if (!created.ok) {
          return interaction.reply({ content: `❌ ${created.errors.join(' ')}`, flags:64 });
        }
        const def = created.definition;
        return interaction.reply({
          flags:64,
          embeds:[new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('🧩 Managed Process Created')
            .setDescription(`**${def.name}** is now part of the process builder.`)
            .addFields(
              { name:'Preset', value:def.preset, inline:true },
              { name:'Trigger', value:def.trigger, inline:true },
              { name:'Steps', value:String(def.steps.length), inline:true },
              { name:'Comment Guard', value:(def.commentPolicy?.headers || []).join(', ').slice(0, 1024), inline:false },
            )
            .setFooter({ text:'Every managed process now carries required comment scaffolding for future edits.' })
            .setTimestamp()],
        });
      }
      if (sub === 'list') {
        const summary = processManagementService.buildProcessSummary();
        const lines = summary.items.length
          ? summary.items.map(item => `• **${item.name}** — ${item.enabled ? 'ON' : 'OFF'} • ${item.stepCount} steps${item.hasCommentPolicy ? '' : ' • missing comment policy'}`)
          : ['No managed processes defined yet.'];
        return interaction.reply({ flags:64, embeds:[new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🗂️ Process Builder')
          .setDescription(lines.join('\n').slice(0, 4000))
          .addFields({ name:'Presets', value: summary.presets.map(p => `${p.label} (${p.stepCount})`).join('\n').slice(0,1024) || 'None', inline:false })
          .setTimestamp()]});
      }
      if (sub === 'inspect') {
        const def = processManagementService.buildInspectableDefinition(interaction.options.getString('name'));
        if (!def) return interaction.reply({ content:'❌ Process not found.', flags:64 });
        return interaction.reply({ flags:64, embeds:[new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`🔎 ${def.name}`)
          .setDescription(def.description || 'No description saved.')
          .addFields(
            { name:'Preset', value:def.preset, inline:true },
            { name:'Trigger', value:def.trigger, inline:true },
            { name:'Enabled', value:def.enabled ? 'Yes' : 'No', inline:true },
            { name:'Steps', value:def.steps.map(step => `${step.order}. ${step.label} → ${step.action}`).join('\n').slice(0,1024) || 'None', inline:false },
            { name:'Comment Headers', value:(def.commentPolicy?.headers || []).join(', ').slice(0,1024) || 'Missing', inline:false },
          )
          .setTimestamp()]});
      }
      if (sub === 'toggle') {
        const result = processBuilderService.toggleProcess(interaction.options.getString('name'), interaction.options.getBoolean('enabled'));
        if (!result.ok) return interaction.reply({ content:`❌ ${result.error}`, flags:64 });
        return interaction.reply({ content:`${result.definition.enabled ? '✅' : '🛑'} Process **${result.definition.name}** is now ${result.definition.enabled ? 'enabled' : 'disabled'}.`, flags:64 });
      }
      if (sub === 'delete') {
        const removed = processBuilderService.deleteProcess(interaction.options.getString('name'));
        if (!removed.ok) return interaction.reply({ content:`❌ ${removed.error}`, flags:64 });
        return interaction.reply({ content:`🧹 Removed managed process **${removed.removed.name}**.`, flags:64 });
      }
      return interaction.reply({ content:'⚠️ Unsupported process-builder action.', flags:64 });
    }

    case 'process-run': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      await interaction.deferReply({ flags:64 }).catch(() => null);
      const result = await processBuilderService.runProcess(interaction.options.getString('name'), { guild, client, state: _state });
      if (!result.ok) {
        return interaction.editReply({ content:`❌ ${result.error || 'Process run failed.'}` });
      }
      const lines = result.results.map(item => `• ${item.step} — ${item.status}`).join('\n');
      return interaction.editReply({ embeds:[new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`⚙️ Process Run Complete: ${result.definition.name}`)
        .setDescription(lines.slice(0, 4000) || 'No steps ran.')
        .setFooter({ text:'Managed processes use declarative steps plus comment scaffolding for future edits.' })
        .setTimestamp()]});
    }

    case 'setup-server': {
      // Alias for setup-wizard-start — /setup-server is the user-facing command
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      try {
        // wizardPrefs is already available from the outer scope
        wizardStateService.patch({ installationMode: true, currentStep: 'mode', lastAdvancedAt: Date.now() });
        wizardPrefs.savePrefs({ wizardStage: 'mode' });
        const setupCh = await _ensureSetupWizardChannel(guild, { reveal: true }).catch(() => null);
        await _ensureSetupWizardStarterMessage(setupCh, 'Setup wizard opened.').catch(() => null);
        return interaction.reply({ content: `🛠️ Setup wizard is open in ${setupCh ? `<#${setupCh.id}>` : `\`${_setupWizardFallbackText()}\``}.`, flags:64 });
      } catch (err) {
        return interaction.reply({ content: safeUserError(err, '❌ Failed to open the setup wizard. Check the logs and try again.'), flags:64 });
      }
    }

    case 'edit-community': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const currentName = interaction.options.getString('name');
      const newName = interaction.options.getString('new-name');
      const newType = interaction.options.getString('type');
      const settings = serverSettings.getSettings();
      const communities = Array.isArray(settings.communities) ? [...settings.communities] : [];
      const idx = communities.findIndex(c => c.name.toLowerCase() === currentName.toLowerCase());
      if (idx === -1) return interaction.reply({ content: `❌ Community **${currentName}** not found. Use /list-communities.`, flags:64 });
      const updated = { ...communities[idx] };
      if (newName) updated.name = newName;
      if (newType) updated.type = newType;
      communities[idx] = updated;
      serverSettings.saveSettings({ ...settings, communities });
      return interaction.reply({ flags:64, embeds: [new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('✏️ Community Updated')
        .addFields(
          { name: 'Name', value: updated.name, inline: true },
          { name: 'Type', value: updated.type, inline: true },
        )
        .setFooter({ text: 'Channel names and roles were not renamed — use /delete-community and /setup-community to rebuild.' })
        .setTimestamp()
      ]});
    }

    case 'delete-community': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const targetName = interaction.options.getString('name');
      const confirmed = interaction.options.getBoolean('confirm');
      if (!confirmed) return interaction.reply({ content: '⚠️ Pass `confirm: true` to delete a community. This is permanent.', flags:64 });
      await interaction.deferReply({ flags:64 }).catch(() => null);
      try {
        const settings = serverSettings.getSettings();
        const before = Array.isArray(settings.communities) ? settings.communities : [];
        const after = before.filter(c => c.name.toLowerCase() !== targetName.toLowerCase());
        if (before.length === after.length) {
          return interaction.editReply({ content: `❌ Community **${targetName}** not found.` });
        }
        const { deleteCommunityChannels } = spaceAutoGenService;
        await deleteCommunityChannels(guild, targetName);
        serverSettings.saveSettings({ ...settings, communities: after });
        return interaction.editReply({ content: `✅ Community **${targetName}** and all its channels and roles have been removed.` });
      } catch (err) {
        return interaction.editReply({ content: safeUserError(err, '❌ Delete failed. Check the logs and try again.') });
      }
    }

    case 'setup-event': {
      if (!isComm()) return interaction.reply({content:'Commissioners only.',flags:64});
      const name=interaction.options.getString('name');
      const action=interaction.options.getString('action') || 'create';
      await interaction.deferReply({flags:64});
      if(action==='create') {
        const event=await require('../services/eventSpaceService').create(guild,{name,description:interaction.options.getString('description')||'',commissionerRoleId:_state.leagueConfig.commissionerRoleId||null});
        return interaction.editReply(`Private event **${event.leagueName}** created. Use setup-event action:add-member to add participants. ID: ${event.id}`);
      }
      const event=activeLeagueService.listEvents({ guildId:guild.id }).find(x=>x.id===name||x.leagueName===name);
      if(!event)return interaction.editReply('Select the exact event name or ID.');
      const user=interaction.options.getUser('user');
      if(action==='add-member'||action==='remove-member') {
        if(!user)return interaction.editReply('Select a member.');
        if(action==='add-member')await leagueVisibility.grantMemberAccessToLeague(guild,await guild.members.fetch(user.id),_state,event.id);
        else await leagueVisibility.revokeMemberAccess(guild,user.id,event.id);
        return interaction.editReply(`Event membership ${action==='add-member'?'added':'removed'}.`);
      }
      if(action==='erase') {
        if(interaction.options.getString('confirm')!==event.leagueName)return interaction.editReply('Enter the exact event name in confirm to erase it.');
        await leagueSetupService.deleteLeagueStructure(guild,{leagueId:event.id,categoryIds:event.builtCategoryIds,channelIds:event.builtChannelIds});
        activeLeagueService.removeLeague(event.id);
        await require('../services/managedSpaceService').transition(guild.id,event.id,'ARCHIVED');
        return interaction.editReply('Event erased. Lifetime member history retained.');
      }
      return interaction.editReply(`**${event.leagueName}** — private event, ${event.id}`);
    }

    case 'setup-team': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const teamName = interaction.options.getString('name');
      const communityName = interaction.options.getString('community');
      const settings = serverSettings.getSettings();
      const communities = Array.isArray(settings.communities) ? settings.communities : [];
      const community = communities.find(c => c.name.toLowerCase() === communityName.toLowerCase());
      if (!community) return interaction.reply({ content: `❌ Community **${communityName}** not found.`, flags:64 });
      const leagueFriendlyTypes = ['league', 'league-enabled', 'competitive'];
      if (!leagueFriendlyTypes.includes(community.type)) {
        return interaction.reply({ content: `❌ **${communityName}** is type **${community.type}** — teams only exist in league-enabled communities. Use /toggle-team-mode to change it first.`, flags:64 });
      }
      await interaction.deferReply({ flags:64 }).catch(() => null);
      try {
        const teamsSpace = require('../services/teamsSpaceService');
        const { COMM_ROLE } = require('../config/env');
        const commRole = guild.roles.cache.find(r => r.name === COMM_ROLE || r.id === COMM_ROLE);
        const result = await teamsSpace.createTeamSpace(guild, teamName, commRole?.id);
        if (!result) return interaction.editReply({ content: `❌ Failed to create team space for **${teamName}**.` });
        const teams = Array.isArray(settings.teams) ? [...settings.teams] : [];
        teams.push({ name: teamName, communityName, roleId: result.role?.id, createdAt: Date.now() });
        serverSettings.saveSettings({ ...settings, teams });
        return interaction.editReply({ content: `✅ Team **${teamName}** created with a private team space (🏟️ ${teamName}). Use /join-league to assign members to teams.` });
      } catch (err) {
        return interaction.editReply({ content: safeUserError(err, '❌ Team setup failed. Check the logs and try again.') });
      }
    }

    case 'hierarchy-status': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      try {
        const hierarchy = hierarchyService;
        const communityAccess = communityAccessService;
        const settings = serverSettings.getSettings();
        const communities = communityAccess.getAvailableCommunities(settings);
        const summary = hierarchy.buildHierarchySummary(settings, communities);
        const ok = v => v ? '✅' : '❌';
        return interaction.reply({ flags:64, embeds:[new EmbedBuilder()
          .setColor(summary.serverInitialized ? 0x2ecc71 : 0xffa500)
          .setTitle('🏗️ Server Hierarchy Status')
          .addFields(
            { name: 'Structure',        value: ok(!!summary.structureMode) + ' ' + (summary.structureMode || 'not set'), inline: true },
            { name: 'Template',         value: ok(summary.templateSet) + ' ' + (settings.serverTemplate || (summary.structureMode === 'base' ? 'not used' : summary.structureMode === 'custom' ? `${settings.customTemplateSelections?.length || 0} selected` : 'not set')), inline: true },
            { name: 'Subtemplate',      value: ok(summary.subtemplateSet) + ' ' + (settings.serverSubtemplate || 'none'), inline: true },
            { name: 'Initialized',      value: ok(summary.serverInitialized), inline: true },
            { name: 'Communities',      value: ok(summary.communitiesExist) + ' ' + communities.length + ' defined', inline: true },
            { name: 'Community type',   value: summary.communityType, inline: true },
            { name: 'Teams enabled',    value: ok(summary.teamsEnabled), inline: true },
            { name: 'Timezone gate',    value: (summary.timezoneGateActive ? '✅ ON' : '❌ OFF') + (summary.timezoneGateAllowed ? '' : ' (blocked — setup not complete)'), inline: true },
            { name: 'Wizard stage',     value: summary.wizardStage, inline: true },
            { name: 'Bot status',       value: summary.botStatus, inline: true },
          )
          .setFooter({ text: 'Structure → optional template/subtemplate → Community Type → Communities → Spaces → Events / Leagues / Teams' })
          .setTimestamp()
        ]});
      } catch (err) {
        return interaction.reply({ content:safeUserError(err, '❌ Hierarchy check failed. Check the logs and try again.'), flags:64 });
      }
    }

    case 'setup-community': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const settings = serverSettings.getSettings();
      const structureError = hierarchyService.checkTemplateBeforeCommunity(settings);
      if (structureError) {
        return interaction.reply({ content:`🏗️ ${structureError}`, flags:64 });
      }
      const communityName = interaction.options.getString('name');
      const communityType = interaction.options.getString('type') || 'social';
      const communities = Array.isArray(settings.communities) ? [...settings.communities] : [];
      if (communities.some(c => c.name.toLowerCase() === communityName.toLowerCase())) {
        return interaction.reply({ content:`⚠️ A community named **${communityName}** already exists.`, flags:64 });
      }
      await interaction.deferReply({ flags:64 }).catch(() => null);
      try {
        // Auto-generate channels — users never hear the word "spaces"
        const spaceAutoGen = spaceAutoGenService;
        const { COMM_ROLE } = require('../config/env');
        const commRole = guild.roles.cache.find(r => r.name === COMM_ROLE || r.id === COMM_ROLE);
        const generated = await spaceAutoGen.generateCommunityChannels(guild, communityName, communityType, commRole?.id);
        communities.push({ name: communityName, type: communityType, createdAt: Date.now(), roleId: generated?.role?.id });
        serverSettings.saveSettings({ ...settings, communities });
        const teamsAllowed = ['league', 'league-enabled', 'competitive'].includes(communityType);
        const channelList = generated?.channels?.length
          ? generated.channels.map(c => `#${c}`).join(', ')
          : 'channels created';
        return interaction.editReply({ embeds:[new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle(`✅ ${communityName} Created`)
          .addFields(
            { name: 'Type', value: communityType, inline: true },
            { name: 'Teams', value: teamsAllowed ? '✅ League-enabled' : '➖ N/A', inline: true },
            { name: 'Channels created', value: channelList, inline: false },
          )
          .setFooter({ text: 'Members choose communities via #community-selector. Use /edit-community to modify.' })
          .setTimestamp()
        ]});
      } catch (err) {
        return interaction.editReply({ content: safeUserError(err, '❌ Community creation failed. Check the logs and try again.') });
      }
    }

    case 'list-communities': {
      const settings = serverSettings.getSettings();
      const communities = Array.isArray(settings.communities) ? settings.communities : [];
      if (!communities.length) {
        return interaction.reply({ content:'No communities have been created yet. Use `/setup-community` to create one.', flags:64 });
      }
      return interaction.reply({ flags:64, embeds:[new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🧩 Server Communities')
        .setDescription(communities.map(c => `• **${c.name}** — ${c.type}${['league','competitive'].includes(c.type) ? ' (teams enabled)' : ''}`).join('\n'))
        .setFooter({ text: `${communities.length} community/communities defined` })
        .setTimestamp()
      ]});
    }

    case 'toggle-team-mode': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const settings = serverSettings.getSettings();
      const targetName = interaction.options.getString('community');
      const newMode = interaction.options.getString('mode');
      const communities = Array.isArray(settings.communities) ? [...settings.communities] : [];
      const idx = communities.findIndex(c => c.name.toLowerCase() === targetName.toLowerCase());
      if (idx === -1) return interaction.reply({ content:`❌ Community **${targetName}** not found. Use /list-communities.`, flags:64 });
      communities[idx] = { ...communities[idx], type: newMode };
      serverSettings.saveSettings({ ...settings, communities });
      const hierarchy = hierarchyService;
      const teamsNow = hierarchy.teamsAllowedForCommunityType(newMode);
      return interaction.reply({ flags:64, content:`✅ **${targetName}** is now **${newMode}**. Teams: ${teamsNow ? 'ENABLED ✅' : 'NOT ENABLED ❌'}` });
    }

    case 'lock-bot-access': {
      if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags:64 });
      await interaction.deferReply({ flags:64 }).catch(() => null);
      try {
        const botAccess = botAccessService;
        const { COMM_ROLE } = require('../config/env');
        const commRole = guild.roles.cache.find(r => r.name === COMM_ROLE || r.id === COMM_ROLE);
        const isAdmin = botAccess.checkBotGuildAdmin(guild);
        const fixed = await botAccess.lockBotAccessGuildWide(guild, commRole?.id);
        const adminStatus = isAdmin ? '✅ Administrator' : '⚠️ No Administrator (grant Administrator role to bot)';
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(isAdmin ? 0x2ecc71 : 0xffa500)
            .setTitle('🔒 Bot Access Lock Applied')
            .addFields(
              { name: 'Guild-level permissions', value: adminStatus, inline: false },
              { name: 'Channels fixed', value: `${fixed} channel(s) had missing bot permissions — re-applied.`, inline: false },
              { name: 'Commissioner role', value: commRole ? `<@&${commRole.id}>` : 'Not found (set COMM_ROLE in env)', inline: false },
            )
            .setFooter({ text: 'This runs automatically on startup and after every server build.' })
            .setTimestamp()],
        });
      } catch (err) {
        log.error('lock-bot-access failed:', err.message);
        return interaction.editReply({ content: safeUserError(err, '❌ Lock failed. Check permissions and try again.') }).catch(() => null);
      }
    }

    case 'list-admins': {
      const commRole = COMM_ROLE?guild.roles.cache.get(COMM_ROLE):null;
      const roleMembers = commRole?[...commRole.members.values()].map(m=>`${m} — via role`):[];
      const dynamic = [..._state.commissionerIds].map(id=>`<@${id}> — via /add-admin`);
      const owner = guild.ownerId?[`<@${guild.ownerId}> — server owner`]:[];
      const seen=new Set(), all=[...roleMembers,...dynamic,...owner].filter(line=>{const k=line.match(/<@!?(\d+)>/)?.[1];if(!k||seen.has(k))return false;seen.add(k);return true;});
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x3498db).setTitle('👑 Commissioner & Admin List').setDescription(all.length?all.join('\n'):'No admins configured.').setTimestamp()]});
    }

    case 'join-league': {
      const { sendJoinLeaguePrompt } = joinLeagueService;
      const requestedLeague = interaction.options.getString('league');
      return sendJoinLeaguePrompt(interaction, _state, requestedLeague);
    }

    // ── Teams ──
    
case 'register-team': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const leagueInput = interaction.options.getString('league');
      const teamName = interaction.options.getString('team');
      const user = interaction.options.getUser('user');
      const member = await guild.members.fetch(user.id).catch(()=>null);
      if (!member) return interaction.reply({content:'❌ Could not find member.',flags:64});
      const result = await teamAssignmentUseCase.assignTeam({ guild, member, leagueId:leagueInput, team:teamName, source:'slash:register-team' });
      if (!result.success) return interaction.reply({content:`❌ ${result.reason}`,flags:64});
      try { teamRegistry.syncFromState(_state); } catch {}
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Team Registered').addFields({name:'League',value:result.league.leagueName || result.league.id,inline:true},{name:'Team',value:result.entry.displayTeam,inline:true},{name:'Owner',value:`${user}`,inline:true}).setTimestamp()]});
    }

    case 'select-team': {
      const leagueInput = interaction.options.getString('league');
      const teamName = interaction.options.getString('team');
      const timezoneInput = interaction.options.getString('timezone');
      const resolved = leagueResolver.resolveLeague(leagueInput, { guildId:guild.id, mode:'joinable' });
      if (!resolved.ok) return interaction.reply({ content:`❌ ${resolved.message}`, flags:64 });
      const selectedLeague = resolved.league;

      await interaction.deferReply({ flags:64 });
      if (!teamName || teamName === '_none_') return interaction.editReply({ content:'❌ Choose an available team in that league.' });
      const savedTimezone = memberProfiles.getProfile(interaction.user.id)?.timezone || null;
      const timezone = normalizeTimezone(timezoneInput || savedTimezone);
      if (!timezone) return interaction.editReply({ content:'❌ Choose a timezone first with `/set-timezone`, or provide one in this command. Your team claim will not be finalized until scheduling timezone is known.' });

      const result = await teamAssignmentUseCase.assignTeam({ guild, member:interaction.member, league:selectedLeague, team:teamName, timezone, source:'slash:select-team' });
      if (!result.success) {
        const userLeagues = openTeamsService.getUserLeagues(interaction.user.id);
        const extra = userLeagues.length ? '\n\n**Your current teams:**\n' + userLeagues.map(l => `• **${l.team}** in ${l.leagueName}`).join('\n') : '';
        return interaction.editReply({ content:`❌ ${result.reason}${extra}` });
      }
      const emoji = getTeamEmoji(guild, result.entry.baseTeam) || '';
      try { teamRegistry.syncFromState(_state); } catch {}
      return interaction.editReply({ embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle(`✅ You're now the ${emoji} ${result.entry.displayTeam}!`.trim()).setDescription(`**League:** ${selectedLeague.leagueName}\n**Timezone:** ${nicknamePolicy.timezoneLabel(timezone) || timezone}\n\nYour league access and scheduling profile are ready.`).setThumbnail(result.entry.logoUrl || null).setTimestamp()] });
    }

    case 'release-team': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const leagueInput = interaction.options.getString('league');
      const teamName = interaction.options.getString('team');
      const result = await teamAssignmentUseCase.releaseTeam({ guild, leagueId:leagueInput, team:teamName, source:'slash:release-team' });
      if (!result.success) return interaction.reply({content:`⚠️ ${result.reason}`,flags:64});
      await openTeamsService.announceTeamOpen(guild, result.entry, 'released by the commissioner');
      try { teamRegistry.syncFromState(_state); } catch {}
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0xf39c12).setTitle('🏟 Team Released').addFields({name:'League',value:result.league.leagueName || result.league.id,inline:true},{name:'Team',value:result.entry.displayTeam,inline:true},{name:'Status',value:'✅ Now Open',inline:true}).setTimestamp()]});
    }

    case 'open-teams': {
      const { buildOpenTeamsEmbeds } = openTeamsService;
      return interaction.reply({embeds:buildOpenTeamsEmbeds(guild),flags:64});
    }
    case 'active-leagues': {
      const rows = activeLeagueService.listOperationalLeagues({ guildId:guild.id });
      if (!rows.length) return interaction.reply({ content:'No active leagues are configured.', flags:64 });
      const lines = rows.map(l => `• **${l.leagueName || l.id}** — ${l.status}${l.game ? ` • ${String(l.game).toUpperCase()}` : ''}\n  ID: \`${l.id}\``);
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle('🏟 Active Leagues').setDescription(lines.join('\n').slice(0,3900)).setFooter({text:'ACTIVE leagues are joinable. PAUSED leagues remain visible but cannot accept new team claims.'}).setTimestamp()], flags:64 });
    }
    case 'refresh-open-teams': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const { refreshOpenTeamsBoard } = openTeamsService;
      await refreshOpenTeamsBoard(guild);
      return interaction.reply({content:'✅ Open teams board refreshed.',flags:64});
    }
    case 'set-team-identity': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const leagueInput = interaction.options.getString('league');
      const resolved = leagueResolver.resolveLeague(leagueInput, { guildId:guild.id, mode:'operational' });
      if (!resolved.ok) return interaction.reply({ content:`❌ ${resolved.message}`, flags:64 });
      const league = resolved.league;
      const orig = interaction.options.getString('original-team');
      const location = interaction.options.getString('location');
      const name = interaction.options.getString('name');
      const user = interaction.options.getUser('user');
      const display = buildDisplayTeam(location,name,orig);
      const key = `${league.id}::${norm(orig)}`;
      const existing = _state.players.get(key);
      const reg = _state.openTeamRegistry.find(t => String(t.leagueId || '') === String(league.id) && norm(t.baseTeam) === norm(orig));
      if (!existing && !reg) return interaction.reply({ content:`❌ Team slot **${orig}** was not found in **${league.leagueName || league.id}**.`, flags:64 });
      _state.players.set(key,{...existing,userId:user?.id||existing?.userId||reg?.ownerId||null,team:key,baseTeam:orig,customLocation:location,customName:name,displayTeam:display,leagueId:league.id,streamCount:existing?.streamCount||0,streamLog:existing?.streamLog||[],warnings:existing?.warnings||0,closeAppWarnings:existing?.closeAppWarnings||0,inactivityWarnings:existing?.inactivityWarnings||0});
      if (reg) { reg.displayTeam=display; reg.leagueName=league.leagueName || reg.leagueName; await openTeamsService.refreshOpenTeamsBoard(guild); }
      try { teamRegistry.syncFromState(_state); } catch {}
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x3498db).setTitle('✅ League Team Identity Updated').setDescription('This changes the team identity inside this league only. It does not change the member’s Discord server nickname.').addFields({name:'League',value:league.leagueName || league.id,inline:true},{name:'Slot',value:orig,inline:true},{name:'New Name',value:display,inline:true}).setTimestamp()]});
    }

    case 'add-open-team': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const leagueInput = interaction.options.getString('league');
      const resolved = leagueResolver.resolveLeague(leagueInput, { guildId:guild.id, mode:'operational' });
      if (!resolved.ok) return interaction.reply({ content:`❌ ${resolved.message}`, flags:64 });
      const league = resolved.league;
      const base=interaction.options.getString('base-team'), disp=interaction.options.getString('display-team'), replaces=interaction.options.getString('replaces-team')||null, logo=interaction.options.getString('logo-url')||null;
      const exists = _state.openTeamRegistry.find(t=>String(t.leagueId||'')===String(league.id) && norm(t.baseTeam)===norm(base));
      if (exists) return interaction.reply({content:`⚠️ **${base}** already exists in **${league.leagueName || league.id}**.`,flags:64});
      const validLogo = logo&&/^https?:\/\/.+/i.test(logo)?logo:null;
      _state.openTeamRegistry.push({baseTeam:base,displayTeam:disp,logoUrl:validLogo,isOpen:true,ownerId:null,leagueId:league.id,leagueName:league.leagueName || league.id,replacementFor:replaces||null,isCustomTeam:!!replaces});
      await openTeamsService.refreshOpenTeamsBoard(guild);
      try { teamRegistry.syncFromState(_state); } catch {}
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Team Added').addFields({name:'League',value:league.leagueName || league.id,inline:true},{name:'Slot',value:base,inline:true},{name:'Display',value:disp,inline:true},{name:'Replacing',value:replaces||'—',inline:true}).setThumbnail(validLogo).setTimestamp()]});
    }

    case 'remove-open-team': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const leagueInput = interaction.options.getString('league');
      const resolved = leagueResolver.resolveLeague(leagueInput, { guildId:guild.id, mode:'operational' });
      if (!resolved.ok) return interaction.reply({ content:`❌ ${resolved.message}`, flags:64 });
      const league = resolved.league;
      const teamInput = interaction.options.getString('team');
      const idx=_state.openTeamRegistry.findIndex(t=>String(t.leagueId||'')===String(league.id) && (norm(t.baseTeam)===norm(teamInput)||norm(t.displayTeam)===norm(teamInput)));
      if (idx===-1) return interaction.reply({content:`⚠️ Team not found in **${league.leagueName || league.id}**.`,flags:64});
      const removed=_state.openTeamRegistry.splice(idx,1)[0];
      await openTeamsService.refreshOpenTeamsBoard(guild);
      try { teamRegistry.syncFromState(_state); } catch {}
      return interaction.reply({content:`✅ **${removed.displayTeam}** removed from **${league.leagueName || league.id}**.`,flags:64});
    }

    // ── Rules ──

    // ── Rules ──
case 'schedule-export-current': {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  const payload = scheduleRegistryService.exportCurrentWeek(_state);
  const name = `nofunleague_schedule_current_week_${payload.currentWeek || 'none'}.json`;
  return interaction.reply({
    content: `📦 Exported current stored week schedule${payload.currentWeek ? ` (Week ${payload.currentWeek})` : ''}.`,
    files: [{ attachment: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'), name }],
    flags:64,
  });
}
case 'schedule-export-all': {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  const payload = scheduleRegistryService.exportAllWeeks(_state);
  const name = `nofunleague_schedule_all_weeks.json`;
  return interaction.reply({
    content: `📦 Exported all stored schedule weeks (**${Object.keys(payload.weeks || {}).length}** weeks).`,
    files: [{ attachment: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'), name }],
    flags:64,
  });
}
case 'schedule-import': {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  await interaction.deferReply({flags:64});
  const file = interaction.options.getAttachment('file');
  const source = interaction.options.getString('source') || 'import';
  if (!file?.url) return interaction.editReply('⚠️ Attach a JSON or CSV file to import.');
  const reg = await scheduleRegistryService.importAttachmentUrl(file.url, file.name || '', { source });
  const weeks = scheduleRegistryService.listWeeks();
  return interaction.editReply(
    `✅ Imported schedule data from **${file.name || 'attachment'}**.\n` +
    `• Source: **${source}**\n` +
    `• Stored weeks: **${weeks.length}**\n` +
    `• Current week: **${reg.currentWeek ?? 'N/A'}**\n` +
    `• Teams tracked: **${(reg.teams || []).length}**`
  );
}
case 'schedule-load-week': {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  await interaction.deferReply({flags:64});
  const week = interaction.options.getInteger('week');
  const games = scheduleRegistryService.loadWeekIntoState(_state, week);
  if (!games || !games.length) {
    return interaction.editReply(`⚠️ No stored schedule found for Week **${week}**.`);
  }
  const { postScheduleEmbed, startScheduleTimer } = hubReleaseService;
  await postScheduleEmbed(guild,_state,_getCh,getTeamEmoji);
  startScheduleTimer(guild,_state,_getCh,getTeamEmoji);
  const auto = await weeklyAutomationService.runAdvanceAutomation(guild, _state, _state.players).catch(() => ({ ran:false, cleared:0, created:0 }));
  const autoNote = auto.ran
    ? `\n🤖 Auto game channels: cleared **${auto.cleared}**, created **${auto.created}**.`
    : `\n🛠 Weekly channel mode: **${weeklyAutomationService.getWeeklySettings().mode}**.`;
  return interaction.editReply(`✅ Loaded stored Week **${week}** into the live schedule.${autoNote}`);
}
case 'schedule-registry-status': {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  const reg = scheduleRegistryService.getRegistry();
  const weeks = scheduleRegistryService.listWeeks();
  return interaction.reply({
    content:
      `📚 Schedule registry status\n` +
      `• Source: **${reg.source || 'local'}**\n` +
      `• Stored weeks: **${weeks.length}**\n` +
      `• Current week: **${reg.currentWeek ?? 'N/A'}**\n` +
      `• Teams tracked: **${(reg.teams || []).length}**\n` +
      `• Last import: **${reg.lastImportAt ? `<t:${Math.floor(reg.lastImportAt/1000)}:R>` : 'N/A'}**\n` +
      `• Last export: **${reg.lastExportAt ? `<t:${Math.floor(reg.lastExportAt/1000)}:R>` : 'N/A'}**`,
    flags:64,
  });
}
case 'league-data-ingest': {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  await interaction.deferReply({flags:64});
  const attachment = interaction.options.getAttachment('file');
  const target = interaction.options.getString('target') || 'auto';
  if (!attachment?.url) return interaction.editReply('⚠️ Attach a readable league file first.');
  const fileIntakeService = require('../services/fileIntakeService');
  try {
    const result = await fileIntakeService.importLeagueDataFromAttachment(attachment, { aiCall: _aiCall, MODELS: _MODELS, state: _state, target });
    const applied = result.applied.applied.length ? result.applied.applied.join(' • ') : 'Saved for later use.';
    const notes = result.applied.notes.length ? `\n• Notes: ${result.applied.notes.join(' | ')}` : '';
    return interaction.editReply(
      `📥 Imported **${attachment.name || 'attachment'}** as **${result.applied.chosen}** data.\n` +
      `• File kind: **${result.parsed.kind}**\n` +
      `• Applied: ${applied}${notes}`
    );
  } catch (err) {
    return interaction.editReply(safeUserError(err, '❌ Import failed. Check the logs and try again.'));
  }
}

case 'set-league-source-mode': {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  const mode = interaction.options.getString('mode');
  const saved = liveSync.saveLiveSyncConfig({ sourceMode: mode });
  return interaction.reply({
    content:
      `✅ League source mode updated.\n` +
      `• Mode: **${saved.sourceMode}**\n` +
      `• Custom bot-managed leagues keep built-in schedule generation and condensed seasons.\n` +
      `• External sync leagues use the import/sync pipeline.`,
    flags:64,
  });
}
case 'set-live-sync': {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  await interaction.deferReply({flags:64});

  const actions = require('../services/providerConnectionActionService');
  const pcs = require('../services/providerConnectionService');
  const providerService = require('../services/providerService');
  const provider = interaction.options.getString('provider');
  const endpointUrl = interaction.options.getString('endpoint-url');
  const autoSyncOnTrigger = interaction.options.getBoolean('auto-sync-on-trigger');
  const loadCurrentWeekIntoLiveSchedule = interaction.options.getBoolean('load-current-week');
  const runWeeklyAutomationAfterSync = interaction.options.getBoolean('run-weekly-automation');
  const connectionAction = interaction.options.getString('connection-action') || 'configure';
  const externalLeagueId = interaction.options.getString('external-league-id');
  const providerSecret = interaction.options.getString('provider-secret');
  const resourceConfigRaw = interaction.options.getString('resource-config-json');

  const leagueId = actions.resolveLeagueId();
  if (!leagueId) {
    return interaction.editReply('❌ I cannot safely determine which league to configure. Run this from a league-scoped channel, or make only one league active, then try again.');
  }

  if (provider === 'off') {
    activeLeagueService.setDataSourceMode(leagueId, 'custom_bot_managed');
    // Per-league source mode is authoritative. Do not clear the legacy global provider here because another league may still use it.
    // Keep configured connections dormant so a commissioner can reconnect without losing setup.
    liveSync.saveLiveSyncConfig({ sourceMode:'custom_bot_managed', provider:'off' });
    return interaction.editReply(
      `✅ External live sync is **OFF** for league **${leagueId}**.\n` +
      `• Source mode: **custom_bot_managed**\n` +
      `• Existing provider connections were preserved but are not authoritative until reactivated.`
    );
  }

  let resourceConfig = {};
  if (resourceConfigRaw) {
    try {
      const parsed = JSON.parse(resourceConfigRaw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be a JSON object');
      resourceConfig = (provider === 'neonsportz' && !parsed.resourceUrls) ? { resourceUrls: parsed } : parsed;
    } catch (e) {
      return interaction.editReply(`❌ Resource config JSON is invalid: ${String(e.message || e).slice(0,140)}`);
    }
  }

  const existing = pcs.getConnection(leagueId, provider);
  const priorCfg = existing?.config || {};
  const config = {
    ...priorCfg,
    ...resourceConfig,
    ...(autoSyncOnTrigger != null ? { autoSyncOnTrigger } : {}),
    ...(loadCurrentWeekIntoLiveSchedule != null ? { loadCurrentWeekIntoLiveSchedule } : {}),
    ...(runWeeklyAutomationAfterSync != null ? { runWeeklyAutomationAfterSync } : {}),
  };

  let out;
  const actionArgs = {
    leagueId,
    provider,
    endpointUrl: endpointUrl != null ? endpointUrl.trim() : undefined,
    externalLeagueId: externalLeagueId != null ? externalLeagueId.trim() : undefined,
    secret: providerSecret !== null ? providerSecret : undefined,
    config,
  };

  if (connectionAction === 'configure') {
    out = await actions.configure(actionArgs).catch(e => ({ok:false,reason:e.message}));
  } else {
    const fn = actions[connectionAction];
    if (typeof fn !== 'function') return interaction.editReply(`❌ Unknown connection action: ${connectionAction}`);
    out = await fn(actionArgs).catch(e => ({ok:false,reason:e.message}));
  }
  if (!out?.ok) return interaction.editReply(`❌ Provider connection **${connectionAction}** failed: **${out?.reason || 'unknown error'}**`);

  // Legacy liveSync.json remains a compatibility mirror only. It must not demote the authoritative connection state.
  if (connectionAction === 'activate') {
    liveSync.saveLiveSyncConfig({
      sourceMode:'external_sync', provider,
      endpointUrl: out.connection?.endpointUrl || existing?.endpointUrl || '',
      autoSyncOnTrigger: !!(out.connection?.config?.autoSyncOnTrigger ?? config.autoSyncOnTrigger),
      loadCurrentWeekIntoLiveSchedule: (out.connection?.config?.loadCurrentWeekIntoLiveSchedule ?? config.loadCurrentWeekIntoLiveSchedule) !== false,
      runWeeklyAutomationAfterSync: (out.connection?.config?.runWeeklyAutomationAfterSync ?? config.runWeeklyAutomationAfterSync) !== false,
    });
  } else if (connectionAction === 'disconnect' || connectionAction === 'fallback') {
    liveSync.saveLiveSyncConfig({ sourceMode:'custom_bot_managed', provider:'off' });
  }

  const current = pcs.getConnection(leagueId, provider) || out.connection || existing;
  const tokenNote = out.receiverUrl
    ? `\n• Receiver URL: **${out.receiverUrl}**\n  Save this URL now. Newly generated receiver tokens are shown only once.`
    : '';
  const healthNote = out.health
    ? `\n• Health: **${out.health.healthy === false ? 'UNHEALTHY' : out.health.ok ? 'HEALTHY' : 'CHECKED'}**`
    : '';
  const sourceMode = activeLeagueService.getDataSourceMode(leagueId);
  const secretNote = providerSecret !== null ? '\n• Provider credential: **ENCRYPTED/SAVED**' : '';

  return interaction.editReply(
    `✅ Provider connection **${connectionAction}** completed.\n` +
    `• League: **${leagueId}**\n` +
    `• Provider: **${provider}**\n` +
    `• Connection state: **${current?.status || 'unknown'}**\n` +
    `• Health: **${current?.healthStatus || 'unknown'}**\n` +
    `• Source mode: **${sourceMode}**` + secretNote + tokenNote + healthNote
  );
}
case 'live-sync-status': {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  const cfg = liveSync.getLiveSyncConfig();
  const full = await require('../services/leagueSyncService').getSyncStatus().catch(() => null);
  const last = cfg.lastSyncAt ? `<t:${Math.floor(cfg.lastSyncAt/1000)}:R>` : 'N/A';
  const connections = full?.connections || [];
  const connectionLines = connections.length ? connections.map(c => `• ${c.providerKey}: **${c.status}** / health **${c.healthStatus}**${c.fallbackMode==='manual'?' / manual fallback':''}`).join('\n') : '• No league-scoped provider connections yet.';
  return interaction.reply({
    content:
      `📡 Live sync status\n` +
      `• Source mode: **${cfg.sourceMode}**\n` +
      `• Effective provider: **${cfg.provider}**\n` +
      `• Last sync: **${last}**\n` +
      `• Last status: **${cfg.lastSyncStatus || 'idle'}**\n` +
      `\n**Authoritative league connections**\n${connectionLines}`,
    flags:64,
  });
}
case 'live-sync-now': {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  await interaction.deferReply({flags:64});
  try {
    const { postScheduleEmbed, startScheduleTimer } = hubReleaseService;
    const result = await require('../services/leagueSyncService').syncNow(guild, _state, {
      postScheduleEmbed,
      startScheduleTimer,
      getCh: _getCh,
      getTeamEmoji,
      trigger: 'slash-live-sync-now',
    });
    if (!result.ok) {
      return interaction.editReply(
        `⚠️ Live sync did not run. Reason: **${result.reason}**.\n` +
        `Check source mode, provider, and endpoint settings.`
      );
    }
    if (result.mode === 'import-provider') {
      return interaction.editReply(`✅ Processed **${result.processed || 0}** queued import(s) from **${result.provider}**. Sync run: **${result.syncRunId}**.`);
    }
    const autoNote = result.auto?.ran
      ? `\n🤖 Weekly automation: cleared **${result.auto.cleared}**, created **${result.auto.created}**.`
      : '';
    return interaction.editReply(
      `✅ Live sync completed.\n` +
      `• Provider: **${result.provider}**\n` +
      `• Stored weeks: **${result.storedWeeks}**\n` +
      `• Current week: **${result.currentWeek ?? 'N/A'}**\n` +
      `• Tracked teams: **${result.trackedTeams}**` +
      autoNote
    );
  } catch (err) {
    const cfg = liveSync.getLiveSyncConfig();
    liveSync.saveLiveSyncConfig({
      lastSyncAt: Date.now(),
      lastSyncStatus: `error: ${err.message}`,
      lastSyncSummary: null,
    });
    return interaction.editReply(safeUserError(err, '❌ Live sync failed. Check the logs and try again.'));
  }
}

case 'team-registry-status': {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  const reg = teamRegistry.syncFromState(_state);
  const claimed = (reg.teams || []).filter(t => !t.isOpen).length;
  const open = (reg.teams || []).filter(t => t.isOpen).length;
  const leagues = new Set((reg.teams || []).map(t => t.leagueId || 'default'));
  return interaction.reply({
    content:
      `📋 Team registry status\n` +
      `• Total teams tracked: **${(reg.teams || []).length}**\n` +
      `• Open teams: **${open}**\n` +
      `• Claimed teams: **${claimed}**\n` +
      `• League buckets: **${leagues.size}**\n` +
      `• Last synced: **${reg.lastSyncedAt ? `<t:${Math.floor(reg.lastSyncedAt/1000)}:R>` : 'N/A'}**`,
    flags:64,
  });
}

    case 'post-standings': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const raw=interaction.options.getString('standings'), week=_state.hubWeeklyData.week||'?';
      const rows=raw.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>`> ${l}`).join('\n');
      const embed=new EmbedBuilder().setColor(0x9b59b6).setTitle(`🏆 Week ${week} — Standings`).setDescription(rows).setTimestamp();
      const announceCh=_getCh(guild,'announcements');
      if (announceCh) await announceCh.send({embeds:[embed]}).catch(()=>null);
      return interaction.reply({content:'✅ Standings posted.',flags:64});
    }
    case 'post-nfl-news': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      await interaction.deferReply({flags:64});
      const { postNFLUpdates } = hubReleaseService;
      await postNFLUpdates(guild,_getCh,_aiCall,_MODELS);
      return interaction.editReply('✅ NFL news posted to #nfl-updates.');
    }
    case 'send-welcome': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const target=interaction.options.getUser('user'), openCount=_state.openTeamRegistry.filter(t=>t.isOpen).length;
      try {
        const _wSettings = serverSettings.getSettings();
        const _wProfile = templateLogic.getTemplateProfile(_wSettings);
        const _guideChName = templateLogic.getGuideChannelName(_wSettings);
        const _wDesc = _wProfile?.leagueFriendly && openCount > 0
          ? `Glad to have you.\n\n> 1. Read \`#rules\`\n> 2. Check \`#open-teams\` — **${openCount} team(s) available**\n> 3. Use \`/select-team\` to claim a team\n\nQuestions? Tag a commissioner.`
          : `Glad to have you.\n\n> 1. Read \`#rules\` for server conduct\n> 2. Read \`#${_guideChName}\` to understand how ${_wProfile?.name || 'this server'} is set up\n> 3. Pick your communities in \`#community-selector\` if available\n\nQuestions? Tag a commissioner.`;
        await target.send({embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle(`👋 Welcome to ${resolveServerName(guild, 'this server')}!`).setDescription(_wDesc).setTimestamp()]});
        return interaction.reply({content:`✅ Welcome DM sent to **${target.tag}**.`,flags:64});
      } catch { return interaction.reply({content:`⚠️ Could not DM **${target.tag}** — DMs may be disabled.`,flags:64}); }
    }
    case 'retract-score': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const rWeek=interaction.options.getInteger('week');
      const normT=s=>(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
      const t1=normT(interaction.options.getString('team1')), t2=normT(interaction.options.getString('team2'));
      // V202: retract the authoritative record first (reverses standings if applied), then the legacy projection.
      const gameResultService = require('../league/gameResultService');
      const authoritative = await gameResultService.retractGameResult({ week: rWeek, team1: interaction.options.getString('team1'), team2: interaction.options.getString('team2') }, { state: _state });
      const before=_state.ocrGameResults.length;
      const kept=_state.ocrGameResults.filter(r=>{const rk=[r.week,normT(r.team1),normT(r.team2)].join(':');return rk!==`${rWeek}:${t1}:${t2}`&&rk!==`${rWeek}:${t2}:${t1}`;});
      _state.ocrGameResults.length=0; kept.forEach(r=>_state.ocrGameResults.push(r));
      const removed=Math.max(before-kept.length, authoritative.ok ? authoritative.removed : 0);
      return interaction.reply({content:removed>0?`✅ Cleared ${removed} entry for Week ${rWeek}.`:`⚠️ No entry found for Week ${rWeek}. Check team names.`,flags:64});
    }
    case 'post-server-guide': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      await interaction.deferReply({flags:64});

      const path = require('path');
      const fs   = require('fs');

      // The two PDF files live in the bot root /files/ directory
      const MEMBER_PDF = path.join(__dirname, '..', '..', 'files', 'nofunleague_member_guide.pdf');
      const FULL_PDF   = path.join(__dirname, '..', '..', 'files', 'nofunleague_full_guide.pdf');

      if (!fs.existsSync(MEMBER_PDF) || !fs.existsSync(FULL_PDF)) {
        return interaction.editReply('❌ PDF files not found. Place `nofunleague_member_guide.pdf` and `nofunleague_full_guide.pdf` in the `files/` folder.');
      }

      // Post member guide to the correct guide channel (league-guide or server-guide based on template)
      const _plgSettings = serverSettings.getSettings();
      const _plgGuideName = templateLogic.getGuideChannelName ? templateLogic.getGuideChannelName(_plgSettings) : 'server-guide';
      const guideCh = guild.channels.cache.find(c => c.isTextBased?.() && (c.name === _plgGuideName || c.name === 'server-guide'));
      if (guideCh) {
        // Replace only previous member-guide bot posts in #server-guide
        const prev = await guideCh.messages.fetch({ limit: 20 }).catch(() => null);
        if (prev) {
          const botMsgs = prev.filter(m => m.author.id === _client.user.id && m.embeds?.some(e => /Member & Bot Guide/i.test(e.title || '')));
          for (const [, m] of botMsgs) await m.delete().catch(() => null);
        }
        await guideCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle(`📖 ${resolveServerName(guild, 'this server')} — Member & Bot Guide`)
            .setDescription(
              '**Everything you need to know as a member.**\n\n' +
              '> 📄 **Pages 8–9** of the full bot reference\n' +
              '> Covers: what the bot does automatically, your slash commands, the AI assistant, stream rewards, and what to expect\n\n' +
              'For trade proposals, attribute boosts, or stream rewards — the guide below explains it all.'
            )
            .setFooter({ text: 'Full commissioner guide available in admin channels.' })
            .setTimestamp()],
          files: [new AttachmentBuilder(MEMBER_PDF, { name: `${resolveServerName(guild, 'server').replace(/[^a-z0-9_-]+/gi,'_')}_Member_Guide.pdf` })],
        }).catch(() => null);
      }

      // Post full guide to #admin-hq — commissioner only
      const adminCh = _getCh(guild, 'adminHq');
      if (adminCh) {
        await adminCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(`📋 ${resolveServerName(guild, 'this server')} — Full Bot Reference (Commissioner Edition)`)
            .setDescription(
              '**All 9 pages. Pages 1–7 are commissioner-only.**\n\n' +
              '> 🔒 Pages 1–7: Full commissioner powers, setup wizard, moderation, awards, AI natural language\n' +
              '> ✅ Pages 8-9: Bot behaviors + member guide (same as what is in #server-guide)\n\n' +
              'Keep this pinned here for quick reference.'
            )
            .setFooter({ text: 'Commissioner eyes only — this channel is locked to members.' })
            .setTimestamp()],
          files: [new AttachmentBuilder(FULL_PDF, { name: `${resolveServerName(guild, 'server').replace(/[^a-z0-9_-]+/gi,'_')}_Full_Commissioner_Guide.pdf` })],
        }).catch(() => null);
      }

      const posted = [];
      if (guideCh) posted.push(`✅ Member guide (pages 8–9) → ${guideCh}`);
      if (adminCh) posted.push(`✅ Full guide (all 9 pages) → ${adminCh}`);
      const _awSettings = serverSettings.getSettings();
      const _awGuideName = templateLogic.getGuideChannelName ? templateLogic.getGuideChannelName(_awSettings) : 'server-guide';
      if (!guideCh) posted.push('⚠️ #' + _awGuideName + ' channel not found — create it or run /setup-server to rebuild');
      if (!adminCh) posted.push('⚠️ #admin-hq channel not found');

      return interaction.editReply(posted.join('\n'));
    }


    case 'manual': {
      const section = interaction.options.getString('section');
      if (section && section !== 'overview') {
        return interaction.reply({ embeds: manualService.buildSectionEmbeds(section, isComm()), flags:64 });
      }
      const attachment = manualService.getManualAttachment();
      const payload = { embeds: manualService.buildOverviewEmbeds(isComm()), flags:64 };
      if (attachment) payload.files = [attachment];
      if (attachment && !interaction.deferred && !interaction.replied) await interaction.deferReply({ flags:64 }).catch(() => null);
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => interaction.followUp(payload).catch(() => null));
      return interaction.reply(payload);
    }

    case 'manual-server': {
      // manualService loaded above
      return interaction.reply({ embeds: manualService.buildSectionEmbeds('server', isComm()), flags:64 });
    }

    case 'manual-league': {
      // manualService loaded above
      return interaction.reply({ embeds: manualService.buildSectionEmbeds('league', isComm()), flags:64 });
    }

    case 'manual-setup': {
      // manualService loaded above
      return interaction.reply({ embeds: manualService.buildSectionEmbeds('setup', isComm()), flags:64 });
    }

    case 'manual-commands': {
      // manualService loaded above
      return interaction.reply({ embeds: manualService.buildSectionEmbeds('commands', isComm()), flags:64 });
    }

    case 'manual-actions': {
      // manualService loaded above
      return interaction.reply({ embeds: manualService.buildSectionEmbeds('actions', isComm()), flags:64 });
    }



case 'setup-bot':
case 'setup-wizard-start': {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  try {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '🛠️ Opening setup wizard…', flags: 64 }).catch(() => null);
    }
    wizardStateService.patch({ installationMode: true, currentStep: 'mode', lastAdvancedAt: Date.now() });
    wizardPrefs.savePrefs({ wizardStage: 'mode' });
    const ch = await _postSetupWizardMessage(guild, 'Choose a structure strategy and server template to begin.', { stage: 'mode' });
    await recoverySelfHealService.healPatchNotes(guild, patchNotesService).catch(() => null);
    await patchNotesService.publishPatchNotes(guild).catch(() => null);
    const msg = ch ? `🛠️ Setup wizard is ready in <#${ch.id}>.` : `🛠️ Setup wizard opened in **${_setupWizardFallbackText()}**.`;
    if (interaction.replied || interaction.deferred) return interaction.editReply({ content: msg }).catch(() => null);
    return interaction.reply({ content: msg, flags:64 }).catch(() => null);
  } catch (err) {
    log.error('setup-wizard-start failed:', err.message, err.stack);
    const fallbackChannel = await _ensureSetupWizardChannel(guild, { reveal: true }).catch(() => null);
    wizardStateService.patch({ installationMode: true, currentStep: 'flow' });
    wizardPrefs.savePrefs({ wizardStage: 'flow' });
    await _ensureSetupWizardStarterMessage(fallbackChannel, 'The setup flow guide is ready in this lane.').catch(() => null);
    const msg = `❌ Setup wizard hit an error, but the setup lane is ready in ${fallbackChannel ? `<#${fallbackChannel.id}>` : `\`${_setupWizardFallbackText()}\``}.`;
    if (interaction.deferred || interaction.replied) return interaction.editReply({ content: msg }).catch(() => null);
    return interaction.reply({ content: msg, flags:64 }).catch(() => null);
  }
}


case 'fix-duplicates': {
  if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags: 64 });
  if (!interaction.deferred && !interaction.replied) await safeDeferred(interaction, { flags: 64 }).catch(() => null);

  const dryRun = interaction.options.getBoolean('dry-run') !== false; // default true

  try {
    await guild.channels.fetch().catch(() => null);

    // Group all categories by their normalised name (strip leading emoji/spaces)
    const normName = n => String(n || '').toLowerCase().replace(/^[^\w]+/, '').trim();
    const catGroups = new Map(); // normalisedName → [channel, ...]
    for (const ch of guild.channels.cache.values()) {
      if (ch.type !== ChannelType.GuildCategory) continue;
      const key = normName(ch.name);
      if (!catGroups.has(key)) catGroups.set(key, []);
      catGroups.get(key).push(ch);
    }

    const dupes = [...catGroups.values()].filter(g => g.length > 1);

    if (dupes.length === 0) {
      return interaction.editReply({ content: '✅ No duplicate categories found — server looks clean!', flags: 64 }).catch(() => null);
    }

    const lines = [];
    let mergedChannels = 0;
    let deletedCats = 0;

    for (const group of dupes) {
      // Winner = the one with the most channels (keep most populated)
      group.sort((a, b) => {
        const aCount = guild.channels.cache.filter(c => c.parentId === a.id).size;
        const bCount = guild.channels.cache.filter(c => c.parentId === b.id).size;
        return bCount - aCount;
      });
      const winner = group[0];
      const losers = group.slice(1);
      const winnerCount = guild.channels.cache.filter(c => c.parentId === winner.id).size;

      lines.push(`\n**${winner.name}** — keeping <#${winner.id}> (${winnerCount} ch)`);

      for (const loser of losers) {
        const loserChildren = guild.channels.cache.filter(c => c.parentId === loser.id);
        const loserCount = loserChildren.size;
        lines.push(`  ↳ Merging duplicate <#${loser.id}> (${loserCount} ch) → winner`);

        if (!dryRun) {
          // Move children to winner category
          for (const child of loserChildren.values()) {
            // Only move if winner doesn't already have a channel with this name
            const alreadyExists = guild.channels.cache.find(
              c => c.parentId === winner.id && normName(c.name) === normName(child.name)
            );
            if (!alreadyExists) {
              await child.setParent(winner.id, { lockPermissions: false, reason: 'V200 fix-duplicates: merging into canonical category' }).catch(() => null);
              mergedChannels++;
            } else {
              // V200 FIX: Delete duplicate child — winner already has this channel
              await child.delete('V200 fix-duplicates: duplicate channel removed').catch(() => null);
              lines.push(`    🗑 Deleted duplicate #${child.name} — winner already has it`);
              mergedChannels++;
            }
          }
          // Re-fetch to check if loser is now empty before deleting
          await guild.channels.fetch().catch(() => null);
          const remaining = guild.channels.cache.filter(c => c.parentId === loser.id).size;
          if (remaining === 0) {
            await loser.delete('V194 fix-duplicates: empty duplicate category removed').catch(() => null);
            deletedCats++;
          } else {
            lines.push(`    ⚠ Could not fully empty <#${loser.id}> — ${remaining} channel(s) remain, skipping delete`);
          }
        } else {
          mergedChannels += loserCount;
          deletedCats++;
        }
      }
    }

    const prefix = dryRun ? '🔍 **Dry Run** — no changes made\n' : `✅ **Done** — merged ${mergedChannels} channel(s), deleted ${deletedCats} empty categor${deletedCats === 1 ? 'y' : 'ies'}\n`;
    const suffix = dryRun ? '\n\nRun `/fix-duplicates dry-run:False` to apply these changes.' : '';
    const report = prefix + lines.join('\n') + suffix;

    // Discord message limit guard
    const chunks = [];
    let buf = '';
    for (const line of report.split('\n')) {
      if ((buf + '\n' + line).length > 1900) { chunks.push(buf); buf = line; }
      else buf += (buf ? '\n' : '') + line;
    }
    if (buf) chunks.push(buf);

    await interaction.editReply({ content: chunks[0], flags: 64 }).catch(() => null);
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk, flags: 64 }).catch(() => null);
    }
  } catch (err) {
    log.error('[fix-duplicates] error', err?.message);
    await interaction.editReply({ content: `❌ Error during duplicate scan: ${err?.message || 'unknown'}`, flags: 64 }).catch(() => null);
  }
  break;
}


case 'diagnose': {
  if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags: 64 });
  await interaction.deferReply({ flags: 64 }).catch(() => null);
  try {
    const diagnosticService = require('../services/diagnosticService');
    const diagnosis = await diagnosticService.runFullDiagnosis(guild, _getCh, _state, _client);
    const embed = diagnosticService.buildDiagnosticEmbed(diagnosis);

    // If there are issues, also ask the AI for plain-English analysis
    let aiAnalysis = null;
    if (diagnosis.issues.length > 0) {
      try {
        const awarenessBlock = await diagnosticService.buildAwarenessBlock(guild, _getCh, _state, _client);
        const { aiCall: _diagAiCall, MODELS: _diagMODELS } = require('../services/ai/anthropicService');
        const aiRes = await _diagAiCall({
          model: _diagMODELS.SMART,
          max_tokens: 500,
          system: `You are a Discord bot diagnostic module. You have access to live system telemetry. Your job: explain what is broken, why it matters, and the exact fix. Be direct. No filler. Lead with the most critical issue.\n\nLIVE DIAGNOSTIC DATA:\n${awarenessBlock}`,
          messages: [{ role: 'user', content: 'What is wrong with the bot right now? Give me a plain-English diagnosis and the fixes ranked by priority.' }],
        });
        aiAnalysis = String(aiRes?.content?.[0]?.text || '').trim();
      } catch {}
    }

    const replyPayload = { embeds: [embed] };
    if (aiAnalysis) {
      replyPayload.content = `**🤖 AI Analysis:**\n${aiAnalysis.slice(0, 1500)}`;
    }
    return interaction.editReply(replyPayload);
  } catch (err) {
    return interaction.editReply({ content: `❌ Diagnostic failed: ${err.message}` });
  }
}

case 'active-check-status': {
  if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags: 64 });
  const leagueFeatures = require('../services/leagueFeatureService');
  const activeLeagueService = require('../services/activeLeagueService');
  const leagueIdOpt = interaction.options.getString('league-id');
  const leagues = leagueIdOpt
    ? [{ id: leagueIdOpt, leagueName: leagueIdOpt }]
    : activeLeagueService.listOperationalLeagues();

  if (!leagues.length) return interaction.reply({ content: '⚠️ No active leagues found.', flags: 64 });

  const lines = [];
  for (const lg of leagues) {
    const status = leagueFeatures.getActiveCheckStatus(lg.id);
    lines.push(`**${lg.leagueName || lg.id}**`);
    lines.push(`  Enabled: ${status.enabled ? '✅' : '❌'}`);
    lines.push(`  Interval: ${status.intervalDays}d / Window: ${status.responseWindowHours}h`);
    if (status.lastPostedAt) lines.push(`  Last posted: <t:${Math.floor(status.lastPostedAt / 1000)}:R>`);
    if (status.windowEndsAt) lines.push(`  Window closes: <t:${Math.floor(status.windowEndsAt / 1000)}:R>`);
    lines.push(`  Responded this window: ${status.respondedCount}`);
    const misses = Object.entries(status.consecutiveMisses).filter(([, c]) => c > 0);
    if (misses.length) {
      lines.push('  **Consecutive misses:**');
      for (const [uid, count] of misses.sort((a, b) => b[1] - a[1])) {
        const icon = count >= 5 ? '🔴' : count >= 3 ? '🟠' : '🟡';
        lines.push(`    ${icon} <@${uid}> — ${count} miss${count !== 1 ? 'es' : ''}`);
      }
    } else {
      lines.push('  No consecutive misses tracked.');
    }
    lines.push('');
  }
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('📋 Active Check Status').setDescription(lines.join('\n').slice(0, 3900)).setTimestamp()], flags: 64 });
}

case 'toggle-feature': {
  if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags: 64 });
  const compReg = require('../services/componentRegistryService');
  const featureId = interaction.options.getString('feature');
  const enabled = interaction.options.getBoolean('enabled');
  const catalog = compReg.COMPONENT_CATALOG[featureId];
  if (!catalog) return interaction.reply({ content: `❌ Unknown feature: ${featureId}`, flags: 64 });

  if (enabled) {
    compReg.enableComponent(featureId);
    // Create dedicated channel if needed
    if (catalog.channelName) {
      const ch = await compReg.ensureComponentChannel(guild, featureId);
      if (ch) {
        return interaction.reply({ content: `✅ **${catalog.name}** enabled. Channel: <#${ch.id}>\nUse \`/post-component ${featureId}\` to post the interactive panel.`, flags: 64 });
      }
    }
    return interaction.reply({ content: `✅ **${catalog.name}** enabled.`, flags: 64 });
  } else {
    compReg.disableComponent(featureId);
    return interaction.reply({ content: `✅ **${catalog.name}** disabled. Channel preserved but interactions will be blocked.`, flags: 64 });
  }
}

case 'list-features': {
  if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags: 64 });
  const compReg = require('../services/componentRegistryService');
  const all = compReg.listAll();
  const categories = { server: [], community: [], league: [] };
  for (const c of all) {
    const cat = categories[c.category] || (categories.other = categories.other || []);
    (categories[c.category] || categories.other).push(c);
  }
  const lines = [];
  for (const [cat, items] of Object.entries(categories)) {
    if (!items.length) continue;
    lines.push(`\n**${cat.toUpperCase()}**`);
    for (const c of items) {
      lines.push(`${c.enabled ? '✅' : '❌'} **${c.name}** — ${c.description}`);
    }
  }
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🧩 Optional Features').setDescription(lines.join('\n').slice(0, 3900)).setFooter({ text: 'Use /toggle-feature to enable or disable.' }).setTimestamp()], flags: 64 });
}

case 'post-component': {
  if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags: 64 });
  const compReg = require('../services/componentRegistryService');
  const compId = interaction.options.getString('component');
  const week = interaction.options.getInteger('week') || _state.scheduleState?.week || 1;

  const guard = compReg.guardEnabled(compId);
  if (guard.blocked) return interaction.reply({ content: guard.message, flags: 64 });

  const ch = await compReg.ensureComponentChannel(guild, compId);
  if (!ch) return interaction.reply({ content: `⚠️ Could not find or create channel for **${compId}**. The component may not require a dedicated channel.`, flags: 64 });

  if (compId === 'mvp-voting') {
    const members = ((_state.openTeamRegistry || []).filter(t => t.ownerId)).map(t => ({ label: t.displayTeam || t.baseTeam || 'Unknown', value: String(t.ownerId) })).slice(0, 25);
    const embed = compReg.buildMvpVotingEmbed(week, members);
    const rows = members.length >= 2 ? buttonChoiceService.createChoiceRows({
      guildId:guild.id, public:true, flow:'mvp-vote', legacyCustomId:`comp_mvp::${week}`, minValues:1, maxValues:1, options:members, pageSize:15,
    }).rows : [];
    await sendMessageService.send(ch, { embeds: [embed], components: rows, allowedMentions: { parse: [] } }, { action: 'comp-mvp-panel' });
  } else if (compId === 'availability') {
    const embed = compReg.buildAvailabilityEmbed(week);
    const row = compReg.buildAvailabilityButtons();
    await sendMessageService.send(ch, { embeds: [embed], components: [row], allowedMentions: { parse: [] } }, { action: 'comp-availability-panel' });
  } else if (compId === 'rule-ack') {
    const rulesCh = _getCh(guild, 'rules') || ch;
    const row = compReg.buildRuleAckButton();
    await sendMessageService.send(rulesCh, { embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('📜 Rule Acknowledgment').setDescription('By clicking below, you confirm you have read and agree to follow the server rules.\n\nThis is required for full server access.').setTimestamp()], components: [row], allowedMentions: { parse: [] } }, { action: 'comp-rule-ack-panel' });
  } else if (compId === 'trade-block') {
    await sendMessageService.send(ch, { embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle('🔄 Trade Block').setDescription('Use the button below to update your trade block. Your listed players will appear on the board.').setTimestamp()], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('comp_trade_block_edit').setLabel('📝 Update My Trade Block').setStyle(ButtonStyle.Primary))], allowedMentions: { parse: [] } }, { action: 'comp-trade-block-panel' });
  } else if (compId === 'game-results') {
    await sendMessageService.send(ch, { embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('📊 Submit Game Result').setDescription('Click the button below to submit your game score. Results are logged automatically.').setTimestamp()], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('comp_game_result_submit').setLabel('🎮 Submit Result').setStyle(ButtonStyle.Primary))], allowedMentions: { parse: [] } }, { action: 'comp-game-result-panel' });
  } else if (compId === 'predictions') {
    const embed = compReg.buildPredictionBoard(week);
    await sendMessageService.send(ch, { embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`comp_predictions_start::${week}`).setLabel('🔮 Make Predictions').setStyle(ButtonStyle.Primary))], allowedMentions: { parse: [] } }, { action: 'comp-predictions-panel' });
  }

  return interaction.reply({ content: `✅ Posted **${compReg.COMPONENT_CATALOG[compId]?.name}** panel in <#${ch.id}>.`, flags: 64 });
}


case 'initialize-server': {
  if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
  if (!interaction.deferred && !interaction.replied) await safeDeferred(interaction, { flags:64 }).catch(() => null);
  const ackMode = interaction.deferred ? 'deferred' : interaction.replied ? 'replied' : 'reply';
  const lastTrashAt = Number(wizardStateService.getState().lastTrashAt || 0);
  if (lastTrashAt && (Date.now() - lastTrashAt) < 90_000) {
    return _updateLongInteraction(interaction, ackMode, { content: '⏳ A full reboot just ran moments ago. Wait a little and use the refreshed setup guide instead of firing another reboot.', flags:64 }).catch(() => null);
  }
  let statusCard = null;
  let bgJob = null;
  // Structural lock is owned by handleInteraction.
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: '🧹 Switching to installation mode…' }).catch(() => null);
    } else {
      await interaction.reply({ content: '🧹 Switching to installation mode…', flags: 64 }).catch(() => null);
    }
    bgJob = await backgroundJobService.createJob({
      guildId: guild.id,
      jobType: 'initialize-server',
      triggeredBy: interaction.user?.id,
      payload: { channelId: interaction.channelId },
      status: 'queued',
    });
    await backgroundJobService.markStarted(bgJob.id, { step: 'preflight', pct: 5 });
    const adminOpsChannel = await _resolveAdminOpsChannel(guild, interaction.channel);
    statusCard = await statusCardService.createStatusCard(adminOpsChannel || interaction.channel, {
      title: 'Initialize Server',
      status: 'running',
      summary: `Switching this workspace into installation mode and rebuilding the setup lane.${!process.env.REDIS_URL ? ' Queue unavailable, using fallback execution.' : ''}${!process.env.DATABASE_URL ? ' Running without persistence.' : ''}`,
      fields: [
        { name: 'Phase', value: 'Preflight', inline: true },
        { name: 'Job ID', value: String(bgJob.id), inline: true },
        { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true },
      ],
      footer: 'Persistent status card for mobile-safe admin tracking',
    });
    const { resetToInstallationMode } = baseInitService;
    const preserveChannelIds = interaction.channelId ? [interaction.channelId] : [];
    const preserveCategoryIds = interaction.channel?.parentId ? [interaction.channel.parentId] : [];
    // TRUE CLEAN SLATE: clear every guild-scoped bot memory source before rebuilding the setup lane.
    // This includes hidden managed-space reservations, active league registry, conversation history,
    // member/history memory, server settings/rules, wizard state, and guild-scoped DB config.
    const memoryReset = await require('../services/cleanSlateResetService').resetGuild(guild.id, _state);
    await backgroundJobService.markProgress(bgJob.id, { step: 'resetting-workspace', pct: 35 });
    await statusCardService.updateStatusCard(statusCard, {
      title: 'Initialize Server',
      status: 'running',
      summary: 'Workspace reset is running. The current admin lane is being preserved so the reply can finish cleanly.',
      fields: [
        { name: 'Phase', value: 'Resetting workspace', inline: true },
        { name: 'Progress', value: '35%', inline: true },
        { name: 'Live Lane', value: interaction.channel ? `#${interaction.channel.name}` : 'current channel', inline: true },
      ],
    });
    const result = await resetToInstallationMode(guild, _state, {
      fullReboot: false,
      preserveChannelIds,
      preserveCategoryIds,
    });
    await backgroundJobService.markProgress(bgJob.id, { step: 'restoring-setup-lane', pct: 75 });
    // Run post-build workflow: deploy commands, patch notes, identity, access lock
    await workflowEngine.run('post-build', { guild, state: _state, client: _client });
    wizardStateService.patch({ installationMode: true, currentStep: 'mode', lastAdvancedAt: Date.now() });
    wizardPrefs.savePrefs({ wizardStage: 'mode' });
    const ch = await _postSetupWizardMessage(guild, `**${result.serverName}** is in installation mode now. Choose a structure strategy and server template to begin.`, { stage: 'mode' });
    await postRebootFinalizationService.finalizeSetupLaneAfterReboot(guild, ch, () => wizardRendererService.buildWizardPayload(guild, '**Installation mode is active.** Continue setup from this guide.'), { currentStep: 'mode', deleteUserMessages: true }).catch(() => null);
    const msg = ch ? `🧹 Installation mode is live in <#${ch.id}>.` : '🧹 Installation mode is live in **#setup-wizard**.';
    await backgroundJobService.markCompleted(bgJob.id, { setupWizardChannelId: ch?.id || null, flushSummary: result.flushSummary || null, memoryReset });
    await statusCardService.updateStatusCard(statusCard, {
      title: 'Initialize Server',
      status: 'completed',
      summary: msg,
      fields: [
        { name: 'Channels Flushed', value: String(result.flushSummary?.deletedChannels || 0), inline: true },
        { name: 'Categories Flushed', value: String(result.flushSummary?.deletedCategories || 0), inline: true },
        { name: 'Setup Lane', value: ch ? `<#${ch.id}>` : '#setup-wizard', inline: true },
      ],
    });
    if (interaction.replied || interaction.deferred) return interaction.editReply({ content: msg }).catch(() => null);
    return interaction.reply({ content: msg, flags:64 }).catch(() => null);
  } catch (err) {
    if (bgJob?.id) await backgroundJobService.markFailed(bgJob.id, err?.message || err, { step: 'initialize-server' });
    await statusCardService.updateStatusCard(statusCard, {
      title: 'Initialize Server',
      status: 'failed',
      summary: 'Initialization failed. Check server logs and the persistent status card context for the last successful phase.',
      fields: [
        { name: 'Last Step', value: 'initialize-server', inline: true },
        { name: 'Live Lane', value: interaction.channel ? `#${interaction.channel.name}` : 'current channel', inline: true },
      ],
    });
    if (interaction.replied || interaction.deferred) return interaction.editReply({ content: safeUserError(err, '❌ Initialization failed. Check the logs and try again.') }).catch(() => null);
    return interaction.reply({ content: safeUserError(err, '❌ Initialization failed. Check the logs and try again.'), flags: 64 }).catch(() => null);
  } finally {
    // Outer structural lock releases after this handler and state flush complete.
  }
}



case 'create-poll': {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  const question = interaction.options.getString('question');
  const options = String(interaction.options.getString('options') || '').split(',').map(s => s.trim()).filter(Boolean);
  const res = await pollService.createPoll(guild, question, options);
  return interaction.reply({ content:`✅ Poll posted in <#${res.message.channel.id}>.`, flags:64 });
}

case 'set-bot-identity': {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  const botName = interaction.options.getString('name');
  const avatarUrlRaw = interaction.options.getString('avatar-url');
  const avatarImage = interaction.options.getAttachment('avatar-image');
  const useServerImage = interaction.options.getBoolean('use-server-image');
  const importedEmojiName = interaction.options.getString('imported-emoji');

  let avatarMode = useServerImage ? 'server_image' : undefined;
  let avatarUrl = null;
  let avatarEmoji = null;

  if (avatarImage?.url) {
    avatarMode = 'url';
    avatarUrl = avatarImage.url;
  } else if (avatarUrlRaw) {
    avatarMode = 'url';
    avatarUrl = avatarUrlRaw;
  } else if (importedEmojiName && importedEmojiName !== '_none_') {
    const found = guild?.emojis?.cache?.find(e => e.name === importedEmojiName || e.name.toLowerCase() === String(importedEmojiName).toLowerCase());
    if (!found) return interaction.reply({ content:'❌ Imported emoji not found in this server.', flags:64 });
    avatarMode = 'emoji_url';
    avatarUrl = found.imageURL({ extension: 'png', size: 256 });
    avatarEmoji = found.name;
  } else if (useServerImage) {
    avatarMode = 'server_image';
    avatarUrl = null;
    avatarEmoji = null;
  }

  const settings = serverSettings.setBotIdentity({ botName, avatarMode, avatarUrl, avatarEmoji });
  const applied = await botIdentityService.applyBotIdentity(_client, guild);
  await _postSetupWizardMessage(guild, 'Bot identity saved and wizard refreshed.').catch(() => null);
  const modeLabel = settings.avatarMode === 'emoji_url' ? `Imported emoji${settings.avatarEmoji ? ` (${settings.avatarEmoji})` : ''}` : settings.avatarMode === 'url' ? 'Custom image' : 'Server image';
  return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle('🤖 Bot Identity Saved').setDescription(`Name: **${settings.botName}**
Avatar mode: **${modeLabel}**
Applied now: **${applied.ok ? 'yes' : 'no'}**${applied.reason ? `\nReason: **${applied.reason}**` : ''}`).setTimestamp()], flags:64 });
}




case 'kill-bot': {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  serverSettings.setBotStatus('killed');
  return interaction.reply({ content:'🛑 Bot status set to **KILLED**. Normal commands are now offline until `/workflow bot ignite` is used.', flags:64 });
}

case 'ignite-bot': {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  serverSettings.setBotStatus('active');
  wizardStateService.patch({ installationMode: true, currentStep: 'mode', lastAdvancedAt: Date.now() });
  wizardPrefs.savePrefs({ wizardStage: 'mode' });
  await patchNotesService.publishPatchNotes(guild).catch(() => null);
  const ch = await _postSetupWizardMessage(guild, 'Bot reactivated. Setup reopened directly to the live wizard.', { stage: 'mode' });
  return interaction.reply({ content:`🔥 Bot reactivated. Setup reopened in ${ch ? `<#${ch.id}>` : `\`${_setupWizardFallbackText()}\``}.`, flags:64 });
}

case 'bot-status': {
  const settings = serverSettings.getSettings();
  const wizardState = wizardStateService.getState();
  return interaction.reply({ embeds:[new EmbedBuilder().setColor(settings.botStatus === 'killed' ? 0xff4444 : 0x5865f2).setTitle('🤖 Bot Status').setDescription(`Status: **${String(settings.botStatus || 'active').toUpperCase()}**
Installation mode: **${wizardState.installationMode ? 'ON' : 'OFF'}**
Wizard stage: **${String(wizardState.currentStep || 'flow').toUpperCase()}**
Audience: **${String(settings.audienceRating || 'unset').toUpperCase()}**
Filter mode: **${String(settings.filterMode || 'strict').toUpperCase()}**
Tone visibility: **${String(settings.toneVisibility || 'public').replace(/_/g, ' ').toUpperCase()}**`).setTimestamp()], flags:64 });
}

case 'trash-the-bot': {
  if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
  const ackMode = 'deferred';
  if (!interaction.deferred && !interaction.replied) await safeDeferred(interaction, { flags:64 }).catch(() => null);
  const confirm = String(interaction.options.getString('confirm') || '').trim().toUpperCase();
  if (confirm !== 'TRASH') {
    return _updateLongInteraction(interaction, ackMode, { content:'❌ Type **TRASH** in the confirm field to run a full reboot.', flags:64 }).catch(() => null);
  }
  const lastTrashAt = Number(wizardStateService.getState().lastTrashAt || 0);
  if (lastTrashAt && (Date.now() - lastTrashAt) < 90_000) {
    return _updateLongInteraction(interaction, ackMode, { content: '⏳ A full reboot just ran moments ago. Wait a little and use the refreshed setup guide instead of firing another reboot.', flags:64 }).catch(() => null);
  }
  let statusCard = null;
  let bgJob = null;
  // Structural lock is owned by handleInteraction.
  try {
    bgJob = await backgroundJobService.createJob({
      guildId: guild.id,
      jobType: 'trash-the-bot',
      triggeredBy: interaction.user?.id,
      payload: { channelId: interaction.channelId },
      status: 'queued',
    });
    await securityMiddleware.auditLog({ action: 'trash-the-bot', userId: interaction.user?.id, guildId: guild.id, details: `Full reboot requested`, severity: 'warn' });
    const adminOpsChannel = await _resolveAdminOpsChannel(guild, interaction.channel);
    statusCard = await statusCardService.createStatusCard(adminOpsChannel || interaction.channel, {
      title: 'Full Reboot',
      status: 'running',
      summary: `Full reboot queued. Bot-managed channels and categories are about to be rebuilt.${!process.env.REDIS_URL ? ' Queue unavailable, using fallback execution.' : ''}${!process.env.DATABASE_URL ? ' Running without persistence.' : ''}`,
      fields: [
        { name: 'Phase', value: 'Queued', inline: true },
        { name: 'Job ID', value: String(bgJob.id), inline: true },
        { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true },
      ],
      footer: 'Persistent status card for mobile-safe admin tracking',
    });
    await backgroundJobService.markStarted(bgJob.id, { step: 'full-reboot', pct: 5 });
    await _updateLongInteraction(interaction, ackMode, { content: `🧹 Starting full reboot. Bot-managed channels and categories are being rebuilt now...${!process.env.REDIS_URL ? ' Queue unavailable, using fallback execution.' : ''}${!process.env.DATABASE_URL ? ' Running without persistence.' : ''}` }).catch(() => null);
    await statusCardService.updateStatusCard(statusCard, {
      title: 'Full Reboot',
      status: 'running',
      summary: 'Reset is in progress. The current admin lane is being preserved to avoid the Discord reply dead-end.',
      fields: [
        { name: 'Phase', value: 'Resetting workspace', inline: true },
        { name: 'Progress', value: '35%', inline: true },
        { name: 'Live Lane', value: interaction.channel ? `#${interaction.channel.name}` : 'current channel', inline: true },
      ],
    });
    const { resetToInstallationMode } = baseInitService;
    const preserveChannelIds = interaction.channelId ? [interaction.channelId] : [];
    const preserveCategoryIds = interaction.channel?.parentId ? [interaction.channel.parentId] : [];
    // Full reboot uses the same clean-slate memory contract as /initialize-server.
    // This prevents stale hidden leagues, old settings, or conversation history from
    // surviving under a second reset path.
    const memoryReset = await require('../services/cleanSlateResetService').resetGuild(guild.id, _state);
    const result = await resetToInstallationMode(guild, _state, {
      fullReboot: true,
      preserveChannelIds,
      preserveCategoryIds,
    });
    await backgroundJobService.markProgress(bgJob.id, { step: 'restoring-setup-lane', pct: 80 });
    await deployCommandsForCurrentState(_state).catch(() => null);
    await botIdentityService.applyBotIdentity(_client, guild).catch(()=>null);
    wizardStateService.patch({ installationMode: true, currentStep: 'flow', lastAdvancedAt: Date.now(), lastTrashAt: Date.now() });
    wizardPrefs.savePrefs({ wizardStage: 'flow' });
    await releaseOrchestrationService.finalizeRelease(guild, patchNotesService, {
      version: 'V182',
      category: 'setup wizard single-message + release orchestration',
      affectedSystems: ['setup-wizard', 'patch-notes', 'post-reboot-finalization'],
      fixes: [
        'wizard lane reconciles to a single active message',
        'newest patch note always publishes last in #patch-notes',
        'post-reboot finalization now cleans setup-wizard noise'
      ],
      remainingRisks: [
        process.env.REDIS_URL ? 'distributed event claims active when Redis is reachable' : 'distributed event claims still require REDIS_URL for cross-instance guarantees'
      ],
    }).catch((err) => log.warn('patch notes publish after trash failed:', err.message));
    try { require('../services/guideLifecycleService').forceRefreshAll(guild.id); } catch {}
    // Run post-trash workflow (triggers guide refresh, automation status, etc.)
    workflowEngine.run('post-trash', { guild, state: _state, client: _client }).catch(e => log.warn('post-trash workflow:', e.message));
    workflowEngine.emitJobEvent('trash-the-bot', 'completed', { guild, guildId: guild.id }).catch(() => null);
    const ch = await _postSetupWizardMessage(guild, `🗑 **${result.serverName}** was fully rebooted.
• Channels flushed: **${result.flushSummary?.deletedChannels || 0}**
• Categories flushed: **${result.flushSummary?.deletedCategories || 0}**
• Preserved live lane: **${interaction.channel?.name || 'current channel'}**

Fresh patch-notes and setup-wizard lanes were rebuilt automatically. Press **Confirm / Open Setup Wizard** to continue.`, { stage: 'flow' });
    await postRebootFinalizationService.finalizeSetupLaneAfterReboot(guild, ch, () => wizardRendererService.buildWizardPayload(guild, 'Full reboot complete. This setup guide is now the single live wizard message.'), { currentStep: 'flow', deleteUserMessages: true }).catch(() => null);
    await backgroundJobService.markCompleted(bgJob.id, { setupWizardChannelId: ch?.id || null, flushSummary: result.flushSummary || null, memoryReset });
    await statusCardService.updateStatusCard(statusCard, {
      title: 'Full Reboot',
      status: 'completed',
      summary: `Rebuild complete. ${ch ? `Fresh setup lane: <#${ch.id}>.` : 'Fresh setup lane rebuilt.'}` ,
      fields: [
        { name: 'Channels Flushed', value: String(result.flushSummary?.deletedChannels || 0), inline: true },
        { name: 'Categories Flushed', value: String(result.flushSummary?.deletedCategories || 0), inline: true },
        { name: 'Preserved Lane', value: interaction.channel ? `#${interaction.channel.name}` : 'current channel', inline: true },
      ],
    });
    if (ch) await _purgeSetupWizardNoise(ch).catch(() => null);
    return _updateLongInteraction(interaction, ackMode, { content:`🗑️ Full reboot complete. A fresh ${ch ? `<#${ch.id}>` : `\`${_setupWizardFallbackText()}\``} lane was rebuilt automatically. Preserved the live interaction lane so Discord could finish the response cleanly.`, flags:64 }).catch(() => null);
  } catch (err) {
    log.error('trash-the-bot failed:', err.message, err.stack);
    if (bgJob?.id) await backgroundJobService.markFailed(bgJob.id, err?.message || err, { step: 'trash-the-bot' });
    await statusCardService.updateStatusCard(statusCard, {
      title: 'Full Reboot',
      status: 'failed',
      summary: 'Full reboot failed. The setup lane recovery path is being restored where possible.',
      fields: [
        { name: 'Last Step', value: 'trash-the-bot', inline: true },
        { name: 'Live Lane', value: interaction.channel ? `#${interaction.channel.name}` : 'current channel', inline: true },
      ],
    });
    const fallbackCh = await _ensureSetupWizardChannel(guild, { reveal: true }).catch(() => null);
    await recoverySelfHealService.healWizardGuide(fallbackCh, () => wizardRendererService.buildWizardPayload(guild, 'Trash reboot hit an error, but the setup guide was restored.'), singleMessageWizardService).catch(() => null);
    return _updateLongInteraction(interaction, ackMode, { content:`❌ Trash-the-bot failed. ${fallbackCh ? `The setup lane was restored in <#${fallbackCh.id}>.` : 'The setup lane may need to be reopened manually.'} Check the server logs for the exact error.`, flags:64 }).catch(() => null);
  } finally {
    // Outer structural lock releases after this handler and state flush complete.
  }
}

    case 'customize-server-rules': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      return interaction.reply({ embeds:[serverRulesService.buildWizardEmbed()], components:[serverRulesService.buildWizardButtonRow()], flags:64 });
    }

    case 'set-bot-tone': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const audience = interaction.options.getString('audience');
      const sameTone = interaction.options.getBoolean('use-same-tone');
      const allowGifs = interaction.options.getBoolean('allow-gifs');
      const filterMode = interaction.options.getString('filter-mode');
      const toneVisibility = interaction.options.getString('tone-visibility');
      const tonesRaw = interaction.options.getString('tones');
      const memberRaw = interaction.options.getString('member-tones');
      const commRaw = interaction.options.getString('commissioner-tones');
      const openHouse = interaction.options.getBoolean('open-house');
      const openHouseChannel = interaction.options.getChannel('open-house-channel');
      const clearOpenHouseChannels = interaction.options.getBoolean('clear-open-house-channels');
      const openHouseBurstLimit = interaction.options.getInteger('open-house-burst-limit');
      if (audience) serverSettings.setAudienceRating(audience);
      if (typeof sameTone === 'boolean') serverSettings.saveSettings({ ...serverSettings.getSettings(), useSharedToneProfile: sameTone, setupCompletedAt: Date.now() });
      if (typeof allowGifs === 'boolean') serverSettings.saveSettings({ ...serverSettings.getSettings(), allowGifReplies: allowGifs, setupCompletedAt: Date.now() });
      if (filterMode) serverSettings.saveSettings({ ...serverSettings.getSettings(), filterMode, setupCompletedAt: Date.now() });
      if (toneVisibility) serverSettings.saveSettings({ ...serverSettings.getSettings(), toneVisibility, setupCompletedAt: Date.now() });
      if (tonesRaw) serverSettings.setToneProfile(tonesRaw.split(',').map(s => s.trim()).filter(Boolean), 'shared');
      if (memberRaw) serverSettings.setToneProfile(memberRaw.split(',').map(s => s.trim()).filter(Boolean), 'member');
      if (commRaw) serverSettings.setToneProfile(commRaw.split(',').map(s => s.trim()).filter(Boolean), 'commissioner');
      if (typeof openHouse === 'boolean' || openHouseChannel || clearOpenHouseChannels || openHouseBurstLimit) {
        const current = serverSettings.getSettings();
        const channels = clearOpenHouseChannels ? [] : [...(current.rOpenHouseChannels || [])];
        if (openHouseChannel && !channels.includes(String(openHouseChannel.id))) channels.push(String(openHouseChannel.id));
        serverSettings.saveSettings({
          ...current,
          ...(typeof openHouse === 'boolean' ? { rOpenHouseEnabled: openHouse } : {}),
          rOpenHouseChannels: channels,
          ...(openHouseBurstLimit ? { rOpenHouseBurstLimit: openHouseBurstLimit } : {}),
          setupCompletedAt: Date.now(),
        });
      }
      const settings = serverSettings.getSettings();
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle('🎭 Bot Tone Updated').setDescription(`Audience rating: **${String(settings.audienceRating).toUpperCase()}**
Use same tone: **${settings.useSharedToneProfile ? 'YES' : 'NO'}**
Member/shared tone: **${serverSettings.getToneSummary(settings, 'member')}**
Commissioner tone: **${serverSettings.getToneSummary(settings, 'commissioner')}**
GIF replies: **${settings.allowGifReplies ? 'ON' : 'OFF'}**
Filter mode: **${String(settings.filterMode || 'strict').toUpperCase()}**
Tone visibility: **${String(settings.toneVisibility || 'public').replace(/_/g, ' ').toUpperCase()}**
R Open House: **${settings.rOpenHouseEnabled ? 'ON' : 'OFF'}**${(settings.rOpenHouseChannels || []).length ? ` • ${(settings.rOpenHouseChannels || []).length} explicit channel(s)` : ' • safe social channels auto-detected'}
Warning: **${serverSettings.getAudienceWarning(settings.audienceRating, settings.filterMode)}**`).setTimestamp()], flags:64 });
    }

    case 'setup-league': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      // V200.2: Removed redundant _isInstallationMode() check — _guardInstallationModeCommand (line 1855) already blocks all non-allowlisted commands during install mode.
      try {
        await interaction.deferReply({flags:64});
        const setupLeagueName = interaction.options.getString('league-name');
        if (!setupLeagueName || !setupLeagueName.trim()) {
          return interaction.editReply('❌ League name is required. Give your league a real name before setup.');
        }
        _state.leagueConfig.leagueName = setupLeagueName.trim().slice(0, 60);
        saveJsonDebounced('leagueConfig.json', _state.leagueConfig);
        const { sendSetupWizard } = leagueSetupService;
        return await sendSetupWizard(interaction, _state);
      } catch (err) {
        log.error('setup-league failed:', err.message, err.stack);
        const msg = safeUserError(err, '❌ Setup failed. Check the server logs for details.');
        if (interaction.deferred || interaction.replied) return interaction.editReply(msg).catch(() => null);
        return interaction.reply({ content: msg, flags:64 }).catch(() => null);
      }
    }
    case 'delete-league': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});

      const selectedLeagueId = interaction.options.getString('league');
      const confirm = interaction.options.getString('confirm');


      if (!selectedLeagueId || selectedLeagueId === '_none_') return interaction.reply({content:'⚠️ Please select an active league to delete.',flags:64});

      const selectedLeague = activeLeagueService.getLeague(selectedLeagueId);
      if (!selectedLeague) {
        return interaction.reply({ content: '⚠️ No active league record found to delete.', flags:64 });
      }

      if (confirm !== selectedLeague.leagueName) return interaction.reply({content:`Preview: **${selectedLeague.leagueName}**, ${selectedLeague.builtChannelIds?.length||0} channels, ${selectedLeague.builtCategoryIds?.length||0} categories. Shared resources and lifetime history are retained. Enter the exact league name in confirm to proceed.`,flags:64});
      await require('../services/lifetimeHistoryService').importLegacy(guild.id,_state);
      await interaction.deferReply({flags:64});
      await interaction.editReply(`🗑 Deleting **${selectedLeague.leagueName}**...`);

      const { deleteLeagueStructure } = leagueSetupService;
      const { deleteAllGameChannels } = gameChannelService;
      const { purgeLeagueData } = dataCleanupService;

      try {
        const structureDeleted = await deleteLeagueStructure(guild, {
          leagueId: selectedLeague.id,
          categoryIds: selectedLeague.builtCategoryIds || [],
          channelIds: selectedLeague.builtChannelIds || [],
          typeId: selectedLeague.leagueTypeId || null,
        });

        const gameChannelsDeleted = await deleteAllGameChannels(guild, `League deleted: ${selectedLeague.leagueName}`, { leagueId: selectedLeague.id });
        const cleanup = purgeLeagueData(_state, selectedLeague);
        const trackedSpace = (await require('../services/managedSpaceService').list(guild.id)).find(x=>x.id===selectedLeague.id);
        if (trackedSpace) await require('../services/managedSpaceService').transition(guild.id, selectedLeague.id, 'ARCHIVED');

        if ((_state.leagueConfig?.leagueName || '') === (selectedLeague.leagueName || '')) {
          _state.leagueConfig.leagueTypeId = null;
          _state.leagueConfig.leagueName = null;
          _state.leagueConfig.game = null;
          _state.leagueConfig.builtCategoryIds = [];
          _state.leagueConfig.builtChannelIds = [];
          _state.leagueConfig.seasonType = null;
          _state.leagueConfig.seasonWeeks = null;
          saveJsonDebounced('leagueConfig.json', _state.leagueConfig);
        }

        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('🗑 League Deleted')
            .setDescription(
              `**League:** ${selectedLeague.leagueName}\n` +
              `**Type:** ${activeLeagueService.leagueTypeLabel(selectedLeague.leagueTypeId)}\n` +
              `**Deleted:** ${structureDeleted.deletedCategories || 0} categories, ${structureDeleted.deletedChannels || 0} channels, ${gameChannelsDeleted || 0} game channels\n` +
              `**Data dump:** ${cleanup.teamSlotsReset || 0} team slots reset, ${cleanup.playersRemoved || 0} player records removed, ${cleanup.gamesRemoved || 0} game records removed`
            )
            .setTimestamp()],
        });
      } catch (err) {
        log.error('delete-league failed:', err.message, err.stack);
        return interaction.editReply(safeUserError(err, '❌ League delete failed. Check the logs and try again.'));
      }
    }

    case 'reset-league': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});

      const selectedLeagueId = interaction.options.getString('league');
      const confirm = interaction.options.getString('confirm');
      const nextLeagueTypeId = interaction.options.getString('new-league-type');
      const customLeagueName = interaction.options.getString('league-name');


      if (!selectedLeagueId || selectedLeagueId === '_none_') return interaction.reply({content:'⚠️ Please select an active league to reset.',flags:64});

      const selectedLeague = activeLeagueService.getLeague(selectedLeagueId);
      if (!selectedLeague) {
        return interaction.reply({ content: '⚠️ No active league record found to reset. Set up a league first.', flags:64 });
      }

      const targetLeagueTypeId = nextLeagueTypeId || selectedLeague.leagueTypeId || _state.leagueConfig.leagueTypeId;
      const targetLeagueName = (customLeagueName || selectedLeague.leagueName || _state.leagueConfig.leagueName || '').trim();

      if (confirm !== selectedLeague.leagueName) return interaction.reply({content:`Preview: **${selectedLeague.leagueName}**, ${selectedLeague.builtChannelIds?.length||0} channels, ${selectedLeague.builtCategoryIds?.length||0} categories. Shared resources and lifetime history are retained. Enter the exact league name in confirm to proceed.`,flags:64});
      await require('../services/lifetimeHistoryService').importLegacy(guild.id,_state);
      await interaction.deferReply({flags:64});
      await interaction.editReply(`⚙️ Resetting **${selectedLeague.leagueName}**...`);

      const { LEAGUE_TYPES, buildSimplifiedLeagueStructure, deleteLeagueStructure, saveConfigDefaults } = leagueSetupService;
      const { deleteAllGameChannels } = gameChannelService;
      const { purgeLeagueData } = dataCleanupService;

      if (!LEAGUE_TYPES[targetLeagueTypeId]) {
        return interaction.editReply('❌ Invalid target league type selected.');
      }

      try {
        const structureDeleted = await deleteLeagueStructure(guild, {
          leagueId: selectedLeague.id,
          categoryIds: selectedLeague.builtCategoryIds || _state.leagueConfig.builtCategoryIds || [],
          channelIds:  selectedLeague.builtChannelIds  || _state.leagueConfig.builtChannelIds  || [],
          typeId:      selectedLeague.leagueTypeId     || _state.leagueConfig.leagueTypeId     || null,
        });

        const gameChannelsDeleted = await deleteAllGameChannels(guild, 'League reset by commissioner', { leagueId: selectedLeague.id });
        const cleanup = purgeLeagueData(_state, selectedLeague);
        const trackedSpace = (await require('../services/managedSpaceService').list(guild.id)).find(x=>x.id===selectedLeague.id);
        if (trackedSpace) await require('../services/managedSpaceService').transition(guild.id, selectedLeague.id, 'ARCHIVED');

        // Lifetime rewards and other leagues' state survive reset.
        const leagueDef = LEAGUE_TYPES[targetLeagueTypeId];
        const leagueName = targetLeagueName || leagueDef.label.split(' ')[0];

        const { createdCount, builtCategoryIds, builtChannelIds } = await buildSimplifiedLeagueStructure(
          guild, targetLeagueTypeId, _state.leagueConfig.commissionerRoleId || null, leagueName
        );

        _state.leagueConfig.leagueTypeId = targetLeagueTypeId;
        _state.leagueConfig.leagueName = leagueName;
        _state.leagueConfig.game = leagueDef.game;
        _state.leagueConfig.isCustom = leagueDef.isCustom || false;
        _state.leagueConfig.builtCategoryIds = builtCategoryIds;
        _state.leagueConfig.builtChannelIds = builtChannelIds;
        _state.leagueConfig.seasonType = 'full';
        _state.leagueConfig.seasonWeeks = leagueDef.fullWeeks;
        _state.leagueConfig.createdAt = Date.now();
        saveJsonDebounced('leagueConfig.json', _state.leagueConfig);
        saveConfigDefaults(_state);

        try { teamRegistry.syncFromState(_state); } catch {}
        const { resetHubWeek } = hubReleaseService;
        if (activeLeagueService.listOperationalLeagues().length === 1) resetHubWeek(1, _state);

        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('✅ League Reset Complete')
            .setDescription(
              `**League:** ${leagueName}\n` +
              `**Type:** ${leagueDef.label}\n` +
              `**Deleted:** ${structureDeleted.deletedCategories || 0} categories, ${structureDeleted.deletedChannels || 0} channels, ${gameChannelsDeleted || 0} game channels\n` +
              `**Data dump:** ${cleanup.teamSlotsReset || 0} team slots reset, ${cleanup.playersRemoved || 0} player records removed, ${cleanup.gamesRemoved || 0} game records removed\n` +
              `**Rebuilt:** ${createdCount} channels\n\n` +
              `The reset target is now stored as an active league record, and team ownership registry has been resynced.`
            )
            .setTimestamp()],
        });
      } catch (err) {
        log.error('reset-league failed:', err.message, err.stack);
        return interaction.editReply(safeUserError(err, '❌ League reset failed. Check the logs and try again.'));
      }
    }

    // ── /audit-wiring — startup diagnostics ──
    case 'audit-wiring': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const { CHANNEL_KEYS, REQUIRED_CHANNELS } = require('../config/channels');
      const rows = REQUIRED_CHANNELS.map(k=>{
        const ch=_getCh(guild,k);
        return `${ch?'✅':'❌'} \`${k}\` → ${ch?`#${ch.name}`:`missing ("${CHANNEL_KEYS[k]}" not found)`}`;
      });
      const timerStatus=`HubRelease: ${_state.hubWeeklyData.releaseTimerId?'✅ running':'❌ idle'} | Schedule: ${_state.scheduleState.timerId?'✅ running':'❌ idle'}`;
      const aiStatus='✅ Anthropic API key set';
      const leagueName = _state.leagueConfig.leagueName || '(not set — use /setup-league or /reset-league with league-name)';
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('🔍 Bot Wiring Audit').addFields({name:'League Name',value:leagueName},{name:'Channels',value:rows.join('\n')},{name:'Timers',value:timerStatus},{name:'AI',value:aiStatus},{name:'Teams registered',value:String(_state.players.size)},{name:'Open registry',value:`${_state.openTeamRegistry.filter(t=>t.isOpen).length} open / ${_state.openTeamRegistry.length} total`}).setTimestamp()],flags:64});
    }

    // ── /add-member-to-league — assign member + grant channel access ──
    case 'add-member-to-league': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const targetUser = interaction.options.getUser('user');
      const leagueInput = interaction.options.getString('league');
      const teamName = interaction.options.getString('team');
      const resolved = leagueResolver.resolveLeague(leagueInput, { guildId:guild.id, mode:'joinable' });
      if (!resolved.ok) return interaction.reply({content:`❌ ${resolved.message}`,flags:64});
      const selectedLeague = resolved.league;
      const member = await guild.members.fetch(targetUser.id).catch(() => null);
      if (!member) return interaction.reply({content:'❌ Could not find that member in the server.',flags:64});

      await interaction.deferReply({flags:64});
      let granted = 0;
      try {
        const res = await leagueVisibility.grantMemberAccessToLeague(guild, member, _state, selectedLeague.id);
        granted = res.granted || 0;
      } catch (err) {
        return interaction.editReply({content:`❌ Could not grant access to **${selectedLeague.leagueName}**: ${err.message}`});
      }

      let teamResult = null;
      let teamFailure = null;
      if (teamName && teamName !== '_none_') {
        const open = openTeamsService.getOpenTeamsForLeague(selectedLeague.id) || [];
        const candidate = open.find(t => norm(t.baseTeam) === norm(teamName) || norm(t.displayTeam) === norm(teamName));
        if (!candidate) teamFailure = `**${teamName}** is not an open team in ${selectedLeague.leagueName}.`;
        else {
          teamResult = await openTeamsService.claimTeam(guild, member, candidate.baseTeam, { leagueId:selectedLeague.id });
          if (!teamResult.success) teamFailure = teamResult.reason || 'Team assignment failed.';
        }
      }

      const assignedTeam = teamResult?.success ? teamResult.entry.displayTeam : null;
      const onboarding = await leagueMemberOnboarding.notifyMemberAdded({ guild, member, leagueId:selectedLeague.id, teamName:assignedTeam, actorId:interaction.user.id, source:'commissioner' }).catch(err => ({ok:false, reason:err.message}));
      if (teamFailure) leagueMemberOnboarding.markOnboarding(member.id, selectedLeague.id, { teamStatus:'AWAITING_TEAM', lastTeamAssignmentError:teamFailure });

      const fields = [
        { name:'Member', value:`${targetUser}`, inline:true },
        { name:'League', value:selectedLeague.leagueName, inline:true },
        { name:'Membership', value:'✅ ACTIVE', inline:true },
        { name:'Channel Access', value:`${granted} categories`, inline:true },
        { name:'Team', value:assignedTeam ? `✅ ${assignedTeam}` : '⏳ AWAITING_TEAM', inline:true },
        { name:'Onboarding', value:onboarding?.ok ? '✅ Greeting + timezone selection sent' : `⚠️ Membership active; onboarding notice failed (${onboarding?.reason || 'unknown'})`, inline:false },
      ];
      if (teamFailure) fields.push({ name:'Team assignment', value:`⚠️ ${teamFailure} Membership was kept active; the member can choose another team.`, inline:false });
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(teamFailure ? 0xf1c40f : 0x2ecc71).setTitle(teamFailure ? '⚠️ Member Added — Team Still Needed' : '✅ Member Added to League').addFields(...fields).setFooter({text:'Membership is authoritative. Optional team assignment never rolls back a valid membership.'}).setTimestamp()]});
    }

    // ── /audit-emojis — show all mapped/unmapped emojis ──
    case 'audit-emojis': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const { auditEmojis } = require('../config/emojiBank');
      const { mapped, unmapped, missing = [] } = auditEmojis(guild);
      const mapText = mapped.length ? mapped.join('\n') : 'None';
      const unmapText = unmapped.length ? unmapped.slice(0, 30).join('\n') : 'None';
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x3498db).setTitle('🎨 Emoji Audit')
        .addFields(
          { name: `✅ Mapped (${mapped.length})`, value: mapText.slice(0, 1024) },
          { name: `❓ Unmapped (${unmapped.length})`, value: unmapText.slice(0, 1024) },
          { name: `❌ Missing (${missing.length})`, value: missing.length ? missing.slice(0, 20).join('\n').slice(0, 1024) : 'None — all team emojis present!' },
        )
        .setFooter({ text: 'Use /sync-emojis to upload missing ones' })
        .setTimestamp()],flags:64});
    }

    // ── /sync-emojis — bulk upload team emojis to the server ──
    case 'sync-emojis': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const league = interaction.options.getString('league');
      await interaction.deferReply({flags:64});
      await interaction.editReply('⏳ Uploading emojis... this may take a minute (rate limited to ~1/sec).');
      const { syncEmojis: doSync } = require('../config/emojiBank');
      const results = await doSync(guild, league);
      const lines = [];
      if (results.uploaded.length) lines.push(`✅ **Uploaded (${results.uploaded.length}):**\n${results.uploaded.join(', ')}`);
      if (results.skipped.length) lines.push(`⏭️ **Skipped (${results.skipped.length}):** already exist`);
      if (results.failed.length) lines.push(`❌ **Failed (${results.failed.length}):**\n${results.failed.join('\n')}`);
      if (!lines.length) lines.push('Nothing to do — all emojis already uploaded.');
      await guild.emojis.fetch().catch(() => null);
      return interaction.editReply({ content: lines.join('\n\n').slice(0, 1900) });
    }

    // ── /member-record — unified member ledger tools ──
    case 'member-record': {
      const sub = interaction.options.getSubcommand();
      if (sub === 'career' || sub === 'export-career') {
        const target = interaction.options.getUser('user') || interaction.user;
        if (target.id !== interaction.user.id && !isComm()) return interaction.reply({content:'Only you and commissioners can view your full career.',flags:64});
        await interaction.deferReply({flags:64});
        const history = require('../services/lifetimeHistoryService');
        await history.importLegacy(guild.id,_state);
        const career = await history.career(guild.id,target.id);
        if (sub==='export-career') return interaction.editReply({content:'Your lifetime record export.',files:[{attachment:Buffer.from(JSON.stringify(career,null,2)),name:`career-${target.id}.json`}]});
        const honors=career.awards.slice(-15).map(a=>`• ${a.title || a.awardLabel || a.type} (${a.season || 'season unrecorded'})`).join('\n');
        return interaction.editReply({content:`**Lifetime career — ${target.username}**\nGames: ${career.gamesPlayed} | W–L–T: ${career.wins}–${career.losses}–${career.ties}\nWin rate: ${career.winPercentage == null ? 'N/A' : career.winPercentage+'%'} | Seasons played: ${career.seasons}\nAwards: ${career.awards.length}\n${Object.entries(career.metrics).map(([k,v])=>`${k}: ${v}`).join(' | ')}\n${honors || 'No attributed awards yet.'}`.slice(0,1900),allowedMentions:{parse:[]}});
      }
      if (!isComm()) return interaction.reply({content:'Commissioners only.',flags:64});
      if (sub==='award') {
        await interaction.deferReply({flags:64});
        await _saveLifetimeAward(interaction,{userId:interaction.options.getUser('user').id,title:interaction.options.getString('title')});
        return interaction.editReply('Lifetime accolade saved.');
      }
      if (sub==='record-stat') {
        const league=activeLeagueService.findLeagueForChannel(interaction.channel);
        if(!league)return interaction.reply({content:'Record stats inside the intended league or event channel.',flags:64});
        await interaction.deferReply({flags:64});
        const metric=interaction.options.getString('metric'),userId=interaction.options.getUser('user').id;
        await require('../services/lifetimeHistoryService').recordStat(guild.id,{id:`${league.id}:${interaction.options.getString('source-id')}:${userId}:${metric}`,leagueId:league.id,userId,metric,value:interaction.options.getNumber('value'),game:interaction.options.getString('game'),seasonId:interaction.options.getString('season'),actor:interaction.user.id});
        return interaction.editReply('Verified lifetime statistic saved. Reusing the same source ID corrects this record without double counting.');
      }
      const ledger = memberLedgerService;

      if (sub === 'history') {
        const targetUser = interaction.options.getUser('user');
        const rec = ledger.getRecord(targetUser.id);
        if (!rec) return interaction.reply({ content: `⚠️ No record found for **${targetUser.tag}**. They may not have sent any messages yet.`, flags:64 });

        const kicks = rec.kickHistory.filter(h => h.type === 'kick' || h.type === 'ban');
        const leaves = rec.kickHistory.filter(h => h.type === 'leave');
        const totalWarns = ledger.getTotalWarnings(targetUser.id);
        const lastActiveStr = rec.lastActive ? `<t:${Math.floor(rec.lastActive / 1000)}:R>` : 'Never';
        const firstSeenStr = rec.firstSeen ? `<t:${Math.floor(rec.firstSeen / 1000)}:D>` : 'Unknown';

        const historyLines = rec.kickHistory.slice(-5).map(h => {
          const icon = h.type === 'ban' ? '🔨' : h.type === 'kick' ? '🥾' : '📤';
          return `${icon} **${h.type.toUpperCase()}** — <t:${Math.floor(h.date / 1000)}:D>
> ${h.reason}`;
        });

        const embed = new EmbedBuilder()
          .setColor(kicks.length >= 2 ? 0xff0000 : kicks.length >= 1 ? 0xff8800 : 0x3498db)
          .setTitle(`📋 Member Record — ${rec.displayName || rec.username}`)
          .addFields(
            { name: '👤 Username', value: rec.username, inline: true },
            { name: '🏈 Current Team', value: rec.currentTeam || 'None', inline: true },
            { name: '📊 Messages', value: String(rec.totalMessages || 0), inline: true },
            { name: '📅 First Seen', value: firstSeenStr, inline: true },
            { name: '⏰ Last Active', value: lastActiveStr, inline: true },
            { name: '🔄 In Server', value: rec.isPresent ? '✅ Yes' : '❌ No', inline: true },
            { name: '🥾 Kicks/Bans', value: String(kicks.length), inline: true },
            { name: '📤 Left', value: String(leaves.length), inline: true },
            { name: '⚠️ Total Warnings', value: `${totalWarns} (GP:${rec.warnings.gameplay} CA:${rec.warnings.closeApp} IN:${rec.warnings.inactivity})`, inline: true },
            { name: '🏟 Past Teams', value: rec.teamHistory.length ? rec.teamHistory.map(t=>t.team).join(', ') : 'None', inline: false },
          );
        if (historyLines.length) embed.addFields({ name: '📜 History (last 5)', value: historyLines.join('\n\n').slice(0, 1024) });
        if (rec.notes.length) embed.addFields({ name: '📝 Notes', value: rec.notes.slice(-5).join('\n').slice(0, 1024) });
        embed.setFooter({ text: `User ID: ${rec.userId}` }).setTimestamp();
        return interaction.reply({ embeds: [embed], flags:64 });
      }

      if (sub === 'add-note') {
        const user = interaction.options.getUser('user');
        const note = interaction.options.getString('note');
        ledger.addNote(user.id, note, interaction.user.id);
        return interaction.reply({ content:`✅ Added note for ${user}.`, flags:64 });
      }

      const days = interaction.options.getInteger('days') || 4;
      const inactive = typeof ledger.getInactiveMembers === 'function'
        ? ledger.getInactiveMembers(days)
        : (typeof ledger.listInactiveMembers === 'function' ? ledger.listInactiveMembers(days).map(r => ({ username: r.username || r.displayName || r.userId, team: r.team || 'no team', days: r.daysInactive || r.days || days, userId: r.userId })) : []);
      if (!inactive.length) return interaction.reply({ content: `✅ All league members have been active within the last ${days} days.`, flags:64 });
      const lines = inactive.map(m => {
        const mention = m.userId ? `<@${m.userId}>` : `**${m.username}**`;
        return `⚠️ ${mention} (${m.team || 'no team'}) — **${m.days} days** since last message`;
      });
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff8800)
        .setTitle(`⏰ Inactive Members — ${inactive.length}`)
        .setDescription(lines.join('\n').slice(0, 3900))
        .setFooter({ text: `Threshold: ${days} days • Use /warn-player for inactivity warnings` })
        .setTimestamp()], flags:64 });
    }

    // ── /member-history — full ledger for a member ──

    // ── /member-note — permanent commissioner note ──

    // ── /inactive-members — show members inactive 4+ days ──
    case 'inactive-members': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const days = interaction.options.getInteger('days') || 4;
      const ledger = memberLedgerService;
      const inactive = ledger.getInactiveMembers(days);
      if (!inactive.length) return interaction.reply({ content: `✅ All league members have been active within the last ${days} days.`, flags:64 });
      const lines = inactive.map(m =>
        `⚠️ **${m.username}** (${m.team || 'no team'}) — **${m.days} days** since last message`
      );
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff8800)
        .setTitle(`⏰ Inactive Members — ${inactive.length}`)
        .setDescription(lines.join('\n').slice(0, 3900))
        .setFooter({ text: `Threshold: ${days} days • Use /warn-player for inactivity warnings` })
        .setTimestamp()], flags:64 });
    }

    // ── /ban — unified ban management ──
    case 'ban': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      // Defer first — guild.members.fetch is a network call that can exceed Discord's 3s ack window
      await interaction.deferReply({ flags:64 }).catch(() => null);
      const sub = interaction.options.getSubcommand();
      const ledger = memberLedgerService;

      if (sub === 'list') {
        const bans = ledger.getBanList();
        if (!bans.length) return interaction.editReply({ content: '✅ No banned users. The ban list is clean.', flags:64 });
        const lines = bans.map((b, i) => {
          const date = b.bannedAt ? `<t:${Math.floor(b.bannedAt / 1000)}:d>` : 'Unknown';
          return `**${i + 1}.** ${b.username} (\`${b.userId}\`)
> Banned: ${date} — ${b.reason}
> Kicks: ${b.totalKicks} | Warnings: ${b.totalWarnings}`;
        });
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b0000)
          .setTitle(`🔨 Ban List — ${bans.length} user${bans.length !== 1 ? 's' : ''}`)
          .setDescription(lines.join('\n\n').slice(0, 3900))
          .setFooter({ text: 'Use /ban remove <user-id> to remove someone from the ban list' })
          .setTimestamp()], flags:64 });
      }

      if (sub === 'add') {
        const banTarget = interaction.options.getUser('user');
        const banReason = interaction.options.getString('reason') || 'Banned by commissioner';
        ledger.recordBan(banTarget.id, banReason, interaction.user.id);
        const targetMember = await guild.members.fetch(banTarget.id).catch(() => null);
        if (targetMember && !canBotModerate(targetMember)) {
          return interaction.editReply({ content: `⚠️ **${banTarget.tag}** added to bot ban list, but cannot ban from Discord — they have higher permissions than the bot.`, flags:64 });
        }
        try {
          await guild.members.ban(banTarget.id, { reason: banReason });
        } catch (e) {
          return interaction.editReply({ content: `⚠️ **${banTarget.tag}** added to bot ban list, but Discord ban failed: ${e.message}`, flags:64 });
        }
        const bootCh = _getCh(guild, 'bootLog');
        if (bootCh) await bootCh.send({ embeds: [new EmbedBuilder().setColor(0x8b0000).setTitle('🔨 Player Banned')
          .addFields(
            { name: 'User', value: `${banTarget} (${banTarget.tag})`, inline: true },
            { name: 'Banned By', value: `${interaction.user}`, inline: true },
            { name: 'Reason', value: banReason },
          ).setTimestamp()] }).catch(() => null);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b0000).setTitle('🔨 User Banned')
          .setDescription(`**${banTarget.tag}** has been banned from the server and added to the bot ban list.

Reason: ${banReason}

Use \`/ban list\` to view all bans.
Use \`/ban remove user-id:${banTarget.id}\` to reverse.`)
          .setTimestamp()], flags:64 });
      }

      const unbanId = (interaction.options.getString('user-id') || '').trim();
      if (!/^\d{15,20}$/.test(unbanId)) return interaction.reply({ content: '❌ Invalid user ID. Right-click a user → Copy ID, or check `/ban list` for IDs.', flags:64 });
      await interaction.deferReply({ flags:64 });
      const result = await ledger.unbanUser(guild, unbanId, interaction.user.tag);
      if (!result.success) return interaction.editReply({ content: `❌ ${result.reason}` });
      const bootCh2 = _getCh(guild, 'bootLog');
      if (bootCh2) await bootCh2.send({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ User Unbanned')
        .addFields(
          { name: 'User', value: `**${result.username}** (\`${unbanId}\`)`, inline: true },
          { name: 'Unbanned By', value: `${interaction.user}`, inline: true },
        ).setTimestamp()] }).catch(() => null);
      return interaction.editReply({ content: `✅ **${result.username}** has been unbanned.

• Removed from bot ban list
• Discord server ban lifted
• They can now rejoin the server

If they rejoin, the bot will still flag them as a returning member with history.` });
    }

    // ── /ban-list — show all banned users from bot ledger ──

    // ── /ban-player — ban a user and add to bot ledger ──

    // ── /unban — remove from bot ban list + Discord server ban ──

    // ── /start-season — check readiness (15 min members) ──
    case 'start-season': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const { checkSeasonReadiness, MIN_MEMBERS_TO_START, LEAGUE_TYPES } = leagueSetupService;
      const typeId = _state.leagueConfig.leagueTypeId;
      if (!typeId) return interaction.reply({ content: '⚠️ No league set up yet. Run `/setup-league` or `/reset-league` first.', flags:64 });

      const check = checkSeasonReadiness(_state, typeId);
      const def = LEAGUE_TYPES[typeId];
      const cpuInfo = check.cpuCount > 0 ? `\n• **${check.cpuCount}** CPU-filled teams` : '';

      if (check.ready) {
        const openNote = check.openSlots > 0
          ? `\n\n**${check.openSlots} open slots** remain. Use \`/fill-cpu\` to fill them with CPU teams before starting.`
          : '';
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
          .setTitle('✅ Season Ready to Start!')
          .setDescription(
            `**${def?.label || typeId}** has enough members.\n\n` +
            `• **${check.humanCount}** human members (minimum: ${MIN_MEMBERS_TO_START})${cpuInfo}\n` +
            `• **${check.totalSlots}** total team slots` +
            openNote + `\n\n` +
            `Run \`/set-hub-week 1\` to begin Week 1.`
          ).setTimestamp()], flags:64 });
      } else {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4500)
          .setTitle('❌ Not Enough Members to Start')
          .setDescription(
            `**${def?.label || typeId}** needs more players.\n\n` +
            `• **${check.humanCount}** human members — need **${MIN_MEMBERS_TO_START}** minimum\n` +
            `• **${check.needed}** more members needed${cpuInfo}\n` +
            `• **${check.openSlots}** open team slots\n\n` +
            `Once you have ${MIN_MEMBERS_TO_START}+ human members, use \`/fill-cpu\` to fill remaining slots with CPU teams, then \`/start-season\` again.`
          ).setTimestamp()], flags:64 });
      }
    }

    // ── /fill-cpu — mark remaining open teams as CPU ──
    case 'fill-cpu': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const { fillCPUTeams, checkSeasonReadiness, MIN_MEMBERS_TO_START: MIN } = leagueSetupService;
      const typeId2 = _state.leagueConfig.leagueTypeId;

      // Check minimum members first
      const preCheck = checkSeasonReadiness(_state, typeId2);
      if (!preCheck.ready) {
        return interaction.reply({ content: `❌ Can't fill CPU teams yet — only **${preCheck.humanCount}** human members. Need **${MIN}** minimum before CPU fills.\n\nRecruit **${preCheck.needed}** more members first.`, flags:64 });
      }

      const result = fillCPUTeams(_state, typeId2);
      if (!result.filled) return interaction.reply({ content: '✅ No open slots to fill — all teams are already claimed or CPU-filled.', flags:64 });

      // Refresh the open teams board
      const { refreshOpenTeamsBoard } = openTeamsService;
      await refreshOpenTeamsBoard(guild).catch(() => null);

      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db)
        .setTitle(`🤖 ${result.filled} Teams Filled with CPU`)
        .setDescription(
          `The following teams are now CPU-controlled:\n\n` +
          result.teams.map(t => `• 🤖 ${t}`).join('\n') +
          `\n\nThe league is now full. Use \`/start-season\` to verify, then \`/set-hub-week 1\` to begin.\n\nTo undo: \`/release-cpu\``
        ).setTimestamp()], flags:64 });
    }

    // ── /release-cpu — undo CPU fills ──
    case 'release-cpu': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const { releaseCPUTeams } = leagueSetupService;
      const count = releaseCPUTeams(_state, _state.leagueConfig.leagueTypeId);
      if (!count) return interaction.reply({ content: '✅ No CPU teams to release.', flags:64 });

      const { refreshOpenTeamsBoard } = openTeamsService;
      await refreshOpenTeamsBoard(guild).catch(() => null);

      return interaction.reply({ content: `✅ **${count} CPU teams** released back to open status. The slots are available for human members again.`, flags:64 });
    }

    // ── /reset-customization — restore defaults ──
    case 'reset-customization': {
      if (!isComm()) return interaction.reply({content:'❌ Commissioners only.',flags:64});
      const what = interaction.options.getString('what');
      const { resetToDefaults } = leagueSetupService;
      const fields = what === 'all' ? ['all'] : [what];
      const result = resetToDefaults(_state, fields);

      if (!result.reset.length && result.skipped.length) {
        return interaction.reply({ content: `⚠️ Nothing to reset.\n${result.skipped.join('\n')}`, flags:64 });
      }

      // If rules were reset, republish them
      if (result.reset.includes('rules')) await _refreshRules(guild);

      const lines = [];
      if (result.reset.length) lines.push(`✅ **Reset to defaults:** ${result.reset.join(', ')}`);
      if (result.skipped.length) lines.push(`⏭️ **Skipped:** ${result.skipped.join(', ')}`);
      return interaction.reply({ content: lines.join('\n'), flags:64 });
    }



    case 'set-rules': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      _state.leagueConfig.rulesText = interaction.options.getString('text');
      _state.leagueConfig.rulesUpdatedAt = Date.now();
      await _refreshRules(guild);
      return interaction.reply({ content:'✅ League rules replaced and republished.', flags:64 });
    }

    case 'append-rule': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const textAdd = interaction.options.getString('text');
      _state.leagueConfig.rulesText = `${String(_state.leagueConfig.rulesText || '').trim()}\n${textAdd}`.trim();
      _state.leagueConfig.rulesUpdatedAt = Date.now();
      await _refreshRules(guild);
      return interaction.reply({ content:'✅ Rule text appended and republished.', flags:64 });
    }

    case 'update-rule': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const oldText = interaction.options.getString('old-text');
      const newText = interaction.options.getString('new-text');
      const appendInstead = interaction.options.getBoolean('append-instead');
      if (appendInstead) {
        _state.leagueConfig.rulesText = `${String(_state.leagueConfig.rulesText || '').trim()}\n${newText}`.trim();
      } else {
        _state.leagueConfig.rulesText = String(_state.leagueConfig.rulesText || '').replace(oldText, newText);
      }
      _state.leagueConfig.rulesUpdatedAt = Date.now();
      await _refreshRules(guild);
      return interaction.reply({ content:'✅ Rule update applied.', flags:64 });
    }

    case 'create-game': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const leagueInput = interaction.options.getString('league');
      const resolved = leagueResolver.resolveLeague(leagueInput, { guildId:guild.id, mode:'operational' });
      if (!resolved.ok) return interaction.reply({ content:`❌ ${resolved.message}`, flags:64 });
      const league = resolved.league;
      const { createGameChannel } = gameChannelService;
      const week = interaction.options.getInteger('week');
      const team1 = interaction.options.getString('team1');
      const team2 = interaction.options.getString('team2');
      const registry = _state.openTeamRegistry.filter(t => String(t.leagueId || '') === String(league.id));
      const t1 = registry.find(t => norm(t.baseTeam) === norm(team1) || norm(t.displayTeam) === norm(team1));
      const t2 = registry.find(t => norm(t.baseTeam) === norm(team2) || norm(t.displayTeam) === norm(team2));
      if (!t1 || !t2) return interaction.reply({ content:`⚠️ Both teams must belong to **${league.leagueName || league.id}**.`, flags:64 });
      if (String(t1.baseTeam).toLowerCase() === String(t2.baseTeam).toLowerCase()) return interaction.reply({ content:'⚠️ Choose two different teams.', flags:64 });
      const override1 = interaction.options.getUser('user1');
      const override2 = interaction.options.getUser('user2');
      const user1 = override1 || (t1.ownerId ? await guild.members.fetch(t1.ownerId).catch(()=>null) : null);
      const user2 = override2 || (t2.ownerId ? await guild.members.fetch(t2.ownerId).catch(()=>null) : null);
      const primetime = !!interaction.options.getBoolean('primetime');
      const channel = await createGameChannel(guild, week, t1.baseTeam, user1, t2.baseTeam, user2, primetime, false, false, { game: league.game || _state.leagueConfig.game, leagueTag: league.leagueName || league.id, leagueId:league.id });
      if (!channel) return interaction.reply({ content:'⚠️ Could not create the game channel. Make sure both teams are owned by members.', flags:64 });
      return interaction.reply({ content:`✅ Game channel created for **${league.leagueName || league.id}**: ${channel}`, flags:64 });
    }

    case 'respond': {
      const game = _state.games.get(interaction.channelId);
      if (!game) return interaction.reply({ content:'⚠️ Use this command inside an active game channel.', flags:64 });
      game.responded = game.responded || new Set();
      game.responded.add(interaction.user.id);
      try { require('../league/gameSessionService').markResponded(interaction.channelId, interaction.user.id); } catch {}
      return interaction.reply({ content:'✅ Response logged. The commissioner can now see you answered in this matchup.', flags:64 });
    }

    case 'report-result': {
      // One canonical result owner. League scope is taken from the game session when possible,
      // otherwise the caller must provide a league that resolves unambiguously.
      const game = _state.games.get(interaction.channelId);
      const leagueInput = interaction.options.getString('league');
      let leagueId = game?.leagueId || null;
      let league = leagueId ? activeLeagueService.getLeague(leagueId) : null;
      if (!leagueId) {
        if (!leagueInput) return interaction.reply({ content:'⚠️ This is not a scoped game channel. Choose the league for this result.', flags:64 });
        const resolved = leagueResolver.resolveLeague(leagueInput, { guildId:guild.id, mode:'operational' });
        if (!resolved.ok) return interaction.reply({ content:`❌ ${resolved.message}`, flags:64 });
        league = resolved.league; leagueId = league.id;
      } else if (leagueInput) {
        const resolved = leagueResolver.resolveLeague(leagueInput, { guildId:guild.id, mode:'operational' });
        if (!resolved.ok || String(resolved.league.id) !== String(leagueId)) return interaction.reply({ content:'❌ The selected league does not match this game channel.', flags:64 });
      }
      const winner = interaction.options.getString('winner');
      const loser = interaction.options.getString('loser');
      const scopedTeams = _state.openTeamRegistry.filter(t => String(t.leagueId || '') === String(leagueId));
      const winnerEntry = scopedTeams.find(t => norm(t.baseTeam) === norm(winner) || norm(t.displayTeam) === norm(winner));
      const loserEntry = scopedTeams.find(t => norm(t.baseTeam) === norm(loser) || norm(t.displayTeam) === norm(loser));
      if (!winnerEntry || !loserEntry) return interaction.reply({ content:`⚠️ Winner and loser must both belong to **${league?.leagueName || leagueId}**.`, flags:64 });
      if (norm(winnerEntry.baseTeam) === norm(loserEntry.baseTeam)) return interaction.reply({ content:'⚠️ Winner and loser must be different teams.', flags:64 });
      const winnerScore = interaction.options.getInteger('winner-score');
      const loserScore = interaction.options.getInteger('loser-score');
      const gameResultService = require('../league/gameResultService');
      const week = game?.week || _state.scheduleState.week || null;
      const result = await gameResultService.submitGameResult({
        homeTeam: winnerEntry.baseTeam, awayTeam: loserEntry.baseTeam, homeScore: winnerScore, awayScore: loserScore,
        week, source: 'slash-command', submittedBy: interaction.user.id,
        channelId: game ? interaction.channelId : null,
        leagueId,
      }, { state: _state, guild });
      if (!result.ok) return interaction.reply({ content:`⚠️ Result not recorded: ${result.reason}`, flags:64 });
      const note = result.deduped ? '\nℹ️ Identical result was already recorded — nothing changed.'
        : result.superseded ? '\n♻️ Previous result for this matchup was replaced; standings were corrected.'
        : result.standings.updated ? `\n📊 Standings updated.` : '';
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('🏁 Final Score Reported').setDescription(`**${winnerEntry.displayTeam || winnerEntry.baseTeam}** ${winnerScore} - ${loserScore} **${loserEntry.displayTeam || loserEntry.baseTeam}**${note}`).setFooter({text:league?.leagueName || String(leagueId)}).setTimestamp()], flags:64 });
    }

    case 'rewards-board': {
      const rewardBoards = rewardBoardService;
      return interaction.reply({ embeds:[rewardBoards.buildStreamBoardEmbed(), rewardBoards.buildPotwBoardEmbed(), rewardBoards.buildYearlyAwardBoardEmbed()], flags:64 });
    }

    case 'refresh-rewards': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      await rewardBoardService.refresh(guild);
      return interaction.reply({ content:'✅ Reward boards refreshed.', flags:64 });
    }

    case 'set-hub-week': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const week = interaction.options.getInteger('week');
      const { resetHubWeek, startHubReleaseTimer } = hubReleaseService;
      resetHubWeek(week, _state);
      startHubReleaseTimer(guild, _client, _state, { getCh: _getCh, aiCall: _aiCall, MODELS: _MODELS });
      return interaction.reply({ content:`✅ Hub week set to **${week}** and release timer restarted.`, flags:64 });
    }

    case 'release-week': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      await interaction.deferReply({ flags:64 });
      const { runWeeklyRelease } = hubReleaseService;
      await runWeeklyRelease(guild, _client, _state, { getCh: _getCh, aiCall: _aiCall, MODELS: _MODELS }, true).catch(() => null);
      return interaction.editReply('✅ Weekly release ran now.');
    }

    case 'hub-status': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const hub = _state.hubWeeklyData || {};
      return interaction.reply({ content:`📦 Hub status\nWeek: **${hub.week || 'N/A'}**\nScores: **${hub.scores?.length || 0}**\nStat lines: **${hub.statLines?.length || 0}**\nStandings: **${hub.standings ? 'loaded' : 'none'}**\nReleased: **${hub.released ? 'yes' : 'no'}**`, flags:64 });
    }

    case 'clear-hub': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const week = _state.hubWeeklyData.week;
      _state.hubWeeklyData = { week, scores: [], statLines: [], standings: null, potwCandidate: null, released: false, releaseTimerId: _state.hubWeeklyData.releaseTimerId || null, potwTimerId: null };
      return interaction.reply({ content:'🧹 Cleared staged hub data for the current week.', flags:64 });
    }

    case 'cancel-potw-timer': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      require('../services/schedulerRegistryService').cancel('potw-followup', guild.id);
      if (_state.hubWeeklyData.potwTimerId) clearTimeout(_state.hubWeeklyData.potwTimerId);
      _state.hubWeeklyData.potwTimerId = null;
      _state.hubWeeklyData.potwDueAt = null;
      _state.hubWeeklyData.potwAttempts = 0;
      return interaction.reply({ content:'✅ POTW timer cancelled.', flags:64 });
    }

    case 'cancel-release-timer': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      if (_state.hubWeeklyData.releaseTimerId) clearTimeout(_state.hubWeeklyData.releaseTimerId);
      _state.hubWeeklyData.releaseTimerId = null;
      return interaction.reply({ content:'✅ Release timer cancelled.', flags:64 });
    }

    case 'advance-week': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const { parseMatchupLines, postScheduleEmbed, startScheduleTimer } = hubReleaseService;
      const week = interaction.options.getInteger('week');
      const raw = interaction.options.getString('matchups');
      const matchups = parseMatchupLines(raw, guild, _state.players);
      _state.scheduleState.week = week;
      _state.scheduleState.matchups = matchups;
      scheduleRegistryService.upsertWeek(week, matchups, { source: 'manual_advance', importedAt: Date.now() });
      await postScheduleEmbed(guild, _state, _getCh, getTeamEmoji);
      startScheduleTimer(guild, _state, _getCh, getTeamEmoji);
      // V202: manual compatibility path — records the commissioner-set week in the advance engine and re-arms its deadline.
      try {
        require('../league/advanceEngine').recordManualAdvance({ week, actor: interaction.user.id });
        require('../services/leagueAutomationService').rearm({ guild, state: _state });
      } catch (e) { log.warn(`advance-week engine sync failed: ${e.message}`); }
      return interaction.reply({ content:`✅ Week **${week}** schedule posted with **${matchups.length}** matchups.`, flags:64 });
    }

    case 'repost-schedule': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const { postScheduleEmbed } = hubReleaseService;
      await postScheduleEmbed(guild, _state, _getCh, getTeamEmoji);
      return interaction.reply({ content:'✅ Current schedule reposted.', flags:64 });
    }

    case 'set-weekly-automation': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const cfg = weeklyAutomationService.saveWeeklySettings({
        mode: interaction.options.getString('mode'),
        advanceHours: interaction.options.getInteger('advance-hours') || undefined,
        autoCreateGameChannels: interaction.options.getBoolean('auto-create-game-channels'),
        clearPreviousWeekChannels: interaction.options.getBoolean('clear-previous-week-channels'),
      });
      _syncPolicyFromWeekly(cfg, guild);
      return interaction.reply({ content:`✅ Weekly automation saved. Mode: **${cfg.mode}**. Advance cycle: **${cfg.advanceHours}h**.`, flags:64 });
    }

    case 'weekly-automation-status': {
      const cfg = weeklyAutomationService.getWeeklySettings();
      return interaction.reply({ content:`🤖 Weekly automation\nMode: **${cfg.mode}**\nAdvance cycle: **${cfg.advanceHours}h**\nAuto create: **${cfg.autoCreateGameChannels ? 'yes' : 'no'}**\nClear previous: **${cfg.clearPreviousWeekChannels ? 'yes' : 'no'}**`, flags:64 });
    }




    case 'propose-trade': {
      const yourTeam = interaction.options.getString('your-team');
      const targetTeam = interaction.options.getString('target-team');
      const details = interaction.options.getString('details');
      const leagueId = (() => { try { return require('../league/spaceContext').current() || null; } catch { return null; } })();
      const proposal = require('../services/tradeWorkflowService').propose(_state, {
        proposerId: interaction.user.id, yourTeam, targetTeam, details, leagueId,
      });
      if (!proposal.ok) {
        const friendly = proposal.reason === 'league-ambiguous'
          ? `That team exists in multiple leagues (${(proposal.leagues || []).join(', ')}). Run the command from the league scope you mean.`
          : proposal.reason;
        return interaction.reply({ content:`❌ Trade proposal was not created: **${friendly}**.`, flags:64 });
      }
      const trade = proposal.trade;
      const ch = _getCh(guild, 'pendingTrades');
      if (ch) await ch.send(`📨 **${trade.tradeId}**
**${trade.proposerTeam}** ↔ **${trade.targetTeam}**
${trade.details}
Proposed by <@${interaction.user.id}>`).catch(() => null);
      return interaction.reply({ content:`✅ Trade proposal submitted as **${trade.tradeId}**.`, flags:64 });
    }

    case 'transaction': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const type = interaction.options.getString('type');
      const team = interaction.options.getString('team');
      const player = interaction.options.getString('player');
      const details = interaction.options.getString('details') || '';
      const ch = _getCh(guild, 'transactions');
      if (ch) await ch.send(`🧾 **${type.toUpperCase()}**\n**Team:** ${team}\n**Player:** ${player}${details ? `\n**Details:** ${details}` : ''}`).catch(() => null);
      return interaction.reply({ content:'✅ Transaction announced.', flags:64 });
    }

    case 'stream-board': {
      const rewardBoards = rewardBoardService;
      return interaction.reply({ embeds:[rewardBoards.buildStreamBoardEmbed()], flags:64 });
    }

    case 'my-streams': {
      const player = [..._state.players.values()].find(p => String(p.userId) === String(interaction.user.id));
      if (!player) return interaction.reply({ content:'⚠️ You are not linked to a claimed team yet.', flags:64 });
      return interaction.reply({ content:`📺 **${player.displayTeam}** has **${player.streamCount || 0}** stream credits.`, flags:64 });
    }

    case 'restore-stream': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const team = interaction.options.getString('team');
      const url = interaction.options.getString('url') || '';
      const streamOps = streamOpsService;
      const player = await streamOps.addCount(_state, team, url,{guildId:guild.id,operationId:interaction.id});
      if (!player) return interaction.reply({ content:'❌ Could not find that team.', flags:64 });
      return interaction.reply({ content:`✅ Restored one stream credit to **${player.displayTeam}**. Total: **${player.streamCount || 0}**.`, flags:64 });
    }

    case 'set-timezone': {
      const ackMode = await _ackLongInteraction(interaction, '🕒 Saving timezone...');
      const result = await _saveMemberTimezoneAndSync(interaction.member, interaction.options.getString('timezone'), { channelId: interaction.channelId, advanceWizard: true });
      if (!result.ok) return _updateLongInteraction(interaction, ackMode, { content:'❌ Invalid timezone. Use a real timezone like America/Los_Angeles, America/New_York, PST, EST, or UTC.' });
      const extra = result.updatedPlayers ? ` Linked team records updated: **${result.updatedPlayers}**.` : ' Your member profile is now ready for scheduling and template-aware server flows.';
      return _updateLongInteraction(interaction, ackMode, { content: `✅ Timezone saved as **${result.timezone}** (${result.label}).${extra}` });
    }

    case 'add-member-note': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const ledger = memberLedgerService;
      const user = interaction.options.getUser('user');
      const note = interaction.options.getString('note');
      ledger.addNote(user.id, note, interaction.user.id);
      return interaction.reply({ content:`✅ Added note for ${user}.`, flags:64 });
    }

    case 'check-inactive': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const ledger = memberLedgerService;
      const inactive = ledger.listInactiveMembers(4).slice(0, 20);
      return interaction.reply({ content: inactive.length ? inactive.map(r => `• <@${r.userId}> — ${r.daysInactive} days inactive`).join('\n') : '✅ No inactive members at 4+ days.', flags:64 });
    }


    case 'set-team-logo': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const leagueInput = interaction.options.getString('league');
      const resolved = leagueResolver.resolveLeague(leagueInput, { guildId:guild.id, mode:'operational' });
      if (!resolved.ok) return interaction.reply({ content:`❌ ${resolved.message}`, flags:64 });
      const league = resolved.league;
      const team = interaction.options.getString('team');
      const logoUrl = interaction.options.getString('logo-url');
      const entry = _state.openTeamRegistry.find(t => String(t.leagueId || '') === String(league.id) && (norm(t.baseTeam) === norm(team) || norm(t.displayTeam) === norm(team)));
      if (!entry) return interaction.reply({ content:`⚠️ Team not found in **${league.leagueName || league.id}**.`, flags:64 });
      entry.logoUrl = logoUrl;
      await openTeamsService.refreshOpenTeamsBoard(guild).catch(() => null);
      return interaction.reply({ content:`✅ Updated logo for **${entry.displayTeam}** in **${league.leagueName || league.id}**.`, flags:64 });
    }

    case 'set-stat-leaders': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      _state.currentStatLeaders = {
        week: interaction.options.getInteger('week'),
        passing: interaction.options.getString('passing'),
        rushing: interaction.options.getString('rushing'),
        receiving: interaction.options.getString('receiving'),
        defense: interaction.options.getString('defense'),
        special: interaction.options.getString('special') || '',
      };
      await rewardBoardService.refresh(guild).catch(() => null);
      return interaction.reply({ content:'✅ Stat leaders saved and rewards boards refreshed.', flags:64 });
    }

    case 'player-of-the-week': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const entry = {
        week: _state.hubWeeklyData.week || _state.scheduleState.week || 1,
        type: interaction.options.getString('conference'),
        player: interaction.options.getString('player'),
        displayTeam: interaction.options.getString('team'),
        statLine: interaction.options.getString('stat-line') || '',
        reason: interaction.options.getString('reason') || '',
        userId: interaction.options.getUser('user')?.id || null, sourceId:interaction.id,
        awardedAt: Date.now(),
      };
      await _saveLifetimeAward(interaction, { ...entry, title: 'Player of the Week' });
      _state.potwHistory.push(entry);
      await rewardBoardService.refresh(guild).catch(() => null);
      return interaction.reply({ content:`✅ POTW saved for **${entry.player}** (${entry.displayTeam}).`, flags:64 });
    }

    case 'potw-confirm': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const action = interaction.options.getString('action');
      const player = interaction.options.getString('player') || _state.hubWeeklyData?.potwCandidate?.player || 'AI pick';
      const team = interaction.options.getString('team') || _state.hubWeeklyData?.potwCandidate?.team || 'Unknown';
      const statLine = interaction.options.getString('stat-line') || _state.hubWeeklyData?.potwCandidate?.statLine || '';
      const reason = interaction.options.getString('reason') || (action === 'confirm' ? 'Confirmed AI selection' : 'Commissioner override');
      await _saveLifetimeAward(interaction, { userId: interaction.options.getUser('user')?.id, title: 'League Player of the Week', player, displayTeam:team });
      _state.potwHistory.push({ sourceId:interaction.id, userId:interaction.options.getUser('user')?.id, week: _state.hubWeeklyData.week || _state.scheduleState.week || 1, type: 'LEAGUE', player, displayTeam: team, statLine, reason, awardedAt: Date.now() });
      await rewardBoardService.refresh(guild).catch(() => null);
      return interaction.reply({ content:`✅ Best-in-League POTW ${action === 'confirm' ? 'confirmed' : 'overridden'} for **${player}**.`, flags:64 });
    }

    case 'attr-award': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const players = interaction.options.getString('players');
      const attr1 = interaction.options.getString('attribute1') || interaction.options.getString('attr1-category');
      const attr2 = interaction.options.getString('attribute2') || interaction.options.getString('attr2-category') || '';
      const reason = interaction.options.getString('reason') || 'Commissioner award';
      await _saveLifetimeAward(interaction, {userId:interaction.options.getUser('user')?.id,title:'Attribute award',player:players,details:reason});
      const ch = _getCh(guild, 'devUpgrades') || _getCh(guild, 'announcements');
      if (ch) await ch.send(`🎯 **Attribute Award**\n**Players:** ${players}\n**Boost 1:** ${attr1}${attr2 ? `\n**Boost 2:** ${attr2}` : ''}\n**Reason:** ${reason}`).catch(() => null);
      return interaction.reply({ content:'✅ Attribute award posted.', flags:64 });
    }

    case 'yearly-award': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const award = interaction.options.getString('award');
      const player = interaction.options.getString('player');
      const team = interaction.options.getString('team');
      const isXF = !!interaction.options.getBoolean('is-xfactor');
      const user = interaction.options.getUser('user');
      const season = (_state.superbowlHistory.slice(-1)[0]?.season || 0) + 1;
      await _saveLifetimeAward(interaction, { userId:user?.id, title:award, player, displayTeam:team, season });
      _state.yearlyAwardHistory.push({ sourceId:interaction.id, season, awardLabel: award, player, displayTeam: team, isXF, userId: user?.id || null, details: interaction.options.getString('details') || '', awardedAt: Date.now() });
      await rewardBoardService.refresh(guild).catch(() => null);
      return interaction.reply({ content:`✅ Yearly award saved: **${award}** for **${player}**.`, flags:64 });
    }

    case 'superbowl-champion': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const team = interaction.options.getString('team');
      const user = interaction.options.getUser('user');
      const score = interaction.options.getString('score') || '';
      const season = interaction.options.getInteger('season') || ((_state.superbowlHistory.slice(-1)[0]?.season || 0) + 1);
      await _saveLifetimeAward(interaction, { userId:user?.id, title:'Super Bowl Champion', displayTeam:team, season });
      _state.superbowlHistory.push({ sourceId:interaction.id, season, displayTeam: team, userId: user?.id || null, score, awardedAt: Date.now() });
      await rewardBoardService.refresh(guild).catch(() => null);
      return interaction.reply({ content:`🏆 Super Bowl champion recorded for Season **${season}**: **${team}**.`, flags:64 });
    }

    case 'claim-attr-boost': {
      const team = interaction.options.getString('team');
      const player = interaction.options.getString('player');
      const source = interaction.options.getString('source');
      const boostId = _state.nextBoostId ? _state.nextBoostId() : `boost_${Date.now()}`;
      const request = {
        boostId,
        requesterId: interaction.user.id,
        team,
        player,
        source,
        attr1Category: interaction.options.getString('attr1-category'),
        attribute1: interaction.options.getString('attribute1') || '',
        attr2Category: interaction.options.getString('attr2-category') || '',
        attribute2: interaction.options.getString('attribute2') || '',
        createdAt: Date.now(),
      };
      _state.pendingAttrBoosts.set(boostId, request);
      const ch = _getCh(guild, 'devUpgrades') || _getCh(guild, 'adminHq');
      if (ch) await ch.send(`📝 **Attr Boost Request ${boostId}**\n**Team:** ${team}\n**Player:** ${player}\n**Source:** ${source}\nRequested by <@${interaction.user.id}>`).catch(() => null);
      return interaction.reply({ content:`✅ Attribute boost request submitted as **${boostId}**.`, flags:64 });
    }

    case 'warn-player': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const user = interaction.options.getUser('user');
      const type = interaction.options.getString('type');
      const reason = interaction.options.getString('reason') || 'Commissioner warning';
      const ledger = memberLedgerService;
      const rec = ledger.recordWarning(user.id, type, reason);
      const warnCh = _getCh(guild, 'warningsLog');
      if (warnCh) await warnCh.send(`⚠️ ${user} warned for **${type}**. Reason: ${reason}. Total warnings: **${rec.warnings.total}**`).catch(() => null);
      return interaction.reply({ content:`✅ Warning issued to ${user}. Total warnings: **${rec.warnings.total}**.`, flags:64 });
    }

    case 'clear-strikes': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const user = interaction.options.getUser('user');
      _state.spamTracker.delete(user.id);
      return interaction.reply({ content:`✅ Cleared spam strikes for ${user}.`, flags:64 });
    }

    case 'edit-message': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      await interaction.deferReply({ flags:64 });
      const messageId = interaction.options.getString('message-id');
      const newText = interaction.options.getString('text');
      for (const channel of guild.channels.cache.values()) {
        if (!channel?.isTextBased?.()) continue;
        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (!msg || msg.author.id !== _client.user.id) continue;
        if (msg.embeds?.length) {
          const embed = EmbedBuilder.from(msg.embeds[0]).setDescription(newText);
          await msg.edit({ embeds: [embed] }).catch(() => null);
        } else {
          await msg.edit(newText).catch(() => null);
        }
        return interaction.editReply(`✅ Edited bot message in ${channel}.`);
      }
      return interaction.editReply('⚠️ Bot message not found by that ID.');
    }

    case 'health-status': {
      if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags:64 });
      await interaction.deferReply({ flags:64 }).catch(() => null);
      try {
        const { runStartupHealthCheck } = require('../services/startupHealthCheckService');
        const health = await runStartupHealthCheck();
        const { results } = health;
        const lines = results.map(r => {
          const icon = r.ok ? '✅' : r.blocking ? '❌' : '⚠️';
          const impact = !r.ok ? `\n> **Impact:** ${r.blocking ? 'Blocks authoritative automation/readiness' : 'Non-blocking warning'}` : '';
          const fixLine = r.fix ? `\n> **Fix:** ${r.fix}` : '';
          return `${icon} **${r.name}**\n> ${r.value}${impact}${fixLine}`;
        });
        const title = health.ok
          ? '✅ System Health — All Operational'
          : health.ready
            ? `⚠️ System Health — Ready with ${health.warnings} Warning(s)`
            : `❌ System Health — Readiness Blocked (${health.blockingFailures})`;
        return interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor(health.ok ? 0x2ecc71 : health.ready ? 0xffa500 : 0xe74c3c)
          .setTitle(title)
          .setDescription(lines.join('\n\n').slice(0, 4096))
          .setFooter({ text: 'Health separates blocking dependencies from optional/degraded features.' })
          .setTimestamp()] });
      } catch (err) {
        return interaction.editReply({ content: `❌ Health check failed: ${err.message}` });
      }
    }

    case 'audit-log': {
      if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags:64 });
      const limit = Math.min(interaction.options.getInteger('limit') || 20, 50);
      const entries = securityMiddleware.getRecentAuditLog(limit);
      if (!entries.length) {
        return interaction.reply({ content: '✅ No audit log entries yet.', flags:64 });
      }
      const lines = entries.map(e => {
        const icon = e.severity === 'critical' ? '🚨' : e.severity === 'warn' ? '⚠️' : 'ℹ️';
        const ts = e.timestamp ? `<t:${Math.floor(new Date(e.timestamp).getTime() / 1000)}:R>` : 'recently';
        const who = e.userId ? `<@${e.userId}>` : 'system';
        return `${icon} **${e.action}** — ${who} ${ts}${e.details ? `\n> ${e.details.slice(0, 120)}` : ''}`;
      });
      const chunks = [];
      let current = '';
      for (const line of lines) {
        if ((current + '\n' + line).length > 3800) { chunks.push(current); current = line; }
        else current = current ? current + '\n' + line : line;
      }
      if (current) chunks.push(current);
      return interaction.reply({ embeds: chunks.slice(0, 3).map((c, i) => new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(i === 0 ? `🔍 Security Audit Log (last ${entries.length})` : '🔍 Audit Log (cont.)')
        .setDescription(c)
        .setTimestamp()), flags:64 });
    }

    case 'security-audit': {
      if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags:64 });
      const sub = interaction.options.getSubcommand();
      const secMw = require('../services/securityMiddlewareService');

      if (sub === 'log') {
        const limit = interaction.options.getInteger('limit') || 20;
        const entries = secMw.getRecentAuditLog(Math.min(limit, 50));
        if (!entries.length) return interaction.reply({ content: '✅ Audit log is empty.', flags:64 });
        const lines = entries.map(e => {
          const icon = e.severity === 'critical' ? '🚨' : e.severity === 'warn' ? '⚠️' : 'ℹ️';
          const ts = e.timestamp ? `<t:${Math.floor(new Date(e.timestamp).getTime()/1000)}:R>` : '';
          return `${icon} **${e.action}** ${ts}${e.userId ? ` — <@${e.userId}>` : ''}${e.details ? `\n> ${e.details.slice(0,120)}` : ''}`;
        }).join('\n');
        return interaction.reply({ embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle(`🔒 Security Audit Log (last ${entries.length})`)
          .setDescription(lines.slice(0, 3900))
          .setTimestamp()], flags:64 });
      }

      if (sub === 'rate-limits') {
        return interaction.reply({ content: '📊 Rate limits are active. Use `/security-audit log` to see blocked interactions.', flags:64 });
      }

      return interaction.reply({ content: '⚠️ Unknown subcommand.', flags:64 });
    }

    case 'workflow': {
      if (!isComm()) return interaction.reply({ content: '❌ Commissioners only.', flags:64 });
      if (require('../services/commandAliasService').isAliasedPath(interaction)) return interaction.reply({ content:'⚠️ This command could not be routed. Nothing was run — please try again.', flags:64 }); // V203 fail-closed
      const sub = interaction.options.getSubcommand();

      if (sub === 'list') {
        const workflows = workflowEngine.listWorkflows();
        const lines = workflows.map(w => `• **${w.name}** — ${w.stepCount} step(s)`).join('\n');
        return interaction.reply({ embeds: [new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('⚙️ Registered Workflows')
          .setDescription(lines || 'No workflows defined.')
          .setFooter({ text: 'Use /workflow run to execute a workflow' })
          .setTimestamp()], flags:64 });
      }

      if (sub === 'log') {
        const log_ = workflowEngine.getRunLog(20);
        const lines = log_.map(e =>
          `${e.status === 'completed' ? '✅' : e.status === 'failed' ? '❌' : e.status === 'skipped' ? '⏭' : '🔄'} **${e.step}** (${e.workflowId}) — ${e.status}${e.error ? ': ' + e.error : ''}`
        ).join('\n');
        return interaction.reply({ embeds: [new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle('📋 Workflow Run Log (last 20)')
          .setDescription(lines || 'No workflow runs recorded yet.')
          .setTimestamp()], flags:64 });
      }

      if (sub === 'run') {
        const name = interaction.options.getString('name');
        await interaction.deferReply({ flags:64 }).catch(() => null);
        const ctx = { guild, state: _state, client: _client };
        const result = await workflowEngine.run(name, ctx);
        const statusIcon = result.ok ? '✅' : '⚠️';
        const lines = [
          ...result.results.map(r => `✅ ${r.step}`),
          ...result.errors.map(e => `❌ ${e.step}: ${e.error}`),
        ].join('\n') || 'No steps ran.';
        return interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor(result.ok ? 0x2ecc71 : 0xffa500)
          .setTitle(`${statusIcon} Workflow: ${name}`)
          .setDescription(lines)
          .setFooter({ text: `ID: ${result.workflowId || 'n/a'}` })
          .setTimestamp()] });
      }

      return interaction.reply({ content: '⚠️ Unknown workflow subcommand.', flags:64 });
    }

    case 'dashboard': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const reg = scheduleRegistryService.getRegistry();
      const auto = weeklyAutomationService.getWeeklySettings();
      const sync = liveSync.getLiveSyncConfig();
      const gameCfg = gameChannelCompatService.getConfig();
      const claimed = _state.openTeamRegistry.filter(t => !t.isOpen).length;
      const open = _state.openTeamRegistry.filter(t => t.isOpen).length;
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`📊 ${resolveServerName(guild, 'this server')} Operations Dashboard`)
          .addFields(
            { name: 'Active leagues', value: String(activeLeagueService.listResetOptions(_state).length), inline: true },
            { name: 'Schedule weeks stored', value: String(Object.keys(reg.weeks || {}).length), inline: true },
            { name: 'Current week', value: String(reg.currentWeek || _state.scheduleState.week || 'N/A'), inline: true },
            { name: 'Teams', value: `Open: **${open}**\nClaimed: **${claimed}**`, inline: true },
            { name: 'Weekly automation', value: `Mode: **${auto.mode}**\nAuto-create: **${auto.autoCreateGameChannels ? 'yes' : 'no'}**`, inline: true },
            { name: 'Live sync', value: `Mode: **${sync.sourceMode}**\nProvider: **${sync.provider}**`, inline: true },
            { name: 'Game channel config', value: `Scoreboard: **${gameCfg.scoreboardChannelId ? 'set' : 'not set'}**\nWait role: **${gameCfg.waitRoleId ? 'set' : 'not set'}**`, inline: false },
          )
          .setTimestamp()],
        flags:64,
      });
    }

    case 'league-export': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const sub = interaction.options.getSubcommand();
      if (sub === 'receiver-url') {
        const leagueId = interaction.options.getString('league');
        const provider = interaction.options.getString('provider');
        const minutes = interaction.options.getInteger('minutes') || 60;
        if (!leagueId || leagueId === '_none_') return interaction.reply({ content:'❌ Choose the exact active league that should receive this export.', flags:64 });
        const league = activeLeagueService.getLeague(leagueId) || activeLeagueService.listResetOptions(_state).find(l => String(l.id) === String(leagueId));
        if (!league) return interaction.reply({ content:'❌ That league is no longer active.', flags:64 });
        const actions = require('../services/providerConnectionActionService');
        const out = await actions.temporaryUrl({ leagueId, provider, minutes }).catch(e => ({ok:false,reason:e.message}));
        if (!out?.ok) {
          const hint = out?.reason === 'public-base-url-required'
            ? '\n\nSet `PUBLIC_BASE_URL` to the public HTTPS address of the bot (or use Railway `RAILWAY_PUBLIC_DOMAIN`).'
            : out?.reason === 'provider-http-disabled'
              ? '\n\nSet `ENABLE_PROVIDER_HTTP=true` in Railway, then redeploy before generating a receiver URL.'
              : '';
          return interaction.reply({ content:`❌ Could not create the temporary receiver URL: **${out?.reason || 'unknown error'}**.${hint}`, flags:64 });
        }
        const expires = Math.floor(out.expiresAt / 1000);
        return interaction.reply({
          embeds:[new EmbedBuilder().setColor(0x3498db).setTitle('🔗 Temporary League Export Receiver').setDescription(
            `**League:** ${league.leagueName}\n**Provider:** ${provider === 'companion_export' ? 'Madden Companion' : 'NeonSportz'}\n**Valid until:** <t:${expires}:F> (<t:${expires}:R>)\n\nPaste this URL into the external app's export/webhook destination:\n\n\`${out.receiverUrl}\`\n\nThe link can receive multiple exports until it expires. Generating a new URL invalidates the previous one. Receiving data does **not** advance the week automatically.`
          ).setFooter({text:'Keep this URL private. It contains a temporary bearer token and is shown only in this commissioner-only response.'}).setTimestamp()],
          flags:64,
        });
      }
      let payload;
      if (sub === 'current') payload = scheduleRegistryService.exportCurrentWeek(_state);
      if (sub === 'all-weeks') payload = scheduleRegistryService.exportAllWeeks(_state);
      if (sub === 'week') {
        const week = interaction.options.getInteger('week');
        const reg = scheduleRegistryService.getRegistry();
        payload = {
          schema: 'nofunleague-schedule-export',
          version: 1,
          exportedAt: Date.now(),
          source: reg.source,
          currentWeek: week,
          weeks: { [String(week)]: scheduleRegistryService.getWeek(week) },
          teams: reg.teams || [],
          players: reg.players || [],
        };
      }
      const buf = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
      return interaction.reply({
        content: '✅ League export ready.',
        files: [new AttachmentBuilder(buf, { name: `nofunleague_${sub}.json` })],
        flags:64,
      });
    }

    case 'game-channels': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      if (require('../services/commandAliasService').isAliasedPath(interaction)) return interaction.reply({ content:'⚠️ This command could not be routed. Nothing was run — please try again.', flags:64 }); // V203 fail-closed
      const sub = interaction.options.getSubcommand();
      if (sub === 'configure') {
        const scoreboardChannel = interaction.options.getChannel('scoreboard-channel');
        const adminRole = interaction.options.getRole('admin-role');
        const waitRole = interaction.options.getRole('wait-role');
        const cfg = gameChannelCompatService.saveConfig({
          scoreboardChannelId: scoreboardChannel?.id || null,
          adminRoleId: adminRole?.id || null,
          waitRoleId: waitRole?.id || null,
        });
        return interaction.reply({ content:`✅ Game channel settings saved. Scoreboard: **${cfg.scoreboardChannelId ? 'set' : 'not set'}**.`, flags:64 });
      }
      if (sub === 'create') {
        await interaction.deferReply({ flags:64 });
        const result = await gameChannelCompatService.createFromCurrentSchedule(guild, _state, _state.players);
        return interaction.editReply(`✅ Created **${result.created || 0}** weekly game channels for Week **${result.week || _state.scheduleState.week || '?'}**.`);
      }
      if (sub === 'clear') {
        await interaction.deferReply({ flags:64 });
        const result = await gameChannelCompatService.clearCurrent(guild, 'Manual game channel clear');
        return interaction.editReply(`🧹 Cleared **${result.deleted || 0}** weekly game channels.`);
      }
      if (sub === 'rebuild') {
        await interaction.deferReply({ flags:64 });
        const result = await weeklyAutomationService.rebuildCurrentWeekChannels(guild, _state, _state.players, 'Manual rebuild subcommand');
        return interaction.editReply(`🔁 Rebuilt Week **${result.week || _state.scheduleState.week || '?'}** channels. Cleared **${result.cleared || 0}**, created **${result.created || 0}**.`);
      }
      if (sub === 'automation') {
        const cfg = weeklyAutomationService.saveWeeklySettings({
          mode: interaction.options.getString('mode'),
          advanceHours: interaction.options.getInteger('advance-hours') || undefined,
          autoCreateGameChannels: interaction.options.getBoolean('auto-create-game-channels'),
          clearPreviousWeekChannels: interaction.options.getBoolean('clear-previous-week-channels'),
        });
        _syncPolicyFromWeekly(cfg, guild);
        return interaction.reply({ content:`✅ Weekly automation saved. Mode: **${cfg.mode}**. Advance cycle: **${cfg.advanceHours}h**.`, flags:64 });
      }
      if (sub === 'status') {
        const cfg = weeklyAutomationService.getWeeklySettings();
        return interaction.reply({ content:`🤖 Weekly automation
Mode: **${cfg.mode}**
Advance cycle: **${cfg.advanceHours}h**
Auto create: **${cfg.autoCreateGameChannels ? 'yes' : 'no'}**
Clear previous: **${cfg.clearPreviousWeekChannels ? 'yes' : 'no'}**`, flags:64 });
      }
      if (_GAME_CHANNEL_V202_SUBCOMMANDS.has(sub)) return _handleGameChannelsV202(interaction, sub, guild);
      const note = interaction.options.getString('message') || 'Commissioner reminder: please post availability or finish the matchup.';
      const result = await gameChannelCompatService.notifyActiveGames(guild, _state, note);
      return interaction.reply({ content:`📣 Sent reminders to **${result.sent || 0}** active game channels.`, flags:64 });
    }

    case 'teams': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const sub = interaction.options.getSubcommand();
      const { claimTeam, releaseByName, buildOpenTeamsEmbeds, refreshOpenTeamsBoard, announceTeamOpen } = openTeamsService;
      if (sub === 'configure') {
        const raw = loadJson('teamsConfig.json', { useTeamRoles: false }) || { useTeamRoles: false };
        raw.useTeamRoles = !!interaction.options.getBoolean('use-team-roles');
        saveJsonDebounced('teamsConfig.json', raw, 100);
        return interaction.reply({ content:`✅ Team settings saved. Team roles: **${raw.useTeamRoles ? 'enabled' : 'disabled'}**.`, flags:64 });
      }
      if (sub === 'assign') {
        const user = interaction.options.getUser('user');
        const team = interaction.options.getString('team');
        const leagueInput = interaction.options.getString('league');
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.reply({ content:'❌ Could not find that member in the server.', flags:64 });
        const result = await teamAssignmentUseCase.assignTeam({ guild, member, leagueId:leagueInput, team, source:'slash:teams.assign' });
        if (!result.success) return interaction.reply({ content:`❌ ${result.reason}`, flags:64 });
        try { teamRegistry.syncFromState(_state); } catch {}
        return interaction.reply({ content:`✅ ${user} now owns **${result.entry.displayTeam}** in **${result.league.leagueName || result.league.id}**.`, flags:64 });
      }
      if (sub === 'free') {
        const team = interaction.options.getString('team');
        const leagueInput = interaction.options.getString('league');
        const result = await teamAssignmentUseCase.releaseTeam({ guild, leagueId:leagueInput, team, source:'slash:teams.free' });
        if (!result.success) return interaction.reply({ content:`⚠️ ${result.reason}`, flags:64 });
        await announceTeamOpen(guild, result.entry, 'released by a commissioner');
        try { teamRegistry.syncFromState(_state); } catch {}
        return interaction.reply({ content:`✅ **${result.entry.displayTeam}** is now open in **${result.league.leagueName || result.league.id}**.`, flags:64 });
      }
      const leagueInput = interaction.options.getString('league');
      let leagueId;
      if (leagueInput) {
        const resolved = leagueResolver.resolveLeague(leagueInput, { guildId:guild.id, mode:'operational' });
        if (!resolved.ok) return interaction.reply({ content:`❌ ${resolved.message}`, flags:64 });
        leagueId = resolved.league.id;
      }
      await refreshOpenTeamsBoard(guild).catch(() => null);
      return interaction.reply({ embeds: buildOpenTeamsEmbeds(guild, leagueId), flags:64 });
    }

    case 'waitlist': {
      const waitlist = require('../services/waitlistService');
      const sub = interaction.options.getSubcommand();
      if (sub === 'list') {
        const entries = waitlist.list();
        return interaction.reply({ content: entries.length ? entries.map(e => `${e.position}. <@${e.userId}>${e.note ? ` — ${e.note}` : ''}`).join('\n') : 'Waitlist is empty.', flags:64 });
      }
      if (sub === 'add') {
        if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
        const user = interaction.options.getUser('user');
        const note = interaction.options.getString('note') || '';
        const pos = interaction.options.getInteger('position');
        const entry = waitlist.add(user, note, pos);
        return interaction.reply({ content:`✅ Added ${user} to the waitlist at **#${entry.position}**.`, flags:64 });
      }
      if (sub === 'remove') {
        if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
        const user = interaction.options.getUser('user');
        const ok = waitlist.removeByUserId(user.id);
        return interaction.reply({ content: ok ? `✅ Removed ${user} from the waitlist.` : '⚠️ That user was not on the waitlist.', flags:64 });
      }
      if (sub === 'pop') {
        if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
        const entry = waitlist.popTop();
        return interaction.reply({ content: entry ? `📤 Popped <@${entry.userId}> from the top of the waitlist.` : 'Waitlist is empty.', flags:64 });
      }
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const count = interaction.options.getInteger('count') || 1;
      const message = interaction.options.getString('message') || 'A team may be opening up soon.';
      const result = await waitlist.notifyTop(_client, count, message);
      return interaction.reply({ content:`📬 Waitlist notifications sent: **${result.sent}** delivered, **${result.failed}** failed.`, flags:64 });
    }

    case 'streams': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      if (require('../services/commandAliasService').isAliasedPath(interaction)) return interaction.reply({ content:'⚠️ This command could not be routed. Nothing was run — please try again.', flags:64 }); // V203 fail-closed
      const streamOps = streamOpsService;
      const sub = interaction.options.getSubcommand();
      if (sub === 'configure') {
        const channel = interaction.options.getChannel('channel');
        const role = interaction.options.getRole('ping-role');
        const cfg = streamOps.saveConfig({ channelId: channel?.id || null, pingRoleId: role?.id || null });
        return interaction.reply({ content:`✅ Stream tracking saved. Channel: **${cfg.channelId ? 'set' : 'not set'}**.`, flags:64 });
      }
      if (sub === 'count') {
        const key = interaction.options.getString('team-or-user');
        const url = interaction.options.getString('url') || '';
        const player = await streamOps.addCount(_state, key, url,{guildId:guild.id,operationId:interaction.id});
        if (!player) return interaction.reply({ content:'❌ Could not find that team or owner.', flags:64 });
        return interaction.reply({ content:`✅ **${player.displayTeam}** now has **${player.streamCount || 0}** stream credits.`, flags:64 });
      }
      if (sub === 'remove') {
        const key = interaction.options.getString('team-or-user');
        const player = await streamOps.removeCount(_state, key,{guildId:guild.id,operationId:interaction.id});
        if (!player) return interaction.reply({ content:'❌ Could not find that team or owner.', flags:64 });
        return interaction.reply({ content:`✅ Removed one stream credit. **${player.displayTeam}** now has **${player.streamCount || 0}**.`, flags:64 });
      }
      const resetCount = await streamOps.resetAll(_state,{guildId:guild.id,operationId:interaction.id});
      return interaction.reply({ content:`🧽 Reset stream counts for **${resetCount}** tracked team records.`, flags:64 });
    }

    case 'broadcasts': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const broadcasts = require('../services/broadcastsService');
      const sub = interaction.options.getSubcommand();
      if (sub === 'configure') {
        const channel = interaction.options.getChannel('channel');
        const role = interaction.options.getRole('ping-role');
        const keyword = interaction.options.getString('keyword') || '';
        const cfg = broadcasts.saveConfig({ channelId: channel?.id || null, pingRoleId: role?.id || null, keyword });
        return interaction.reply({ content:`✅ Broadcast settings saved. YouTube tracked: **${cfg.youtube.length}**. Twitch tracked: **${cfg.twitch.length}**.`, flags:64 });
      }
      if (sub === 'youtube-add') {
        const cfg = broadcasts.addSource('youtube', interaction.options.getString('value'));
        return interaction.reply({ content:`✅ Added YouTube source. Total tracked: **${cfg.youtube.length}**.`, flags:64 });
      }
      if (sub === 'youtube-remove') {
        const cfg = broadcasts.removeSource('youtube', interaction.options.getString('value'));
        return interaction.reply({ content:`✅ Removed YouTube source. Total tracked: **${cfg.youtube.length}**.`, flags:64 });
      }
      if (sub === 'youtube-list') {
        const cfg = broadcasts.getConfig();
        return interaction.reply({ content: cfg.youtube.length ? `📺 YouTube sources\n${cfg.youtube.map(v => `• ${v}`).join('\n')}` : 'No YouTube sources configured.', flags:64 });
      }
      if (sub === 'twitch-add') {
        const cfg = broadcasts.addSource('twitch', interaction.options.getString('value'));
        return interaction.reply({ content:`✅ Added Twitch source. Total tracked: **${cfg.twitch.length}**.`, flags:64 });
      }
      if (sub === 'twitch-remove') {
        const cfg = broadcasts.removeSource('twitch', interaction.options.getString('value'));
        return interaction.reply({ content:`✅ Removed Twitch source. Total tracked: **${cfg.twitch.length}**.`, flags:64 });
      }
      const cfg = broadcasts.getConfig();
      return interaction.reply({ content: cfg.twitch.length ? `🟣 Twitch sources\n${cfg.twitch.map(v => `• ${v}`).join('\n')}` : 'No Twitch sources configured.', flags:64 });
    }

    case 'schedule': {
      const week = interaction.options.getInteger('week') || _state.scheduleState.week || scheduleRegistryService.getRegistry().currentWeek;
      const games = week ? scheduleRegistryService.getWeek(week) : (_state.scheduleState.matchups || []);
      if (!games?.length) return interaction.reply({ content:'⚠️ No stored schedule found for that week yet.', flags:64 });
      const lines = games.slice(0, 25).map((g, idx) => {
        const tags = [g.isPrimetime ? 'P' : '', g.isGotw ? 'GOTW' : '', g.isOverseas ? 'INTL' : ''].filter(Boolean).join(', ');
        return `${idx + 1}. **${g.team1}** vs **${g.team2}**${tags ? ` (${tags})` : ''}`;
      }).join('\n');
      return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x1a73e8).setTitle(`📅 Week ${week} Schedule`).setDescription(lines).setTimestamp()], flags:64 });
    }

    case 'player': {
      const sub = interaction.options.getSubcommand();
      const reg = scheduleRegistryService.getRegistry();
      const players = Array.isArray(reg.players) ? reg.players : [];
      if (sub === 'get') {
        const query = String(interaction.options.getString('query') || '').toLowerCase();
        const match = players.find(p => JSON.stringify(p).toLowerCase().includes(query)) || [..._state.players.values()].find(p => `${p.displayTeam} ${p.baseTeam} ${p.userId}`.toLowerCase().includes(query));
        if (!match) return interaction.reply({ content:'⚠️ No player or owner record matched that search.', flags:64 });
        const body = Object.entries(match).slice(0, 12).map(([k, v]) => `**${k}:** ${Array.isArray(v) ? v.join(', ') : String(v)}`).join('\n');
        return interaction.reply({ embeds:[new EmbedBuilder().setColor(0x9b59b6).setTitle('🔎 Player Record').setDescription(body).setTimestamp()], flags:64 });
      }
      const teamFilter = String(interaction.options.getString('team') || '').toLowerCase();
      const filtered = players.filter(p => !teamFilter || JSON.stringify(p).toLowerCase().includes(teamFilter));
      if (!filtered.length) return interaction.reply({ content:'⚠️ No imported player records found. Import or sync roster/player data first.', flags:64 });
      const lines = filtered.slice(0, 25).map((p, i) => `${i + 1}. ${p.name || p.player || p.fullName || 'Unknown'}${p.team || p.club ? ` — ${p.team || p.club}` : ''}`);
      return interaction.reply({ content:`📋 Player records\n${lines.join('\n')}`, flags:64 });
    }

    case 'logger': {
      if (!isComm()) return interaction.reply({ content:'❌ Commissioners only.', flags:64 });
      const loggerCfg = require('../services/loggerConfigService');
      const channel = interaction.options.getChannel('channel');
      const cfg = loggerCfg.saveConfig({ enabled: true, channelId: channel.id });
      return interaction.reply({ content:`✅ Game logging configured for <#${cfg.channelId}>.`, flags:64 });
    }

    case 'suggestions': {
      await interaction.deferReply({ flags:64 });
      const type = interaction.options.getString('type');
      const text = interaction.options.getString('text');
      const { routeSuggestion } = require('../services/suggestionsService');
      const result = await routeSuggestion({ guild, client: _client, user: interaction.user, type, text, commissionerIds: [..._state.commissionerIds, guild.ownerId].filter(Boolean) });
      if (!result.ok) return interaction.editReply(`⚠️ Suggestion delivery failed: **${result.reason}**.`);
      if (result.route === 'staff_dm') return interaction.editReply(`✅ Server suggestion sent. Delivered: **${result.sent}**. Failed: **${result.failed}**.`);
      return interaction.editReply('✅ Bot suggestion sent for review.');
    }

    default:
      log.warn(`Unhandled command: ${cmd}`);
      return interaction.reply({content:'⚠️ This command is registered in this build but is not wired to a live handler yet.',flags:64});
  }
}

// ── V202: /game-channels advance-* / sync-* / update / delete ─────────────────────────────
// The command group is ONLY the Discord interface. League advancement lives in league/advanceEngine (via
// services/leagueAutomationService), sync in services/leagueSyncService, providers in services/providerService.
const _GAME_CHANNEL_V202_SUBCOMMANDS = new Set(['advance-status', 'advance-settings', 'advance-now', 'advance-hold', 'advance-resume', 'sync-status', 'sync-now', 'update', 'delete']);

function _syncPolicyFromWeekly(cfg, guild) {
  try {
    const policySvc = require('../league/automationPolicyService');
    const prev = policySvc.getPolicy();
    const next = policySvc.syncFromWeeklySettings(cfg) ? policySvc.getPolicy() : null;
    if (next) require('../league/advanceEngine').onPolicyChanged(prev, next);
    require('../services/leagueAutomationService').rearm({ guild, state: _state });
  } catch (e) { log.warn(`policy sync from weekly settings failed: ${e.message}`); }
}

function _fmtTs(ms) { return ms ? `<t:${Math.floor(Number(ms) / 1000)}:R>` : 'n/a'; }

async function _handleGameChannelsV202(interaction, sub, guild) {
  const engine = require('../league/advanceEngine');
  const automation = require('../services/leagueAutomationService');
  if (sub === 'advance-status') {
    const s = engine.getStatus(_state);
    const rt = s.runtime;
    const sched = automation.status(guild.id);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(rt.state === 'HOLD' || rt.state === 'RECOVERY_REQUIRED' ? 0xe67e22 : 0x3498db).setTitle('🗓 League Advance Status')
      .addFields(
        { name: 'State', value: `**${rt.state}**${rt.hold ? `\nHold: ${String(rt.hold.reason).slice(0, 300)}` : ''}${rt.lastError ? `\nLast error: ${String(rt.lastError).slice(0, 300)}` : ''}`, inline: false },
        { name: 'Workflow week', value: String(rt.workflowWeek ?? 'n/a'), inline: true },
        { name: 'Verified source week', value: `${rt.sourceWeek ?? 'n/a'}${rt.sourceVerification ? `\n(${String(rt.sourceVerification).split(':')[0]})` : ''}`, inline: true },
        { name: 'Next deadline', value: _fmtTs(rt.nextAdvanceAt), inline: true },
        { name: 'Provider', value: `**${s.provider.key}**\nadvance control: ${s.provider.capabilities.advanceWeek ? 'yes' : 'no (assisted)'}\nconfigured: ${s.provider.verified ? 'yes' : 'no'}`, inline: true },
        { name: 'Automation', value: `${s.policy.enabled ? 'ON' : 'OFF'} • ${s.policy.intervalHours}h${s.policy.shadowMode ? ' • SHADOW' : ' • LIVE'}`, inline: true },
        { name: 'Scheduler', value: sched.started ? `armed • next wake ${_fmtTs(sched.nextWakeAt)}` : 'not started', inline: true },
        { name: 'Game sessions', value: s.sessions ? `active ${s.sessions.active} • finished ${s.sessions.finished}` : 'n/a', inline: true },
        { name: 'Imports', value: s.imports?.last ? `${s.imports.last.provider}: ${s.imports.last.status} ${_fmtTs(s.imports.last.receivedAt)}` : 'none', inline: true },
        { name: 'Results recorded', value: s.results ? `${s.results.total} (standings ${s.results.withStandings})` : 'n/a', inline: true },
        { name: 'Last shadow decision', value: rt.lastShadowDecision ? `would enter **${rt.lastShadowDecision.path}** ${_fmtTs(rt.lastShadowDecision.at)}` : 'none', inline: false },
      ).setTimestamp()], flags: 64 });
  }
  if (sub === 'advance-settings') {
    const policySvc = require('../league/automationPolicyService');
    const prev = policySvc.getPolicy();
    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const hours = interaction.options.getInteger('interval-hours');
    const shadow = interaction.options.getBoolean('shadow-mode');
    const blockActive = interaction.options.getBoolean('block-on-active-game');
    const requireAll = interaction.options.getBoolean('require-all-results');
    const tz = interaction.options.getString('timezone');
    if (enabled !== null) patch.enabled = enabled;
    if (hours !== null) patch.intervalHours = hours;
    if (shadow !== null) patch.shadowMode = shadow;
    if (tz) patch.timezone = tz;
    const pre = {};
    if (blockActive !== null) pre.blockOnActiveGame = blockActive;
    if (requireAll !== null) pre.requireAllGamesFinal = requireAll;
    if (Object.keys(pre).length) patch.precheckPolicy = pre;
    if (!Object.keys(patch).length) return interaction.reply({ content: `⚙️ Current advance settings:\n${policySvc.describePolicy(prev)}`, flags: 64 });
    const r = policySvc.setPolicy(patch, interaction.user.id);
    if (!r.ok) return interaction.reply({ content: `⚠️ Settings not saved: ${r.reason}`, flags: 64 });
    engine.onPolicyChanged(prev, r.policy);
    automation.rearm({ guild, state: _state });
    return interaction.reply({ content: `✅ Advance settings saved.\n${policySvc.describePolicy(r.policy)}`, flags: 64 });
  }
  if (sub === 'advance-now') {
    await interaction.deferReply({ flags: 64 });
    const dryRun = !!interaction.options.getBoolean('dry-run');
    const sourceWeek = interaction.options.getInteger('source-week');
    const r = await engine.requestAdvance({ guild, state: _state, actor: interaction.user.id, dryRun, attestedSourceWeek: sourceWeek });
    automation.rearm({ guild, state: _state });
    if (dryRun) return interaction.editReply(`🧪 **Dry run** — no state changed.\nPath: **${r.path}** | provider **${r.provider}** | source week ${r.sourceWeek ?? 'unknown'}${r.sourceError ? ` (${r.sourceError})` : ''} | workflow week ${r.workflowWeek ?? 'n/a'}${r.blockers.length ? `\nBlockers:\n• ${r.blockers.join('\n• ')}` : ''}`);
    if (!r.ok) return interaction.editReply(`⚠️ ${r.reason}`);
    return interaction.editReply(`🗓 Advance procedure → **${r.state}**${r.alreadyInCycle ? ' (a cycle was already in progress — no second cycle started)' : ''}.${r.messages?.length ? `\n\n${r.messages.join('\n\n').slice(0, 1500)}` : ''}`);
  }
  if (sub === 'advance-hold') {
    const r = engine.hold({ actor: interaction.user.id, reason: interaction.options.getString('reason') || 'commissioner hold' });
    return interaction.reply({ content: r.ok ? '⏸ League advance is on **HOLD**. Nothing will advance or publish until `/game-channels advance-resume`.' : `⚠️ Could not hold from state ${r.state}.`, flags: 64 });
  }
  if (sub === 'advance-resume') {
    await interaction.deferReply({ flags: 64 });
    const r = await engine.resume({ guild, state: _state, actor: interaction.user.id });
    automation.rearm({ guild, state: _state });
    if (!r.ok) return interaction.editReply(`⚠️ ${r.reason}`);
    return interaction.editReply(`▶️ Resumed → **${r.state}**.${r.messages?.length ? `\n\n${r.messages.join('\n\n').slice(0, 1500)}` : ''}`);
  }
  if (sub === 'sync-status') {
    const st = await require('../services/leagueSyncService').getSyncStatus();
    const lines = st.recentImports.map(i => `• ${i.provider} ${i.status}${i.error ? ` (${i.error})` : ''}${i.duplicates ? ` +${i.duplicates} dup` : ''} ${_fmtTs(i.receivedAt)}`);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('🔄 League Data Sync Status')
      .addFields(
        { name: 'Active provider', value: `**${st.activeProvider.key}** — ${st.activeProvider.label}`.slice(0, 1024), inline: false },
        { name: 'Health', value: st.health.ok ? '✅ healthy' : `⚠️ ${st.health.reason || 'unhealthy'}${st.health.missing ? ` (missing ${st.health.missing.join(', ')})` : ''}`, inline: true },
        { name: 'Legacy live sync', value: `mode ${st.liveSync.sourceMode} • ${st.liveSync.provider}\nlast ${st.liveSync.lastSyncStatus} ${_fmtTs(st.liveSync.lastSyncAt)}`, inline: true },
        { name: 'Recent imports', value: lines.join('\n').slice(0, 1024) || 'none', inline: false },
      ).setTimestamp()], flags: 64 });
  }
  if (sub === 'sync-now') {
    await interaction.deferReply({ flags: 64 });
    const { postScheduleEmbed, startScheduleTimer } = hubReleaseService;
    try {
      const r = await require('../services/leagueSyncService').syncNow(guild, _state, { postScheduleEmbed, startScheduleTimer, getCh: _getCh, getTeamEmoji });
      if (!r.ok) return interaction.editReply(`⚠️ Sync did not run. Reason: **${r.reason}**.`);
      if (r.mode === 'import-provider') return interaction.editReply(`✅ Processed **${r.processed}** queued import(s) from **${r.provider}**. Sync refreshes data only — the league advances only through the advance procedure.`);
      return interaction.editReply(`✅ Synced from **${r.provider}**. Current week: **${r.currentWeek ?? 'N/A'}** • stored weeks **${r.storedWeeks}** • channels created **${r.auto?.created || 0}**, reused **${r.auto?.skipped || 0}**, held **${r.auto?.held || 0}**.`);
    } catch (e) {
      return interaction.editReply(`❌ Sync failed: ${e.message}`);
    }
  }
  if (sub === 'update') {
    const ch = interaction.options.getChannel('channel') || interaction.channel;
    const r = await gameChannelService.refreshGameChannelOwners(guild, ch).catch(e => ({ ok: false, reason: e.message }));
    if (!r.ok) return interaction.reply({ content: `⚠️ ${r.reason === 'not-a-managed-game-channel' ? 'That is not an active managed game channel.' : r.reason}`, flags: 64 });
    return interaction.reply({ content: `✅ Game channel owners refreshed. Access granted to **${r.added.length}** newly resolved owner(s).${!r.owners.user1Id || !r.owners.user2Id ? ' ⚠️ One side still has no assigned owner — use `/teams assign`.' : ''}`, flags: 64 });
  }
  if (sub === 'delete') {
    const ch = interaction.options.getChannel('channel');
    const r = await gameChannelService.deleteSingleGameChannel(guild, ch, `Deleted by commissioner ${interaction.user.tag}`).catch(e => ({ ok: false, reason: e.message }));
    if (!r.ok) return interaction.reply({ content: `⚠️ Not deleted: ${r.reason === 'not-a-weekly-game-channel' ? 'only weekly game channels can be deleted with this command.' : r.reason}`, flags: 64 });
    return interaction.reply({ content: '🗑️ Game channel deleted.', flags: 64 });
  }
  return interaction.reply({ content: '⚠️ Unknown game-channels subcommand.', flags: 64 });
}

async function _refreshRules(guild) {
  const { splitLongText } = require('../utils/helpers');
  const rulesCh = _getCh(guild,'rules');
  if (!rulesCh) return;
  const chunks = splitLongText(_state.leagueConfig.rulesText);
  try {
    const prev = await rulesCh.messages.fetch({limit:50}).catch(()=>null);
    if (prev) {
      const botRuleMsgs = prev.filter(msg => msg.author.id===_client.user.id && msg.embeds?.some(e => /League Rules|Member Commands & Actions/i.test(e.title || '')));
      for (const [,msg] of botRuleMsgs) await msg.delete().catch(()=>null);
    }
  } catch {}
  for (let i=0;i<chunks.length;i++) {
    await rulesCh.send({embeds:[new EmbedBuilder().setColor(0x00b4d8).setTitle(i===0?'📖 League Rules':`📖 League Rules (cont. ${i+1})`).setDescription(chunks[i])]}).catch(()=>null);
  }
}

async function _saveLifetimeAward(interaction, grant) {
  const league = activeLeagueService.findLeagueForChannel(interaction.channel) || (activeLeagueService.listOperationalLeagues().length === 1 ? activeLeagueService.listOperationalLeagues()[0] : null);
  if (!league) throw new Error('Run award commands inside the selected league channel.');
  if (!grant.userId) throw new Error('Select the member receiving credit in the user option.');
  return require('../services/lifetimeHistoryService').award(interaction.guild.id,{...grant,id:interaction.id,leagueId:league.id,grantedBy:interaction.user.id});
}

module.exports = { init, handleInteraction, ensureSetupWizardChannel: _ensureSetupWizardChannel, postSetupWizardMessage: _postSetupWizardMessage, ensureSetupWizardStarterMessage: _ensureSetupWizardStarterMessage };
