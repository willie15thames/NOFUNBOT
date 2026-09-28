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

const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const activeLeagueService = require('./activeLeagueService');
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


function _buildLeagueRow(opts) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('join_league_select').setPlaceholder('Choose a league to join...').addOptions(
      opts.map(o => new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value).setDescription(o.description))
    )
  );
}

function leagueOptions(state) {
  return activeLeagueService.listResetOptions(state).slice(0,25).map(l => ({
    label: String(l.leagueName || 'League').slice(0,100),
    value: String(l.id),
    description: String(activeLeagueService.leagueTypeLabel(l.leagueTypeId)).slice(0,100),
  }));
}

function _selectedLeaguePayload(league, state) {
  const def = leagueDefById(league.leagueTypeId) || {};
  const openTeams = getOpenTeamsForLeague(league.id);
  const rows = [];
  let description = `**League:** ${league.leagueName}\n**Type:** ${activeLeagueService.leagueTypeLabel(league.leagueTypeId)}\n\n`;
  if (openTeams.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`join_team_select::${league.id}`).setPlaceholder(`Choose a team in ${String(league.leagueName).slice(0,60)}...`).addOptions(
        openTeams.slice(0,25).map(t => new StringSelectMenuOptionBuilder().setLabel(String(t.displayTeam).slice(0,100)).setValue(String(t.baseTeam)).setDescription(String(t.replacementFor ? `${t.displayTeam} replacing ${t.replacementFor}` : t.baseTeam).slice(0,100)))
      )
    ));
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
  const opts = leagueOptions(state);
  if (!opts.length) {
    return interaction.reply({ content: '🏗️ No active league exists yet. A commissioner can create the first league with `/setup-league`. A separate league-enabled community is not required.', flags: 64 });
  }
  if (requestedLeagueId && requestedLeagueId !== '_none_') {
    const selected = activeLeagueService.getLeague(requestedLeagueId) || activeLeagueService.listResetOptions(state).find(l => String(l.id) === String(requestedLeagueId));
    if (selected) return interaction.reply({ ..._selectedLeaguePayload(selected, state), flags:64 });
  }
  const totalOpen = Array.isArray(state.openTeamRegistry) ? state.openTeamRegistry.filter(t => t.isOpen).length : 0;
  const row = _buildLeagueRow(opts);
  return interaction.reply({
    embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle('🏟 Join a League').setDescription(totalOpen > 0 ? 'Pick the exact league you want to join. Team choices shown next are scoped only to that league.' : 'Pick a league to browse. Standard slots may be full right now, so you may need the wait-list or a custom-team path depending on the league.').setTimestamp()],
    components:[row], flags:64
  });
}

async function sendJoinLeaguePromptFromMessage(message, state) {
  const opts = leagueOptions(state);
  const totalOpen = Array.isArray(state.openTeamRegistry) ? state.openTeamRegistry.filter(t => t.isOpen).length : 0;
  if (!opts.length) {
    return message.channel.send({ content: '❌ No active leagues exist yet. The commissioner must run `/setup-league league-name:<name>` first.' });
  }
  const row = _buildLeagueRow(opts);
  return message.channel.send({
    embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle('🏟 Join a League').setDescription(totalOpen > 0 ? 'Choose a league below. Standard leagues will give you a team picker. Custom / Pro-Am leagues will prompt for a custom team name, replacement slot, logo URL, and timezone.' : 'Choose a league below. Standard slots may be full right now, but custom / Pro-Am leagues can still prompt for a custom team path if enabled.').setTimestamp()],
    components:[row],
    allowedMentions:{parse:[]}
  });
}

async function handleJoinInteraction(interaction, state) {
  const cid = interaction.customId;
  if (interaction.isStringSelectMenu?.() && cid === 'join_league_select') {
    const leagueId = interaction.values[0];
    const league = activeLeagueService.getLeague(leagueId);
    if (!league) return interaction.update({ content:'❌ League not found anymore.', components:[], embeds:[] });
    return interaction.update(_selectedLeaguePayload(league, state));
  }

  if (interaction.isStringSelectMenu?.() && cid.startsWith('join_team_select::')) {
    const leagueId = cid.split('::')[1];
    const team = interaction.values[0];
    const league = activeLeagueService.getLeague(leagueId);
    if (!league) return interaction.update({ content:'❌ League not found anymore.', embeds:[], components:[] });
    return interaction.update({
      embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle(`👋 One last step for ${league.leagueName}`).setDescription(`**Team:** ${team}\n\nChoose your timezone. After it saves, your team claim is finalized and your timezone nickname suffix is applied.`).setTimestamp()],
      components:[require('./timezoneGateService').buildTimezoneSelectRow(`join_tz::${leagueId}::${encodeURIComponent(team)}`)],
    });
  }

  if (interaction.isStringSelectMenu?.() && cid.startsWith('join_tz::')) {
    const [, leagueId, encTeam] = cid.split('::');
    const team = decodeURIComponent(encTeam || '');
    const timezone = normalizeTimezone(interaction.values?.[0] || '');
    if (!timezone) return interaction.reply({ content:'❌ Invalid timezone choice.', flags:64 });
    const result = await claimTeam(interaction.guild, interaction.member, team, { timezone, leagueId });
    if (!result.success) return interaction.update({ content:`❌ ${result.reason}`, embeds:[], components:[] });
    memberProfiles.upsertProfile(interaction.member.id, { timezone, timezoneLabel:nicknamePolicy.timezoneLabel(timezone) });
    const nick = await nicknamePolicy.syncMemberNickname(interaction.member, state, { reason:'League join onboarding complete' }).catch(() => null);
    onboardingService.markTimezoneComplete(interaction.member.id, leagueId, timezone, nick);
    return interaction.update({
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
    if (!timezone) return interaction.reply({ content:'❌ Invalid timezone. Use `America/Los_Angeles`, `America/New_York`, `UTC`, `EST`, or `PST`.', flags:64 });
    const result = await claimTeam(guild, interaction.member, team, { timezone, leagueId });
    if (!result.success) return interaction.reply({ content:`❌ ${result.reason}`, flags:64 });

    return interaction.reply({ content:`✅ You joined **${result.entry.leagueName || 'the league'}** as **${result.entry.displayTeam}**. Timezone saved as **${timezone}**.`, flags:64 });
  }

  if (cid.startsWith('join_custom_team_modal::')) {
    const leagueId = cid.split('::')[1];
    const teamName = interaction.fields.getTextInputValue('team_name');
    const replacementFor = interaction.fields.getTextInputValue('replacement_slot');
    const logoUrl = interaction.fields.getTextInputValue('logo_url');
    const timezone = normalizeTimezone(interaction.fields.getTextInputValue('timezone'));
    if (!timezone) return interaction.reply({ content:'❌ Invalid timezone. Use `America/Los_Angeles`, `America/New_York`, `UTC`, `EST`, or `PST`.', flags:64 });
    const result = await createOrClaimCustomTeam(guild, interaction.member, { leagueId, teamName, replacementFor, logoUrl, timezone });
    if (!result.success) return interaction.reply({ content:`❌ ${result.reason}`, flags:64 });

    const replaceText = result.entry.replacementFor ? ` replacing **${result.entry.replacementFor}**` : '';
    return interaction.reply({ content:`✅ Welcome to **${result.entry.leagueName || 'the league'}**. Custom team **${result.entry.displayTeam}** joined${replaceText}. Timezone saved as **${timezone}** and your scheduling profile is ready.`, flags:64 });
  }
}

module.exports = {
  sendJoinLeaguePrompt,
  sendJoinLeaguePromptFromMessage,
  handleJoinInteraction,
  handleJoinModal,
};
