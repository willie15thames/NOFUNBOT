/*
 * NAVIGATION HEADER
 * FILE: src/services/manualService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

const COLORS = {
  commissioner: 0x0f4c81,
  member: 0x2d8cff,
};

function _roleKey(isComm) {
  return isComm ? 'commissioner' : 'member';
}

function _cmd(cmd, purpose) {
  return `• \`${cmd}\` — ${purpose}`;
}

function _cmdBlock(items) {
  return items.map(([cmd, purpose]) => _cmd(cmd, purpose)).join('\n');
}

const MANUAL = {
  commissioner: {
    overview: {
      title: 'myBot Manual - Commissioner Overview',
      description: 'You have the full control lane. Use the manual commands below for setup, league creation, moderation, boards, automation, identity, and reset flows.',
      fields: [
        {
          name: 'Manual Sections',
          value:
            '`/manual` - full index + PDF\n' +
            '`/manual-server` - base server setup, rules, bot identity, install/reset\n' +
            '`/manual-setup` - installation and reboot flow\n' +
            '`/manual-league` - league creation, league rules, teams, schedules, automation\n' +
            '`/manual-commands` - commissioner command reference\n' +
            '`/manual-actions` - what the bot can do for you automatically',
        },
        {
          name: 'Quick Start',
          value:
            '1. `/setup-wizard-start` or `/initialize-server`\n' +
            '2. Configure bot tone / identity / server rules\n' +
            '3. `/setup-league league-name:<name>`\n' +
            '4. Equip league rules and optional features\n' +
            '5. Invite members via /join-league (league-enabled templates only) or /setup-community for community servers',
        },
      ],
    },
    server: {
      title: 'Server Manual - Commissioner',
      description: 'This section covers the permanent base server, not one specific league.',
      fields: [
        {
          name: 'Base Setup Commands',
          value: _cmdBlock([
            ['/setup-wizard-start', 'open or republish the private setup wizard lane'],
            ['/initialize-server', 'switch the bot into installation mode and seed the setup lane'],
            ['/customize-server-rules', 'open the optional base-server rules customizer'],
            ['/set-bot-tone', 'adjust audience rating, AI tone, and GIF reply behavior outside the wizard'],
            ['/set-bot-identity', 'change bot name, avatar source, or imported emoji avatar'],
            ['/trash-the-bot', 'wipe bot-managed setup state and reboot the server back to install mode'],
          ]),
        },
        {
          name: 'What Base Setup Controls',
          value:
            '- #welcome, #rules, #server-guide, #announcements\n' +
            '- #general-chat, #polls\n' +
            '- #warnings-log, #boot-log\n' +
            '- #commissioner-ai, #admin-hq, #commish-hub, #scoresheets\n' +
            '- role-aware manual surfaces and server engagement rules',
        },
        {
          name: 'Bot Identity',
          value: 'Default name is **myBot**. Default avatar uses the server image. You can override the name and avatar during install or later with `/set-bot-identity`, including choosing an imported server emoji as the avatar source.',
        },
        {
          name: 'Server Rules',
          value: 'Server rules stay separate from league rules. Use the optional server-rules wizard to select custom rules and enforcement levels, then myBot republishes the rules message in #rules.',
        },
      ],
    },
    setup: {
      title: 'Setup Manual - Commissioner',
      description: 'Installation and reboot flows for commissioners.',
      fields: [
        {
          name: 'Install / Reboot Commands',
          value: _cmdBlock([
            ['/setup-wizard-start', 'reopen the private setup wizard without wiping the server'],
            ['/initialize-server', 'prepare a fresh install flow and seed the setup lane'],
            ['/trash-the-bot', 'flush bot-managed setup state and start over from installation mode'],
          ]),
        },
        {
          name: 'What Install Mode Covers',
          value:
            '- base server structure\n' +
            '- server rules selection\n' +
            '- bot audience rating and tone profile\n' +
            '- bot name and avatar identity\n' +
            '- reopening the setup wizard after a full reset',
        },
        {
          name: 'Important',
          value: 'Install mode is for first setup or a full reboot. It is not a league action. League creation happens after install mode with `/setup-league league-name:<name>`.',
        },
      ],
    },
    league: {
      title: 'League Manual - Commissioner',
      description: 'League setup is separate from base server setup. Each created league gets its own capabilities, channels, and rule options.',
      fields: [
        {
          name: 'League Lifecycle',
          value: _cmdBlock([
            ['/setup-league league-name:<name>', 'create a new league after the base server is initialized'],
            ['/reset-league', 'rebuild one league without trashing the whole server'],
            ['/delete-league', 'remove a league and its managed data'],
            ['/join-league', 'member intake path for players who want into a league'],
            ['/open-teams', 'show currently open teams for the active league'],
            ['/team-registry-status', 'inspect the saved team ownership registry'],
          ]),
        },
        {
          name: 'League Creation Capabilities',
          value:
            '- pick game + league template\n' +
            '- equip league rules after creation\n' +
            '- enable optional features like active check\n' +
            '- seed standard teams or support custom / team-builder / pro-am identities\n' +
            '- create channels under the shared-category model',
        },
        {
          name: 'Team and Ownership Control',
          value: _cmdBlock([
            ['/register-team', 'register a team in the league registry'],
            ['/set-team-identity', 'change a team name, branding, or team details'],
            ['/add-open-team', 'place a team on the open-teams board'],
            ['/remove-open-team', 'remove a team from the open-teams board'],
            ['/set-team-logo', 'attach or change a team logo'],
            ['/refresh-open-teams', 'rebuild the open-teams display'],
            ['/release-team', 'free a claimed team back to open status'],
            ['/add-member-to-league', 'manually place a member into a league'],
          ]),
        },
        {
          name: 'Games, Scheduling, and Boards',
          value: _cmdBlock([
            ['/create-game', 'create a managed game or matchup record'],
            ['/respond', 'answer scheduling prompts or game requests'],
            ['/report-result', 'submit a game result'],
            ['/set-stat-leaders', 'update league stat leaders'],
            ['/player-of-the-week', 'award or update the player-of-the-week board'],
            ['/refresh-rewards', 'rebuild reward and progression boards'],
            ['/retract-score', 'pull back an incorrect score report'],
            ['/create-poll', 'post a managed poll to the polls lane'],
          ]),
        },
        {
          name: 'Automation and Sync',
          value: _cmdBlock([
            ['/schedule-import', 'load schedule data into the bot'],
            ['/schedule-export', 'export saved schedule data back out'],
            ['/league-data-ingest', 'import readable league files such as csv, json, docx, xlsx, and images into bot-managed stats, schedules, standings, or records'],
            [require('./commandAliasService').displayPath('set-league-source-mode'), 'declare whether the league is bot-managed or externally synced'],
            ['/set-weekly-channel-mode', 'choose how matchup channels behave week to week'],
            ['/set-live-sync', 'control automated sync behavior'],
            [require('./commandAliasService').displayPath('live-sync-now'), 'run an on-demand sync immediately'],
          ]) + '\n• Active-check scheduling, board refreshes, and game-channel lifecycle logic run from the saved setup.',
        },
      ],
    },
    commands: {
      title: 'Command Manual - Commissioner',
      description: 'Commissioners see the full command lane. Members do not.',
      fields: [
        {
          name: 'Setup / Identity',
          value: _cmdBlock([
            ['/setup-wizard-start', 'open the private setup wizard again'],
            ['/initialize-server', 'start installation mode for a fresh base-server build'],
            ['/customize-server-rules', 'edit base-server rules and enforcement'],
            ['/set-bot-tone', 'change the AI voice, audience rating, and GIF reply behavior'],
            ['/set-bot-identity', 'change bot name, avatar, or imported emoji avatar'],
            ['/trash-the-bot', 'reset the bot back to installation mode'],
            ['/audit-wiring', 'run a command/router sanity check'],
          ]),
        },
        {
          name: 'League / Teams',
          value: _cmdBlock([
            ['/setup-league', 'create a league after base-server setup is complete'],
            ['/reset-league', 'rebuild one league while keeping the base server'],
            ['/delete-league', 'delete a league and its managed artifacts'],
            ['/register-team', 'register a team in the team registry'],
            ['/set-team-identity', 'edit a team name, branding, or identity details'],
            ['/add-open-team', 'place a team on the open-teams board'],
            ['/remove-open-team', 'remove a team from the open-teams board'],
            ['/set-team-logo', 'attach or change a team logo'],
            ['/refresh-open-teams', 'rebuild the open-teams display'],
            ['/release-team', 'free a claimed team back to open status'],
            ['/team-registry-status', 'inspect current team ownership and registry health'],
          ]),
        },
        {
          name: 'Members / Moderation',
          value: _cmdBlock([
            ['/add-admin', 'grant admin or commissioner access to a member'],
            ['/remove-admin', 'remove admin access from a member'],
            ['/list-admins', 'show the saved admin list'],
            ['/add-member-to-league', 'manually place a member into a league'],
            ['/member-record inactive', 'mark a member inactive in their permanent record'],
            ['/ban add', 'ban a user from the bot-managed system'],
            ['/ban list', 'review current bans'],
            ['/ban remove', 'lift a saved ban'],
          ]),
        },
        {
          name: 'Games / Rewards',
          value: _cmdBlock([
            ['/create-game', 'create a managed game or matchup record'],
            ['/set-stat-leaders', 'update stat leaders for the league'],
            ['/player-of-the-week', 'award or update the player-of-the-week board'],
            ['/refresh-rewards', 'rebuild reward and progression boards'],
            ['/retract-score', 'pull back an incorrect score report'],
            ['/post-server-guide', 'republish the server guide'],
            ['/send-welcome', 'send the welcome DM to a user manually'],
            ['/create-poll', 'post a managed poll to the polls lane'],
          ]),
        },
      ],
    },
    actions: {
      title: 'Bot Actions Manual - Commissioner',
      description: 'This is what myBot can do automatically once configured.',
      fields: [
        {
          name: 'Automatic Behaviors',
          value:
            '- post guides and rules\n' +
            '- manage board refreshes\n' +
            '- enforce read-only channels\n' +
            '- track team ownership, schedules, and weekly game channels\n' +
            '- run active checks if enabled\n' +
            '- respond in tone based on install settings\n' +
            '- optionally include reaction GIFs when the configured tone allows it',
        },
        {
          name: 'When to Use Commands vs. Conversation',
          value: 'Use slash commands for actions that change data. Use mentions for questions, explanations, trash talk, and quick guidance. Commissioner commands keep the butler tone when you are asking the bot to act.',
        },
      ],
    },
  },
  member: {
    overview: {
      title: 'myBot Manual - Member Overview',
      description: 'This is your lane. The manual below only shows the commands and actions you are allowed to use.',
      fields: [
        {
          name: 'Manual Sections',
          value:
            '`/manual` - full index + PDF\n' +
            '`/manual-server` - how the base server works\n' +
            '`/manual-setup` - what members need to know about setup\n' +
            '`/manual-league` - how to join and operate inside a league\n' +
            '`/manual-commands` - your usable commands\n' +
            '`/manual-actions` - what you can do in channels',
        },
        {
          name: 'Fastest Path',
          value:
            '1. Read #rules and your server guide channel\n' +
            '2. Use `/join-league`\n' +
            '3. If accepted, use the league-specific flow to claim or create your team\n' +
            '4. Set your timezone when prompted\n' +
            '5. Use your game channels when the season is live',
        },
      ],
    },
    server: {
      title: 'Server Manual - Member',
      description: 'These are the base server rules and channels that apply before or outside of league play.',
      fields: [
        {
          name: 'Base Channels',
          value: '#welcome, #rules, #server-guide, #how-to-join, #announcements, #general-chat, #polls',
        },
        {
          name: 'How Base Channels Work',
          value: 'Info channels are read-only. Use #general-chat for regular conversation. Use #polls for picklist voting only. If you are not in a league yet, `/join-league` is the correct path.',
        },
        {
          name: 'Server Behavior',
          value: 'Trash talk is usually allowed within the configured server rules. Slurs, hate, or bannable nonsense are not.',
        },
      ],
    },
    setup: {
      title: 'Setup Manual - Member',
      description: 'What members need to know about setup.',
      fields: [
        {
          name: 'Who Does Setup',
          value: 'Commissioners handle install mode, server rules, bot tone, identity, and league creation. Members do not run setup commands.',
        },
        {
          name: 'What You Should Expect',
          value: 'Once setup is complete, read #rules, your guide channel, and #how-to-join. League features unlock only if the commissioner enables them.',
        },
      ],
    },
    league: {
      title: 'League Manual - Member',
      description: 'This section changes depending on whether leagues exist and whether you have already joined one.',
      fields: [
        {
          name: 'If You Are Not In a League Yet',
          value: 'Use `/join-league`. If no active leagues exist, wait for a commissioner to create one. Do not use `/select-team` before you are in the join flow.',
        },
        {
          name: 'If You Are Joining a Standard League',
          value:
            '- choose the league\n' +
            '- choose an open team\n' +
            '- enter your timezone\n' +
            '- gain access to your league channels',
        },
        {
          name: 'If You Are Joining a Custom / Pro-Am / Team-Builder League',
          value:
            '- choose the league\n' +
            '- provide team name\n' +
            '- choose what slot your custom team replaces if required\n' +
            '- optionally provide a logo reference\n' +
            '- enter your timezone',
        },
        {
          name: 'League Gameplay Commands',
          value: '`/select-team`, `/set-timezone`, `/open-teams`, `/respond`, `/report-result`, `/rewards-board`',
        },
      ],
    },
    commands: {
      title: 'Command Manual - Member',
      description: 'These are the commands a normal member should actually use.',
      fields: [
        {
          name: 'Join / Team / Scheduling',
          value: _cmdBlock([
            ['/join-league', 'start the join flow for an active league'],
            ['/select-team', 'claim an open team when the flow allows it'],
            ['/set-timezone', 'save your timezone for scheduling'],
            ['/open-teams', 'view available teams'],
            ['/respond', 'answer scheduling prompts or game requests'],
            ['/report-result', 'submit a game result'],
          ]),
        },
        {
          name: 'Info / Progress',
          value: _cmdBlock([
            ['/manual', 'open the role-aware manual and PDF index'],
            ['/manual section:server', 'read the base-server guide'],
            ['/manual section:league', 'read the server guide'],
            ['/manual section:setup', 'read the setup expectations for your role'],
            ['/manual section:commands', 'see the commands you should use'],
            ['/manual section:actions', 'see what the bot can do for you'],
            ['/rewards-board', 'view the current rewards board'],
          ]),
        },
        {
          name: 'Polls / Voting',
          value: 'Use poll picklists in #polls. That channel should not be used like normal chat.',
        },
      ],
    },
    actions: {
      title: 'Bot Actions Manual - Member',
      description: 'What you can expect from myBot as a member.',
      fields: [
        {
          name: 'What myBot Will Help With',
          value:
            '- answer questions\n' +
            '- tell you how to join\n' +
            '- walk you through team claiming when appropriate\n' +
            '- support league scheduling and results\n' +
            '- talk trash back within the configured tone',
        },
        {
          name: 'What myBot Will Not Do',
          value:
            '- reveal hidden staff tools\n' +
            '- let you talk in read-only info channels\n' +
            '- let you run commissioner actions\n' +
            '- pretend a league exists when none exists',
        },
      ],
    },
  },
};

function _buildEmbeds(section, isComm) {
  const role = _roleKey(isComm);
  const data = MANUAL[role][section] || MANUAL[role].overview;
  const embed = new EmbedBuilder()
    .setColor(COLORS[role])
    .setTitle(data.title)
    .setDescription(data.description)
    .setFooter({ text: isComm ? 'Commissioner view' : 'Member view' })
    .setTimestamp();
  for (const field of data.fields || []) {
    embed.addFields({ name: field.name, value: field.value });
  }
  return [embed];
}

function getManualPdfPath() {
  const p = path.join(__dirname, '..', '..', 'files', 'MYBOT_Full_Manual.pdf');
  return fs.existsSync(p) ? p : null;
}

function getManualAttachment() {
  const p = getManualPdfPath();
  return p ? new AttachmentBuilder(p, { name: 'MYBOT_Full_Manual.pdf' }) : null;
}

module.exports = {
  buildOverviewEmbeds: (isComm) => _buildEmbeds('overview', isComm),
  buildSectionEmbeds: (section, isComm) => _buildEmbeds(section, isComm),
  getManualPdfPath,
  getManualAttachment,
};
