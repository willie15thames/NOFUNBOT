/*
 * NAVIGATION HEADER
 * FILE: src/services/escalationService.js
 * LAYER: Service layer
 * PURPOSE: Routes critical flow failures, unrecoverable errors, and security events to the commissioner channel.
 *          Separates recoverable from unsafe failures. Owns escalation rules and thresholds.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for escalate, ESCALATION_RULES, shouldEscalate.
 * RELATED FLOW: All workflow steps, self-heal, content moderation, offense detection, spam.
 * NOTE: V191 — introduced as part of flow completion program.
 */

'use strict';

const { EmbedBuilder } = require('discord.js');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('escalation');

// ── Severity levels ──────────────────────────────────────────

const SEVERITY = Object.freeze({
  INFO:     'info',      // Logged, no commissioner ping
  WARNING:  'warning',   // Posted to commissioner-ai, no ping
  CRITICAL: 'critical',  // Posted to commissioner-ai WITH role ping
  SECURITY: 'security',  // Posted to commissioner-ai WITH role ping + audit log
});

const SEVERITY_COLORS = {
  info:     0x3498db,
  warning:  0xf39c12,
  critical: 0xe74c3c,
  security: 0x8b0000,
};

// ── Escalation rules ─────────────────────────────────────────
// Each rule defines when a flow failure should escalate vs be silently logged.

const ESCALATION_RULES = {
  // Self-heal failures — only escalate if heal itself fails
  'self-heal':            { threshold: 1, severity: SEVERITY.WARNING,  cooldownMs: 30 * 60_000 },
  // Build failures — always critical (commissioner clicked build)
  'server-build':         { threshold: 1, severity: SEVERITY.CRITICAL, cooldownMs: 0 },
  // Permission failures — critical, bot can't operate
  'permission-denied':    { threshold: 1, severity: SEVERITY.CRITICAL, cooldownMs: 10 * 60_000 },
  // Content moderation — warn on repeated blocks
  'content-block':        { threshold: 5, severity: SEVERITY.WARNING,  cooldownMs: 15 * 60_000 },
  // Spam escalation — always escalate ban attempts
  'spam-ban':             { threshold: 1, severity: SEVERITY.CRITICAL, cooldownMs: 0 },
  // Offense detection — escalated through its own UI (buttons), but failures here
  'offense-detection':    { threshold: 3, severity: SEVERITY.WARNING,  cooldownMs: 30 * 60_000 },
  // Role sync failures
  'role-sync':            { threshold: 1, severity: SEVERITY.WARNING,  cooldownMs: 60 * 60_000 },
  // Channel creation failures
  'channel-create':       { threshold: 2, severity: SEVERITY.WARNING,  cooldownMs: 15 * 60_000 },
  // Security events — always escalate immediately
  'injection-attempt':    { threshold: 1, severity: SEVERITY.SECURITY, cooldownMs: 0 },
  'system-probe':         { threshold: 1, severity: SEVERITY.SECURITY, cooldownMs: 5 * 60_000 },
  // Active check escalation — warn when members are near boot threshold
  'active-check-warn':    { threshold: 1, severity: SEVERITY.WARNING,  cooldownMs: 0 },
  // Active check auto-boot — always critical (members removed)
  'active-check-boot':    { threshold: 1, severity: SEVERITY.CRITICAL, cooldownMs: 0 },
  // Workflow step failures
  'workflow-step':        { threshold: 2, severity: SEVERITY.WARNING,  cooldownMs: 10 * 60_000 },
  // AI failures
  'ai-failure':           { threshold: 3, severity: SEVERITY.WARNING,  cooldownMs: 15 * 60_000 },
  // Catch-all
  'default':              { threshold: 3, severity: SEVERITY.WARNING,  cooldownMs: 30 * 60_000 },
};

// ── State tracking ───────────────────────────────────────────

/** @type {Map<string, { count: number, lastEscalatedAt: number }>} */
const _counters = new Map();
const MAX_COUNTERS = 200;

/** @type {Array<{ type: string, severity: string, message: string, ts: number }>} */
const _escalationLog = [];
const MAX_LOG = 300;

function _sweepCounters() {
  if (_counters.size <= MAX_COUNTERS) return;
  const cutoff = Date.now() - 60 * 60_000;
  for (const [key, data] of _counters.entries()) {
    if (data.lastEscalatedAt < cutoff) _counters.delete(key);
    if (_counters.size <= MAX_COUNTERS * 0.8) break;
  }
}

// ── Core escalation function ─────────────────────────────────

/**
 * Evaluate whether an event should be escalated, and if so, post to commissioner-ai.
 *
 * @param {string} type - Escalation type key (matches ESCALATION_RULES)
 * @param {Object} opts
 * @param {Object} opts.guild - Discord guild (required for posting)
 * @param {string} opts.message - Human-readable description
 * @param {Object} [opts.fields] - Extra embed fields [{ name, value, inline }]
 * @param {string} [opts.userId] - User who triggered the event
 * @param {string} [opts.channelId] - Channel where the event occurred
 * @param {string} [opts.error] - Error message if applicable
 * @param {boolean} [opts.force] - Skip threshold/cooldown and escalate immediately
 * @returns {{ escalated: boolean, severity: string, reason: string }}
 */
async function escalate(type, opts = {}) {
  const rule = ESCALATION_RULES[type] || ESCALATION_RULES.default;
  const key = `${type}:${opts.guild?.id || 'global'}`;
  const now = Date.now();

  _sweepCounters();

  // Track occurrence count
  if (!_counters.has(key)) _counters.set(key, { count: 0, lastEscalatedAt: 0 });
  const counter = _counters.get(key);
  counter.count++;

  // Check threshold
  if (!opts.force && counter.count < rule.threshold) {
    return { escalated: false, severity: rule.severity, reason: `below-threshold (${counter.count}/${rule.threshold})` };
  }

  // Check cooldown
  if (!opts.force && rule.cooldownMs > 0 && (now - counter.lastEscalatedAt) < rule.cooldownMs) {
    return { escalated: false, severity: rule.severity, reason: 'on-cooldown' };
  }

  // Reset counter and mark escalated
  counter.count = 0;
  counter.lastEscalatedAt = now;

  // Log it
  _escalationLog.push({ type, severity: rule.severity, message: opts.message || type, ts: now });
  if (_escalationLog.length > MAX_LOG) _escalationLog.splice(0, _escalationLog.length - MAX_LOG);

  // Post to commissioner-ai channel
  const posted = await _postToCommChannel(opts.guild, type, rule.severity, opts);

  log.info(`[ESCALATION] ${rule.severity.toUpperCase()} — ${type}: ${opts.message || 'no details'} (posted=${posted})`);

  // Record in observability
  try {
    require('./observabilityService').recordFlowOutcome('escalation', {
      outcome: posted ? 'posted' : 'post-failed',
      type,
      severity: rule.severity,
    });
  } catch {}

  return { escalated: true, severity: rule.severity, reason: 'escalated' };
}

/**
 * Post an escalation embed to #commissioner-ai.
 */
async function _postToCommChannel(guild, type, severity, opts = {}) {
  if (!guild) return false;
  try {
    const { getCh } = require('./channels/channelResolver');
    const commCh = getCh(guild, 'commAI');
    if (!commCh) return false;

    const embed = new EmbedBuilder()
      .setColor(SEVERITY_COLORS[severity] || 0xf39c12)
      .setTitle(`${severity === 'security' ? '🔴' : severity === 'critical' ? '🟠' : '🟡'} ${_titleCase(severity)} Escalation`)
      .setDescription(opts.message || `A ${type} event requires attention.`)
      .addFields({ name: 'Type', value: type, inline: true })
      .setTimestamp();

    if (opts.userId) embed.addFields({ name: 'User', value: `<@${opts.userId}>`, inline: true });
    if (opts.channelId) embed.addFields({ name: 'Channel', value: `<#${opts.channelId}>`, inline: true });
    if (opts.error) embed.addFields({ name: 'Error', value: String(opts.error).slice(0, 500) });
    if (Array.isArray(opts.fields)) {
      for (const f of opts.fields) embed.addFields(f);
    }

    const { COMM_ROLE } = require('../config/env');
    const shouldPing = severity === 'critical' || severity === 'security';
    await commCh.send({
      content: shouldPing && COMM_ROLE ? `<@&${COMM_ROLE}>` : undefined,
      embeds: [embed],
      allowedMentions: shouldPing && COMM_ROLE ? { roles: [COMM_ROLE] } : { parse: [] },
    });
    return true;
  } catch (err) {
    log.error(`Escalation post failed: ${err.message}`);
    return false;
  }
}

function _titleCase(s) {
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
}

// ── Query API ────────────────────────────────────────────────

function getRecentEscalations(limit = 20) {
  return _escalationLog.slice(-limit).reverse();
}

function getEscalationRules() {
  return { ...ESCALATION_RULES };
}

module.exports = {
  SEVERITY,
  ESCALATION_RULES,
  escalate,
  getRecentEscalations,
  getEscalationRules,
};
