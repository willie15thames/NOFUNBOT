/*
 * NAVIGATION HEADER
 * FILE: src/services/wizardRendererService.js
 * LAYER: Service layer
 * PURPOSE: Supports setup wizard rendering, state, routing, or lifecycle behavior.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * wizardRendererService.js — Single Wizard Payload Renderer V134
 *
 * One function builds the wizard message payload for ANY stage and ANY mode
 * (install, edit, error). The interactionRouter calls this instead of building
 * payloads inline. This service is the only place that knows how to assemble
 * the wizard embed + component rows.
 *
 * Extracted from interactionRouter._buildSetupWizardSinglePayload per
 * Section 6 of the architecture blueprint (recommended new service).
 *
 * API:
 *   buildWizardPayload(guild, note, opts)  → Discord message payload object
 *   buildErrorPayload(errMessage)          → minimal error payload
 *   buildFlowGuidePayload()                → the initial guide screen
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('wizardRenderer');

const serverSettings = require('./serverSettingsService');
const wizardPrefs    = require('./wizardPreferencesService');
const wizardState    = require('./wizardStateService');
const templateLogic  = require('./serverTemplateLogicService');
const templateTheme  = require('./templateThemeService');
const serverRules    = require('./serverRulesService');
const stageRegistry  = require('./stageRegistry');
const { getTemplateOptions, getTemplateSubtemplateOptions, resolveTemplateProfile, getCommunityFamilyOptions, getCommunityNicheOptions } = require('./templateRegistryService');
const communityPackService = require('./communityPackService');

// ── Helpers ───────────────────────────────────────────────────────────────

function _statusIcon(val, required) {
  if (val) return '✅';
  return required ? '⚠️' : '➖';
}

function _toneOptionList(settings) {
  return serverSettings.getAllowedTonesForAudience(settings.audienceRating || '');
}

// ── Summary text (wizard description) ────────────────────────────────────

function buildSummaryText(settings, prefs, note) {
  const profile = settings.serverTemplate ? templateLogic.getTemplateProfile(settings) : null;
  const templateName = profile?.baseName || profile?.name || settings.serverTemplate || null;
  const subtemplateName = profile?.subtemplateName || settings.serverSubtemplate || null;
  const structure = settings.customStructureMode ? String(settings.customStructureMode).toUpperCase() : null;
  const audience = settings.audienceRating ? String(settings.audienceRating).toUpperCase() : null;
  const memberTone = serverSettings.getToneSummary(settings, 'member');
  const commTone = settings.useSharedToneProfile ? null : serverSettings.getToneSummary(settings, 'commissioner');

  const stageLabels = stageRegistry.getAllStageLabels();
  const curStage = wizardState.getCurrentStep() || 'mode';
  const stageName = stageLabels[curStage] || '🛠️ Setup';
  const lines = [note || 'Work through each step below. Wizard edits this message in place.', ''];
  lines.push(`**Step: ${stageName}**`);
  lines.push(`${_statusIcon(structure, true)} Structure: **${structure || 'not set'}**`);
  lines.push(`${_statusIcon(templateName, true)} Template: **${templateName || 'not set'}**`);
  if (templateName) lines.push(`${_statusIcon(subtemplateName, false)} Subtemplate: **${subtemplateName || 'none'}**`);
  if (settings.customStructureMode === 'custom' || curStage === 'custom_structure') {
    const sels = Array.isArray(settings.customCatalogSelections) ? settings.customCatalogSelections : [];
    const groups = ['gaming:', 'sports:', 'community:', 'media:'].map(p => {
      const count = sels.filter(s => s.startsWith(p)).length;
      return count ? `${p.replace(':', '')} (${count})` : null;
    }).filter(Boolean);
    lines.push(`🧩 Custom spaces: **${sels.length ? groups.join(', ') : 'none selected yet'}**`);
  }
  lines.push(`${_statusIcon(audience, true)} Audience: **${audience || 'not set'}**`);
  if (audience) {
    lines.push(`${_statusIcon(memberTone, false)} Tones: **${memberTone || 'none selected'}**${commTone ? ` / Commissioner: **${commTone}**` : ''}`);
  }
  lines.push(`${settings.allowGifReplies ? '✅' : '❌'} GIF replies: **${settings.allowGifReplies ? 'ON' : 'OFF'}**`);
  lines.push(`${settings.requireTimezone ? '✅' : '❌'} Timezone gate: **${settings.requireTimezone ? 'ON' : 'OFF'}**`);
  return lines.join('\n');
}

// ── Component row builders ────────────────────────────────────────────────

function _buildNavRow(stage, disabledNext = false, isEditMode = false) {
  const nextLabel = stageRegistry.getNextLabel(stage, isEditMode);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bot_setup_back').setLabel('◀ Back').setStyle(ButtonStyle.Secondary).setDisabled(stage === 'flow'),
    new ButtonBuilder().setCustomId('bot_setup_reset').setLabel('Reset').setStyle(ButtonStyle.Danger),
    ...(stage === 'finalize'
      ? [new ButtonBuilder().setCustomId('bot_setup_initialize').setLabel(isEditMode ? '💾 Apply Changes' : '🚀 Build Server Now').setStyle(ButtonStyle.Success).setDisabled(disabledNext)]
      : [new ButtonBuilder().setCustomId('wizard_next').setLabel(nextLabel).setStyle(ButtonStyle.Primary).setDisabled(disabledNext)])
  );
}

function _buildStructureModeRow(settings) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('bot_structure_mode_select')
      .setPlaceholder(settings.customStructureMode ? `Structure mode: ${String(settings.customStructureMode).toUpperCase()}` : 'Choose structure mode (required)...')
      .addOptions([
        { label: 'Standard Base Structure', value: 'base', description: 'Bot uses a proven category stack, then layers the template' },
        { label: 'Custom Structure Builder', value: 'custom', description: 'Pick categories/channels and choose bot-arranged or manual layout' },
        { label: 'Empty / Blank Structure', value: 'empty', description: 'Start blank, then add only the chosen template and staff lanes' },
        { label: 'Clear structure selection', value: '__clear__', description: 'Clear the saved structure choice' },
      ])
  );
}

function _buildTemplateRow(settings) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('bot_server_template_select')
      .setPlaceholder(settings.serverTemplate ? `Template: ${templateLogic.getTemplateProfile(settings).baseName || templateLogic.getTemplateProfile(settings).name}` : 'Choose server template (required)...')
      .addOptions([{ label: 'Clear template selection', value: '__clear__', description: 'Clear the saved template choice' }, ...getTemplateOptions()])
  );
}

function _buildSubtemplateRow(settings) {
  const opts = settings.serverTemplate ? getTemplateSubtemplateOptions(settings.serverTemplate) : [];
  const placeholder = opts.length
    ? (settings.serverSubtemplate ? `Subtemplate: ${resolveTemplateProfile(settings).subtemplateName || settings.serverSubtemplate}` : 'Choose subtemplate for more precise build...')
    : 'No subtemplate required for this template';
  const options = opts.length
    ? [{ label: 'Clear subtemplate selection', value: '__clear__', description: 'Clear the saved subtemplate choice' }, ...opts]
    : [{ label: 'No subtemplate needed', value: '__none__', description: 'This template can build without a subtemplate choice' }];
  const menu = new StringSelectMenuBuilder().setCustomId('bot_server_subtemplate_select').setPlaceholder(placeholder).addOptions(options);
  if (!opts.length) menu.setDisabled(true);
  return new ActionRowBuilder().addComponents(menu);
}

function _buildAudienceRow(settings) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('init_age_rating')
      .setPlaceholder(settings.audienceRating ? `Audience: ${String(settings.audienceRating).toUpperCase()}` : 'Choose audience level (required)...')
      .addOptions([
        { label: 'G', value: 'g', description: 'Soft and family-safe bot behavior' },
        { label: 'PG', value: 'pg', description: 'Mild edge with broader tone choices' },
        { label: 'PG-13', value: 'pg13', description: 'Sharper banter with more character options' },
        { label: 'R', value: 'r', description: 'Most aggressive tone range, still no hateful slurs' },
        { label: 'Clear audience selection', value: '__clear__', description: 'Clear the saved audience level' },
      ])
  );
}

function _buildToneRow(customId, placeholder, settings) {
  const opts = _toneOptionList(settings).slice(0, 24);
  if (!opts.length) {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder('Set audience level first to unlock tone options...')
        .setDisabled(true)
        .addOptions([{ label: 'Set audience level first', value: '__none__', description: 'Choose G / PG / PG-13 / R above' }])
    );
  }
  const lane = customId === 'commissioner_tone_profile' ? 'commissioner' : 'member';
  const savedTones = serverSettings.getEffectiveToneProfile(settings, lane);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(savedTones.length ? `Tones: ${savedTones.slice(0, 3).join(', ')}${savedTones.length > 3 ? '...' : ''}` : placeholder)
      .setMinValues(1)
      .setMaxValues(Math.min(7, opts.length))
      .addOptions([
        { label: 'Clear tone selection', value: '__clear__', description: 'Reset tones for this lane' },
        ...opts.map(name => ({ label: name, value: name, description: `Tone: ${name}` })),
      ])
  );
}

function _buildPreferenceToggleRow(settings) {
  const sharedActive = !!settings.useSharedToneProfile;
  const gifsActive = settings.allowGifReplies !== false;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bot_toggle_same_tone')
      .setLabel(sharedActive ? '🔗 Shared Tones: ON' : '🔀 Separate Tones: ON')
      .setStyle(sharedActive ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bot_toggle_gifs')
      .setLabel(gifsActive ? '🎞️ GIF Replies: ON' : '🚫 GIF Replies: OFF')
      .setStyle(gifsActive ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
}

function _buildTimezoneToggleRow(settings) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bot_toggle_timezone_gate')
      .setLabel(settings.requireTimezone ? '🕒 Timezone Gate: ON' : '🕒 Timezone Gate: OFF')
      .setStyle(settings.requireTimezone ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
}

function _buildIdentityButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bot_identity_config').setLabel('Bot Identity').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bot_identity_upload_help').setLabel('Upload Avatar File').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bot_automation_status').setLabel('Automation Status').setStyle(ButtonStyle.Secondary),
  );
}

// ── Custom mix row builders (moved from interactionRouter) ────────────────

function _customMixActive(settings, prefix) {
  const sels = Array.isArray(settings.customCatalogSelections) ? settings.customCatalogSelections : [];
  return sels.some(s => s.startsWith(prefix));
}

function _buildCustomMixGamingRow(settings) {
  const sels = new Set(Array.isArray(settings.customCatalogSelections) ? settings.customCatalogSelections : []);
  const active = _customMixActive(settings, 'gaming:');
  const opts = [
    { label: '🎮 General Gaming',       value: 'gaming:general',      description: 'Game chat, squad-up, LFG, highlights' },
    { label: '🎯 Call of Duty Ops',      value: 'gaming:cod',          description: 'Warzone, ranked, loadouts, scrims' },
    { label: '🚗 GTA Crew City',         value: 'gaming:gta',          description: 'Crews, heists, races, RP chatter' },
    { label: '🏀 NBA 2K / Sports Sim',   value: 'gaming:sportssim',    description: 'Teams, schedules, standings, trade block' },
    { label: '🏹 Apex / Battle Royale',  value: 'gaming:apex',         description: 'Squads, ranked, legends, VOD review' },
    { label: '⛏ Minecraft Realm',        value: 'gaming:minecraft',    description: 'Builds, mods, survival, realm chat' },
    { label: '🧱 Roblox Studio',         value: 'gaming:roblox',       description: 'Experiences, studio, squads, events' },
    { label: '🏆 Esports / Competitive', value: 'gaming:esports',      description: 'Roster, scrims, VOD, tournaments' },
    { label: '🥊 Fighting Games',        value: 'gaming:fighter',      description: 'Sets, matchups, brackets, tech' },
    { label: '🏎 Racing Grid',            value: 'gaming:racing',       description: 'Lobbies, tuning, race events, results' },
    { label: '📱 Mobile Gaming Club',    value: 'gaming:mobile',       description: 'Squads, metas, clans, updates' },
    { label: '🎲 Variety Gaming Lounge', value: 'gaming:variety',      description: 'Co-op nights, recommendations, LFG' },
  ];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('custom_mix_gaming')
      .setPlaceholder(active ? '🎮 Gaming ✅ selected' : '🎮 Gaming spaces (pick any)')
      .setMinValues(0).setMaxValues(Math.min(opts.length, 12))
      .addOptions(opts.map(o => ({ ...o, default: sels.has(o.value) })))
  );
}

function _buildCustomMixSportsRow(settings) {
  const sels = new Set(Array.isArray(settings.customCatalogSelections) ? settings.customCatalogSelections : []);
  const active = _customMixActive(settings, 'sports:');
  const opts = [
    { label: '🏈 NFL Sunday Hub',        value: 'sports:nfl',          description: 'Scores, fantasy, red-zone, watch party' },
    { label: '🏀 NBA Nightly Run',       value: 'sports:nba',          description: 'Game nights, highlights, fantasy hoops' },
    { label: '⚽ Soccer / Pitch Side',    value: 'sports:soccer',       description: 'Match day, standings, fan zones' },
    { label: '⚾ Baseball Diamond',       value: 'sports:baseball',     description: 'Scores, fantasy, trade talk' },
    { label: '🏒 Hockey Rink',            value: 'sports:hockey',       description: 'Game night, fantasy, highlights' },
    { label: '🏋 Fitness League',         value: 'sports:fitness',      description: 'Workouts, challenges, progress tracking' },
    { label: '🏌 Golf Club',              value: 'sports:golf',         description: 'Course chat, scores, fantasy golf' },
    { label: '🥊 Combat Sports',          value: 'sports:combat',       description: 'UFC, boxing, wrestling events' },
  ];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('custom_mix_sports')
      .setPlaceholder(active ? '🏆 Sports ✅ selected' : '🏆 Sports spaces (pick any)')
      .setMinValues(0).setMaxValues(Math.min(opts.length, 8))
      .addOptions(opts.map(o => ({ ...o, default: sels.has(o.value) })))
  );
}

function _buildCustomMixCommunityRow(settings) {
  const sels = new Set(Array.isArray(settings.customCatalogSelections) ? settings.customCatalogSelections : []);
  const active = _customMixActive(settings, 'community:');
  const opts = [
    { label: '💬 General Social Lounge', value: 'community:social',    description: 'Chill chat, introductions, off-topic' },
    { label: '🎓 Educational / Study',   value: 'community:edu',       description: 'Study groups, resources, Q&A' },
    { label: '💼 Professional / Work',   value: 'community:pro',       description: 'Networking, portfolio, career talk' },
    { label: '🎭 Events & Activities',   value: 'community:events',    description: 'Event calendar, signups, watch parties' },
    { label: '🎨 Creative / Art',        value: 'community:creative',  description: 'Showcase, feedback, collab work' },
    { label: '🎵 Music Scene',           value: 'community:music',     description: 'Artists, playlists, production, venues' },
    { label: '🛡 Security / Cyber',       value: 'community:cyber',     description: 'Certs, labs, threat intel, blue team' },
    { label: '💻 Coding & Dev',          value: 'community:coding',    description: 'Help, projects, repo sharing, tech talk' },
    { label: '🌐 Language Exchange',     value: 'community:language',  description: 'Practice, swap, culture, vocab' },
    { label: '💚 Wellness / Support',    value: 'community:wellness',  description: 'Quiet, kind, safe harbor spaces' },
  ];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('custom_mix_community')
      .setPlaceholder(active ? '👥 Community ✅ selected' : '👥 Community spaces (pick any)')
      .setMinValues(0).setMaxValues(Math.min(opts.length, 10))
      .addOptions(opts.map(o => ({ ...o, default: sels.has(o.value) })))
  );
}

function _buildCustomMixMediaRow(settings) {
  const sels = new Set(Array.isArray(settings.customCatalogSelections) ? settings.customCatalogSelections : []);
  const active = _customMixActive(settings, 'media:');
  const opts = [
    { label: '🎬 Movies & Film',         value: 'media:movies',        description: 'Reviews, watch parties, recommendations' },
    { label: '📺 TV & Streaming',        value: 'media:tv',            description: 'Show talk, binges, schedule nights' },
    { label: '🍜 Anime Universe',        value: 'media:anime',         description: 'Cel-shade culture, recs, seasonal watch' },
    { label: '📚 Books & Comics',        value: 'media:books',         description: 'Reading groups, reviews, lore dives' },
    { label: '🦸 Marvel / MCU',          value: 'media:marvel',        description: 'Comic talk, MCU reactions, theory crafting' },
    { label: '⚡ Star Wars / Sci-Fi',    value: 'media:scifi',         description: 'Lore, theories, watch nights' },
    { label: '🏰 Disney & Animation',    value: 'media:disney',        description: 'Fan talk, news, watch parties' },
    { label: '🎤 Music / Artist Fan Hub',value: 'media:musicfan',      description: 'Stan culture, new drops, concerts' },
    { label: '🤼 Pro Wrestling',         value: 'media:wrestling',     description: 'Events, results, fantasy booking' },
    { label: '📰 News & Current Events', value: 'media:news',          description: 'Headlines, discussion, fact checks' },
  ];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('custom_mix_media')
      .setPlaceholder(active ? '📺 Media & Fandom ✅ selected' : '📺 Media & Fandom spaces (pick any)')
      .setMinValues(0).setMaxValues(Math.min(opts.length, 10))
      .addOptions(opts.map(o => ({ ...o, default: sels.has(o.value) })))
  );
}



function _buildMainEmbed(guild, note, settings, prefs) {
  const profile = settings.serverTemplate ? templateLogic.getTemplateProfile(settings) : null;

  // Resolve theme from one service — no inline fallback logic
  const theme = templateTheme.getThemePreset(settings);

  const isEdit = !!settings.serverInitialized;
  const title = isEdit ? '🛠️ myBot Setup Wizard • EDIT MODE' : '🛠️ myBot Setup Wizard';

  const stage = wizardState.getCurrentStep() || 'mode';
  const stageMeta = stageRegistry.getStage(stage);
  const fieldLabel = stageMeta.label;
  const fieldValue = stageMeta.description;

  // Theme preview — resolved from templateTheme service, no inline fallback
  const themePreviewText = (() => {
    try {
      const tname = String(theme.appliedName || 'Clean Midnight').slice(0, 80);
      const motif = String(theme.motif || '').slice(0, 200);
      const palette = Array.isArray(theme.palette) ? theme.palette : [];
      const swatches = palette.slice(0, 3).map(c => {
        const h = c ? String(c).replace('#', '').toUpperCase() : '';
        return h ? '`#' + h + '`' : null;
      }).filter(Boolean).join(' · ');
      return ('**' + tname + '**\n' + motif + '\n' + swatches).slice(0, 1024);
    } catch { return 'Theme preview unavailable'; }
  })();

  return new EmbedBuilder()
    .setColor(theme?.accentColor || 0x5865f2)
    .setTitle(title)
    .setDescription(buildSummaryText(settings, prefs, note))
    .addFields(
      { name: fieldLabel, value: fieldValue },
      ...(stage === 'mode' ? [{ name: 'Structure strategy', value: '**BASE**: core lanes + template.\n**CUSTOM**: core lanes + selected custom packs.\n**EMPTY**: template + staff controls only; no standard community stack.' }] : []),
      { name: 'Template summary', value: profile?.summary || 'Choose a server template to unlock the right categories, channels, rules, and guide flow.' },
      { name: 'Theme preview', value: themePreviewText, inline: false },
    )
    .setFooter({ text: 'This wizard edits in place so you do not have to scroll through a pile of setup prompts.' })
    .setTimestamp();
}

// ── Payload builders ──────────────────────────────────────────────────────

function buildFlowGuidePayload() {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🧭 Setup Flow Guide')
      .setDescription(
        'Confirm this guide to open the main setup wizard. The setup will stay in one edited bot message instead of stacking a pile of prompts.\n\n' +
        '**1. Choose structure strategy**\n**Base** = core server lanes + template. **Custom** = core lanes + only the custom packs you select. **Empty** = no standard community stack; build only the selected template plus staff controls.\n\n' +
        '**2. Choose template + subtemplate**\nTemplate controls server purpose, channel pack, rules context, theme, and AI context. Subtemplate narrows that behavior when one is available.\n\n' +
        '**3. Custom picks, only when Custom is selected**\nMix Gaming, Sports, Community, and Media packs. The bot arranges the selected packs into their own categories.\n\n' +
        '**4. Audience + AI tone**\nAudience level is required before tone. Member and commissioner AI can share a tone profile or use separate profiles.\n\n' +
        '**5. Final review**\nReview identity, rules, GIFs, timezone gate, structure, and template before build/apply.'
      )
      .setFooter({ text: 'Click Start Setup to move into the main setup message.' })
      .setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup_wizard_seed_refresh').setLabel('⚡ Start Setup').setStyle(ButtonStyle.Primary)
    )],
    allowedMentions: { parse: [] },
  };
}

/**
 * Main wizard payload builder — single source of truth for all wizard stages.
 * Replaces the inline _buildSetupWizardSinglePayload in interactionRouter.
 *
 * @param {Guild|null} guild
 * @param {string}     note   — optional status note shown in the description
 * @param {object}     opts   — { settings, prefs } pre-loaded to avoid redundant reads
 */
function buildWizardPayload(guild, note = '', opts = {}) {
  try {
    // Load settings snapshot once — never spread or alias to liveSettings
    const settings = opts.settings || serverSettings.getSettings();
    const prefs    = opts.prefs    || wizardPrefs.getPrefs();
    const stage    = wizardState.getCurrentStep() || 'flow';

    if (stage === 'flow') return buildFlowGuidePayload();

    // Determine if build button should be disabled
    const { canAdvance, missing } = wizardState.canAdvanceFrom(stage, settings, prefs);
    const noteText = note || (missing.length ? `Still required: **${missing.join(', ')}**` : 'All required choices are selected. Review everything, then build when ready.');

    const embed = _buildMainEmbed(guild, noteText, settings, prefs);
    const isEdit = !!settings.serverInitialized;
    const rows = [];

    if (stage === 'mode') {
      rows.push(
        _buildStructureModeRow(settings),
        _buildTemplateRow(settings),
        _buildSubtemplateRow(settings),
        _buildNavRow('mode', !canAdvance, isEdit),
      );
    } else if (stage === 'custom_structure') {
      rows.push(_buildCustomMixGamingRow(settings));
      rows.push(_buildCustomMixSportsRow(settings));
      rows.push(_buildCustomMixCommunityRow(settings));
      rows.push(_buildCustomMixMediaRow(settings));
      rows.push(_buildNavRow('custom_structure', !canAdvance, isEdit));
    } else if (stage === 'tone') {
      rows.push(_buildAudienceRow(settings));
      rows.push(_buildPreferenceToggleRow(settings));
      rows.push(_buildToneRow('member_tone_profile', settings.useSharedToneProfile ? 'Pick shared tones for both AI lanes...' : 'Pick member-AI tones...', settings));
      if (!settings.useSharedToneProfile) {
        rows.push(_buildToneRow('commissioner_tone_profile', 'Pick commissioner-AI tones...', settings));
      }
      rows.push(_buildNavRow('tone', !settings.audienceRating, isEdit));
    } else {
      // finalize
      rows.push(_buildIdentityButtonRow());
      rows.push(serverRules.buildWizardButtonRow());
      rows.push(_buildPreferenceToggleRow(settings));
      rows.push(_buildTimezoneToggleRow(settings));
      rows.push(_buildNavRow('finalize', !canAdvance, isEdit));
    }

    return {
      embeds: [embed],
      components: rows.slice(0, 5),
      allowedMentions: { parse: [] },
    };
  } catch (err) {
    log.error('buildWizardPayload failed:', err.message);
    return buildErrorPayload(err.message);
  }
}

function buildErrorPayload(errMessage) {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🛠️ myBot Setup Wizard')
      .setDescription(`⚠️ Wizard build error: ${errMessage}\n\nPress **Reset** below to restart setup cleanly.`)
      .setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bot_setup_reset').setLabel('Reset Wizard').setStyle(ButtonStyle.Danger)
    )],
    allowedMentions: { parse: [] },
  };
}

module.exports = {
  buildWizardPayload,
  buildFlowGuidePayload,
  buildErrorPayload,
  buildSummaryText,
};
