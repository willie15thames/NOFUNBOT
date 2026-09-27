/*
 * NAVIGATION HEADER
 * FILE: src/league/advanceEngine.js
 * LAYER: League control plane (V202, spec §11–§13, audit §21)
 * PURPOSE: The ONE authority for league week advancement. Durable state machine over league/runtimeService:
 *          WEEK_ACTIVE → DEADLINE_APPROACHING → PRE_ADVANCE_CHECK → READY_TO_ADVANCE →
 *          (REQUESTING_GAME_ADVANCE only if the provider has an authorized advanceWeek capability) →
 *          AWAITING_SOURCE_ADVANCE → SOURCE_ADVANCED → IMPORT_PENDING → IMPORT_COMPLETE → VALIDATING_NEW_WEEK →
 *          PUBLISHING_NEW_WEEK → WEEK_ACTIVE.  Failures → RETRY_WAIT / HOLD / RECOVERY_REQUIRED.
 * RULES ENFORCED HERE:
 *   - Timer expiry is never treated as proof that Madden advanced (rule 21). Only a provider read-back of a new
 *     source week (or, for the manual 'local' provider, an explicit commissioner attestation labelled as such)
 *     moves the engine to SOURCE_ADVANCED.
 *   - Workflow week and source week are separate fields (rule 22).
 *   - A week is published only after import + validation pass (rule 23), and Discord projection happens only
 *     after the durable commit (rule 27). A Discord failure never rolls back committed league state.
 *   - League-specific lock around every tick (rule 24); idempotent cycleId for provider control (rule 25).
 *   - Unsupported provider control returns AWAITING_SOURCE_ADVANCE, never a fake advance (rule 26/47).
 *   - Shadow mode records what it WOULD do and performs no advance/publish (spec §31).
 * LOOK HERE FIRST WHEN DEBUGGING: tick(), _step(), runPrechecks(), getStatus().
 * RELATED FLOW: services/leagueAutomationService (wake-up timer owner), /game-channels advance-* subcommands,
 *               actions catalog request_league_advance, providers/gameProvider, weeklyAutomationService (projection).
 */

'use strict';

const runtime = require('./runtimeService');
const policyService = require('./automationPolicyService');
const { validateWeekGames } = require('./validationService');
const { makeLogger } = require('../utils/logger');

const log = makeLogger('advanceEngine');
const S = runtime.ADVANCE_STATE;
const MAX_STEPS_PER_TICK = 14;
const LOCK_TTL_MS = 10 * 60 * 1000;
const AWAITING_REMINDER_MS = 12 * 60 * 60 * 1000;
const _inFlight = new Set(); // single-flight per league (process-local); cross-instance safety via _acquireLock

function _providers() { return require('../providers/gameProvider'); }
function _leagueId(state) { return String(require('./spaceContext').current() || state?.leagueConfig?.leagueId || state?.leagueConfig?.leagueName || 'default'); }
function _lockKey(state) { return `league-advance:${_leagueId(state).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'default'}`; }

async function _acquireLock(guild, state) {
  const guildLock = require('../services/guildLockService');
  const ok = await guildLock.acquire(guild?.id || 'global', _lockKey(state), 'advance-engine', LOCK_TTL_MS);
  if (!ok) return false;
  // Cross-instance: when REDIS_URL is configured eventClaimService.claim is a Redis SET NX; otherwise local.
  try {
    const claims = require('../services/eventClaimService');
    const claimed = await claims.claim(`${guild?.id || 'global'}:${_lockKey(state)}`, LOCK_TTL_MS);
    if (!claimed) { await guildLock.release(guild?.id || 'global', _lockKey(state)); return false; }
  } catch (e) { log.warn(`distributed claim unavailable (${e.message}) — local lock only`); }
  return true;
}

async function _releaseLock(guild, state) {
  try { await require('../services/guildLockService').release(guild?.id || 'global', _lockKey(state)); } catch {}
  try { await require('../services/eventClaimService').release(`${guild?.id || 'global'}:${_lockKey(state)}`); } catch {}
}

async function _notify(guild, text, opts = {}) {
  if (!guild) return { ok: false, reason: 'no-guild' };
  try {
    const { getCh } = require('../services/channels/channelResolver');
    const policy = policyService.getPolicy();
    const ch = getCh(guild, policy.notifyChannelKey || 'commishHub') || getCh(guild, 'adminHq') || getCh(guild, 'commishHub');
    if (!ch) { log.warn(`notify skipped (no staff channel): ${text.slice(0, 120)}`); return { ok: false, reason: 'no-channel' }; }
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder().setColor(opts.color || 0x3498db).setTitle(opts.title || '🗓 League Advance').setDescription(String(text).slice(0, 4000)).setTimestamp();
    return await require('../services/sendMessageService').send(ch, { embeds: [embed], allowedMentions: { parse: [] } }, { action: `advance-${opts.kind || 'notice'}` });
  } catch (e) { log.warn(`notify failed: ${e.message}`); return { ok: false, reason: e.message }; }
}

function _nextDeadline(from = Date.now()) {
  return from + policyService.getPolicy().intervalHours * 60 * 60 * 1000;
}

function _newCycleId(rt) {
  return `${_leagueIdFromRt(rt)}:src${rt.sourceWeek ?? rt.workflowWeek ?? 'x'}:${Date.now().toString(36)}`;
}
function _leagueIdFromRt(rt) { return String(rt.leagueId || 'default'); }

async function _readSourceWeek(provider) {
  const r = await provider.getCurrentWeek({});
  if (!r || !r.ok) return { ok: false, reason: r?.reason || 'provider-read-failed', detail: r };
  if (r.week == null || !Number.isFinite(Number(r.week))) return { ok: false, reason: 'provider-week-unknown', detail: r };
  return { ok: true, week: Number(r.week), revision: r.revision || null };
}

function _activeGameBlockers(state) {
  let playing = [];
  try { playing = require('../services/gameChannelService').getActivelyPlayingChannelIds(); } catch {}
  return playing.map(id => {
    const g = state?.games?.get?.(id);
    return g ? `${g.team1} vs ${g.team2} (Week ${g.week}) is in progress` : `game channel ${id} is in progress`;
  });
}

function _missingResults(state, week) {
  const matchups = Array.isArray(state?.scheduleState?.matchups) ? state.scheduleState.matchups : [];
  if (!matchups.length) return [];
  const results = require('./gameResultService').listResults(week);
  const { normalizeTeam } = require('./canonicalModel');
  const have = new Set(results.map(r => [normalizeTeam(r.homeTeam), normalizeTeam(r.awayTeam)].sort().join('|')));
  return matchups
    .filter(m => !/\b(cpu|bye)\b/i.test(`${m.team1} ${m.team2}`))
    .filter(m => !have.has([normalizeTeam(m.team1), normalizeTeam(m.team2)].sort().join('|')))
    .map(m => `${m.team1} vs ${m.team2} has no recorded result`);
}

/**
 * Deterministic prechecks. Returns { ok, blockers[], retryable, sourceWeek, provider }.
 * A blocker → HOLD (commissioner-visible). A retryable read failure → RETRY_WAIT.
 */
async function runPrechecks(guild, state) {
  const rt = runtime.getRuntime();
  const policy = policyService.getPolicy();
  const provider = _providers().resolveActive();
  const blockers = [];
  if (rt.hold) blockers.push(`commissioner hold active: ${rt.hold.reason || 'no reason given'}`);
  if (rt.workflowWeek == null && state?.scheduleState?.week == null) blockers.push('no current workflow week is loaded (use /advance-week or /schedule-load-week first)');
  if (policy.precheckPolicy.requireProviderHealthy) {
    const health = await provider.healthCheck();
    if (!health?.ok) blockers.push(`provider ${provider.key} unhealthy: ${health?.reason || 'unknown'}${health?.missing ? ` (missing ${health.missing.join(', ')})` : ''}`);
  }
  if (policy.precheckPolicy.blockOnActiveGame) blockers.push(..._activeGameBlockers(state));
  const workflowWeek = rt.workflowWeek ?? Number(state?.scheduleState?.week);
  if (policy.precheckPolicy.requireAllGamesFinal && Number.isFinite(workflowWeek)) blockers.push(..._missingResults(state, workflowWeek));
  const src = await _readSourceWeek(provider);
  const retryable = !src.ok && !blockers.length;
  return { ok: blockers.length === 0 && src.ok, blockers, retryable, sourceWeek: src.ok ? src.week : null, sourceRevision: src.ok ? src.revision : null, sourceError: src.ok ? null : src.reason, provider, workflowWeek };
}

function _retryOrRecover(rt, reason, stayState) {
  const policy = policyService.getPolicy();
  const retryCount = Number(rt.retryCount || 0) + 1;
  if (retryCount > policy.exceptionPolicy.maxRetries) {
    runtime.transition(S.RECOVERY_REQUIRED, { lastError: `${reason} (retries exhausted)`, retryCount });
    return { waiting: true, alert: `⛔ Advance needs recovery: **${reason}** after ${retryCount - 1} retries. Fix the cause, then run \`/game-channels advance-resume\`.` };
  }
  const nextRetryAt = Date.now() + policy.exceptionPolicy.retryBackoffMinutes * 60 * 1000 * Math.min(retryCount, 4);
  const saved = runtime.transition(S.RETRY_WAIT, { lastError: reason, retryCount, nextRetryAt });
  if (saved.ok && stayState) runtime.patchRuntime({ resumeState: stayState });
  return { waiting: true };
}

/** One state-machine step. Returns { waiting:boolean, alert?:string, info?:string }. */
async function _step(guild, state, ctx) {
  const rt = runtime.getRuntime();
  const policy = policyService.getPolicy();
  const now = Date.now();
  switch (rt.state) {
    case S.IDLE: {
      const week = rt.workflowWeek ?? (state?.scheduleState?.week != null ? Number(state.scheduleState.week) : null);
      if (week == null) return { waiting: true };
      runtime.transition(S.WEEK_ACTIVE, { workflowWeek: week, leagueId: _leagueId(state), nextAdvanceAt: rt.nextAdvanceAt || _nextDeadline(now), deadlineArmedAt: now });
      return { waiting: false };
    }
    case S.WEEK_ACTIVE:
    case S.DEADLINE_APPROACHING: {
      if (ctx.manual) { runtime.transition(S.PRE_ADVANCE_CHECK, { manualRequestedBy: ctx.actor || null }); return { waiting: false }; }
      if (!policy.enabled) return { waiting: true };
      if (!rt.nextAdvanceAt) { runtime.patchRuntime({ nextAdvanceAt: _nextDeadline(now), deadlineArmedAt: now }); return { waiting: true }; }
      if (now >= rt.nextAdvanceAt) { runtime.transition(S.PRE_ADVANCE_CHECK, {}); return { waiting: false }; }
      const windowMs = policy.precheckPolicy.approachingWindowHours * 60 * 60 * 1000;
      if (rt.state === S.WEEK_ACTIVE && rt.nextAdvanceAt - now <= windowMs) {
        runtime.transition(S.DEADLINE_APPROACHING, {});
        return { waiting: true, info: `⏳ Week **${rt.workflowWeek ?? '?'}** advance deadline <t:${Math.floor(rt.nextAdvanceAt / 1000)}:R>. Finish remaining games.` };
      }
      return { waiting: true };
    }
    case S.PRE_ADVANCE_CHECK: {
      const pre = await runPrechecks(guild, state);
      if (pre.blockers.length) {
        runtime.transition(S.HOLD, { hold: { reason: pre.blockers.join('; '), by: 'precheck', at: now }, lastError: null });
        return { waiting: true, alert: `⏸ Advance **held** for Week ${pre.workflowWeek ?? '?'}:\n• ${pre.blockers.join('\n• ')}\nResolve, then \`/game-channels advance-resume\`.` };
      }
      if (!pre.ok) return _retryOrRecover(rt, `source week unreadable: ${pre.sourceError}`, S.PRE_ADVANCE_CHECK);
      const workflowWeek = pre.workflowWeek;
      if (policy.shadowMode && !(ctx.manual || rt.manualRequestedBy)) {
        const decision = { at: now, workflowWeek, sourceWeek: pre.sourceWeek, provider: pre.provider.key, path: pre.provider.getCapabilities().advanceWeek ? 'REQUESTING_GAME_ADVANCE' : 'AWAITING_SOURCE_ADVANCE' };
        runtime.transition(S.WEEK_ACTIVE, { lastShadowDecision: decision, nextAdvanceAt: _nextDeadline(now), deadlineArmedAt: now, retryCount: 0, manualRequestedBy: null });
        return { waiting: true, info: `🧪 Shadow mode: at this deadline the engine WOULD have entered **${decision.path}** (provider ${decision.provider}, source week ${decision.sourceWeek}, workflow week ${workflowWeek}). No advance or publish was performed.` };
      }
      if (Number.isFinite(workflowWeek) && pre.sourceWeek > workflowWeek) {
        // Source already advanced (e.g. commissioner advanced natively early) — verified by provider read-back.
        runtime.transition(S.READY_TO_ADVANCE, { cycleId: _newCycleId(rt), expectedSourceWeek: workflowWeek, sourceRevision: pre.sourceRevision, retryCount: 0 });
        runtime.transition(S.SOURCE_ADVANCED, { sourceWeek: pre.sourceWeek, targetWeek: pre.sourceWeek, lastVerifiedAt: now, sourceVerification: `provider:${pre.provider.key}` });
        return { waiting: false };
      }
      runtime.transition(S.READY_TO_ADVANCE, { cycleId: _newCycleId(rt), expectedSourceWeek: pre.sourceWeek, sourceWeek: pre.sourceWeek, sourceRevision: pre.sourceRevision, retryCount: 0, providerId: rt.providerId || null });
      return { waiting: false };
    }
    case S.READY_TO_ADVANCE: {
      const provider = _providers().resolveActive();
      if (provider.getCapabilities().advanceWeek) { runtime.transition(S.REQUESTING_GAME_ADVANCE, {}); return { waiting: false }; }
      runtime.transition(S.AWAITING_SOURCE_ADVANCE, { awaitingSince: now, lastAwaitReminderAt: now });
      return { waiting: true, alert: _nativeActionText(provider, rt) };
    }
    case S.REQUESTING_GAME_ADVANCE: {
      const provider = _providers().resolveActive();
      if (rt.controlRequestedFor !== rt.cycleId) {
        runtime.patchRuntime({ controlRequestedFor: rt.cycleId, controlRequestedAt: now }); // idempotency record BEFORE the call
        const r = await provider.advanceWeek({ cycleId: rt.cycleId, expectedSourceWeek: rt.expectedSourceWeek });
        if (!r?.ok && r?.reason === 'unsupported-capability') {
          runtime.transition(S.AWAITING_SOURCE_ADVANCE, { awaitingSince: now, lastAwaitReminderAt: now });
          return { waiting: true, alert: _nativeActionText(provider, rt) };
        }
        if (!r?.ok) { runtime.patchRuntime({ controlRequestedFor: null }); return _retryOrRecover(rt, `provider control failed: ${r?.reason || 'unknown'}`, S.REQUESTING_GAME_ADVANCE); }
      }
      // A successful control request is NOT proof. Verify by read-back.
      runtime.transition(S.AWAITING_SOURCE_ADVANCE, { awaitingSince: rt.awaitingSince || now, lastAwaitReminderAt: now });
      return { waiting: false };
    }
    case S.AWAITING_SOURCE_ADVANCE: {
      const provider = _providers().resolveActive();
      if (ctx.attestedSourceWeek != null) {
        if (provider.key !== 'local') return { waiting: true, alert: `⚠️ Source-week attestation is only accepted for the manual 'local' provider. Provider **${provider.key}** must report the new week itself.` };
        const w = Number(ctx.attestedSourceWeek);
        if (!Number.isInteger(w) || w <= Number(rt.expectedSourceWeek)) return { waiting: true, alert: `⚠️ Attested week must be greater than ${rt.expectedSourceWeek}.` };
        runtime.transition(S.SOURCE_ADVANCED, { sourceWeek: w, targetWeek: w, lastVerifiedAt: now, sourceVerification: `commissioner-attested:${ctx.actor || 'unknown'}` });
        return { waiting: false };
      }
      const src = await _readSourceWeek(provider);
      if (src.ok && src.week > Number(rt.expectedSourceWeek)) {
        runtime.transition(S.SOURCE_ADVANCED, { sourceWeek: src.week, targetWeek: src.week, sourceRevision: src.revision, lastVerifiedAt: now, sourceVerification: `provider:${provider.key}` });
        return { waiting: false };
      }
      if (now - Number(rt.lastAwaitReminderAt || 0) >= AWAITING_REMINDER_MS) {
        runtime.patchRuntime({ lastAwaitReminderAt: now });
        return { waiting: true, alert: _nativeActionText(provider, rt, true) };
      }
      return { waiting: true };
    }
    case S.SOURCE_ADVANCED: {
      runtime.transition(S.IMPORT_PENDING, { importStartedAt: now });
      return { waiting: false };
    }
    case S.IMPORT_PENDING: {
      const provider = _providers().resolveActive();
      const r = await provider.fetchWeek({}, rt.targetWeek);
      if (!r?.ok || !Array.isArray(r.games) || !r.games.length) {
        const res = _retryOrRecover(rt, `import incomplete for Week ${rt.targetWeek}: ${r?.reason || 'no games'}`, S.IMPORT_PENDING);
        if (!res.alert && provider.key === 'local' && Number(rt.retryCount || 0) === 0) res.alert = `📥 Source is at Week **${rt.targetWeek}** but no Week ${rt.targetWeek} schedule is imported. Use \`/schedule-import\` (or \`/advance-week\`) for Week ${rt.targetWeek}.`;
        return res;
      }
      runtime.transition(S.IMPORT_COMPLETE, { pendingGames: r.games, importRevision: r.revision || null, lastImportAt: now, retryCount: 0 });
      return { waiting: false };
    }
    case S.IMPORT_COMPLETE: {
      runtime.transition(S.VALIDATING_NEW_WEEK, {});
      return { waiting: false };
    }
    case S.VALIDATING_NEW_WEEK: {
      const known = (state?.openTeamRegistry || []).flatMap(t => [t.baseTeam, t.displayTeam]).filter(Boolean);
      const v = validateWeekGames(Number(rt.targetWeek), rt.pendingGames || [], { knownTeams: known.length ? known : null, leagueId: rt.leagueId });
      if (!v.ok) {
        runtime.transition(S.RECOVERY_REQUIRED, { lastError: `validation failed: ${v.errors.slice(0, 6).join(', ')}` });
        return { waiting: true, alert: `⛔ Week **${rt.targetWeek}** import failed validation — not published.\n• ${v.errors.slice(0, 10).join('\n• ')}\nFix the import, then \`/game-channels advance-resume\`.` };
      }
      runtime.transition(S.PUBLISHING_NEW_WEEK, { validationWarnings: v.warnings.slice(0, 20) });
      return { waiting: false };
    }
    case S.PUBLISHING_NEW_WEEK:
      return _publish(guild, state, rt);
    case S.RETRY_WAIT: {
      if (now >= Number(rt.nextRetryAt || 0)) { runtime.resumeFromPause({ nextRetryAt: null }); return { waiting: false }; }
      return { waiting: true };
    }
    case S.HOLD:
    case S.RECOVERY_REQUIRED:
    default:
      return { waiting: true };
  }
}

function _nativeActionText(provider, rt, reminder = false) {
  const next = Number(rt.expectedSourceWeek ?? rt.workflowWeek ?? 0) + 1;
  const how = provider.key === 'local'
    ? `Advance the franchise in Madden (Companion App → Franchise → Advance Week), then import Week ${next} with \`/schedule-import\` or \`/advance-week\`, or confirm with \`/game-channels advance-now source-week:${next}\`.`
    : `Advance the franchise in Madden (Companion App → Franchise → Advance Week) and complete the **${provider.key}** import. The bot will detect Week ${next} automatically.`;
  return `${reminder ? '⏰ Reminder — ' : ''}🎮 **Madden advance required.** Provider **${provider.key}** has no authorized advance control, so the bot is waiting for the source to reach Week **${next}** (state AWAITING_SOURCE_ADVANCE).\n${how}`;
}

async function _project(guild, state, rt) {
  const { getCh } = require('../services/channels/channelResolver');
  const { getTeamEmoji } = require('../utils/teamUtils');
  const hub = require('../services/hubReleaseService');
  await hub.postScheduleEmbed(guild, state, getCh, getTeamEmoji);
  hub.startScheduleTimer(guild, state, getCh, getTeamEmoji);
  return require('../services/weeklyAutomationService').projectCurrentWeek(guild, state, state.players, { force: true });
}

/** Durable commit first (registry + state + runtime), then Discord projection. Idempotent per cycleId. */
async function _publish(guild, state, rt) {
  const now = Date.now();
  const week = Number(rt.targetWeek);
  if (rt.publishCommittedFor !== rt.cycleId) {
    const registry = require('../services/scheduleRegistryService');
    const provider = _providers().resolveActive();
    registry.upsertWeek(week, rt.pendingGames || [], { source: `advance:${provider.key}`, importedAt: rt.lastImportAt || now });
    registry.loadWeekIntoState(state, week);
    try { require('../services/weeklyAutomationService').saveWeeklySettings({ lastAdvancedWeek: week }); } catch {}
    runtime.patchRuntime({ publishCommittedFor: rt.cycleId, workflowWeek: week, lastPublishedWeek: week });
  }
  let projection = null;
  let projectionError = null;
  if (guild) {
    try { projection = await _project(guild, state, rt); }
    catch (e) { projectionError = e.message; log.error(`projection failed for Week ${week}: ${e.message}`); }
  }
  runtime.transition(S.WEEK_ACTIVE, {
    lastCycleId: rt.cycleId, cycleId: null, controlRequestedFor: null, expectedSourceWeek: null, targetWeek: null,
    pendingGames: null, manualRequestedBy: null, retryCount: 0, hold: null, lastError: null,
    nextAdvanceAt: _nextDeadline(now), deadlineArmedAt: now,
    projectionPendingFor: guild && !projectionError ? null : week,
    lastProjectionError: projectionError,
  });
  const p = projection || {};
  const summary = projectionError
    ? `✅ Week **${week}** committed (source verified: ${rt.sourceVerification || 'provider'}). ⚠️ Discord projection failed (${projectionError}) — it will retry automatically.`
    : `✅ Week **${week}** published (source verified: ${rt.sourceVerification || 'provider'}). Game channels: created ${p.created || 0}, reused ${p.skipped || 0}, held ${p.held || 0}${p.held ? ` (${(p.holds || []).map(h => `${h.team1} vs ${h.team2}`).join(', ')})` : ''}, failed ${p.failed || 0}, previous-week cleared ${p.cleared || 0}. Next deadline <t:${Math.floor(_nextDeadline(now) / 1000)}:R>.`;
  return { waiting: true, alert: summary, color: projectionError ? 0xe67e22 : 0x2ecc71 };
}

/**
 * Run the state machine until it reaches a waiting state. Single-flight + league lock.
 * @param {object} opts { guild, state, reason, manual, actor, attestedSourceWeek, notify=true }
 */
async function tick(opts = {}) {
  const state = opts.state || require('../state');
  const guild = opts.guild || null;
  const key = _lockKey(state);
  if (_inFlight.has(key)) return { ok: false, reason: 'in-flight' };
  _inFlight.add(key);
  const messages = [];
  try {
    if (!(await _acquireLock(guild, state))) return { ok: false, reason: 'locked' };
    try {
      runtime.patchRuntime({ lastTickAt: Date.now(), leagueId: _leagueId(state) });
      const pending = runtime.getRuntime();
      if (guild && pending.projectionPendingFor != null && pending.state === S.WEEK_ACTIVE && Number(pending.workflowWeek) === Number(pending.projectionPendingFor)) {
        try { await _project(guild, state, pending); runtime.patchRuntime({ projectionPendingFor: null, lastProjectionError: null }); messages.push({ text: `✅ Week **${pending.workflowWeek}** Discord projection retried successfully.`, color: 0x2ecc71 }); }
        catch (e) { runtime.patchRuntime({ lastProjectionError: e.message }); }
      }
      const ctx = { manual: !!opts.manual, actor: opts.actor || null, attestedSourceWeek: opts.attestedSourceWeek ?? null };
      for (let i = 0; i < MAX_STEPS_PER_TICK; i++) {
        const before = runtime.getRuntime().state;
        const r = await _step(guild, state, ctx);
        if (r.alert) messages.push({ text: r.alert, color: r.color || 0xe67e22 });
        if (r.info) messages.push({ text: r.info, color: 0x3498db });
        if (r.waiting) break;
        if (runtime.getRuntime().state === before) break; // no progress guard
      }
    } finally {
      await _releaseLock(guild, state);
    }
  } catch (e) {
    log.error(`tick failed: ${e.message}`);
    runtime.patchRuntime({ lastError: `tick: ${e.message}` });
    messages.push({ text: `⛔ Advance engine error: ${e.message}`, color: 0xe74c3c });
  } finally {
    _inFlight.delete(key);
  }
  if (opts.notify !== false && guild) for (const m of messages) await _notify(guild, m.text, { color: m.color, kind: 'tick' });
  const rt = runtime.getRuntime();
  return { ok: true, state: rt.state, messages: messages.map(m => m.text), runtime: rt };
}

/** Commissioner/AI-initiated advance. dryRun computes the plan without any transition. */
async function requestAdvance({ guild, state, actor, dryRun = false, attestedSourceWeek = null } = {}) {
  state = state || require('../state');
  const rt = runtime.getRuntime();
  if (dryRun) {
    const pre = await runPrechecks(guild, state);
    const caps = pre.provider.getCapabilities();
    return { ok: true, dryRun: true, state: rt.state, blockers: pre.blockers, sourceWeek: pre.sourceWeek, sourceError: pre.sourceError, workflowWeek: pre.workflowWeek, provider: pre.provider.key, path: pre.blockers.length ? 'HOLD' : !pre.ok ? 'RETRY_WAIT' : (pre.sourceWeek > pre.workflowWeek ? 'SOURCE_ADVANCED' : caps.advanceWeek ? 'REQUESTING_GAME_ADVANCE' : 'AWAITING_SOURCE_ADVANCE') };
  }
  if ([S.HOLD, S.RECOVERY_REQUIRED].includes(rt.state)) return { ok: false, reason: `engine is in ${rt.state} — run /game-channels advance-resume first`, state: rt.state };
  if (rt.state === S.AWAITING_SOURCE_ADVANCE && attestedSourceWeek == null) {
    const r = await tick({ guild, state, actor, notify: false });
    return { ok: true, alreadyInCycle: true, ...r };
  }
  const manual = [S.IDLE, S.WEEK_ACTIVE, S.DEADLINE_APPROACHING].includes(rt.state);
  if (rt.state === S.IDLE) await tick({ guild, state, actor, notify: false });
  const r = await tick({ guild, state, actor, manual, attestedSourceWeek, notify: true });
  return { ok: r.ok, alreadyInCycle: !manual, ...r };
}

function hold({ actor, reason } = {}) {
  const r = runtime.transition(S.HOLD, { hold: { reason: String(reason || 'commissioner hold').slice(0, 300), by: actor ? String(actor) : 'unknown', at: Date.now() } });
  log.info(`hold by ${actor || 'unknown'}: ${reason || ''}`);
  return { ok: r.ok, state: r.runtime.state };
}

async function resume({ guild, state, actor } = {}) {
  const rt = runtime.getRuntime();
  if (![S.HOLD, S.RECOVERY_REQUIRED, S.RETRY_WAIT].includes(rt.state)) return { ok: false, reason: `engine is ${rt.state}; nothing to resume` };
  const reimport = [S.VALIDATING_NEW_WEEK, S.IMPORT_COMPLETE].includes(rt.resumeState);
  runtime.resumeFromPause({ retryCount: 0, nextRetryAt: null, lastError: null, resumedBy: actor || null, resumedAt: Date.now() });
  if (reimport) runtime.patchRuntime({ state: S.IMPORT_PENDING, pendingGames: null });
  return tick({ guild, state, actor, notify: true });
}

/** Legacy /advance-week compatibility: the commissioner set the week manually. Completes any open cycle. */
function recordManualAdvance({ week, actor, providerKey } = {}) {
  const w = Number(week);
  if (!Number.isInteger(w)) return { ok: false, reason: 'invalid-week' };
  const rt = runtime.getRuntime();
  const key = providerKey || _providers().resolveActive().key;
  const saved = runtime.saveRuntime({
    state: S.WEEK_ACTIVE, workflowWeek: w, lastPublishedWeek: w,
    sourceWeek: key === 'local' ? w : rt.sourceWeek,
    sourceVerification: key === 'local' ? `manual-advance-week:${actor || 'unknown'}` : rt.sourceVerification,
    cycleId: null, controlRequestedFor: null, expectedSourceWeek: null, targetWeek: null, pendingGames: null,
    manualRequestedBy: null, hold: null, resumeState: null, retryCount: 0, lastError: null,
    nextAdvanceAt: _nextDeadline(), deadlineArmedAt: Date.now(), projectionPendingFor: null,
  });
  log.info(`manual advance recorded week=${w} by ${actor || 'unknown'} (was ${rt.state})`);
  return { ok: true, runtime: saved, previousState: rt.state };
}

/** Re-arm deadlines when policy changes so enabling automation never fires a stale past deadline. */
function onPolicyChanged(prev, next) {
  const rt = runtime.getRuntime();
  if (!prev || !next) return rt;
  const now = Date.now();
  if (!prev.enabled && next.enabled) return runtime.patchRuntime({ nextAdvanceAt: now + next.intervalHours * 3600000, deadlineArmedAt: now });
  if (prev.intervalHours !== next.intervalHours && rt.deadlineArmedAt) return runtime.patchRuntime({ nextAdvanceAt: Math.max(now, Number(rt.deadlineArmedAt) + next.intervalHours * 3600000) });
  return rt;
}

function recoverOnBoot(state) {
  const rt = runtime.getRuntime();
  const week = state?.scheduleState?.week != null ? Number(state.scheduleState.week) : null;
  if (rt.workflowWeek == null && week != null) runtime.patchRuntime({ workflowWeek: week });
  if (rt.nextAdvanceAt && rt.nextAdvanceAt < Date.now() && [S.WEEK_ACTIVE, S.DEADLINE_APPROACHING].includes(rt.state)) {
    log.warn(`missed deadline detected on boot (was <t:${Math.floor(rt.nextAdvanceAt / 1000)}>) — next tick evaluates it exactly once`);
  }
  if (runtime.isMidCycle(rt.state)) log.warn(`boot resumed mid-cycle in ${rt.state} (cycle ${rt.cycleId || 'n/a'})`);
  return runtime.getRuntime();
}

function getStatus(state) {
  state = state || require('../state');
  const rt = runtime.getRuntime();
  const provider = _providers().resolveActive();
  let sessions = null, imports = null, results = null, lock = null;
  try { sessions = require('./gameSessionService').getStatusSummary(); } catch {}
  try { imports = require('./importRunService').getStatusSummary(); } catch {}
  try { results = require('./gameResultService').getStatusSummary(); } catch {}
  try { lock = require('../services/guildLockService').getLockInfo(require('../config/env').GUILD_ID || 'global', _lockKey(state)); } catch {}
  return { runtime: rt, policy: policyService.getPolicy(), provider: provider.describe(), lock, sessions, imports, results, activeGames: [...(state?.games?.values?.() || [])].filter(g => !g.finished).length };
}

module.exports = { tick, requestAdvance, runPrechecks, hold, resume, recordManualAdvance, onPolicyChanged, recoverOnBoot, getStatus, ADVANCE_STATE: S };
