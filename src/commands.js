/*
 * NAVIGATION HEADER
 * FILE: src/commands.js
 * LAYER: Project file
 * PURPOSE: Defines slash-command behavior or command dispatch logic.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
// src/commands.js — all slash command definitions
// Every addXxxOption must have .setDescription() — Discord.js v14 requires it.
const { SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const P = 0; // setDefaultMemberPermissions(0) = admin/commissioner only

// MESSAGE context menu commands — commissioners right-click any bot message to edit or delete it
const contextMenuCommands = [
  new ContextMenuCommandBuilder()
    .setName('Edit Bot Message')
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(P),
  new ContextMenuCommandBuilder()
    .setName('Delete Bot Message')
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(P),
];

const commandBuilders = [

  // ── Admin management ──
  new SlashCommandBuilder()
    .setName('add-admin').setDescription('Add a user to the commissioner/admin list (Commissioner only)')
    .addUserOption(o => o.setName('user').setDescription('User to promote to commissioner').setRequired(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('remove-admin').setDescription('Remove a user from the admin list (Commissioner only)')
    .addUserOption(o => o.setName('user').setDescription('User to demote').setRequired(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('list-admins').setDescription('Show all current commissioners and admins'),

  new SlashCommandBuilder()
    .setName('lock-bot-access')
    .setDescription('Re-apply bot + commissioner permissions to all channels (Commissioner only)')
    .setDefaultMemberPermissions(P),

  // ── Primary Server Commands ─────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('setup-server')
    .setDescription('Open the setup wizard to configure your server (Commissioner only)')
    .setDefaultMemberPermissions(P),

  new SlashCommandBuilder()
    .setName('setup-community')
    .setDescription('Create a new community in this server with auto-generated channels (Commissioner only)')
    .addStringOption(o => o.setName('name').setDescription('Community name').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Community type').setRequired(false)
      .addChoices(
        { name: 'League — competitive, team-based', value: 'league' },
        { name: 'Events — watch parties, scheduled', value: 'events' },
        { name: 'Social — casual chat, hangout', value: 'social' },
        { name: 'Fan Zone — fandom, no competition', value: 'fanzone' },
        { name: 'Competitive — ranked, esports', value: 'competitive' },
        { name: 'Educational — study, learning', value: 'edu' },
        { name: 'Wellness — support, safe space', value: 'wellness' },
      ))
    .setDefaultMemberPermissions(P),

  new SlashCommandBuilder()
    .setName('edit-community')
    .setDescription('Modify a community name or type (Commissioner only)')
    .addStringOption(o => o.setName('name').setDescription('Current community name').setRequired(true))
    .addStringOption(o => o.setName('new-name').setDescription('New name (leave blank to keep current)').setRequired(false))
    .addStringOption(o => o.setName('type').setDescription('New community type').setRequired(false)
      .addChoices(
        { name: 'League — competitive, team-based', value: 'league' },
        { name: 'Events — watch parties, scheduled', value: 'events' },
        { name: 'Social — casual chat, hangout', value: 'social' },
        { name: 'Fan Zone — fandom, no competition', value: 'fanzone' },
        { name: 'Competitive — ranked, esports', value: 'competitive' },
        { name: 'Educational — study, learning', value: 'edu' },
        { name: 'Wellness — support, safe space', value: 'wellness' },
      ))
    .setDefaultMemberPermissions(P),

  new SlashCommandBuilder()
    .setName('delete-community')
    .setDescription('Remove a community and all its channels and roles (Commissioner only)')
    .addStringOption(o => o.setName('name').setDescription('Community name to delete').setRequired(true))
    .addBooleanOption(o => o.setName('confirm').setDescription('Type true to confirm deletion').setRequired(true))
    .setDefaultMemberPermissions(P),

  new SlashCommandBuilder()
    .setName('list-communities')
    .setDescription('Show all communities in this server'),

  // ── Optional System Commands ────────────────────────────────────────────

new SlashCommandBuilder()
  .setName('process-builder').setDescription('Create inspect toggle or delete managed processes (Commissioner only)')
  .addSubcommand(sc => sc.setName('create').setDescription('Create a managed process from a preset')
    .addStringOption(o => o.setName('name').setDescription('Process name').setRequired(true))
    .addStringOption(o => o.setName('preset').setDescription('Process preset').setRequired(true)
      .addChoices(
        { name: 'Onboarding Foundation', value: 'onboarding-foundation' },
        { name: 'Governance Recovery', value: 'governance-recovery' },
        { name: 'Live Ops Loop', value: 'live-ops-loop' },
        { name: 'Community Launch', value: 'community-launch' },
        { name: 'Patch Publish', value: 'patch-publish' },
      ))
    .addStringOption(o => o.setName('trigger').setDescription('When the process is expected to run').setRequired(false)
      .addChoices(
        { name: 'Manual', value: 'manual' },
        { name: 'Setup Complete', value: 'setup-complete' },
        { name: 'Community Created', value: 'community-created' },
        { name: 'Weekly Schedule', value: 'weekly-schedule' },
        { name: 'Reset Complete', value: 'reset-complete' },
      ))
    .addStringOption(o => o.setName('description').setDescription('Optional process description'))
    .addBooleanOption(o => o.setName('enabled').setDescription('Whether the process should start enabled')))
  .addSubcommand(sc => sc.setName('list').setDescription('List all managed processes'))
  .addSubcommand(sc => sc.setName('inspect').setDescription('Inspect one managed process')
    .addStringOption(o => o.setName('name').setDescription('Process name').setRequired(true)))
  .addSubcommand(sc => sc.setName('toggle').setDescription('Enable or disable one managed process')
    .addStringOption(o => o.setName('name').setDescription('Process name').setRequired(true))
    .addBooleanOption(o => o.setName('enabled').setDescription('True to enable false to disable').setRequired(true)))
  .addSubcommand(sc => sc.setName('delete').setDescription('Delete one managed process')
    .addStringOption(o => o.setName('name').setDescription('Process name').setRequired(true)))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('process-run').setDescription('Run a managed process immediately (Commissioner only)')
  .addStringOption(o => o.setName('name').setDescription('Process name').setRequired(true))
  .setDefaultMemberPermissions(P),

  new SlashCommandBuilder()
    .setName('setup-event')
    .setDescription('Create a scheduled event in this server (Commissioner only)')
    .addStringOption(o => o.setName('name').setDescription('Event name').setRequired(true))
    .addStringOption(o => o.setName('community').setDescription('Community to attach this event to').setRequired(false))
    .addStringOption(o => o.setName('description').setDescription('Event description').setRequired(false))
    .setDefaultMemberPermissions(P),

  new SlashCommandBuilder()
    .setName('setup-team')
    .setDescription('Create a team inside a league (Commissioner only — requires active league)')
    .addStringOption(o => o.setName('name').setDescription('Team name').setRequired(true))
    .addStringOption(o => o.setName('community').setDescription('Community the league is in').setRequired(true))
    .setDefaultMemberPermissions(P),

  new SlashCommandBuilder()
    .setName('hierarchy-status')
    .setDescription('Show current server hierarchy state and gate status (Commissioner only)')
    .setDefaultMemberPermissions(P),

  new SlashCommandBuilder()
    .setName('toggle-team-mode')
    .setDescription('Change community type between league-enabled / event-driven / social (Commissioner only)')
    .addStringOption(o => o.setName('community').setDescription('Community name').setRequired(true))
    .addStringOption(o => o.setName('mode').setDescription('New mode').setRequired(true)
      .addChoices(
        { name: 'League enabled (teams + competition)', value: 'league-enabled' },
        { name: 'Event driven (watch parties, no teams)', value: 'event-driven' },
        { name: 'Community driven (casual)', value: 'community-driven' },
      ))
    .setDefaultMemberPermissions(P),

  // ── Teams ──
  new SlashCommandBuilder()
    .setName('register-team').setDescription('Link a Discord user to a franchise slot (Commissioner only)')
    .addStringOption(o => o.setName('team').setDescription('Original Madden franchise slot, e.g. Ravens').setRequired(true).setAutocomplete(true))
    .addUserOption(o => o.setName('user').setDescription('The Discord user who owns this slot').setRequired(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('set-team-identity').setDescription('Set a custom city/name for a franchise slot (Commissioner only)')
    .addStringOption(o => o.setName('original-team').setDescription('Original Madden slot to rename, e.g. Chargers').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('location').setDescription('New city name, e.g. Sacramento').setRequired(true))
    .addStringOption(o => o.setName('name').setDescription('New team name, e.g. Kings').setRequired(true))
    .addUserOption(o => o.setName('user').setDescription('Owner of this slot (optional if already registered)'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('add-open-team').setDescription('Add a team to the open registry (Commissioner only)')
    .addStringOption(o => o.setName('base-team').setDescription('Original Madden slot name, e.g. Chargers').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('display-team').setDescription('What to show on the board, e.g. Sacramento Kings').setRequired(true))
    .addStringOption(o => o.setName('replaces-team').setDescription('Optional: what slot this custom/imported team replaces').setAutocomplete(true))
    .addStringOption(o => o.setName('logo-url').setDescription('Discord CDN image URL for the team logo (optional)'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('remove-open-team').setDescription('Remove a team from the open registry (Commissioner only)')
    .addStringOption(o => o.setName('team').setDescription('Team name (base or display) to remove').setRequired(true).setAutocomplete(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('set-team-logo').setDescription('Set or update a team logo URL (Commissioner only)')
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('logo-url').setDescription('Discord CDN image URL').setRequired(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('refresh-open-teams').setDescription('Force-refresh the open teams board (Commissioner only)')
    .setDefaultMemberPermissions(P),
  
new SlashCommandBuilder()
  .setName('join-league').setDescription('Join an active league through the guided join flow')
  .addStringOption(o => o.setName('league').setDescription('Optional: choose a specific active league').setAutocomplete(true)),
new SlashCommandBuilder()
  .setName('select-team').setDescription('Claim an open team as your own')
    .addStringOption(o => o.setName('team').setDescription('Team name you want to claim').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('timezone').setDescription('Your timezone, e.g. America/Los_Angeles or EST').setRequired(true)),
  new SlashCommandBuilder()
    .setName('release-team').setDescription('Release a team back to open status (Commissioner only)')
    .addStringOption(o => o.setName('team').setDescription('Team name to release').setRequired(true).setAutocomplete(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('open-teams').setDescription('Show the current open teams board'),

  // ── Rules ──
  new SlashCommandBuilder()
    .setName('set-rules').setDescription('Overwrite the league rules and republish (Commissioner only)')
    .addStringOption(o => o.setName('text').setDescription('Full rules text to replace existing rules').setRequired(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('append-rule').setDescription('Append a line or section to the rules (Commissioner only)')
    .addStringOption(o => o.setName('text').setDescription('Rule text to append').setRequired(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('update-rule')
    .setDescription('Update or replace a specific rule in the league (Commissioner only)')
    .addStringOption(o => o.setName('section')
      .setDescription('Rule section (e.g., "Gameplay", "Awards", "Streaming")')
      .setRequired(true))
    .addStringOption(o => o.setName('old-text')
      .setDescription('The rule text to find and replace (partial match OK)')
      .setRequired(true))
    .addStringOption(o => o.setName('new-text')
      .setDescription('The new rule text to replace it with')
      .setRequired(true))
    .addBooleanOption(o => o.setName('append-instead')
      .setDescription('Append instead of replace? (default: false)'))
    .setDefaultMemberPermissions(P),

  // ── Games ──
  new SlashCommandBuilder()
    .setName('create-game').setDescription('Open a private game channel for a matchup (Commissioner only)')
    .addIntegerOption(o => o.setName('week').setDescription('Week number 1-18').setRequired(true))
    .addStringOption(o => o.setName('team1').setDescription('Home team').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('team2').setDescription('Away team').setRequired(true).setAutocomplete(true))
    .addUserOption(o => o.setName('user1').setDescription('Optional: override user for team 1'))
    .addUserOption(o => o.setName('user2').setDescription('Optional: override user for team 2'))
    .addBooleanOption(o => o.setName('primetime').setDescription('Mark as Primetime / GOTW / Overseas?'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('respond').setDescription('Confirm you have reached out to schedule your game'),
  new SlashCommandBuilder()
    .setName('report-result').setDescription('Post the final score for a completed game')
    .addStringOption(o => o.setName('winner').setDescription('Winning team').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('winner-score').setDescription('Winner points scored').setRequired(true))
    .addStringOption(o => o.setName('loser').setDescription('Losing team').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('loser-score').setDescription('Loser points scored').setRequired(true)),

  // ── Stats / Awards ──
  new SlashCommandBuilder()
    .setName('set-stat-leaders').setDescription("Post this week's stat leaders to #stat-leaders (Commissioner only)")
    .addIntegerOption(o => o.setName('week').setDescription('Week number').setRequired(true))
    .addStringOption(o => o.setName('passing').setDescription('e.g. Mahomes - Chiefs - 342 yds 3 TD').setRequired(true))
    .addStringOption(o => o.setName('rushing').setDescription('e.g. Henry - Ravens - 178 yds 2 TD').setRequired(true))
    .addStringOption(o => o.setName('receiving').setDescription('e.g. Hill - Dolphins - 11 rec 156 yds').setRequired(true))
    .addStringOption(o => o.setName('defense').setDescription('e.g. Parsons - Cowboys - 3 sacks 2 TFL').setRequired(true))
    .addStringOption(o => o.setName('special').setDescription('Any other standout stat line (optional)'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('rewards-board').setDescription('Show the full rewards board for the current season'),
  new SlashCommandBuilder()
    .setName('refresh-rewards').setDescription('Force-refresh all pinned rewards boards (Commissioner only)')
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('player-of-the-week').setDescription('Award a Player of the Week (Commissioner only)')
    .addStringOption(o => o.setName('conference').setDescription('Award category').setRequired(true)
      .addChoices(
        { name: 'AFC Offensive POTW', value: 'AFC_OFF' },
        { name: 'AFC Defensive POTW', value: 'AFC_DEF' },
        { name: 'NFC Offensive POTW', value: 'NFC_OFF' },
        { name: 'NFC Defensive POTW', value: 'NFC_DEF' },
      ))
    .addStringOption(o => o.setName('player').setDescription('Player name, e.g. Lamar Jackson').setRequired(true))
    .addStringOption(o => o.setName('team').setDescription("Player's team").setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('stat-line').setDescription('Key stat line, e.g. 342 yds 3 TD'))
    .addStringOption(o => o.setName('reason').setDescription('Why they won (optional)'))
    .addUserOption(o => o.setName('user').setDescription('Tag the team owner (optional)'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('potw-confirm').setDescription('Confirm or override the AI Best-in-League POTW pick (Commissioner only)')
    .addStringOption(o => o.setName('action').setDescription('Confirm or override the AI pick').setRequired(true)
      .addChoices(
        { name: 'Confirm AI pick',       value: 'confirm'  },
        { name: 'Override with custom',  value: 'override' },
      ))
    .addStringOption(o => o.setName('player').setDescription('Player name (if overriding)'))
    .addStringOption(o => o.setName('team').setDescription('Team name (if overriding)').setAutocomplete(true))
    .addStringOption(o => o.setName('stat-line').setDescription('Key stat line (if overriding)'))
    .addStringOption(o => o.setName('reason').setDescription('Reason (if overriding)'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('attr-award').setDescription('Award attributes to player(s) - Commissioner enters player name(s) (Commissioner only)')
    .addStringOption(o => o.setName('players').setDescription('Player name(s) to award (e.g., "Patrick Mahomes" or "Mahomes, Travis Kelce")').setRequired(true))
    .addStringOption(o => o.setName('attr1-category').setDescription('First attribute category').setRequired(true)
      .addChoices(
        { name: '⚙️ Throwing', value: 'throwing' },
        { name: '🏃 Physical', value: 'physical' },
        { name: '🧠 Mental', value: 'mental' },
        { name: '❤️ Character', value: 'character' },
        { name: '🎯 Coverage', value: 'coverage' },
        { name: '🎯 Defense', value: 'defense' },
        { name: '🏋️ Strength & Power', value: 'power' }
      ))
    .addStringOption(o => o.setName('attribute1').setDescription('3-letter code (SAC, THR, etc) or skip for auto').setAutocomplete(true))
    .addStringOption(o => o.setName('attr2-category').setDescription('Second attribute category (optional)')
      .addChoices(
        { name: '⚙️ Throwing', value: 'throwing' },
        { name: '🏃 Physical', value: 'physical' },
        { name: '🧠 Mental', value: 'mental' },
        { name: '❤️ Character', value: 'character' },
        { name: '🎯 Coverage', value: 'coverage' },
        { name: '🎯 Defense', value: 'defense' },
        { name: '🏋️ Strength & Power', value: 'power' }
      ))
    .addStringOption(o => o.setName('attribute2').setDescription('3-letter code for second attr (optional)').setAutocomplete(true))
    .addStringOption(o => o.setName('reason').setDescription('Why they deserve these boosts (optional)'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('yearly-award').setDescription('Give a yearly end-of-season award (Commissioner only)')
    .addStringOption(o => o.setName('award').setDescription('Award type').setRequired(true)
      .addChoices(
        { name: 'League MVP',              value: 'MVP'   },
        { name: 'Offensive Player of Year',value: 'OPOY'  },
        { name: 'Defensive Player of Year',value: 'DPOY'  },
        { name: 'Most Improved Player',    value: 'MIP'   },
        { name: 'Breakout Player of Year', value: 'BPY'   },
        { name: 'League Champion',         value: 'CHAMP' },
        { name: 'Other Award',             value: 'OTHER' },
      ))
    .addStringOption(o => o.setName('team').setDescription('Winning team').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('player').setDescription('Player receiving the award').setRequired(true))
    .addBooleanOption(o => o.setName('is-xfactor').setDescription('Is this player already an X-Factor? Gives Age Reset instead of Dev Upgrade'))
    .addUserOption(o => o.setName('user').setDescription('Tag the team owner (optional)'))
    .addStringOption(o => o.setName('details').setDescription('Extra details about the award (optional)'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('superbowl-champion').setDescription('Crown the Super Bowl champion - grants 1 AR + 1 XF automatically (Commissioner only)')
    .addStringOption(o => o.setName('team').setDescription('Winning team').setRequired(true).setAutocomplete(true))
    .addUserOption(o => o.setName('user').setDescription('Tag the owner (optional)'))
    .addStringOption(o => o.setName('score').setDescription('Final score, e.g. 31-17'))
    .addIntegerOption(o => o.setName('season').setDescription('Season number (defaults to next in sequence)'))
    .setDefaultMemberPermissions(P),

  // ── Hub / Schedule ──
  new SlashCommandBuilder()
    .setName('set-hub-week').setDescription('Set the current hub week number and start the release timer (Commissioner only)')
    .addIntegerOption(o => o.setName('week').setDescription('Week number to set').setRequired(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('release-week').setDescription("Manually release this week's scores, stats, and standings now (Commissioner only)")
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('hub-status').setDescription('Show everything staged in the commish hub this week (Commissioner only)')
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('clear-hub').setDescription('Clear all staged hub data for the current week (Commissioner only)')
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('cancel-potw-timer').setDescription('Cancel the pending auto-POTW timer (Commissioner only)')
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('cancel-release-timer').setDescription('Cancel the pending 6:59pm auto-release timer (Commissioner only)')
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('advance-week').setDescription('Post the weekly schedule - auto-reposts every 48hrs at 7pm PST (Commissioner only)')
    .addIntegerOption(o => o.setName('week').setDescription('Week number 1-18').setRequired(true))
    .addStringOption(o => o.setName('matchups').setDescription('One per line: Team1 vs Team2 - tags: [P]=Primetime [G]=GOTW [O]=Overseas').setRequired(true))
    .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('repost-schedule').setDescription('Force repost the current schedule to #weekly-schedule now (Commissioner only)')
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('schedule-import').setDescription('Import schedule data from JSON or CSV (Commissioner only)')
  .addAttachmentOption(o => o.setName('file').setDescription('JSON or CSV schedule export').setRequired(true))
  .addStringOption(o => o.setName('source').setDescription('Optional source label, e.g. mybot-export'))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('schedule-load-week').setDescription('Load a stored week into the live schedule and post it (Commissioner only)')
  .addIntegerOption(o => o.setName('week').setDescription('Stored week number to load').setRequired(true))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('schedule-registry-status').setDescription('Show stored schedule registry status (Commissioner only)')
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('league-data-ingest').setDescription('Import league data from files the bot can read (Commissioner only)')
  .addAttachmentOption(o => o.setName('file').setDescription('CSV JSON TXT DOCX XLSX or image file').setRequired(true))
  .addStringOption(o => o.setName('target').setDescription('Where to route the imported data').setRequired(false)
    .addChoices(
      { name: 'Auto-detect', value: 'auto' },
      { name: 'Schedule', value: 'schedule' },
      { name: 'Standings', value: 'standings' },
      { name: 'Stats', value: 'stats' },
      { name: 'Records', value: 'records' },
      { name: 'Notes', value: 'notes' }
    ))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('set-league-source-mode').setDescription('Choose whether this league is bot-managed or externally synced (Commissioner only)')
  .addStringOption(o => o.setName('mode').setDescription('Custom bot-managed or external sync').setRequired(true)
    .addChoices(
      { name: 'Custom Bot-Managed', value: 'custom_bot_managed' },
      { name: 'External Sync', value: 'external_sync' },
    ))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('set-live-sync').setDescription('Configure live sync provider settings for Madden, 2K, or a custom endpoint (Commissioner only)')
  .addStringOption(o => o.setName('provider').setDescription('Sync provider').setRequired(true)
    .addChoices(
      { name: 'Off', value: 'off' },
      { name: 'Madden Companion', value: 'madden_companion' },
      { name: 'NBA 2K Companion', value: 'nba2k_companion' },
      { name: 'Custom Endpoint', value: 'custom_endpoint' },
    ))
  .addStringOption(o => o.setName('endpoint-url').setDescription('Optional JSON endpoint override URL'))
  .addBooleanOption(o => o.setName('auto-sync-on-trigger').setDescription('Automatically sync when running sync-aware triggers'))
  .addBooleanOption(o => o.setName('load-current-week').setDescription('Load current synced week into the live schedule after sync'))
  .addBooleanOption(o => o.setName('run-weekly-automation').setDescription('Run weekly channel automation after a successful sync'))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('live-sync-status').setDescription('Show live sync mode/provider status (Commissioner only)')
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('live-sync-now').setDescription('Run a live sync now and optionally load the current synced week (Commissioner only)')
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('post-standings').setDescription('Manually post standings to #announcements (Commissioner only)')
    .addStringOption(o => o.setName('standings').setDescription('Paste standings text, one team per line: 1. Ravens 8-2').setRequired(true))
    .setDefaultMemberPermissions(P),

  // ── Trades ──
  new SlashCommandBuilder()
    .setName('propose-trade').setDescription('Submit a trade proposal for commissioner review')
    .addStringOption(o => o.setName('your-team').setDescription('Your team').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('target-team').setDescription('Their team').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('details').setDescription('What you give and what you get').setRequired(true)),
  new SlashCommandBuilder()
    .setName('transaction').setDescription('Announce a roster move (Commissioner only)')
    .addStringOption(o => o.setName('type').setDescription('Type of transaction').setRequired(true)
      .addChoices(
        { name: 'Trade',              value: 'trade'       },
        { name: 'Free Agent Signing', value: 'fa_sign'     },
        { name: 'Player Released',    value: 'release'     },
        { name: 'Draft Pick',         value: 'draft'       },
        { name: 'Waiver Claim',       value: 'waiver'      },
        { name: 'Position Change',    value: 'pos_change'  },
        { name: 'Dev Upgrade',        value: 'dev_upgrade' },
        { name: 'Injury Update',      value: 'injury'      },
      ))
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('player').setDescription('Player name').setRequired(true))
    .addStringOption(o => o.setName('details').setDescription('Extra details (optional)'))
    .setDefaultMemberPermissions(P),

  // ── Streams ──
  new SlashCommandBuilder()
    .setName('stream-board').setDescription('Show the stream leaderboard for the whole league'),
  new SlashCommandBuilder()
    .setName('my-streams').setDescription('Show your own stream count and progress toward rewards'),
  new SlashCommandBuilder()
    .setName('restore-stream').setDescription('Restore a stream credit that was lost (Commissioner only)')
    .addStringOption(o => o.setName('team').setDescription('Team to restore the credit for').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('url').setDescription('Stream URL (optional)'))
    .setDefaultMemberPermissions(P),

  // ── Attribute boost ──
  new SlashCommandBuilder()
    .setName('claim-attr-boost').setDescription('Submit an attribute boost request for commissioner approval')
    .addStringOption(o => o.setName('team').setDescription('Your team').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('player').setDescription('Player name to receive the boost').setRequired(true))
    .addStringOption(o => o.setName('source').setDescription('What earned this boost').setRequired(true)
      .addChoices(
        { name: 'Stream Reward',       value: 'stream'    },
        { name: 'Player of the Week',  value: 'potw'      },
        { name: 'Super Bowl Champion', value: 'superbowl' },
        { name: 'Yearly Award',        value: 'yearly'    },
      ))
    .addStringOption(o => o.setName('attr1-category').setDescription('Attribute category for boost 1').setRequired(true)
      .addChoices(
        { name: 'Throw Accuracy (SAC/MAC/DAC/TOR/TUP)', value: 'throw_acc'   },
        { name: 'Throw Power - auto (THP)',              value: 'throw_pow'   },
        { name: 'Play Action - auto (PAC)',              value: 'play_action' },
        { name: 'Awareness / IQ (AWR/PRC/PUR)',          value: 'awareness'   },
        { name: 'Route Running (SRR/MRR/DRR/REL)',       value: 'route'       },
        { name: 'Catching (CTH/CIT/SPC)',                value: 'catching'    },
        { name: 'Ball Carrier (TRK/BTK/STA/SPM/JKM)',   value: 'ballcarrier' },
        { name: 'Blocking (RBK/PBK/IBK/RBP/PBP)',       value: 'blocking'    },
        { name: 'Pass Rush / DL (BSH/PWM/FNM/HTP)',     value: 'passrush'    },
        { name: 'Coverage (MCV/ZCV/PRS/CIT/PRC)',        value: 'coverage'    },
        { name: 'Hit Power - auto (HTP)',                value: 'hit_power'   },
        { name: 'Tackle - auto (TAK)',                   value: 'tackle'      },
        { name: 'Kicking (KPW/KAC)',                     value: 'kicking'     },
      ))
    .addStringOption(o => o.setName('attribute1').setDescription('Type the 3-letter code e.g. SAC - skip for auto categories').setAutocomplete(true))
    .addStringOption(o => o.setName('attr2-category').setDescription('Attribute category for optional second boost')
      .addChoices(
        { name: 'Throw Accuracy (SAC/MAC/DAC/TOR/TUP)', value: 'throw_acc'   },
        { name: 'Throw Power - auto (THP)',              value: 'throw_pow'   },
        { name: 'Play Action - auto (PAC)',              value: 'play_action' },
        { name: 'Awareness / IQ (AWR/PRC/PUR)',          value: 'awareness'   },
        { name: 'Route Running (SRR/MRR/DRR/REL)',       value: 'route'       },
        { name: 'Catching (CTH/CIT/SPC)',                value: 'catching'    },
        { name: 'Ball Carrier (TRK/BTK/STA/SPM/JKM)',   value: 'ballcarrier' },
        { name: 'Blocking (RBK/PBK/IBK/RBP/PBP)',       value: 'blocking'    },
        { name: 'Pass Rush / DL (BSH/PWM/FNM/HTP)',     value: 'passrush'    },
        { name: 'Coverage (MCV/ZCV/PRS/CIT/PRC)',        value: 'coverage'    },
        { name: 'Hit Power - auto (HTP)',                value: 'hit_power'   },
        { name: 'Tackle - auto (TAK)',                   value: 'tackle'      },
        { name: 'Kicking (KPW/KAC)',                     value: 'kicking'     },
      ))
    .addStringOption(o => o.setName('attribute2').setDescription('Type the 3-letter code for the second boost (optional)').setAutocomplete(true)),

  // ── Discipline ──
  new SlashCommandBuilder()
    .setName('warn-player').setDescription('Issue a warning to a player (Commissioner only)')
    .addUserOption(o => o.setName('user').setDescription('Player to warn').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Warning type').setRequired(true)
      .addChoices(
        { name: 'Gameplay Violation', value: 'gameplay'   },
        { name: 'Close App / Quit',   value: 'closeapp'   },
        { name: 'Inactivity',         value: 'inactivity' },
      ))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the warning'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('clear-strikes').setDescription('Clear spam strikes for a user (Commissioner only)')
    .addUserOption(o => o.setName('user').setDescription('User to clear strikes for').setRequired(true))
    .setDefaultMemberPermissions(P),

  // ── Misc ──
  new SlashCommandBuilder()
    .setName('retract-score').setDescription('Remove a wrong or duplicate score entry (Commissioner only)')
    .addIntegerOption(o => o.setName('week').setDescription('Week number of the game').setRequired(true))
    .addStringOption(o => o.setName('team1').setDescription('One of the teams in the matchup').setRequired(true))
    .addStringOption(o => o.setName('team2').setDescription('The other team in the matchup').setRequired(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('send-welcome').setDescription('Send the welcome DM to a user manually (Commissioner only)')
    .addUserOption(o => o.setName('user').setDescription('User to welcome').setRequired(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('post-nfl-news').setDescription('Fetch and post latest NFL news to #nfl-updates (Commissioner only)')
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('edit-message').setDescription('Edit any bot message by ID - searches all channels (Commissioner only)')
    .addStringOption(o => o.setName('message-id').setDescription('Right-click the bot message and Copy Message ID').setRequired(true))
    .addStringOption(o => o.setName('text').setDescription('New text for the embed description or message content').setRequired(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('setup-league').setDescription('Build the full league channel structure - run once on a fresh server (Commissioner only)')
    .addStringOption(o => o.setName('league-name').setDescription('Custom name for your league (e.g. "NOFUNLEAGUE S3")').setRequired(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
  .setName('delete-league')
  .setDescription('Delete an active league completely without rebuilding it (Commissioner only)')
  .addStringOption(o => o.setName('league').setDescription('Choose the active league to delete').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('confirm').setDescription('Type DELETE to confirm - this cannot be undone').setRequired(true))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('reset-league')
  .setDescription('Reset an active league and rebuild it (Commissioner only)')
  .addStringOption(o => o.setName('league').setDescription('Choose the active league to reset').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('confirm').setDescription('Type RESET to confirm - this cannot be undone').setRequired(true))
  .addStringOption(o => o.setName('new-league-type').setDescription('Optional: change the target league to a different template')
    .addChoices(
      { name: '🏈 Madden Franchise (Standard)', value: 'madden_franchise' },
      { name: '🎯 Madden Fantasy Draft', value: 'madden_fantasy' },
      { name: '👑 Madden All-Time Greats', value: 'madden_alltime' },
      { name: '🎲 NFL Sim League (No Cheese)', value: 'madden_sim' },
      { name: '🔥 Dual Division AFC+NFC (Custom)', value: 'madden_dual' },
      { name: '🏀 NBA 2K MyNBA Franchise', value: 'nba2k_franchise' },
      { name: '🏀 NBA 2K Fantasy Draft', value: 'nba2k_fantasy' },
      { name: '🐐 NBA 2K All-Time Legends', value: 'nba2k_alltime' },
      { name: '🎮 NBA 2K Pro-Am 8-Team (Custom)', value: 'nba2k_proam_8' },
      { name: '🏆 NBA 2K Pro-Am 10-Team (Custom)', value: 'nba2k_proam_10' },
      { name: '🏟 NCAA CFB Dynasty', value: 'ncaa_dynasty' },
      { name: '🎓 NCAA CFB Fantasy Draft', value: 'ncaa_fantasy' },
    ))
  .addStringOption(o => o.setName('league-name').setDescription('Optional: new league name after reset'))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('setup-wizard-start').setDescription('Open the private setup wizard lane and refresh the bot setup UI (Commissioner only)')
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('initialize-server').setDescription('Reset to installation mode and reopen the setup wizard (Commissioner only)')
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('customize-server-rules').setDescription('Open the optional base server rules customizer (Commissioner only)')
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('create-poll').setDescription('Post a vote-only picklist poll in #polls (Commissioner only)')
  .addStringOption(o => o.setName('question').setDescription('Poll question').setRequired(true))
  .addStringOption(o => o.setName('options').setDescription('Comma-separated options, 2 to 5').setRequired(true))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('set-bot-identity').setDescription('Set the bot display name and avatar (Commissioner only)')
  .addStringOption(o => o.setName('name').setDescription('Display name for the bot').setRequired(false))
  .addStringOption(o => o.setName('avatar-url').setDescription('Public image URL for the bot avatar').setRequired(false))
  .addAttachmentOption(o => o.setName('avatar-image').setDescription('Upload an image to use as the bot avatar').setRequired(false))
  .addBooleanOption(o => o.setName('use-server-image').setDescription('Use the current server image/header as the bot avatar').setRequired(false))
  .addStringOption(o => o.setName('imported-emoji').setDescription('Use an imported server emoji as the bot avatar').setRequired(false).setAutocomplete(true))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('fix-duplicates').setDescription('Scan for and remove duplicate categories, merging their channels into one (Commissioner only)')
  .addBooleanOption(o => o.setName('dry-run').setDescription('Preview what would be merged/deleted without making changes (default: true)').setRequired(false))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('active-check-status').setDescription('Show active check status and consecutive miss counts for a league (Commissioner only)')
  .addStringOption(o => o.setName('league-id').setDescription('League ID to check (leave blank for all)').setRequired(false))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('diagnose').setDescription('Run a full bot self-diagnostic and report all issues (Commissioner/IT only)')
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('toggle-feature').setDescription('Enable or disable an optional bot feature (Commissioner only)')
  .addStringOption(o => o.setName('feature').setDescription('Feature to toggle').setRequired(true)
    .addChoices(
      { name: 'Active Check', value: 'active-check' },
      { name: 'Polls & Voting', value: 'polls' },
      { name: 'MVP Voting', value: 'mvp-voting' },
      { name: 'Availability Tracker', value: 'availability' },
      { name: 'Rule Acknowledgment', value: 'rule-ack' },
      { name: 'Trade Block', value: 'trade-block' },
      { name: 'Game Result Submission', value: 'game-results' },
      { name: 'Weekly Predictions', value: 'predictions' },
      { name: 'Reward Boards', value: 'rewards' },
      { name: 'Stream Credits', value: 'streams' },
      { name: 'Weekly Schedule', value: 'schedule' },
      { name: 'Transaction Log', value: 'transactions' },
    ))
  .addBooleanOption(o => o.setName('enabled').setDescription('True to enable, false to disable').setRequired(true))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('list-features').setDescription('Show all optional bot features and their status (Commissioner only)')
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('post-component').setDescription('Post or refresh an interactive component panel in its channel (Commissioner only)')
  .addStringOption(o => o.setName('component').setDescription('Component to post').setRequired(true)
    .addChoices(
      { name: 'MVP Voting', value: 'mvp-voting' },
      { name: 'Availability Tracker', value: 'availability' },
      { name: 'Rule Acknowledgment', value: 'rule-ack' },
      { name: 'Trade Block', value: 'trade-block' },
      { name: 'Game Result Submission', value: 'game-results' },
      { name: 'Weekly Predictions', value: 'predictions' },
    ))
  .addIntegerOption(o => o.setName('week').setDescription('Week number (for weekly components)').setRequired(false))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('trash-the-bot').setDescription('Wipe bot data/channels back to installation mode (Commissioner only)')
  .addStringOption(o => o.setName('confirm').setDescription('Type TRASH to confirm the full reboot').setRequired(true))
  .setDefaultMemberPermissions(P),
new SlashCommandBuilder()
  .setName('set-bot-tone').setDescription('Set audience and member/commissioner tone builds')
  .addStringOption(o => o.setName('audience').setDescription('g, pg, pg13, or r').setRequired(false).addChoices({name:'G', value:'g'},{name:'PG', value:'pg'},{name:'PG-13', value:'pg13'},{name:'R', value:'r'}))
  .addBooleanOption(o => o.setName('use-same-tone').setDescription('Use the same tone build for both AI lanes').setRequired(false))
  .addBooleanOption(o => o.setName('allow-gifs').setDescription('Allow AI replies to include reaction GIFs when fitting').setRequired(false))
  .addStringOption(o => o.setName('filter-mode').setDescription('How wild the bot can sound inside allowed safety rails').setRequired(false).addChoices({name:'Strict', value:'strict'},{name:'Relaxed', value:'relaxed'},{name:'Unfiltered Style', value:'unfiltered_style'}))
  .addStringOption(o => o.setName('tone-visibility').setDescription('Who can see or feel the tone selection policy').setRequired(false).addChoices({name:'Public', value:'public'},{name:'Commissioners', value:'commissioners'},{name:'Channel Based', value:'channel_based'}))
  .addStringOption(o => o.setName('tones').setDescription('Shared tones, comma-separated, up to 7').setRequired(false))
  .addStringOption(o => o.setName('member-tones').setDescription('Member tones, comma-separated, up to 7').setRequired(false))
  .addStringOption(o => o.setName('commissioner-tones').setDescription('Commissioner tones, comma-separated, up to 7').setRequired(false))
  .setDefaultMemberPermissions(P),

new SlashCommandBuilder()
  .setName('manual').setDescription('Open the role-aware myBot manual and PDF')
  .addStringOption(o => o.setName('section').setDescription('Open a specific manual section')
    .addChoices(
      { name: 'Overview', value: 'overview' },
      { name: 'Server', value: 'server' },
      { name: 'League', value: 'league' },
      { name: 'Setup', value: 'setup' },
      { name: 'Commands', value: 'commands' },
      { name: 'Actions', value: 'actions' },
    )),
new SlashCommandBuilder()
  .setName('set-timezone').setDescription('Update your scheduling timezone for your claimed team(s)')
  .addStringOption(o => o.setName('timezone').setDescription('Pick your timezone').setRequired(true)
    .addChoices(
      { name: 'Pacific Time (PST/PDT)', value: 'America/Los_Angeles' },
      { name: 'Mountain Time (MST/MDT)', value: 'America/Denver' },
      { name: 'Central Time (CST/CDT)', value: 'America/Chicago' },
      { name: 'Eastern Time (EST/EDT)', value: 'America/New_York' },
    )),
new SlashCommandBuilder()
  .setName('team-registry-status').setDescription('Show the synced team ownership registry status (Commissioner only)')
  .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('audit-wiring').setDescription('Check all channels services and timers are healthy (Commissioner only)')
    .setDefaultMemberPermissions(P),

  // ── Member management ──
  new SlashCommandBuilder()
    .setName('add-member-to-league').setDescription('Add a member to a league and grant channel access (Commissioner only)')
    .addUserOption(o => o.setName('user').setDescription('Member to add').setRequired(true))
    .addStringOption(o => o.setName('team').setDescription('Team to assign them (optional — assigns team + access)').setAutocomplete(true))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('audit-emojis').setDescription('Show all mapped and unmapped custom emojis in this server')
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('sync-emojis').setDescription('Upload missing team emojis to this server from the bot emoji packs (Commissioner only)')
    .addStringOption(o => o.setName('league').setDescription('Which emoji pack to sync').setRequired(true)
      .addChoices(
        { name: '🏈 NFL Teams (32 emojis)', value: 'nfl' },
        { name: '🏀 NBA Teams (31 emojis)', value: 'nba' },
        { name: '🏈🏀 All Teams (63 emojis)', value: 'all' },
      ))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('member-record').setDescription('Member ledger and inactivity tools (Commissioner only)')
    .addSubcommand(sc => sc.setName('history').setDescription('View the full ledger for a member')
      .addUserOption(o => o.setName('user').setDescription('Member to look up').setRequired(true)))
    .addSubcommand(sc => sc.setName('add-note').setDescription('Add a commissioner note to a member record')
      .addUserOption(o => o.setName('user').setDescription('Member to add note for').setRequired(true))
      .addStringOption(o => o.setName('note').setDescription('Note text').setRequired(true)))
    .addSubcommand(sc => sc.setName('inactive').setDescription('Show inactive members over a threshold')
      .addIntegerOption(o => o.setName('days').setDescription('Days threshold (default: 4)')))
    .setDefaultMemberPermissions(P),

  // ── Ban management ──
  new SlashCommandBuilder()
    .setName('ban').setDescription('Ban ledger and Discord ban management (Commissioner only)')
    .addSubcommand(sc => sc.setName('list').setDescription('Show all banned users tracked by the bot'))
    .addSubcommand(sc => sc.setName('add').setDescription('Ban a user from the server and add to the bot ban list')
      .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for the ban')))
    .addSubcommand(sc => sc.setName('remove').setDescription('Remove a user from the bot ban list and Discord ban')
      .addStringOption(o => o.setName('user-id').setDescription('User ID to unban (right-click → Copy ID)').setRequired(true)))
    .setDefaultMemberPermissions(P),

  // ── Season management ──
  new SlashCommandBuilder()
    .setName('start-season').setDescription('Check if the league has enough members (15 min) to begin the season (Commissioner only)')
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('fill-cpu').setDescription('Fill all remaining open team slots with CPU teams (Commissioner only)')
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('release-cpu').setDescription('Release all CPU-filled teams back to open status (Commissioner only)')
    .setDefaultMemberPermissions(P),


  // ── third-party league ops aliases ──
  new SlashCommandBuilder()
    .setName('dashboard').setDescription('Show league sync export team and channel status (Commissioner only)')
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('league-export').setDescription('Export current or stored league schedule data (Commissioner only)')
    .addSubcommand(sc => sc.setName('current').setDescription('Export the current week schedule'))
    .addSubcommand(sc => sc.setName('week').setDescription('Export one stored week').addIntegerOption(o => o.setName('week').setDescription('Week number to export').setRequired(true)))
    .addSubcommand(sc => sc.setName('all-weeks').setDescription('Export all stored weeks'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('game-channels').setDescription('Configure or manage weekly game channels (Commissioner only)')
    .addSubcommand(sc => sc.setName('configure').setDescription('Save channel automation settings')
      .addChannelOption(o => o.setName('scoreboard-channel').setDescription('Channel for scoreboard / announcements'))
      .addRoleOption(o => o.setName('admin-role').setDescription('Admin role for game channel ops'))
      .addRoleOption(o => o.setName('wait-role').setDescription('Optional role to ping on reminders')))
    .addSubcommand(sc => sc.setName('create').setDescription('Create weekly game channels from current schedule'))
    .addSubcommand(sc => sc.setName('clear').setDescription('Clear current weekly game channels'))
    .addSubcommand(sc => sc.setName('rebuild').setDescription('Clear and rebuild current weekly game channels from schedule'))
    .addSubcommand(sc => sc.setName('notify').setDescription('Notify all active weekly game channels')
      .addStringOption(o => o.setName('message').setDescription('Optional reminder message')))
    .addSubcommand(sc => sc.setName('automation').setDescription('Set weekly automation mode and timing')
      .addStringOption(o => o.setName('mode').setDescription('Manual or automatic weekly channel handling').setRequired(true)
        .addChoices(
          { name: 'Manual', value: 'manual' },
          { name: 'Automatic', value: 'automatic' },
        ))
      .addIntegerOption(o => o.setName('advance-hours').setDescription('Hours between weekly schedule cycles (default 48)'))
      .addBooleanOption(o => o.setName('auto-create-game-channels').setDescription('Automatically build game channels on week advance'))
      .addBooleanOption(o => o.setName('clear-previous-week-channels').setDescription('Delete old week game channels before building the new week')))
    .addSubcommand(sc => sc.setName('status').setDescription('Show current weekly automation settings'))
    // V202: advance/sync controls live under this existing group (no new top-level command). Interface only —
    // the advance engine, sync and provider logic are separate services.
    .addSubcommand(sc => sc.setName('update').setDescription('Re-resolve team owners for a game channel and grant them access')
      .addChannelOption(o => o.setName('channel').setDescription('Game channel (defaults to this channel)')))
    .addSubcommand(sc => sc.setName('delete').setDescription('Delete one weekly game channel')
      .addChannelOption(o => o.setName('channel').setDescription('Weekly game channel to delete').setRequired(true)))
    .addSubcommand(sc => sc.setName('advance-status').setDescription('Show league advance state, source vs workflow week, deadline and provider'))
    .addSubcommand(sc => sc.setName('advance-settings').setDescription('View or change league advance automation settings')
      .addBooleanOption(o => o.setName('enabled').setDescription('Run the advance procedure automatically at each deadline'))
      .addIntegerOption(o => o.setName('interval-hours').setDescription('Hours per week cycle (default 48)').setMinValue(1).setMaxValue(336))
      .addBooleanOption(o => o.setName('shadow-mode').setDescription('Record decisions only — no advance or publish (default on)'))
      .addBooleanOption(o => o.setName('block-on-active-game').setDescription('Hold the advance while a game is being played'))
      .addBooleanOption(o => o.setName('require-all-results').setDescription('Hold until every matchup has a recorded result'))
      .addStringOption(o => o.setName('timezone').setDescription('IANA timezone for the league deadline, e.g. America/Los_Angeles')))
    .addSubcommand(sc => sc.setName('advance-now').setDescription('Start the verified advance procedure now (never fakes a Madden advance)')
      .addBooleanOption(o => o.setName('dry-run').setDescription('Only report what would happen'))
      .addIntegerOption(o => o.setName('source-week').setDescription('Manual provider only: confirm Madden is now on this week').setMinValue(1).setMaxValue(30)))
    .addSubcommand(sc => sc.setName('advance-hold').setDescription('Put the league advance on hold')
      .addStringOption(o => o.setName('reason').setDescription('Why the advance is held').setMaxLength(300)))
    .addSubcommand(sc => sc.setName('advance-resume').setDescription('Resume the league advance after a hold or recovery'))
    .addSubcommand(sc => sc.setName('sync-status').setDescription('Show data provider health and recent imports'))
    .addSubcommand(sc => sc.setName('sync-now').setDescription('Refresh league data from the configured provider (does not advance the week)'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('teams').setDescription('Configure assign free and open team slots (Commissioner only)')
    .addSubcommand(sc => sc.setName('configure').setDescription('Save team role tracking preference')
      .addBooleanOption(o => o.setName('use-team-roles').setDescription('Track team roles for owners')))
    .addSubcommand(sc => sc.setName('assign').setDescription('Assign a team to a member')
      .addStringOption(o => o.setName('team').setDescription('Team slot to assign').setRequired(true).setAutocomplete(true))
      .addUserOption(o => o.setName('user').setDescription('Member to assign').setRequired(true)))
    .addSubcommand(sc => sc.setName('free').setDescription('Release a claimed team back open')
      .addStringOption(o => o.setName('team').setDescription('Team slot to free').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sc => sc.setName('open').setDescription('Show the current open teams board'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('waitlist').setDescription('Manage the league waitlist')
    .addSubcommand(sc => sc.setName('list').setDescription('Show the waitlist order'))
    .addSubcommand(sc => sc.setName('add').setDescription('Add a user to the waitlist')
      .addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true))
      .addIntegerOption(o => o.setName('position').setDescription('Optional waitlist position'))
      .addStringOption(o => o.setName('note').setDescription('Optional note')))
    .addSubcommand(sc => sc.setName('remove').setDescription('Remove a user from the waitlist')
      .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true)))
    .addSubcommand(sc => sc.setName('pop').setDescription('Pop the top waitlist user'))
    .addSubcommand(sc => sc.setName('notify').setDescription('Notify the top waitlist users')
      .addIntegerOption(o => o.setName('count').setDescription('How many to notify'))
      .addStringOption(o => o.setName('message').setDescription('Message to send'))),
  new SlashCommandBuilder()
    .setName('streams').setDescription('Configure or manage stream counting (Commissioner only)')
    .addSubcommand(sc => sc.setName('configure').setDescription('Set the stream counting channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel used for stream submissions'))
      .addRoleOption(o => o.setName('ping-role').setDescription('Optional ping role')))
    .addSubcommand(sc => sc.setName('count').setDescription('Add a stream count to a team or owner')
      .addStringOption(o => o.setName('team-or-user').setDescription('Base team display team or user id').setRequired(true))
      .addStringOption(o => o.setName('url').setDescription('Optional stream URL')))
    .addSubcommand(sc => sc.setName('remove').setDescription('Remove one stream count')
      .addStringOption(o => o.setName('team-or-user').setDescription('Base team display team or user id').setRequired(true)))
    .addSubcommand(sc => sc.setName('reset').setDescription('Reset all stream counts'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('broadcasts').setDescription('Configure tracked YouTube and Twitch broadcast sources (Commissioner only)')
    .addSubcommand(sc => sc.setName('configure').setDescription('Set the destination channel and keyword filter')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post broadcasts into'))
      .addRoleOption(o => o.setName('ping-role').setDescription('Role to ping for matching streams'))
      .addStringOption(o => o.setName('keyword').setDescription('Keyword required in the title')))
    .addSubcommand(sc => sc.setName('youtube-add').setDescription('Add a YouTube channel id or URL').addStringOption(o => o.setName('value').setDescription('YouTube channel id or URL').setRequired(true)))
    .addSubcommand(sc => sc.setName('youtube-remove').setDescription('Remove a YouTube channel id or URL').addStringOption(o => o.setName('value').setDescription('Stored value to remove').setRequired(true)))
    .addSubcommand(sc => sc.setName('youtube-list').setDescription('List tracked YouTube sources'))
    .addSubcommand(sc => sc.setName('twitch-add').setDescription('Add a Twitch login or URL').addStringOption(o => o.setName('value').setDescription('Twitch login or URL').setRequired(true)))
    .addSubcommand(sc => sc.setName('twitch-remove').setDescription('Remove a Twitch login or URL').addStringOption(o => o.setName('value').setDescription('Stored value to remove').setRequired(true)))
    .addSubcommand(sc => sc.setName('twitch-list').setDescription('List tracked Twitch sources'))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('schedule').setDescription('Show a stored or live weekly schedule')
    .addIntegerOption(o => o.setName('week').setDescription('Optional stored week number')),
  new SlashCommandBuilder()
    .setName('player').setDescription('Look up imported player or owner records')
    .addSubcommand(sc => sc.setName('get').setDescription('Search one player').addStringOption(o => o.setName('query').setDescription('Player name to search').setRequired(true)))
    .addSubcommand(sc => sc.setName('list').setDescription('List imported players').addStringOption(o => o.setName('team').setDescription('Optional team filter'))),
  new SlashCommandBuilder()
    .setName('logger').setDescription('Configure game channel logging (Commissioner only)')
    .addSubcommand(sc => sc.setName('configure').setDescription('Set the game log output channel').addChannelOption(o => o.setName('channel').setDescription('Channel for game logs').setRequired(true)))
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('suggestions').setDescription('Send a server or bot suggestion')
    .addStringOption(o => o.setName('type').setDescription('What the suggestion is about').setRequired(true)
      .addChoices(
        { name: 'Server suggestion', value: 'server' },
        { name: 'Bot improvement', value: 'bot' },
      ))
    .addStringOption(o => o.setName('text').setDescription('Your suggestion').setRequired(true)),
  // ── Customization reset ──
  new SlashCommandBuilder()
    .setName('reset-customization').setDescription('Reset customizations back to defaults (Commissioner only)')
    .addStringOption(o => o.setName('what').setDescription('What to reset').setRequired(true)
      .addChoices(
        { name: '🔄 Everything — reset all to defaults', value: 'all' },
        { name: '📖 Rules only', value: 'rules' },
        { name: '🏷️ League name only', value: 'league-name' },
        { name: '📅 Season settings only', value: 'season' },
      ))
    .setDefaultMemberPermissions(P),

  // ── Security audit ──
  new SlashCommandBuilder()
    .setName('security-audit').setDescription('View security audit log and rate limit status (Commissioner only)')
    .addSubcommand(s => s
      .setName('log').setDescription('Show recent security audit entries')
      .addIntegerOption(o => o.setName('limit').setDescription('How many entries to show (max 50)').setMinValue(1).setMaxValue(50)))
    .addSubcommand(s => s.setName('rate-limits').setDescription('Show active rate limit configuration'))
    .setDefaultMemberPermissions(P),

  // ── Workflow engine ──
  new SlashCommandBuilder()
    .setName('workflow').setDescription('Manage and run dynamic workflows (Commissioner only)')
    .addSubcommand(s => s.setName('list').setDescription('List all registered workflows'))
    .addSubcommand(s => s.setName('log').setDescription('Show recent workflow run history'))
    .addSubcommand(s => s
      .setName('run').setDescription('Manually run a named workflow')
      .addStringOption(o => o.setName('name').setDescription('Workflow name').setRequired(true)
        .addChoices(
          { name: '🏗️ post-build — deploy commands, patch notes, identity, access lock', value: 'post-build' },
          { name: '🗑️ post-trash — guide refresh, automation status', value: 'post-trash' },
          { name: '🔄 post-league-reset — sync teams, boards, hub week', value: 'post-league-reset' },
        )))
    .setDefaultMemberPermissions(P),

  // ── Legacy bot-lifecycle handlers kept reachable via /workflow bot ... ──
  // These definitions are moved under /workflow by commandAliasService at build time.
  new SlashCommandBuilder()
    .setName('kill-bot').setDescription('Pause normal bot commands until reactivated (Commissioner only)')
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('ignite-bot').setDescription('Reactivate the bot and reopen setup (Commissioner only)')
    .setDefaultMemberPermissions(P),
  new SlashCommandBuilder()
    .setName('bot-status').setDescription('Show bot lifecycle/install status (Commissioner only)')
    .setDefaultMemberPermissions(P),

  new SlashCommandBuilder()
    .setName('post-server-guide').setDescription('Republish the server/member guide PDFs (Commissioner only)')
    .setDefaultMemberPermissions(P),

  // ── Security audit log ──
  new SlashCommandBuilder()
    .setName('audit-log').setDescription('View recent security and audit log entries (Commissioner only)')
    .addIntegerOption(o => o.setName('limit').setDescription('Number of entries to show (default 20, max 50)').setMinValue(1).setMaxValue(50))
    .setDefaultMemberPermissions(P),

  // ── System health / lock status ──
  new SlashCommandBuilder()
    .setName('health-status').setDescription('Check all system dependencies and known operational locks (Commissioner only)')
    .setDefaultMemberPermissions(P),

 ];

const MAX_GLOBAL_CHAT_INPUT_COMMANDS = 100;
// V200.2: Commands trimmed when over Discord's 100 CHAT_INPUT limit.
// These are niche/internal commands — functionality accessible via /diagnose, commissioner AI, or other commands.
const COMMAND_TRIM_PRIORITY = [
  'restore-stream',
  'repost-schedule',
  'workflow',
  'audit-log',
  'process-builder',
  'process-run',
  'schedule-registry-status',
  'team-registry-status',
  'hub-status',
  'logger',
  'live-sync-now',
  'live-sync-status',
  'set-league-source-mode',
  'sync-emojis',
  'audit-emojis',
  'cancel-potw-timer',
  'cancel-release-timer',
  'clear-hub',
  'edit-message',
];

// V200.2: Installation mode allowlist is ONLY used by _guardInstallationModeCommand in interactionRouter
// for RUNTIME blocking with a helpful message. We no longer filter command REGISTRATION —
// all commands are always visible in Discord. This prevents ephemeral storage resets from
// hiding 95 commands when wizardState.json gets wiped.
const INSTALLATION_MODE_ALLOWLIST = new Set([
  'add-admin',
  'remove-admin',
  'list-admins',
  'setup-bot',
  'setup-wizard-start',
  'initialize-server',
  'customize-server-rules',
  'set-bot-identity',
  'trash-the-bot',
  'kill-bot',
  'ignite-bot',
  'bot-status',
  'set-bot-tone',
  'set-timezone',
  'manual',
  'suggestions',
  'audit-wiring',
]);

function dedupeCommandsByName(commandJson) {
  const seen = new Set();
  const deduped = [];
  for (const cmd of commandJson) {
    if (seen.has(cmd.name)) {
      console.warn(`[commands] Dropping duplicate application command name: ${cmd.name}`);
      continue;
    }
    seen.add(cmd.name);
    deduped.push(cmd);
  }
  return deduped;
}

function trimToDiscordLimit(commandJson) {
  if (commandJson.length <= MAX_GLOBAL_CHAT_INPUT_COMMANDS) return commandJson;
  let overflow = commandJson.length - MAX_GLOBAL_CHAT_INPUT_COMMANDS;
  const trimmed = [];
  for (const cmd of commandJson) {
    if (overflow > 0 && COMMAND_TRIM_PRIORITY.includes(cmd.name)) {
      overflow -= 1;
      continue;
    }
    trimmed.push(cmd);
  }
  if (trimmed.length > MAX_GLOBAL_CHAT_INPUT_COMMANDS) {
    throw new Error(`Command registry still exceeds Discord limit: ${trimmed.length}/${MAX_GLOBAL_CHAT_INPUT_COMMANDS}`);
  }
  return trimmed;
}

function buildCommandsForState(options = {}) {
  // V200.2: Always register ALL commands with Discord — no installation mode filtering.
  // The runtime guard _guardInstallationModeCommand in interactionRouter blocks non-allowlisted
  // commands during install with a helpful "finish setup first" message. Hiding commands from
  // the slash menu caused permanent command loss when ephemeral storage wiped wizardState.json.
  // V203: legacy commands listed in commandAliasService.GROUPED_ALIASES are nested into permission-matched group
  // commands (same definition, same handler) so every defined command is registered. Trimming is now only a safety net.
  const { applyGroupedAliases } = require('./services/commandAliasService');
  const slashJson = trimToDiscordLimit(applyGroupedAliases(dedupeCommandsByName(commandBuilders.map(c => c.toJSON()))));
  // Context menu commands are always included — commissioners need edit/delete at all times
  const ctxJson = contextMenuCommands.map(c => c.toJSON());
  return [...slashJson, ...ctxJson];
}

module.exports = {
  buildCommandsForState,
  INSTALLATION_MODE_ALLOWLIST,
  MAX_GLOBAL_CHAT_INPUT_COMMANDS,
};
