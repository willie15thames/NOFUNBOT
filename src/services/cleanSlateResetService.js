/* True clean-slate reset for one Discord guild. */
'use strict';
const { saveJson } = require('../storage/jsonStore');
const { prismaSafe } = require('../storage/prisma');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('cleanSlateReset');

function jsonLeagueIdsForGuild(guildId) {
  const gid = String(guildId || '');
  try {
    return require('./activeLeagueService').listActiveLeagues()
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
  summary.activeLeagues = require('./activeLeagueService').clearGuild(guildId, { includeLegacyUnscoped: true });
  await require('./managedSpaceService').clearGuild(guildId); summary.managedSpaces = true;
  await require('./lifetimeHistoryService').clearGuild(guildId); summary.lifetimeHistory = true;
  try { require('./memberLedgerService').resetAll(); summary.memberLedger = true; } catch { summary.memberLedger = false; }
  try { require('./memberProfileService').resetAll(); summary.memberProfiles = true; } catch { summary.memberProfiles = false; }
  try { require('./serverSettingsService').resetInstallationDefaults(); summary.serverSettings = true; } catch { summary.serverSettings = false; }
  try { require('./serverRulesService').resetProfile(); summary.serverRules = true; } catch { summary.serverRules = false; }
  try { require('./wizardPreferencesService').resetPrefs(); summary.wizardPrefs = true; } catch { summary.wizardPrefs = false; }
  try { require('./wizardStateService').resetState({ installationMode: true, currentStep: 'mode' }); summary.wizardState = true; } catch { summary.wizardState = false; }

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
    'scheduleStateRuntime.json': {},
    'spaceState.json': {},
  })) {
    try { saveJson(file, value); } catch {}
  }

  summary.database = await resetDatabaseGuild(guildId, knownLeagueIds);
  return summary;
}

module.exports = { resetGuild, resetDatabaseGuild, jsonLeagueIdsForGuild };
