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

async function sendJoinLeaguePrompt(interaction, state) {
  const opts = leagueOptions(state);
  const totalOpen = Array.isArray(state.openTeamRegistry) ? state.openTeamRegistry.filter(t => t.isOpen).length : 0;
  if (!opts.length) {
    return interaction.reply({ content: '🏗️ No active league exists yet. A commissioner can create the first league with `/setup-league`. A separate league-enabled community is not required.', flags: 64 });
  }
  const row = _buildLeagueRow(opts);
  return interaction.reply({
    embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle('🏟 Join a League').setDescription(totalOpen > 0 ? 'Pick the league you want to join. The bot will then show the right team-claim flow for that league type.' : 'Pick a league to browse. Standard slots may be full right now, so you may need the wait-list or a custom-team path depending on the league.').setTimestamp()],
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
    const def = leagueDefById(league.leagueTypeId) || {};
    const openTeams = getOpenTeamsForLeague(league.id);
    const rows = [];
    let description = `**League:** ${league.leagueName}
**Type:** ${activeLeagueService.leagueTypeLabel(league.leagueTypeId)}

`;

    if (openTeams.length) {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`join_team_select::${league.id}`).setPlaceholder('Choose an available team...').addOptions(
          openTeams.slice(0,25).map(t => new StringSelectMenuOptionBuilder().setLabel(String(t.displayTeam).slice(0,100)).setValue(String(t.baseTeam)).setDescription(String(t.replacementFor ? `${t.displayTeam} replacing ${t.replacementFor}` : t.baseTeam).slice(0,100)))
        )
      ));
      description += 'Choose an available team from the dropdown below.';
    } else {
      description += 'No standard open team slots are posted for this league right now.';
    }

    if (def.isProAm || def.isCustom) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`join_custom_team::${league.id}`).setLabel('Register Custom / Team Builder Team').setStyle(ButtonStyle.Primary)
      ));
      description += '\n\nCustom / Pro-Am path: click the button to enter a team name, replacement slot, logo URL, and timezone.';
    }

    return interaction.update({
      embeds:[new EmbedBuilder().setColor(0x3498db).setTitle(`🏁 ${league.leagueName} — Join Flow`).setDescription(description).setTimestamp()],
      components: rows,
    });
  }

  if (interaction.isStringSelectMenu?.() && cid.startsWith('join_team_select::')) {
    const leagueId = cid.split('::')[1];
    const team = interaction.values[0];
    const modal = new ModalBuilder().setCustomId(`join_team_timezone::${leagueId}::${encodeURIComponent(team)}`).setTitle('Finish Team Claim');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('timezone').setLabel('Timezone').setPlaceholder('America/Los_Angeles or EST').setStyle(TextInputStyle.Short).setRequired(true))
    );
    return interaction.showModal(modal);
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
    return interaction.reply({ content:`✅ Custom team **${result.entry.displayTeam}** joined **${result.entry.leagueName || 'the league'}**${replaceText}. Timezone saved as **${timezone}**.`, flags:64 });
  }
}

module.exports = {
  sendJoinLeaguePrompt,
  sendJoinLeaguePromptFromMessage,
  handleJoinInteraction,
  handleJoinModal,
};
