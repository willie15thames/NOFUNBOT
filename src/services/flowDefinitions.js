/*
 * NAVIGATION HEADER
 * FILE: src/services/flowDefinitions.js
 * LAYER: Service layer
 * PURPOSE: Defines all executable multi-step workflows for the workflow engine.
 *          Each workflow follows the 10-element completion standard:
 *          trigger, owner, source-of-truth, validation, execution, dedupe, recovery, logging, escalation, patch-note.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for the workflow name (e.g., 'member-onboarding').
 * RELATED FLOW: workflowEngineService.js, escalationService.js, validationGateService.js.
 * NOTE: V191 — introduced as part of flow completion program.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const log = makeLogger('flowDef');

/**
 * Register all workflow definitions with the engine.
 * Called once at module load.
 *
 * @param {Object} engine - workflowEngineService (has define, onEvent)
 */
function registerAll(engine) {
  // ═══════════════════════════════════════════════════════════
  // MEMBER ONBOARDING — join → welcome → timezone → community → access
  // Trigger: guildMemberAdd
  // Owner: onboardingAutomationService
  // ═══════════════════════════════════════════════════════════
  engine.define('member-onboarding', [
    {
      step: 'validate-guild',
      fn: async ctx => {
        if (!ctx.guild || !ctx.member) throw new Error('missing guild or member');
        return { guildId: ctx.guild.id, memberId: ctx.member.id };
      },
    },
    {
      step: 'record-join-ledger',
      fn: async ctx => {
        const ledger = require('./memberLedgerService');
        ledger.recordJoin(ctx.member);
      },
    },
    {
      step: 'check-prior-history',
      condition: ctx => !!ctx.guild,
      fn: async ctx => {
        const ledger = require('./memberLedgerService');
        const history = ledger.getRecord(ctx.member.id);
        return { priorJoins: (history?.joinHistory || []).filter(x => x.type === 'join').length, priorKicks: (history?.kickHistory || []).length };
      },
    },
    {
      step: 'assign-base-role',
      condition: ctx => !!(ctx.guild && ctx.member),
      fn: async ctx => {
        const settings = require('./serverSettingsService').getSettings();
        if (!settings.serverInitialized) return { skipped: 'server-not-initialized' };
        const { ROLE_DEFAULTS } = require('../config/constants');
        const memberRoleName = settings.memberRoleName || ROLE_DEFAULTS.MEMBER;
        const role = ctx.guild.roles.cache.find(r => r.name === memberRoleName);
        if (role && !ctx.member.roles.cache.has(role.id)) {
          await ctx.member.roles.add(role, 'Member onboarding — base role').catch(() => null);
          return { assigned: role.name };
        }
        return { skipped: 'already-has-role-or-role-missing' };
      },
    },
    {
      step: 'timezone-gate-check',
      condition: ctx => {
        const settings = require('./serverSettingsService').getSettings();
        return settings.requireTimezone && settings.serverInitialized;
      },
      fn: async ctx => {
        const timezoneGate = require('./timezoneGateService');
        const profiles = require('./memberProfileService');
        const hasTimezone = !!profiles.getProfile(ctx.member.id)?.timezone;
        if (!hasTimezone) {
          await timezoneGate.postGatePrompt(ctx.member).catch(() => null);
          await timezoneGate.lockMemberToTimezoneGate(ctx.member).catch(() => null);
          return { gated: true };
        }
        return { gated: false };
      },
    },
    {
      step: 'post-welcome-message',
      condition: ctx => !!ctx.guild,
      fn: async ctx => {
        const { getCh } = require('./channels/channelResolver');
        const welcomeCh = getCh(ctx.guild, 'welcome');
        if (!welcomeCh) return { skipped: 'no-welcome-channel' };
        // Welcome message posting is handled by the guildMemberAdd handler in index.js
        // This step just validates the channel exists
        return { channelId: welcomeCh.id };
      },
    },
    {
      step: 'log-onboarding',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('member-onboarding', {
            outcome: 'success',
            memberId: ctx.member?.id,
          });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // MEMBER DEPARTURE — leave → cleanup → log → release team
  // Trigger: guildMemberRemove
  // Owner: memberLedgerService
  // ═══════════════════════════════════════════════════════════
  engine.define('member-departure', [
    {
      step: 'record-departure',
      fn: async ctx => {
        const ledger = require('./memberLedgerService');
        ledger.recordLeave(ctx.member);
        return { userId: ctx.member?.id || ctx.member?.user?.id };
      },
    },
    {
      step: 'release-team-slot',
      condition: ctx => {
        const state = require('../state');
        return Array.isArray(state.openTeamRegistry) &&
          state.openTeamRegistry.some(t => t.ownerId === (ctx.member?.id || ctx.member?.user?.id));
      },
      fn: async ctx => {
        const state = require('../state');
        const userId = ctx.member?.id || ctx.member?.user?.id;
        const teams = state.openTeamRegistry.filter(t => t.ownerId === userId);
        for (const team of teams) {
          team.ownerId = null;
          team.isOpen = true;
        }
        return { releasedTeams: teams.map(t => t.displayTeam) };
      },
    },
    {
      step: 'log-departure',
      fn: async ctx => {
        const { getCh } = require('./channels/channelResolver');
        const bootLog = getCh(ctx.guild, 'bootLog');
        if (bootLog) {
          const tag = ctx.member?.user?.tag || ctx.member?.user?.username || 'Unknown';
          await bootLog.send({ content: `📤 **${tag}** left the server.`, allowedMentions: { parse: [] } }).catch(() => null);
        }
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('member-departure', { outcome: 'success' });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // CONTENT MODERATION — scan → block → warn → escalate
  // Trigger: messageCreate (every non-bot message)
  // Owner: contentScanService
  // ═══════════════════════════════════════════════════════════
  engine.define('content-moderation', [
    {
      step: 'scan-content',
      fn: async ctx => {
        const contentScan = require('./contentScanService');
        const settings = require('./serverSettingsService').getSettings();
        if (!settings.serverInitialized) return { skipped: 'server-not-initialized' };
        const blocked = await contentScan.enforceScan(ctx.message, settings.audienceRating);
        return { blocked: !!blocked };
      },
    },
    {
      step: 'track-violation',
      condition: ctx => !!ctx._stepResults?.['scan-content']?.blocked,
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('content-moderation', {
            outcome: 'blocked',
            userId: ctx.message?.author?.id,
            channelId: ctx.message?.channel?.id,
          });
        } catch {}
      },
    },
    {
      step: 'escalate-repeat-offender',
      condition: ctx => !!ctx._stepResults?.['scan-content']?.blocked,
      fn: async ctx => {
        const escalation = require('./escalationService');
        await escalation.escalate('content-block', {
          guild: ctx.message?.guild,
          message: `Content blocked from ${ctx.message?.author?.tag || 'unknown'} in #${ctx.message?.channel?.name || 'unknown'}`,
          userId: ctx.message?.author?.id,
          channelId: ctx.message?.channel?.id,
        });
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // COMMUNITY PROVISION — create community → channels → roles → perms → selector
  // Trigger: /setup-community slash command
  // Owner: communityAccessService
  // ═══════════════════════════════════════════════════════════
  engine.define('community-provision', [
    {
      step: 'validate-inputs',
      fn: async ctx => {
        if (!ctx.guild) throw new Error('missing guild');
        if (!ctx.communityName) throw new Error('missing community name');
        return { name: ctx.communityName, type: ctx.communityType || 'general' };
      },
    },
    {
      step: 'ensure-roles',
      fn: async ctx => {
        const communityAccess = require('./communityAccessService');
        await communityAccess.ensureCommunityRoles(ctx.guild, require('./serverSettingsService').getSettings());
      },
    },
    {
      step: 'sync-permissions',
      fn: async ctx => {
        const communityAccess = require('./communityAccessService');
        await communityAccess.syncCommunityChannelPermissions(ctx.guild, require('./serverSettingsService').getSettings());
      },
    },
    {
      step: 'post-selector-panel',
      fn: async ctx => {
        const communityAccess = require('./communityAccessService');
        await communityAccess.postSelectorPanel(ctx.guild, `Community "${ctx.communityName}" provisioned.`);
      },
    },
    {
      step: 'log-provision',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('community-provision', {
            outcome: 'success',
            communityName: ctx.communityName,
          });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // SCHEDULED MAINTENANCE — self-heal + guide refresh + stale cleanup
  // Trigger: periodic timer (every 30 minutes)
  // Owner: recoverySelfHealService
  // ═══════════════════════════════════════════════════════════
  engine.define('scheduled-maintenance', [
    {
      step: 'self-heal-sweep',
      fn: async ctx => {
        const selfHeal = require('./recoverySelfHealService');
        const settings = require('./serverSettingsService').getSettings();
        if (!settings.serverInitialized) return { skipped: 'not-initialized' };
        const result = await selfHeal.runFullRecovery({
          guild: ctx.guild,
          settings,
          wizardChannel: ctx.getCh?.(ctx.guild, 'setupWizard'),
          patchNotesService: require('./patchNotesService'),
          singleMessageWizardService: require('./singleMessageWizardService'),
        });
        return result;
      },
    },
    {
      step: 'idle-guide-sweep',
      condition: ctx => !!ctx.guild,
      fn: async ctx => {
        const guideLifecycle = require('./guideLifecycleService');
        return guideLifecycle.sweepIdleGuides(ctx.guild);
      },
    },
    {
      step: 'escalate-failures',
      condition: ctx => {
        const heal = ctx._stepResults?.['self-heal-sweep'];
        return heal && heal.failedCount > 0;
      },
      fn: async ctx => {
        const escalation = require('./escalationService');
        const heal = ctx._stepResults?.['self-heal-sweep'];
        await escalation.escalate('self-heal', {
          guild: ctx.guild,
          message: `Self-heal sweep had ${heal.failedCount} failure(s)`,
          fields: [
            { name: 'Healed', value: String(heal.healedCount), inline: true },
            { name: 'Failed', value: String(heal.failedCount), inline: true },
          ],
        });
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // ROLE SYNC — audit hierarchy → reconcile → report
  // Trigger: post-build, on-demand, scheduled
  // Owner: roleHierarchySyncService
  // ═══════════════════════════════════════════════════════════
  engine.define('role-sync', [
    {
      step: 'audit-hierarchy',
      fn: async ctx => {
        const roleSync = require('./roleHierarchySyncService');
        const settings = require('./serverSettingsService').getSettings();
        return roleSync.audit(ctx.guild, settings);
      },
    },
    {
      step: 'reconcile-roles',
      condition: ctx => {
        const audit = ctx._stepResults?.['audit-hierarchy'];
        return audit && (audit.missing.length > 0 || audit.orphaned.length > 0);
      },
      fn: async ctx => {
        const roleSync = require('./roleHierarchySyncService');
        const settings = require('./serverSettingsService').getSettings();
        return roleSync.reconcile(ctx.guild, settings, { dryRun: false });
      },
    },
    {
      step: 'escalate-drift',
      condition: ctx => {
        const audit = ctx._stepResults?.['audit-hierarchy'];
        return audit && audit.orderDrift.length > 0;
      },
      fn: async ctx => {
        const escalation = require('./escalationService');
        const audit = ctx._stepResults?.['audit-hierarchy'];
        await escalation.escalate('role-sync', {
          guild: ctx.guild,
          message: `Role hierarchy drift detected: ${audit.orderDrift.length} ordering issue(s)`,
          fields: audit.orderDrift.slice(0, 5).map((d, i) => ({ name: `Drift ${i + 1}`, value: d })),
        });
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // RELEASE PUBLISH — validate → build entry → append → publish → record
  // Trigger: patch complete
  // Owner: releaseOrchestrationService
  // ═══════════════════════════════════════════════════════════
  engine.define('release-publish', [
    {
      step: 'validate-metadata',
      fn: async ctx => {
        const validation = require('./validationGateService');
        const result = validation.validateReleaseMetadata(ctx.metadata || {});
        if (!result.ok) throw new Error(`Release validation failed: ${result.failures.join(', ')}`);
        return result;
      },
    },
    {
      step: 'finalize-release',
      fn: async ctx => {
        const release = require('./releaseOrchestrationService');
        const patchNotes = require('./patchNotesService');
        return release.finalizeRelease(ctx.guild, patchNotes, ctx.metadata);
      },
    },
    {
      step: 'log-release',
      fn: async ctx => {
        try {
          require('./observabilityService').recordRelease(ctx.metadata?.version || 'unknown', { ok: true });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // SERVER BUILD — preflight → create structure → identity → commands → access → complete
  // Trigger: bot_setup_initialize button (first build only)
  // Owner: baseInitService
  // ═══════════════════════════════════════════════════════════
  engine.define('server-build', [
    {
      step: 'preflight-validation',
      fn: async ctx => {
        const validation = require('./validationGateService');
        const settings = require('./serverSettingsService').getSettings();
        const structureCheck = validation.validateTemplateDependencies(settings);
        if (!structureCheck.ok) throw new Error(`Structure configuration: ${structureCheck.failures.join(', ')}`);
        const envCheck = validation.validateEnvironment(['TOKEN', 'CLIENT_ID', 'GUILD_ID']);
        if (!envCheck.ok) throw new Error(`Environment: ${envCheck.failures.join(', ')}`);
        return { structureMode: settings.customStructureMode, template: settings.serverTemplate || null };
      },
    },
    {
      step: 'create-structure',
      fn: async ctx => {
        const baseInit = require('./baseInitService');
        const settings = require('./serverSettingsService').getSettings();
        const isEdit = require('./wizardStateService').isEditMode() || settings.serverInitialized;
        if (isEdit) {
          return baseInit.applyEditChanges(ctx.guild, ctx.state, settings.serverTemplate, ctx.buildOptions || {});
        }
        return baseInit.createTemplateStructure(ctx.guild, ctx.state, settings.serverTemplate, ctx.buildOptions || {});
      },
    },
    {
      step: 'apply-identity',
      condition: ctx => !!(ctx.client && ctx.guild),
      fn: async ctx => {
        return require('./botIdentityService').applyBotIdentity(ctx.client, ctx.guild).catch(e => ({ ok: false, error: e.message }));
      },
    },
    {
      step: 'deploy-commands',
      condition: ctx => !!ctx.state,
      fn: async ctx => {
        const { deployCommandsForCurrentState } = require('./commandRegistryService');
        await deployCommandsForCurrentState(ctx.state);
      },
    },
    {
      step: 'lock-access',
      condition: ctx => !!ctx.guild,
      fn: async ctx => {
        const botAccess = require('./botAccessService');
        const { COMM_ROLE } = require('../config/env');
        const commRole = ctx.guild.roles.cache.find(r => r.name === COMM_ROLE || r.id === COMM_ROLE);
        await botAccess.lockBotAccessGuildWide(ctx.guild, commRole?.id).catch(() => null);
      },
    },
    {
      step: 'escalate-on-failure',
      condition: ctx => ctx._errors?.length > 0,
      fn: async ctx => {
        const escalation = require('./escalationService');
        await escalation.escalate('server-build', {
          guild: ctx.guild,
          message: `Server build had ${ctx._errors.length} error(s)`,
          error: ctx._errors.map(e => `${e.step}: ${e.error}`).join('\n'),
          force: true,
        });
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // SECURITY RESPONSE — injection/probe detected → log → escalate → block
  // Trigger: member AI or commissioner AI injection detection
  // Owner: escalationService
  // ═══════════════════════════════════════════════════════════
  engine.define('security-response', [
    {
      step: 'log-event',
      fn: async ctx => {
        const security = require('./securityMiddlewareService');
        await security.auditLog({
          action: ctx.eventType || 'security-event',
          userId: ctx.userId,
          guildId: ctx.guild?.id,
          details: ctx.details || 'Security event detected',
          severity: 'critical',
        });
      },
    },
    {
      step: 'escalate-to-commissioner',
      fn: async ctx => {
        const escalation = require('./escalationService');
        await escalation.escalate(ctx.eventType || 'injection-attempt', {
          guild: ctx.guild,
          message: ctx.details || 'A security event was detected',
          userId: ctx.userId,
          channelId: ctx.channelId,
          force: true,
        });
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('security-response', {
            outcome: 'escalated',
            eventType: ctx.eventType,
            userId: ctx.userId,
          });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // ACTIVE CHECK CYCLE — post check → collect responses → warn/boot
  // Trigger: periodic timer (ACTIVE_CHECK_INTERVAL_MS)
  // Owner: leagueFeatureService
  // ═══════════════════════════════════════════════════════════
  engine.define('active-check-cycle', [
    {
      step: 'validate-guild',
      fn: async ctx => {
        if (!ctx.guild) throw new Error('missing guild');
        const settings = require('./serverSettingsService').getSettings();
        if (!settings.serverInitialized) return { skipped: 'not-initialized' };
        return { guildId: ctx.guild.id };
      },
    },
    {
      step: 'process-due-checks',
      fn: async ctx => {
        const leagueFeatures = require('./leagueFeatureService');
        const state = require('../state');
        await leagueFeatures.processDueActiveChecks(ctx.guild, state);
        return { processed: true };
      },
    },
    {
      step: 'run-inactivity-sweep',
      fn: async ctx => {
        const memberLedger = require('./memberLedgerService');
        await memberLedger.runInactivityCheck(ctx.guild);
        return { swept: true };
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('active-check-cycle', { outcome: 'success' });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // MEMBER WARNING — issue warning → log to warnings-log → check thresholds → escalate
  // Trigger: /warn-player, content moderation, active check miss
  // Owner: memberLedgerService
  // ═══════════════════════════════════════════════════════════
  engine.define('member-warning', [
    {
      step: 'validate-inputs',
      fn: async ctx => {
        if (!ctx.guild || !ctx.userId) throw new Error('missing guild or userId');
        if (!ctx.warningType) throw new Error('missing warningType');
        return { userId: ctx.userId, type: ctx.warningType, reason: ctx.reason || 'No reason specified' };
      },
    },
    {
      step: 'record-warning',
      fn: async ctx => {
        const memberLedger = require('./memberLedgerService');
        const rec = memberLedger.recordWarning(ctx.userId, ctx.warningType, ctx.reason || 'Commissioner warning');
        return { totalWarnings: rec?.warnings?.total || 0, record: rec };
      },
    },
    {
      step: 'post-to-warnings-log',
      fn: async ctx => {
        const { getCh } = require('./channels/channelResolver');
        const warnCh = getCh(ctx.guild, 'warningsLog');
        if (!warnCh) return { skipped: 'no-warnings-channel' };
        const total = ctx._stepResults?.['record-warning']?.totalWarnings || 0;
        const mention = `<@${ctx.userId}>`;
        await warnCh.send({
          embeds: [{ color: 0xe67e22, title: '⚠️ Warning Issued', description: `${mention} warned for **${ctx.warningType}**.\nReason: ${ctx.reason || 'No reason specified'}\nTotal warnings: **${total}**`, timestamp: new Date().toISOString() }],
          allowedMentions: { parse: [] },
        }).catch(() => null);
        return { posted: true };
      },
    },
    {
      step: 'check-escalation-threshold',
      condition: ctx => {
        const total = ctx._stepResults?.['record-warning']?.totalWarnings || 0;
        return total >= 3;
      },
      fn: async ctx => {
        const escalation = require('./escalationService');
        const total = ctx._stepResults?.['record-warning']?.totalWarnings || 0;
        await escalation.escalate('workflow-step', {
          guild: ctx.guild,
          message: `<@${ctx.userId}> has reached **${total}** total warnings. Review for possible boot.`,
          force: total >= 5,
        });
        return { escalated: true };
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('member-warning', {
            outcome: 'success',
            userId: ctx.userId,
            type: ctx.warningType,
          });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // MEMBER BOOT — kick/ban → release team → log to boot-log → announce
  // Trigger: /ban, auto-boot, commissioner action
  // Owner: memberLedgerService
  // ═══════════════════════════════════════════════════════════
  engine.define('member-boot', [
    {
      step: 'validate-inputs',
      fn: async ctx => {
        if (!ctx.guild || !ctx.userId) throw new Error('missing guild or userId');
        return { userId: ctx.userId, reason: ctx.reason || 'Removed from server', bootType: ctx.bootType || 'kick' };
      },
    },
    {
      step: 'record-departure',
      fn: async ctx => {
        const memberLedger = require('./memberLedgerService');
        memberLedger.recordLeave(
          { id: ctx.userId, user: { id: ctx.userId, tag: ctx.userTag || ctx.userId } },
          ctx.bootType || 'kick',
          ctx.reason || 'Removed from server',
          ctx.executorId || null
        );
        return { recorded: true };
      },
    },
    {
      step: 'release-team',
      fn: async ctx => {
        const state = require('../state');
        const teamEntry = (state.openTeamRegistry || []).find(t => String(t.ownerId) === String(ctx.userId));
        if (teamEntry) {
          teamEntry.ownerId = null;
          teamEntry.isOpen = true;
          const memberLedger = require('./memberLedgerService');
          memberLedger.recordTeamRelease(ctx.userId);
          return { released: teamEntry.displayTeam };
        }
        return { released: null };
      },
    },
    {
      step: 'post-to-boot-log',
      fn: async ctx => {
        const { getCh } = require('./channels/channelResolver');
        const bootCh = getCh(ctx.guild, 'bootLog');
        if (!bootCh) return { skipped: 'no-boot-channel' };
        const icon = ctx.bootType === 'ban' ? '🔨' : '🥾';
        const title = ctx.bootType === 'ban' ? 'Member Banned' : 'Member Kicked';
        const released = ctx._stepResults?.['release-team']?.released;
        await bootCh.send({
          embeds: [{
            color: ctx.bootType === 'ban' ? 0xff0000 : 0xff4400,
            title: `${icon} ${title}`,
            description: `**${ctx.userTag || ctx.userId}** was ${ctx.bootType === 'ban' ? 'banned' : 'kicked'}.${released ? `\n**${released}** is now open.` : ''}`,
            fields: [
              { name: 'Reason', value: ctx.reason || 'No reason specified', inline: false },
              { name: 'Actioned By', value: ctx.executorId ? `<@${ctx.executorId}>` : 'Bot/System', inline: true },
            ],
            timestamp: new Date().toISOString(),
          }],
          allowedMentions: { parse: [] },
        }).catch(() => null);
        return { posted: true };
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('member-boot', {
            outcome: 'success',
            userId: ctx.userId,
            bootType: ctx.bootType,
          });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // POLL LIFECYCLE — create → open for votes → tally (automatic via button interaction)
  // Trigger: /create-poll
  // Owner: pollService
  // ═══════════════════════════════════════════════════════════
  engine.define('poll-lifecycle', [
    {
      step: 'validate-inputs',
      fn: async ctx => {
        if (!ctx.guild) throw new Error('missing guild');
        if (!ctx.question) throw new Error('missing question');
        if (!Array.isArray(ctx.options) || ctx.options.length < 2) throw new Error('need at least 2 options');
        return { question: ctx.question, optionCount: ctx.options.length };
      },
    },
    {
      step: 'create-poll',
      fn: async ctx => {
        const pollService = require('./pollService');
        const result = await pollService.createPoll(ctx.guild, ctx.question, ctx.options);
        return { pollId: result.poll.id, channelId: result.message.channel.id, messageId: result.message.id };
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('poll-lifecycle', {
            outcome: 'created',
            pollId: ctx._stepResults?.['create-poll']?.pollId,
          });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // REWARD REFRESH — refresh all reward boards (POTW, streams, yearly, superbowl, stats)
  // Trigger: /refresh-rewards, post-game-result, periodic
  // Owner: rewardBoardService
  // ═══════════════════════════════════════════════════════════
  engine.define('reward-refresh', [
    {
      step: 'validate-guild',
      fn: async ctx => {
        if (!ctx.guild) throw new Error('missing guild');
        return { guildId: ctx.guild.id };
      },
    },
    {
      step: 'refresh-boards',
      fn: async ctx => {
        const rewardBoards = require('./rewardBoardService');
        const result = await rewardBoards.refresh(ctx.guild);
        return result || { refreshed: true };
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('reward-refresh', { outcome: 'success' });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // SCHEDULE ADVANCE — advance week → post schedule → create game channels → clear old channels
  // Trigger: /advance-week, weekly automation timer
  // Owner: scheduleRegistryService, weeklyAutomationService
  // ═══════════════════════════════════════════════════════════
  engine.define('schedule-advance', [
    {
      step: 'validate-inputs',
      fn: async ctx => {
        if (!ctx.guild) throw new Error('missing guild');
        if (!ctx.week) throw new Error('missing week number');
        return { week: ctx.week };
      },
    },
    {
      step: 'update-registry',
      fn: async ctx => {
        const scheduleRegistry = require('./scheduleRegistryService');
        if (ctx.matchups && ctx.matchups.length) {
          scheduleRegistry.upsertWeek(ctx.week, ctx.matchups, { source: ctx.source || 'advance', importedAt: Date.now() });
        }
        scheduleRegistry.loadWeekIntoState(require('../state'), ctx.week);
        return { week: ctx.week, matchups: (ctx.matchups || []).length };
      },
    },
    {
      step: 'manage-game-channels',
      condition: ctx => !!ctx.guild,
      fn: async ctx => {
        const weeklyAuto = require('./weeklyAutomationService');
        const state = require('../state');
        const settings = weeklyAuto.getWeeklySettings();
        if (!settings.autoCreateGameChannels) return { skipped: 'auto-create-disabled' };
        // V202 (BUG-001): idempotent projection — previous-week channels cleared, current week find-or-create.
        // A re-run for the same week creates and deletes nothing (was: clear-all + recreate churn).
        const result = await weeklyAuto.projectCurrentWeek(ctx.guild, state, state.players, { force: true });
        return result;
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('schedule-advance', { outcome: 'success', week: ctx.week });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // RECORD TRANSACTION — log a transaction (trade, FA, draft, etc.) to #transactions
  // Trigger: /transaction command
  // Owner: interactionRouter
  // ═══════════════════════════════════════════════════════════
  engine.define('record-transaction', [
    {
      step: 'validate-inputs',
      fn: async ctx => {
        if (!ctx.guild) throw new Error('missing guild');
        if (!ctx.transactionType) throw new Error('missing transaction type');
        if (!ctx.team) throw new Error('missing team');
        return { type: ctx.transactionType, team: ctx.team, player: ctx.player || 'Unknown' };
      },
    },
    {
      step: 'post-to-transactions',
      fn: async ctx => {
        const { getCh } = require('./channels/channelResolver');
        const txCh = getCh(ctx.guild, 'transactions');
        if (!txCh) return { skipped: 'no-transactions-channel' };
        const details = ctx.details ? `\n**Details:** ${ctx.details}` : '';
        await txCh.send({
          content: `🧾 **${ctx.transactionType.toUpperCase()}**\n**Team:** ${ctx.team}\n**Player:** ${ctx.player || 'N/A'}${details}`,
          allowedMentions: { parse: [] },
        }).catch(() => null);
        return { posted: true };
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('record-transaction', {
            outcome: 'success',
            type: ctx.transactionType,
          });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // BROADCAST — send announcement to #announcements
  // Trigger: /broadcasts command
  // Owner: broadcastsService
  // ═══════════════════════════════════════════════════════════
  engine.define('broadcast-send', [
    {
      step: 'validate-inputs',
      fn: async ctx => {
        if (!ctx.guild) throw new Error('missing guild');
        if (!ctx.content) throw new Error('missing broadcast content');
        return { content: ctx.content };
      },
    },
    {
      step: 'post-announcement',
      fn: async ctx => {
        const { getCh } = require('./channels/channelResolver');
        const annCh = getCh(ctx.guild, 'announcements');
        if (!annCh) return { skipped: 'no-announcements-channel' };
        await annCh.send({
          embeds: [{
            color: 0x5865f2,
            title: '📢 Announcement',
            description: ctx.content,
            timestamp: new Date().toISOString(),
          }],
          allowedMentions: { parse: [] },
        }).catch(() => null);
        return { posted: true };
      },
    },
    {
      step: 'record-broadcast',
      fn: async ctx => {
        const broadcasts = require('./broadcastsService');
        if (typeof broadcasts.recordBroadcast === 'function') {
          broadcasts.recordBroadcast(ctx.guild.id, ctx.content, ctx.authorId);
        }
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('broadcast-send', { outcome: 'success' });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // COMPONENT TOGGLE — enable/disable optional component → provision/deprovision channel
  // Trigger: /toggle-feature
  // Owner: componentRegistryService
  // ═══════════════════════════════════════════════════════════
  engine.define('component-toggle', [
    {
      step: 'validate-inputs',
      fn: async ctx => {
        if (!ctx.guild) throw new Error('missing guild');
        if (!ctx.componentId) throw new Error('missing componentId');
        const compReg = require('./componentRegistryService');
        const catalog = compReg.COMPONENT_CATALOG[ctx.componentId];
        if (!catalog) throw new Error(`unknown component: ${ctx.componentId}`);
        return { componentId: ctx.componentId, name: catalog.name, enable: !!ctx.enable };
      },
    },
    {
      step: 'toggle',
      fn: async ctx => {
        const compReg = require('./componentRegistryService');
        if (ctx.enable) {
          compReg.enableComponent(ctx.componentId);
          if (compReg.COMPONENT_CATALOG[ctx.componentId].channelName) {
            const ch = await compReg.ensureComponentChannel(ctx.guild, ctx.componentId);
            return { enabled: true, channelId: ch?.id || null };
          }
          return { enabled: true };
        }
        compReg.disableComponent(ctx.componentId);
        return { enabled: false };
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('component-toggle', {
            outcome: 'success',
            componentId: ctx.componentId,
            enabled: ctx.enable,
          });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // MVP VOTING — record vote → tally → update board
  // Trigger: comp_mvp:: interaction
  // Owner: componentRegistryService
  // ═══════════════════════════════════════════════════════════
  engine.define('mvp-vote', [
    {
      step: 'validate',
      fn: async ctx => {
        const compReg = require('./componentRegistryService');
        const guard = compReg.guardEnabled('mvp-voting');
        if (guard.blocked) throw new Error(guard.message);
        return { voterId: ctx.voterId, nomineeId: ctx.nomineeId, week: ctx.week };
      },
    },
    {
      step: 'record-vote',
      fn: async ctx => {
        const compReg = require('./componentRegistryService');
        compReg.recordMvpVote(ctx.week, ctx.voterId, ctx.nomineeId);
        return { recorded: true };
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('mvp-vote', { outcome: 'recorded', week: ctx.week });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // AVAILABILITY UPDATE — record status → update board embed
  // Trigger: comp_avail:: interaction
  // Owner: componentRegistryService
  // ═══════════════════════════════════════════════════════════
  engine.define('availability-update', [
    {
      step: 'validate',
      fn: async ctx => {
        const compReg = require('./componentRegistryService');
        const guard = compReg.guardEnabled('availability');
        if (guard.blocked) throw new Error(guard.message);
        return { userId: ctx.userId, status: ctx.status, week: ctx.week };
      },
    },
    {
      step: 'record',
      fn: async ctx => {
        const compReg = require('./componentRegistryService');
        compReg.recordAvailability(ctx.userId, ctx.week, ctx.status);
        return { recorded: true };
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('availability-update', { outcome: 'recorded' });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // GAME RESULT SUBMISSION — validate → record → post to #game-results → refresh rewards
  // Trigger: comp_game_result_modal interaction
  // Owner: componentRegistryService
  // ═══════════════════════════════════════════════════════════
  engine.define('game-result-submission', [
    {
      step: 'validate',
      fn: async ctx => {
        const compReg = require('./componentRegistryService');
        const guard = compReg.guardEnabled('game-results');
        if (guard.blocked) throw new Error(guard.message);
        if (!ctx.result) throw new Error('missing result data');
        return ctx.result;
      },
    },
    {
      step: 'record',
      fn: async ctx => {
        // V202 (BUG-006): canonical owner. Records the componentRegistry projection for source 'component-modal'.
        const gameResultService = require('../league/gameResultService');
        const r = ctx.result || {};
        const submitted = await gameResultService.submitGameResult({
          homeTeam: r.yourTeam || r.homeTeam, awayTeam: r.oppTeam || r.awayTeam,
          homeScore: r.yourScore ?? r.homeScore, awayScore: r.oppScore ?? r.awayScore,
          week: r.week, source: 'component-modal', submittedBy: ctx.submitterId,
        }, { state: require('../state'), guild: ctx.guild });
        if (!submitted.ok) throw new Error(submitted.reason);
        return { recorded: true, deduped: submitted.deduped, superseded: submitted.superseded, standingsUpdated: submitted.standings.updated };
      },
    },
    {
      step: 'refresh-rewards',
      condition: ctx => {
        const compReg = require('./componentRegistryService');
        return compReg.isEnabled('rewards');
      },
      fn: async ctx => {
        const rewardBoards = require('./rewardBoardService');
        await rewardBoards.refresh(ctx.guild).catch(() => null);
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('game-result-submission', { outcome: 'success' });
        } catch {}
      },
    },
  ]);

  // ═══════════════════════════════════════════════════════════
  // PREDICTION SCORING — score predictions → post leaderboard
  // Trigger: week advance (schedule-advance flow can chain into this)
  // Owner: componentRegistryService
  // ═══════════════════════════════════════════════════════════
  engine.define('prediction-scoring', [
    {
      step: 'validate',
      fn: async ctx => {
        const compReg = require('./componentRegistryService');
        const guard = compReg.guardEnabled('predictions');
        if (guard.blocked) throw new Error(guard.message);
        if (!ctx.week || !ctx.actualResults) throw new Error('missing week or results');
        return { week: ctx.week };
      },
    },
    {
      step: 'score',
      fn: async ctx => {
        const compReg = require('./componentRegistryService');
        const leaderboard = compReg.scorePredictions(ctx.week, ctx.actualResults);
        return { leaderboard, topCount: leaderboard.length };
      },
    },
    {
      step: 'observability',
      fn: async ctx => {
        try {
          require('./observabilityService').recordFlowOutcome('prediction-scoring', { outcome: 'scored', week: ctx.week });
        } catch {}
      },
    },
  ]);

  log.info(`Registered ${engine.listWorkflows().length} workflow definitions`);
}

module.exports = { registerAll };
