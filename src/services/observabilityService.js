/*
 * NAVIGATION HEADER
 * FILE: src/services/observabilityService.js
 * LAYER: Service layer
 * PURPOSE: Structured flow-outcome logging, duplicate-claim metrics, self-heal metrics, release metrics, and health reports.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for recordFlowOutcome, getHealthReport, getMetrics.
 * RELATED FLOW: All lifecycle flows, event claims, self-heal, release orchestration.
 * NOTE: V184 — introduced as part of the reliability hardening program.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const scaleMetrics = require('../infrastructure/scaleMetrics');
const compatibilityRegistry = require('../infrastructure/compatibilityRegistry');
const log = makeLogger('observability');

// ── Metrics storage (in-memory, rolling window) ──────────────────────

const WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling window
const MAX_ENTRIES = 5000;

/** @type {{ flow: string, data: Object, ts: number }[]} */
const _flowOutcomes = [];

/** @type {{ type: string, data: Object, ts: number }[]} */
const _claimMetrics = [];

/** @type {{ flow: string, data: Object, ts: number }[]} */
const _selfHealMetrics = [];

/** @type {{ version: string, data: Object, ts: number }[]} */
const _releaseMetrics = [];

function _sweep(arr) {
  const cutoff = Date.now() - WINDOW_MS;
  while (arr.length > 0 && arr[0].ts < cutoff) arr.shift();
  if (arr.length > MAX_ENTRIES) arr.splice(0, arr.length - MAX_ENTRIES);
}

// ── Flow outcome recording ───────────────────────────────────────────

/**
 * Record the outcome of any named flow.
 * @param {string} flow - Flow name (e.g., 'response-lifecycle', 'setup-wizard', 'release')
 * @param {Object} data - Outcome data (outcome, durationMs, error, etc.)
 */
function recordFlowOutcome(flow, data = {}) {
  _sweep(_flowOutcomes);
  _flowOutcomes.push({ flow, data, ts: Date.now() });
  if (data.outcome === 'handler-error' || data.outcome === 'validation-fail') {
    log.warn(`[FLOW] ${flow} → ${data.outcome}`, JSON.stringify(data).slice(0, 200));
  }
}

// ── Claim metrics ────────────────────────────────────────────────────

/**
 * Record an event claim attempt.
 * @param {'claimed'|'rejected'|'fallback'} type
 * @param {Object} data - { key, source: 'redis'|'local', eventType }
 */
function recordClaimAttempt(type, data = {}) {
  _sweep(_claimMetrics);
  _claimMetrics.push({ type, data, ts: Date.now() });
}

// ── Self-heal metrics ────────────────────────────────────────────────

/**
 * Record a self-heal action.
 * @param {string} flow - What was healed (e.g., 'wizard-guide', 'patch-notes-channel', 'role')
 * @param {Object} data - { ok, healed, reason }
 */
function recordSelfHeal(flow, data = {}) {
  _sweep(_selfHealMetrics);
  _selfHealMetrics.push({ flow, data, ts: Date.now() });
  log.info(`[SELF-HEAL] ${flow} → ok=${data.ok} healed=${!!data.healed}`);
}

// ── Release metrics ──────────────────────────────────────────────────

/**
 * Record a release event.
 * @param {string} version
 * @param {Object} data - { ok, patchNotePublished, entry }
 */
function recordRelease(version, data = {}) {
  _sweep(_releaseMetrics);
  _releaseMetrics.push({ version, data, ts: Date.now() });
  log.info(`[RELEASE] ${version} → ok=${data.ok}`);
}

// ── Health report ────────────────────────────────────────────────────

/**
 * Build a health report for the current rolling window.
 * Returns an object suitable for display in the commissioner channel.
 */
function getHealthReport() {
  _sweep(_flowOutcomes);
  _sweep(_claimMetrics);
  _sweep(_selfHealMetrics);
  _sweep(_releaseMetrics);

  // Flow outcome summary
  const flowSummary = {};
  for (const entry of _flowOutcomes) {
    const key = entry.flow;
    if (!flowSummary[key]) flowSummary[key] = { total: 0, success: 0, error: 0, deduped: 0 };
    flowSummary[key].total++;
    const o = entry.data?.outcome;
    if (o === 'success') flowSummary[key].success++;
    else if (o === 'handler-error') flowSummary[key].error++;
    else if (o === 'deduped' || o === 'claim-lost') flowSummary[key].deduped++;
  }

  // Claim summary
  const claims = { total: _claimMetrics.length, claimed: 0, rejected: 0, fallback: 0 };
  for (const entry of _claimMetrics) {
    if (claims[entry.type] !== undefined) claims[entry.type]++;
  }

  // Self-heal summary
  const heals = { total: _selfHealMetrics.length, healed: 0, failed: 0 };
  for (const entry of _selfHealMetrics) {
    if (entry.data?.ok && entry.data?.healed) heals.healed++;
    else if (!entry.data?.ok) heals.failed++;
  }

  // Release summary
  const releases = _releaseMetrics.map(r => ({
    version: r.version,
    ok: r.data?.ok,
    ts: new Date(r.ts).toISOString(),
  }));

  return {
    window: '1h',
    generatedAt: new Date().toISOString(),
    flows: flowSummary,
    claims,
    selfHeals: heals,
    releases,
    scale: scaleMetrics.snapshot(),
    compatibility: compatibilityRegistry.retirementReport(),
  };
}

/**
 * Condensed metrics suitable for quick diagnostics.
 */
function getMetrics() {
  const report = getHealthReport();
  return {
    flowsTracked: Object.keys(report.flows).length,
    totalFlowEvents: _flowOutcomes.length,
    claimAttempts: report.claims.total,
    claimRejections: report.claims.rejected,
    selfHeals: report.selfHeals,
    releaseCount: report.releases.length,
    scale: report.scale,
    compatibilityHits: Object.fromEntries(report.compatibility.map(row => [row.compatId, row.hits])),
  };
}

/**
 * Format a human-readable health string for Discord embeds.
 */
function formatHealthEmbed() {
  const r = getHealthReport();
  const lines = [`**System Health** (${r.window} window)\n`];

  // Flows
  for (const [name, stats] of Object.entries(r.flows)) {
    const errRate = stats.total > 0 ? ((stats.error / stats.total) * 100).toFixed(1) : '0.0';
    lines.push(`▸ **${name}**: ${stats.total} total, ${stats.success} ok, ${stats.error} err (${errRate}%), ${stats.deduped} deduped`);
  }

  // Claims
  lines.push(`\n**Event Claims**: ${r.claims.total} total, ${r.claims.claimed} won, ${r.claims.rejected} rejected, ${r.claims.fallback} fallback`);

  // Self-heals
  lines.push(`**Self-Heals**: ${r.selfHeals.total} total, ${r.selfHeals.healed} healed, ${r.selfHeals.failed} failed`);

  const compatHits = r.compatibility.reduce((sum, row) => sum + Number(row.hits || 0), 0);
  const scaleCounters = Object.values(r.scale?.counters || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  lines.push(`**G3 Scale/Compatibility**: ${scaleCounters} counter events, ${compatHits} compatibility hits`);

  // Releases
  if (r.releases.length) {
    lines.push(`\n**Recent Releases**:`);
    for (const rel of r.releases.slice(-5)) {
      lines.push(`  ${rel.version} — ${rel.ok ? '✅' : '❌'} — ${rel.ts}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  recordFlowOutcome,
  recordClaimAttempt,
  recordSelfHeal,
  recordRelease,
  getHealthReport,
  getMetrics,
  formatHealthEmbed,
};
