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
      if (!prisma[model]?.deleteMany) throw new Error(`DB reset model unavailable: ${model}`);
      return prisma[model].deleteMany({ where });
    };

    // Capture every league id owned by this guild before Community cascades delete them.
    const leagueIds = new Set((extraLeagueIds || []).map(String).filter(Boolean));
    try {
      const rows = await prisma.league.findMany({
        where: { community: { guildId: gid } },
        select: { id: true },
      });
      for (const row of rows || []) if (row?.id) leagueIds.add(String(row.id));
    } catch (e) { throw new Error(`DB reset league discovery failed: ${e.message}`); }

    // Provider control-plane tables intentionally have no guildId. Clear them using
    // the league ids that belong to this guild, including legacy JSON-backed ids.
    if (leagueIds.size) {
      const where = { leagueId: { in: [...leagueIds] } };
      await safe('providerImportReceipt', where);
      await safe('providerSyncRun', where);
      await safe('providerConnection', where);
    }
    // Old critical-store journals are keyed by guild/league rather than a
    // relational guildId column. They must not survive a clean slate and later
    // replay an active removal or community deletion into a fresh build.
    for (const prefix of [`v204:active-removals:${gid}:`, `v204:community-delete:${gid}:`]) {
      await prisma.botKv.deleteMany({ where:{ key:{ startsWith:prefix } } });
    }

    // These domain tables carry guild IDs but have no cascade path from
    // Community. Clear dependent records first or they can hydrate after reset.
    const claims = await prisma.progressionClaim.findMany({where:{guildId:gid},select:{id:true}});
    const grants = await prisma.progressionGrant.findMany({where:{guildId:gid},select:{id:true}});
    const brackets = await prisma.postseasonBracket.findMany({where:{guildId:gid},select:{id:true}});
    if (claims.length || grants.length) await safe('entitlementConsumption', {OR:[
      {claimId:{in:claims.map(x=>x.id)}}, {grantId:{in:grants.map(x=>x.id)}}
    ]});
    if (brackets.length) await safe('postseasonMatch', {bracketId:{in:brackets.map(x=>x.id)}});
    for (const model of [
      'playerMutation','progressionClaim','progressionWallet','progressionGrant',
      'tierAssignment','progressionPolicyVersion','membershipTenure','providerTeamMapping',
      'postseasonBracket','season','operationFence',
    ]) await safe(model);

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
      botName: 'CommishAI',
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
    } catch (e) { throw new Error(`DB reset serverConfig failed: ${e.message}`); }
    return true;
  }, false);
}

async function resetGuild(guildId, state) {
  const summary = {};
  // Capture legacy/non-Prisma ids before removing the JSON registry.
  const knownLeagueIds = jsonLeagueIdsForGuild(guildId);
  const scheduler = require('./schedulerRegistryService');
  for (const job of scheduler.list(guildId)) scheduler.cancel(job.key, guildId);
  summary.cancelledTimers = true;

  summary.directConversation = require('./conversationContextService').clearGuild(guildId);
  summary.ambientConversation = require('./ambientConversationService').clearGuild(guildId);
  summary.mediaContext = require('./mediaContextService').clearGuild(guildId);
  summary.componentSessions = require('./componentSessionService').clearGuild(guildId);
  summary.gameSessions = require('../league/gameSessionService').clearGuild(guildId, knownLeagueIds);
  summary.activeLeagues = require('./activeLeagueService').clearGuild(guildId, { includeLegacyUnscoped: true });
  await require('./managedSpaceService').clearGuild(guildId); summary.managedSpaces = true;
  await require('./lifetimeHistoryService').clearGuild(guildId); summary.lifetimeHistory = true;
  // These are the authoritative records used by startup recovery. Clearing
  // only JSON projections would let old owners and access hydrate back in.
  const critical = require('../storage/criticalStore');
  await critical.clear(`v204:assignments:${guildId}`);
  await critical.clear(`v204:memberships:${guildId}`);
  for (const leagueId of knownLeagueIds) await critical.clear(`v204:active-removals:${guildId}:${leagueId}`);
  summary.criticalMembershipAndAssignments = true;
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

  try {
    summary.leagueSpaceFiles = await require('../storage/jsonStore').clearLeagueSpaces(knownLeagueIds);
    await require('../storage/jsonStore').flushAllWrites();
  } catch (err) { resetFailures.push({ name:'durable-state', error:String(err?.message || err) }); }

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
