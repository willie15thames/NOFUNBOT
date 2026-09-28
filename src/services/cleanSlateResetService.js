/* True clean-slate reset for one Discord guild. */
'use strict';
const { saveJson } = require('../storage/jsonStore');
const { prismaSafe } = require('../storage/prisma');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('cleanSlateReset');

function jsonLeagueIdsForGuild(guildId) {
  const gid = String(guildId || '');
  try {
    return require('./activeLeagueService').listLeagueRecords()
      .filter(row => String(row?.guildId || '') === gid || !row?.guildId)
      .map(row => String(row.id || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function resetDatabaseGuild(guildId, extraLeagueIds = []) {
  const gid = String(guildId);
  return prismaSafe(async prisma => {
    // Operational incident telemetry and the currently-running initialize background job
    // intentionally survive this reset. User-facing state/history does not.
    const safe = async (model, where = { guildId: gid }) => {
      try {
        if (prisma[model]?.deleteMany) return await prisma[model].deleteMany({ where });
      } catch (e) {
        log.warn(`DB reset ${model}: ${e.message}`);
      }
      return null;
    };

    // Capture every league id owned by this guild before Community cascades delete them.
    const leagueIds = new Set((extraLeagueIds || []).map(String).filter(Boolean));
    try {
      const rows = await prisma.league.findMany({
        where: { community: { guildId: gid } },
        select: { id: true },
      });
      for (const row of rows || []) if (row?.id) leagueIds.add(String(row.id));
    } catch (e) {
      log.warn(`DB reset league discovery: ${e.message}`);
    }

    // Provider control-plane tables intentionally have no guildId. Clear them using
    // the league ids that belong to this guild, including legacy JSON-backed ids.
    if (leagueIds.size) {
      const where = { leagueId: { in: [...leagueIds] } };
      await safe('providerImportReceipt', where);
      await safe('providerSyncRun', where);
      await safe('providerConnection', where);
    }

    // Clear guild-owned user-facing persistence. Avoid GuildLock and BackgroundJob so
    // the reset command can safely finish its own transaction/job lifecycle.
    for (const model of [
      'memberProfile', 'memberLedger', 'featureFlag', 'streamCredit', 'offenseCooldown',
      'pendingOffense', 'channelTopology', 'guideState', 'wizardState', 'roleMapping',
      'event', 'auditLog',
    ]) await safe(model);

    // Community cascades leagues, teams, schedules and user-community membership.
    await safe('community');
    await safe('user');

    // Do NOT delete ServerConfig. BackgroundJob has an onDelete Cascade relation to it,
    // so deleting the row would erase the currently-running initialize job. Instead,
    // atomically restore installation defaults in place.
    const defaults = {
      template: null,
      subtemplate: null,
      theme: null,
      timezoneGateEnabled: false,
      setupComplete: false,
      botStatus: 'active',
      audienceRating: 'pg13',
      filterMode: 'strict',
      toneProfile: null,
      memberToneProfile: null,
      commToneProfile: null,
      botName: 'myBot',
      allowGifReplies: true,
      requireTimezone: false,
      serverInitialized: false,
      useSharedToneProfile: false,
      setupCompletedAt: null,
      botAvatarMode: null,
      botAvatarUrl: null,
      botAvatarEmoji: null,
      serverTemplate: null,
      serverSubtemplate: null,
      customStructureMode: null,
      customArrangementMode: 'auto',
      customCatalogSelections: [],
      customTemplateSelections: [],
      customSubtemplateSelections: [],
      toneVisibility: 'public',
      ageWarningEnabled: true,
      payload: null,
    };
    try {
      await prisma.serverConfig.upsert({
        where: { guildId: gid },
        update: defaults,
        create: { guildId: gid, ...defaults },
      });
    } catch (e) {
      log.warn(`DB reset serverConfig: ${e.message}`);
    }
    return true;
  }, false);
}

async function resetGuild(guildId, state) {
  const summary = {};
  // Capture legacy/non-Prisma ids before removing the JSON registry.
  const knownLeagueIds = jsonLeagueIdsForGuild(guildId);

  summary.directConversation = require('./conversationContextService').clearGuild(guildId);
  summary.ambientConversation = require('./ambientConversationService').clearGuild(guildId);
  summary.mediaContext = require('./mediaContextService').clearGuild(guildId);
  summary.componentSessions = require('./componentSessionService').clearGuild(guildId);
  summary.activeLeagues = require('./activeLeagueService').clearGuild(guildId, { includeLegacyUnscoped: true });
  await require('./managedSpaceService').clearGuild(guildId); summary.managedSpaces = true;
  await require('./lifetimeHistoryService').clearGuild(guildId); summary.lifetimeHistory = true;
  const resetFailures = [];
  const criticalReset = (name, fn) => {
    try { fn(); summary[name] = true; }
    catch (err) { summary[name] = false; resetFailures.push({ name, error:String(err?.message || err) }); }
  };
  criticalReset('memberLedger', () => require('./memberLedgerService').resetAll());
  criticalReset('memberProfiles', () => require('./memberProfileService').resetAll());
  criticalReset('serverSettings', () => require('./serverSettingsService').resetInstallationDefaults());
  criticalReset('serverRules', () => require('./serverRulesService').resetProfile());
  criticalReset('wizardPrefs', () => require('./wizardPreferencesService').resetPrefs());
  criticalReset('wizardState', () => require('./wizardStateService').resetState({ installationMode: true, currentStep: 'mode' }));

  // Clear remaining file-backed bot memory that can resurrect old setup/league decisions.
  for (const [file, value] of Object.entries({
    'componentRegistry.json': {},
    'templateBuildManifest.json': {},
    'leagueFeatures.json': {},
    'onboardingAutomation.json': {},
    'hubWeeklyData.json': {},
    'rewardHistory.json': {},
    'trashTalkBank.json': {},
    'pendingAttrBoosts.json': {},
    'pendingOffenses.json': {},
    'pendingTrades.json': {},
    'polls.json': { polls:{} },
    'communities.json': {},
    'waitlist.json': {},
    'suggestions.json': {},
    'scheduleStateRuntime.json': {},
    'spaceState.json': {},
  })) {
    try { saveJson(file, value); } catch (err) { resetFailures.push({ name:`file:${file}`, error:String(err?.message || err) }); }
  }

  summary.database = await resetDatabaseGuild(guildId, knownLeagueIds);
  if (!summary.database) resetFailures.push({ name:'database', error:'database reset did not confirm success' });
  if (resetFailures.length) {
    const err = new Error(`Clean-slate reset incomplete: ${resetFailures.map(x => x.name).join(', ')}`);
    err.code = 'CLEAN_SLATE_INCOMPLETE';
    err.failures = resetFailures;
    throw err;
  }
  return summary;
}

module.exports = { resetGuild, resetDatabaseGuild, jsonLeagueIdsForGuild };
