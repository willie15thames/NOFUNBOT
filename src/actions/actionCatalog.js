/*
 * NAVIGATION HEADER
 * FILE: src/actions/actionCatalog.js
 * LAYER: AI action layer (V202, spec §23, audit §28–29, directive rules 29–33)
 * PURPOSE: The ONE registered Action Catalog. Every AI-executable action declares: type, owner service, field
 *          schema (types + validation), permission, destructive flag, confirmation policy, idempotency, and its
 *          executor. The commissioner runtime prompt's action list is GENERATED from this file (ai/commissionerPrompt),
 *          the validator enforces it, and the executor runs it — so catalog-defined model actions share one contract. Other transports converge on the same application use cases.
 * LOOK HERE FIRST WHEN DEBUGGING: ACTIONS, getAction(), requiresConfirmation().
 * RELATED FLOW: actions/actionValidator, actions/actionExecutor, actions/confirmationService, handlers/commissionerHandler.
 * NOTE: To add an action you MUST add its definition + executor here AND a test in tests/ (rule 30). Never add an
 *       action type to prompt prose by hand. Executors return { ok, message } or { ok:false, reason } — never null.
 */

'use strict';

const SNOWFLAKE = /^\d{17,20}$/;
const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/;

function _slug(v) { return String(v || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 90); }
function _safeName(v, max = 60) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function _findTextChannel(guild, name, exact = false) {
  const needle = _slug(name);
  if (!needle) return null;
  return guild.channels.cache.find(c => c.isTextBased?.() && (exact ? c.name.toLowerCase() === needle : c.name.toLowerCase().includes(needle))) || null;
}

const ACTIONS = [
  {
    type: 'refresh_open_teams', owner: 'openTeamsService', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'safe',
    description: 'Refresh the open-teams board.', fields: {},
    async execute(f, ctx) { await require('../services/openTeamsService').refreshOpenTeamsBoard(ctx.guild); return { ok: true, message: '✅ Open teams board refreshed.' }; },
  },
  {
    type: 'post_message', owner: 'sendMessageService', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'keyed',
    description: 'Post a message in a channel. Mentions are never pinged (@everyone/@here are sent as plain text). Use channelId from the CHANNELS directory when available.',
    fields: { channelId: { type: 'string', pattern: SNOWFLAKE }, channelName: { type: 'string', maxLength: 100 }, text: { type: 'string', required: true, maxLength: 2000 } },
    requireOneOf: [['channelId', 'channelName']],
    async execute(f, ctx) {
      const ch = f.channelId ? ctx.guild.channels.cache.get(f.channelId) : require('../services/channels/channelResolver').getChannelByNameIncludes(ctx.guild, f.channelName);
      if (!ch || !ch.isTextBased?.()) return { ok: false, reason: `channel "${f.channelName || f.channelId}" not found` };
      const r = await require('../services/sendMessageService').send(ch, { content: f.text, allowedMentions: { parse: [] } }, { action: 'ai-post-message', idempotencyKey: ctx.requestId });
      if (!r.ok) return { ok: false, reason: `send failed (${r.reason})` };
      return { ok: true, message: `✅ Posted in ${ch}.` };
    },
  },
  {
    type: 'release_week', owner: 'hubReleaseService', permission: 'commissioner', destructive: true, confirmation: 'interactive', idempotency: 'non-idempotent',
    description: 'Publish the staged hub scores/standings (pings @everyone in announcements).', fields: {},
    async execute(f, ctx) {
      const hub = ctx.state.hubWeeklyData;
      if (!hub.scores.length && !hub.statLines.length) return { ok: false, reason: 'no data staged — drop screenshots in #commish-hub first' };
      await require('../services/hubReleaseService').runWeeklyRelease(ctx.guild, ctx.client, ctx.state, ctx, true);
      return { ok: true, message: `✅ Week ${ctx.state.hubWeeklyData.week || '?'} released.` };
    },
  },
  {
    type: 'set_hub_week', owner: 'hubReleaseService', permission: 'commissioner', destructive: true, confirmation: 'interactive', idempotency: 'non-idempotent',
    description: 'Reset the hub staging week (clears staged scores/stat lines).', fields: { week: { type: 'integer', required: true, min: 1, max: 30 } },
    async execute(f, ctx) {
      const hub = require('../services/hubReleaseService');
      await hub.resetHubWeek(f.week, ctx.state);
      hub.startHubReleaseTimer(ctx.guild, ctx.client, ctx.state, ctx);
      return { ok: true, message: `✅ Hub week set to **Week ${f.week}**.` };
    },
  },
  {
    type: 'rename_category', owner: 'discord', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'safe',
    description: 'Rename a category.', fields: { oldName: { type: 'string', required: true, maxLength: 100 }, newName: { type: 'string', required: true, maxLength: 100 } },
    async execute(f, ctx) {
      const { ChannelType } = require('discord.js');
      const cat = ctx.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes(_safeName(f.oldName).toLowerCase()));
      if (!cat) return { ok: false, reason: `category "${f.oldName}" not found` };
      await cat.setName(_safeName(f.newName, 100));
      return { ok: true, message: `✅ Category renamed: **${f.oldName}** → **${_safeName(f.newName, 100)}**` };
    },
  },
  {
    type: 'rename_channel', owner: 'discord', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'safe',
    description: 'Rename a text channel.', fields: { oldName: { type: 'string', required: true, maxLength: 100 }, newName: { type: 'string', required: true, maxLength: 100 } },
    async execute(f, ctx) {
      const ch = _findTextChannel(ctx.guild, f.oldName);
      if (!ch) return { ok: false, reason: `channel "${f.oldName}" not found` };
      const slug = _slug(f.newName);
      if (!slug) return { ok: false, reason: 'new name is empty after sanitizing' };
      await ch.setName(slug);
      return { ok: true, message: `✅ Channel renamed: **#${f.oldName}** → **#${slug}**` };
    },
  },
  {
    type: 'create_channel', owner: 'discord', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'keyed',
    description: 'Create a text channel (find-or-create: an existing channel with the same name in the same category is reused).',
    fields: { name: { type: 'string', required: true, maxLength: 90 }, category: { type: 'string', maxLength: 100 }, topic: { type: 'string', maxLength: 1024 } },
    async execute(f, ctx) {
      const { ChannelType } = require('discord.js');
      const slug = _slug(f.name);
      if (!slug) return { ok: false, reason: 'channel name is empty after sanitizing' };
      const parent = f.category ? ctx.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes(_safeName(f.category, 100).toLowerCase())) : null;
      if (f.category && !parent) return { ok: false, reason: `category "${f.category}" not found` };
      const existing = ctx.guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === slug && (c.parentId || null) === (parent?.id || null));
      if (existing) return { ok: true, message: `ℹ️ ${existing} already exists${parent ? ` in **${parent.name}**` : ''} — nothing created.` };
      const created = await ctx.guild.channels.create({ name: slug, type: ChannelType.GuildText, parent: parent?.id || null, topic: f.topic || null });
      return { ok: true, message: `✅ Channel ${created} created${parent ? ` in **${parent.name}**` : ''}.` };
    },
  },
  {
    type: 'delete_channel', owner: 'discord', permission: 'commissioner', destructive: true, confirmation: 'interactive', idempotency: 'safe',
    description: 'Delete a text channel by exact name.', fields: { name: { type: 'string', required: true, maxLength: 100 } },
    async execute(f, ctx) {
      const ch = _findTextChannel(ctx.guild, f.name, true);
      if (!ch) return { ok: false, reason: `channel "${f.name}" not found (exact name required)` };
      await ch.delete('Deleted by commissioner via AI (confirmed)');
      return { ok: true, message: `✅ Channel **#${ch.name}** deleted.` };
    },
  },
  {
    type: 'set_channel_topic', owner: 'discord', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'safe',
    description: 'Set a text channel topic.', fields: { name: { type: 'string', required: true, maxLength: 100 }, topic: { type: 'string', required: true, maxLength: 1024 } },
    async execute(f, ctx) {
      const ch = _findTextChannel(ctx.guild, f.name);
      if (!ch) return { ok: false, reason: `channel "${f.name}" not found` };
      await ch.setTopic(f.topic);
      return { ok: true, message: `✅ Topic updated for **#${ch.name}**.` };
    },
  },
  {
    type: 'update_rules', owner: 'leagueConfig', permission: 'commissioner', destructive: true, confirmation: 'interactive', idempotency: 'non-idempotent',
    description: 'Edit league rules: replace oldText with newText, or append newText under an optional section.',
    fields: { newText: { type: 'string', required: true, maxLength: 2000 }, oldText: { type: 'string', maxLength: 2000 }, section: { type: 'string', maxLength: 100 } },
    async execute(f, ctx) {
      const lc = ctx.state.leagueConfig;
      const before = lc.rulesText || '';
      let action = 'appended';
      if (f.oldText && before.includes(f.oldText)) { lc.rulesText = before.replace(f.oldText, f.newText); action = 'replaced'; }
      else if (f.oldText) return { ok: false, reason: 'the text to replace was not found in the current rules' };
      else if (f.section) lc.rulesText = `${before}\n\n## ${f.section}\n${f.newText}`;
      else lc.rulesText = `${before}\n${f.newText}`;
      lc.rulesUpdatedAt = Date.now();
      lc.rulesHistory = Array.isArray(lc.rulesHistory) ? lc.rulesHistory : [];
      lc.rulesHistory.push({ timestamp: Date.now(), updatedBy: ctx.actorId || 'ai', action: `ai-${action}`, oldText: f.oldText || null, newText: f.newText, section: f.section || 'All' });
      require('../storage/jsonStore').saveJsonDebounced('leagueConfig.json', lc);
      return { ok: true, message: `✅ Rules ${action}${f.section ? ` in section **${f.section}**` : ''}.` };
    },
  },
  {
    type: 'create_role', owner: 'discord', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'keyed',
    description: 'Create a role (reuses an existing role with the same name).', fields: { name: { type: 'string', required: true, maxLength: 100 }, color: { type: 'string', pattern: HEX_COLOR } },
    async execute(f, ctx) {
      const name = _safeName(f.name, 100);
      const existing = ctx.guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
      if (existing) return { ok: true, message: `ℹ️ Role **${existing.name}** already exists — nothing created.` };
      await ctx.guild.roles.create({ name, color: parseInt(String(f.color || '#3498db').replace('#', ''), 16), reason: 'Created by commissioner via AI' });
      return { ok: true, message: `✅ Role **${name}** created.` };
    },
  },
  {
    type: 'rename_role', owner: 'discord', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'safe',
    description: 'Rename a role (exact current name).', fields: { oldName: { type: 'string', required: true, maxLength: 100 }, newName: { type: 'string', required: true, maxLength: 100 } },
    async execute(f, ctx) {
      const role = ctx.guild.roles.cache.find(r => r.name.toLowerCase() === String(f.oldName).toLowerCase());
      if (!role) return { ok: false, reason: `role "${f.oldName}" not found` };
      await role.setName(_safeName(f.newName, 100));
      return { ok: true, message: `✅ Role renamed: **${f.oldName}** → **${_safeName(f.newName, 100)}**` };
    },
  },
  {
    type: 'set_role_color', owner: 'discord', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'safe',
    description: 'Set a role color (#RRGGBB).', fields: { name: { type: 'string', required: true, maxLength: 100 }, color: { type: 'string', required: true, pattern: HEX_COLOR } },
    async execute(f, ctx) {
      const role = ctx.guild.roles.cache.find(r => r.name.toLowerCase() === String(f.name).toLowerCase());
      if (!role) return { ok: false, reason: `role "${f.name}" not found` };
      await role.setColor(parseInt(String(f.color).replace('#', ''), 16));
      return { ok: true, message: `✅ Role **${role.name}** color updated.` };
    },
  },
  {
    type: 'ban_user', owner: 'memberLedgerService', permission: 'commissioner', destructive: true, confirmation: 'interactive', idempotency: 'safe',
    description: 'Ban a member (userId from the @username[userId:…] mention).', fields: { userId: { type: 'string', required: true, pattern: SNOWFLAKE }, reason: { type: 'string', maxLength: 512 } },
    async execute(f, ctx) {
      const reason = f.reason || 'Banned by commissioner via AI';
      try { await ctx.guild.members.ban(f.userId, { reason }); }
      catch (e) { return { ok: false, reason: `Discord ban failed: ${e.message}` }; }
      require('../services/memberLedgerService').recordBan(f.userId, reason, ctx.actorId);
      return { ok: true, message: '🔨 Member banned and added to the ban list. Use `/ban list` to review or `/ban remove` to reverse.' };
    },
  },
  {
    type: 'unban_user', owner: 'memberLedgerService', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'safe',
    description: 'Lift a ban.', fields: { userId: { type: 'string', required: true, pattern: SNOWFLAKE } },
    async execute(f, ctx) {
      const r = await require('../services/memberLedgerService').unbanUser(ctx.guild, f.userId, ctx.actorTag || ctx.actorId);
      if (!r.success) return { ok: false, reason: r.reason };
      return { ok: true, message: `✅ **${r.username}** has been unbanned. Ban list and Discord server ban both cleared.` };
    },
  },
  {
    type: 'ban_list', owner: 'memberLedgerService', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'safe',
    description: 'Show the ban list (usernames and reasons only).', fields: {},
    async execute(f, ctx) {
      const bans = require('../services/memberLedgerService').getBanList();
      if (!bans.length) return { ok: true, message: 'The ban list is empty.' };
      return { ok: true, message: `🔨 **Ban List (${bans.length}):**\n${bans.map((b, i) => `${i + 1}. **${String(b.username || 'unknown').replace(/\d{17,20}/g, '[id hidden]')}** — ${b.reason}`).join('\n')}` };
    },
  },
  {
    type: 'release_team', owner: 'openTeamsService', permission: 'commissioner', destructive: true, confirmation: 'interactive', idempotency: 'safe',
    description: 'Release a claimed team back to open (removes the current owner).', fields: { teamName: { type: 'string', required: true, maxLength: 60 } },
    async execute(f, ctx) {
      const ots = require('../services/openTeamsService');
      const result = await ots.releaseByName(ctx.guild, f.teamName);
      if (!result) return { ok: false, reason: `no claimed team matches "${f.teamName}"` };
      await ots.announceTeamOpen(ctx.guild, result.entry, 'released by the commissioner');
      return { ok: true, message: `✅ **${result.entry.displayTeam}** has been released and is now open again.` };
    },
  },
  {
    type: 'provider_status', owner: 'providerConnectionService', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'safe',
    description: 'Show the current league data-provider connection status and recent sync state.', fields: {},
    async execute(f, ctx) {
      const status = await require('../services/leagueSyncService').getSyncStatus();
      const rows = status.connections || [];
      const lines = rows.length ? rows.map(c => `• **${c.providerKey}**: ${c.status} / health ${c.healthStatus}${c.fallbackMode === 'manual' ? ' / manual fallback' : ''}`).join('\n') : '• No league-scoped provider connections configured.';
      return { ok:true, message:`📡 **Provider status**\nActive: **${status.activeProvider?.key || status.liveSync?.provider || 'local'}**\n${lines}` };
    },
  },
  {
    type: 'provider_sync_now', owner: 'leagueSyncService', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'keyed',
    description: 'Run the active league data sync now. This refreshes data only and never advances the franchise.', fields: {},
    async execute(f, ctx) {
      const r = await require('../services/leagueSyncService').syncNow(ctx.guild, ctx.state, { trigger:'natural-language' });
      if (!r?.ok) return { ok:false, reason:r?.reason || 'sync-failed' };
      return { ok:true, message:`✅ Provider sync completed via **${r.provider || 'active provider'}**${r.processed != null ? `; processed **${r.processed}** queued import(s)` : ''}.` };
    },
  },
  {
    type: 'provider_test_connection', owner: 'providerConnectionActionService', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'safe',
    description: 'Test a configured provider connection.', fields: { provider: { type:'string', required:true, maxLength:40 } },
    async execute(f) {
      const r = await require('../services/providerConnectionActionService').test({ provider:f.provider });
      if (!r?.ok) return { ok:false, reason:r?.reason || r?.health?.reason || 'provider-test-failed' };
      return { ok:true, message:`✅ **${f.provider}** connection test passed.` };
    },
  },
  {
    type: 'provider_activate_connection', owner: 'providerConnectionActionService', permission: 'commissioner', destructive: true, confirmation: 'interactive', idempotency: 'safe',
    description: 'Activate a tested provider as the authoritative external data source for the current league.', fields: { provider: { type:'string', required:true, maxLength:40 } },
    async execute(f) {
      const r = await require('../services/providerConnectionActionService').activate({ provider:f.provider });
      if (!r?.ok) return { ok:false, reason:r?.reason || 'provider-activation-failed' };
      return { ok:true, message:`✅ **${f.provider}** is now the active league data source.` };
    },
  },
  {
    type: 'provider_disconnect', owner: 'providerConnectionActionService', permission: 'commissioner', destructive: true, confirmation: 'interactive', idempotency: 'safe',
    description: 'Disconnect a provider and revoke its stored receiver token/credential.', fields: { provider: { type:'string', required:true, maxLength:40 } },
    async execute(f) {
      const r = await require('../services/providerConnectionActionService').disconnect({ provider:f.provider });
      if (!r?.ok) return { ok:false, reason:r?.reason || 'provider-disconnect-failed' };
      return { ok:true, message:`✅ **${f.provider}** disconnected. League returned to bot-managed/manual data mode.` };
    },
  },
  {
    type: 'provider_reconnect', owner: 'providerConnectionActionService', permission: 'commissioner', destructive: true, confirmation: 'interactive', idempotency: 'keyed',
    description: 'Reconnect a provider. Push providers rotate their receiver token, invalidating the old URL.', fields: { provider: { type:'string', required:true, maxLength:40 } },
    async execute(f) {
      const r = await require('../services/providerConnectionActionService').reconnect({ provider:f.provider });
      if (!r?.ok) return { ok:false, reason:r?.reason || 'provider-reconnect-failed' };
      return { ok:true, message:`✅ **${f.provider}** reconnected${r.receiverUrl ? `\nNew receiver URL: **${r.receiverUrl}**` : ''}.` };
    },
  },
  {
    type: 'provider_manual_fallback', owner: 'providerConnectionActionService', permission: 'commissioner', destructive: true, confirmation: 'interactive', idempotency: 'safe',
    description: 'Put a provider connection into manual fallback without deleting its configuration.', fields: { provider: { type:'string', required:true, maxLength:40 } },
    async execute(f) {
      const r = await require('../services/providerConnectionActionService').fallback({ provider:f.provider, reason:'commissioner natural-language fallback' });
      if (!r?.ok) return { ok:false, reason:r?.reason || 'provider-fallback-failed' };
      return { ok:true, message:`✅ **${f.provider}** is in manual fallback. Existing configuration is retained.` };
    },
  },
  {
    type: 'league_status', owner: 'advanceEngine', permission: 'commissioner', destructive: false, confirmation: 'none', idempotency: 'safe',
    description: 'Report the league automation state (source week, workflow week, state, next deadline, provider).', fields: {},
    async execute(f, ctx) {
      const s = require('../league/advanceEngine').getStatus(ctx.state);
      const rt = s.runtime;
      return { ok: true, message: `📊 Advance state **${rt.state}** | workflow week **${rt.workflowWeek ?? 'n/a'}** | verified source week **${rt.sourceWeek ?? 'n/a'}** | provider **${s.provider.key}** (advance control: ${s.provider.capabilities.advanceWeek ? 'yes' : 'no'}) | automation ${s.policy.enabled ? `on (${s.policy.intervalHours}h${s.policy.shadowMode ? ', shadow' : ''})` : 'off'}${rt.nextAdvanceAt ? ` | next deadline <t:${Math.floor(rt.nextAdvanceAt / 1000)}:R>` : ''}${rt.hold ? ` | HOLD: ${rt.hold.reason}` : ''}` };
    },
  },
  {
    type: 'request_league_advance', owner: 'advanceEngine', permission: 'commissioner', destructive: true, idempotency: 'keyed',
    confirmation: f => (f.dryRun ? 'none' : 'interactive'),
    description: 'Start the verified league advance procedure (never claims Madden advanced; waits for the provider to report the new source week). dryRun=true only reports what would happen.',
    fields: { dryRun: { type: 'boolean' } },
    async execute(f, ctx) {
      const engine = require('../league/advanceEngine');
      const r = await engine.requestAdvance({ guild: ctx.guild, state: ctx.state, actor: ctx.actorId, dryRun: !!f.dryRun });
      if (f.dryRun) return { ok: true, message: `🧪 Dry run: path **${r.path}** | provider **${r.provider}** | source week ${r.sourceWeek ?? 'unknown'}${r.sourceError ? ` (${r.sourceError})` : ''} | workflow week ${r.workflowWeek ?? 'n/a'}${r.blockers.length ? `\nBlockers:\n• ${r.blockers.join('\n• ')}` : ''}` };
      if (!r.ok) return { ok: false, reason: r.reason || 'advance request rejected' };
      try { require('../services/leagueAutomationService').rearm({ guild: ctx.guild, state: ctx.state }); } catch {}
      return { ok: true, message: `🗓 Advance procedure state: **${r.state}**${r.alreadyInCycle ? ' (already in progress — no second cycle started)' : ''}.` };
    },
  },
  {
    type: 'set_automation_policy', owner: 'automationPolicyService', permission: 'commissioner', destructive: false, idempotency: 'safe',
    confirmation: f => (f.enabled === true || f.shadowMode === false ? 'interactive' : 'none'),
    description: 'Change league automation settings (enabling automation or leaving shadow mode requires confirmation).',
    fields: { enabled: { type: 'boolean' }, intervalHours: { type: 'integer', min: 1, max: 336 }, shadowMode: { type: 'boolean' }, blockOnActiveGame: { type: 'boolean' }, requireAllGamesFinal: { type: 'boolean' } },
    requireOneOf: [['enabled', 'intervalHours', 'shadowMode', 'blockOnActiveGame', 'requireAllGamesFinal']],
    async execute(f, ctx) {
      const policySvc = require('../league/automationPolicyService');
      const prev = policySvc.getPolicy();
      const patch = {};
      for (const k of ['enabled', 'intervalHours', 'shadowMode']) if (f[k] !== undefined) patch[k] = f[k];
      const pre = {};
      if (f.blockOnActiveGame !== undefined) pre.blockOnActiveGame = f.blockOnActiveGame;
      if (f.requireAllGamesFinal !== undefined) pre.requireAllGamesFinal = f.requireAllGamesFinal;
      if (Object.keys(pre).length) patch.precheckPolicy = pre;
      const r = policySvc.setPolicy(patch, ctx.actorId);
      if (!r.ok) return { ok: false, reason: `${r.reason}: ${(r.fields || []).join(', ')}` };
      require('../league/advanceEngine').onPolicyChanged(prev, r.policy);
      try { require('../services/leagueAutomationService').rearm({ guild: ctx.guild, state: ctx.state }); } catch {}
      return { ok: true, message: `✅ Automation policy saved.\n${policySvc.describePolicy(r.policy)}` };
    },
  },
];

const _byType = new Map(ACTIONS.map(a => [a.type, Object.freeze(a)]));

function getAction(type) { return _byType.get(String(type || '')) || null; }
function listActions() { return [..._byType.values()]; }
function requiresConfirmation(def, fields) {
  const c = typeof def.confirmation === 'function' ? def.confirmation(fields || {}) : def.confirmation;
  return c !== 'none';
}

module.exports = { ACTIONS: listActions(), getAction, listActions, requiresConfirmation };
