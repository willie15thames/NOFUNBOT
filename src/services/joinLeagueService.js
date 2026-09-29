/*
 * NAVIGATION HEADER
 * FILE: src/services/joinLeagueService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */


'use strict';
const interactionExecution = require('./interactionExecutionContext');

const {
  EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const activeLeagueService = require('./activeLeagueService');
const buttonChoices = require('./buttonChoiceService');
const { LEAGUE_TYPES } = require('./leagueSetupService');
const { getOpenTeamsForLeague, claimTeam, createOrClaimCustomTeam } = require('./openTeamsService');
const { normalizeTimezone } = require('./timezoneService');
const { makeLogger } = require('../utils/logger');
const onboardingService = require('./leagueMemberOnboardingService');
const memberProfiles = require('./memberProfileService');
const nicknamePolicy = require('./nicknamePolicyService');
const log = makeLogger('joinLeague');

function leagueDefById(leagueTypeId) {
  return LEAGUE_TYPES[leagueTypeId] || null;
}


function _buildLeagueRows(opts, context = {}) {
  return buttonChoices.createChoiceRows({
    guildId:context.guildId || null, actorId:context.actorId || null, public:context.public === true,
    flow:'join-league', legacyCustomId:'join_league_select', minValues:1, maxValues:1, options:opts,
  }).rows;
}

function leagueOptions(state, guildId = null) {
  return activeLeagueService.listJoinableLeagues({ guildId:guildId || state?.guildId || null }).slice(0,25).map(l => ({
    label: String(l.leagueName || 'League').slice(0,100),
    value: String(l.id),
    description: String(activeLeagueService.leagueTypeLabel(l.leagueTypeId)).slice(0,100),
  }));
}

function _selectedLeaguePayload(league, state, context = {}) {
  const def = leagueDefById(league.leagueTypeId) || {};
  const openTeams = getOpenTeamsForLeague(league.id);
  const rows = [];
  let description = `**League:** ${league.leagueName}\n**Type:** ${activeLeagueService.leagueTypeLabel(league.leagueTypeId)}\n\n`;
  if (openTeams.length) {
    rows.push(...buttonChoices.createChoiceRows({
      guildId:context.guildId || null, actorId:context.actorId || null, public:context.public === true,
      flow:'join-team', legacyCustomId:`join_team_select::${league.id}`, minValues:1, maxValues:1,
      options:openTeams.map(t => ({ label:String(t.displayTeam).slice(0,80), value:String(t.baseTeam), description:String(t.replacementFor ? `${t.displayTeam} replacing ${t.replacementFor}` : t.baseTeam).slice(0,100) })),
    }).rows);
    description += 'Choose an available team below. Your timezone is selected next, before the claim is finalized.';
  } else {
    description += 'No standard open team slots are posted for this league right now.';
  }
  if (def.isProAm || def.isCustom) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`join_custom_team::${league.id}`).setLabel('Register Custom / Team Builder Team').setStyle(ButtonStyle.Primary)
    ));
    description += '\n\nCustom / Pro-Am path: use the button to enter your custom team details.';
  }
  return {
    embeds:[new EmbedBuilder().setColor(0x3498db).setTitle(`🏁 ${league.leagueName} — Join Flow`).setDescription(description).setTimestamp()],
    components:rows,
  };
}

async function sendJoinLeaguePrompt(interaction, state, requestedLeagueId = null) {
  const opts = leagueOptions(state, interaction.guildId || interaction.guild?.id || null);
  if (!opts.length) {
    return interactionExecution.for(interaction).reply({ content: '🏗️ No active league exists yet. A commissioner can create the first league with `/setup-league`. A separate league-enabled community is not required.', flags: 64 });
  }
  if (requestedLeagueId && requestedLeagueId !== '_none_') {
    const resolved = require('./leagueResolverService').resolveLeague(requestedLeagueId, { guildId:interaction.guildId || interaction.guild?.id, mode:'joinable' });
    if (!resolved.ok) return interactionExecution.for(interaction).reply({ content:`❌ ${resolved.message}`, flags:64 });
    return interactionExecution.for(interaction).reply({ ..._selectedLeaguePayload(resolved.league, state, { guildId:interaction.guildId, actorId:interaction.user.id }), flags:64 });
  }
  const totalOpen = Array.isArray(state.openTeamRegistry) ? state.openTeamRegistry.filter(t => t.isOpen).length : 0;
  const rows = _buildLeagueRows(opts, { guildId:interaction.guildId, actorId:interaction.user.id });
  return interactionExecution.for(interaction).reply({
    embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle('🏟 Join a League').setDescription(totalOpen > 0 ? 'Pick the exact league you want to join. Team choices shown next are scoped only to that league.' : 'Pick a league to browse. Standard slots may be full right now, so you may need the wait-list or a custom-team path depending on the league.').setTimestamp()],
    components:rows, flags:64
  });
}

async function sendJoinLeaguePromptFromMessage(message, state) {
  const opts = leagueOptions(state, message.guild?.id || null);
  const totalOpen = Array.isArray(state.openTeamRegistry) ? state.openTeamRegistry.filter(t => t.isOpen).length : 0;
  if (!opts.length) {
    return message.channel.send({ content: '❌ No active leagues exist yet. The commissioner must run `/setup-league league-name:<name>` first.' });
  }
  const rows = _buildLeagueRows(opts, { guildId:message.guild?.id || null, public:true });
  return message.channel.send({
    embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle('🏟 Join a League').setDescription(totalOpen > 0 ? 'Choose a league below. Standard leagues will give you a team picker. Custom / Pro-Am leagues will prompt for a custom team name, replacement slot, logo URL, and timezone.' : 'Choose a league below. Standard slots may be full right now, but custom / Pro-Am leagues can still prompt for a custom team path if enabled.').setTimestamp()],
    components:rows,
    allowedMentions:{parse:[]}
  });
}

async function handleJoinInteraction(interaction, state) {
  const cid = interaction.customId;
  if (interaction.isStringSelectMenu?.() && cid === 'join_league_select') {
    const leagueId = interaction.values[0];
    const resolved = require('./leagueResolverService').resolveLeague(leagueId, { guildId:interaction.guildId, mode:'joinable' });
    if (!resolved.ok) return interactionExecution.for(interaction).update({ content:`❌ ${resolved.message}`, components:[], embeds:[] });
    return interactionExecution.for(interaction).update(_selectedLeaguePayload(resolved.league, state, { guildId:interaction.guildId, actorId:interaction.user.id }));
  }

  if (interaction.isStringSelectMenu?.() && cid.startsWith('join_team_select::')) {
    const leagueId = cid.split('::')[1];
    const team = interaction.values[0];
    const resolved = require('./leagueResolverService').resolveLeague(leagueId, { guildId:interaction.guildId, mode:'joinable' });
    if (!resolved.ok) return interactionExecution.for(interaction).update({ content:`❌ ${resolved.message}`, embeds:[], components:[] });
    const league = resolved.league;
    return interactionExecution.for(interaction).update({
      embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle(`👋 One last step for ${league.leagueName}`).setDescription(`**Team:** ${team}\n\nChoose your timezone. After it saves, your team claim is finalized and your timezone nickname suffix is applied.`).setTimestamp()],
      components:[require('./timezoneGateService').buildTimezoneSelectRow(`join_tz::${leagueId}::${encodeURIComponent(team)}`, { guildId:interaction.guildId, actorId:interaction.user.id, public:false })],
    });
  }

  if (interaction.isStringSelectMenu?.() && cid.startsWith('join_tz::')) {
    const [, leagueId, encTeam] = cid.split('::');
    const team = decodeURIComponent(encTeam || '');
    const timezone = normalizeTimezone(interaction.values?.[0] || '');
    if (!timezone) return interactionExecution.for(interaction).reply({ content:'❌ Invalid timezone choice.', flags:64 });
    const result = await claimTeam(interaction.guild, interaction.member, team, { timezone, leagueId });
    if (!result.success) return interactionExecution.for(interaction).update({ content:`❌ ${result.reason}`, embeds:[], components:[] });
    memberProfiles.upsertProfile(interaction.member.id, { timezone, timezoneLabel:nicknamePolicy.timezoneLabel(timezone) });
    const nick = await nicknamePolicy.syncMemberNickname(interaction.member, state, { reason:'League join onboarding complete' }).catch(() => null);
    onboardingService.markTimezoneComplete(interaction.member.id, leagueId, timezone, nick);
    return interactionExecution.for(interaction).update({
      content:'',
      embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle(`✅ Welcome to ${result.entry.leagueName || 'your league'}`).setDescription(`You joined as **${result.entry.displayTeam}**.\n\n**Timezone:** ${nicknamePolicy.timezoneLabel(timezone) || timezone}\n**League:** ${result.entry.leagueName || leagueId}\n\nYour league access and scheduling profile are ready.`).setTimestamp()],
      components:[],
    });
  }

  if (interaction.isButton?.() && cid.startsWith('join_custom_team::')) {
    const leagueId = cid.split('::')[1];
    const modal = new ModalBuilder().setCustomId(`join_custom_team_modal::${leagueId}`).setTitle('Custom / Team Builder Team');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('team_name').setLabel('Team name').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('replacement_slot').setLabel('What team slot is this replacing?').setPlaceholder('Optional, e.g. Chargers').setStyle(TextInputStyle.Short).setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('logo_url').setLabel('Logo URL').setPlaceholder('Optional Discord CDN or image URL').setStyle(TextInputStyle.Short).setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('timezone').setLabel('Timezone').setPlaceholder('America/Los_Angeles or EST').setStyle(TextInputStyle.Short).setRequired(true)),
    );
    return interaction.showModal(modal);
  }
}

async function handleJoinModal(interaction, state, guild, grantMemberAccess) {
  const cid = interaction.customId;
  if (cid.startsWith('join_team_timezone::')) {
    const [, leagueId, encTeam] = cid.split('::');
    const team = decodeURIComponent(encTeam || '');
    const timezone = normalizeTimezone(interaction.fields.getTextInputValue('timezone'));
    if (!timezone) return interactionExecution.for(interaction).reply({ content:'❌ Invalid timezone. Use `America/Los_Angeles`, `America/New_York`, `UTC`, `EST`, or `PST`.', flags:64 });
    const result = await claimTeam(guild, interaction.member, team, { timezone, leagueId });
    if (!result.success) return interactionExecution.for(interaction).reply({ content:`❌ ${result.reason}`, flags:64 });

    return interactionExecution.for(interaction).reply({ content:`✅ You joined **${result.entry.leagueName || 'the league'}** as **${result.entry.displayTeam}**. Timezone saved as **${timezone}**.`, flags:64 });
  }

  if (cid.startsWith('join_custom_team_modal::')) {
    const leagueId = cid.split('::')[1];
    const teamName = interaction.fields.getTextInputValue('team_name');
    const replacementFor = interaction.fields.getTextInputValue('replacement_slot');
    const logoUrl = interaction.fields.getTextInputValue('logo_url');
    const timezone = normalizeTimezone(interaction.fields.getTextInputValue('timezone'));
    if (!timezone) return interactionExecution.for(interaction).reply({ content:'❌ Invalid timezone. Use `America/Los_Angeles`, `America/New_York`, `UTC`, `EST`, or `PST`.', flags:64 });
    const result = await createOrClaimCustomTeam(guild, interaction.member, { leagueId, teamName, replacementFor, logoUrl, timezone });
    if (!result.success) return interactionExecution.for(interaction).reply({ content:`❌ ${result.reason}`, flags:64 });

    const replaceText = result.entry.replacementFor ? ` replacing **${result.entry.replacementFor}**` : '';
    return interactionExecution.for(interaction).reply({ content:`✅ Welcome to **${result.entry.leagueName || 'the league'}**. Custom team **${result.entry.displayTeam}** joined${replaceText}. Timezone saved as **${timezone}** and your scheduling profile is ready.`, flags:64 });
  }
}

module.exports = {
  sendJoinLeaguePrompt,
  sendJoinLeaguePromptFromMessage,
  handleJoinInteraction,
  handleJoinModal,
};
